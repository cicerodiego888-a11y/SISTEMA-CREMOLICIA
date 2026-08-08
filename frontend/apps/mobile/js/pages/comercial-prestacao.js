/**
 * CDS Mobile RCM-04.1 — Prestação de Contas (cards + Rateio de Perdas)
 * Consome APIs oficiais do Motor Comercial. Sem regras de negócio locais.
 */
import {
  escapeHtml,
  asText,
  formatMoney,
  formatDate,
  loadingHtml,
  emptyHtml,
  errorHtml,
  searchBarHtml,
  listCardHtml,
  backBarHtml,
  bindBack,
  bindGo,
  debounce,
  countLabel,
  sectionTitleHtml,
  statusBadgeHtml,
  icon
} from '../ui.js';
import { currentUserId, confirmSheet } from '../forms.js';
import { showToast } from '../toast.js';
import { canComercialAcerto, isOperadorComercial } from '../permissions.js';
import {
  formatDocumento,
  mapConsignacaoView,
  normalizeResumoPrestacao,
  numOrZero
} from '../comercial-mappers.js';
import {
  isOnline,
  enqueueOffline,
  countPending,
  flushComercialOfflineQueue,
  bindOfflineAutoSync
} from '../offline-queue.js';

const MOTIVOS = [
  { codigo: 'DERRETIMENTO', label: 'Derretimento' },
  { codigo: 'VENCIMENTO', label: 'Vencimento' },
  { codigo: 'QUEBRA', label: 'Quebra' },
  { codigo: 'FURTO', label: 'Furto' },
  { codigo: 'DEFEITO_FREEZER', label: 'Defeito no Freezer' },
  { codigo: 'TRANSPORTE', label: 'Transporte' },
  { codigo: 'OUTRO', label: 'Outro' }
];

const PAGE_SIZE = 12;

function usuarioPayload(extra = {}) {
  const uid = currentUserId();
  return {
    ...extra,
    usuarioId: uid != null ? Number(uid) : uid
  };
}

function apiErrorMessage(err) {
  return err?.payload?.error
    || err?.body?.error?.message
    || err?.body?.error
    || err?.body?.message
    || err?.message
    || 'Erro na API';
}

function unwrapData(raw) {
  if (raw == null) return null;
  if (raw.data !== undefined) return raw.data;
  return raw;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** UX: complementa o outro lado (não é SSOT — backend valida). */
export function complementarRateio(total, editado, valor) {
  const t = round2(total);
  const v = round2(Math.max(0, Number(valor) || 0));
  if (editado === 'empresa') {
    return { valorCliente: round2(Math.max(0, t - v)), valorEmpresa: v };
  }
  return { valorCliente: v, valorEmpresa: round2(Math.max(0, t - v)) };
}

export function percentuaisInformativos(total, cliente, empresa) {
  const t = round2(total);
  if (t <= 0.001) return { pctCliente: 0, pctEmpresa: 0 };
  return {
    pctCliente: round2((round2(cliente) / t) * 100),
    pctEmpresa: round2((round2(empresa) / t) * 100)
  };
}

export function validarSomaRateioUi(total, cliente, empresa) {
  const soma = round2(round2(cliente) + round2(empresa));
  const t = round2(total);
  if (Math.abs(soma - t) > 0.01) {
    return {
      ok: false,
      mensagem: `Cliente + Empresa (${formatMoney(soma)}) deve ser igual ao valor das perdas (${formatMoney(t)}).`
    };
  }
  return { ok: true };
}

function isPrestacaoJaAbertaError(err) {
  const code = String(err?.body?.error?.code || err?.body?.code || '');
  const msg = apiErrorMessage(err).toLowerCase();
  return code === 'PRESTACAO_JA_ABERTA'
    || code === 'COMERCIAL-301'
    || /já está aberta|ja esta aberta|já aberta|ja aberta/.test(msg);
}

async function ensurePrestacaoAberta(consignacaoId) {
  try {
    await window.CDSApi.post(
      `comercial/consignacoes/${consignacaoId}/prestacao/abrir`,
      usuarioPayload()
    );
  } catch (err) {
    if (!isPrestacaoJaAbertaError(err)) throw err;
  }
}

function collapseCardHtml({ id, title, open = false, badge = '', body }) {
  return `
    <section class="cds-collapse cds-card cds-m-enter" data-collapse="${escapeHtml(id)}" data-open="${open ? '1' : '0'}">
      <button type="button" class="cds-collapse__head" data-collapse-toggle aria-expanded="${open ? 'true' : 'false'}">
        <span class="cds-collapse__title">${escapeHtml(title)}</span>
        <span class="cds-collapse__meta">
          ${badge ? `<span class="cds-badge cds-badge--neutral">${escapeHtml(badge)}</span>` : ''}
          ${icon('chevronRight', 'cds-collapse__chevron')}
        </span>
      </button>
      <div class="cds-collapse__body" ${open ? '' : 'hidden'}>
        ${body}
      </div>
    </section>
  `;
}

function bindCollapses(root) {
  root.querySelectorAll('[data-collapse-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const card = btn.closest('[data-collapse]');
      if (!card) return;
      const open = card.getAttribute('data-open') !== '1';
      card.setAttribute('data-open', open ? '1' : '0');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      const body = card.querySelector('.cds-collapse__body');
      if (body) body.hidden = !open;
    });
  });
}

