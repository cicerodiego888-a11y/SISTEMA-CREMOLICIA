/**
 * CDS Mobile — Comercial (Motor Comercial oficial)
 * Inclusão de itens alinhada ao ERP Desktop (NovaConsignacao / LIP).
 */
import {
  escapeHtml,
  asText,
  formatMoney,
  formatNumber,
  formatDate,
  loadingHtml,
  emptyHtml,
  errorHtml,
  listCardHtml,
  kpiHtml,
  sectionTitleHtml,
  statusBadgeHtml,
  searchBarHtml,
  backBarHtml,
  bindBack,
  bindGo,
  countLabel,
  debounce,
  icon
} from '../ui.js';
import {
  fieldHtml,
  formCardHtml,
  collectForm,
  fabHtml,
  actionBarHtml,
  confirmDanger,
  currentUserId,
  unwrapList,
  promptSheet,
  confirmSheet,
  qtyControlHtml,
  bindQtyControls,
  parseQty,
  openBottomSheet,
  closeBottomSheet
} from '../forms.js';
import {
  canCreateComercial,
  isOperadorComercial,
  canComercialAcerto,
  canComercialContaCorrente,
  canDoAction
} from '../permissions.js';
import { showToast } from '../toast.js';
import { sharePayload, shareTextAsFile, openWhatsApp } from '../native.js';
import {
  fetchDanfeHtml,
  montarHtmlCupomNaoFiscal,
  mostrarCupomNoCelular,
  mostrarCupomAposEmissao
} from '../cupom.js';
/** Encerrar prestação após NFC-e (não recria venda — a NFC-e já gerou). */
async function encerrarPrestacaoAposNfce(consignacaoId) {
  const opts = { timeoutMs: 120000 };
  try {
    await window.CDSApi.post(
      `comercial/consignacoes/${consignacaoId}/prestacao/fechar`,
      usuarioPayload(),
      null,
      opts
    );
    return { ok: true, modo: 'fechar' };
  } catch (errFechar) {
    try {
      await window.CDSApi.post(
        `comercial/consignacoes/${consignacaoId}/prestacao/finalizar-venda-oficial`,
        usuarioPayload({ emitirFiscal: false, fechar: true }),
        null,
        opts
      );
      return { ok: true, modo: 'finalizar' };
    } catch (errFinalize) {
      try {
        const raw = await window.CDSApi.get(`comercial/consignacoes/${consignacaoId}`);
        const c = unwrapEntity(raw);
        const st = String(c?.status || '').toUpperCase();
        if (isStatusConsignacaoFinalizada(st)) {
          return { ok: true, recuperado: true, modo: 'ja_encerrada' };
        }
      } catch (_e) { /* ignore */ }
      const e = errFechar || errFinalize;
      e.originalFinalize = errFinalize;
      throw e;
    }
  }
}

async function emitirNfceEEncerrar(consignacaoId, { clienteNome = '' } = {}) {
  const raw = await window.CDSApi.post(
    `comercial/consignacoes/${consignacaoId}/prestacao/emitir-nfce`,
    usuarioPayload(),
    null,
    { timeoutMs: 180000 }
  );
  const cupom = await mostrarCupomAposEmissao(raw, { clienteNome });
  const deveEncerrar = cupom?.tipo === 'fiscal'
    || cupom?.tipo === 'nao_fiscal'
    || cupom?.tipo === 'nao_aplicavel'
    || cupom?.tipo === 'indisponivel';

  if (!deveEncerrar) {
    return { cupom, encerrada: false };
  }

  try {
    await encerrarPrestacaoAposNfce(consignacaoId);
    showToast('Prestação encerrada automaticamente após a NFC-e.', 'success');
    return { cupom, encerrada: true };
  } catch (err) {
    showToast(
      apiErrorMessage(err) || 'NFC-e ok, mas não foi possível encerrar automaticamente. Use Encerrar.',
      'warning'
    );
    return { cupom, encerrada: false, erroEncerrar: err };
  }
}
import {
  mapConsignacaoView,
  resolveClienteLabel,
  normalizeResumoPrestacao,
  normalizeSituacaoCliente,
  buildClienteProfileView,
  preferPerfilConsignado,
  perfilLimiteOf,
  deriveComercialPhase,
  badgeStatusConsignacao,
  isConsignacaoAbertaOperacional,
  isStatusConsignacaoFinalizada,
  historicoItems,
  contaCorrenteItems,
  contaCorrenteTotais,
  pendenciasItems,
  numFromApi,
  formatDocumento
} from '../comercial-mappers.js';

function unwrapEntity(payload) {
  if (!payload) return null;
  if (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) {
    return payload.data.consignacao || payload.data;
  }
  return payload.consignacao || payload;
}

/** Extrai itens de GET consignações/:id ou /itens (StandardResponse). */
function unwrapItens(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  const candidates = [
    payload.itens,
    payload.items,
    payload.data?.itens,
    payload.data?.items,
    Array.isArray(payload.data) ? payload.data : null
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) return c;
  }
  return unwrapList(payload);
}

function clienteLabel(c, extras = {}) {
  return resolveClienteLabel(c, extras);
}

function valorConsignacaoOf(c) {
  const status = String(c?.status || c?.situacao || '').toUpperCase();
  if (status === 'RASCUNHO') return null;
  const n = Number(
    c?.valorExibido ??
      c?.valorTotalEntregue ??
      c?.valor_total ??
      c?.valorTotal ??
      c?.total ??
      0
  );
  return Number.isFinite(n) ? n : 0;
}

function valorListaDisplay(c) {
  const status = String(c?.status || c?.situacao || '').toUpperCase();
  if (status === 'RASCUNHO' || valorConsignacaoOf(c) == null) {
    return '—';
  }
  return formatMoney(valorConsignacaoOf(c) || (c.saldo ?? 0));
}

function saldoConsignacaoOf(c, resumoPrest) {
  return Number(
    resumoPrest?.saldoAtual ??
      c?.saldoExibido ??
      c?.saldoAberto ??
      c?.saldo_aberto ??
      c?.saldo ??
      0
  );
}

/** Carrega bundle igual operacional.js carregarConsignacaoCompleta (APIs oficiais). */
async function carregarConsignacaoCompleta(id) {
  const raw = await window.CDSApi.get(`comercial/consignacoes/${id}`);
  let base = unwrapEntity(raw) || {};

  let itens = Array.isArray(base.itens) ? base.itens : Array.isArray(base.items) ? base.items : [];
  if (!itens.length) {
    try {
      const itensRaw = await window.CDSApi.get(`comercial/consignacoes/${id}/itens`);
      itens = unwrapItens(itensRaw);
    } catch (e) { /* ignore */ }
  }

  const clienteId = base.clienteId ?? base.cliente_id;
  const settled = await Promise.allSettled([
    clienteId
      ? window.CDSApi.get('comercial/projections/situacao-cliente', { clienteId })
      : Promise.resolve(null),
    window.CDSApi.get('comercial/projections/resumo-prestacao', { consignacaoId: id }),
    window.CDSApi.get(`comercial/consignacoes/${id}/prestacao/resumo-final`),
    window.CDSApi.get('comercial/projections/historico', { consignacaoId: id, limite: 25 }),
    clienteId
      ? window.CDSApi.get('comercial/projections/conta-corrente', { clienteId, consignacaoId: id })
      : Promise.resolve(null),
    clienteId
      ? window.CDSApi.get('comercial/projections/pendencias', { clienteId, consignacaoId: id })
      : Promise.resolve(null)
  ]);

  const [sitR, prestR, finalR, histR, ccR, pendR] = settled;
  const situacao = sitR.status === 'fulfilled' ? normalizeSituacaoCliente(sitR.value) : null;
  const resumoPrestRaw = prestR.status === 'fulfilled' ? prestR.value : null;
  const resumoFinalRaw = finalR.status === 'fulfilled' ? finalR.value : null;
  const historico = histR.status === 'fulfilled' ? historicoItems(histR.value) : [];
  const contaCorrente = ccR.status === 'fulfilled' ? contaCorrenteItems(ccR.value) : [];
  const ccTotais = ccR.status === 'fulfilled' ? contaCorrenteTotais(ccR.value) : null;
  const pendencias = pendR.status === 'fulfilled' ? pendenciasItems(pendR.value) : [];

  const resumoPrest = normalizeResumoPrestacao(resumoPrestRaw);
  const resumoFinal = normalizeResumoPrestacao(
    unwrapEntity(resumoFinalRaw) || resumoFinalRaw?.data || resumoFinalRaw
  );

  if (resumoPrest?.itens?.length && !itens.length) {
    itens = resumoPrest.itens;
  }

  const clienteProfile = buildClienteProfileView(
    { id: clienteId, nome: base.clienteNome || base.cliente_nome },
    situacao?.perfil || { id: base.perfilComercialId, perfilTipo: base.consignado },
    situacao
  );

  const c = mapConsignacaoView(base, {
    itens,
    clienteNome: situacao?.clienteNome ?? clienteProfile.nome,
    perfilNome: clienteProfile.perfilNome || base.consignado,
    saldo: resumoPrest?.saldoAtual ?? situacao?.saldoEmAberto ?? situacao?.saldoDevedor,
    valor: base.valorTotalEntregue ?? base.valor_total
  });

  const phase = deriveComercialPhase(c, resumoPrest, resumoFinal);

  return {
    c,
    itens,
    situacao,
    clienteProfile,
    resumoPrest,
    resumoFinal,
    historico,
    contaCorrente,
    ccTotais,
    pendencias,
    phase
  };
}

/** Mesmas APIs do Desktop NovaConsignacao._applyClientePerfil + consultas auxiliares. */
async function carregarContextoClienteComercial(cliente) {
  const clienteId = cliente?.id;
  if (!clienteId) {
    return { perfis: [], situacao: null, profile: null, contaCorrente: [], ccTotais: null, pendencias: [] };
  }

  const settled = await Promise.allSettled([
    window.CDSApi.get('comercial/perfil-comercial', { clienteId, ativo: true }),
    window.CDSApi.get('comercial/projections/situacao-cliente', { clienteId }),
    window.CDSApi.get('comercial/projections/conta-corrente', { clienteId }),
    window.CDSApi.get('comercial/projections/pendencias', { clienteId })
  ]);

  const [perfR, sitR, ccR, pendR] = settled;
  const perfis = perfR.status === 'fulfilled' ? unwrapList(perfR.value?.data || perfR.value) : [];
  const situacao = sitR.status === 'fulfilled' ? normalizeSituacaoCliente(sitR.value) : null;
  const contaCorrente = ccR.status === 'fulfilled' ? contaCorrenteItems(ccR.value) : [];
  const ccTotais = ccR.status === 'fulfilled' ? contaCorrenteTotais(ccR.value) : null;
  const pendencias = pendR.status === 'fulfilled' ? pendenciasItems(pendR.value) : [];
  const perfilPreferido = preferPerfilConsignado(perfis);
  const profile = buildClienteProfileView(cliente, perfilPreferido, situacao);

  return {
    perfis,
    situacao,
    profile,
    perfilPreferido,
    contaCorrente,
    ccTotais,
    pendencias,
    errors: settled.filter((r) => r.status === 'rejected').map((r) => r.reason)
  };
}

function moneyApi(v) {
  const n = numFromApi(v);
  return n == null ? '—' : formatMoney(n);
}

function hasText(v) {
  const s = String(v ?? '').trim();
  return !!s && s !== '—' && s !== '-' && s !== '.';
}

/** Linha só se houver valor real (evita cards vazios). */
function rowIf(label, value, { money = false } = {}) {
  if (money) {
    const n = numFromApi(value);
    if (n == null) return '';
    return `<div class="cds-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(formatMoney(n))}</strong></div>`;
  }
  if (!hasText(value)) return '';
  return `<div class="cds-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(asText(value))}</strong></div>`;
}

/**
 * Resumo financeiro operacional (Desktop CreditoComercial) — sem CC/histórico na área principal.
 */
function resumoFinanceiroHtml(profile, { pendencias = [], compact = false } = {}) {
  if (!profile) return '';
  const pendCount = Array.isArray(pendencias) ? pendencias.length : 0;
  const rows = [
    rowIf('Limite', profile.limiteComercial, { money: true }),
    rowIf('Crédito disponível', profile.creditoDisponivel, { money: true }),
    rowIf('Crédito utilizado', profile.creditoUtilizado, { money: true }),
    pendCount > 0
      ? `<div class="cds-row"><span>Pendências</span><strong class="cds-text-danger">${escapeHtml(String(pendCount))}</strong></div>`
      : '',
    !compact ? rowIf('Situação', profile.situacao) : ''
  ].filter(Boolean);

  if (!rows.length) return '';

  return `
    <article class="cds-card cds-resumo-financeiro cds-m-enter">
      <h3 class="cds-card__title">${compact ? 'Crédito' : 'Resumo financeiro'}</h3>
      ${rows.join('')}
      ${pendCount > 0 && !compact ? `
        <div class="cds-cliente-pendencias cds-cliente-pendencias--compact">
          ${pendencias.slice(0, 3).map((p) => `
            <p class="cds-muted cds-pend-line">${escapeHtml(asText(p.titulo || p.tipo || p.mensagem || p.descricao, 'Pendência'))}${
              p.valor != null ? ` · ${escapeHtml(formatMoney(p.valor))}` : ''
            }</p>
          `).join('')}
        </div>
      ` : ''}
    </article>
  `;
}

