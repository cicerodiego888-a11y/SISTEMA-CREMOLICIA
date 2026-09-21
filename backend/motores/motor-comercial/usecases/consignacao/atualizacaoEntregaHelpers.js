/**
 * RCM-8.13 — Helpers de atualização pós-entrega e comprovante completo.
 *
 * Cada comprovante é uma fotografia da consignação naquele momento.
 * Nunca sobrescreve comprovante anterior; nunca emite somente o delta.
 *
 * @module motores/motor-comercial/usecases/consignacao/atualizacaoEntregaHelpers
 */

const {
  OPERACAO_ENTREGA_ORIGINAL,
  OPERACAO_ENTREGA_COMPLEMENTAR,
  avaliarElegibilidadeEntregaComplementar
} = require('./entregaComplementarHelpers');

const OPERACAO_ALTERACAO_POS_ENTREGA = 'ALTERACAO_POS_ENTREGA';

const TIPOS_EVENTO_ENTREGA = Object.freeze({
  ORIGINAL: 'ORIGINAL',
  COMPLEMENTAR: 'COMPLEMENTAR',
  ALTERACAO_POS_ENTREGA: 'ALTERACAO_POS_ENTREGA'
});

const MOTIVOS_ALTERACAO_POS_ENTREGA = Object.freeze([
  'CLIENTE_DESISTIU',
  'ERRO_DIGITACAO',
  'AJUSTE_OPERACIONAL',
  'OUTRO'
]);

const MENSAGEM_CONFIRMACAO_ALTERACAO =
  'Esta alteração será registrada como uma nova atualização da entrega. '
  + 'O comprovante anterior será preservado e um novo comprovante será emitido.';

const MENSAGEM_CONFIRMACAO_COMPLEMENTACAO =
  'Esta complementação será adicionada à consignação. '
  + 'A entrega anterior será preservada e um novo comprovante atualizado será emitido.';

/**
 * @param {number} sequencia — 1-based
 * @returns {string} ex.: "001"
 */
function formatarNumeroComprovante(sequencia) {
  const n = Math.max(1, Number(sequencia) || 1);
  return String(n).padStart(3, '0');
}

/**
 * Elegibilidade idêntica à complementação (ENTREGUE, não terminal, prestação não fechada).
 * @param {Object|null} consignacao
 */
function avaliarElegibilidadeAlteracaoPosEntrega(consignacao) {
  const base = avaliarElegibilidadeEntregaComplementar(consignacao);
  if (!base.elegivel) {
    return {
      elegivel: false,
      codigo: base.codigo === 'CONSIGNACAO_NAO_ENTREGUE'
        ? 'CONSIGNACAO_NAO_ENTREGUE'
        : (base.codigo || 'ALTERACAO_POS_ENTREGA_BLOQUEADA'),
      mensagem: base.codigo === 'CONSIGNACAO_NAO_ENTREGUE'
        ? `Alteração pós-entrega só é permitida em consignação ENTREGUE (atual: ${String(consignacao?.status || '—').toUpperCase()})`
        : base.mensagem
    };
  }
  return { elegivel: true, codigo: null, mensagem: null };
}

/**
 * Normaliza created_at legado do SQLite (sem timezone) como UTC explícito.
 * Nunca trata "YYYY-MM-DD HH:MM:SS" como horário local.
 * @param {string|null|undefined} raw
 * @returns {string|null}
 */
function normalizarTimestampLegado(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/[zZ]$/.test(s) || /[+-]\d{2}:?\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s)) {
    const withT = s.includes('T') ? s : s.replace(' ', 'T');
    return /[zZ]$|[+-]\d{2}:?\d{2}$/.test(withT) ? withT : `${withT}Z`;
  }
  return s;
}

/**
 * Timestamp operacional oficial do evento de entrega.
 * Prioridade: dataMovimentacao > snapshot.capturadoEm > createdAt normalizado.
 * @param {Object|null|undefined} mov
 * @returns {string|null}
 */
function resolverTimestampOperacional(mov) {
  if (!mov) return null;
  const operacional = mov.dataMovimentacao || mov.snapshot?.capturadoEm || null;
  if (operacional != null && String(operacional).trim() !== '') {
    return String(operacional).trim();
  }
  return normalizarTimestampLegado(mov.createdAt);
}

