/**
 * CDS Mobile RC2.1 — Fluxo Venda Completa (PDV)
 * Caixa + venda + fiscal + histórico. Regras apenas no backend.
 */
import {
  escapeHtml,
  asText,
  formatMoney,
  formatNumber,
  formatDateTime,
  loadingHtml,
  emptyHtml,
  errorHtml,
  searchBarHtml,
  sectionTitleHtml,
  debounce,
  icon,
  listCardHtml,
  bindGo
} from '../ui.js';
import { showToast } from '../toast.js';
import {
  fieldHtml,
  tabsHtml,
  promptSheet,
  confirmSheet,
  openBottomSheet,
  closeBottomSheet
} from '../forms.js';
import { openPdvAddProdutoSheet } from '../pdv-add-sheet.js';
import { canDoAction } from '../permissions.js';
import {
  isTerminalRegistered,
  getStoredTerminal,
  getSuggestedTerminalName,
  registerTerminal,
  startHeartbeat,
  getTerminalRequestBody,
  getTerminalUiState,
  syncTerminalFromServer
} from '../terminal.js';
import { shareTextAsFile } from '../native.js';
import {
  fetchDanfeHtml as fetchDanfeHtmlCupom,
  montarHtmlCupomNaoFiscal,
  mostrarCupomNoCelular,
  mostrarCupomAposEmissao,
  mostrarCupomAposVenda
} from '../cupom.js';
import {
  sincronizarModoFiscalDoServidor,
  modoFiscalChipHtml,
  bindModoFiscalChip,
  emitirFiscalDaVendaAtual,
  isModoFiscalAtivo
} from '../modoFiscal.js';

const CART_KEY = 'cds-mobile-pdv-cart';
/** RCM-05.13 — resumo financeiro inicia recolhido */
let pdvResumoExpandido = false;
/** Lock anti-duplo clique durante POST /vendas (não durante sheet de pagamento). */
let pdvFinalizandoVenda = false;
const META_KEY = 'cds-mobile-pdv-meta';

function setFinalizarBusyUi(busy) {
  const btn = document.getElementById('pdv-pay');
  if (!btn) return;
  const isBusy = !!busy;
  btn.disabled = isBusy || btn.dataset.gateDisabled === '1';
  btn.setAttribute('aria-busy', isBusy ? 'true' : 'false');
  btn.classList.toggle('is-disabled', btn.disabled);
  const label = btn.querySelector('.cds-pdv-sticky__pay-label');
  if (label) {
    label.textContent = isBusy ? 'Finalizando…' : 'Finalizar';
  }
}

/** RCM-9.2.2.1 — devolve o foco ao campo de pesquisa (scanner / digitação contínua) */
function refocusPdvSearch(searchEl) {
  if (!searchEl) return;
  requestAnimationFrame(() => {
    try {
      searchEl.focus({ preventScroll: true });
    } catch (_) {
      try { searchEl.focus(); } catch (_) { /* ignore */ }
    }
    const len = String(searchEl.value || '').length;
    try {
      searchEl.setSelectionRange(len, len);
    } catch (_) { /* ignore */ }
  });
}

/**
 * RCM-9.2.2.1 — limpa pesquisa + resultados após adicionar item (não mexe no carrinho).
 */
function clearPdvSearchAfterAdd(root) {
  const searchEl = root?.querySelector?.('#pdv-search');
  const results = root?.querySelector?.('#pdv-results');
  if (searchEl) searchEl.value = '';
  if (results) results.innerHTML = emptyHtml('Busque um produto');
  refocusPdvSearch(searchEl);
}

function loadCart() {
  try {
    return JSON.parse(sessionStorage.getItem(CART_KEY) || '[]');
  } catch (e) {
    return [];
  }
}

function saveCart(items) {
  try {
    sessionStorage.setItem(CART_KEY, JSON.stringify(items));
  } catch (e) { /* ignore */ }
}

function loadMeta() {
  try {
    return JSON.parse(sessionStorage.getItem(META_KEY) || '{}') || {};
  } catch (e) {
    return {};
  }
}

function saveMeta(meta) {
  try {
    sessionStorage.setItem(META_KEY, JSON.stringify(meta || {}));
  } catch (e) { /* ignore */ }
}

function cartSubtotal(items) {
  return items.reduce((sum, i) => sum + Number(i.preco || 0) * Number(i.qtd || 0), 0);
}

function cartTotals(items, meta = loadMeta()) {
  const sub = cartSubtotal(items);
  const desconto = Math.max(0, Number(meta.desconto || 0));
  const acrescimo = Math.max(0, Number(meta.acrescimo || 0));
  const total = Math.max(0, sub - desconto + acrescimo);
  return { sub, desconto, acrescimo, total };
}

function terminalStatusBannerHtml(caixaAberto) {
  const st = getTerminalUiState({ caixaAberto: !!caixaAberto });
  const term = getStoredTerminal();
  const nome = term.nome
    ? term.nome
    : '(sem nome — defina no ERP em Gerenciar Caixas)';
  const caixaLabel = term.caixaId
    ? `Caixa #${term.caixaId}${term.caixaNome ? ` (${term.caixaNome})` : ''}`
    : 'Nenhum caixa';

  // RCM-9.2.2.1 — OK operacional: só bolinha; problemas: painel completo
  // RCM-9.2.5 — chip Fiscal/Não Fiscal (mesmo contrato F12 Desktop)
  if (st.code === 'CAIXA_ABERTO') {
    return `
      <div class="cds-term-chip-row" id="pdv-term-status">
        <button type="button" class="cds-term-chip cds-term-chip--ok" id="pdv-term-chip"
          aria-label="Terminal pronto. Toque para detalhes."
          data-term-id="${escapeHtml(asText(term.id, ''))}"
          data-term-nome="${escapeHtml(nome)}"
          data-caixa="${escapeHtml(caixaLabel)}"
          data-status="${escapeHtml(st.title)}">
          <span aria-hidden="true">🟢</span>
        </button>
        ${modoFiscalChipHtml()}
      </div>
    `;
  }

  const toneClass = st.tone === 'danger' ? 'cds-term-banner--danger' : 'cds-term-banner--warn';
  return `
    <article class="cds-term-banner ${toneClass}" id="pdv-term-status">
      <div class="cds-term-banner__top">
        <strong>${st.emoji} ${escapeHtml(st.title)}</strong>
        ${modoFiscalChipHtml()}
      </div>
      <p>${escapeHtml(st.message)}</p>
      <p class="cds-muted">Terminal #${escapeHtml(asText(term.id, '—'))} · ${escapeHtml(nome)}${term.caixaId ? ` · ${escapeHtml(caixaLabel)}` : ''}</p>
      <p class="cds-muted cds-term-banner__hint">Renomear terminal: apenas no ERP (SUPER_ADMIN / Gerenciar Caixas).</p>
    </article>
  `;
}

function bindTerminalStatusUi(root) {
  bindModoFiscalChip(root);
  const chip = root?.querySelector?.('#pdv-term-chip');
  if (!chip) return;
  chip.addEventListener('click', () => {
    const term = getStoredTerminal();
    const nome = term.nome || '(sem nome)';
    const caixaLabel = term.caixaId
      ? `#${term.caixaId}${term.caixaNome ? ` (${term.caixaNome})` : ''}`
      : '—';
    openBottomSheet({
      title: 'Terminal',
      bodyHtml: `
        <div class="cds-card" style="margin:0;box-shadow:none">
          <div class="cds-row"><span>Status</span><strong>🟢 Pronto para vender</strong></div>
          <div class="cds-row"><span>Terminal</span><strong>#${escapeHtml(asText(term.id, '—'))}</strong></div>
          <div class="cds-row"><span>Nome</span><strong>${escapeHtml(nome)}</strong></div>
          <div class="cds-row"><span>Caixa</span><strong>${escapeHtml(caixaLabel)}</strong></div>
          <div class="cds-row"><span>Sessão</span><strong>Aberta</strong></div>
          <div class="cds-row"><span>Modo fiscal</span><strong>${isModoFiscalAtivo() ? '🟢 FISCAL' : '⚪ NÃO FISCAL'}</strong></div>
          <p class="cds-muted cds-term-banner__hint" style="margin-top:10px">Renomear terminal: apenas no ERP (SUPER_ADMIN / Gerenciar Caixas).</p>
        </div>
      `,
      actionsHtml: `
        <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" data-sheet-close>Fechar</button>
      `
    });
  });
}

function montarItensResolver(cart) {
  return (cart || []).map((i) => ({
    produto_id: Number(i.id),
    quantidade: Number(i.qtd),
    forma_comercializacao: i.forma_comercializacao || null,
    unidade_comercial: i.unidade_comercial || null
  }));
}

function numeroValido(...vals) {
  for (const v of vals) {
    if (v === null || v === undefined || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return NaN;
}

/**
 * RCM-9.2 — preço oficial exclusivo via resolver-precos (sem forçar VAREJO).
 * Canal/Atacado/Consignado vêm do Motor Oficial (CanalVendaResolver).
 */
async function resolverPrecosOficial(itens, extra = {}) {
  const payload = Object.assign({ itens }, extra || {});
  return window.CDSApi.post('configuracao-comercial/resolver-precos', payload);
}

function aplicarResolverNoCarrinho(cart, resolvido) {
  const byId = {};
  ((resolvido && resolvido.itens) || []).forEach((row) => {
    byId[Number(row.produto_id)] = row;
  });
  const canalMeta = String(
    resolvido?.canal
    || resolvido?.meta?.canal
    || resolvido?.canal_venda
    || ''
  ).toUpperCase() || null;
  const qtdAvaliada = Number(
    resolvido?.quantidade_avaliada
    ?? resolvido?.meta?.quantidade_avaliada
    ?? resolvido?.itens_comerciais
  );
  const erros = [];
  const next = (cart || []).map((item) => {
    if (item.preco_congelado) {
      return Object.assign({}, item, { canal: canalMeta || item.canal });
    }
    const row = byId[Number(item.id)];
    if (!row || row.erro) {
      erros.push(row?.erro || `Resolver sem preço para ${item.nome || item.id}`);
      return item;
    }
    const preco = Number(row.preco_venda);
    if (!Number.isFinite(preco) || preco < 0) {
      erros.push(`Preço inválido no Resolver para ${item.nome || item.id}`);
      return item;
    }
    return Object.assign({}, item, {
      preco,
      forma_comercializacao: String(row.forma_comercializacao || item.forma_comercializacao || '').toUpperCase() || item.forma_comercializacao,
      unidade_comercial: String(row.unidade_comercial || item.unidade_comercial || '').toUpperCase() || item.unidade_comercial,
      canal: String(row.canal || canalMeta || item.canal || 'VAREJO').toUpperCase(),
      preco_origem: row.preco_origem || null,
      tabela_preco_id: row.tabela_preco_id || null,
      tabela_preco_nome: row.tabela_preco_nome || null,
      linha_comercial_id: row.linha_comercial_id || null,
      resolver: 'Motor Oficial'
    });
  });
  return {
    next,
    canal: canalMeta || (next[0] && next[0].canal) || 'VAREJO',
    quantidade_avaliada: Number.isFinite(qtdAvaliada) ? qtdAvaliada : null,
    erros,
    meta: resolvido?.meta || null
  };
}

async function recalcularCarrinhoViaResolver(root, aberto) {
  const cart = loadCart();
  if (!cart.length) {
    saveMeta(Object.assign({}, loadMeta(), { canal: null, quantidade_avaliada: null }));
    paintCart(root, aberto);
    return;
  }
  try {
    const resolvido = await resolverPrecosOficial(montarItensResolver(cart));
    const { next, canal, quantidade_avaliada, erros } = aplicarResolverNoCarrinho(cart, resolvido);
    if (erros.length) {
      showToast(erros[0], 'error');
      return;
    }
    saveCart(next);
    saveMeta(Object.assign({}, loadMeta(), { canal, quantidade_avaliada }));
    paintCart(root, aberto);
  } catch (err) {
    showToast(err.message || 'Não foi possível obter o preço oficial do Resolver.', 'error');
  }
}

/** Regra do carrinho Mobile: PESO/VOLUME/CASQUINHA/KIT viram linha nova; UNIDADE soma no item já existente. */
function incluirItemNoCarrinhoMobile(next, item) {
  const formaUp = String(item.forma_comercializacao || '').toUpperCase();
  if (formaUp === 'PESO' || formaUp === 'VOLUME' || formaUp === 'CASQUINHA' || formaUp === 'KIT') {
    next.push(item);
    return next;
  }
  const existing = next.find((x) => {
    if (String(x.id) !== String(item.id)) return false;
    const fx = String(x.forma_comercializacao || '').toUpperCase();
    return !fx || fx === 'UNIDADE';
  });
  if (existing) existing.qtd = Number(existing.qtd) + Number(item.qtd);
  else next.push(item);
  return next;
}

function unwrapItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.produtos)) return payload.produtos;
  return [];
}

