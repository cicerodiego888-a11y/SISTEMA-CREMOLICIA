/**
 * Fechar Consignação — interface operacional UX-05.
 *
 * @module frontend/modules/motor-comercial/pages/PrestacaoContas/FecharConsignacaoView
 */

const Button = require('../../components/base/Button');
const Input = require('../../components/form/Input');
const Select = require('../../components/form/Select');
const Badge = require('../../components/base/Badge');
const Loading = require('../../components/base/Loading');
const EmptyState = require('../../components/base/EmptyState');
const Alert = require('../../components/base/Alert');
const Modal = require('../../components/navigation/Modal');
const Pagination = require('../../components/data/Pagination');
const {
  buildPainelLateral,
  buildResumoEntrega,
  buildCentralEncerramento,
  buildResumoFinalOficial,
  consignacaoElegivelParaPrestacao,
  CAMPOS_RETORNO_ORDEM,
  calcularSaldoItem,
  getOperadorNomeLocal,
  formatCurrency,
  formatDate,
  formatDateTime
} = require('./fecharConsignacaoMappers');
const {
  labelSituacaoFinanceira,
  assertMesmoFinanceiro
} = require('./prestacaoFinanceiroSnapshot');
const {
  buildPainelFechamentoOperacional,
  auditarIntegridadeNoResumo,
  auditarCadeiaFiscal,
  labelSituacaoFinanceiraOficial,
  MENSAGENS
} = require('./prestacaoOperacionalConsolidacao');
const {
  safeText,
  criarAlertaErroOperacional,
  auditarFinalRC1
} = require('./prestacaoHardening');
const { montarBlocoRateio } = require('./rateioPerdaUi');

function _financeiroFromState(state) {
  return state?.snapshot?.financeiro
    || state?.painel?.financeiro
    || null;
}

/** Apresentação: sem venda real — não exibir R$ 0,00 como quitada. */
function _isSemVenda(fin = {}) {
  return String(fin?.situacaoFinanceira || '').toUpperCase() === 'SEM_VENDA'
    || Number(fin?.valorVenda || 0) <= 0.01;
}

class FecharConsignacaoView {
  static renderMomento(momento, state, ctx) {
    switch (momento) {
      case 'retornos': return FecharConsignacaoView.renderRetornos(state, ctx);
      case 'conferencia': return FecharConsignacaoView.renderConferenciaFinal(state, ctx);
      case 'encerramento': return FecharConsignacaoView.renderEncerramento(state, ctx);
      // legado (STAB-07.1 removeu steps)
      case 'conferir': return FecharConsignacaoView.renderRetornos(state, ctx);
      case 'pagamento': return FecharConsignacaoView.renderConferenciaFinal(state, ctx);
      default: return document.createElement('div');
    }
  }

  static renderConferir(state, ctx) {
    const wrap = document.createElement('div');
    wrap.className = 'cds-fechar-consignacao__momento';

    const title = document.createElement('h2');
    title.className = 'cds-fechar-consignacao__titulo';
    title.textContent = 'O que falta para concluir este atendimento?';
    wrap.appendChild(title);

    const hint = document.createElement('p');
    hint.className = 'cds-fechar-consignacao__hint';
    hint.textContent = 'Confira os produtos entregues antes de registrar retornos.';
    wrap.appendChild(hint);

    if (!consignacaoElegivelParaPrestacao(state.consignacao || {})) {
      wrap.appendChild(Alert.create({
        message: 'Esta consignação ainda não foi entregue. Conclua a entrega antes de iniciar o fechamento.',
        variant: 'warning',
        dismissible: false
      }));
    }

    const resumo = buildResumoEntrega(state.consignacao, state.resumoPrestacao);
    const info = document.createElement('div');
    info.className = 'cds-fechar-consignacao__info-grid';
    [
      { label: 'Cliente', value: resumo.cliente },
      { label: 'Documento', value: resumo.documento },
      { label: 'Data da Entrega', value: resumo.dataEntrega },
      { label: 'Valor Entregue', value: formatCurrency(resumo.valorEntregue) },
      { label: 'Itens', value: String(resumo.quantidadeItens) }
    ].forEach((f) => {
      const cell = document.createElement('div');
      cell.innerHTML = `<label>${f.label}</label><strong>${f.value}</strong>`;
      info.appendChild(cell);
    });
    wrap.appendChild(info);

    const lista = document.createElement('div');
    lista.className = 'cds-fechar-consignacao__lista-produtos';

    const itens = state.resumoPrestacao?.itens || [];
    if (!itens.length) {
      lista.appendChild(EmptyState.create({
        title: 'Sem produtos',
        description: 'Nenhum item encontrado nesta consignação'
      }));
    } else {
      const head = document.createElement('div');
      head.className = 'cds-fechar-consignacao__grade-head';
      head.innerHTML = '<span>Produto</span><span>Entregue</span><span>Registrado</span><span>Pendente</span>';
      lista.appendChild(head);

      itens.forEach((item) => {
        const registrado = Number(item.vendido || 0) + Number(item.devolvido || 0)
          + Number(item.perdido || 0) + Number(item.cortesia || 0);
        const row = document.createElement('div');
        row.className = 'cds-fechar-consignacao__grade-row';
        const nome = document.createElement('span');
        const strong = document.createElement('strong');
        strong.textContent = safeText(item.produtoNome || item.produto, '⚠ Produto não localizado');
        nome.appendChild(strong);
        row.appendChild(nome);
        const entregue = document.createElement('span');
        entregue.textContent = String(item.enviado ?? item.quantidadeEntregue ?? item.quantidade ?? 0);
        row.appendChild(entregue);
        const reg = document.createElement('span');
        reg.textContent = String(registrado);
        row.appendChild(reg);
        const pend = document.createElement('span');
        pend.textContent = String(item.saldo ?? 0);
        row.appendChild(pend);
        lista.appendChild(row);
      });
    }

    wrap.appendChild(lista);
    return wrap;
  }

  static renderRetornos(state, ctx) {
    const wrap = document.createElement('div');
    wrap.className = 'cds-fechar-consignacao__momento cds-fechar-consignacao__momento--grade-fill cds-retornos-estacao';

    const header = document.createElement('header');
    header.className = 'cds-retornos-page-header';
    header.innerHTML = `
      <h2 class="cds-fechar-consignacao__titulo cds-op-titulo">Registrar Retornos</h2>
      <p class="cds-retornos-page-header__hint">Informe as quantidades devolvidas, perdas ou dadas como cortesia.</p>
    `;
    wrap.appendChild(header);

    const alerta = document.createElement('div');
    alerta.id = 'fechar-conferencia-alerta';
    alerta.className = 'cds-fechar-consignacao__conferencia-alerta';
    alerta.hidden = !state.conferenciaAlerta;
    if (state.conferenciaAlerta) {
      alerta.innerHTML = `<strong>${state.conferenciaAlerta}</strong>`;
    }
    wrap.appendChild(alerta);

    const itens = state.resumoPrestacao?.itens || [];
    const painel = state.painel || buildPainelLateral(
      state.resumoPrestacao,
      itens,
      _financeiroFromState(state)
    );
    wrap.appendChild(FecharConsignacaoView._buildResumoRapido(painel));

    if (!itens.length) {
      wrap.appendChild(EmptyState.create({
        title: 'Sem produtos',
        description: 'Não há itens para registrar'
      }));
      return wrap;
    }

    const layout = document.createElement('div');
    layout.className = 'cds-retornos-layout';

    const main = document.createElement('div');
    main.className = 'cds-retornos-main';
    main.appendChild(FecharConsignacaoView._buildGradeProdutosPanel(state, ctx, itens));
    layout.appendChild(main);

    const sidebarCol = document.createElement('div');
    sidebarCol.className = 'cds-retornos-sidebar-col';
    sidebarCol.appendChild(FecharConsignacaoView._buildSidebarRetornos(state, painel));
    if (Number(state.rateioPerda?.totais?.totalPerdido || 0) > 0.01
      || Number(painel.perdas || 0) > 0) {
      sidebarCol.appendChild(montarBlocoRateio(state, ctx));
    }
    layout.appendChild(sidebarCol);
    wrap.appendChild(layout);
    return wrap;
  }