function itemNome(it) {
  return asText(it.produtoNome || it.produto_nome || it.nome || it.produto || `Item #${it.itemId || it.id}`, 'Produto');
}

function itemPreco(it) {
  return numOrZero(it.preco ?? it.precoUnitario ?? it.preco_unitario ?? it.valorUnitario ?? it.precoVenda);
}

function classifyItens(itens = []) {
  const vendidos = [];
  const devolvidos = [];
  const perdas = [];
  (itens || []).forEach((it) => {
    const vendido = numOrZero(it.vendido ?? it.quantidadeVendida ?? it.qtdVendida);
    const devolvido = numOrZero(it.devolvido ?? it.quantidadeDevolvida ?? it.qtdDevolvida);
    const perdido = numOrZero(it.perdido ?? it.quantidadePerdida ?? it.qtdPerdida);
    const preco = itemPreco(it);
    if (vendido > 0) {
      vendidos.push({
        ...it,
        _qtd: vendido,
        _preco: preco,
        _total: round2(vendido * preco)
      });
    }
    if (devolvido > 0) {
      devolvidos.push({
        ...it,
        _qtd: devolvido,
        _motivo: asText(it.motivoDevolucao || it.motivo_devolucao || it.observacao || '', '')
      });
    }
    if (perdido > 0) {
      perdas.push({
        ...it,
        _qtd: perdido,
        _preco: preco,
        _valor: round2(perdido * preco),
        _motivo: asText(it.motivoPerda || it.motivo_perda || it.observacao || '', '')
      });
    }
  });
  return { vendidos, devolvidos, perdas };
}

function lazyListHtml(items, renderRow, { page = 1, listId }) {
  const total = items.length;
  if (!total) return emptyHtml('Nenhum registro');
  const shown = Math.min(total, page * PAGE_SIZE);
  const slice = items.slice(0, shown);
  return `
    <div class="cds-lazy-list" data-lazy="${escapeHtml(listId)}" data-page="${page}" data-total="${total}">
      ${slice.map(renderRow).join('')}
      ${shown < total ? `
        <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary cds-lazy-more" data-lazy-more="${escapeHtml(listId)}" style="width:100%;margin-top:8px">
          Ver mais (${shown}/${total})
        </button>
      ` : ''}
    </div>
  `;
}

function rowVendido(it) {
  return `
    <div class="cds-prestacao-linha">
      <strong>${escapeHtml(itemNome(it))}</strong>
      <div class="cds-prestacao-linha__grid">
        <span>Qtd <b>${escapeHtml(String(it._qtd))}</b></span>
        <span>Unit. <b>${escapeHtml(formatMoney(it._preco))}</b></span>
        <span>Total <b>${escapeHtml(formatMoney(it._total))}</b></span>
      </div>
    </div>
  `;
}

function rowDevolvido(it) {
  return `
    <div class="cds-prestacao-linha">
      <strong>${escapeHtml(itemNome(it))}</strong>
      <div class="cds-prestacao-linha__grid">
        <span>Qtd <b>${escapeHtml(String(it._qtd))}</b></span>
        ${it._motivo ? `<span class="cds-muted">Motivo: ${escapeHtml(it._motivo)}</span>` : ''}
      </div>
    </div>
  `;
}

function rowPerda(it) {
  return `
    <div class="cds-prestacao-linha">
      <strong>${escapeHtml(itemNome(it))}</strong>
      <div class="cds-prestacao-linha__grid">
        <span>Qtd <b>${escapeHtml(String(it._qtd))}</b></span>
        <span>Valor <b>${escapeHtml(formatMoney(it._valor))}</b></span>
        ${it._motivo ? `<span class="cds-muted">Motivo: ${escapeHtml(it._motivo)}</span>` : ''}
      </div>
    </div>
  `;
}