function isCaixaAberto(caixa) {
  if (!caixa || typeof caixa !== 'object' || caixa.__error) return false;
  // API /caixa/aberto devolve resumo { caixa: {...}, dinheiro, ... }
  const c = (caixa.caixa && typeof caixa.caixa === 'object') ? caixa.caixa : caixa;
  return !!(
    c.id
    || c.caixa_id
    || String(c.status || '').toLowerCase() === 'aberto'
    || caixa.aberto === true
  );
}

/** Normaliza resumo de /caixa/aberto para o Mobile ler sessão/operador no topo. */
function normalizeCaixaPayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  if (payload.__error) return payload;
  const nested = payload.caixa && typeof payload.caixa === 'object' ? payload.caixa : null;
  if (!nested) return payload;
  return Object.assign({}, payload, nested, {
    caixa: nested,
    dinheiro: payload.dinheiro,
    digital: payload.digital,
    sessao: payload.sessao || nested.sessao,
    usuario_nome: payload.usuario_nome
      || payload.operador
      || nested.usuario_nome
      || nested.aberto_por_nome
      || nested.operador
      || null,
    saldo_geral: payload.saldo_geral ?? nested.saldo_esperado ?? nested.saldo_geral
  });
}

function parseTab(parts) {
  const t = parts?.[1];
  if (t === 'vendas' || t === 'caixa' || t === 'vender') return t;
  return 'vender';
}

async function askAdminPassword(titulo) {
  const data = await promptSheet({
    title: titulo || 'Senha do administrador',
    confirmLabel: 'Continuar',
    fieldsHtml: fieldHtml({
      name: 'senha_admin',
      label: 'Senha',
      type: 'password',
      required: true,
      autocomplete: 'current-password'
    })
  });
  return data?.senha_admin ? String(data.senha_admin) : null;
}

async function postCaixa(path, body, needsPerm) {
  let payload = getTerminalRequestBody(body || {});
  try {
    return await window.CDSApi.post(path, payload);
  } catch (err) {
    const needsPwd = err?.body?.requer_senha_admin || /senha/i.test(String(err?.message || ''));
    if (!needsPwd && canDoAction(needsPerm)) throw err;
    const senha = await askAdminPassword('Autorização necessária');
    if (!senha) throw new Error('Operação cancelada.');
    payload = getTerminalRequestBody({ ...(body || {}), senha_admin: senha });
    return window.CDSApi.post(path, payload);
  }
}

function renderRegisterTerminal(root) {
  const suggested = getSuggestedTerminalName();
  root.innerHTML = `
    <section class="cds-home-hero cds-m-enter" style="padding-bottom:10px">
      <p class="cds-home-hero__greet">PDV Mobile</p>
      <h1 class="cds-home-hero__name" style="font-size:1.35rem">Registrar Terminal</h1>
      <p class="cds-home-hero__company">Este dispositivo precisa ser registrado na Plataforma CDS.</p>
    </section>
    <article class="cds-card">
      ${fieldHtml({ name: 'nome', label: 'Nome do terminal', value: suggested })}
      <button type="button" class="cds-mobile-btn" id="pdv-term-reg" style="margin-top:14px;width:100%">
        ${icon('check')} Registrar Terminal
      </button>
    </article>
  `;
  root.querySelector('#pdv-term-reg')?.addEventListener('click', async () => {
    const nome = String(root.querySelector('[name="nome"]')?.value || '').trim();
    if (!nome) {
      showToast('Informe um nome para o terminal.', 'warning');
      return;
    }
    try {
      await registerTerminal(nome);
      showToast('Terminal registrado.', 'success');
      window.CDSMobile?.navigate?.('pdv', { replace: true });
    } catch (err) {
      showToast(err.message || 'Falha ao registrar terminal.', 'error');
    }
  });
}

async function fetchCaixa() {
  try {
    const raw = await window.CDSApi.get('caixa/aberto', getTerminalRequestBody());
    if (!raw) return null;
    return normalizeCaixaPayload(raw);
  } catch (err) {
    return { __error: err };
  }
}