function historicoSheetBody(historico = []) {
  if (!historico.length) {
    return `<p class="cds-muted" style="margin:0">Sem histórico retornado pelo Motor Comercial.</p>`;
  }
  return historico.slice(0, 20).map((h) => {
    const titulo = asText(h.tipo || h.evento || h.acao || h.descricao, '');
    if (!hasText(titulo)) return '';
    const data = formatDate(h.data || h.created_at || h.timestamp);
    const valor = numFromApi(h.valor);
    return `
      <div class="cds-row" style="margin-bottom:10px;align-items:flex-start">
        <span>
          <strong>${escapeHtml(titulo)}</strong><br>
          <span class="cds-muted">${escapeHtml(data)}${hasText(h.usuario || h.usuarioNome) ? ` · ${escapeHtml(asText(h.usuario || h.usuarioNome))}` : ''}</span>
        </span>
        ${valor != null ? `<strong>${escapeHtml(formatMoney(valor))}</strong>` : ''}
      </div>
    `;
  }).filter(Boolean).join('') || `<p class="cds-muted" style="margin:0">Sem eventos com conteúdo.</p>`;
}

function openHistoricoSheet(historico) {
  openBottomSheet({
    title: 'Histórico comercial',
    bodyHtml: historicoSheetBody(historico),
    actionsHtml: `<button type="button" class="cds-mobile-btn" data-sheet-close>Fechar</button>`
  });
}

function usuarioPayload(extra = {}) {
  const uid = currentUserId();
  return {
    ...extra,
    usuarioId: uid != null ? Number(uid) : uid
  };
}

async function registrarEntregaConsignacao(consignacaoId) {
  try {
    await window.CDSApi.post(
      `comercial/consignacoes/${consignacaoId}/entrega`,
      usuarioPayload(),
      null,
      { timeoutMs: 120000 }
    );
    return { ok: true, recuperado: false };
  } catch (err) {
    try {
      const raw = await window.CDSApi.get(`comercial/consignacoes/${consignacaoId}`);
      const c = unwrapEntity(raw);
      const st = String(c?.status || '').toUpperCase();
      if (st === 'ENTREGUE') return { ok: true, recuperado: true, erroOriginal: err };
    } catch (_e) { /* mantém o erro da entrega */ }
    throw err;
  }
}

/** Step de incremento: produtos por peso usam 0,001 (paridade Desktop). */
function qtyStepForUnidade(un) {
  const u = String(un || '').toUpperCase().trim();
  if (/^(KG|G|GR|GRAM|KILO|KILOS)$/.test(u) || /PESO|KILO|GRAM/.test(u)) return 0.001;
  return 1;
}

function isPesoUnidade(un) {
  return qtyStepForUnidade(un) < 1;
}

/** Qty inicial inteligente: UN=1 · KG/PESO=0,000 */
function defaultQtyDisplay(un) {
  return isPesoUnidade(un) ? '0,000' : '1';
}

function produtoFromCard(card) {
  if (!card) return null;
  return {
    produtoId: Number(card.getAttribute('data-pid')),
    precoUnitario: Number(card.getAttribute('data-preco')),
    unidade: card.getAttribute('data-unidade') || 'UN',
    nome: card.getAttribute('data-nome') || 'Produto'
  };
}

/** Card de produto — qty inteligente + Enter adiciona. */
function produtoPickCardHtml(p) {
  const un = asText(p.unidade || p.unidade_medida || 'UN', 'UN');
  const preco = Number(p.preco_venda ?? p.preco ?? p.precoVenda ?? 0);
  const nome = asText(p.nome || p.descricao);
  const step = qtyStepForUnidade(un);
  const min = 0.001;
  const qtyValue = defaultQtyDisplay(un);
  return `
    <article class="cds-list-card cds-list-card--static cds-prod-pick" data-pid="${escapeHtml(p.id)}"
      data-preco="${escapeHtml(preco)}"
      data-unidade="${escapeHtml(un)}"
      data-nome="${escapeHtml(nome)}">
      <div class="cds-list-card__main">
        <h3 class="cds-list-card__title">${escapeHtml(nome)}</h3>
        <p class="cds-list-card__subtitle">${escapeHtml(formatMoney(preco))}/${escapeHtml(un)}${p.codigo || p.codigo_barras ? ` · ${escapeHtml(asText(p.codigo || p.codigo_barras))}` : ''}</p>
        <div class="cds-prod-pick__row">
          <label class="cds-field cds-field--qty">
            <span class="cds-field__label">Qtd (${escapeHtml(un)})</span>
            ${qtyControlHtml({
              name: 'quantidade',
              value: qtyValue,
              min,
              step,
              id: `qtd-pick-${escapeHtml(p.id)}`,
              enterkeyhint: 'done'
            })}
          </label>
          <button type="button" class="cds-mobile-btn cds-mobile-btn--add-item" data-add-item aria-label="Adicionar ${escapeHtml(nome)}">
            ${icon('plus')} Adicionar
          </button>
        </div>
      </div>
    </article>
  `;
}

function focusQtyInput(card) {
  const input = card?.querySelector('.cds-qty__input');
  if (!input) return;
  const un = card.getAttribute('data-unidade') || 'UN';
  try {
    input.focus({ preventScroll: true });
  } catch (e) {
    input.focus();
  }
  if (isPesoUnidade(un)) {
    /* Cursor no campo (valor 0,000 pronto para digitar) */
    try {
      const len = String(input.value || '').length;
      input.setSelectionRange(0, len);
    } catch (e) { /* ignore */ }
  } else {
    try {
      input.select();
    } catch (e) { /* ignore */ }
  }
}

function paintRepeatLastBar(root, ultimo) {
  const host = root.querySelector('#item-repeat-host');
  if (!host) return;
  if (!ultimo || !ultimo.produtoId) {
    host.innerHTML = '';
    return;
  }
  host.innerHTML = `
    <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary cds-item-repeat-btn" id="item-repeat-last"
      aria-label="Adicionar novamente ${escapeHtml(ultimo.nome)}">
      ${icon('plus')} Adicionar novamente
      <span class="cds-item-repeat-meta">${escapeHtml(ultimo.nome)} · ${escapeHtml(formatNumber(ultimo.quantidade, 3))} ${escapeHtml(ultimo.unidade)}</span>
    </button>
  `;
}

function itemRowHtml(item, isDraft) {
  const itemId = itemIdOf(item);
  const un = itemUnidadeOf(item);
  const step = qtyStepForUnidade(un);
  return `
    <article class="cds-list-card cds-list-card--static">
      <div class="cds-list-card__main">
        <h3 class="cds-list-card__title">${escapeHtml(itemNomeOf(item))}</h3>
        <p class="cds-list-card__subtitle">${escapeHtml(formatNumber(itemQtyOf(item), 3))} ${escapeHtml(un)} · ${escapeHtml(formatMoney(item.precoUnitario ?? item.preco ?? 0))}/${escapeHtml(un)}</p>
      </div>
      <div class="cds-list-card__side">
        <strong class="cds-list-card__value">${escapeHtml(formatMoney(itemTotalOf(item)))}</strong>
        ${itemId && isDraft ? `
          <button type="button" class="cds-icon-action" data-edit-item="${escapeHtml(itemId)}"
            data-qtd="${escapeHtml(itemQtyOf(item))}" data-step="${escapeHtml(step)}" aria-label="Alterar quantidade">${icon('edit')}</button>
          <button type="button" class="cds-icon-action" data-del-item="${escapeHtml(itemId)}" aria-label="Remover">${icon('trash')}</button>
        ` : ''}
      </div>
    </article>
  `;
}

function totalItensValor(itens) {
  return (itens || []).reduce((acc, item) => acc + itemTotalOf(item), 0);
}

async function fetchItensOnly(consignacaoId) {
  try {
    const itensRaw = await window.CDSApi.get(`comercial/consignacoes/${consignacaoId}/itens`);
    return unwrapItens(itensRaw);
  } catch (e) {
    return [];
  }
}

/** Limpa busca/produto e devolve o foco ao campo (sem scroll). */
function resetProdutoBusca(root) {
  const input = root.querySelector('#item-produto-search');
  const box = root.querySelector('#item-produtos');
  if (box) box.innerHTML = '';
  if (!input) return;
  input.value = '';
  try {
    input.focus({ preventScroll: true });
  } catch (e) {
    input.focus();
  }
  try {
    input.select();
  } catch (e) { /* ignore */ }
}

/**
 * Contexto de edição de itens no RASCUNHO — atualiza só lista/totais/ops (sem reload da página).
 */
function createItensDraftController(root, consignacaoId, initialItens, { c, phase, onFullReload }) {
  const ctx = {
    itens: Array.isArray(initialItens) ? [...initialItens] : [],
    isDraft: !!(phase && phase.isDraft)
  };

  const paintTotais = () => {
    const total = totalItensValor(ctx.itens);
    const totalEl = root.querySelector('#comercial-total');
    if (totalEl) totalEl.textContent = formatMoney(total);
    const qtdEl = root.querySelector('#comercial-qtd-itens');
    if (qtdEl) qtdEl.textContent = String(ctx.itens.length);
    const saldoEl = root.querySelector('#comercial-saldo');
    if (saldoEl) saldoEl.textContent = formatMoney(total);
    const countEl = root.querySelector('#comercial-itens-count');
    if (countEl) countEl.textContent = `Itens (${ctx.itens.length})`;
  };

  const syncOpsBar = () => {
    if (!ctx.isDraft) return;
    const host = root.querySelector('.cds-comercial-sticky-ops');
    if (!host) return;
    const ops = buildOperacoesBar(c, phase, { itensCount: ctx.itens.length, resumoFinal: null });
    host.innerHTML = ops.length ? actionBarHtml(ops) : '';
    host.querySelector('[data-action="entrega"]')?.addEventListener('click', async () => {
      const ok = await confirmSheet({ title: 'Entrega', message: 'Registrar entrega desta consignação?', confirmLabel: 'Entregar' });
      if (!ok) return;
      try {
        await registrarEntregaConsignacao(consignacaoId);
        showToast('Entrega registrada.', 'success');
        window.CDSMobile?.navigate?.(`comercial/${consignacaoId}/comprovante`, { replace: true });
      } catch (err) {
        showToast(err.message || 'Falha na entrega', 'error');
      }
    });
    host.querySelector('[data-action="cancel"]')?.addEventListener('click', async () => {
      const ok = await confirmDanger('Cancelar consignação em rascunho?', {
        title: 'Cancelar rascunho',
        confirmLabel: 'Cancelar consignação'
      });
      if (!ok) return;
      try {
        await window.CDSApi.del(`comercial/consignacoes/${consignacaoId}`, null, { body: usuarioPayload() });
        showToast('Consignação cancelada.', 'success');
        window.CDSMobile?.navigate?.('comercial', { replace: true });
      } catch (err) {
        showToast(err.message || 'Falha ao cancelar', 'error');
      }
    });
  };

  const bindItemRowActions = () => {
    root.querySelectorAll('[data-edit-item]').forEach((btn) => {
      if (btn.dataset.boundEdit === '1') return;
      btn.dataset.boundEdit = '1';
      btn.addEventListener('click', async () => {
        const itemId = btn.getAttribute('data-edit-item');
        const step = Number(btn.getAttribute('data-step')) || 1;
        const data = await promptSheet({
          title: 'Alterar quantidade',
          confirmLabel: 'Salvar',
          fieldsHtml: `
            <label class="cds-field">
              <span class="cds-field__label">Nova quantidade *</span>
              ${qtyControlHtml({
                name: 'quantidade',
                value: btn.getAttribute('data-qtd') || 1,
                min: 0,
                step
              })}
            </label>
          `
        });
        if (data == null || data.quantidade === '' || data.quantidade == null) return;
        const novaQuantidade = parseQty(data.quantidade);
        if (!Number.isFinite(novaQuantidade) || novaQuantidade < 0) {
          showToast('Quantidade inválida.', 'warning');
          return;
        }
        try {
          await window.CDSApi.put(
            `comercial/consignacoes/${consignacaoId}/itens/${itemId}`,
            usuarioPayload({ novaQuantidade })
          );
          showToast('Quantidade atualizada', 'info');
          await ctx.refreshItens();
        } catch (err) {
          showToast(apiErrorMessage(err), 'error');
        }
      });
    });

    root.querySelectorAll('[data-del-item]').forEach((btn) => {
      if (btn.dataset.boundDel === '1') return;
      btn.dataset.boundDel = '1';
      btn.addEventListener('click', async () => {
        const itemId = btn.getAttribute('data-del-item');
        const ok = await confirmSheet({
          title: 'Remover item',
          message: 'Remover este item da consignação?',
          confirmLabel: 'Remover',
          danger: true
        });
        if (!ok) return;
        try {
          await window.CDSApi.del(
            `comercial/consignacoes/${consignacaoId}/itens/${itemId}`,
            null,
            { body: usuarioPayload() }
          );
          showToast('Produto removido', 'warning');
          await ctx.refreshItens();
        } catch (err) {
          showToast(apiErrorMessage(err), 'error');
        }
      });
    });
  };

  const paintItens = () => {
    const box = root.querySelector('#comercial-itens');
    if (!box) return;
    box.innerHTML = ctx.itens.length
      ? ctx.itens.map((item) => itemRowHtml(item, ctx.isDraft)).join('')
      : emptyHtml(ctx.isDraft ? 'Nenhum item — busque um produto acima' : 'Sem itens nesta consignação');
    bindItemRowActions();
    paintTotais();
    syncOpsBar();
  };

  ctx.refreshItens = async () => {
    ctx.itens = await fetchItensOnly(consignacaoId);
    paintItens();
  };

  ctx.paintItens = paintItens;
  ctx.paintTotais = paintTotais;
  ctx.syncOpsBar = syncOpsBar;
  ctx.bindItemRowActions = bindItemRowActions;
  ctx.getItens = () => ctx.itens;
  /** Último produto incluído nesta consignação (só memória de sessão). */
  ctx.ultimoProduto = null;
  ctx.setUltimoProduto = (p) => {
    ctx.ultimoProduto = p;
    paintRepeatLastBar(root, p);
  };

  return ctx;
}