function rateioItemHtml(it) {
  return `
    <div class="cds-rateio-item" data-perda-item="${escapeHtml(String(it.itemId || it.id || ''))}">
      <div class="cds-rateio-item__head">
        <strong>${escapeHtml(itemNome(it))}</strong>
        <span>${escapeHtml(formatMoney(it._valor))}</span>
      </div>
    </div>
  `;
}

function rateioResponsavelHtml(state) {
  const tipo = state.tipoRateio || 'CLIENTE';
  return `
    <p class="cds-muted" style="margin:8px 0">Responsável financeiro</p>
    <div class="cds-rateio-radios" role="radiogroup" aria-label="Responsável pela perda">
      <label><input type="radio" name="rateio-tipo-ui" value="CLIENTE" ${tipo === 'CLIENTE' ? 'checked' : ''}> Cliente</label>
      <label><input type="radio" name="rateio-tipo-ui" value="EMPRESA" ${tipo === 'EMPRESA' ? 'checked' : ''}> Empresa</label>
      <label><input type="radio" name="rateio-tipo-ui" value="COMPARTILHADA" ${tipo === 'COMPARTILHADA' ? 'checked' : ''}> Compartilhado</label>
    </div>
  `;
}

function rateioSharedFieldsHtml(state, totalPerdas) {
  const tipo = state.tipoRateio || 'CLIENTE';
  const compart = tipo === 'COMPARTILHADA';
  const pct = percentuaisInformativos(totalPerdas, state.valorCliente, state.valorEmpresa);
  return `
    <div class="cds-rateio-shared" id="rateio-shared" ${compart ? '' : 'hidden'}>
      <label class="cds-field">
        <span class="cds-field__label">Cliente (R$)</span>
        <input type="number" inputmode="decimal" step="0.01" min="0"
          data-rateio="cliente" value="${Number(state.valorCliente || 0).toFixed(2)}">
      </label>
      <label class="cds-field">
        <span class="cds-field__label">Empresa (R$)</span>
        <input type="number" inputmode="decimal" step="0.01" min="0"
          data-rateio="empresa" value="${Number(state.valorEmpresa || 0).toFixed(2)}">
      </label>
      <div class="cds-rateio-pct">
        <span>Cliente <strong data-pct="cliente">${pct.pctCliente.toFixed(0)}%</strong></span>
        <span>Empresa <strong data-pct="empresa">${pct.pctEmpresa.toFixed(0)}%</strong></span>
      </div>
    </div>
    <div class="cds-rateio-resumo-vals">
      <div><span>Cliente assume</span><strong data-val="cliente">${escapeHtml(formatMoney(state.valorCliente))}</strong></div>
      <div><span>Empresa assume</span><strong data-val="empresa">${escapeHtml(formatMoney(state.valorEmpresa))}</strong></div>
    </div>
    <label class="cds-field" style="margin-top:10px">
      <span class="cds-field__label">Motivo da perda *</span>
      <select data-rateio="motivo">
        <option value="">Selecione…</option>
        ${MOTIVOS.map((m) => `
          <option value="${m.codigo}" ${state.motivoPerda === m.codigo ? 'selected' : ''}>${escapeHtml(m.label)}</option>
        `).join('')}
      </select>
    </label>
    <label class="cds-field" id="rateio-obs-wrap" ${state.motivoPerda === 'OUTRO' ? '' : 'hidden'}>
      <span class="cds-field__label">Observação *</span>
      <textarea data-rateio="observacao" rows="2">${escapeHtml(state.observacaoPerda || '')}</textarea>
    </label>
    <p class="cds-rateio-erro" data-rateio-erro hidden></p>
  `;
}

function resumoFinanceiroHtml(resumo) {
  return `
    <dl class="cds-fin-resumo">
      <div><dt>Venda Total</dt><dd>${escapeHtml(formatMoney(resumo.valorVenda))}</dd></div>
      <div><dt>Recebido</dt><dd>${escapeHtml(formatMoney(resumo.valorRecebido))}</dd></div>
      <div><dt>Perdas</dt><dd>${escapeHtml(formatMoney(resumo.perdas))}</dd></div>
      <div><dt>Cliente Assume</dt><dd>${escapeHtml(formatMoney(resumo.clienteAssume))}</dd></div>
      <div><dt>Empresa Assume</dt><dd>${escapeHtml(formatMoney(resumo.empresaAssume))}</dd></div>
      <div class="is-destaque"><dt>Valor Líquido</dt><dd>${escapeHtml(formatMoney(resumo.valorLiquidoConsignado))}</dd></div>
    </dl>
  `;
}

