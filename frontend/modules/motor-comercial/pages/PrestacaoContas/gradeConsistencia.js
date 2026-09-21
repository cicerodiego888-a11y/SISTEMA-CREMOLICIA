/**
 * STAB-04 — Consistência da Grade (State único).
 * DOM nunca é fonte da verdade para payload.
 *
 * @module frontend/modules/motor-comercial/pages/PrestacaoContas/gradeConsistencia
 */

const CAMPOS_QTY = Object.freeze(['devolvido', 'vendido', 'perdido', 'cortesia']);

const {
  calcularSaldoItem,
  listarPendenciasRetornos,
  campoParaTipo,
  syncStatusOperacional
} = require('./fecharConsignacaoMappers');

function snapshotQty(item = {}) {
  return {
    vendido: Number(item.vendido || 0),
    devolvido: Number(item.devolvido || 0),
    perdido: Number(item.perdido || 0),
    cortesia: Number(item.cortesia || 0)
  };
}

function cloneBaseline(itens = []) {
  return (itens || []).map((item) => ({
    key: itemKey(item),
    ...snapshotQty(item)
  }));
}

function itemKey(item = {}) {
  const itemId = Number(item.itemId ?? item.id);
  if (Number.isFinite(itemId) && itemId > 0) return `i:${itemId}`;
  const produtoId = Number(item.produtoId);
  if (Number.isFinite(produtoId) && produtoId > 0) return `p:${produtoId}`;
  return null;
}

function itemEstaDirty(item = {}) {
  if (item.dirty === true) return true;
  if (item.dirtyCampos && Object.keys(item.dirtyCampos).length) return true;
  return false;
}

function temAlteracoesPendentes(itens = []) {
  return (itens || []).some(itemEstaDirty);
}

function marcarDirty(item, campo) {
  if (!item) return item;
  item.dirty = true;
  item.dirtyCampos = { ...(item.dirtyCampos || {}), [campo]: true };
  return item;
}

function limparDirty(item) {
  if (!item) return item;
  item.dirty = false;
  item.dirtyCampos = {};
  return item;
}

function limparDirtyTodos(itens = []) {
  (itens || []).forEach(limparDirty);
  return itens;
}

/**
 * Atualiza State a partir do valor informado (fonte única).
 */
function aplicarValorState(item, campo, value) {
  if (!item) return null;
  if (campo === 'observacao') {
    const prev = item.observacao != null ? String(item.observacao) : '';
    const next = value != null ? String(value) : '';
    item.observacao = next;
    if (next !== prev) marcarDirty(item, 'observacao');
    return item;
  }
  if (!CAMPOS_QTY.includes(campo)) return item;
  const next = Math.max(0, Number(value) || 0);
  const prev = Number(item[campo] || 0);
  item[campo] = next;
  // espelha campos oficiais do ItemConsignacao
  if (campo === 'vendido') item.quantidadeVendida = next;
  if (campo === 'devolvido') item.quantidadeDevolvida = next;
  if (campo === 'perdido') {
    item.quantidadePerdida = next;
    item.quantidadePerda = next;
  }
  if (campo === 'cortesia') item.quantidadeCortesia = next;
  syncStatusOperacional(item);
  if (next !== prev) marcarDirty(item, campo);
  return item;
}

/**
 * Pendências a partir de baseline (persistido) × state atual — sem ler DOM.
 */
function listarPendenciasFromBaseline(baseline = [], stateItens = [], { indices = null } = {}) {
  const baselineAsItens = (stateItens || []).map((item, index) => {
    const key = itemKey(item);
    const base = baseline.find((b) => b.key && key && b.key === key)
      || baseline[index]
      || { vendido: 0, devolvido: 0, perdido: 0, cortesia: 0 };
    return {
      ...item,
      vendido: Number(base.vendido || 0),
      devolvido: Number(base.devolvido || 0),
      perdido: Number(base.perdido || 0),
      cortesia: Number(base.cortesia || 0)
    };
  });

  let pendencias = listarPendenciasRetornos(baselineAsItens, stateItens);
  if (Array.isArray(indices)) {
    const set = new Set(indices);
    pendencias = pendencias.filter((p) => set.has(p.index));
  }
  return pendencias;
}

/**
 * Preserva campos dirty do state ao mesclar resposta do servidor.
 */
function _espelharQtyOficial(item, campo, value) {
  const n = Number(value || 0);
  item[campo] = n;
  if (campo === 'vendido') item.quantidadeVendida = n;
  if (campo === 'devolvido') item.quantidadeDevolvida = n;
  if (campo === 'perdido') {
    item.quantidadePerdida = n;
    item.quantidadePerda = n;
  }
  if (campo === 'cortesia') item.quantidadeCortesia = n;
  return item;
}

function _acharItemEstado(serverItem, index, stateItens = []) {
  const key = itemKey(serverItem);
  if (key) {
    const byKey = (stateItens || []).find((p) => itemKey(p) === key);
    if (byKey) return byKey;
  }
  return stateItens[index];
}

function mesclarServidorPreservandoDirty(servidorItens = [], stateItens = []) {
  return (servidorItens || []).map((serverItem, index) => {
    const prev = _acharItemEstado(serverItem, index, stateItens);
    if (!prev || !itemEstaDirty(prev)) {
      const clean = {
        ...serverItem,
        dirty: false,
        dirtyCampos: {},
        observacao: prev?.observacao != null && prev.observacao !== ''
          ? prev.observacao
          : (serverItem.observacao || '')
      };
      return syncStatusOperacional(clean);
    }
    const merged = { ...serverItem };
    CAMPOS_QTY.forEach((campo) => {
      if (prev.dirtyCampos?.[campo]) {
        _espelharQtyOficial(merged, campo, prev[campo]);
      }
    });
    if (prev.dirtyCampos?.observacao || prev.observacao != null) {
      merged.observacao = prev.observacao;
    }
    merged.dirty = true;
    merged.dirtyCampos = { ...(prev.dirtyCampos || {}) };
    return syncStatusOperacional(merged);
  });
}

function statusPersistencia(itens = []) {
  if (temAlteracoesPendentes(itens)) return 'pending';
  return 'saved';
}

function labelStatusPersistencia(status) {
  if (status === 'pending') return '● Alterações pendentes';
  if (status === 'saving') return 'Salvando alterações...';
  if (status === 'saved') return '✓ Alterações salvas';
  return '';
}

module.exports = {
  CAMPOS_QTY,
  snapshotQty,
  cloneBaseline,
  itemKey,
  itemEstaDirty,
  temAlteracoesPendentes,
  marcarDirty,
  limparDirty,
  limparDirtyTodos,
  aplicarValorState,
  listarPendenciasFromBaseline,
  mesclarServidorPreservandoDirty,
  statusPersistencia,
  labelStatusPersistencia,
  campoParaTipo
};