async function adicionarProdutoPayload(root, consignacaoId, draftCtx, payload, { btn = null } = {}) {
  const quantidade = Number(payload.quantidade);
  if (!Number.isFinite(quantidade) || quantidade <= 0) {
    showToast(
      isPesoUnidade(payload.unidade)
        ? 'Informe o peso (ex.: 1,250).'
        : 'Informe uma quantidade válida.',
      'warning'
    );
    return false;
  }
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Adicionando…';
  }
  try {
    await persistirItemConsignacao(
      consignacaoId,
      {
        produtoId: Number(payload.produtoId),
        quantidade,
        precoUnitario: Number(payload.precoUnitario)
      },
      draftCtx.getItens()
    );
    showToast('Produto adicionado', 'success');
    draftCtx.setUltimoProduto({
      produtoId: Number(payload.produtoId),
      precoUnitario: Number(payload.precoUnitario),
      unidade: payload.unidade || 'UN',
      nome: payload.nome || 'Produto',
      quantidade
    });
    await draftCtx.refreshItens();
    resetProdutoBusca(root);
    paintRepeatLastBar(root, draftCtx.ultimoProduto);
    return true;
  } catch (err) {
    showToast(apiErrorMessage(err), 'error');
    if (btn) {
      btn.disabled = false;
      if (btn.id === 'item-repeat-last') {
        paintRepeatLastBar(root, draftCtx.ultimoProduto);
      } else {
        btn.innerHTML = `${icon('plus')} Adicionar`;
      }
    }
    return false;
  }
}

async function adicionarItemConsignacao(root, consignacaoId, card, draftCtx) {
  const base = produtoFromCard(card);
  if (!base || !base.produtoId) return;
  const quantidade = parseQty(card.querySelector('input[name="quantidade"]')?.value);
  const btn = card.querySelector('[data-add-item]');
  await adicionarProdutoPayload(
    root,
    consignacaoId,
    draftCtx,
    { ...base, quantidade },
    { btn }
  );
}

function bindProdutoPickCards(root, consignacaoId, draftCtx) {
  const box = root.querySelector('#item-produtos');
  if (!box) return;
  bindQtyControls(box);
  box.querySelectorAll('[data-add-item]').forEach((btn) => {
    if (btn.dataset.boundAdd === '1') return;
    btn.dataset.boundAdd = '1';
    btn.addEventListener('click', () => {
      const card = btn.closest('[data-pid]');
      if (card) adicionarItemConsignacao(root, consignacaoId, card, draftCtx);
    });
  });
  /* ENTER / Done no teclado → Adicionar */
  box.querySelectorAll('.cds-qty__input').forEach((input) => {
    if (input.dataset.boundEnterAdd === '1') return;
    input.dataset.boundEnterAdd = '1';
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const card = input.closest('[data-pid]');
      if (card) adicionarItemConsignacao(root, consignacaoId, card, draftCtx);
    });
  });
  const firstCard = box.querySelector('.cds-prod-pick');
  if (firstCard && box.querySelectorAll('.cds-prod-pick').length === 1) {
    focusQtyInput(firstCard);
  }
}

function bindRepeatLastButton(root, consignacaoId, draftCtx) {
  const host = root.querySelector('#item-repeat-host');
  if (!host || host.dataset.boundRepeat === '1') return;
  host.dataset.boundRepeat = '1';
  host.addEventListener('click', async (e) => {
    const btn = e.target.closest('#item-repeat-last');
    if (!btn) return;
    const u = draftCtx.ultimoProduto;
    if (!u) return;
    await adicionarProdutoPayload(root, consignacaoId, draftCtx, {
      produtoId: u.produtoId,
      precoUnitario: u.precoUnitario,
      unidade: u.unidade,
      nome: u.nome,
      quantidade: u.quantidade
    }, { btn });
  });
}

/**
 * Busca produtos: 1 resultado → seleciona automático; N → lista; barcode Enter flush.
 */
async function runProdutoSearch(root, consignacaoId, draftCtx, termo) {
  const box = root.querySelector('#item-produtos');
  if (!box) return;
  const q = String(termo || '').trim();
  if (q.length < 1) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = loadingHtml();
  try {
    const products = await buscarProdutosComercial(q);
    if (!products.length) {
      box.innerHTML = emptyHtml('Nenhum produto');
      return;
    }
    if (products.length === 1) {
      box.innerHTML = produtoPickCardHtml(products[0]);
      bindProdutoPickCards(root, consignacaoId, draftCtx);
      return;
    }
    box.innerHTML = products.map((p) => produtoPickCardHtml(p)).join('');
    bindProdutoPickCards(root, consignacaoId, draftCtx);
  } catch (err) {
    box.innerHTML = errorHtml(apiErrorMessage(err), err.status);
  }
}

function apiErrorMessage(err) {
  const body = err?.body;
  if (!body || typeof body !== 'object') return err?.message || 'Erro na API';
  if (body.error && typeof body.error === 'object') {
    return body.error.message || body.error.mensagem || body.error.code || err.message;
  }
  if (typeof body.error === 'string') return body.error;
  if (body.message) return body.message;
  if (body.mensagem) return body.mensagem;
  if (Array.isArray(body.errors) && body.errors.length) {
    return body.errors.map((e) => (typeof e === 'string' ? e : e.message || e.mensagem || JSON.stringify(e))).join('; ');
  }
  return err?.message || 'Erro na API';
}

function isDuplicateItemError(err) {
  const code = String(err?.body?.error?.code || err?.body?.code || '');
  const msg = apiErrorMessage(err).toLowerCase();
  return code === 'PRODUTO_DUPLICADO_NA_CONSIGNACAO' || /duplicad|já existe/.test(msg);
}

function itemProdutoId(item) {
  return Number(item?.produtoId ?? item?.produto_id ?? 0);
}

function itemIdOf(item) {
  return item?.id ?? item?.itemId ?? item?.item_id ?? null;
}

function itemQtyOf(item) {
  return Number(item?.quantidade ?? item?.quantidadeEntregue ?? item?.qtd ?? 0);
}

function itemTotalOf(item) {
  const preco = Number(item?.precoTotal ?? item?.valor_total ?? item?.total
    ?? ((itemQtyOf(item) * Number(item?.precoUnitario ?? item?.preco ?? item?.valorUnitario ?? 0))));
  return preco;
}


/** Ações por status — só o necessário à operação (paridade Desktop, densidade Mobile). */
function buildOperacoesBar(c, phase, { itensCount, resumoFinal }) {
  const ops = [];
  const operador = isOperadorComercial();
  const acerto = canComercialAcerto();
  const vendaId = phase.vendaId || resumoFinal?.vendaId;

  /* RASCUNHO: Entregar + Cancelar (itens editam/excluem na lista) */
  if (phase.isDraft && !phase.isCancelada) {
    if (operador && itensCount > 0) {
      ops.push({ action: 'entrega', label: 'Entregar', icon: 'check', variant: 'primary' });
    }
    if (canCreateComercial()) {
      ops.push({ action: 'cancel', label: 'Cancelar', icon: 'trash', variant: 'ghost' });
    }
    return ops;
  }

  if (phase.isCancelada) {
    ops.push({ action: 'historico', label: 'Histórico', icon: 'receipt', variant: 'secondary' });
    return ops;
  }

  /* ENTREGUE: prestação + resumo para o consignatário */
  if (phase.isEntregue && !phase.isEncerrada && operador && acerto) {
    ops.push({ action: 'prestacao', label: 'Prestação de contas', icon: 'receipt', variant: 'primary' });
    ops.push({ action: 'comprovante', label: 'Enviar resumo', icon: 'share', variant: 'secondary' });
    return ops;
  }

  /* ENCERRADA: consulta + reabrir / fiscal / share */
  if (phase.isEncerrada) {
    if (operador && acerto) {
      ops.push({ action: 'reabrir', label: 'Reabrir', icon: 'edit', variant: 'ghost' });
    }
    ops.push({ action: 'historico', label: 'Histórico', icon: 'receipt', variant: 'secondary' });
    ops.push({ action: 'comprovante', label: 'Enviar resumo', icon: 'share', variant: 'secondary' });
    if (canComercialContaCorrente()) {
      ops.push({ action: 'conta-corrente', label: 'Conta corrente', icon: 'coins', variant: 'secondary' });
    }
    if (vendaId && phase.fiscalAutorizada) {
      ops.push(
        { action: 'danfe', label: 'DANFE', icon: 'share', variant: 'secondary' },
        { action: 'share-xml', label: 'XML', icon: 'share', variant: 'ghost' }
      );
    } else if (vendaId) {
      ops.push({ action: 'danfe', label: 'DANFE', icon: 'receipt', variant: 'ghost' });
    }
    ops.push({ action: 'share', label: 'Compartilhar', icon: 'share', variant: 'ghost' });
  }

  return ops;
}

/**
 * Busca igual ao Desktop: LIP usa /produtos/search;
 * operacional.js ainda faz fallback consulta-pdv + por id.
 */
async function buscarProdutosComercial(termo) {
  const q = String(termo || '').trim();
  if (!q) return [];

  if (/^\d+$/.test(q)) {
    try {
      const porId = await window.CDSApi.get(`produtos/${q}`);
      if (porId?.id != null) return [porId];
    } catch (e) { /* continua */ }
  }

  try {
    const payload = await window.CDSApi.get('produtos/search', { q, limite: 20 });
    const items = Array.isArray(payload) ? payload : payload?.items || payload?.data || [];
    if (items.length) return items;
  } catch (e) { /* fallback */ }

  try {
    const payload = await window.CDSApi.get('produtos/consulta-pdv/buscar', { q, limite: 20 });
    return Array.isArray(payload) ? payload : payload?.items || payload?.data || [];
  } catch (e) {
    return [];
  }
}

/**
 * RCM-8.5 — resolve preço CONSIGNADO via Motor Oficial antes de persistir.
 * Snapshot completo (mesmo contrato do Desktop).
 */
async function resolverPrecoConsignacaoMobile(produtoId, quantidade = 1) {
  const t0 = Date.now();
  const resolvido = await window.CDSApi.post('configuracao-comercial/resolver-precos', {
    canal: 'CONSIGNADO',
    documento: 'consignacao-mobile',
    itens: [{ produto_id: Number(produtoId), quantidade: Number(quantidade) || 1 }]
  });
  const row = ((resolvido && resolvido.itens) || [])[0];
  if (!row || row.erro) {
    throw Object.assign(new Error((row && row.erro) || 'Falha ao resolver preço'), { status: 400 });
  }
  try {
    console.log('[RCM-8.5][COMERCIAL][Resolver]', JSON.stringify({
      operacao: 'CONSIGNADO',
      tabela: row.tabela_preco_nome || row.tabela_preco_id,
      produto: produtoId,
      linha: row.linha_comercial_id,
      preco: row.preco_venda,
      origem: row.preco_origem,
      tempo_ms: Date.now() - t0,
      documento: 'consignacao-mobile'
    }));
  } catch (_) { /* ignore */ }
  return row;
}

/**
 * POST /comercial/consignacoes/:id/itens — payload idêntico ao Desktop.
 * Se produto já existe: PUT .../itens/:itemId com novaQuantidade (como acumular no Desktop).
 */
async function persistirItemConsignacao(consignacaoId, { produtoId, quantidade, precoUnitario }, itensAtuais = []) {
  const pid = Number(produtoId);
  const qtd = Number(quantidade);

  if (!Number.isFinite(pid) || pid <= 0) {
    throw Object.assign(new Error('produtoId inválido'), { status: 400 });
  }
  if (!Number.isFinite(qtd) || qtd <= 0) {
    throw Object.assign(new Error('quantidade deve ser um número positivo'), { status: 400 });
  }

  const existente = (itensAtuais || []).find((i) => itemProdutoId(i) === pid);
  if (existente && itemIdOf(existente)) {
    const novaQuantidade = itemQtyOf(existente) + qtd;
    await window.CDSApi.put(
      `comercial/consignacoes/${consignacaoId}/itens/${itemIdOf(existente)}`,
      usuarioPayload({ novaQuantidade })
    );
    return { modo: 'alterar', novaQuantidade };
  }

  // RCM-8.5 — nunca grava preço de catálogo; sempre Motor Oficial CONSIGNADO
  let row;
  try {
    row = await resolverPrecoConsignacaoMobile(pid, qtd);
  } catch (e) {
    // fallback: se API falhar e cliente trouxe preço, ainda assim tenta (backend bridge corrige)
    row = null;
  }
  const preco = row && Number.isFinite(Number(row.preco_venda))
    ? Number(row.preco_venda)
    : Number(precoUnitario ?? 0);

  const payload = usuarioPayload({
    produtoId: pid,
    quantidade: qtd,
    precoUnitario: preco,
    unidadeComercial: row
      ? String(row.unidade_comercial || row.unidadeComercial || 'UN').toUpperCase()
      : undefined,
    tabelaPrecoId: row && row.tabela_preco_id != null ? Number(row.tabela_preco_id) : undefined,
    linhaComercialId: row && row.linha_comercial_id != null ? Number(row.linha_comercial_id) : undefined,
    canalVenda: 'CONSIGNADO',
    precoOrigem: row ? (row.preco_origem || null) : undefined,
    precoFallback: row ? !!row.preco_fallback : undefined
  });

  try {
    await window.CDSApi.post(`comercial/consignacoes/${consignacaoId}/itens`, payload);
    return { modo: 'adicionar', payload, snapshot: row };
  } catch (err) {
    if (!isDuplicateItemError(err)) throw err;
    let itens = itensAtuais;
    try {
      const raw = await window.CDSApi.get(`comercial/consignacoes/${consignacaoId}/itens`);
      itens = unwrapItens(raw);
    } catch (e) { /* usa lista local */ }
    const dup = (itens || []).find((i) => itemProdutoId(i) === pid);
    if (!dup || !itemIdOf(dup)) throw err;
    const novaQuantidade = itemQtyOf(dup) + qtd;
    await window.CDSApi.put(
      `comercial/consignacoes/${consignacaoId}/itens/${itemIdOf(dup)}`,
      usuarioPayload({ novaQuantidade })
    );
    return { modo: 'alterar', novaQuantidade };
  }
}