function applyTipoDefaults(tipo, total) {
  if (tipo === 'EMPRESA') return { valorCliente: 0, valorEmpresa: round2(total) };
  if (tipo === 'COMPARTILHADA') return { valorCliente: round2(total / 2), valorEmpresa: round2(total - round2(total / 2)) };
  return { valorCliente: round2(total), valorEmpresa: 0 };
}

async function loadRateio(consignacaoId) {
  try {
    const raw = await window.CDSApi.get(`comercial/consignacoes/${consignacaoId}/prestacao/rateio-perda`);
    return unwrapData(raw) || {};
  } catch (_e) {
    return null;
  }
}

async function loadBundle(id) {
  const raw = await window.CDSApi.get(`comercial/consignacoes/${id}`);
  let base = unwrapData(raw) || raw || {};
  let itens = Array.isArray(base.itens) ? base.itens : Array.isArray(base.items) ? base.items : [];
  if (!itens.length) {
    try {
      const ir = await window.CDSApi.get(`comercial/consignacoes/${id}/itens`);
      const d = unwrapData(ir);
      itens = Array.isArray(d) ? d : (d?.itens || d?.items || []);
    } catch (_e) { /* ignore */ }
  }

  const settled = await Promise.allSettled([
    window.CDSApi.get('comercial/projections/resumo-prestacao', { consignacaoId: id }),
    window.CDSApi.get(`comercial/consignacoes/${id}/prestacao/resumo-final`).catch(() => null),
    loadRateio(id)
  ]);

  const resumoPrest = normalizeResumoPrestacao(
    settled[0].status === 'fulfilled' ? settled[0].value : null
  );
  const resumoFinal = normalizeResumoPrestacao(
    settled[1].status === 'fulfilled'
      ? (unwrapData(settled[1].value) || settled[1].value)
      : null
  );
  const rateioPayload = settled[2].status === 'fulfilled' ? settled[2].value : null;

  if (resumoPrest?.itens?.length) itens = resumoPrest.itens;

  const c = mapConsignacaoView(base, {
    itens,
    clienteNome: base.clienteNome || base.cliente_nome,
    saldo: resumoPrest?.saldoAtual
  });

  return { c, itens, resumoPrest, resumoFinal, rateioPayload };
}

/** Locator — Comercial > Prestação de Contas */
export async function renderLocator(root) {
  if (!isOperadorComercial() && !canComercialAcerto()) {
    root.innerHTML = `${backBarHtml('Comercial')}${errorHtml('Sem permissão para prestação de contas.', 403)}`;
    bindBack(root);
    return;
  }

  root.innerHTML = loadingHtml('Carregando prestações…');
  try {
    await flushComercialOfflineQueue();
    const raw = await window.CDSApi.get('comercial/consignacoes', { pageSize: 100 });
    const data = unwrapData(raw) || raw;
    const lista = Array.isArray(data) ? data : (data?.items || data?.consignacoes || []);
    const elegiveis = lista.filter((c) => {
      const s = String(c.status || c.situacao || '').toUpperCase();
      return /ENTREGUE|PRESTACAO|ACERT|EM_PRESTACAO|ABERTA/.test(s) || s === 'ENTREGUE';
    });

    const pendingBadge = countPending() > 0
      ? `<p class="cds-mobile-banner">${icon('warning')} ${countPending()} operação(ões) pendente(s) de sincronização</p>`
      : '';

    root.innerHTML = `
      <div class="cds-prestacao-locator cds-m-enter">
        ${backBarHtml('Comercial')}
        <h2 class="cds-section-head__title" style="margin:8px 0">Prestação de Contas</h2>
        <p class="cds-muted" style="margin-top:0">Comercial → Consignação → Prestação</p>
        ${pendingBadge}
        ${searchBarHtml('Buscar cliente ou documento', 'prestacao-filter')}
        <p class="cds-muted" id="prestacao-count">${escapeHtml(countLabel(elegiveis.length, 'consignação', 'consignações'))}</p>
        <div id="prestacao-list">
          ${elegiveis.length
            ? elegiveis.slice(0, 50).map((c) => listCardHtml({
                go: `comercial/${c.id || c.consignacao_id}/prestacao`,
                title: asText(formatDocumento(c.documento, c.id), `Consignação #${c.id}`),
                subtitle: asText(c.clienteNome || c.cliente_nome || c.cliente || 'Cliente'),
                status: c.status || c.situacao,
                meta: [formatDate(c.dataEntrega || c.data_entrega || c.updatedAt || c.created_at)].filter((x) => x !== '—'),
                value: countPending(c.id) ? 'Pendente sync' : undefined
              })).join('')
            : emptyHtml('Nenhuma consignação elegível', 'Entregue consignações para prestar contas.')}
        </div>
      </div>
    `;

    bindBack(root);
    bindGo(root);

    root.querySelector('#prestacao-filter')?.addEventListener('input', debounce((e) => {
      const q = String(e.target.value || '').trim().toLowerCase();
      const filtered = elegiveis.filter((c) => {
        const blob = `${c.clienteNome || ''} ${c.cliente_nome || ''} ${formatDocumento(c.documento, c.id)} ${c.id}`.toLowerCase();
        return !q || blob.includes(q);
      });
      const list = root.querySelector('#prestacao-list');
      const count = root.querySelector('#prestacao-count');
      if (count) count.textContent = countLabel(filtered.length, 'consignação', 'consignações');
      if (list) {
        list.innerHTML = filtered.length
          ? filtered.slice(0, 50).map((c) => listCardHtml({
              go: `comercial/${c.id || c.consignacao_id}/prestacao`,
              title: asText(formatDocumento(c.documento, c.id), `Consignação #${c.id}`),
              subtitle: asText(c.clienteNome || c.cliente_nome || c.cliente || 'Cliente'),
              status: c.status || c.situacao
            })).join('')
          : emptyHtml('Nenhum resultado');
        bindGo(list);
      }
    }, 200));
  } catch (err) {
    root.innerHTML = `${backBarHtml('Comercial')}${errorHtml(apiErrorMessage(err), err.status)}`;
    bindBack(root);
  }
}