function _ts(mov) {
  const raw = resolverTimestampOperacional(mov);
  const t = raw ? new Date(raw).getTime() : 0;
  return Number.isFinite(t) ? t : 0;
}

function _resolverTipoEvento(movs, index) {
  const snapOp = String(
    movs[0]?.snapshot?.contexto?.operacao
    || movs[0]?.snapshot?.operacao
    || movs[0]?.tipoMovimentacao
    || movs[0]?.tipo
    || ''
  ).toUpperCase();

  if (snapOp === OPERACAO_ALTERACAO_POS_ENTREGA
    || String(movs[0]?.tipoMovimentacao || '').toUpperCase() === OPERACAO_ALTERACAO_POS_ENTREGA) {
    return TIPOS_EVENTO_ENTREGA.ALTERACAO_POS_ENTREGA;
  }
  if (snapOp === OPERACAO_ENTREGA_COMPLEMENTAR) {
    return TIPOS_EVENTO_ENTREGA.COMPLEMENTAR;
  }
  if (snapOp === OPERACAO_ENTREGA_ORIGINAL || index === 0) {
    return TIPOS_EVENTO_ENTREGA.ORIGINAL;
  }
  if (index > 0) return TIPOS_EVENTO_ENTREGA.COMPLEMENTAR;
  return TIPOS_EVENTO_ENTREGA.ORIGINAL;
}

function _labelEvento(tipo, numeroComprovante) {
  if (tipo === TIPOS_EVENTO_ENTREGA.COMPLEMENTAR) {
    return `Entrega Complementar ${numeroComprovante}`;
  }
  if (tipo === TIPOS_EVENTO_ENTREGA.ALTERACAO_POS_ENTREGA) {
    return `Alteração Pós-Entrega ${numeroComprovante}`;
  }
  return `Entrega Original ${numeroComprovante}`;
}

/**
 * Agrupa movimentações de entrega/atualização por correlationId.
 * Numeração sequencial 001, 002, 003… por consignação.
 *
 * @param {Object[]} movimentacoes
 * @param {Object[]} [itens]
 * @returns {Array<Object>}
 */