export async function renderComercial(root) {
  root.innerHTML = loadingHtml('Carregando comercial…');

  try {
    // Paridade Desktop Central de Trabalho: dashboard + pendências + consignações.
    // NÃO chamar conta-corrente sem clienteId/consignacaoId (API exige um dos dois).
    const settled = await Promise.allSettled([
      window.CDSApi.get('comercial/projections/dashboard'),
      window.CDSApi.get('comercial/consignacoes'),
      window.CDSApi.get('comercial/projections/pendencias')
    ]);

    const [dashR, listR, pendR] = settled;
    const errors = settled.filter((r) => r.status === 'rejected').map((r) => r.reason);

    if (listR.status === 'rejected' && dashR.status === 'rejected') {
      const err = listR.reason || dashR.reason;
      root.innerHTML = errorHtml(err?.message || 'Erro ao carregar comercial.', err?.status);
      showToast(apiErrorMessage(err) || 'Erro comercial', 'error');
      return;
    }

    const dash = dashR.status === 'fulfilled' ? dashR.value : null;
    const consignacoes = listR.status === 'fulfilled' ? listR.value : [];
    const pendencias = pendR.status === 'fulfilled' ? pendR.value : null;

    const dashData = dash?.data || dash?.payload || dash || {};
    const totais = dashData.totais || dashData.kpis || {};
    const lista = unwrapList(consignacoes?.data || consignacoes);
    const pendList = unwrapList(
      pendencias?.data?.pendencias
        || pendencias?.data?.alertas
        || pendencias?.data
        || pendencias?.pendencias
        || pendencias?.alertas
        || pendencias
    );

    const abertas = totais.consignacoes_abertas
      ?? totais.consignacoesAbertas
      ?? totais.abertas
      ?? dashData.consignacoes_abertas
      ?? lista.filter((c) => isConsignacaoAbertaOperacional(c)).length;

    const totalPend = totais.pendencias
      ?? totais.total_pendencias
      ?? pendencias?.data?.total
      ?? pendList.length
      ?? 0;
    const canCreate = canCreateComercial();

    // Banner só se a lista principal falhou e ainda há conteúdo parcial útil
    const showPartialBanner = listR.status === 'rejected'
      || (errors.length > 0 && lista.length === 0 && !dash);

    root.innerHTML = `
      ${showPartialBanner ? `<div class="cds-mobile-banner">${icon('warning')} <span>Parte dos dados falhou ao carregar.</span></div>` : ''}
      <div class="cds-quick-grid" style="grid-template-columns:1fr 1fr;margin-bottom:12px">
        <button type="button" class="cds-quick" data-go="comercial/clientes">${icon('users')} Clientes consignados</button>
        <button type="button" class="cds-quick" data-go="comercial/prestacao">${icon('receipt')} Prestação de Contas</button>
        ${canCreate ? `<button type="button" class="cds-quick" data-go="comercial/clientes/novo">${icon('plus')} Novo consignado</button>` : ''}
      </div>
      <div class="cds-kpi-grid">
        ${kpiHtml({ id: 'abertas', iconName: 'store', label: 'Abertas', value: (dash || lista.length) ? formatNumber(abertas) : '—', tone: 'warning', ok: !!(dash || listR.status === 'fulfilled') })}
        ${kpiHtml({ id: 'pendencias', iconName: 'warning', label: 'Pendências', value: (pendencias || dash) ? formatNumber(totalPend) : '—', tone: 'danger', ok: !!(pendencias || dash) })}
      </div>

      ${pendList.length ? `
        ${sectionTitleHtml('Pendências')}
        <div>
          ${pendList.slice(0, 10).map((p) => listCardHtml({
            go: p.consignacao_id || p.consignacaoId || p.id ? `comercial/${p.consignacao_id || p.consignacaoId || p.id}` : undefined,
            title: asText(p.titulo || p.tipo || p.mensagem || 'Pendência'),
            subtitle: asText(p.cliente_nome || p.cliente || p.clienteNome),
            meta: [asText(p.status, '')].filter(Boolean)
          })).join('')}
        </div>
      ` : ''}

      ${sectionTitleHtml('Consignações')}
      ${searchBarHtml('Filtrar por documento ou cliente', 'comercial-filter')}
      <p class="cds-muted" id="comercial-count">${escapeHtml(countLabel(lista.length, 'consignação', 'consignações'))}</p>
      <div id="comercial-list">
        ${lista.length
          ? lista.slice(0, 50).map((c) => listCardHtml({
              go: `comercial/${c.id || c.consignacao_id}`,
              title: asText(c.numero_documento || formatDocumento(c.documento, c.id) || `#${c.id}`, 'Consignação'),
              subtitle: clienteLabel(c),
              value: valorListaDisplay(c),
              status: badgeStatusConsignacao(c),
              meta: [formatDate(c.criado_em || c.data_criacao || c.created_at || '')].filter((x) => x !== '—')
            })).join('')
          : emptyHtml('Nenhuma consignação encontrada')}
      </div>
      ${canCreate ? fabHtml('Nova consignação', 'comercial/nova') : ''}
    `;

    bindGo(root);
    root.querySelectorAll('[data-kpi]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        const kpi = btn.getAttribute('data-kpi');
        if (kpi === 'abertas' || kpi === 'pendencias') {
          window.CDSMobile?.navigate?.(`comercial/${kpi}`);
        }
      });
    });

    const all = lista;
    root.querySelector('#comercial-filter')?.addEventListener('input', debounce((e) => {
      const q = String(e.target.value || '').trim().toLowerCase();
      const filtered = !q
        ? all
        : all.filter((c) => {
          const blob = [
            c.id, c.documento, c.documento_numero, c.numero_documento,
            c.clienteNome, c.cliente_nome, c.cliente, c.clienteFantasia,
            c.clienteDocumento, c.cliente_documento, c.clienteTelefone, c.cliente_telefone,
            c.observacao, c.observacoes
          ].map((v) => String(v || '').toLowerCase()).join(' ');
          const digits = blob.replace(/\D/g, '');
          const qDigits = q.replace(/\D/g, '');
          return blob.includes(q) || (qDigits && digits.includes(qDigits));
        });
      root.querySelector('#comercial-count').textContent = countLabel(filtered.length, 'consignação', 'consignações');
      const list = root.querySelector('#comercial-list');
      list.innerHTML = filtered.slice(0, 50).map((c) => listCardHtml({
        go: `comercial/${c.id || c.consignacao_id}`,
        title: asText(c.numero_documento || formatDocumento(c.documento, c.id) || `#${c.id}`, 'Consignação'),
        subtitle: clienteLabel(c),
        value: valorListaDisplay(c),
        status: badgeStatusConsignacao(c),
        meta: [formatDate(c.criado_em || c.data_criacao || c.created_at || '')].filter((x) => x !== '—')
      })).join('') || emptyHtml('Nenhuma consignação no filtro');
      bindGo(list);
    }, 200));
  } catch (err) {
    root.innerHTML = errorHtml(err.message || 'Erro ao carregar comercial.', err.status);
    showToast(apiErrorMessage(err) || 'Erro comercial', 'error');
  }
}

function isConsignacaoAberta(c) {
  return isConsignacaoAbertaOperacional(c);
}

function pendenciaGo(p) {
  const cid = p.consignacao_id || p.consignacaoId || p.id;
  if (cid && /^\d+$/.test(String(cid))) return `comercial/${cid}`;
  const clienteId = p.cliente_id || p.clienteId;
  if (clienteId) return `clientes/${clienteId}`;
  return undefined;
}

/** Detalhe dos KPIs Abertas / Pendências (clique em "Ver detalhes"). */
export async function renderKpiDetail(root, kpiId) {
  root.innerHTML = loadingHtml(kpiId === 'pendencias' ? 'Carregando pendências…' : 'Carregando consignações abertas…');
  try {
    if (kpiId === 'abertas') {
      const raw = await window.CDSApi.get('comercial/consignacoes');
      const lista = unwrapList(raw?.data || raw).filter(isConsignacaoAberta);
      root.innerHTML = `
        ${backBarHtml('Comercial')}
        ${sectionTitleHtml('Consignações abertas')}
        <p class="cds-muted">${escapeHtml(countLabel(lista.length, 'consignação aberta', 'consignações abertas'))}</p>
        <div>
          ${lista.length
            ? lista.slice(0, 80).map((c) => listCardHtml({
                go: `comercial/${c.id || c.consignacao_id}`,
                title: asText(c.numero_documento || formatDocumento(c.documento, c.id) || `#${c.id}`, 'Consignação'),
                subtitle: clienteLabel(c),
                value: valorListaDisplay(c),
                status: badgeStatusConsignacao(c),
                meta: [formatDate(c.criado_em || c.data_criacao || c.created_at || '')].filter((x) => x !== '—')
              })).join('')
            : emptyHtml('Nenhuma consignação aberta')}
        </div>
      `;
      bindBack(root);
      bindGo(root);
      return;
    }

    if (kpiId === 'pendencias') {
      const raw = await window.CDSApi.get('comercial/projections/pendencias');
      const pendList = pendenciasItems(raw);
      root.innerHTML = `
        ${backBarHtml('Comercial')}
        ${sectionTitleHtml('Pendências')}
        <p class="cds-muted">${escapeHtml(countLabel(pendList.length, 'pendência', 'pendências'))}</p>
        <div>
          ${pendList.length
            ? pendList.slice(0, 80).map((p) => listCardHtml({
                go: pendenciaGo(p),
                title: asText(p.titulo || p.tipo || p.mensagem || 'Pendência'),
                subtitle: asText(p.cliente_nome || p.cliente || p.clienteNome || p.descricao),
                meta: [asText(p.status || p.prioridade || p.severidade, '')].filter(Boolean)
              })).join('')
            : emptyHtml('Nenhuma pendência')}
        </div>
      `;
      bindBack(root);
      bindGo(root);
      return;
    }

    root.innerHTML = `${backBarHtml('Comercial')}${errorHtml('Detalhe desconhecido.', 404)}`;
    bindBack(root);
  } catch (err) {
    root.innerHTML = `${backBarHtml('Comercial')}${errorHtml(apiErrorMessage(err), err.status)}`;
    bindBack(root);
    showToast(apiErrorMessage(err), 'error');
  }
}

export async function renderNova(root) {
  if (!canCreateComercial()) {
    root.innerHTML = `${backBarHtml('Comercial')}${errorHtml('Sem permissão para criar consignação.', 403)}`;
    bindBack(root);
    return;
  }

  root.innerHTML = `
    <div class="cds-nova-consignacao">
      ${backBarHtml('Comercial')}
      <article class="cds-card cds-m-enter">
        <h3 class="cds-card__title">Nova consignação</h3>
        <p class="cds-muted">Busque o cliente e confirme o perfil para abrir o rascunho.</p>
      </article>
      ${searchBarHtml('Buscar cliente (mín. 2 letras)', 'nova-cliente-search')}
      <div id="nova-clientes">${emptyHtml('Busque o cliente')}</div>
      <div id="nova-contexto"></div>
      <div id="nova-perfis"></div>
      <div id="nova-form"></div>
    </div>
  `;
  bindBack(root);

  const paintCriarForm = (cliente, perfilId, profile) => {
    const form = root.querySelector('#nova-form');
    form.innerHTML = formCardHtml(
      `Criar · ${asText(profile?.nome || cliente.nome || `Cliente #${cliente.id}`)}`,
      fieldHtml({ name: 'observacao', label: 'Observação (opcional)', type: 'textarea', rows: 2 }),
      `<button type="submit" class="cds-mobile-btn">Criar consignação</button>`
    );
    root.querySelector('#cds-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = collectForm(e.target);
      try {
        const created = await window.CDSApi.post(
          'comercial/consignacoes',
          usuarioPayload({
            clienteId: Number(cliente.id),
            perfilComercialId: Number(perfilId),
            observacao: data.observacao || null,
            dataAbertura: new Date().toISOString()
          })
        );
        const entity = unwrapEntity(created) || created?.data || created;
        const newId = entity?.id || entity?.consignacaoId || entity?.consignacao_id;
        showToast('Consignação criada.', 'success');
        window.CDSMobile?.navigate?.(newId ? `comercial/${newId}` : 'comercial', { replace: true });
      } catch (err) {
        showToast(apiErrorMessage(err), 'error');
      }
    });
  };

  const paintPerfis = (cliente, ctx) => {
    const box = root.querySelector('#nova-perfis');
    const { perfis, profile, perfilPreferido } = ctx;
    if (!perfis.length) {
      box.innerHTML = emptyHtml('Cliente sem perfil comercial ativo', 'Cadastre o perfil no ERP/Motor Comercial.');
      root.querySelector('#nova-form').innerHTML = '';
      return;
    }

    box.innerHTML = `
      ${sectionTitleHtml('Perfil comercial')}
      ${perfis.map((p) => {
        const lim = perfilLimiteOf(p);
        const selected = perfilPreferido && String(perfilPreferido.id) === String(p.id);
        const titulo = asText(p.nome || p.descricao || p.perfilTipo || `Perfil #${p.id}`);
        return `
          <button type="button" class="cds-list-card ${selected ? 'is-selected' : ''}" data-perfil="${escapeHtml(p.id)}">
            <div class="cds-list-card__main">
              <h3 class="cds-list-card__title">${escapeHtml(titulo)}</h3>
              <p class="cds-list-card__subtitle">${escapeHtml(asText(p.perfilTipo || p.tipo, ''))}${
                lim != null ? ` · Limite ${escapeHtml(formatMoney(lim))}` : ''
              }</p>
            </div>
          </button>
        `;
      }).join('')}
    `;

    const selectPerfil = (perfilId) => {
      const perfil = perfis.find((p) => String(p.id) === String(perfilId));
      const profileSel = buildClienteProfileView(cliente, perfil, ctx.situacao);
      box.querySelectorAll('[data-perfil]').forEach((b) => {
        b.classList.toggle('is-selected', b.getAttribute('data-perfil') === String(perfilId));
      });
      paintCriarForm(cliente, perfilId, profileSel);
    };

    box.querySelectorAll('[data-perfil]').forEach((btn) => {
      btn.addEventListener('click', () => selectPerfil(btn.getAttribute('data-perfil')));
    });

    if (perfilPreferido?.id) {
      selectPerfil(perfilPreferido.id);
    }
  };

  const onClienteSelected = async (cliente) => {
    const ctxBox = root.querySelector('#nova-contexto');
    const perfisBox = root.querySelector('#nova-perfis');
    const formBox = root.querySelector('#nova-form');
    ctxBox.innerHTML = loadingHtml('Carregando crédito…');
    perfisBox.innerHTML = '';
    formBox.innerHTML = '';
    try {
      const ctx = await carregarContextoClienteComercial(cliente);
      if (ctx.errors?.length) {
        showToast('Parte do contexto comercial falhou ao carregar.', 'warning');
      }
      if (!ctx.profile && !ctx.situacao && !ctx.perfis.length) {
        ctxBox.innerHTML = emptyHtml('Sem dados comerciais para este cliente');
        return;
      }
      const profile = ctx.profile || buildClienteProfileView(cliente, null, ctx.situacao);
      ctxBox.innerHTML = `
        <article class="cds-card cds-m-enter">
          <div class="cds-row"><span>Cliente</span><strong>${escapeHtml(asText(profile.nome))}</strong></div>
          ${rowIf('Documento', profile.documento)}
        </article>
        ${resumoFinanceiroHtml(profile, { pendencias: ctx.pendencias, compact: true })}
      `;
      paintPerfis(cliente, ctx);
    } catch (err) {
      ctxBox.innerHTML = errorHtml(apiErrorMessage(err), err.status);
    }
  };

  root.querySelector('#nova-cliente-search')?.addEventListener('input', debounce(async (e) => {
    const q = String(e.target.value || '').trim();
    const box = root.querySelector('#nova-clientes');
    if (q.length < 2) {
      box.innerHTML = emptyHtml('Busque o cliente');
      return;
    }
    box.innerHTML = loadingHtml();
    try {
      let rows = await window.CDSApi.get('clientes/buscar', { termo: q });
      if (!Array.isArray(rows)) rows = [];
      box.innerHTML = rows.length
        ? rows.map((c) => listCardHtml({
            id: c.id,
            title: asText(c.nome || c.razaoSocial || c.nomeFantasia, `Cliente #${c.id}`),
            subtitle: asText(c.cpf_cnpj || c.documento)
          })).join('')
        : emptyHtml('Nenhum cliente');
      box.querySelectorAll('[data-id]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const selected = rows.find((c) => String(c.id) === btn.getAttribute('data-id'));
          if (selected) onClienteSelected(selected);
        });
      });
    } catch (err) {
      box.innerHTML = errorHtml(err.message, err.status);
    }
  }, 280));
}