  static _defaultRetornosUi(stateUi = {}) {
    const baseColunas = {
      entregue: true,
      vendido: true,
      devolvido: true,
      perdido: true,
      cortesia: true,
      saldo: true,
      observacao: true,
      status: true
    };
    return {
      busca: '',
      page: 1,
      pageSize: 10,
      filtro: 'TODOS',
      colunaPreset: 'ALL',
      ...stateUi,
      colunas: { ...baseColunas, ...(stateUi.colunas || {}) }
    };
  }

  static _filtrarItensRetornos(itens = [], ui = {}, state = {}) {
    const cfg = FecharConsignacaoView._defaultRetornosUi(ui);
    const q = String(cfg.busca || '').trim().toLowerCase();
    return itens
      .map((item, index) => ({ item, index }))
      .filter(({ item, index }) => {
        const nome = String(item.produtoNome || item.produto || '').toLowerCase();
        if (q && !nome.includes(q)) return false;
        const status = FecharConsignacaoView._statusOperacionalItem(item, index, state);
        if (cfg.filtro === 'LIQUIDADO' && status.key !== 'liquidado') return false;
        if (cfg.filtro === 'PENDENTE' && status.key !== 'pendente') return false;
        if (cfg.filtro === 'INCONSISTENTE' && status.key !== 'inconsistente') return false;
        return true;
      });
  }

  static _statusOperacionalItem(item = {}, index = 0, state = {}) {
    if (state.linhasComErro?.[index]) {
      return { key: 'inconsistente', label: 'Inconsistente', variant: 'error' };
    }
    const saldo = Number(item.saldo ?? calcularSaldoItem(item));
    if (item.status === 'LIQUIDADO' || saldo <= 0) {
      return { key: 'liquidado', label: 'Liquidado', variant: 'success' };
    }
    return { key: 'pendente', label: 'Pendente', variant: 'warning' };
  }