/** Detalhe — cards recolhíveis + rateio + finalizar */
export async function renderPrestacaoContas(root, id) {
  if (!isOperadorComercial() && !canComercialAcerto()) {
    root.innerHTML = `${backBarHtml('Prestações')}${errorHtml('Sem permissão.', 403)}`;
    bindBack(root);
    return;
  }

  root.innerHTML = loadingHtml('Carregando prestação…');

  try {
    await ensurePrestacaoAberta(id);
    const { c, itens, resumoPrest, resumoFinal, rateioPayload } = await loadBundle(id);
    const classified = classifyItens(itens);
    const totalPerdasApi = round2(
      rateioPayload?.totais?.totalPerdido
      ?? rateioPayload?.rateio?.valorTotalPerdas
      ?? classified.perdas.reduce((s, p) => s + p._valor, 0)
    );

    const rateio = rateioPayload?.rateio || {};
    const tipoInicial = String(rateio.tipoRateio || 'CLIENTE').toUpperCase();
    const defaults = applyTipoDefaults(tipoInicial, totalPerdasApi);
    const state = {
      tipoRateio: tipoInicial,
      valorCliente: rateio.valorCliente != null ? round2(rateio.valorCliente) : defaults.valorCliente,
      valorEmpresa: rateio.valorEmpresa != null ? round2(rateio.valorEmpresa) : defaults.valorEmpresa,
      motivoPerda: rateio.motivoPerda || '',
      observacaoPerda: rateio.observacaoPerda || ''
    };

    const finApi = rateioPayload?.resumoFinanceiro || {};
    const resumoFin = {
      valorVenda: round2(finApi.valorVenda ?? resumoPrest?.valorVenda ?? resumoFinal?.valorVenda ?? 0),
      valorRecebido: round2(finApi.valorRecebido ?? resumoPrest?.valorRecebido ?? resumoFinal?.valorRecebido ?? 0),
      perdas: round2(finApi.perdas ?? totalPerdasApi),
      clienteAssume: round2(finApi.clienteAssume ?? state.valorCliente),
      empresaAssume: round2(finApi.empresaAssume ?? state.valorEmpresa),
      valorLiquidoConsignado: round2(
        finApi.valorLiquidoConsignado
        ?? (round2(finApi.valorVenda ?? resumoPrest?.valorVenda ?? 0)
          + round2(state.valorCliente)
          - round2(finApi.valorRecebido ?? resumoPrest?.valorRecebido ?? 0))
      )
    };

    const pending = countPending(id);
    const syncBanner = pending
      ? `<div class="cds-mobile-banner">${icon('warning')} Pendente de Sincronização (${pending})</div>`
      : (!isOnline() ? `<div class="cds-mobile-banner">${icon('warning')} Offline — alterações serão enfileiradas</div>` : '');

    const rateioBody = classified.perdas.length
      ? `
        <p class="cds-muted">Perda total: <strong>${escapeHtml(formatMoney(totalPerdasApi))}</strong></p>
        ${classified.perdas.map((it) => rateioItemHtml(it)).join('')}
        ${rateioResponsavelHtml(state)}
        ${rateioSharedFieldsHtml(state, totalPerdasApi)}
        <p class="cds-muted" style="font-size:12px;margin-top:8px">
          Rateio da prestação via API oficial (RC4.2). Validação no backend.
        </p>
      `
      : emptyHtml('Sem perdas registradas', 'Registre perdas na grade de retornos.');

    root.innerHTML = `
      <div class="cds-prestacao-contas cds-m-enter" data-consignacao-id="${escapeHtml(String(id))}" data-total-perdas="${totalPerdasApi}">
        ${backBarHtml('Prestações')}
        <div class="cds-prestacao-contas__actions">
          <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" data-go="comercial/${escapeHtml(String(id))}/prestacao/grade" style="width:100%">
            ${icon('edit')} Ajustar quantidades (grade)
          </button>
        </div>
        ${syncBanner}

        ${collapseCardHtml({
          id: 'resumo',
          title: 'Resumo',
          open: true,
          body: `
            <div class="cds-row"><span>Cliente</span><strong>${escapeHtml(asText(c.clienteNome || c.cliente, '—'))}</strong></div>
            <div class="cds-row"><span>Data</span><strong>${escapeHtml(formatDate(c.dataEntrega || c.data_entrega || c.updatedAt || c.createdAt))}</strong></div>
            <div class="cds-row"><span>Rota</span><strong>${escapeHtml(asText(c.rota || c.rotaNome || c.rota_nome, '—'))}</strong></div>
            <div class="cds-row"><span>Vendedor</span><strong>${escapeHtml(asText(c.vendedor || c.vendedorNome || c.usuarioNome || c.operador, '—'))}</strong></div>
            <div class="cds-row"><span>Situação</span>${statusBadgeHtml(c.status || c.situacao)}</div>
          `
        })}

        ${collapseCardHtml({
          id: 'vendidos',
          title: 'Produtos Vendidos',
          badge: String(classified.vendidos.length),
          body: lazyListHtml(classified.vendidos, rowVendido, { listId: 'vendidos' })
        })}

        ${collapseCardHtml({
          id: 'devolvidos',
          title: 'Produtos Devolvidos',
          badge: String(classified.devolvidos.length),
          body: lazyListHtml(classified.devolvidos, rowDevolvido, { listId: 'devolvidos' })
        })}

        ${collapseCardHtml({
          id: 'perdas',
          title: 'Perdas',
          badge: String(classified.perdas.length),
          open: classified.perdas.length > 0,
          body: lazyListHtml(classified.perdas, rowPerda, { listId: 'perdas' })
        })}

        ${collapseCardHtml({
          id: 'rateio',
          title: 'Rateio das Perdas',
          open: classified.perdas.length > 0,
          body: rateioBody
        })}

        ${collapseCardHtml({
          id: 'financeiro',
          title: 'Resumo Financeiro',
          open: true,
          body: `<div id="fin-resumo-host">${resumoFinanceiroHtml(resumoFin)}</div>`
        })}

        <div class="cds-prestacao-dock cds-prestacao-dock--finalizar">
          <button type="button" class="cds-mobile-btn" id="btn-finalizar-prestacao" style="width:100%">
            ${icon('check')} Finalizar Prestação
          </button>
        </div>
      </div>
    `;

    bindBack(root);
    bindGo(root);
    bindCollapses(root);
    bindLazyMore(root, {
      vendidos: classified.vendidos,
      devolvidos: classified.devolvidos,
      perdas: classified.perdas
    });
    bindRateioUi(root, state, totalPerdasApi, resumoFin);
    bindFinalizar(root, id, state, totalPerdasApi);

    bindOfflineAutoSync({
      onDone: (r) => {
        if (r.synced > 0) showToast(`${r.synced} operação(ões) sincronizada(s).`, 'success');
      }
    });
  } catch (err) {
    root.innerHTML = `${backBarHtml('Prestações')}${errorHtml(apiErrorMessage(err), err.status)}`;
    bindBack(root);
    showToast(apiErrorMessage(err) || 'Erro ao carregar prestação', 'error');
  }
}