function itemNomeOf(item) {
  return asText(item.produtoNome || item.produto_nome || item.nome || item.descricao || item.produto, 'Item');
}

function itemUnidadeOf(item) {
  return asText(item.unidade || item.unidade_medida || 'UN', 'UN');
}

async function pickItemSheet(itens, title) {
  if (!itens.length) {
    showToast('Sem itens na consignação.', 'warning');
    return null;
  }
  const options = itens.map((item) => ({
    value: String(itemIdOf(item) || itemProdutoId(item) || ''),
    label: `${itemNomeOf(item)} · ${formatNumber(itemQtyOf(item), 3)} ${itemUnidadeOf(item)}`,
    produtoId: itemProdutoId(item),
    itemId: itemIdOf(item),
    preco: Number(item.precoUnitario ?? item.preco_unitario ?? item.preco ?? item.valorUnitario ?? item.preco_venda ?? 0)
  })).filter((o) => o.value);

  const data = await promptSheet({
    title,
    confirmLabel: 'Continuar',
    fieldsHtml: [
      fieldHtml({
        name: 'itemKey',
        label: 'Item',
        type: 'select',
        value: options.map((o, i) => ({ value: o.value, label: o.label, selected: i === 0 })),
        required: true
      }),
      `<label class="cds-field">
        <span class="cds-field__label">Quantidade *</span>
        ${qtyControlHtml({ name: 'quantidade', value: 1, min: 0.001, step: 1 })}
      </label>`,
      fieldHtml({ name: 'precoVenda', label: 'Preço venda', type: 'number', value: options[0]?.preco || 0, required: true, inputmode: 'decimal' }),
      fieldHtml({ name: 'observacao', label: 'Observação', type: 'textarea' })
    ].join('')
  });
  if (!data) return null;
  const opt = options.find((o) => o.value === String(data.itemKey)) || options[0];
  const qtd = parseQty(data.quantidade);
  const preco = parseQty(data.precoVenda);
  return {
    itemId: opt?.itemId ? Number(opt.itemId) : null,
    produtoId: opt?.produtoId || Number(data.itemKey),
    quantidade: Number.isFinite(qtd) ? qtd : NaN,
    precoVenda: Number.isFinite(preco) ? preco : 0,
    observacao: data.observacao || null
  };
}