  static _paginarItens(list = [], page = 1, pageSize = 10) {
    const size = Math.max(1, Number(pageSize) || 10);
    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / size) || 1);
    const pageSafe = Math.min(Math.max(1, Number(page) || 1), totalPages);
    const start = (pageSafe - 1) * size;
    const pageItems = list.slice(start, start + size);
    return {
      pageItems,
      total,
      totalPages,
      page: pageSafe,
      pageSize: size,
      from: total ? start + 1 : 0,
      to: total ? Math.min(start + size, total) : 0
    };
  }

  static _buildGradeProdutosPanel(state, ctx, itens) {
    const ui = FecharConsignacaoView._defaultRetornosUi(state.retornosUi);
    const panel = document.createElement('section');
    panel.className = 'cds-op-card cds-retornos-grade-panel';

    const scroll = document.createElement('div');
    scroll.className = 'cds-fechar-consignacao__grade-scroll cds-retornos-grade-scroll cds-table-wrap';

    const table = document.createElement('table');
    table.className = 'cds-table cds-table--compact cds-retornos-table';
    table.id = 'fechar-retornos-grade';

    const filtered = FecharConsignacaoView._filtrarItensRetornos(itens, ui, state);
    const pageData = FecharConsignacaoView._paginarItens(filtered, ui.page, ui.pageSize);

    table.appendChild(FecharConsignacaoView._buildGradeHead(ui.colunas));
    const tbody = document.createElement('tbody');
    tbody.dataset.slot = 'retornos-tbody';
    if (!pageData.pageItems.length) {
      const empty = document.createElement('tr');
      empty.innerHTML = '<td colspan="10" class="cds-table__empty">Nenhum produto encontrado.</td>';
      tbody.appendChild(empty);
    } else {
      pageData.pageItems.forEach(({ item, index }) => {
        tbody.appendChild(FecharConsignacaoView._renderLinhaRetorno(item, index, state, ctx));
      });
    }
    table.appendChild(tbody);
    scroll.appendChild(table);
    panel.appendChild(scroll);

    panel.appendChild(FecharConsignacaoView._buildGradeFooter(pageData, ui, ctx));
    return panel;
  }

  static _buildGradeHead(colunas = {}) {
    const thead = document.createElement('thead');
    const tr = document.createElement('tr');
    tr.className = 'cds-fechar-consignacao__grade-head cds-fechar-consignacao__grade-head--retornos';
    const cols = [
      { key: 'check', label: '', always: true },
      { key: 'consignacao', label: 'Consignação', always: true },
      { key: 'produto', label: 'Produto', always: true },
      { key: 'entregue', label: 'Entregue' },
      { key: 'devolvido', label: 'Devolvido' },
      { key: 'vendido', label: 'Vendido' },
      { key: 'perdido', label: 'Perda' },
      { key: 'cortesia', label: 'Cortesia' },
      { key: 'saldo', label: 'Saldo' },
      { key: 'observacao', label: 'Observação' },
      { key: 'status', label: 'Status' }
    ];
    cols.forEach((c) => {
      if (!c.always && colunas[c.key] === false) return;
      const th = document.createElement('th');
      th.dataset.col = c.key;
      th.textContent = c.label;
      if (c.key === 'check') {
        th.innerHTML = '<input type="checkbox" aria-label="Selecionar todos" disabled />';
      }
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    return thead;
  }

  static _buildGradeFooter(pageData, ui, ctx) {
    const foot = document.createElement('div');
    foot.className = 'cds-retornos-grade-footer';
    foot.dataset.slot = 'retornos-pagination';

    const info = document.createElement('span');
    info.className = 'cds-retornos-grade-footer__info';
    info.textContent = pageData.total
      ? `Mostrando ${pageData.from} a ${pageData.to} de ${pageData.total} produtos`
      : 'Mostrando 0 produtos';
    foot.appendChild(info);

    const sizeWrap = document.createElement('div');
    sizeWrap.className = 'cds-retornos-grade-footer__size';
    sizeWrap.innerHTML = '<span>Linhas por página</span>';
    sizeWrap.appendChild(Select.create({
      options: [
        { value: '10', label: '10' },
        { value: '20', label: '20' },
        { value: '50', label: '50' },
        { value: '100', label: '100' }
      ],
      value: String(ui.pageSize || 10),
      onChange: (v) => ctx.onRetornosUiChange && ctx.onRetornosUiChange({
        pageSize: Number(v) || 10,
        page: 1
      })
    }));
    foot.appendChild(sizeWrap);

    foot.appendChild(Pagination.create({
      currentPage: pageData.page,
      totalPages: pageData.totalPages,
      totalItems: pageData.total,
      pageSize: pageData.pageSize,
      onPageChange: (page) => ctx.onRetornosUiChange && ctx.onRetornosUiChange({ page })
    }));

    return foot;
  }

  /**
   * Atualiza só o corpo/paginação da grade (busca/página) — sem remontar a estação.
   */
  static refreshRetornosGrade(root, state, ctx) {
    const panel = root.querySelector('.cds-retornos-grade-panel');
    if (!panel) return false;
    const itens = state.resumoPrestacao?.itens || [];
    const ui = FecharConsignacaoView._defaultRetornosUi(state.retornosUi);
    const filtered = FecharConsignacaoView._filtrarItensRetornos(itens, ui, state);
    const pageData = FecharConsignacaoView._paginarItens(filtered, ui.page, ui.pageSize);

    const table = panel.querySelector('#fechar-retornos-grade');
    if (table) {
      const oldHead = table.querySelector('thead');
      const newHead = FecharConsignacaoView._buildGradeHead(ui.colunas);
      if (oldHead) oldHead.replaceWith(newHead);
      else table.prepend(newHead);

      const tbody = table.querySelector('[data-slot="retornos-tbody"]') || table.querySelector('tbody');
      if (tbody) {
        tbody.replaceChildren();
        if (!pageData.pageItems.length) {
          const empty = document.createElement('tr');
          empty.innerHTML = '<td colspan="10" class="cds-table__empty">Nenhum produto encontrado.</td>';
          tbody.appendChild(empty);
        } else {
          pageData.pageItems.forEach(({ item, index }) => {
            tbody.appendChild(FecharConsignacaoView._renderLinhaRetorno(item, index, state, ctx));
          });
        }
      }
    }

    const foot = panel.querySelector('[data-slot="retornos-pagination"]');
    if (foot) foot.replaceWith(FecharConsignacaoView._buildGradeFooter(pageData, ui, ctx));
    return true;
  }

  /** STAB-07.5 — linha da grade operacional (selector legado preservado). */
  static _renderLinhaRetorno(item, index, state, ctx) {
    const editing = state.editing?.rowIndex === index;
    const linhaErro = state.linhasComErro?.[index];
    const ui = FecharConsignacaoView._defaultRetornosUi(state.retornosUi);
    const colunas = ui.colunas;

    const row = document.createElement('tr');
    row.className = [
      'cds-fechar-consignacao__grade-row',
      'cds-fechar-consignacao__grade-row--retornos',
      editing ? 'cds-fechar-consignacao__grade-row--editando' : '',
      linhaErro ? 'cds-fechar-consignacao__grade-row--erro' : '',
      item.dirty ? 'cds-fechar-consignacao__grade-row--dirty' : ''
    ].filter(Boolean).join(' ');
    row.dataset.rowIndex = String(index);

    const tdCheck = document.createElement('td');
    tdCheck.dataset.col = 'check';
    tdCheck.innerHTML = '<input type="checkbox" aria-label="Selecionar linha" disabled />';
    row.appendChild(tdCheck);

    const tdConsig = document.createElement('td');
    tdConsig.dataset.col = 'consignacao';
    tdConsig.className = 'cds-retornos-table__consignacao';
    const docLabel = item.documentoConsignacao
      || (item.consignacaoId != null ? `CONS-${item.consignacaoId}` : '—');
    const docText = typeof docLabel === 'object'
      ? (docLabel.numero || `CONS-${item.consignacaoId}`)
      : String(docLabel);
    tdConsig.textContent = docText.length > 18 ? `${docText.slice(0, 16)}…` : docText;
    tdConsig.title = docText;
    row.appendChild(tdConsig);

    const tdProd = document.createElement('td');
    tdProd.dataset.col = 'produto';
    tdProd.className = 'cds-retornos-table__produto';
    const nomeProduto = safeText(item.produtoNome || item.produto, '⚠ Produto não localizado');
    const strong = document.createElement('strong');
    strong.textContent = nomeProduto;
    if (nomeProduto.startsWith('⚠')) strong.className = 'cds-fechar-consignacao__produto--ausente';
    tdProd.appendChild(strong);
    row.appendChild(tdProd);

    if (colunas.entregue !== false) {
      const td = document.createElement('td');
      td.dataset.col = 'entregue';
      td.className = 'cds-retornos-table__num';
      td.textContent = String(item.enviado ?? 0);
      row.appendChild(td);
    }

    ['devolvido', 'vendido', 'perdido', 'cortesia'].forEach((campo) => {
      if (colunas[campo] === false) return;
      const td = document.createElement('td');
      td.dataset.col = campo;
      td.className = 'cds-retornos-table__input-cell';
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.step = '1';
      input.value = String(item[campo] || 0);
      input.className = 'cds-fechar-consignacao__qty-input';
      input.dataset.campo = campo;
      input.disabled = Boolean(state.loading?.operation && state.lineStatus?.[`${index}-${campo}`]?.state === 'saving');
      if (state.focus?.rowIndex === index && state.focus?.campo === campo) {
        input.dataset.autofocus = 'true';
      }
      const emitDraft = () => ctx.onItemDraft(index, campo, input.value);
      input.addEventListener('focus', () => ctx.onItemFocus(index, campo));
      input.addEventListener('input', emitDraft);
      input.addEventListener('change', emitDraft);
      input.addEventListener('keydown', (e) => ctx.onItemKeydown(e, index, campo, input));
      input.addEventListener('blur', () => ctx.onItemBlur(index, campo, input.value));
      td.appendChild(input);
      row.appendChild(td);
    });

    if (colunas.saldo !== false) {
      const td = document.createElement('td');
      td.dataset.col = 'saldo';
      td.className = 'cds-retornos-table__num';
      const saldo = document.createElement('strong');
      saldo.className = 'cds-fechar-consignacao__saldo-cell';
      saldo.dataset.saldoIndex = String(index);
      saldo.textContent = String(item.saldo ?? calcularSaldoItem(item));
      td.appendChild(saldo);
      row.appendChild(td);
    }

    if (colunas.observacao !== false) {
      const td = document.createElement('td');
      td.dataset.col = 'observacao';
      td.className = 'cds-retornos-table__obs-cell';
      const obs = document.createElement('input');
      obs.type = 'text';
      obs.placeholder = 'Opcional...';
      obs.value = item.observacao || '';
      obs.className = 'cds-fechar-consignacao__obs-input';
      obs.dataset.campo = 'observacao';
      if (state.focus?.rowIndex === index && state.focus?.campo === 'observacao') {
        obs.dataset.autofocus = 'true';
      }
      obs.addEventListener('focus', () => ctx.onItemFocus(index, 'observacao'));
      obs.addEventListener('input', () => ctx.onItemDraft(index, 'observacao', obs.value));
      obs.addEventListener('keydown', (e) => ctx.onItemKeydown(e, index, 'observacao', obs));
      obs.addEventListener('blur', () => ctx.onItemObsChange(index, obs.value));
      td.appendChild(obs);
      row.appendChild(td);
    }

    if (colunas.status !== false) {
      const td = document.createElement('td');
      td.dataset.col = 'status';
      td.className = 'cds-retornos-table__status-cell';
      const status = document.createElement('span');
      status.className = 'cds-fechar-consignacao__linha-status';
      status.dataset.statusRow = String(index);
      FecharConsignacaoView._aplicarStatusLinha(status, item, index, state, ctx);
      td.appendChild(status);
      row.appendChild(td);
    }

    return row;
  }

  static _aplicarStatusLinha(statusEl, item, index, state, ctx) {
    statusEl.replaceChildren();
    const lineKey = state.lineStatus?.[`${index}-active`] || state.lineStatus?.[`${index}-vendido`];
    const linhaErro = state.linhasComErro?.[index];

    if (lineKey?.state === 'saving' || lineKey?.state === 'saved' || lineKey?.state === 'error') {
      statusEl.dataset.state = lineKey.state;
      statusEl.appendChild(Badge.create({
        text: lineKey.message || FecharConsignacaoView._statusLabel(lineKey.state),
        variant: lineKey.state === 'error' ? 'error' : lineKey.state === 'saved' ? 'success' : 'info',
        size: 'sm'
      }));
    } else {
      const status = FecharConsignacaoView._statusOperacionalItem(item, index, state);
      statusEl.dataset.state = status.key;
      statusEl.appendChild(Badge.create({
        text: linhaErro?.message || status.label,
        variant: status.variant,
        size: 'sm'
      }));
    }

    if (linhaErro && ctx?.onRetryLinha) {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'cds-fechar-consignacao__retry-btn';
      retry.textContent = 'Tentar novamente';
      retry.addEventListener('click', () => ctx.onRetryLinha(index));
      statusEl.appendChild(retry);
    }
  }

  static _buildResumoRapido(painel = {}) {
    const section = document.createElement('section');
    section.className = 'cds-op-card cds-retornos-resumo';
    section.id = 'fechar-retornos-resumo-rapido';
    section.innerHTML = `
      <h3 class="cds-op-card__titulo">Resumo Rápido</h3>
      <div class="cds-retornos-resumo__grid">
        <div><span>Vendidos</span><strong data-resumo="vendidos">${painel.produtosVendidos ?? 0}</strong></div>
        <div><span>Devolvidos</span><strong data-resumo="devolvidos">${painel.produtosDevolvidos ?? 0}</strong></div>
        <div><span>Perdas</span><strong data-resumo="perdas">${painel.perdas ?? 0}</strong></div>
        <div><span>Saldo</span><strong data-resumo="saldo">${painel.pendentes ?? 0}</strong></div>
      </div>
    `;
    return section;
  }

  static patchResumoRapido(host, painel = {}) {
    if (!host) return;
    const map = {
      vendidos: painel.produtosVendidos ?? 0,
      devolvidos: painel.produtosDevolvidos ?? 0,
      perdas: painel.perdas ?? 0,
      saldo: painel.pendentes ?? 0
    };
    Object.entries(map).forEach(([key, value]) => {
      const el = host.querySelector(`[data-resumo="${key}"]`);
      if (el) el.textContent = String(value);
    });
  }

  static _situacaoSidebarTone(codigo = '') {
    const key = String(codigo || '').toUpperCase();
    if (key === 'QUITADA' || key === 'SEM_VENDA') return 'ok';
    if (key === 'PARCIALMENTE_RECEBIDA') return 'warn';
    return 'open';
  }

  static _buildSidebarRetornos(state, painel = {}) {
    const fin = (painel.preview && painel.financeiro)
      ? painel.financeiro
      : (state.snapshot?.financeiro || painel.financeiro || {});
    const situacaoLabel = labelSituacaoFinanceiraOficial(fin.situacaoFinanceira)
      || labelSituacaoFinanceira(fin.situacaoFinanceira)
      || '—';
    const tone = FecharConsignacaoView._situacaoSidebarTone(fin.situacaoFinanceira);
    const semVenda = _isSemVenda(fin);

    const aside = document.createElement('aside');
    aside.className = 'cds-op-card cds-retornos-sidebar cds-fechar-consignacao__painel';
    aside.id = 'fechar-painel-lateral';
    aside.innerHTML = `
      <h3 class="cds-op-card__titulo">Resumo Financeiro</h3>
      <div class="cds-retornos-sidebar__fin">
        ${semVenda ? '' : `
        <div class="cds-retornos-sidebar__metric cds-retornos-sidebar__metric--venda">
          <span>Valor da Venda</span>
          <strong data-painel="valorVenda">${formatCurrency(fin.valorVenda)}</strong>
        </div>
        <div class="cds-retornos-sidebar__metric cds-retornos-sidebar__metric--recebido">
          <span>Recebido</span>
          <strong data-painel="valorRecebido">${formatCurrency(fin.valorRecebido)}</strong>
        </div>
        <div class="cds-retornos-sidebar__metric cds-retornos-sidebar__metric--saldo">
          <span>Saldo em Aberto</span>
          <strong data-painel="saldoEmAberto">${formatCurrency(fin.saldoEmAberto)}</strong>
        </div>
        `}
        <div class="cds-retornos-sidebar__metric cds-retornos-sidebar__metric--sit cds-retornos-sidebar__metric--${tone}">
          <span>Situação Financeira</span>
          <strong data-painel="situacaoFinanceira">${safeText(situacaoLabel)}</strong>
        </div>
      </div>
      <h4 class="cds-retornos-sidebar__natureza-title">Resumo por natureza</h4>
      <dl class="cds-retornos-sidebar__natureza">
        <div><dt>Vendidos</dt><dd data-painel="vendidos" class="is-vendidos">${painel.produtosVendidos ?? 0}</dd></div>
        <div><dt>Devolvidos</dt><dd data-painel="devolvidos" class="is-devolvidos">${painel.produtosDevolvidos ?? 0}</dd></div>
        <div><dt>Perdas</dt><dd data-painel="perdas" class="is-perdas">${painel.perdas ?? 0}</dd></div>
        <div><dt>Cortesias</dt><dd data-painel="cortesias" class="is-cortesias">${painel.cortesias ?? 0}</dd></div>
        <div><dt>Saldo</dt><dd data-painel="pendentes" class="is-saldo">${painel.pendentes ?? 0}</dd></div>
      </dl>
    `;

    const persist = document.createElement('div');
    persist.id = 'fechar-persistencia-status';
    persist.className = 'cds-fechar-consignacao__persistencia';
    persist.dataset.status = state.persistenciaStatus || 'saved';
    persist.textContent = state.persistenciaLabel
      || (state.persistenciaStatus === 'pending' ? '● Alterações pendentes' : '✓ Alterações salvas');
    aside.appendChild(persist);
    return aside;
  }

  static _statusLabel(state) {
    if (state === 'saving') return 'Salvando...';
    if (state === 'saved') return 'Salvo';
    if (state === 'error') return 'Erro';
    return '';
  }

  static patchLinhaRetorno(rowEl, item, index, state) {
    if (!rowEl || !item) return;

    rowEl.classList.toggle(
      'cds-fechar-consignacao__grade-row--editando',
      state.editing?.rowIndex === index
    );
    rowEl.classList.toggle(
      'cds-fechar-consignacao__grade-row--erro',
      Boolean(state.linhasComErro?.[index])
    );
    rowEl.classList.toggle(
      'cds-fechar-consignacao__grade-row--dirty',
      Boolean(item.dirty)
    );

    // STAB-04: DOM espelha State. Nunca sobrescrever campo dirty com valor "fantasma".
    ['vendido', 'devolvido', 'perdido', 'cortesia'].forEach((campo) => {
      const input = rowEl.querySelector(`input[data-campo="${campo}"]`);
      if (!input || document.activeElement === input) return;
      if (item.dirty && item.dirtyCampos?.[campo] && Number(input.value) === Number(item[campo] || 0)) {
        return;
      }
      input.value = String(item[campo] || 0);
    });

    const saldoEl = rowEl.querySelector('[data-saldo-index]');
    if (saldoEl) saldoEl.textContent = String(item.saldo ?? calcularSaldoItem(item));

    const obs = rowEl.querySelector('input[data-campo="observacao"]');
    if (obs && document.activeElement !== obs) obs.value = item.observacao || '';

    const statusEl = rowEl.querySelector('[data-status-row]');
    if (statusEl) {
      FecharConsignacaoView._aplicarStatusLinha(statusEl, item, index, state, null);
    }
  }

  static patchPainelLateral(asideEl, painel, state = {}) {
    if (!asideEl || !painel) return;
    const fin = (painel.preview && painel.financeiro)
      ? painel.financeiro
      : (state.snapshot?.financeiro || painel.financeiro || {});
    const situacaoLabel = labelSituacaoFinanceiraOficial(fin.situacaoFinanceira)
      || labelSituacaoFinanceira(fin.situacaoFinanceira)
      || '—';
    const semVenda = _isSemVenda(fin);
    const fields = {
      vendidos: String(painel.produtosVendidos ?? 0),
      devolvidos: String(painel.produtosDevolvidos ?? 0),
      perdas: String(painel.perdas ?? 0),
      cortesias: String(painel.cortesias ?? 0),
      pendentes: String(painel.pendentes ?? 0),
      situacaoFinanceira: situacaoLabel
    };
    if (!semVenda) {
      fields.valorVenda = formatCurrency(fin.valorVenda);
      fields.valorRecebido = formatCurrency(fin.valorRecebido);
      fields.saldoEmAberto = formatCurrency(fin.saldoEmAberto);
    }
    Object.entries(fields).forEach(([key, value]) => {
      const el = asideEl.querySelector(`[data-painel="${key}"]`);
      if (el) el.textContent = value;
    });
    ['valorVenda', 'valorRecebido', 'saldoEmAberto'].forEach((key) => {
      const metric = asideEl.querySelector(`[data-painel="${key}"]`)?.closest('.cds-retornos-sidebar__metric');
      if (metric) metric.hidden = semVenda;
      const legacy = asideEl.querySelector(`[data-painel="${key}"]`)?.closest('.cds-fechar-consignacao__painel-campo');
      if (legacy) legacy.hidden = semVenda;
    });

    const sitMetric = asideEl.querySelector('.cds-retornos-sidebar__metric--sit');
    if (sitMetric) {
      sitMetric.classList.remove(
        'cds-retornos-sidebar__metric--ok',
        'cds-retornos-sidebar__metric--warn',
        'cds-retornos-sidebar__metric--open'
      );
      sitMetric.classList.add(
        `cds-retornos-sidebar__metric--${FecharConsignacaoView._situacaoSidebarTone(fin.situacaoFinanceira)}`
      );
    }

    let statusEl = asideEl.querySelector('#fechar-persistencia-status');
    if (!statusEl) {
      statusEl = document.createElement('div');
      statusEl.id = 'fechar-persistencia-status';
      statusEl.className = 'cds-fechar-consignacao__persistencia';
      asideEl.appendChild(statusEl);
    }
    statusEl.dataset.status = state.persistenciaStatus || 'saved';
    statusEl.textContent = state.persistenciaLabel
      || (state.persistenciaStatus === 'pending' ? '● Alterações pendentes' : '✓ Alterações salvas');
  }

  static _renderAtalhos() {
    const bar = document.createElement('div');
    bar.className = 'cds-fechar-consignacao__atalhos';
    bar.innerHTML = `
      <span><kbd>TAB</kbd> Próximo campo</span>
      <span><kbd>Shift</kbd>+<kbd>TAB</kbd> Campo anterior</span>
      <span><kbd>ENTER</kbd> Confirmar campo (opcional)</span>
      <span><kbd>ESC</kbd> Cancelar edição</span>
      <span><kbd>↑</kbd><kbd>↓</kbd> Mover entre linhas</span>
    `;
    return bar;
  }

  static _formatPagamentoQuando(data) {
    if (!data) return '—';
    const d = new Date(data);
    if (Number.isNaN(d.getTime())) return safeText(formatDateTime(data));
    const hoje = new Date();
    const mesmoDia = d.toDateString() === hoje.toDateString();
    const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    if (mesmoDia) return `Hoje ${hora}`;
    return `${d.toLocaleDateString('pt-BR')} ${hora}`;
  }

  static _fiscalBadge(situacaoCodigo = '', label = '') {
    const sit = String(situacaoCodigo || '').toUpperCase();
    if (sit === 'AUTORIZADA' || sit === 'NAO_APLICAVEL') {
      return { marca: '✓', texto: sit === 'NAO_APLICAVEL' ? 'Não aplicável' : 'Autorizada', tom: 'ok' };
    }
    if (sit === 'PENDENTE_REGULARIZACAO' || sit === 'REJEITADA') {
      return { marca: '⚠', texto: sit === 'REJEITADA' ? (label || 'Rejeitada') : 'Pendente', tom: 'warn' };
    }
    if (sit === 'EMITINDO') {
      return { marca: '●', texto: label || 'Emitindo…', tom: 'atual' };
    }
    return { marca: '○', texto: label || 'Pendente', tom: 'pendente' };
  }

  static _htmlCardFinanceiro(fin, situacaoLabel) {
    if (_isSemVenda(fin)) {
      return `
      <h3 class="cds-op-card__titulo">Resumo Financeiro</h3>
      <p class="cds-op-card__meta">Situação Financeira<br><strong data-kpi="situacao">${safeText(situacaoLabel)}</strong></p>
    `;
    }
    return `
      <h3 class="cds-op-card__titulo">Resumo Financeiro</h3>
      <div class="cds-op-kpis">
        <div class="cds-op-kpi cds-op-kpi--venda">
          <span class="cds-op-kpi__label">Valor da Venda</span>
          <strong class="cds-op-kpi__valor" data-kpi="venda">${formatCurrency(fin.valorVenda)}</strong>
        </div>
        <div class="cds-op-kpi cds-op-kpi--recebido">
          <span class="cds-op-kpi__label">Recebido</span>
          <strong class="cds-op-kpi__valor" data-kpi="recebido">${formatCurrency(fin.valorRecebido)}</strong>
        </div>
        <div class="cds-op-kpi cds-op-kpi--saldo">
          <span class="cds-op-kpi__label">Saldo</span>
          <strong class="cds-op-kpi__valor" data-kpi="saldo">${formatCurrency(fin.saldoEmAberto)}</strong>
        </div>
      </div>
      <p class="cds-op-card__meta">Situação Financeira<br><strong data-kpi="situacao">${safeText(situacaoLabel)}</strong></p>
    `;
  }

  static _htmlListaPagamentos(pagamentos = []) {
    if (!pagamentos.length) {
      return '<p class="cds-caption cds-op-empty">Nenhum pagamento registrado nesta prestação.</p>';
    }
    return `
      <div class="cds-op-hist-modal-table" role="table">
        <div class="cds-op-hist-modal-table__head" role="row">
          <span>Forma</span><span>Valor</span><span>Data/Hora</span><span>Operador</span><span>Observação</span>
        </div>
        ${pagamentos.map((p) => `
          <div class="cds-op-hist-modal-table__row" role="row">
            <span>${safeText(p.forma)}</span>
            <strong>${formatCurrency(p.valor)}</strong>
            <span>${safeText(formatDateTime(p.data))}</span>
            <span>${safeText(p.operador)}</span>
            <span>${safeText(p.observacao || '—')}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  static _buildBlocoPagamentos(state, ctx, fin) {
    const section = document.createElement('section');
    section.className = 'cds-op-card cds-op-card--pagamentos';
    section.dataset.card = 'pagamentos';
    section.innerHTML = '<h3 class="cds-op-card__titulo">Pagamento</h3>';

    if (_isSemVenda(fin)) {
      section.appendChild(Alert.create({
        message: 'Situação Financeira: Sem Venda — ainda não há venda registrada nesta prestação.',
        variant: 'info',
        dismissible: false
      }));
    } else if (Number(fin.saldoEmAberto) <= 0.01) {
      section.appendChild(Alert.create({
        message: MENSAGENS.PRESTACAO_QUITADA,
        variant: 'success',
        dismissible: false
      }));
    } else {
      const draft = state.pagamentoDraft || { valor: '', formaPagamento: 'DINHEIRO' };
      const form = document.createElement('div');
      form.className = 'cds-fechar-consignacao__pagamento-form cds-op-pagamento-form';

      const valorField = document.createElement('div');
      valorField.className = 'cds-fechar-consignacao__campo';
      valorField.innerHTML = '<label>Valor deste pagamento</label>';
      valorField.appendChild(Input.create({
        type: 'number',
        placeholder: '0,00',
        value: draft.valor || '',
        onChange: (v) => ctx.onPagamentoChange('valor', v)
      }));
      form.appendChild(valorField);

      const formaField = document.createElement('div');
      formaField.className = 'cds-fechar-consignacao__campo';
      formaField.innerHTML = '<label>Forma</label>';
      formaField.appendChild(Select.create({
        options: [
          { value: 'DINHEIRO', label: 'Dinheiro' },
          { value: 'PIX', label: 'PIX' },
          { value: 'TRANSFERENCIA', label: 'Transferência' },
          { value: 'CHEQUE', label: 'Cheque' },
          { value: 'CARTAO', label: 'Cartão' }
        ],
        value: draft.formaPagamento || 'DINHEIRO',
        onChange: (v) => ctx.onPagamentoChange('formaPagamento', v)
      }));
      form.appendChild(formaField);
      section.appendChild(form);

      if (state.pagamentoErro) {
        section.appendChild(Alert.create({
          message: state.pagamentoErro,
          variant: 'error',
          dismissible: true
        }));
      }

      const registrarWrap = document.createElement('div');
      registrarWrap.className = 'cds-op-pagamento-actions';
      registrarWrap.appendChild(Button.create({
        text: state.loading?.operation ? 'Registrando…' : 'Registrar Pagamento',
        variant: 'secondary',
        disabled: Boolean(state.loading?.operation),
        onClick: () => ctx.onRegistrarPagamento && ctx.onRegistrarPagamento()
      }));
      section.appendChild(registrarWrap);
    }

    const histBtn = document.createElement('div');
    histBtn.className = 'cds-op-pagamento-historico-btn';
    histBtn.appendChild(Button.create({
      text: 'Histórico de Pagamentos',
      variant: 'ghost',
      onClick: () => ctx.onAbrirHistoricoPagamentos && ctx.onAbrirHistoricoPagamentos()
    }));
    section.appendChild(histBtn);
    return section;
  }

  static abrirModalHistoricoPagamentos(pagamentos = [], onClose) {
    const content = document.createElement('div');
    content.className = 'cds-op-hist-modal';
    content.innerHTML = FecharConsignacaoView._htmlListaPagamentos(pagamentos);

    let backdrop = null;
    const fechar = () => {
      if (!backdrop) return;
      backdrop.classList.remove('cds-modal-backdrop--open', 'is-open');
      setTimeout(() => backdrop.remove(), 180);
      if (onClose) onClose();
    };

    const footer = document.createElement('div');
    footer.appendChild(Button.create({
      text: 'Fechar',
      variant: 'secondary',
      onClick: fechar
    }));

    backdrop = Modal.create({
      title: 'Histórico de Pagamentos',
      content,
      footer,
      open: false,
      onClose: fechar
    });
    backdrop.classList.add('cds-op-hist-modal-backdrop');
    document.body.appendChild(backdrop);
    requestAnimationFrame(() => backdrop.classList.add('cds-modal-backdrop--open', 'is-open'));
    return backdrop;
  }

  static _buildCardInfoPrestacao(state, fechamento) {
    const consignacao = state.consignacao || {};
    const dataRef = consignacao.dataEntrega
      || consignacao.dataPrestacao
      || consignacao.updatedAt
      || consignacao.createdAt
      || null;
    const observacao = consignacao.observacao
      || consignacao.observacoes
      || state.clienteDetalhe?.observacao
      || '—';
    const section = document.createElement('section');
    section.className = 'cds-op-card cds-op-card--info';
    section.dataset.card = 'info';
    section.innerHTML = `
      <h3 class="cds-op-card__titulo">Informações da Prestação</h3>
      <dl class="cds-op-info-list">
        <div><dt>Cliente</dt><dd>${safeText(fechamento.cliente)}</dd></div>
        <div><dt>Documento</dt><dd>${safeText(fechamento.documento)}</dd></div>
        <div><dt>Data</dt><dd>${safeText(dataRef ? formatDate(dataRef) : '—')}</dd></div>
        <div><dt>Operador</dt><dd>${safeText(getOperadorNomeLocal())}</dd></div>
        <div class="cds-op-info-list__obs"><dt>Observação</dt><dd>${safeText(observacao)}</dd></div>
      </dl>
    `;
    return section;
  }

  static _buildCardFiscal(state, fechamento) {
    const snap = state.snapshot || {};
    const vendaId = fechamento.vendaId || snap.vendaOficial?.vendaId || null;
    const vendaBadge = vendaId
      ? { marca: '✓', texto: 'Criada', tom: 'ok' }
      : { marca: '○', texto: 'Aguardando', tom: 'pendente' };
    const nfceBadge = FecharConsignacaoView._fiscalBadge(
      fechamento.situacaoFiscal,
      fechamento.situacaoFiscalLabel
    );

    const section = document.createElement('section');
    section.className = 'cds-op-card cds-op-card--fiscal';
    section.dataset.card = 'fiscal';
    section.innerHTML = `
      <h3 class="cds-op-card__titulo">Situação Fiscal</h3>
      <div class="cds-op-status-rows">
        <div class="cds-op-status-row">
          <span class="cds-op-status-row__label">Venda Oficial</span>
          <span class="cds-op-status-pill cds-op-status-pill--${vendaBadge.tom}">
            <span aria-hidden="true">${vendaBadge.marca}</span> ${vendaBadge.texto}
          </span>
        </div>
        <div class="cds-op-status-row">
          <span class="cds-op-status-row__label">NFC-e</span>
          <span class="cds-op-status-pill cds-op-status-pill--${nfceBadge.tom}">
            <span aria-hidden="true">${nfceBadge.marca}</span> ${safeText(nfceBadge.texto)}
          </span>
        </div>
      </div>
      <p class="cds-op-proximo">
        <span>Próximo passo</span>
        <strong>${safeText(fechamento.proximoPasso)}</strong>
      </p>
    `;
    return section;
  }

  static _htmlLog(logs = []) {
    if (!logs.length) {
      return '<p class="cds-caption cds-op-empty">Nenhuma ação registrada nesta sessão.</p>';
    }
    return `
      <ul class="cds-prestacao-log-list">
        ${logs.slice(0, 8).map((l) => `
          <li>
            <span class="cds-prestacao-log-list__hora">${safeText(formatDateTime(l.em))}</span>
            <strong>${safeText(l.acao)}</strong>
          </li>
        `).join('')}
      </ul>
    `;
  }

  /**
   * Patch seletivo dos cards (STAB-07.4) — evita reload visual da estação.
   */
  static patchCentralOperacional(root, state, ctx, scopes = []) {
    if (!root) return false;
    const snap = state.snapshot || {};
    const fin = snap.financeiro || _financeiroFromState(state);
    if (!fin) return false;
    const fechamento = buildPainelFechamentoOperacional({
      consignacao: state.consignacao || {},
      clienteDetalhe: state.clienteDetalhe,
      financeiro: fin,
      faturamento: state.faturamento,
      emitindoNfce: Boolean(state.emitindoNfce)
    });
    const set = new Set(scopes.length ? scopes : ['financeiro', 'pagamentos', 'fiscal', 'info']);

    if (set.has('financeiro')) {
      const card = root.querySelector('[data-card="financeiro"]');
      if (card) {
        card.innerHTML = FecharConsignacaoView._htmlCardFinanceiro(
          fin,
          fechamento.situacaoFinanceiraLabel
        );
        card.classList.add('cds-op-card--flash');
        setTimeout(() => card.classList.remove('cds-op-card--flash'), 450);
      }
    }
    if (set.has('pagamentos')) {
      const pagCard = root.querySelector('[data-card="pagamentos"]');
      if (pagCard) {
        const novo = FecharConsignacaoView._buildBlocoPagamentos(state, ctx, fin);
        pagCard.replaceWith(novo);
        novo.classList.add('cds-op-card--flash');
        setTimeout(() => novo.classList.remove('cds-op-card--flash'), 450);
      }
    }
    if (set.has('fiscal')) {
      const card = root.querySelector('[data-card="fiscal"]');
      if (card) {
        const novo = FecharConsignacaoView._buildCardFiscal(state, fechamento);
        card.replaceWith(novo);
        novo.classList.add('cds-op-card--flash');
        setTimeout(() => novo.classList.remove('cds-op-card--flash'), 450);
      }
    }
    if (set.has('info')) {
      const card = root.querySelector('[data-card="info"]');
      if (card) {
        const novo = FecharConsignacaoView._buildCardInfoPrestacao(state, fechamento);
        card.replaceWith(novo);
      }
    }
    return true;
  }

  /**
   * Estação Operacional — layout oficial STAB-07.4 (duas colunas).
   */
  static renderConferenciaFinal(state, ctx) {
    const wrap = document.createElement('div');
    wrap.className = 'cds-fechar-consignacao__momento cds-prestacao-central-operacional';

    const title = document.createElement('h2');
    title.className = 'cds-fechar-consignacao__titulo cds-op-titulo';
    title.textContent = 'Estação Operacional';
    wrap.appendChild(title);

    const snap = state.snapshot || {};
    const fin = snap.financeiro || _financeiroFromState(state);
    if (!fin) {
      wrap.appendChild(Alert.create({
        message: 'Carregando dados financeiros…',
        variant: 'info',
        dismissible: false
      }));
      return wrap;
    }

    auditarIntegridadeNoResumo(fin, {
      consignacaoId: state.consignacao?.id,
      clienteId: state.consignacao?.clienteId,
      cliente: state.clienteDetalhe?.nome || state.consignacao?.clienteNome,
      documento: state.consignacao?.documento,
      origem: 'resumo-final'
    });
    auditarCadeiaFiscal({
      faturamento: state.faturamento,
      financeiro: fin,
      historico: state.historico || []
    });
    auditarFinalRC1({
      consignacao: state.consignacao || {},
      financeiro: fin,
      faturamento: state.faturamento,
      historico: state.historico || [],
      itens: snap.itens || []
    });

    if (state.ultimaFalhaEmitir?.mensagem) {
      wrap.appendChild(criarAlertaErroOperacional(Alert, state.ultimaFalhaEmitir, {
        onRetry: state.ultimaFalhaEmitir.retryable
          ? () => ctx.onEmitirNfceRetry && ctx.onEmitirNfceRetry()
          : null,
        onClose: () => ctx.onLimparFalhaEmitir && ctx.onLimparFalhaEmitir()
      }));
    }

    const fechamento = buildPainelFechamentoOperacional({
      consignacao: state.consignacao || {},
      clienteDetalhe: state.clienteDetalhe,
      financeiro: fin,
      faturamento: state.faturamento,
      emitindoNfce: Boolean(state.emitindoNfce)
    });
    assertMesmoFinanceiro(fin, buildResumoFinalOficial({
      financeiro: fin,
      faturamento: state.faturamento
    }));

    const grid = document.createElement('div');
    grid.className = 'cds-prestacao-central-grid';

    const colEsq = document.createElement('div');
    colEsq.className = 'cds-prestacao-central-grid__col';

    const finSection = document.createElement('section');
    finSection.className = 'cds-op-card cds-op-card--financeiro';
    finSection.dataset.card = 'financeiro';
    finSection.innerHTML = FecharConsignacaoView._htmlCardFinanceiro(
      fin,
      fechamento.situacaoFinanceiraLabel
    );
    colEsq.appendChild(finSection);
    colEsq.appendChild(FecharConsignacaoView._buildBlocoPagamentos(state, ctx, fin));
    if (Number(state.rateioPerda?.totais?.totalPerdido || 0) > 0.01
      || Number(state.painel?.perdas || 0) > 0) {
      colEsq.appendChild(montarBlocoRateio(state, ctx));
    }

    const colDir = document.createElement('div');
    colDir.className = 'cds-prestacao-central-grid__col';

    colDir.appendChild(FecharConsignacaoView._buildCardFiscal(state, fechamento));

    if (fechamento.situacaoFiscal === 'AUTORIZADA' && fechamento.vendaId) {
      const danfeWrap = document.createElement('div');
      danfeWrap.className = 'cds-op-danfe-actions';
      danfeWrap.appendChild(Button.create({
        text: 'Visualizar DANFE',
        variant: 'ghost',
        size: 'sm',
        onClick: () => ctx.onVisualizarDanfe && ctx.onVisualizarDanfe(fechamento.vendaId)
      }));
      danfeWrap.appendChild(Button.create({
        text: 'Reimprimir',
        variant: 'ghost',
        size: 'sm',
        onClick: () => ctx.onReimprimirDanfe && ctx.onReimprimirDanfe(fechamento.vendaId)
      }));
      colDir.appendChild(danfeWrap);
    }

    colDir.appendChild(FecharConsignacaoView._buildCardInfoPrestacao(state, fechamento));

    grid.appendChild(colEsq);
    grid.appendChild(colDir);
    wrap.appendChild(grid);
    return wrap;
  }

  static renderEncerramento(state, ctx) {
    const wrap = document.createElement('div');
    wrap.className = 'cds-fechar-consignacao__momento cds-central-encerramento cds-central-encerramento--ux12';

    const fin = _financeiroFromState(state)
      || buildPainelLateral(state.resumoPrestacao, state.resumoPrestacao?.itens || []).financeiro;
    const vm = buildCentralEncerramento({
      consignacao: state.consignacao,
      resumo: state.resumoPrestacao,
      financeiro: fin,
      painel: state.painel,
      clienteDetalhe: state.clienteDetalhe,
      dataEncerramento: state.dataEncerramento || new Date()
    });

    const { financeiro, acoes } = vm;

    wrap.innerHTML = `
      <header class="cds-central-encerramento__header">
        <div class="cds-central-encerramento__badge">✓</div>
        <h2 class="cds-central-encerramento__titulo">${vm.titulo}</h2>
        <p class="cds-central-encerramento__subtitulo">${vm.subtitulo}</p>
      </header>

      ${!financeiro.quitado ? `
      <section class="cds-central-encerramento__situacao cds-central-encerramento__situacao--warning">
        <p class="cds-central-encerramento__situacao-label">
          Saldo em Aberto
          <span class="cds-central-encerramento__situacao-valor">${formatCurrency(financeiro.saldoEmAberto)}</span>
        </p>
      </section>
      ` : ''}

      <section class="cds-central-encerramento__bloco cds-central-encerramento__acoes-wrap">
        <div class="cds-central-encerramento__acoes" data-acoes></div>
      </section>
    `;

    const actionsHost = wrap.querySelector('[data-acoes]');
    const botoes = [];

    if (acoes.mostrarRecebimento) {
      botoes.push({
        label: 'Receber Agora',
        acao: 'recebimento',
        destaque: acoes.primaria === 'recebimento'
      });
    }

    botoes.push({
      label: 'Imprimir Comprovante',
      acao: 'imprimir-comprovante',
      destaque: false
    });

    botoes.push({
      label: 'Voltar para Central',
      acao: 'voltar-central',
      destaque: acoes.primaria === 'voltar-central' || !acoes.mostrarRecebimento
    });

    const ignoreClicksUntil = Date.now() + 500;
    botoes.forEach((btn) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `cds-central-encerramento__acao${btn.destaque ? ' cds-central-encerramento__acao--primaria' : ''}`;
      el.textContent = btn.label;
      el.addEventListener('click', (event) => {
        if (Date.now() < ignoreClicksUntil) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        ctx.onEncerramentoAcao(btn.acao);
      });
      actionsHost.appendChild(el);
    });

    return wrap;
  }

  static renderPainelLateral(state) {
    const fin = _financeiroFromState(state);
    const painel = state.painel || buildPainelLateral(
      state.resumoPrestacao,
      state.resumoPrestacao?.itens || [],
      fin
    );
    const financeiro = fin || painel.financeiro;
    const aside = document.createElement('aside');
    aside.className = 'cds-fechar-consignacao__painel';
    aside.id = 'fechar-painel-lateral';
    aside.innerHTML = '<h3>Resumo do Atendimento</h3>';

    const grid = document.createElement('div');
    grid.className = 'cds-fechar-consignacao__painel-grid';

    const campos = [
      { label: 'Vendidos', key: 'vendidos', value: String(painel.produtosVendidos) },
      { label: 'Devolvidos', key: 'devolvidos', value: String(painel.produtosDevolvidos) },
      { label: 'Perdas', key: 'perdas', value: String(painel.perdas) },
      { label: 'Cortesias', key: 'cortesias', value: String(painel.cortesias) },
      ...(_isSemVenda(financeiro) ? [] : [
        { label: 'Valor da Venda', key: 'valorVenda', value: formatCurrency(financeiro.valorVenda), destaque: true },
        { label: 'Já Recebido', key: 'valorRecebido', value: formatCurrency(financeiro.valorRecebido), destaque: true },
        { label: 'Saldo em Aberto', key: 'saldoEmAberto', value: formatCurrency(financeiro.saldoEmAberto), destaque: true }
      ]),
      {
        label: 'Situação Financeira',
        key: 'situacaoFinanceira',
        value: labelSituacaoFinanceira(financeiro.situacaoFinanceira),
        destaque: true
      }
    ];

    campos.forEach((c) => {
      const cell = document.createElement('div');
      cell.className = `cds-fechar-consignacao__painel-campo${c.destaque ? ' cds-fechar-consignacao__painel-campo--destaque' : ''}`;
      cell.innerHTML = `<label>${c.label}</label><strong data-painel="${c.key}">${c.value}</strong>`;
      grid.appendChild(cell);
    });

    aside.appendChild(grid);

    const persist = document.createElement('div');
    persist.id = 'fechar-persistencia-status';
    persist.className = 'cds-fechar-consignacao__persistencia';
    persist.dataset.status = state.persistenciaStatus || 'saved';
    persist.textContent = state.persistenciaLabel
      || (state.persistenciaStatus === 'pending' ? '● Alterações pendentes' : '✓ Alterações salvas');
    aside.appendChild(persist);

    return aside;
  }
}

module.exports = FecharConsignacaoView;