function montarHistoricoEntregasAtualizado(movimentacoes = [], itens = []) {
  const itensById = new Map(
    (itens || []).map((item) => [String(item.id), item])
  );

  const entregas = (movimentacoes || []).filter((mov) => {
    const tipo = String(mov.tipoMovimentacao || mov.tipo || '').toUpperCase();
    const op = String(mov.snapshot?.contexto?.operacao || mov.snapshot?.operacao || '').toUpperCase();
    return tipo === 'ENTREGA'
      || tipo === OPERACAO_ALTERACAO_POS_ENTREGA
      || op === OPERACAO_ENTREGA_COMPLEMENTAR
      || op === OPERACAO_ALTERACAO_POS_ENTREGA
      || op === OPERACAO_ENTREGA_ORIGINAL;
  });

  const grupos = new Map();
  for (const mov of entregas) {
    const key = String(mov.correlationId || mov.id || `mov-${grupos.size}`);
    if (!grupos.has(key)) grupos.set(key, []);
    grupos.get(key).push(mov);
  }

  const ordenados = [...grupos.entries()].sort((a, b) => {
    const ta = _ts(a[1][0]);
    const tb = _ts(b[1][0]);
    return ta - tb;
  });

  /** @type {Map<string, number>} produtoId → qtd acumulada */
  const estado = new Map();

  return ordenados.map((entry, index) => {
    const [correlationId, movs] = entry;
    const tipo = _resolverTipoEvento(movs, index);
    const sequencia = index + 1;
    const numeroComprovante = formatarNumeroComprovante(sequencia);
    const label = _labelEvento(tipo, numeroComprovante);

    const itensEvento = movs.map((mov) => {
      const itemId = mov.consignacaoItemId || mov.snapshot?.item?.id;
      const item = itemId != null ? itensById.get(String(itemId)) : null;
      const produtoId = item?.produtoId
        ?? mov.snapshot?.item?.produtoId
        ?? mov.produtoId
        ?? null;
      const key = String(produtoId ?? itemId ?? '');

      const snapItem = mov.snapshot?.item || {};
      let quantidadeAnterior = snapItem.quantidadeAnterior != null
        ? Number(snapItem.quantidadeAnterior)
        : (estado.has(key) ? Number(estado.get(key)) : 0);

      let delta;
      if (snapItem.delta != null) {
        delta = Number(snapItem.delta);
      } else if (tipo === TIPOS_EVENTO_ENTREGA.ORIGINAL) {
        delta = Number(mov.quantidade ?? snapItem.quantidade ?? item?.quantidadeEntregue ?? 0);
        quantidadeAnterior = 0;
      } else if (tipo === TIPOS_EVENTO_ENTREGA.ALTERACAO_POS_ENTREGA) {
        delta = Number(mov.quantidade ?? snapItem.quantidade ?? 0);
      } else {
        delta = Number(mov.quantidade ?? snapItem.quantidade ?? 0);
      }

      let quantidadeAtual = snapItem.quantidadeAtual != null
        ? Number(snapItem.quantidadeAtual)
        : quantidadeAnterior + delta;

      if (key) estado.set(key, quantidadeAtual);

      const precoUnitario = Number(
        item?.precoUnitario
        ?? snapItem.precoUnitario
        ?? 0
      );

      return {
        itemId: itemId ?? null,
        produtoId,
        produtoNome: item?.produtoNome
          || item?.produto
          || snapItem.produtoNome
          || null,
        quantidade: delta,
        quantidadeAnterior,
        delta,
        quantidadeAtual,
        precoUnitario,
        valor: Number(mov.valor ?? (delta * precoUnitario) ?? 0),
        unidadeComercial: item?.unidadeComercial || snapItem.unidadeComercial || null,
        linhaComercialId: item?.linhaComercialId ?? snapItem.linhaComercialId ?? null,
        tabelaPrecoId: item?.tabelaPrecoId ?? snapItem.tabelaPrecoId ?? null,
        canalVenda: item?.canalVenda || snapItem.canalVenda || null,
        precoOrigem: item?.precoOrigem || snapItem.precoOrigem || null,
        precoFallback: item?.precoFallback ?? snapItem.precoFallback ?? null,
        afetado: true
      };
    });

    // Snapshot de situação completa após o evento (para comprovante)
    const itensAfetadosIds = new Set(
      itensEvento.map((i) => String(i.produtoId ?? i.itemId))
    );

    const itensSituacaoAtual = [];
    for (const [prodKey, qtd] of estado.entries()) {
      const ref = itensEvento.find((i) => String(i.produtoId ?? i.itemId) === prodKey)
        || (itens || []).find((i) => String(i.produtoId) === prodKey || String(i.id) === prodKey);
      itensSituacaoAtual.push({
        produtoId: ref?.produtoId ?? (Number(prodKey) || prodKey),
        produtoNome: ref?.produtoNome || ref?.produto || null,
        quantidade: Number(qtd),
        precoUnitario: Number(ref?.precoUnitario || 0),
        afetado: itensAfetadosIds.has(prodKey)
      });
    }

    // Inclui itens atuais do repo que ainda não entraram no estado (edge)
    for (const item of itens || []) {
      const key = String(item.produtoId ?? item.id);
      if (!estado.has(key) && Number(item.quantidadeEntregue) >= 0 && sequencia === ordenados.length) {
        itensSituacaoAtual.push({
          produtoId: item.produtoId,
          produtoNome: item.produtoNome || item.produto || null,
          quantidade: Number(item.quantidadeEntregue) || 0,
          precoUnitario: Number(item.precoUnitario) || 0,
          afetado: false
        });
      }
    }

    const valorTotal = itensEvento.reduce((s, i) => s + Number(i.valor || 0), 0);
    const quantidadeTotalAtual = itensSituacaoAtual.reduce(
      (s, i) => s + Number(i.quantidade || 0),
      0
    );
    const valorTotalAtual = itensSituacaoAtual.reduce(
      (s, i) => s + (Number(i.quantidade || 0) * Number(i.precoUnitario || 0)),
      0
    );

    const dataHora = resolverTimestampOperacional(movs[0]);

    const motivo = movs[0]?.motivo
      || movs[0]?.snapshot?.contexto?.motivo
      || movs[0]?.detalhes?.motivo
      || null;

    const observacao = movs[0]?.snapshot?.contexto?.observacao
      || movs[0]?.detalhes?.observacao
      || null;

    const eventoAnteriorCorrelationId = index > 0
      ? (ordenados[index - 1][0] === 'sem-correlation' ? null : ordenados[index - 1][0])
      : null;

    const comprovante = montarComprovanteEntregaAtualizado({
      numeroConsignacao: movs[0]?.snapshot?.documento?.numero
        || movs[0]?.snapshot?.consignacao?.documento?.numero
        || null,
      consignacaoId: movs[0]?.consignacaoId || null,
      numeroComprovante,
      sequencia,
      tipo,
      itensSituacaoAtual,
      itensEvento,
      motivo,
      observacao,
      quantidadeTotalAtual,
      valorTotalAtual,
      dataHora
    });

    return {
      tipo,
      sequencia,
      numeroComprovante,
      label,
      correlationId: correlationId === 'sem-correlation' ? null : correlationId,
      dataHora,
      valorTotal,
      quantidadeTotalAtual,
      valorTotalAtual,
      itens: itensEvento,
      itensSituacaoAtual,
      motivo,
      observacao,
      usuarioId: movs[0]?.usuarioId || null,
      eventoAnteriorCorrelationId,
      comprovante,
      reimpressao: true
    };
  });
}