export async function renderDetail(root, id) {
  root.innerHTML = loadingHtml('Abrindo consignação…');
  try {
    const {
      c,
      itens,
      situacao,
      clienteProfile,
      resumoPrest,
      resumoFinal,
      historico,
      contaCorrente,
      ccTotais,
      pendencias,
      phase
    } = await carregarConsignacaoCompleta(id);

    const isDraft = phase.isDraft;
    const totalItens = itens.reduce((acc, item) => acc + itemTotalOf(item), 0);
    const totalCabecalho = valorConsignacaoOf(c) || totalItens;
    const saldoCab = saldoConsignacaoOf(c, resumoPrest);
    const operacoes = buildOperacoesBar(c, phase, { itensCount: itens.length, resumoFinal });
    const resumo = resumoPrest || resumoFinal;
    const statusLabel = asText(c.status || c.situacao, '');
    const profile = clienteProfile || buildClienteProfileView(
      { id: c.clienteId || c.cliente_id, nome: c.clienteNome },
      situacao?.perfil,
      situacao
    );

    const resumoPrestHtml = (!isDraft && resumo && (
      numFromApi(resumo.valorVendido) != null ||
      numFromApi(resumo.valorRecebido) != null ||
      numFromApi(resumo.saldoAtual) != null ||
      phase.vendaId ||
      phase.situacaoFiscal
    )) ? `
      <article class="cds-card">
        <h3 class="cds-card__title">Prestação</h3>
        ${rowIf('Vendido', resumo.valorVendido, { money: true })}
        ${rowIf('Recebido', resumo.valorRecebido, { money: true })}
        ${rowIf('Saldo', resumo.saldoAtual ?? saldoCab, { money: true })}
        ${phase.vendaId ? rowIf('Venda oficial', `#${phase.vendaId}`) : ''}
        ${rowIf('Fiscal', phase.situacaoFiscal)}
      </article>
    ` : '';

    root.innerHTML = `
      <div class="cds-comercial-detail">
      ${backBarHtml('Comercial')}

      <!-- 1. Cabeçalho operacional -->
      <article class="cds-card cds-m-enter cds-consignacao-header">
        <div class="cds-consignacao-header__top">
          <h3 class="cds-card__title" style="margin:0">${escapeHtml(c.documentoLabel || formatDocumento(c.documento, id))}</h3>
          ${statusBadgeHtml(badgeStatusConsignacao(c))}
        </div>
        <div class="cds-row"><span>Cliente</span><strong>${escapeHtml(clienteLabel(c))}</strong></div>
        ${rowIf('Perfil comercial', profile.perfilNome || c.perfilNome || profile.perfilComercial)}
      </article>

      <!-- 2. Resumo financeiro -->
      ${resumoFinanceiroHtml(profile, { pendencias, compact: isDraft })}

      ${resumoPrestHtml}

      <!-- 3. Adicionar produto (só RASCUNHO) -->
      ${isDraft ? `
        ${sectionTitleHtml('Adicionar produto')}
        ${searchBarHtml('Buscar produto ou código de barras', 'item-produto-search')}
        <p class="cds-muted cds-prod-pick-hint">UN inicia em 1 · KG em 0,000 · <strong>Enter</strong> adiciona · 1 código = seleção automática.</p>
        <div id="item-repeat-host" class="cds-item-repeat-host"></div>
        <div id="item-produtos" class="cds-item-produtos"></div>
      ` : ''}

      <!-- 4. Lista de itens -->
      <div class="cds-section-head">
        <h2 class="cds-section-head__title" id="comercial-itens-count">Itens (${itens.length})</h2>
      </div>
      <div id="comercial-itens">
        ${itens.length
          ? itens.map((item) => itemRowHtml(item, isDraft)).join('')
          : emptyHtml(isDraft ? 'Nenhum item — busque um produto acima' : 'Sem itens nesta consignação')}
      </div>

      <!-- 5. Total -->
      <article class="cds-card cds-consignacao-total">
        <div class="cds-row"><span>Qtd. itens</span><strong id="comercial-qtd-itens">${escapeHtml(String(itens.length))}</strong></div>
        <div class="cds-row"><span>Total</span><strong id="comercial-total">${escapeHtml(formatMoney(totalCabecalho))}</strong></div>
        <div class="cds-row"><span>Saldo</span><strong id="comercial-saldo">${escapeHtml(formatMoney(isDraft ? totalCabecalho : saldoCab))}</strong></div>
      </article>

      <!-- 6. Barra de operações -->
      ${operacoes.length ? `
        <div class="cds-comercial-sticky-ops">
          ${actionBarHtml(operacoes)}
        </div>
      ` : ''}
      </div>
    `;
    bindBack(root);
    bindGo(root);

    const reload = () => window.CDSMobile?.navigate?.(`comercial/${id}`, { replace: true });

    const draftCtx = createItensDraftController(root, id, itens, {
      c,
      phase,
      onFullReload: reload
    });
    /* DOM inicial já renderizado — só vincula ações (sem repaint/scroll). */
    draftCtx.bindItemRowActions();
    bindRepeatLastButton(root, id, draftCtx);

    const searchInput = root.querySelector('#item-produto-search');
    const runSearch = debounce(async (termo) => {
      await runProdutoSearch(root, id, draftCtx, termo);
    }, 280);

    searchInput?.addEventListener('input', (e) => {
      runSearch(e.target.value);
    });

    /* Leitor de código: Enter flush imediato (sem esperar debounce). */
    searchInput?.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const q = String(e.target.value || '').trim();
      if (!q) return;
      runProdutoSearch(root, id, draftCtx, q);
    });

    /* enterkeyhint search no campo de busca */
    if (searchInput) searchInput.setAttribute('enterkeyhint', 'search');

    root.querySelector('[data-action="entrega"]')?.addEventListener('click', async () => {
      const ok = await confirmSheet({ title: 'Entrega', message: 'Registrar entrega desta consignação?', confirmLabel: 'Entregar' });
      if (!ok) return;
      try {
        await registrarEntregaConsignacao(id);
        showToast('Entrega registrada.', 'success');
        window.CDSMobile?.navigate?.(`comercial/${id}/comprovante`, { replace: true });
      } catch (err) {
        showToast(err.message || 'Falha na entrega', 'error');
      }
    });

    root.querySelector('[data-action="comprovante"]')?.addEventListener('click', () => {
      window.CDSMobile?.navigate?.(`comercial/${id}/comprovante`);
    });

    root.querySelector('[data-action="prestacao"]')?.addEventListener('click', async () => {
      const ok = await confirmSheet({
        title: 'Prestação de contas',
        message: 'Abrir a estação de prestação de contas desta consignação?',
        confirmLabel: 'Abrir'
      });
      if (!ok) return;
      try {
        await ensurePrestacaoAberta(id);
        showToast('Prestação aberta.', 'success');
        // Paridade Desktop: navega para /consignacoes/:id/prestacao
        window.CDSMobile?.navigate?.(`comercial/${id}/prestacao`);
      } catch (err) {
        showToast(apiErrorMessage(err) || 'Falha ao abrir prestação', 'error');
      }
    });

    root.querySelector('[data-action="venda"]')?.addEventListener('click', async () => {
      const payload = await pickItemSheet(draftCtx.getItens(), 'Recebimento / venda na prestação');
      if (!payload) return;
      try {
        await window.CDSApi.post(
          `comercial/consignacoes/${id}/prestacao/venda`,
          usuarioPayload(payload)
        );
        showToast('Recebimento registrado.', 'success');
        reload();
      } catch (err) {
        showToast(err.message || 'Falha no recebimento', 'error');
      }
    });

    root.querySelector('[data-action="perda"]')?.addEventListener('click', async () => {
      const payload = await pickItemSheet(draftCtx.getItens(), 'Registrar perda');
      if (!payload) return;
      try {
        await window.CDSApi.post(
          `comercial/consignacoes/${id}/prestacao/perda`,
          usuarioPayload({
            itemId: payload.itemId,
            produtoId: payload.produtoId,
            quantidade: payload.quantidade,
            motivo: payload.observacao || 'Perda',
            observacao: payload.observacao
          })
        );
        showToast('Perda registrada.', 'success');
        reload();
      } catch (err) {
        showToast(err.message || 'Falha ao registrar perda', 'error');
      }
    });

    root.querySelector('[data-action="pagamento"]')?.addEventListener('click', async () => {
      const data = await promptSheet({
        title: 'Baixa financeira (prestação)',
        confirmLabel: 'Registrar',
        fieldsHtml: [
          fieldHtml({ name: 'valor', label: 'Valor', type: 'number', value: 0, required: true, inputmode: 'decimal' }),
          fieldHtml({
            name: 'formaPagamento',
            label: 'Forma',
            type: 'select',
            value: [
              { value: 'DINHEIRO', label: 'Dinheiro', selected: true },
              { value: 'PIX', label: 'PIX' },
              { value: 'CARTAO', label: 'Cartão' },
              { value: 'TRANSFERENCIA', label: 'Transferência' }
            ]
          }),
          fieldHtml({ name: 'observacao', label: 'Observação', type: 'textarea' })
        ].join('')
      });
      if (!data) return;
      try {
        await window.CDSApi.post(
          `comercial/consignacoes/${id}/prestacao/pagamento`,
          usuarioPayload({
            valor: Number(data.valor),
            formaPagamento: data.formaPagamento,
            observacao: data.observacao || null
          })
        );
        showToast('Pagamento registrado.', 'success');
        reload();
      } catch (err) {
        showToast(err.message || 'Falha no pagamento', 'error');
      }
    });

    root.querySelector('[data-action="fechar"]')?.addEventListener('click', async () => {
      const ok = await confirmSheet({ title: 'Encerrar', message: 'Fechar prestação de contas?', confirmLabel: 'Encerrar' });
      if (!ok) return;
      try {
        await window.CDSApi.post(`comercial/consignacoes/${id}/prestacao/fechar`, usuarioPayload(), null, { timeoutMs: 120000 });
        showToast('Prestação encerrada.', 'success');
        reload();
      } catch (err) {
        showToast(err.message || 'Falha ao encerrar', 'error');
      }
    });

    root.querySelector('[data-action="oficial"]')?.addEventListener('click', async () => {
      const ok = await confirmSheet({
        title: 'Venda oficial',
        message: 'Finalizar com venda oficial (Motor Comercial + estoque/financeiro)?',
        confirmLabel: 'Finalizar'
      });
      if (!ok) return;
      try {
        await window.CDSApi.post(
          `comercial/consignacoes/${id}/prestacao/finalizar-venda-oficial`,
          usuarioPayload({ emitirFiscal: false, fechar: true }),
          null,
          { timeoutMs: 120000 }
        );
        showToast('Venda oficial finalizada.', 'success');
        reload();
      } catch (err) {
        showToast(err.message || 'Falha ao finalizar', 'error');
      }
    });

    root.querySelector('[data-action="nfce"]')?.addEventListener('click', async () => {
      const ok = await confirmSheet({
        title: 'Emitir NFC-e',
        message: 'Emitir NFC-e, exibir o cupom e encerrar a prestação automaticamente?',
        confirmLabel: 'Emitir'
      });
      if (!ok) return;
      try {
        const result = await emitirNfceEEncerrar(id, { clienteNome: clienteLabel(c) });
        if (result.encerrada) {
          window.CDSMobile?.navigate?.(`comercial/${id}`, { replace: true });
        } else {
          reload();
        }
      } catch (err) {
        showToast(apiErrorMessage(err) || err.message || 'Falha na NFC-e', 'error');
      }
    });

    root.querySelector('[data-action="reabrir"]')?.addEventListener('click', async () => {
      const data = await promptSheet({
        title: 'Reabrir prestação',
        confirmLabel: 'Reabrir',
        fieldsHtml: fieldHtml({ name: 'motivo', label: 'Motivo', type: 'textarea', required: true })
      });
      if (!data?.motivo) return;
      try {
        await window.CDSApi.post(
          `comercial/consignacoes/${id}/prestacao/reabrir`,
          usuarioPayload({ motivo: data.motivo })
        );
        showToast('Prestação reaberta.', 'success');
        reload();
      } catch (err) {
        showToast(err.message || 'Falha ao reabrir', 'error');
      }
    });

    root.querySelector('[data-action="historico"]')?.addEventListener('click', () => {
      openHistoricoSheet(historico);
    });

    root.querySelector('[data-action="conta-corrente"]')?.addEventListener('click', async () => {
      if (!contaCorrente.length) {
        showToast('Sem movimentos de conta corrente para este cliente.', 'info');
        return;
      }
      openBottomSheet({
        title: 'Conta corrente',
        bodyHtml: contaCorrente.slice(0, 20).map((m) => {
          const label = asText(m.descricao || m.tipo || m.evento, '');
          if (!hasText(label) && numFromApi(m.valor ?? m.saldo) == null) return '';
          return `
            <div class="cds-row" style="margin-bottom:8px">
              <span>${escapeHtml(hasText(label) ? label : 'Lançamento')}</span>
              <strong>${escapeHtml(moneyApi(m.valor ?? m.saldo))}</strong>
            </div>
          `;
        }).filter(Boolean).join('') || `<p class="cds-muted">Sem lançamentos com conteúdo.</p>`,
        actionsHtml: `<button type="button" class="cds-mobile-btn" data-sheet-close>Fechar</button>`
      });
    });

    root.querySelector('[data-action="danfe"]')?.addEventListener('click', async () => {
      const vid = phase.vendaId || resumoFinal?.vendaId;
      if (!vid) {
        showToast('Venda fiscal ainda não gerada.', 'warning');
        return;
      }
      try {
        const html = await fetchDanfeHtml(vid);
        await mostrarCupomNoCelular(html, {
          title: 'Cupom fiscal (DANFE)',
          fileName: `danfe-consignacao-${id}.html`
        });
      } catch (err) {
        showToast(err.message || 'Falha ao abrir DANFE', 'error');
      }
    });

    root.querySelector('[data-action="share-xml"]')?.addEventListener('click', async () => {
      const xml = resumoFinal?.xmlAutorizado || resumoPrest?.xmlAutorizado;
      if (!xml) {
        showToast('XML não disponível nesta consignação.', 'warning');
        return;
      }
      await shareTextAsFile(`nfce-consignacao-${id}.xml`, xml, 'application/xml');
    });

    root.querySelector('[data-action="share"]')?.addEventListener('click', async () => {
      await sharePayload({
        title: 'Consignação CDS',
        text: `Consignação ${c.documentoLabel || id}\nCliente: ${clienteLabel(c)}\nTotal: ${formatMoney(totalCabecalho)}\nSaldo: ${formatMoney(saldoCab)}\nStatus: ${statusLabel}`
      });
    });

    root.querySelector('[data-action="cancel"]')?.addEventListener('click', async () => {
      const ok = await confirmDanger('Cancelar consignação em rascunho?', {
        title: 'Cancelar rascunho',
        confirmLabel: 'Cancelar consignação'
      });
      if (!ok) return;
      try {
        await window.CDSApi.del(`comercial/consignacoes/${id}`, null, { body: usuarioPayload() });
        showToast('Consignação cancelada.', 'success');
        window.CDSMobile?.navigate?.('comercial', { replace: true });
      } catch (err) {
        showToast(err.message || 'Falha ao cancelar', 'error');
      }
    });
  } catch (err) {
    root.innerHTML = `${backBarHtml('Comercial')}${errorHtml(err.message, err.status)}`;
    bindBack(root);
    showToast(err.message || 'Erro ao abrir consignação', 'error');
  }
}

function isPrestacaoJaAbertaError(err) {
  const code = String(err?.body?.error?.code || err?.body?.code || err?.body?.error?.codigo || '');
  const msg = apiErrorMessage(err).toLowerCase();
  return code === 'PRESTACAO_JA_ABERTA'
    || code === 'COMERCIAL-301'
    || /já está aberta|ja esta aberta|já aberta|ja aberta/.test(msg);
}

/** Abre prestação se necessário; se já aberta, segue (paridade Desktop). */
async function ensurePrestacaoAberta(consignacaoId) {
  try {
    await window.CDSApi.post(
      `comercial/consignacoes/${consignacaoId}/prestacao/abrir`,
      usuarioPayload()
    );
    return { abriu: true };
  } catch (err) {
    if (isPrestacaoJaAbertaError(err)) return { abriu: false, jaAberta: true };
    throw err;
  }
}

function buildPrestacaoOpsBar(phase, { resumoFinal } = {}) {
  const ops = [];
  const podeFiscal = canDoAction('emitir_nfce');
  if (phase.isEncerrada) {
    ops.push({ action: 'reabrir', label: 'Reabrir prestação', icon: 'edit', variant: 'ghost' });
    if (phase.vendaId || resumoFinal?.vendaId) {
      ops.push({ action: 'danfe', label: 'DANFE', icon: 'share', variant: 'secondary' });
    }
    return ops;
  }
  ops.push(
    { action: 'pagamento', label: 'Pagamento', icon: 'money', variant: 'secondary' },
    { action: 'oficial', label: 'Venda oficial', icon: 'receipt', variant: 'secondary' }
  );
  if (!phase.fiscalAutorizada && podeFiscal) {
    ops.push({ action: 'nfce', label: 'Emitir NFC-e', icon: 'receipt', variant: 'ghost' });
  }
  if (phase.vendaId || resumoFinal?.vendaId) {
    ops.push({ action: 'danfe', label: 'DANFE', icon: 'share', variant: 'ghost' });
  }
  ops.push({ action: 'fechar', label: 'Encerrar prestação', icon: 'check', variant: 'primary' });
  return ops;
}

function openFechamentoSheet(ops, bindFn) {
  if (!ops.length) {
    showToast('Nenhuma ação de fechamento disponível.', 'info');
    return;
  }
  const sheet = openBottomSheet({
    title: 'Fechamento',
    bodyHtml: `
      <p class="cds-muted" style="margin:0 0 12px">Pagamento, fiscal e encerramento — use depois de salvar a grade.</p>
      <div class="cds-prestacao-mais-ops">
        ${ops.map((b) => `
          <button type="button"
            class="cds-mobile-btn ${b.variant ? `cds-mobile-btn--${escapeHtml(b.variant)}` : ''}"
            data-action="${escapeHtml(b.action)}"
            style="width:100%">
            ${b.icon ? icon(b.icon) : ''} ${escapeHtml(b.label)}
          </button>
        `).join('')}
      </div>
    `,
    actionsHtml: `<button type="button" class="cds-mobile-btn cds-mobile-btn--ghost" data-sheet-close>Fechar</button>`
  });
  bindFn(sheet);
}

function bindPrestacaoOperacoes(host, id, { phase, resumoFinal, reload, clienteNome = '' }) {
  if (!host) return;

  const on = (action, fn) => {
    host.querySelector(`[data-action="${action}"]`)?.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        await fn();
      } catch (err) {
        showToast(apiErrorMessage(err) || err.message || 'Falha na operação', 'error');
      }
    });
  };

  on('pagamento', async () => {
    closeBottomSheet();
    const data = await promptSheet({
      title: 'Baixa financeira (prestação)',
      confirmLabel: 'Registrar',
      fieldsHtml: [
        fieldHtml({ name: 'valor', label: 'Valor', type: 'number', value: 0, required: true, inputmode: 'decimal' }),
        fieldHtml({
          name: 'formaPagamento',
          label: 'Forma',
          type: 'select',
          value: [
            { value: 'DINHEIRO', label: 'Dinheiro', selected: true },
            { value: 'PIX', label: 'PIX' },
            { value: 'CARTAO', label: 'Cartão' },
            { value: 'TRANSFERENCIA', label: 'Transferência' }
          ]
        }),
        fieldHtml({ name: 'observacao', label: 'Observação', type: 'textarea' })
      ].join('')
    });
    if (!data) return;
    await window.CDSApi.post(
      `comercial/consignacoes/${id}/prestacao/pagamento`,
      usuarioPayload({
        valor: Number(data.valor),
        formaPagamento: data.formaPagamento,
        observacao: data.observacao || null
      })
    );
    showToast('Pagamento registrado.', 'success');
    reload();
  });

  on('fechar', async () => {
    closeBottomSheet();
    const ok = await confirmSheet({
      title: 'Encerrar prestação',
      message: 'Encerrar a prestação de contas?',
      confirmLabel: 'Encerrar'
    });
    if (!ok) return;
    await window.CDSApi.post(`comercial/consignacoes/${id}/prestacao/fechar`, usuarioPayload());
    showToast('Prestação encerrada.', 'success');
    window.CDSMobile?.navigate?.(`comercial/${id}`, { replace: true });
  });

  on('oficial', async () => {
    closeBottomSheet();
    const ok = await confirmSheet({
      title: 'Venda oficial',
      message: 'Finalizar venda oficial da prestação?',
      confirmLabel: 'Finalizar'
    });
    if (!ok) return;
    await window.CDSApi.post(
      `comercial/consignacoes/${id}/prestacao/finalizar-venda-oficial`,
      usuarioPayload()
    );
    showToast('Venda oficial finalizada.', 'success');
    reload();
  });

  on('nfce', async () => {
    closeBottomSheet();
    const ok = await confirmSheet({
      title: 'Emitir NFC-e',
      message: 'Emitir NFC-e, exibir o cupom e encerrar a prestação automaticamente?',
      confirmLabel: 'Emitir'
    });
    if (!ok) return;
    const result = await emitirNfceEEncerrar(id, { clienteNome });
    if (result.encerrada) {
      window.CDSMobile?.navigate?.(`comercial/${id}`, { replace: true });
    } else {
      reload();
    }
  });

  on('danfe', async () => {
    closeBottomSheet();
    const vendaId = phase.vendaId || resumoFinal?.vendaId;
    if (!vendaId) {
      showToast('Venda oficial ainda não disponível.', 'warning');
      return;
    }
    try {
      const html = await fetchDanfeHtml(vendaId);
      await mostrarCupomNoCelular(html, {
        title: 'Cupom fiscal (DANFE)',
        fileName: `danfe-venda-${vendaId}.html`
      });
    } catch (err) {
      const vendaRaw = await window.CDSApi.get(`vendas/${vendaId}`).catch(() => null);
      const venda = vendaRaw?.data?.venda || vendaRaw?.data || vendaRaw?.venda || vendaRaw;
      if (!venda) throw err;
      if (clienteNome && !venda.cliente_nome) venda.cliente_nome = clienteNome;
      const html = montarHtmlCupomNaoFiscal(vendaId, venda);
      await mostrarCupomNoCelular(html, {
        title: 'Cupom não fiscal',
        fileName: `cupom-nao-fiscal-${vendaId}.html`
      });
    }
  });

  on('reabrir', async () => {
    closeBottomSheet();
    const ok = await confirmSheet({
      title: 'Reabrir prestação',
      message: 'Reabrir a prestação de contas?',
      confirmLabel: 'Reabrir'
    });
    if (!ok) return;
    await window.CDSApi.post(
      `comercial/consignacoes/${id}/prestacao/reabrir`,
      usuarioPayload()
    );
    showToast('Prestação reaberta.', 'success');
    reload();
  });
}

/** Campos editáveis da grade — mesma ordem do Desktop (flush: devolução → venda → perda → cortesia). */
const GRADE_CAMPOS = [
  { key: 'devolvido', tipo: 'devolucao', label: 'Devolvido' },
  { key: 'vendido', tipo: 'venda', label: 'Vendido' },
  { key: 'perdido', tipo: 'perda', label: 'Perda' },
  { key: 'cortesia', tipo: 'cortesia', label: 'Cortesia' }
];

function mapGradeItem(item = {}) {
  const entregue = Number(
    item.quantidadeEntregue ?? item.enviado ?? item.quantidade ?? item.qtd ?? 0
  );
  const vendido = Number(item.quantidadeVendida ?? item.vendido ?? 0);
  const devolvido = Number(item.quantidadeDevolvida ?? item.devolvido ?? 0);
  const perdido = Number(item.quantidadePerdida ?? item.quantidadePerda ?? item.perdido ?? 0);
  const cortesia = Number(item.quantidadeCortesia ?? item.cortesia ?? 0);
  const saldo = Math.max(0, entregue - vendido - devolvido - perdido - cortesia);
  return {
    itemId: item.itemId ?? item.id ?? item.item_id ?? null,
    produtoId: item.produtoId ?? item.produto_id ?? null,
    produtoNome: itemNomeOf(item),
    unidade: itemUnidadeOf(item),
    preco: Number(item.precoUnitario ?? item.preco ?? item.valorUnitario ?? 0),
    entregue,
    vendido,
    devolvido,
    perdido,
    cortesia,
    saldo,
    observacao: item.observacao != null ? String(item.observacao) : '',
    statusLabel: saldo > 0.0001 ? 'Pendente' : 'Liquidado'
  };
}

function enrichItensPrestacaoGrade(itens, resumoPrest) {
  const resumoItens = Array.isArray(resumoPrest?.itens) ? resumoPrest.itens : [];
  const source = (itens && itens.length) ? itens : resumoItens;
  return source.map((item) => {
    const keyId = Number(item.id ?? item.itemId ?? item.item_id ?? 0);
    const keyProd = Number(item.produtoId ?? item.produto_id ?? 0);
    const match = resumoItens.find((r) => {
      const rid = Number(r.id ?? r.itemId ?? 0);
      const rpid = Number(r.produtoId ?? r.produto_id ?? 0);
      return (keyId && rid && keyId === rid) || (keyProd && rpid && keyProd === rpid);
    });
    return mapGradeItem(match ? { ...item, ...match } : item);
  });
}

function calcSaldoGrade(row) {
  return Math.max(
    0,
    Number(row.entregue || 0)
      - Number(row.vendido || 0)
      - Number(row.devolvido || 0)
      - Number(row.perdido || 0)
      - Number(row.cortesia || 0)
  );
}

function gradeCampoInputHtml(campo, value, un, disabled) {
  return `
    <label class="cds-prestacao-grade__field">
      <span class="cds-prestacao-grade__field-label">${escapeHtml(campo.label)}</span>
      <input
        class="cds-field__input cds-prestacao-grade__input"
        type="number"
        inputmode="decimal"
        step="any"
        min="0"
        name="${escapeHtml(campo.key)}"
        data-campo="${escapeHtml(campo.key)}"
        value="${escapeHtml(value)}"
        ${disabled ? 'disabled' : ''}
        aria-label="${escapeHtml(campo.label)} (${escapeHtml(un)})"
      >
    </label>
  `;
}

function gradeRowHtml(row, index, { readonly = false } = {}) {
  const un = row.unidade || 'UN';
  return `
    <article class="cds-card cds-prestacao-grade__row" data-grade-index="${index}"
      data-item-id="${escapeHtml(row.itemId || '')}"
      data-produto-id="${escapeHtml(row.produtoId || '')}"
      data-preco="${escapeHtml(row.preco)}"
      data-entregue="${escapeHtml(row.entregue)}">
      <div class="cds-prestacao-grade__head">
        <h3 class="cds-prestacao-grade__title">${escapeHtml(row.produtoNome)}</h3>
        <span class="cds-badge cds-badge--${row.saldo > 0.0001 ? 'warning' : 'success'}" data-grade-status>${escapeHtml(row.statusLabel)}</span>
      </div>
      <div class="cds-row"><span>Entregue</span><strong data-grade-entregue>${escapeHtml(formatNumber(row.entregue, 3))} ${escapeHtml(un)}</strong></div>
      <div class="cds-prestacao-grade__grid">
        ${GRADE_CAMPOS.map((c) => gradeCampoInputHtml(c, row[c.key], un, readonly)).join('')}
      </div>
      <div class="cds-row cds-prestacao-grade__saldo">
        <span>Saldo</span>
        <strong data-grade-saldo>${escapeHtml(formatNumber(row.saldo, 3))} ${escapeHtml(un)}</strong>
      </div>
    </article>
  `;
}

async function persistirDeltaGrade(consignacaoId, row, campoMeta, delta) {
  const qty = Number(delta);
  if (!Number.isFinite(qty) || qty <= 0) return;

  const payload = usuarioPayload({
    quantidade: qty,
    itemId: row.itemId != null ? Number(row.itemId) : undefined,
    produtoId: row.produtoId != null ? Number(row.produtoId) : undefined
  });
  if (payload.itemId == null || !Number.isFinite(payload.itemId)) delete payload.itemId;
  if (payload.produtoId == null || !Number.isFinite(payload.produtoId) || payload.produtoId <= 0) {
    delete payload.produtoId;
  }

  if (campoMeta.tipo === 'venda') {
    payload.precoVenda = Number(row.preco || 0);
    await window.CDSApi.post(`comercial/consignacoes/${consignacaoId}/prestacao/venda`, payload);
    return;
  }
  if (campoMeta.tipo === 'devolucao') {
    payload.observacao = row.observacao || `Devolução — ${row.produtoNome}`;
    await window.CDSApi.post(`comercial/consignacoes/${consignacaoId}/devolucao`, payload);
    return;
  }
  if (campoMeta.tipo === 'perda') {
    payload.motivo = row.observacao || 'Perda';
    payload.observacao = row.observacao || null;
    await window.CDSApi.post(`comercial/consignacoes/${consignacaoId}/prestacao/perda`, payload);
    return;
  }
  if (campoMeta.tipo === 'cortesia') {
    await window.CDSApi.post(`comercial/consignacoes/${consignacaoId}/prestacao/cortesia`, payload);
  }
}

function readGradeRowsFromDom(root, baseline) {
  return Array.from(root.querySelectorAll('[data-grade-index]')).map((el) => {
    const index = Number(el.getAttribute('data-grade-index'));
    const base = baseline[index] || {};
    const read = (key) => {
      const input = el.querySelector(`[data-campo="${key}"]`);
      const n = parseQty(input?.value);
      return Number.isFinite(n) ? n : Number(base[key] || 0);
    };
    return {
      ...base,
      itemId: el.getAttribute('data-item-id') || base.itemId,
      produtoId: el.getAttribute('data-produto-id') || base.produtoId,
      preco: Number(el.getAttribute('data-preco') ?? base.preco ?? 0),
      entregue: Number(el.getAttribute('data-entregue') ?? base.entregue ?? 0),
      devolvido: read('devolvido'),
      vendido: read('vendido'),
      perdido: read('perdido'),
      cortesia: read('cortesia')
    };
  });
}

function bindGradeSaldoLive(root) {
  root.querySelectorAll('[data-grade-index]').forEach((el) => {
    const update = () => {
      const entregue = Number(el.getAttribute('data-entregue') || 0);
      const vals = GRADE_CAMPOS.reduce((acc, c) => {
        const n = parseQty(el.querySelector(`[data-campo="${c.key}"]`)?.value);
        acc[c.key] = Number.isFinite(n) ? n : 0;
        return acc;
      }, {});
      const saldo = calcSaldoGrade({ entregue, ...vals });
      const un = el.querySelector('[data-grade-entregue]')?.textContent?.split(' ').pop() || 'UN';
      const saldoEl = el.querySelector('[data-grade-saldo]');
      if (saldoEl) saldoEl.textContent = `${formatNumber(saldo, 3)} ${un}`;
      const badge = el.querySelector('[data-grade-status]');
      if (badge) {
        badge.textContent = saldo > 0.0001 ? 'Pendente' : 'Liquidado';
        badge.className = `cds-badge cds-badge--${saldo > 0.0001 ? 'warning' : 'success'}`;
      }
    };
    el.querySelectorAll('[data-campo]').forEach((input) => {
      input.addEventListener('input', update);
      input.addEventListener('change', update);
    });
  });
}

async function flushGradePrestacao(consignacaoId, baseline, currentRows) {
  const pendencias = [];
  currentRows.forEach((row, index) => {
    const base = baseline[index] || {};
    GRADE_CAMPOS.forEach((campo) => {
      const target = Number(row[campo.key] || 0);
      const prev = Number(base[campo.key] || 0);
      const delta = target - prev;
      if (delta > 0.0000001) {
        pendencias.push({ row, campo, delta, target, prev });
      } else if (delta < -0.0000001) {
        pendencias.push({ row, campo, delta, target, prev, invalido: true });
      }
    });
  });

  const invalidos = pendencias.filter((p) => p.invalido);
  if (invalidos.length) {
    throw Object.assign(
      new Error('Não é possível diminuir quantidades já registradas. Use a operação inversa no Desktop se necessário.'),
      { status: 400 }
    );
  }

  // Ordem Desktop: devolucao → venda → perda → cortesia
  const ordem = { devolucao: 0, venda: 1, perda: 2, cortesia: 3 };
  pendencias.sort((a, b) => (ordem[a.campo.tipo] ?? 9) - (ordem[b.campo.tipo] ?? 9));

  for (const p of pendencias) {
    const totalUsado = GRADE_CAMPOS.reduce((s, c) => s + Number(p.row[c.key] || 0), 0);
    if (totalUsado - 0.0000001 > Number(p.row.entregue || 0)) {
      throw Object.assign(
        new Error(`Quantidades de "${p.row.produtoNome}" excedem o entregue.`),
        { status: 400 }
      );
    }
    await persistirDeltaGrade(consignacaoId, p.row, p.campo, p.delta);
  }
  return pendencias.length;
}

/**
 * Estação de Prestação — grade de retornos (quantidades).
 * Rota: #/comercial/:id/prestacao/grade
 */
export async function renderPrestacaoGrade(root, id) {
  root.innerHTML = loadingHtml('Abrindo prestação de contas…');
  try {
    await ensurePrestacaoAberta(id);

    const {
      c,
      itens,
      resumoPrest,
      resumoFinal,
      phase
    } = await carregarConsignacaoCompleta(id);

    if (!phase.isEntregue && !phase.isEncerrada) {
      root.innerHTML = `
        ${backBarHtml('Consignação')}
        ${errorHtml('Prestação disponível apenas após a entrega da consignação.', 400)}
        <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" data-go="comercial/${escapeHtml(id)}">
          Voltar à consignação
        </button>
      `;
      bindBack(root);
      bindGo(root);
      return;
    }

    const gradeItens = enrichItensPrestacaoGrade(itens, resumoPrest);
    const baseline = gradeItens.map((r) => ({ ...r }));
    const resumo = resumoPrest || resumoFinal;
    const saldoCab = saldoConsignacaoOf(c, resumoPrest);
    const readonly = phase.isEncerrada;
    const operacoes = buildPrestacaoOpsBar(phase, { resumoFinal });
    const showSalvar = !readonly && gradeItens.length > 0;
    const showMais = operacoes.length > 0;

    root.innerHTML = `
      <div class="cds-comercial-detail cds-prestacao-page">
        ${backBarHtml('Prestação')}
        <article class="cds-card cds-m-enter">
          <div class="cds-consignacao-header__top">
            <h3 class="cds-card__title" style="margin:0">Grade de retornos</h3>
            ${statusBadgeHtml(badgeStatusConsignacao(c))}
          </div>
          <div class="cds-row"><span>Documento</span><strong>${escapeHtml(c.documentoLabel || formatDocumento(c.documento, id))}</strong></div>
          <div class="cds-row"><span>Cliente</span><strong>${escapeHtml(clienteLabel(c))}</strong></div>
          <div class="cds-row"><span>Saldo</span><strong>${escapeHtml(formatMoney(resumo?.saldoAtual ?? saldoCab))}</strong></div>
          <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" data-go="comercial/${escapeHtml(String(id))}/prestacao" style="width:100%;margin-top:10px">
            Voltar ao resumo / rateio
          </button>
        </article>

        ${sectionTitleHtml('Grade de retornos')}
        <p class="cds-muted cds-prestacao-grade__hint">Digite as quantidades e toque em <strong>Salvar</strong>.</p>

        <div id="prestacao-grade" class="cds-prestacao-grade">
          ${gradeItens.length
            ? gradeItens.map((row, i) => gradeRowHtml(row, i, { readonly })).join('')
            : emptyHtml('Sem itens para prestação')}
        </div>

        ${(showSalvar || showMais) ? `
          <div class="cds-prestacao-dock" role="toolbar" aria-label="Ações da prestação">
            ${showSalvar ? `
              <button type="button" class="cds-mobile-btn cds-prestacao-dock__save" id="btn-salvar-grade">
                ${icon('check')} Salvar
              </button>
            ` : ''}
            ${showMais ? `
              <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary cds-prestacao-dock__mais" id="btn-mais-fechamento">
                ${icon('more')} Mais
              </button>
            ` : ''}
          </div>
        ` : ''}
      </div>
    `;

    bindBack(root);
    bindGo(root);
    bindGradeSaldoLive(root);

    const reload = () => window.CDSMobile?.navigate?.(`comercial/${id}/prestacao/grade`, { replace: true });
    const opsCtx = { phase, resumoFinal, reload, clienteNome: clienteLabel(c) };

    root.querySelector('#btn-salvar-grade')?.addEventListener('click', async () => {
      const btn = root.querySelector('#btn-salvar-grade');
      if (btn) btn.setAttribute('aria-busy', 'true');
      try {
        const current = readGradeRowsFromDom(root, baseline);
        const n = await flushGradePrestacao(id, baseline, current);
        if (!n) {
          showToast('Nenhuma alteração para salvar.', 'info');
        } else {
          showToast(`${n} movimento(s) gravado(s).`, 'success');
          reload();
        }
      } catch (err) {
        showToast(apiErrorMessage(err) || err.message || 'Falha ao salvar grade', 'error');
      } finally {
        if (btn) btn.removeAttribute('aria-busy');
      }
    });

    root.querySelector('#btn-mais-fechamento')?.addEventListener('click', () => {
      openFechamentoSheet(operacoes, (sheet) => bindPrestacaoOperacoes(sheet, id, opsCtx));
    });
  } catch (err) {
    root.innerHTML = `${backBarHtml('Consignação')}${errorHtml(apiErrorMessage(err), err.status)}`;
    bindBack(root);
    showToast(apiErrorMessage(err) || 'Erro ao abrir prestação', 'error');
  }
}

const CMP_CACHE_PREFIX = 'cds-comprovante-entrega:';

function cmpCacheKey(id) {
  return `${CMP_CACHE_PREFIX}${id}`;
}

function saveCmpOffline(id, snapshot) {
  try {
    sessionStorage.setItem(cmpCacheKey(id), JSON.stringify({ savedAt: Date.now(), snapshot }));
  } catch (_e) { /* ignore */ }
}

function loadCmpOffline(id) {
  try {
    const raw = sessionStorage.getItem(cmpCacheKey(id));
    if (!raw) return null;
    return JSON.parse(raw)?.snapshot || null;
  } catch (_e) {
    return null;
  }
}

function unwrapComprovante(raw) {
  if (!raw || typeof raw !== 'object') return null;
  let c = raw;
  if (c.data && typeof c.data === 'object' && !Array.isArray(c.data)) c = c.data;
  if (c.dados && typeof c.dados === 'object' && !Array.isArray(c.dados)) c = c.dados;
  if (c.comprovante && typeof c.comprovante === 'object') c = c.comprovante;
  return c;
}

function montarTextoResumo(comprovante) {
  const snap = comprovante?.snapshot || comprovante || {};
  const existente = String(
    comprovante?.textoCompartilhavel || snap.textoCompartilhavel || ''
  ).trim();
  if (existente) return existente;
  const h = snap.cabecalho || {};
  const prod = snap.cards?.produtos || {};
  const sit = snap.cards?.situacaoComercial || {};
  const linhas = [
    '*COMPROVANTE DE ENTREGA*',
    h.empresaNome || 'CDS Sistemas',
    `Nº ${h.numeroComprovante || snap.numeroComprovante || '—'}`,
    `${h.data || ''} ${h.hora || ''}`.trim(),
    '',
    `*Cliente:* ${h.clienteNome || '—'}`,
    '',
    '*PRODUTOS*'
  ];
  (prod.itens || []).forEach((i) => {
    linhas.push(`• ${i.produto} — ${i.quantidade} ${i.unidade || 'UN'} = ${formatMoney(i.total)}`);
  });
  linhas.push(`Valor comercial: ${formatMoney(prod.valorComercial)}`);
  linhas.push(`Saldo atual: ${formatMoney(sit.saldoAtual)}`);
  linhas.push('');
  linhas.push('Enviado pelo CDS Sistemas');
  return linhas.filter((l, i, arr) => !(l === '' && arr[i - 1] === '')).join('\n');
}

async function auditComprovante(id, acao, comprovante) {
  try {
    await window.CDSApi.post(`comercial/consignacoes/${id}/comprovante/acoes`, {
      acao,
      comprovanteId: comprovante?.id,
      numeroComprovante: comprovante?.numeroComprovante
    });
  } catch (_e) { /* ignore */ }
}

function downloadCmpPdf(pdf) {
  if (!pdf?.base64) {
    showToast('PDF indisponível. Use Copiar resumo ou WhatsApp.', 'warning');
    return;
  }
  const bin = atob(pdf.base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: pdf.contentType || 'application/pdf' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = pdf.fileName || 'comprovante-entrega.pdf';
  a.click();
  URL.revokeObjectURL(a.href);
}

function cmpCardHtml(title, body) {
  return `
    <section class="cds-card" style="margin-bottom:12px">
      <h3 style="margin:0 0 8px;font-size:15px">${escapeHtml(title)}</h3>
      ${body}
    </section>
  `;
}

async function renderComprovanteEntrega(root, id) {
  root.innerHTML = loadingHtml('Montando resumo para o consignatário…');
  let comprovante = null;
  let offline = false;

  try {
    const raw = await window.CDSApi.get(
      `comercial/consignacoes/${id}/comprovante`,
      { _t: Date.now() },
      { timeoutMs: 60000 }
    );
    comprovante = unwrapComprovante(raw);
    if (comprovante) saveCmpOffline(id, comprovante);
  } catch (err) {
    const cached = loadCmpOffline(id);
    if (cached) {
      comprovante = cached;
      offline = true;
    } else {
      root.innerHTML = `
        ${backBarHtml('Comercial')}
        ${errorHtml(apiErrorMessage(err) || err.message || 'Falha ao carregar o resumo', err.status)}
        <button type="button" class="cds-mobile-btn" data-go="comercial/${escapeHtml(String(id))}" style="margin-top:12px">Voltar à consignação</button>
      `;
      bindBack(root);
      bindGo(root);
      return;
    }
  }

  if (!comprovante || typeof comprovante !== 'object') {
    root.innerHTML = `
      ${backBarHtml('Comercial')}
      ${errorHtml('Resumo da entrega indisponível.', 404)}
      <button type="button" class="cds-mobile-btn" data-go="comercial/${escapeHtml(String(id))}" style="margin-top:12px">Voltar à consignação</button>
    `;
    bindBack(root);
    bindGo(root);
    return;
  }

  const snap = comprovante.snapshot || comprovante;
  const h = snap.cabecalho || {};
  const prod = snap.cards?.produtos || {};
  const sit = snap.cards?.situacaoComercial || {};
  const hist = snap.cards?.historico || {};
  const obs = snap.cards?.observacoes || {};
  const texto = montarTextoResumo(comprovante);
  const pdf = comprovante.pdf || snap.pdf;
  const status = sit.statusComercial || snap.indicadores?.statusCredito || '—';
  const phone = String(h.clienteTelefone || '').replace(/\D/g, '');

  root.innerHTML = `
    ${backBarHtml('Comercial')}
    ${offline ? `<div class="cds-mobile-banner">${icon('warning')} <span>Modo offline — último resumo salvo.</span></div>` : ''}
    ${cmpCardHtml('Resumo para o consignatário', `
      <p class="cds-muted" style="margin:0 0 8px">Revise e envie pelo WhatsApp ou copie o texto.</p>
      <pre class="cds-comprovante-texto" style="white-space:pre-wrap;word-break:break-word;font-size:13px;line-height:1.4;margin:0;font-family:inherit">${escapeHtml(texto)}</pre>
    `)}
    <div class="cds-card" style="display:grid;gap:8px;margin-bottom:12px">
      <button type="button" class="cds-mobile-btn" id="cmp-whatsapp">Enviar ao consignatário (WhatsApp)</button>
      <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" id="cmp-copiar">Copiar resumo</button>
      <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" id="cmp-pdf">Gerar PDF</button>
      <button type="button" class="cds-mobile-btn cds-mobile-btn--ghost" id="cmp-print">Imprimir</button>
    </div>
    ${cmpCardHtml('Comprovante de Entrega', `
      <p class="cds-muted" style="margin:0">${escapeHtml(h.empresaNome || '')}</p>
      <p style="margin:4px 0 0"><strong>${escapeHtml(h.numeroComprovante || snap.numeroComprovante || '')}</strong></p>
      <p class="cds-muted">${escapeHtml(h.data || '')} ${escapeHtml(h.hora || '')}</p>
      <span class="cds-badge cds-badge--${status === 'VERDE' ? 'ok' : status === 'AMARELO' ? 'warn' : status === 'VERMELHO' ? 'danger' : 'neutral'}">${escapeHtml(status)}</span>
    `)}
    ${cmpCardHtml('Cliente', `
      <p style="margin:0"><strong>${escapeHtml(h.clienteNome || '—')}</strong></p>
      <p class="cds-muted">Código ${escapeHtml(h.clienteCodigo || '—')} · ${escapeHtml(h.clienteDocumento || '—')}</p>
    `)}
    ${cmpCardHtml('Produtos', `
      ${(prod.itens || []).map((i) => `
        <div class="cds-row" style="justify-content:space-between;gap:8px">
          <span>${escapeHtml(i.produto)} · ${escapeHtml(i.quantidade)} ${escapeHtml(i.unidade || 'UN')}</span>
          <strong>${escapeHtml(formatMoney(i.total))}</strong>
        </div>`).join('') || '<p class="cds-muted">Sem itens</p>'}
      <div class="cds-row" style="margin-top:8px"><span>Valor comercial</span><strong>${escapeHtml(formatMoney(prod.valorComercial))}</strong></div>
      <div class="cds-row"><span>Volumes</span><strong>${escapeHtml(asText(prod.volumes))}</strong></div>
    `)}
    ${cmpCardHtml('Situação Comercial', `
      <div class="cds-row"><span>Saldo anterior</span><strong>${escapeHtml(formatMoney(sit.saldoAnterior))}</strong></div>
      <div class="cds-row"><span>Nova remessa</span><strong>${escapeHtml(formatMoney(sit.novaRemessa))}</strong></div>
      <div class="cds-row"><span>Saldo atual</span><strong>${escapeHtml(formatMoney(sit.saldoAtual))}</strong></div>
      <div class="cds-row"><span>Limite</span><strong>${escapeHtml(formatMoney(sit.limite))}</strong></div>
      <div class="cds-row"><span>Crédito disponível</span><strong>${escapeHtml(formatMoney(sit.creditoDisponivel))}</strong></div>
      <div class="cds-row"><span>Valor em aberto</span><strong>${escapeHtml(formatMoney(sit.valorEmAberto))}</strong></div>
    `)}
    ${cmpCardHtml('Histórico', `
      <div class="cds-row"><span>Última entrega</span><strong>${escapeHtml(hist.ultimaEntrega || '—')}</strong></div>
      <div class="cds-row"><span>Maior remessa</span><strong>${escapeHtml(formatMoney(hist.maiorRemessa))}</strong></div>
      <div class="cds-row"><span>Média remessas</span><strong>${escapeHtml(formatMoney(hist.mediaRemessas))}</strong></div>
      <div class="cds-row"><span>Índice perdas</span><strong>${escapeHtml(hist.indicePerdas != null ? `${hist.indicePerdas}%` : '—')}</strong></div>
    `)}
    ${cmpCardHtml('Observações', `<p style="margin:0">${escapeHtml(obs.entrega || '—')}</p>`)}
  `;

  bindBack(root);

  root.querySelector('#cmp-copiar')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(texto);
      await auditComprovante(id, 'resumo_copiado', comprovante);
      showToast('Resumo copiado. Cole no WhatsApp do consignatário.', 'success');
    } catch (_e) {
      showToast('Não foi possível copiar. Selecione o texto na tela.', 'error');
    }
  });

  root.querySelector('#cmp-whatsapp')?.addEventListener('click', async () => {
    if (!texto) {
      showToast('Não há texto de resumo para enviar.', 'warning');
      return;
    }
    await auditComprovante(id, 'whatsapp', comprovante);
    if (phone) openWhatsApp(phone, texto);
    else window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
    if (pdf?.base64) downloadCmpPdf(pdf);
  });

  root.querySelector('#cmp-pdf')?.addEventListener('click', async () => {
    await auditComprovante(id, 'pdf', comprovante);
    downloadCmpPdf(pdf);
  });

  root.querySelector('#cmp-print')?.addEventListener('click', async () => {
    await auditComprovante(id, 'impressao', comprovante);
    const w = window.open('', '_blank');
    if (w && (pdf?.html || texto)) {
      w.document.write(pdf?.html || `<pre>${escapeHtml(texto)}</pre>`);
      w.document.close();
      setTimeout(() => w.print(), 250);
    }
  });
}

export async function render(root, parsed) {
  const sub = parsed?.parts?.[1];
  const sub2 = parsed?.parts?.[2];
  const sub3 = parsed?.parts?.[3];
  if (sub === 'clientes') {
    const mod = await import('./comercial-clientes.js');
    return mod.render(root, parsed);
  }
  // RCM-04.1 — Prestação de Contas (cards + rateio)
  if (sub === 'prestacao' || (sub && sub2 === 'prestacao')) {
    const mod = await import('./comercial-prestacao.js');
    if (sub && sub2 === 'prestacao' && sub3 === 'grade') {
      return renderPrestacaoGrade(root, sub);
    }
    return mod.render(root, parsed);
  }
  if (sub === 'nova') return renderNova(root);
  if (sub === 'abertas' || sub === 'pendencias') return renderKpiDetail(root, sub);
  if (sub && sub2 === 'comprovante') {
    return renderComprovanteEntrega(root, sub);
  }
  if (sub) return renderDetail(root, sub);
  return renderComercial(root);
}

export default {
  render,
  renderDetail,
  renderKpiDetail,
  renderPrestacaoGrade,
  title: 'Comercial',
  subtitle: 'Campo'
};