function bindLazyMore(root, maps) {
  root.querySelectorAll('[data-lazy-more]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const listId = btn.getAttribute('data-lazy-more');
      const host = root.querySelector(`[data-lazy="${listId}"]`);
      if (!host) return;
      const page = Number(host.getAttribute('data-page') || 1) + 1;
      const items = maps[listId] || [];
      const render = listId === 'vendidos' ? rowVendido : listId === 'devolvidos' ? rowDevolvido : rowPerda;
      host.outerHTML = lazyListHtml(items, render, { page, listId });
      bindLazyMore(root, maps);
    });
  });
}

function syncRateioDom(root, state, total) {
  const pct = percentuaisInformativos(total, state.valorCliente, state.valorEmpresa);
  const pctC = root.querySelector('[data-pct="cliente"]');
  const pctE = root.querySelector('[data-pct="empresa"]');
  if (pctC) pctC.textContent = `${pct.pctCliente.toFixed(0)}%`;
  if (pctE) pctE.textContent = `${pct.pctEmpresa.toFixed(0)}%`;
  const valC = root.querySelector('[data-val="cliente"]');
  const valE = root.querySelector('[data-val="empresa"]');
  if (valC) valC.textContent = formatMoney(state.valorCliente);
  if (valE) valE.textContent = formatMoney(state.valorEmpresa);

  const shared = root.querySelector('#rateio-shared');
  if (shared) shared.hidden = state.tipoRateio !== 'COMPARTILHADA';

  const inpC = root.querySelector('[data-rateio="cliente"]');
  const inpE = root.querySelector('[data-rateio="empresa"]');
  if (inpC && document.activeElement !== inpC) inpC.value = Number(state.valorCliente || 0).toFixed(2);
  if (inpE && document.activeElement !== inpE) inpE.value = Number(state.valorEmpresa || 0).toFixed(2);

  root.querySelectorAll('input[name="rateio-tipo-ui"]').forEach((el) => {
    el.checked = el.value === state.tipoRateio;
  });

  const finHost = root.querySelector('#fin-resumo-host');
  if (finHost && state._finSnap) {
    state._finSnap.clienteAssume = state.valorCliente;
    state._finSnap.empresaAssume = state.valorEmpresa;
    state._finSnap.perdas = total;
    state._finSnap.valorLiquidoConsignado = round2(
      state._finSnap.valorVenda + state.valorCliente - state._finSnap.valorRecebido
    );
    finHost.innerHTML = resumoFinanceiroHtml(state._finSnap);
  }
}