async function renderCaixaTab(root, caixa) {
  const aberto = isCaixaAberto(caixa) && !caixa.__error;
  const term = getStoredTerminal();
  const ui = getTerminalUiState({ caixaAberto: aberto });
  const semCaixaVinculado = ui.code === 'SEM_CAIXA' || ui.code === 'INATIVO' || ui.code === 'NAO_REGISTRADO';

  await sincronizarModoFiscalDoServidor().catch(() => null);

  root.innerHTML = `
    ${tabsHtml([
      { id: 'caixa', go: 'pdv/caixa', label: 'Caixa' },
      { id: 'vender', go: 'pdv', label: 'Vender' },
      { id: 'vendas', go: 'pdv/vendas', label: 'Vendas' }
    ], 'caixa')}
    ${terminalStatusBannerHtml(aberto)}
    <article class="cds-card" style="margin-top:12px">
      <div class="cds-row"><span>Terminal</span><strong>${escapeHtml(asText(term.nome, '—'))}</strong></div>
      <div class="cds-row"><span>Terminal ID</span><strong>${escapeHtml(asText(term.id, '—'))}</strong></div>
      <div class="cds-row"><span>Caixa vinculado</span><strong>${term.caixaId ? escapeHtml(`#${term.caixaId}${term.caixaNome ? ` · ${term.caixaNome}` : ''}`) : 'Nenhum'}</strong></div>
      <div class="cds-row"><span>Status</span><strong>${aberto ? 'Aberto' : 'Fechado'}</strong></div>
      ${aberto ? `
        <div class="cds-row"><span>Sessão</span><strong>${escapeHtml(asText(caixa.id || caixa.caixa_id))}</strong></div>
        <div class="cds-row"><span>Operador</span><strong>${escapeHtml(asText(caixa.usuario_nome || caixa.operador || '—'))}</strong></div>
        <div class="cds-row"><span>Esperado</span><strong>${escapeHtml(formatMoney(caixa.dinheiro?.dinheiro_esperado ?? caixa.saldo_geral ?? 0))}</strong></div>
      ` : `
        <p class="cds-muted">${escapeHtml(
          ui.code === 'SEM_CAIXA'
            ? ui.message
            : (caixa?.__error?.message || ui.message || 'Abra o caixa para vender.')
        )}</p>
      `}
    </article>
    <div class="cds-stack" style="margin-top:12px;gap:8px">
      ${!aberto ? `
        <button type="button" class="cds-mobile-btn" id="pdv-abrir" ${canDoAction('abrir_caixa') && !semCaixaVinculado ? '' : 'disabled'}>
          ${icon('coins')} Abrir caixa
        </button>
        ${semCaixaVinculado ? `<p class="cds-muted">${escapeHtml(ui.message)}</p>` : ''}
      ` : `
        <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" id="pdv-sangria" ${canDoAction('sangria_caixa') ? '' : 'disabled'}>Sangria</button>
        <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" id="pdv-suprimento" ${canDoAction('suprimento_caixa') ? '' : 'disabled'}>Suprimento</button>
        <button type="button" class="cds-mobile-btn cds-mobile-btn--danger" id="pdv-fechar" ${canDoAction('fechar_caixa') ? '' : 'disabled'}>Fechar caixa</button>
      `}
    </div>
  `;
  bindGo(root);
  bindTerminalStatusUi(root);

  root.querySelector('#pdv-abrir')?.addEventListener('click', async () => {
    try {
      await syncTerminalFromServer();
      const st = getTerminalUiState({ caixaAberto: false });
      if (st.code === 'SEM_CAIXA' || st.code === 'INATIVO' || st.code === 'NAO_REGISTRADO') {
        showToast(st.message, 'warning');
        window.CDSMobile?.navigate?.('pdv/caixa', { replace: true });
        return;
      }
      let valorInicial = 0;
      try {
        const sug = await window.CDSApi.get('caixa/saldo-inicial-sugerido', getTerminalRequestBody());
        valorInicial = Number(sug?.valor_sugerido || 0);
      } catch (e) { /* 0 */ }
      const data = await promptSheet({
        title: 'Abrir caixa',
        confirmLabel: 'Abrir',
        fieldsHtml: fieldHtml({
          name: 'valor_inicial',
          label: 'Valor inicial',
          value: valorInicial.toFixed(2).replace('.', ','),
          inputmode: 'decimal'
        })
      });
      if (!data) return;
      const valor = Number(String(data.valor_inicial || '0').replace(/\./g, '').replace(',', '.')) || 0;
      await postCaixa('caixa/abrir', { valor_inicial: valor }, 'abrir_caixa');
      showToast('Caixa aberto.', 'success');
      window.CDSMobile?.navigate?.('pdv/caixa', { replace: true });
    } catch (err) {
      const msg = String(err?.message || '');
      if (/não está vinculado|nao esta vinculado|caixa_id|vincule o terminal/i.test(msg)) {
        showToast('Este terminal ainda não está vinculado a um caixa. Vincule o terminal no ERP em Gerenciar Caixas.', 'error');
      } else {
        showToast(err.message || 'Falha ao abrir caixa.', 'error');
      }
    }
  });

  root.querySelector('#pdv-sangria')?.addEventListener('click', async () => {
    try {
      const data = await promptSheet({
        title: 'Sangria',
        confirmLabel: 'Registrar',
        fieldsHtml: [
          fieldHtml({ name: 'valor', label: 'Valor', inputmode: 'decimal', required: true }),
          fieldHtml({ name: 'motivo', label: 'Motivo', required: true })
        ].join('')
      });
      if (!data) return;
      const valor = Number(String(data.valor || '0').replace(/\./g, '').replace(',', '.')) || 0;
      await postCaixa('caixa/sangria', { valor, motivo: data.motivo }, 'sangria_caixa');
      showToast('Sangria registrada.', 'success');
      window.CDSMobile?.navigate?.('pdv/caixa', { replace: true });
    } catch (err) {
      showToast(err.message || 'Falha na sangria.', 'error');
    }
  });

  root.querySelector('#pdv-suprimento')?.addEventListener('click', async () => {
    try {
      const data = await promptSheet({
        title: 'Suprimento',
        confirmLabel: 'Registrar',
        fieldsHtml: [
          fieldHtml({ name: 'valor', label: 'Valor', inputmode: 'decimal', required: true }),
          fieldHtml({ name: 'motivo', label: 'Motivo', required: true })
        ].join('')
      });
      if (!data) return;
      const valor = Number(String(data.valor || '0').replace(/\./g, '').replace(',', '.')) || 0;
      await postCaixa('caixa/suprimento', { valor, motivo: data.motivo }, 'suprimento_caixa');
      showToast('Suprimento registrado.', 'success');
      window.CDSMobile?.navigate?.('pdv/caixa', { replace: true });
    } catch (err) {
      showToast(err.message || 'Falha no suprimento.', 'error');
    }
  });

  root.querySelector('#pdv-fechar')?.addEventListener('click', async () => {
    try {
      const data = await promptSheet({
        title: 'Fechar caixa',
        confirmLabel: 'Fechar',
        fieldsHtml: [
          fieldHtml({ name: 'valor_informado', label: 'Dinheiro contado', inputmode: 'decimal', required: true }),
          fieldHtml({ name: 'observacao', label: 'Observação', type: 'textarea' })
        ].join('')
      });
      if (!data) return;
      const ok = await confirmSheet({
        title: 'Confirmar fechamento',
        message: 'Tem certeza que deseja fechar o caixa?',
        confirmLabel: 'Fechar caixa',
        danger: true
      });
      if (!ok) return;
      const valor = Number(String(data.valor_informado || '0').replace(/\./g, '').replace(',', '.')) || 0;
      await window.CDSApi.post('caixa/fechar', getTerminalRequestBody({
        valor_informado: valor,
        observacao: data.observacao || ''
      }));
      showToast('Caixa fechado.', 'success');
      window.CDSMobile?.navigate?.('pdv/caixa', { replace: true });
    } catch (err) {
      showToast(err.message || 'Falha ao fechar caixa.', 'error');
    }
  });
}

function paintCart(root, aberto, opts = {}) {
  if (opts.recolherResumo) pdvResumoExpandido = false;

  const cart = loadCart();
  const meta = loadMeta();
  const { sub, desconto, acrescimo, total } = cartTotals(cart, meta);
  const host = root.querySelector('#pdv-cart');
  const sticky = root.querySelector('#pdv-sticky');
  if (!host) return;

  host.innerHTML = cart.length
    ? cart.map((i, idx) => `
        <article class="cds-list-card cds-list-card--static">
          <div class="cds-list-card__main">
            <h3 class="cds-list-card__title">${escapeHtml(asText(i.nome, 'Item'))}</h3>
            <p class="cds-list-card__subtitle">${escapeHtml(formatMoney(i.preco))}${i.unidade_comercial || i.forma_comercializacao === 'PESO' || i.forma_comercializacao === 'VOLUME' ? ` / ${escapeHtml(i.unidade_comercial || (i.forma_comercializacao === 'PESO' ? 'KG' : 'L'))}` : ''} · ${escapeHtml(asText(i.codigo))}</p>
            <div class="cds-qty" data-idx="${idx}">
              <button type="button" data-qty="-1" aria-label="Menos">−</button>
              <strong>${escapeHtml(formatNumber(i.qtd, 2))}</strong>
              <button type="button" data-qty="1" aria-label="Mais">+</button>
            </div>
          </div>
          <div class="cds-list-card__side">
            <strong class="cds-list-card__value cds-list-card__value--total">${escapeHtml(formatMoney(Number(i.preco) * Number(i.qtd)))}</strong>
            <button type="button" class="cds-icon-action" data-remove="${idx}" aria-label="Remover">${icon('trash')}</button>
          </div>
        </article>
      `).join('')
    : emptyHtml('Carrinho vazio');

  const canal = String(meta.canal || (cart[0] && cart[0].canal) || '').toUpperCase();
  const itensComerciais = meta.quantidade_avaliada != null && meta.quantidade_avaliada !== ''
    ? Number(meta.quantidade_avaliada)
    : null;

  if (sticky) {
    sticky.classList.toggle('is-expanded', !!pdvResumoExpandido);
    sticky.innerHTML = `
      <div class="cds-pdv-sticky__details" id="pdv-resumo-details">
        ${canal ? `<div class="cds-row"><span>Canal</span><strong class="cds-canal-badge">${escapeHtml(canal)}</strong></div>` : ''}
        ${Number.isFinite(itensComerciais) ? `<div class="cds-row"><span>Itens comerciais</span><strong>${escapeHtml(String(itensComerciais))}</strong></div>` : ''}
        <div class="cds-row"><span>Subtotal</span><strong>${escapeHtml(formatMoney(sub))}</strong></div>
        <div class="cds-row"><span>Desconto</span><strong>- ${escapeHtml(formatMoney(desconto))}</strong></div>
        <div class="cds-row"><span>Acréscimo</span><strong>+ ${escapeHtml(formatMoney(acrescimo))}</strong></div>
        <div class="cds-action-bar cds-pdv-sticky__desc-bar">
          <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" id="pdv-desc" ${!cart.length ? 'disabled' : ''}>Desc/Acr</button>
          <button type="button" class="cds-mobile-btn cds-mobile-btn--ghost" id="pdv-limpar" ${!cart.length ? 'disabled' : ''}>Limpar</button>
        </div>
      </div>
      <div class="cds-pdv-sticky__bar">
        <div class="cds-pdv-sticky__total">
          <span class="cds-pdv-sticky__total-label">TOTAL${canal ? ` · ${escapeHtml(canal)}` : ''}${Number.isFinite(itensComerciais) ? ` · ${escapeHtml(String(itensComerciais))} itens` : ''}</span>
          <strong class="cds-pdv-sticky__total-value">${escapeHtml(formatMoney(total))}</strong>
        </div>
        <div class="cds-pdv-sticky__pay-hit" id="pdv-pay-hit" role="presentation">
          <button
            type="button"
            class="cds-mobile-btn cds-pdv-sticky__pay${!cart.length || !aberto || pdvFinalizandoVenda ? ' is-disabled' : ''}"
            id="pdv-pay"
            data-gate-disabled="${!cart.length || !aberto ? '1' : '0'}"
            ${!cart.length || !aberto || pdvFinalizandoVenda ? 'disabled' : ''}
            aria-busy="${pdvFinalizandoVenda ? 'true' : 'false'}"
          >
            ${icon('cart')} <span class="cds-pdv-sticky__pay-label">${pdvFinalizandoVenda ? 'Finalizando…' : 'Finalizar'}</span>
          </button>
        </div>
      </div>
      <button type="button" class="cds-pdv-sticky__toggle" id="pdv-resumo-toggle" aria-expanded="${pdvResumoExpandido ? 'true' : 'false'}">
        ${pdvResumoExpandido ? '▼ Recolher' : '▲ Expandir'}
      </button>
    `;
  }

  host.querySelectorAll('[data-qty]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const wrap = btn.closest('[data-idx]');
      const idx = Number(wrap?.getAttribute('data-idx'));
      const delta = Number(btn.getAttribute('data-qty'));
      const next = loadCart();
      if (!next[idx]) return;
      const nova = Number(next[idx].qtd) + delta;
      if (nova <= 0) {
        next.splice(idx, 1);
        showToast('Produto removido.', 'info');
      } else {
        next[idx].qtd = nova;
        showToast('Quantidade alterada.', 'info');
      }
      saveCart(next);
      await recalcularCarrinhoViaResolver(root, aberto);
    });
  });

  host.querySelectorAll('[data-remove]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const idx = Number(btn.getAttribute('data-remove'));
      const next = loadCart();
      next.splice(idx, 1);
      saveCart(next);
      showToast('Produto removido.', 'info');
      await recalcularCarrinhoViaResolver(root, aberto);
    });
  });

  sticky?.querySelector('#pdv-resumo-toggle')?.addEventListener('click', () => {
    pdvResumoExpandido = !pdvResumoExpandido;
    sticky.classList.toggle('is-expanded', pdvResumoExpandido);
    const toggle = sticky.querySelector('#pdv-resumo-toggle');
    if (toggle) {
      toggle.setAttribute('aria-expanded', pdvResumoExpandido ? 'true' : 'false');
      toggle.textContent = pdvResumoExpandido ? '▼ Recolher' : '▲ Expandir';
    }
  });

  sticky?.querySelector('#pdv-desc')?.addEventListener('click', async () => {
    const cur = loadMeta();
    const data = await promptSheet({
      title: 'Desconto / Acréscimo',
      confirmLabel: 'Aplicar',
      fieldsHtml: [
        fieldHtml({ name: 'desconto', label: 'Desconto (R$)', value: cur.desconto || 0, inputmode: 'decimal' }),
        fieldHtml({ name: 'acrescimo', label: 'Acréscimo (R$)', value: cur.acrescimo || 0, inputmode: 'decimal' })
      ].join('')
    });
    if (!data) return;
    saveMeta(Object.assign({}, cur, {
      desconto: Number(String(data.desconto || '0').replace(/\./g, '').replace(',', '.')) || 0,
      acrescimo: Number(String(data.acrescimo || '0').replace(/\./g, '').replace(',', '.')) || 0
    }));
    paintCart(root, aberto);
  });

  sticky?.querySelector('#pdv-limpar')?.addEventListener('click', async () => {
    const ok = await confirmSheet({
      title: 'Limpar carrinho',
      message: 'Remover todos os itens do carrinho?',
      confirmLabel: 'Limpar'
    });
    if (!ok) return;
    saveCart([]);
    saveMeta({});
    showToast('Carrinho limpo.', 'info');
    paintCart(root, aberto);
  });

  // Hit-area recebe toque mesmo com botão :disabled → feedback sem return silencioso
  sticky?.querySelector('#pdv-pay-hit')?.addEventListener('click', (ev) => {
    ev.preventDefault();
    if (pdvFinalizandoVenda) {
      showToast('Finalizando venda...', 'info');
      return;
    }
    if (!aberto) {
      showToast('Abra o caixa antes de finalizar a venda.', 'warning');
      return;
    }
    const cartNow = loadCart();
    if (!cartNow.length) {
      showToast('Adicione pelo menos um produto para finalizar a venda.', 'warning');
      return;
    }
    iniciarPagamento(root, aberto);
  });
}

async function tryTef(forma, valor) {
  try {
    await window.CDSApi.get('tef/status');
  } catch (e) {
    showToast('TEF indisponível neste terminal. Use PIX, dinheiro ou cartão.', 'warning');
    return null;
  }
  try {
    return await window.CDSApi.post('tef/pagar', getTerminalRequestBody({
      forma_pagamento: forma,
      valor
    }));
  } catch (err) {
    showToast(err.message || 'Falha no TEF. Tente outra forma de pagamento.', 'error');
    return null;
  }
}

async function iniciarPagamento(root, aberto) {
  if (pdvFinalizandoVenda) {
    showToast('Finalizando venda...', 'info');
    return;
  }
  if (!aberto) {
    showToast('Abra o caixa antes de finalizar a venda.', 'warning');
    return;
  }
  const cart = loadCart();
  if (!cart.length) {
    showToast('Adicione pelo menos um produto para finalizar a venda.', 'warning');
    return;
  }
  const { total } = cartTotals(cart);
  let formaEscolhida = '';

  const sheet = openBottomSheet({
    title: 'Forma de pagamento',
    panelClass: 'cds-sheet__panel--pay',
    bodyHtml: `
      <p class="cds-muted">Total ${escapeHtml(formatMoney(total))}</p>
      <p class="cds-fiscal-pay-hint">${isModoFiscalAtivo() ? '🟢 FISCAL — NFC-e conforme módulo oficial' : '⚪ NÃO FISCAL — sem emissão'}</p>
      <p class="cds-pay-hint">Toque na forma e confirme.</p>
      <div class="cds-pay-grid" role="group" aria-label="Formas de pagamento">
        <button type="button" class="cds-mobile-btn cds-pay-opt" data-pay="dinheiro">Dinheiro</button>
        <button type="button" class="cds-mobile-btn cds-pay-opt" data-pay="pix">PIX</button>
        <button type="button" class="cds-mobile-btn cds-pay-opt" data-pay="cartao_debito">Débito</button>
        <button type="button" class="cds-mobile-btn cds-pay-opt" data-pay="cartao_credito">Crédito</button>
        <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary cds-pay-opt" data-pay="tef">TEF</button>
      </div>
    `,
    actionsHtml: `
      <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" data-sheet-close>Cancelar</button>
      <button type="button" class="cds-mobile-btn" data-pay-confirm disabled>Confirmar</button>
    `
  });

  const confirmBtn = sheet.querySelector('[data-pay-confirm]');
  const marcarEscolha = (forma, origemBtn) => {
    formaEscolhida = forma || '';
    sheet.querySelectorAll('[data-pay]').forEach((b) => {
      b.classList.toggle('is-selected', b === origemBtn);
    });
    if (confirmBtn) confirmBtn.disabled = !formaEscolhida;
  };

  const confirmarPagamento = async () => {
    if (pdvFinalizandoVenda) {
      showToast('Finalizando venda...', 'info');
      return;
    }
    const forma = formaEscolhida;
    if (!forma) {
      showToast('Selecione uma forma de pagamento.', 'warning');
      return;
    }
    const emitir = emitirFiscalDaVendaAtual();
    const cartAtual = loadCart();
    if (!cartAtual.length) {
      showToast('Adicione pelo menos um produto para finalizar a venda.', 'warning');
      closeBottomSheet();
      return;
    }
    const totais = cartTotals(cartAtual);
    closeBottomSheet();
    await finalizarVenda({
      forma,
      emitir,
      total: totais.total,
      desconto: totais.desconto,
      cart: cartAtual,
      root,
      aberto
    });
  };

  sheet.addEventListener('click', (ev) => {
    const payBtn = ev.target.closest('[data-pay]');
    if (payBtn && sheet.contains(payBtn)) {
      ev.preventDefault();
      ev.stopPropagation();
      marcarEscolha(payBtn.getAttribute('data-pay'), payBtn);
      return;
    }
    if (ev.target.closest('[data-pay-confirm]')) {
      ev.preventDefault();
      ev.stopPropagation();
      confirmarPagamento();
    }
  });
}

async function finalizarVenda({ forma, emitir, total, desconto, cart, root, aberto }) {
  if (pdvFinalizandoVenda) {
    showToast('Finalizando venda...', 'info');
    return;
  }

  if (!Array.isArray(cart) || !cart.length) {
    showToast('Adicione pelo menos um produto para finalizar a venda.', 'warning');
    return;
  }
  if (aberto === false) {
    showToast('Abra o caixa antes de finalizar a venda.', 'warning');
    return;
  }
  if (!forma) {
    showToast('Selecione uma forma de pagamento.', 'warning');
    return;
  }

  try {
    let formaFinal = forma === 'tef' ? 'cartao_credito' : forma;
    let tefPayload = null;
    if (forma === 'tef') {
      tefPayload = await tryTef('credito', total);
      if (!tefPayload) return;
      formaFinal = 'cartao';
    }

    let valorRecebido = total;
    let troco = 0;
    if (formaFinal === 'dinheiro') {
      const data = await promptSheet({
        title: 'Dinheiro',
        confirmLabel: 'Confirmar',
        fieldsHtml: fieldHtml({
          name: 'valor_recebido',
          label: 'Valor recebido',
          value: total.toFixed(2).replace('.', ','),
          inputmode: 'decimal'
        })
      });
      if (!data) return;
      valorRecebido = Number(String(data.valor_recebido || '0').replace(/\./g, '').replace(',', '.')) || 0;
      if (valorRecebido < total) {
        showToast('Valor recebido insuficiente.', 'warning');
        return;
      }
      troco = Number((valorRecebido - total).toFixed(2));
    }

    // Lock apenas na gravação (não no sheet intermediário de pagamento)
    pdvFinalizandoVenda = true;
    setFinalizarBusyUi(true);
    showToast('Finalizando venda...', 'info');

    const itens = cart.map((i) => {
      const preco = numeroValido(i.preco, i.preco_unitario, i.preco_venda);
      const qtd = numeroValido(i.qtd, i.quantidade);
      return {
        produto_id: i.id,
        quantidade: qtd,
        preco_unitario: preco,
        desconto_percentual: 0,
        tipo_venda: i.tipo_venda || 'PESO',
        forma_comercializacao: i.forma_comercializacao || null,
        unidade_comercial: i.unidade_comercial || null,
        quantidade_bolas: i.quantidade_bolas != null ? Number(i.quantidade_bolas) : null,
        sabores: Array.isArray(i.sabores) ? i.sabores : undefined,
        kit_id: i.kit_id || null,
        kit_itens: Array.isArray(i.kit_itens) ? i.kit_itens : undefined
      };
    });
    if (itens.some((it) => !Number.isFinite(it.preco_unitario) || it.preco_unitario < 0)) {
      showToast('Preço do item não encontrado. Remova o produto e adicione de novo.', 'error');
      return;
    }
    if (itens.some((it) => !Number.isFinite(it.quantidade) || it.quantidade <= 0)) {
      showToast('Quantidade do item inválida. Ajuste o carrinho e tente novamente.', 'warning');
      return;
    }

    const preview = await window.CDSApi.post(
      'vendas/pre-calcular-distribuicao',
      getTerminalRequestBody({ itens, emitir_fiscal: emitir })
    );
    const valorFiscal = Number(preview?.valor_fiscal ?? preview?.total_fiscal ?? (emitir ? total : 0));
    const valorNaoFiscal = Number(preview?.valor_nao_fiscal ?? preview?.total_nao_fiscal ?? (emitir ? 0 : total));
    const distList = Array.isArray(preview?.itens) ? preview.itens : [];

    const payload = getTerminalRequestBody({
      itens: itens.map((orig, idx) => {
        const dist = distList[idx] || {};
        const qtd = numeroValido(
          orig.quantidade,
          dist.quantidade,
          dist.qtd,
          Number(dist.quantidade_fiscal || 0) + Number(dist.quantidade_nao_fiscal || 0)
        );
        const preco = numeroValido(orig.preco_unitario, dist.preco_unitario, dist.preco);
        const subtotalCalc = Number.isFinite(Number(dist.subtotal))
          ? Number(dist.subtotal)
          : Number(((Number.isFinite(qtd) ? qtd : 0) * (Number.isFinite(preco) ? preco : 0)).toFixed(2));
        return {
          produto_id: orig.produto_id,
          quantidade: qtd,
          preco_unitario: preco,
          subtotal: subtotalCalc,
          desconto_percentual: orig.desconto_percentual || 0,
          item_fiscal: dist.item_fiscal,
          quantidade_fiscal: dist.quantidade_fiscal,
          quantidade_nao_fiscal: dist.quantidade_nao_fiscal,
          valor_fiscal: dist.valor_fiscal,
          valor_nao_fiscal: dist.valor_nao_fiscal,
          forma_comercializacao: orig.forma_comercializacao || dist.forma_comercializacao || null,
          unidade_comercial: orig.unidade_comercial || dist.unidade_comercial || null,
          kit_id: orig.kit_id || dist.kit_id || null,
          kit_itens: orig.kit_itens || dist.kit_itens || undefined,
          sabores: orig.sabores || dist.sabores || undefined,
          quantidade_bolas: orig.quantidade_bolas != null ? orig.quantidade_bolas : dist.quantidade_bolas,
          tipo_venda: orig.tipo_venda
        };
      }),
      total,
      desconto,
      forma_pagamento: formaFinal,
      valor_recebido: valorRecebido,
      troco,
      canal_venda: String(loadMeta().canal || 'VAREJO').toUpperCase(),
      origem_pdv: 'PDV_MOBILE',
      emitir_fiscal: !!emitir,
      valor_fiscal: valorFiscal,
      valor_nao_fiscal: valorNaoFiscal,
      pagamentos: [{
        forma_pagamento: formaFinal,
        valor: total,
        tipo_recebimento: emitir ? 'fiscal' : 'nao_fiscal',
        ...(tefPayload ? { tef: tefPayload } : {})
      }]
    });

    const resp = await window.CDSApi.post('vendas', payload);
    const vendaBody = resp?.data && typeof resp.data === 'object' && !Array.isArray(resp.data)
      ? { ...resp, ...resp.data }
      : resp;
    const vendaId = vendaBody?.venda_id || vendaBody?.id || vendaBody?.vendaId || vendaBody?.venda?.id;
    const valorFiscalVenda = Number(
      vendaBody?.valor_fiscal ?? valorFiscal
    );

    if (vendaBody?.status_pagamento === 'aguardando_nao_fiscal' && vendaId) {
      await window.CDSApi.post(
        `vendas/${vendaId}/pagamento-nao-fiscal`,
        getTerminalRequestBody({
          forma_pagamento: formaFinal,
          valor: Number(vendaBody?.valor_nao_fiscal ?? valorNaoFiscal) || total,
          valor_recebido: valorRecebido
        })
      );
    }

    // Só limpa carrinho após confirmação da API
    saveCart([]);
    saveMeta({});

    let emitirRaw = null;
    if (emitir && vendaId && valorFiscalVenda > 0) {
      try {
        emitirRaw = await window.CDSApi.post(
          `fiscal/emitir/venda/${vendaId}`,
          {},
          null,
          { timeoutMs: 180000 }
        );
        const stNf = String(emitirRaw?.status || emitirRaw?.fiscal?.status || '').toLowerCase();
        if (stNf === 'autorizada' || emitirRaw?.success === true || emitirRaw?.danfeHtml) {
          showToast(`Venda finalizada com sucesso. #${vendaId} · NFC-e emitida.`, 'success');
        } else if (stNf === 'sem_itens_fiscais') {
          showToast(`Venda #${vendaId} finalizada. Sem itens fiscais para NFC-e.`, 'info');
        } else {
          showToast(
            'Venda registrada, mas a emissão fiscal precisa de atenção.'
              + (emitirRaw?.message ? ` (${emitirRaw.message})` : ''),
            'warning'
          );
        }
      } catch (nfErr) {
        showToast(
          'Venda registrada, mas a emissão fiscal precisa de atenção.'
            + (nfErr?.message ? ` (${nfErr.message})` : ''),
          'warning'
        );
      }
    } else {
      const trocoMsg = formaFinal === 'dinheiro' && troco > 0
        ? ` Troco: ${formatMoney(troco)}.`
        : '';
      const fiscalPendente = emitir && vendaId && !(valorFiscalVenda > 0);
      showToast(
        (vendaId
          ? `Venda finalizada com sucesso. #${vendaId}.`
          : 'Venda finalizada com sucesso.')
          + trocoMsg
          + (fiscalPendente ? ' Sem saldo fiscal nos itens — NFC-e não emitida.' : ''),
        fiscalPendente ? 'info' : 'success'
      );
    }

    if (vendaId) {
      try {
        await mostrarCupomAposVenda(vendaId, emitirRaw);
      } catch (cupomErr) {
        showToast(cupomErr?.message || 'Não foi possível abrir o cupom.', 'warning');
      }
    }

    if (root && typeof aberto === 'boolean') {
      paintCart(root, aberto);
    }

    window.CDSMobile?.navigate?.('pdv', { replace: true });
  } catch (err) {
    const msg = String(err?.message || '').trim();
    if (err?.status === 401 || err?.status === 403 || /sessão expirou|sessao expirou/i.test(msg)) {
      showToast('Sua sessão expirou. Entre novamente para continuar.', 'error');
    } else if (msg) {
      showToast(`${msg} O carrinho foi preservado.`, 'error');
    } else {
      showToast('Não foi possível finalizar a venda. Tente novamente. O carrinho foi preservado.', 'error');
    }
  } finally {
    pdvFinalizandoVenda = false;
    setFinalizarBusyUi(false);
    if (root && typeof aberto === 'boolean') {
      try { paintCart(root, aberto); } catch (_) { /* ignore */ }
    }
  }
}