/**
 * Modelo oficial do comprovante (lista completa + bloco de atualização).
 *
 * @param {Object} params
 * @returns {Object}
 */
function montarComprovanteEntregaAtualizado(params = {}) {
  const tipo = params.tipo || TIPOS_EVENTO_ENTREGA.ORIGINAL;
  const numeroComprovante = params.numeroComprovante
    || formatarNumeroComprovante(params.sequencia || 1);
  const numeroConsignacao = params.numeroConsignacao
    || (params.consignacaoId != null ? `CONS-${params.consignacaoId}` : '—');

  const listaCompleta = (params.itensSituacaoAtual || []).map((item) => ({
    produtoId: item.produtoId,
    produtoNome: item.produtoNome || `Produto #${item.produtoId}`,
    quantidade: Number(item.quantidade || 0),
    precoUnitario: Number(item.precoUnitario || 0)
  }));

  const quantidadeTotalAtual = params.quantidadeTotalAtual != null
    ? Number(params.quantidadeTotalAtual)
    : listaCompleta.reduce((s, i) => s + i.quantidade, 0);

  const valorTotalAtual = params.valorTotalAtual != null
    ? Number(params.valorTotalAtual)
    : listaCompleta.reduce((s, i) => s + (i.quantidade * i.precoUnitario), 0);

  const afetadosPorProduto = new Map(
    (params.itensEvento || []).map((i) => [String(i.produtoId ?? i.itemId), i])
  );

  const detalheAtualizacao = listaCompleta.map((item) => {
    const key = String(item.produtoId);
    const ev = afetadosPorProduto.get(key);
    if (ev && (tipo === TIPOS_EVENTO_ENTREGA.COMPLEMENTAR
      || tipo === TIPOS_EVENTO_ENTREGA.ALTERACAO_POS_ENTREGA)) {
      const bloco = {
        produtoId: item.produtoId,
        produtoNome: item.produtoNome,
        quantidadeAnterior: Number(ev.quantidadeAnterior ?? 0),
        delta: Number(ev.delta ?? 0),
        quantidadeAtual: Number(ev.quantidadeAtual ?? item.quantidade),
        afetado: true
      };
      if (tipo === TIPOS_EVENTO_ENTREGA.COMPLEMENTAR) {
        bloco.complemento = bloco.delta >= 0 ? `+${bloco.delta}` : String(bloco.delta);
      } else {
        bloco.alteracao = bloco.delta >= 0 ? `+${bloco.delta}` : String(bloco.delta);
      }
      return bloco;
    }
    return {
      produtoId: item.produtoId,
      produtoNome: item.produtoNome,
      quantidadeAtual: item.quantidade,
      afetado: false
    };
  });

  const tipoAtualizacaoLabel = tipo === TIPOS_EVENTO_ENTREGA.COMPLEMENTAR
    ? 'ENTREGA COMPLEMENTAR'
    : (tipo === TIPOS_EVENTO_ENTREGA.ALTERACAO_POS_ENTREGA
      ? 'ALTERAÇÃO PÓS-ENTREGA'
      : null);

  return {
    titulo: `COMPROVANTE DE ENTREGA Nº ${numeroComprovante}`,
    numeroConsignacao,
    consignacaoId: params.consignacaoId ?? null,
    numeroComprovante,
    sequencia: params.sequencia || Number(numeroComprovante),
    tipo,
    tipoAtualizacao: tipoAtualizacaoLabel,
    listaCompleta,
    atualizacao: tipoAtualizacaoLabel
      ? {
          titulo: 'ATUALIZAÇÃO DA CONSIGNAÇÃO',
          tipo: tipoAtualizacaoLabel,
          itens: detalheAtualizacao,
          motivo: params.motivo || null,
          observacao: params.observacao || null
        }
      : null,
    quantidadeTotalAtual,
    valorTotalAtual,
    totalAtualLabel: `TOTAL ATUAL DA CONSIGNAÇÃO: ${quantidadeTotalAtual}`,
    dataHora: params.dataHora || null,
    // Flag: documento histórico — reimpressão não gera efeitos
    somenteLeitura: true,
    preservado: true
  };
}