function bindRateioUi(root, state, totalPerdas, resumoFin) {
  state._finSnap = { ...resumoFin };

  root.querySelectorAll('input[name="rateio-tipo-ui"]').forEach((el) => {
    el.addEventListener('change', () => {
      if (!el.checked) return;
      state.tipoRateio = el.value;
      const d = applyTipoDefaults(state.tipoRateio, totalPerdas);
      state.valorCliente = d.valorCliente;
      state.valorEmpresa = d.valorEmpresa;
      // sync all radios with same name across items
      root.querySelectorAll('input[name="rateio-tipo-ui"]').forEach((r) => {
        r.checked = r.value === state.tipoRateio;
      });
      syncRateioDom(root, state, totalPerdas);
    });
  });

  root.querySelector('[data-rateio="cliente"]')?.addEventListener('input', (e) => {
    const next = complementarRateio(totalPerdas, 'cliente', e.target.value);
    state.valorCliente = next.valorCliente;
    state.valorEmpresa = next.valorEmpresa;
    syncRateioDom(root, state, totalPerdas);
  });

  root.querySelector('[data-rateio="empresa"]')?.addEventListener('input', (e) => {
    const next = complementarRateio(totalPerdas, 'empresa', e.target.value);
    state.valorCliente = next.valorCliente;
    state.valorEmpresa = next.valorEmpresa;
    syncRateioDom(root, state, totalPerdas);
  });

  root.querySelector('[data-rateio="motivo"]')?.addEventListener('change', (e) => {
    state.motivoPerda = e.target.value;
    const wrap = root.querySelector('#rateio-obs-wrap');
    if (wrap) wrap.hidden = String(e.target.value).toUpperCase() !== 'OUTRO';
  });

  root.querySelector('[data-rateio="observacao"]')?.addEventListener('input', (e) => {
    state.observacaoPerda = e.target.value;
  });
}

function lerPayloadRateio(root, state, totalPerdas) {
  const tipo = root.querySelector('input[name="rateio-tipo-ui"]:checked')?.value || state.tipoRateio || 'CLIENTE';
  let valorCliente = state.valorCliente;
  let valorEmpresa = state.valorEmpresa;
  if (tipo === 'COMPARTILHADA') {
    valorCliente = Number(root.querySelector('[data-rateio="cliente"]')?.value || 0);
    valorEmpresa = Number(root.querySelector('[data-rateio="empresa"]')?.value || 0);
  } else {
    const d = applyTipoDefaults(tipo, totalPerdas);
    valorCliente = d.valorCliente;
    valorEmpresa = d.valorEmpresa;
  }
  return {
    tipoRateio: tipo,
    valorCliente: round2(valorCliente),
    valorEmpresa: round2(valorEmpresa),
    campoEditado: tipo === 'COMPARTILHADA' ? 'cliente' : null,
    motivoPerda: root.querySelector('[data-rateio="motivo"]')?.value || state.motivoPerda || null,
    observacaoPerda: root.querySelector('[data-rateio="observacao"]')?.value || state.observacaoPerda || null
  };
}