async function renderVenderTab(root, caixa) {
  const aberto = isCaixaAberto(caixa) && !caixa.__error;
  pdvResumoExpandido = false;

  await sincronizarModoFiscalDoServidor().catch(() => null);

  root.innerHTML = `
    ${tabsHtml([
      { id: 'caixa', go: 'pdv/caixa', label: 'Caixa' },
      { id: 'vender', go: 'pdv', label: 'Vender' },
      { id: 'vendas', go: 'pdv/vendas', label: 'Vendas' }
    ], 'vender')}
    ${terminalStatusBannerHtml(aberto)}
    ${sectionTitleHtml('Buscar / consulta preço')}
    ${searchBarHtml('Código, EAN ou nome', 'pdv-search')}
    <p class="cds-muted" style="margin:4px 0 0">Preço oficial vem do Resolver · catálogo é só referência</p>
    <div class="cds-quick-grid" style="grid-template-columns:1fr 1fr;margin:8px 0">
      <button type="button" class="cds-quick" data-go="clientes/novo">Cadastro rápido</button>
      <button type="button" class="cds-quick" id="pdv-muc-scan">MUC / barras</button>
    </div>
    <button type="button" class="cds-quick" id="pdv-venda-linha" style="display:none;width:100%;margin:0 0 8px">
      Vender por Linha
    </button>
    <div id="pdv-results">${emptyHtml('Busque um produto')}</div>
    ${sectionTitleHtml('Carrinho')}
    <div id="pdv-cart"></div>
    <div class="cds-pdv-sticky" id="pdv-sticky"></div>
  `;
  bindGo(root);
  paintCart(root, aberto);
  bindTerminalStatusUi(root);
  bindVendaPorLinhaMobile(root, aberto);

  const results = root.querySelector('#pdv-results');
  // Foco inicial para scanner / digitação contínua
  refocusPdvSearch(root.querySelector('#pdv-search'));
  root.querySelector('#pdv-search')?.addEventListener('input', debounce(async (e) => {
    const q = String(e.target.value || '').trim();
    if (q.length < 1) {
      results.innerHTML = emptyHtml('Busque um produto');
      return;
    }
    results.innerHTML = loadingHtml('Buscando…');
    try {
      let payload;
      try {
        payload = await window.CDSApi.get('produtos/consulta-pdv/buscar', { q, termo: q, busca: q });
      } catch (e1) {
        payload = await window.CDSApi.get('produtos/search', { q, limite: 20, contexto: 'pdv' });
      }
      const items = unwrapItems(payload);
      results.innerHTML = items.length
        ? items.map((p) => `
            <button type="button" class="cds-list-card cds-list-card--pdv-pick" data-pid="${escapeHtml(p.id)}"
              data-nome="${escapeHtml(asText(p.nome))}"
              data-codigo="${escapeHtml(asText(p.codigo || p.codigo_barras))}"
              data-preco="${escapeHtml(p.preco_venda ?? p.preco ?? 0)}"
              data-categoria="${escapeHtml(p.categoria_id || '')}"
              data-categoria-nome="${escapeHtml(asText(p.categoria_nome || p.categoria || p.linha_nome || ''))}"
              data-eh-kit="${Number(p.eh_kit || 0) === 1 || String(p.forma_comercializacao || '').toUpperCase() === 'KIT' ? '1' : '0'}"
              data-forma="${escapeHtml(String(p.forma_comercializacao || '').toUpperCase())}">
              <div class="cds-list-card__main">
                <h3 class="cds-list-card__title">${escapeHtml(asText(p.nome))}</h3>
                <p class="cds-list-card__subtitle">${escapeHtml(asText(p.codigo || p.codigo_barras))} · ${escapeHtml(formatMoney(p.preco_venda ?? p.preco ?? 0))}</p>
              </div>
              <div class="cds-list-card__side">
                <strong class="cds-list-card__value">${escapeHtml(formatMoney(p.preco_venda ?? p.preco ?? 0))}</strong>
              </div>
            </button>
          `).join('')
        : emptyHtml('Nenhum produto');

      results.querySelectorAll('[data-pid]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const searchEl = root.querySelector('#pdv-search');
          const pid = btn.getAttribute('data-pid');
          const nome = btn.getAttribute('data-nome');
          const codigo = btn.getAttribute('data-codigo');
          let preco = Number(btn.getAttribute('data-preco') || 0);
          let forma = String(btn.getAttribute('data-forma') || '').toUpperCase() || null;
          let unidade = null;
          let canal = null;
          let snap = null;
          const ehKitAttr = Number(btn.getAttribute('data-eh-kit') || 0) === 1;
          const categoriaNome = btn.getAttribute('data-categoria-nome') || '';

          try {
            const cartPreview = loadCart();
            const itensCtx = montarItensResolver(cartPreview).concat([{
              produto_id: Number(pid),
              quantidade: 1
            }]);
            // RCM-9.2: NÃO forçar canal — Motor Oficial / CanalVendaResolver
            const resolvido = await resolverPrecosOficial(itensCtx);
            const row = ((resolvido && resolvido.itens) || []).find(
              (r) => Number(r.produto_id) === Number(pid)
            ) || ((resolvido && resolvido.itens) || [])[0];
            if (!row || row.erro) {
              showToast(row?.erro || 'Resolver não retornou preço oficial para este produto.', 'error');
              refocusPdvSearch(searchEl);
              return;
            }
            if (!Number.isFinite(Number(row.preco_venda))) {
              showToast('Preço oficial inválido no Resolver.', 'error');
              refocusPdvSearch(searchEl);
              return;
            }
            preco = Number(row.preco_venda);
            forma = String(row.forma_comercializacao || forma || '').toUpperCase() || null;
            unidade = String(row.unidade_comercial || '').toUpperCase() || null;
            canal = String(row.canal || resolvido?.canal || resolvido?.meta?.canal || 'VAREJO').toUpperCase();
            snap = {
              preco_origem: row.preco_origem || null,
              tabela_preco_id: row.tabela_preco_id || null,
              tabela_preco_nome: row.tabela_preco_nome || null,
              linha_comercial_id: row.linha_comercial_id || null
            };
          } catch (e) {
            showToast(e.message || 'Não foi possível obter o preço oficial do Resolver.', 'error');
            refocusPdvSearch(searchEl);
            return;
          }

          let kit = null;
          let casquinha = null;
          let precoCongelado = false;

          if (forma === 'KIT' || ehKitAttr) {
            forma = 'KIT';
            try {
              kit = await window.CDSApi.get(`kits/produto/${pid}`);
              const tipoFormacao = String(kit?.tipo_formacao || 'FIXO').toUpperCase();
              if (tipoFormacao === 'FIXO' && kit?.preco != null && Number(kit.preco) > 0) {
                preco = Number(kit.preco);
                precoCongelado = true;
              }
              // SOMA / lista: mantém preço do Resolver
            } catch (e) {
              showToast(e.message || 'Kit não encontrado', 'warning');
              refocusPdvSearch(searchEl);
              return;
            }
          }

          if (forma === 'CASQUINHA') {
            try {
              const saboresCat = await window.CDSApi.get('casquinha-sabores', { ativos: 1 });
              const lista = Array.isArray(saboresCat) ? saboresCat : (saboresCat?.itens || []);
              let bolasMax = 4;
              let permitirRepetir = true;
              try {
                if (btn.getAttribute('data-categoria')) {
                  const com = await window.CDSApi.get(`categorias/${btn.getAttribute('data-categoria')}/comercial`);
                  if (com?.casquinha) {
                    bolasMax = Number(com.casquinha.bolas_max || 4);
                    permitirRepetir = com.casquinha.permitir_repetir !== false;
                  }
                }
              } catch (_) { /* defaults */ }
              casquinha = { bolasMax, permitirRepetir, sabores: lista };
            } catch (e) {
              showToast(e.message || 'Falha ao carregar sabores', 'warning');
              refocusPdvSearch(searchEl);
              return;
            }
          }

          const result = await openPdvAddProdutoSheet({
            nome,
            codigo,
            preco,
            forma: forma || 'UNIDADE',
            unidade,
            canal,
            categoriaNome,
            kit,
            casquinha
          });

          if (!result) {
            refocusPdvSearch(searchEl);
            return;
          }

          if (forma === 'CASQUINHA' && result.sabores) {
            try {
              await window.CDSApi.post('casquinha-sabores/validar', {
                quantidade_bolas: result.quantidadeBolas,
                sabores: result.sabores,
                bolas_min: 1,
                bolas_max: casquinha?.bolasMax || 4,
                permitir_repetir: casquinha?.permitirRepetir !== false
              });
            } catch (e) {
              showToast(e.message || 'Montagem inválida', 'warning');
              refocusPdvSearch(searchEl);
              return;
            }
          }

          const itemForma = result.forma || forma;
          const item = {
            id: pid,
            nome,
            codigo,
            preco: result.preco,
            qtd: result.qtd,
            forma_comercializacao: itemForma,
            unidade_comercial: result.unidade || unidade || (
              itemForma === 'PESO' ? 'KG'
                : (itemForma === 'VOLUME' ? 'LITRO'
                  : (itemForma === 'CASQUINHA' || itemForma === 'KIT' ? 'UN' : null))
            ),
            tipo_venda: result.tipoVenda,
            canal: result.canal || canal,
            quantidade_bolas: result.quantidadeBolas,
            sabores: result.sabores,
            kit_id: result.kitId,
            kit_itens: result.kitItens,
            preco_origem: snap && snap.preco_origem,
            tabela_preco_id: snap && snap.tabela_preco_id,
            tabela_preco_nome: snap && snap.tabela_preco_nome,
            linha_comercial_id: snap && snap.linha_comercial_id,
            preco_congelado: precoCongelado,
            resolver: 'Motor Oficial'
          };
          const next = loadCart();
          incluirItemNoCarrinhoMobile(next, item);
          saveCart(next);
          showToast('Produto adicionado.', 'success');
          await recalcularCarrinhoViaResolver(root, aberto);
          if (root.querySelector('#pdv-sticky')) {
            paintCart(root, aberto, { recolherResumo: true });
          }
          clearPdvSearchAfterAdd(root);
        });
      });
    } catch (err) {
      results.innerHTML = errorHtml(err.message, err.status);
    }
  }, 280));

  root.querySelector('#pdv-muc-scan')?.addEventListener('click', async () => {
    const data = await promptSheet({
      title: 'Consulta MUC / barras',
      confirmLabel: 'Buscar',
      fieldsHtml: fieldHtml({ name: 'codigo', label: 'Código de barras MUC', required: true, inputmode: 'numeric' })
    });
    if (!data?.codigo) return;
    try {
      const muc = await window.CDSApi.get(`produtos/muc/barras/${encodeURIComponent(data.codigo)}`, { contexto: 'pdv' });
      const p = muc?.produto || muc?.data || muc;
      if (!p?.id && !muc?.produto_id) {
        showToast('MUC não encontrado.', 'warning');
        return;
      }
      const pid = p.id || muc.produto_id;
      const nome = p.nome || muc.descricao || `Produto ${pid}`;
      const qtdMuc = Number(muc.quantidade || 1);
      let preco = null;
      let snap = null;
      let forma = String(p.forma_comercializacao || muc.forma_comercializacao || '').toUpperCase() || null;
      let unidade = String(muc.unidade_comercial || p.unidade_comercial || '').toUpperCase() || null;
      let canal = null;
      try {
        const cartPreview = loadCart();
        const itensCtx = montarItensResolver(cartPreview).concat([{
          produto_id: Number(pid),
          quantidade: qtdMuc
        }]);
        const resolvido = await resolverPrecosOficial(itensCtx);
        const row = ((resolvido && resolvido.itens) || []).find(
          (r) => Number(r.produto_id) === Number(pid)
        ) || ((resolvido && resolvido.itens) || [])[0];
        if (!row || row.erro || !Number.isFinite(Number(row.preco_venda))) {
          showToast(row?.erro || 'Resolver não retornou preço oficial para o MUC.', 'error');
          return;
        }
        preco = Number(row.preco_venda);
        forma = String(row.forma_comercializacao || forma || '').toUpperCase() || forma;
        unidade = String(row.unidade_comercial || unidade || '').toUpperCase() || unidade;
        canal = String(row.canal || resolvido?.canal || 'VAREJO').toUpperCase();
        snap = {
          preco_origem: row.preco_origem,
          tabela_preco_id: row.tabela_preco_id,
          tabela_preco_nome: row.tabela_preco_nome,
          linha_comercial_id: row.linha_comercial_id
        };
      } catch (e) {
        showToast(e.message || 'Não foi possível obter o preço oficial do Resolver.', 'error');
        return;
      }
      const next = loadCart();
      const existing = next.find((x) => String(x.id) === String(pid));
      if (existing) existing.qtd = Number(existing.qtd) + qtdMuc;
      else {
        next.push({
          id: pid,
          nome,
          codigo: data.codigo,
          preco,
          qtd: qtdMuc,
          forma_comercializacao: forma,
          unidade_comercial: unidade,
          canal,
          preco_origem: snap && snap.preco_origem,
          tabela_preco_id: snap && snap.tabela_preco_id,
          tabela_preco_nome: snap && snap.tabela_preco_nome,
          linha_comercial_id: snap && snap.linha_comercial_id,
          resolver: 'Motor Oficial'
        });
      }
      saveCart(next);
      showToast('Produto adicionado.', 'success');
      await recalcularCarrinhoViaResolver(root, aberto);
      paintCart(root, aberto, { recolherResumo: true });
      clearPdvSearchAfterAdd(root);
    } catch (err) {
      showToast(err.message || 'Falha na consulta MUC', 'error');
    }
  });
}