/**
 * Texto textual do modelo oficial (para testes / impressão simples).
 * @param {Object} comprovante
 * @returns {string}
 */
function renderComprovanteTexto(comprovante = {}) {
  const lines = [];
  lines.push(`CONSIGNAÇÃO Nº ${comprovante.numeroConsignacao || '—'}`);
  lines.push('');
  lines.push(comprovante.titulo || `COMPROVANTE DE ENTREGA Nº ${comprovante.numeroComprovante || '001'}`);
  lines.push('');

  for (const item of comprovante.listaCompleta || []) {
    const nome = String(item.produtoNome || '').padEnd(28, '.');
    lines.push(`${nome} ${item.quantidade}`);
  }

  if (comprovante.atualizacao) {
    lines.push('');
    lines.push(comprovante.atualizacao.titulo);
    lines.push('');
    lines.push(comprovante.atualizacao.tipo);
    lines.push('');

    for (const item of comprovante.atualizacao.itens || []) {
      lines.push(item.produtoNome || `Produto #${item.produtoId}`);
      if (item.afetado) {
        lines.push(`Quantidade anterior: ${item.quantidadeAnterior}`);
        if (item.complemento != null) lines.push(`Complemento: ${item.complemento}`);
        if (item.alteracao != null) lines.push(`Alteração: ${item.alteracao}`);
        lines.push(`Quantidade atual: ${item.quantidadeAtual}`);
      } else {
        lines.push(`Quantidade atual: ${item.quantidadeAtual}`);
      }
      lines.push('');
    }

    if (comprovante.atualizacao.motivo) {
      lines.push('Motivo:');
      lines.push(String(comprovante.atualizacao.motivo));
      lines.push('');
    }
  }

  lines.push(comprovante.totalAtualLabel
    || `TOTAL ATUAL DA CONSIGNAÇÃO: ${comprovante.quantidadeTotalAtual ?? 0}`);

  return lines.join('\n');
}

/**
 * Monta comprovante a partir do histórico (reimpressão / pós-operação).
 * @param {Object[]} historico
 * @param {string|number} [correlationIdOuSequencia]
 * @returns {Object|null}
 */
function obterComprovanteDoHistorico(historico = [], correlationIdOuSequencia = null) {
  if (!historico.length) return null;
  if (correlationIdOuSequencia == null) {
    return historico[historico.length - 1].comprovante || null;
  }
  const chave = String(correlationIdOuSequencia);
  const found = historico.find((h) => String(h.correlationId) === chave
    || String(h.numeroComprovante) === chave
    || String(h.sequencia) === chave);
  return found?.comprovante || null;
}

module.exports = {
  OPERACAO_ALTERACAO_POS_ENTREGA,
  TIPOS_EVENTO_ENTREGA,
  MOTIVOS_ALTERACAO_POS_ENTREGA,
  MENSAGEM_CONFIRMACAO_ALTERACAO,
  MENSAGEM_CONFIRMACAO_COMPLEMENTACAO,
  formatarNumeroComprovante,
  avaliarElegibilidadeAlteracaoPosEntrega,
  montarHistoricoEntregasAtualizado,
  montarComprovanteEntregaAtualizado,
  renderComprovanteTexto,
  obterComprovanteDoHistorico,
  resolverTimestampOperacional,
  normalizarTimestampLegado
};