function bindFinalizar(root, id, state, totalPerdas) {
  root.querySelector('#btn-finalizar-prestacao')?.addEventListener('click', async () => {
    const erroEl = root.querySelector('[data-rateio-erro]');
    const payload = lerPayloadRateio(root, state, totalPerdas);

    if (totalPerdas > 0.01) {
      const soma = validarSomaRateioUi(totalPerdas, payload.valorCliente, payload.valorEmpresa);
      if (!soma.ok) {
        if (erroEl) {
          erroEl.hidden = false;
          erroEl.textContent = soma.mensagem;
        }
        showToast(soma.mensagem, 'warning');
        return;
      }
      if (!payload.motivoPerda) {
        const msg = 'Informe o motivo da perda.';
        if (erroEl) { erroEl.hidden = false; erroEl.textContent = msg; }
        showToast(msg, 'warning');
        return;
      }
      if (payload.motivoPerda === 'OUTRO' && !String(payload.observacaoPerda || '').trim()) {
        const msg = 'Observação obrigatória quando o motivo é Outro.';
        if (erroEl) { erroEl.hidden = false; erroEl.textContent = msg; }
        showToast(msg, 'warning');
        return;
      }
    }
    if (erroEl) erroEl.hidden = true;

    const ok = await confirmSheet({
      title: 'Finalizar Prestação',
      message: totalPerdas > 0.01
        ? 'Salvar rateio das perdas e encerrar a prestação de contas?'
        : 'Encerrar a prestação de contas?',
      confirmLabel: 'Finalizar'
    });
    if (!ok) return;

    const btn = root.querySelector('#btn-finalizar-prestacao');
    if (btn) btn.setAttribute('aria-busy', 'true');

    const rateioBody = usuarioPayload(payload);
    const fecharBody = usuarioPayload();
    const rateioPath = `comercial/consignacoes/${id}/prestacao/rateio-perda`;
    const fecharPath = `comercial/consignacoes/${id}/prestacao/fechar`;

    try {
      if (!isOnline()) {
        if (totalPerdas > 0.01) {
          enqueueOffline({
            consignacaoId: id,
            method: 'put',
            path: rateioPath,
            body: rateioBody,
            label: 'Rateio da perda'
          });
        }
        enqueueOffline({
          consignacaoId: id,
          method: 'post',
          path: fecharPath,
          body: fecharBody,
          label: 'Finalizar prestação'
        });
        showToast('Salvo localmente — Pendente de Sincronização', 'warning');
        window.CDSMobile?.navigate?.(`comercial/${id}`, { replace: true });
        return;
      }

      if (totalPerdas > 0.01) {
        await window.CDSApi.put(rateioPath, rateioBody);
      }
      await window.CDSApi.post(fecharPath, fecharBody);
      showToast('Prestação finalizada.', 'success');
      window.CDSMobile?.navigate?.(`comercial/${id}`, { replace: true });
    } catch (err) {
      // Rede falhou no meio — enfileira
      if (err?.status === 0 || err?.status === 408) {
        if (totalPerdas > 0.01) {
          enqueueOffline({ consignacaoId: id, method: 'put', path: rateioPath, body: rateioBody, label: 'Rateio' });
        }
        enqueueOffline({ consignacaoId: id, method: 'post', path: fecharPath, body: fecharBody, label: 'Finalizar' });
        showToast('Sem conexão. Marcado como Pendente de Sincronização.', 'warning');
        window.CDSMobile?.navigate?.(`comercial/${id}`, { replace: true });
        return;
      }
      showToast(apiErrorMessage(err), 'error');
    } finally {
      if (btn) btn.removeAttribute('aria-busy');
    }
  });
}

export async function render(root, parsed) {
  const sub = parsed?.parts?.[1];
  const sub2 = parsed?.parts?.[2];
  const sub3 = parsed?.parts?.[3];

  // #/comercial/prestacao
  if (sub === 'prestacao' && !sub2) {
    return renderLocator(root);
  }
  // #/comercial/:id/prestacao/grade → handled by caller
  if (sub && sub2 === 'prestacao' && sub3 === 'grade') {
    return { delegateGrade: true, id: sub };
  }
  // #/comercial/:id/prestacao
  if (sub && sub2 === 'prestacao') {
    return renderPrestacaoContas(root, sub);
  }
  return renderLocator(root);
}

export default {
  render,
  renderLocator,
  renderPrestacaoContas,
  complementarRateio,
  percentuaisInformativos,
  validarSomaRateioUi
};