async function renderVendasTab(root) {
  root.innerHTML = `
    ${tabsHtml([
      { id: 'caixa', go: 'pdv/caixa', label: 'Caixa' },
      { id: 'vender', go: 'pdv', label: 'Vender' },
      { id: 'vendas', go: 'pdv/vendas', label: 'Vendas' }
    ], 'vendas')}
    <div id="pdv-vendas-list" style="margin-top:12px">${loadingHtml('Carregando vendas…')}</div>
  `;
  bindGo(root);
  const list = root.querySelector('#pdv-vendas-list');
  try {
    let rows = await window.CDSApi.get('vendas', { limite: 40 });
    if (!Array.isArray(rows)) rows = rows?.data || rows?.vendas || [];
    list.innerHTML = rows.length
      ? rows.slice(0, 40).map((v) => listCardHtml({
          go: `pdv/venda/${v.id}`,
          title: `Venda #${asText(v.id)}`,
          value: formatMoney(v.total ?? v.valor_total ?? 0),
          status: v.status || (v.cancelada ? 'cancelada' : 'ok'),
          meta: [
            formatDateTime(v.data || v.created_at || v.criado_em),
            asText(v.forma_pagamento, ''),
            String(v.origem_pdv || '').toUpperCase() === 'PDV_MOBILE' ? 'PDV Mobile' : ''
          ].filter(Boolean)
        })).join('')
      : emptyHtml('Nenhuma venda recente');
    bindGo(list);
  } catch (err) {
    list.innerHTML = errorHtml(err.message, err.status);
  }
}

async function renderVendaDetalhe(root, id) {
  root.innerHTML = loadingHtml('Carregando venda…');
  try {
    let venda;
    try {
      venda = await window.CDSApi.get(`vendas/${id}/detalhes`);
    } catch (e) {
      venda = await window.CDSApi.get(`vendas/${id}`);
    }
    const v = venda?.venda || venda || {};
    const itens = venda?.itens || v.itens || [];
    root.innerHTML = `
      <button type="button" class="cds-back" data-go="pdv/vendas">${icon('chevronLeft')} Voltar</button>
      <article class="cds-card">
        <div class="cds-row"><span>Venda</span><strong>#${escapeHtml(asText(v.id || id))}</strong></div>
        <div class="cds-row"><span>Total</span><strong>${escapeHtml(formatMoney(v.total ?? v.valor_total ?? 0))}</strong></div>
        <div class="cds-row"><span>Pagamento</span><strong>${escapeHtml(asText(v.forma_pagamento, '—'))}</strong></div>
        <div class="cds-row"><span>Origem</span><strong>${escapeHtml(String(v.origem_pdv || '').toUpperCase() === 'PDV_MOBILE' ? 'PDV Mobile' : (v.origem_pdv === 'PDV_DESKTOP' ? 'PDV Desktop' : asText(v.origem_pdv, '—')))}</strong></div>
        <div class="cds-row"><span>Status</span><strong>${escapeHtml(asText(v.status, '—'))}</strong></div>
      </article>
      ${sectionTitleHtml('Itens')}
      <div>
        ${itens.length
          ? itens.map((i) => listCardHtml({
              title: asText(i.produto_nome || i.nome, 'Item'),
              subtitle: `Qtd ${formatNumber(i.quantidade, 2)}`,
              value: formatMoney(i.subtotal ?? (Number(i.preco_unitario) * Number(i.quantidade)))
            })).join('')
          : emptyHtml('Sem itens')}
      </div>
      <div class="cds-action-bar">
        ${canDoAction('emitir_nfce') ? `<button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" id="vd-nfce">Emitir NFC-e</button>` : ''}
        <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" id="vd-danfe">DANFE</button>
        <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" id="vd-share-danfe">Compartilhar DANFE</button>
        <button type="button" class="cds-mobile-btn cds-mobile-btn--ghost" id="vd-share-xml">Compartilhar XML</button>
        ${canDoAction('cancelar_nfce') ? `<button type="button" class="cds-mobile-btn cds-mobile-btn--danger" id="vd-cancel-nfce">Cancelar NFC-e</button>` : ''}
        <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" id="vd-devolver">Devolver</button>
        ${canDoAction('cancelar_nfce') ? `<button type="button" class="cds-mobile-btn cds-mobile-btn--danger" id="vd-cancel">Cancelar venda</button>` : ''}
        <button type="button" class="cds-mobile-btn cds-mobile-btn--ghost" data-go="clientes/novo">Cadastro rápido cliente</button>
      </div>
    `;
    bindGo(root);

    async function fetchDanfeHtml() {
      return fetchDanfeHtmlCupom(id);
    }

    async function findNotaVenda() {
      try {
        const notas = await window.CDSApi.get('fiscal/notas', { todas: 1 });
        const list = Array.isArray(notas) ? notas : [];
        return list.find((n) => Number(n.venda_id) === Number(id)) || null;
      } catch (e) {
        return null;
      }
    }

    root.querySelector('#vd-nfce')?.addEventListener('click', async () => {
      try {
        const raw = await window.CDSApi.post(`fiscal/emitir/venda/${id}`, {}, null, { timeoutMs: 180000 });
        await mostrarCupomAposEmissao(raw, { vendaIdFallback: id });
      } catch (err) {
        // Mesmo com erro de emissão, tenta exibir cupom não fiscal se a venda existir
        try {
          const vendaRaw = await window.CDSApi.get(`vendas/${id}`);
          const venda = vendaRaw?.data?.venda || vendaRaw?.data || vendaRaw;
          if (venda) {
            const html = montarHtmlCupomNaoFiscal(id, venda);
            await mostrarCupomNoCelular(html, {
              title: 'Cupom não fiscal',
              fileName: `cupom-nao-fiscal-${id}.html`
            });
            return;
          }
        } catch (e2) { /* ignore */ }
        showToast(err.message || 'Falha na NFC-e', 'error');
      }
    });

    root.querySelector('#vd-danfe')?.addEventListener('click', async () => {
      try {
        const html = await fetchDanfeHtml();
        await mostrarCupomNoCelular(html, {
          title: 'Cupom fiscal (DANFE)',
          fileName: `danfe-venda-${id}.html`
        });
      } catch (err) {
        try {
          const vendaRaw = await window.CDSApi.get(`vendas/${id}`);
          const venda = vendaRaw?.data?.venda || vendaRaw?.data || vendaRaw;
          if (!venda) throw err;
          const html = montarHtmlCupomNaoFiscal(id, venda);
          await mostrarCupomNoCelular(html, {
            title: 'Cupom não fiscal',
            fileName: `cupom-nao-fiscal-${id}.html`
          });
        } catch (e2) {
          showToast(err.message || 'Falha ao abrir cupom', 'error');
        }
      }
    });

    root.querySelector('#vd-share-danfe')?.addEventListener('click', async () => {
      try {
        const html = await fetchDanfeHtml();
        await shareTextAsFile(`danfe-venda-${id}.html`, html, 'text/html');
      } catch (err) {
        showToast(err.message || 'Falha ao compartilhar DANFE', 'error');
      }
    });

    root.querySelector('#vd-share-xml')?.addEventListener('click', async () => {
      try {
        const nota = await findNotaVenda();
        const xml = nota?.xml_autorizado || nota?.xml || nota?.xml_retorno || '';
        if (!xml) {
          showToast('XML não disponível nesta nota.', 'warning');
          return;
        }
        await shareTextAsFile(`nfce-venda-${id}.xml`, xml, 'application/xml');
      } catch (err) {
        showToast(err.message || 'Falha ao compartilhar XML', 'error');
      }
    });

    root.querySelector('#vd-cancel-nfce')?.addEventListener('click', async () => {
      const nota = await findNotaVenda();
      if (!nota?.id) {
        showToast('NFC-e não encontrada para esta venda.', 'warning');
        return;
      }
      const data = await promptSheet({
        title: 'Cancelar NFC-e',
        confirmLabel: 'Cancelar NFC-e',
        fieldsHtml: fieldHtml({
          name: 'justificativa',
          label: 'Justificativa (mín. 15 caracteres)',
          type: 'textarea',
          required: true
        })
      });
      if (!data?.justificativa) return;
      try {
        await window.CDSApi.post(`fiscal/notas/${nota.id}/cancelar`, {
          justificativa: data.justificativa
        });
        showToast('Cancelamento de NFC-e enviado.', 'success');
      } catch (err) {
        showToast(err.message || 'Falha ao cancelar NFC-e', 'error');
      }
    });

    root.querySelector('#vd-cancel')?.addEventListener('click', async () => {
      const ok = await confirmSheet({
        title: 'Cancelar venda',
        message: `Cancelar a venda #${id}?`,
        confirmLabel: 'Cancelar venda',
        danger: true
      });
      if (!ok) return;
      try {
        try {
          await window.CDSApi.put(`vendas/${id}/cancelar`, getTerminalRequestBody({}));
        } catch (e1) {
          await window.CDSApi.post(`vendas/cancelar/${id}`, getTerminalRequestBody({}));
        }
        showToast('Venda cancelada.', 'success');
        window.CDSMobile?.navigate?.('pdv/vendas', { replace: true });
      } catch (err) {
        showToast(err.message || 'Falha ao cancelar', 'error');
      }
    });

    root.querySelector('#vd-devolver')?.addEventListener('click', async () => {
      const data = await promptSheet({
        title: 'Devolução parcial/total',
        confirmLabel: 'Devolver',
        fieldsHtml: `
          ${fieldHtml({ name: 'motivo', label: 'Motivo', required: true })}
          ${fieldHtml({ name: 'observacao', label: 'Observação', type: 'textarea' })}
        `
      });
      if (!data?.motivo) return;
      try {
        await window.CDSApi.post(`vendas/${id}/devolver`, getTerminalRequestBody(data));
        showToast('Devolução registrada.', 'success');
        window.CDSMobile?.navigate?.(`pdv/venda/${id}`, { replace: true });
      } catch (err) {
        showToast(err.message || 'Falha na devolução', 'error');
      }
    });
  } catch (err) {
    root.innerHTML = errorHtml(err.message, err.status);
  }
}

function carregarComercializacaoMobile() {
  if (!window.PdvComercializacao || !window.CDSApi) return Promise.resolve(null);
  return window.PdvComercializacao.carregar((caminho) => window.CDSApi.get(caminho));
}

function atualizarOpcaoVendaPorLinhaMobile(root) {
  const botao = root?.querySelector?.('#pdv-venda-linha');
  if (!botao) return;
  const visivel = !!window.PdvVendaPorLinha && window.PdvVendaPorLinha.opcaoVisivel(window.PdvComercializacao);
  botao.style.display = visivel ? '' : 'none';
}

function bindVendaPorLinhaMobile(root, aberto) {
  const botao = root.querySelector('#pdv-venda-linha');
  if (!botao) return;
  botao.addEventListener('click', () => abrirVendaPorLinhaMobile(root, aberto));
  atualizarOpcaoVendaPorLinhaMobile(root);
  window.PdvComercializacao?.pronto?.()
    .then(() => atualizarOpcaoVendaPorLinhaMobile(root))
    .catch(() => null);
}

/**
 * Venda por Linha → carrinho Mobile: preço pelo Resolver oficial (com o carrinho atual como contexto)
 * e inclusão pela mesma regra da busca de produto. Tudo ou nada: o carrinho só é gravado se todos entrarem.
 */
async function adicionarDistribuicaoLinhaNoCarrinhoMobile(distribuicao, produtos) {
  const itens = ((distribuicao && distribuicao.distribuicao) || []).filter((item) => Number(item.quantidade) > 0);
  if (!itens.length) return { ok: false, mensagem: 'Nenhum produto com quantidade para adicionar.' };
  const porId = new Map((produtos || []).map((produto) => [Number(produto.id), produto]));
  const next = loadCart();
  let resolvido;
  try {
    resolvido = await resolverPrecosOficial(montarItensResolver(next).concat(itens.map((item) => ({
      produto_id: Number(item.produto_id),
      quantidade: Number(item.quantidade)
    }))));
  } catch (e) {
    return { ok: false, mensagem: e.message || 'Não foi possível obter o preço oficial do Resolver.' };
  }
  const linhas = ((resolvido && resolvido.itens) || []).slice().reverse();

  const novos = [];
  for (const item of itens) {
    const produto = porId.get(Number(item.produto_id));
    if (!produto) return { ok: false, mensagem: 'Produto não pertence à linha selecionada.' };
    const row = linhas.find((r) => Number(r.produto_id) === Number(item.produto_id));
    const preco = row && !row.erro ? Number(row.preco_venda) : NaN;
    if (!(preco > 0)) {
      return { ok: false, mensagem: `Não foi possível encontrar o preço de ${produto.nome}.` };
    }
    const forma = String(row.forma_comercializacao || '').toUpperCase() || 'UNIDADE';
    if (forma === 'KIT' || forma === 'CASQUINHA') {
      return { ok: false, mensagem: `${produto.nome} precisa de montagem. Adicione pela busca de produto.` };
    }
    const porPeso = forma === 'PESO' || forma === 'VOLUME';
    if (!porPeso && !Number.isInteger(Number(item.quantidade))) {
      return { ok: false, mensagem: `A quantidade de ${produto.nome} deve ser inteira.` };
    }
    const unidade = String(row.unidade_comercial || '').toUpperCase() || null;
    novos.push({
      id: String(produto.id),
      nome: produto.nome,
      codigo: produto.codigo || '',
      preco,
      qtd: Number(item.quantidade),
      forma_comercializacao: forma,
      unidade_comercial: unidade || (forma === 'PESO' ? 'KG' : (forma === 'VOLUME' ? 'LITRO' : null)),
      tipo_venda: porPeso ? 'PESO' : 'UNIDADE',
      canal: String(row.canal || resolvido?.canal || resolvido?.meta?.canal || 'VAREJO').toUpperCase(),
      quantidade_bolas: null,
      sabores: null,
      kit_id: null,
      kit_itens: null,
      preco_origem: row.preco_origem || null,
      tabela_preco_id: row.tabela_preco_id || null,
      tabela_preco_nome: row.tabela_preco_nome || null,
      linha_comercial_id: row.linha_comercial_id || null,
      preco_congelado: false,
      resolver: 'Motor Oficial'
    });
  }

  novos.forEach((novo) => incluirItemNoCarrinhoMobile(next, novo));
  saveCart(next);
  return { ok: true, itens: novos.length };
}

function abrirVendaPorLinhaMobile(root, aberto) {
  const VendaPorLinha = window.PdvVendaPorLinha;
  if (!VendaPorLinha || !VendaPorLinha.opcaoVisivel(window.PdvComercializacao) || !window.CDSApi) return;
  const consultar = (caminho) => window.CDSApi.get(caminho);
  VendaPorLinha.limpar();

  const sheet = openBottomSheet({
    title: 'Vender por Linha',
    bodyHtml: '<div id="pdv-linha-corpo"></div>',
    actionsHtml: `
      <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" id="pdv-linha-voltar" style="display:none">Voltar</button>
      <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" data-sheet-close>Fechar</button>
      <button type="button" class="cds-mobile-btn" id="pdv-linha-continuar" style="display:none">Continuar</button>
    `
  });
  sheet.querySelector('[data-sheet-close]')?.addEventListener('click', () => VendaPorLinha.limpar());
  sheet.querySelector('.cds-sheet__backdrop')?.addEventListener('click', () => VendaPorLinha.limpar());
  const corpo = sheet.querySelector('#pdv-linha-corpo');
  const voltar = sheet.querySelector('#pdv-linha-voltar');
  const continuar = sheet.querySelector('#pdv-linha-continuar');
  let buscaAtual = 0;
  let etapa = 'busca';

  const listarLinhas = async (termo) => {
    const lista = corpo.querySelector('#pdv-linha-lista');
    if (!lista) return;
    const consulta = ++buscaAtual;
    lista.innerHTML = loadingHtml('Buscando…');
    try {
      const linhas = await VendaPorLinha.buscarLinhas(consultar, termo);
      if (consulta !== buscaAtual) return;
      lista.innerHTML = linhas.length
        ? linhas.map((linha) => `
            <button type="button" class="cds-list-card" data-linha-id="${escapeHtml(linha.id)}">
              <div class="cds-list-card__main">
                <h3 class="cds-list-card__title">${escapeHtml(linha.nome)}</h3>
                ${linha.codigo ? `<p class="cds-list-card__subtitle">${escapeHtml(linha.codigo)}</p>` : ''}
              </div>
            </button>
          `).join('')
        : emptyHtml(VendaPorLinha.MENSAGEM_NENHUMA_LINHA);
    } catch (e) {
      if (consulta !== buscaAtual) return;
      lista.innerHTML = emptyHtml(e.message || 'Não foi possível buscar as linhas.');
    }
  };

  const mostrarBusca = () => {
    VendaPorLinha.limpar();
    etapa = 'busca';
    voltar.style.display = 'none';
    continuar.style.display = 'none';
    corpo.innerHTML = `
      <p class="cds-muted" style="margin:0 0 8px">Escolha uma linha que contém vários produtos. Para vender um produto só, use a busca de produto.</p>
      ${searchBarHtml('Nome ou código da linha', 'pdv-linha-busca')}
      <div id="pdv-linha-lista" style="margin-top:8px"></div>
    `;
    corpo.querySelector('#pdv-linha-busca')?.addEventListener('input', debounce((e) => {
      listarLinhas(String(e.target.value || '').trim());
    }, 250));
    listarLinhas('');
  };

  const mostrarProdutos = (selecao) => {
    const temProdutos = selecao.produtos.length > 0;
    etapa = 'produtos';
    voltar.style.display = '';
    continuar.style.display = temProdutos ? '' : 'none';
    corpo.innerHTML = `
      <p style="margin:0 0 8px">Linha selecionada: <strong>${escapeHtml(selecao.nome)}</strong></p>
      ${temProdutos ? `
        ${fieldHtml({ name: 'linha_quantidade_total', label: 'Quantidade total a vender', inputmode: 'decimal', placeholder: 'Ex.: 100', autocomplete: 'off', value: selecao.quantidadeTotal == null ? '' : VendaPorLinha.formatarQuantidade(selecao.quantidadeTotal) })}
        <p class="cds-muted" id="pdv-linha-quantidade-erro" style="margin:-4px 0 4px;color:#dc2626;display:none"></p>
        <p class="cds-muted" style="margin:0 0 12px">${escapeHtml(VendaPorLinha.MENSAGEM_DISTRIBUICAO)}</p>
      ` : ''}
      ${selecao.produtos.length
        ? selecao.produtos.map((produto) => `
            <label class="cds-field cds-field--check" for="pdv-linha-produto-${escapeHtml(produto.id)}">
              <input type="checkbox" id="pdv-linha-produto-${escapeHtml(produto.id)}" data-produto-id="${escapeHtml(produto.id)}" ${selecao.marcados.includes(produto.id) ? 'checked' : ''}>
              <span>${escapeHtml(produto.nome)}</span>
            </label>
          `).join('')
        : emptyHtml(selecao.mensagem)}
    `;
    const campo = corpo.querySelector('#f-linha_quantidade_total');
    campo?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        continuarComQuantidade();
      }
    });
    campo?.addEventListener('input', () => {
      const erro = corpo.querySelector('#pdv-linha-quantidade-erro');
      if (erro) erro.style.display = 'none';
    });
  };

  const atualizarTotaisDistribuicao = () => {
    const resumo = VendaPorLinha.resumoDistribuicao();
    const distribuido = corpo.querySelector('#pdv-linha-distribuido');
    const restante = corpo.querySelector('#pdv-linha-restante');
    if (!resumo || !distribuido || !restante) return;
    distribuido.textContent = VendaPorLinha.formatarQuantidade(resumo.distribuido);
    restante.textContent = VendaPorLinha.formatarQuantidade(resumo.restante);
    restante.style.color = resumo.completa ? '#16a34a' : (resumo.excedida ? '#dc2626' : '');
  };

  const mostrarErroDistribuicao = (mensagem) => {
    const erro = corpo.querySelector('#pdv-linha-distribuicao-erro');
    if (!erro) return;
    erro.textContent = mensagem || '';
    erro.style.display = mensagem ? '' : 'none';
  };

  const mostrarDistribuicao = (selecao) => {
    etapa = 'distribuicao';
    voltar.style.display = '';
    continuar.style.display = '';
    continuar.textContent = 'Continuar';
    corpo.innerHTML = `
      <p style="margin:0 0 4px">Linha: <strong>${escapeHtml(selecao.nome)}</strong></p>
      <p style="margin:0 0 8px">Quantidade total: <strong>${escapeHtml(VendaPorLinha.formatarQuantidade(selecao.quantidadeTotal))}</strong></p>
      <p style="margin:0 0 6px;font-weight:600">Distribua a quantidade:</p>
      ${VendaPorLinha.produtosParaDistribuir().map((produto) => `
        <div style="padding:6px 0;border-bottom:1px solid #f1f5f9">
          <div style="display:grid;grid-template-columns:1fr 96px;gap:8px;align-items:center">
            <label for="pdv-linha-distribuir-${escapeHtml(produto.id)}">${escapeHtml(produto.nome)}</label>
            <input type="text" inputmode="decimal" class="cds-field__input" id="pdv-linha-distribuir-${escapeHtml(produto.id)}"
              data-distribuir-produto-id="${escapeHtml(produto.id)}" placeholder="0" autocomplete="off">
          </div>
          <p class="cds-muted" data-distribuir-erro="${escapeHtml(produto.id)}" style="margin:2px 0 0;color:#dc2626;display:none"></p>
        </div>
      `).join('')}
      <p style="margin:10px 0 0">Distribuído: <strong id="pdv-linha-distribuido">0</strong> · Restante: <strong id="pdv-linha-restante">0</strong></p>
      <p class="cds-muted" id="pdv-linha-distribuicao-erro" style="margin:4px 0 0;color:#dc2626;display:none"></p>
    `;
    corpo.querySelectorAll('[data-distribuir-produto-id]').forEach((campo) => {
      const produtoId = campo.getAttribute('data-distribuir-produto-id');
      const pendencia = selecao.pendencias[produtoId];
      campo.value = VendaPorLinha.valorDoCampo(Number(produtoId));
      const erro = corpo.querySelector(`[data-distribuir-erro="${produtoId}"]`);
      if (erro && pendencia) {
        erro.textContent = pendencia.mensagem;
        erro.style.display = '';
      }
    });
    atualizarTotaisDistribuicao();
  };

  const mostrarConcluida = (resultado) => {
    const selecao = VendaPorLinha.obterSelecao();
    const nomes = new Map(selecao.produtos.map((produto) => [produto.id, produto.nome]));
    etapa = 'concluida';
    continuar.style.display = '';
    continuar.textContent = 'Adicionar ao carrinho';
    corpo.innerHTML = `
      <p style="margin:0 0 4px">Linha: <strong>${escapeHtml(selecao.nome)}</strong></p>
      <p style="margin:0 0 8px">Quantidade total: <strong>${escapeHtml(VendaPorLinha.formatarQuantidade(selecao.quantidadeTotal))}</strong></p>
      <ul style="margin:0 0 8px;padding-left:18px">
        ${resultado.distribuicao.distribuicao.map((item) => `
          <li>${escapeHtml(nomes.get(item.produto_id))}: <strong>${escapeHtml(VendaPorLinha.formatarQuantidade(item.quantidade))}</strong></li>
        `).join('')}
      </ul>
      <p style="margin:0;color:#16a34a">Distribuição concluída.</p>
      <p class="cds-muted" id="pdv-linha-conclusao-erro" style="margin:4px 0 0;color:#dc2626;display:none"></p>
    `;
  };

  let adicionando = false;
  const adicionarAoCarrinho = async () => {
    const distribuicao = VendaPorLinha.distribuicaoConfirmada();
    if (!distribuicao || adicionando) return;
    adicionando = true;
    const botoes = sheet.querySelectorAll('button');
    botoes.forEach((botao) => { botao.disabled = true; });
    const resultado = await adicionarDistribuicaoLinhaNoCarrinhoMobile(distribuicao, VendaPorLinha.obterSelecao().produtos);
    adicionando = false;
    botoes.forEach((botao) => { botao.disabled = false; });
    if (!resultado.ok) {
      const erro = corpo.querySelector('#pdv-linha-conclusao-erro');
      if (erro) {
        erro.textContent = resultado.mensagem;
        erro.style.display = '';
      }
      showToast(resultado.mensagem, 'error');
      return;
    }
    VendaPorLinha.limpar();
    closeBottomSheet();
    showToast(resultado.itens === 1 ? 'Produto adicionado.' : `${resultado.itens} produtos adicionados.`, 'success');
    if (root) {
      await recalcularCarrinhoViaResolver(root, aberto);
      if (root.querySelector('#pdv-sticky')) paintCart(root, aberto, { recolherResumo: true });
    }
  };

  const concluirDistribuicao = () => {
    const resultado = VendaPorLinha.concluirDistribuicao();
    if (!resultado.ok) {
      mostrarErroDistribuicao(resultado.mensagem);
      return;
    }
    mostrarConcluida(resultado);
  };

  const continuarComQuantidade = () => {
    const campo = corpo.querySelector('#f-linha_quantidade_total');
    const resultado = VendaPorLinha.definirQuantidadeTotal(campo?.value);
    if (!resultado.ok) {
      const erro = corpo.querySelector('#pdv-linha-quantidade-erro');
      if (erro) {
        erro.textContent = resultado.mensagem;
        erro.style.display = '';
      }
      campo?.focus();
      return;
    }
    mostrarDistribuicao(resultado.selecao);
  };

  corpo.addEventListener('click', async (e) => {
    const botaoLinha = e.target.closest?.('[data-linha-id]');
    if (!botaoLinha) return;
    try {
      mostrarProdutos(await VendaPorLinha.selecionarLinha(consultar, Number(botaoLinha.getAttribute('data-linha-id'))));
    } catch (err) {
      showToast(err.message || 'Não foi possível abrir a linha.', 'warning');
    }
  });
  corpo.addEventListener('change', (e) => {
    const produtoId = e.target?.getAttribute?.('data-produto-id');
    if (produtoId) VendaPorLinha.marcarProduto(Number(produtoId), e.target.checked);
  });
  corpo.addEventListener('input', (e) => {
    const produtoId = e.target?.getAttribute?.('data-distribuir-produto-id');
    if (!produtoId) return;
    const resultado = VendaPorLinha.definirQuantidadeProduto(Number(produtoId), e.target.value);
    const erro = corpo.querySelector(`[data-distribuir-erro="${produtoId}"]`);
    if (erro) {
      erro.textContent = resultado.ok ? '' : resultado.mensagem;
      erro.style.display = resultado.ok ? 'none' : '';
    }
    mostrarErroDistribuicao('');
    atualizarTotaisDistribuicao();
  });
  continuar.addEventListener('click', () => {
    if (etapa === 'produtos') continuarComQuantidade();
    else if (etapa === 'distribuicao') concluirDistribuicao();
    else if (etapa === 'concluida') adicionarAoCarrinho();
  });
  voltar.addEventListener('click', () => {
    const selecao = VendaPorLinha.obterSelecao();
    if (etapa === 'concluida' && selecao) mostrarDistribuicao(selecao);
    else if (etapa === 'distribuicao' && selecao) mostrarProdutos(selecao);
    else mostrarBusca();
  });

  mostrarBusca();
}

export async function renderPdv(root, ctx = {}) {
  root.innerHTML = loadingHtml('Abrindo PDV…');
  try {
    if (!isTerminalRegistered()) {
      renderRegisterTerminal(root);
      return;
    }
    startHeartbeat();
    try {
      await syncTerminalFromServer();
    } catch (syncErr) {
      const msg = String(syncErr?.message || '');
      if (syncErr?.status === 401 || /sessão expirou|sessao expirou/i.test(msg)) {
        showToast('Sua sessão expirou. Entre novamente para continuar.', 'error');
        throw syncErr;
      }
      /* rede intermitente: segue com cache local e banner */
    }
    carregarComercializacaoMobile();

    const parts = ctx.parts || [];
    if (parts[1] === 'venda' && parts[2]) {
      await renderVendaDetalhe(root, parts[2]);
      return;
    }

    const tab = parseTab(parts);
    const caixa = await fetchCaixa();

    if (tab === 'caixa') await renderCaixaTab(root, caixa);
    else if (tab === 'vendas') await renderVendasTab(root);
    else await renderVenderTab(root, caixa);
  } catch (err) {
    root.innerHTML = errorHtml(err.message || 'Erro no PDV Mobile.', err.status);
  }
}

export default { render: renderPdv, title: 'PDV', subtitle: 'Operacional' };
