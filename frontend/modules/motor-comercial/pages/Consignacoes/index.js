/**
 * Central de Operações Comerciais — Cockpit Operacional
 *
 * Sprint O-3: Central de Operações Comerciais.
 *
 * @module frontend/modules/motor-comercial/pages/Consignacoes
 */

const DashboardLayout = require('../../components/layouts/DashboardLayout');
const Button = require('../../components/base/Button');
const Table = require('../../components/data/Table');
const Pagination = require('../../components/data/Pagination');
const Loading = require('../../components/base/Loading');
const EmptyState = require('../../components/base/EmptyState');
const Alert = require('../../components/base/Alert');
const StatCard = require('../../components/data/StatCard');
const ActionMenu = require('../../components/special/ActionMenu');
const Drawer = require('../../components/special/Drawer');
const MotorComercialApi = require('../../api/MotorComercialApi');
const ProjectionApi = require('../../api/ProjectionApi');
const { mapConsignacaoView } = require('../../api/helpers');
const CockpitDrawer = require('./CockpitDrawer');
const { createOperationalBadge, enrichConsignacaoOperationalFlags } = require('./badges');
const { buildViewFromPayload, countPendenciasForConsignacao } = require('../Pendencias/pendenciasMappers');
const {
  notify,
  navigate,
  confirmDialog,
  promptDialog,
  choiceDialog,
  withLoading,
  carregarConsignacaoCompleta,
  getUsuarioId
} = require('../../utils/operacional');
const {
  parseCliente360Context,
  routeWithActiveContext,
  buildRouteWithCliente360Context
} = require('../../utils/cliente360Context');
const {
  MOTIVOS_CANCELAMENTO,
  podeCancelarPreparacao,
  lerCancelamento,
  MENSAGEM_CANCELADA_NOVA
} = require('./cancelamentoPreparacao');
const {
  ErrorMessages,
  ConfirmMessages,
  emptyState,
  notifySuccess,
  notifyError,
  notifyWarning,
  loadingText,
  resolveOperationalError
} = require('../../messages');

const FAVORITES_KEY = 'motor-comercial:cockpit-filtros-favoritos';
const REFRESH_INTERVAL_MS = 60000;

function getOperadorNome() {
  try {
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    return user?.nome || user?.username || 'Operador';
  } catch {
    return 'Operador';
  }
}

class ConsignacoesPage {
  constructor(routeQuery = {}) {
    this.navigationContext = parseCliente360Context(routeQuery);
    this.api = new MotorComercialApi();
    this.projectionApi = new ProjectionApi();
    this.allConsignacoes = [];
    this.consignacoes = [];
    this.totalCount = 0;
    this.loading = true;
    this.error = null;
    this.lastUpdated = null;
    this.dashboardData = null;
    this.pendenciasAlertas = [];
    this.selectedId = null;
    this.drawerOpen = false;
    this.activeDrawer = null;
    this.cockpitDrawer = null;
    this.refreshTimer = null;

    this.filters = {
      empresa: '',
      filial: '',
      cliente: '',
      consignado: '',
      documento: '',
      status: '',
      prestacao: '',
      periodoInicio: '',
      periodoFim: '',
      operador: '',
      search: ''
    };

    this.pagination = {
      currentPage: 1,
      pageSize: 20,
      totalPages: 1
    };

    this.sort = {
      column: 'data',
      direction: 'desc'
    };

    this.searchTimeout = null;
    this.layoutRoot = null;
  }

  static create(params = {}, query = {}) {
    const page = new ConsignacoesPage(query);
    return page.render();
  }

  render() {
    const layout = DashboardLayout.create({
      header: this._createHeader(),
      sidebar: this._createSidebar(),
      content: this._createMainContent(),
      footer: this._createFooter()
    });

    this.layoutRoot = layout;
    setTimeout(() => {
      this._loadData();
      this._startAutoRefresh();
      this._bindFocusRefresh();
    }, 0);

    return layout;
  }

  _createMainContent() {
    const wrap = document.createElement('div');
    wrap.className = 'cds-cockpit-main';

    const cardsHost = document.createElement('div');
    cardsHost.id = 'cockpit-cards';
    cardsHost.className = 'cds-cockpit-cards';
    cardsHost.appendChild(Loading.create({ message: 'Carregando indicadores...' }));
    wrap.appendChild(cardsHost);

    wrap.appendChild(this._createFilters());
    wrap.appendChild(this._createContent());

    const paginationHost = document.createElement('div');
    paginationHost.id = 'cockpit-pagination';
    paginationHost.appendChild(this._createPagination());
    wrap.appendChild(paginationHost);

    return wrap;
  }

  _createHeader() {
    const container = document.createElement('header');
    container.className = 'cds-cockpit-header cds-page-header';

    const left = document.createElement('div');
    left.className = 'cds-cockpit-header__left';

    const eyebrow = document.createElement('p');
    eyebrow.className = 'cds-eyebrow';
    eyebrow.textContent = 'Motor Comercial';
    left.appendChild(eyebrow);

    const title = document.createElement('h1');
    title.className = 'cds-title cds-cockpit-header__title';
    title.textContent = 'Consignações';
    left.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'cds-cockpit-header__meta';
    meta.innerHTML = `
      <span>Empresa: <strong>${this.filters.empresa || 'Todas'}</strong></span>
      <span>Filial: <strong>${this.filters.filial || 'Todas'}</strong></span>
      <span>Operador: <strong>${getOperadorNome()}</strong></span>
      <span id="cockpit-updated" class="cds-cockpit-header__updated">Atualizando...</span>
    `;
    left.appendChild(meta);
    container.appendChild(left);

    const actions = document.createElement('div');
    actions.className = 'cds-cockpit-header__actions';

    actions.appendChild(Button.create({
      text: 'Atualizar',
      variant: 'secondary',
      icon: '🔄',
      onClick: () => this._loadData()
    }));

    actions.appendChild(Button.create({
      text: 'Preparar Entrega',
      variant: 'primary',
      icon: '+',
      onClick: () => this._navigateToNew()
    }));

    actions.appendChild(Button.create({
      text: 'Exportar',
      variant: 'ghost',
      icon: '📥',
      onClick: () => this._exportCsv()
    }));

    container.appendChild(actions);
    return container;
  }

  _createSidebar() {
    const sidebar = document.createElement('nav');
    sidebar.className = 'cds-cockpit-sidebar';

    const title = document.createElement('h3');
    title.className = 'cds-cockpit-sidebar__title';
    title.textContent = 'Atalhos';
    sidebar.appendChild(title);

    const shortcuts = [
      { label: 'Preparar Entrega', icon: '➕', action: () => this._navigateToNew() },
      { label: 'Fechar Atendimento', icon: '💰', action: () => this._shortcutNovaPrestacao() },
      { label: 'Entregar', icon: '📦', action: () => this._shortcutEntregar() },
      { label: 'Abrir Perfil', icon: '👤', action: () => navigate('/clientes') },
      { label: 'Conta Corrente', icon: '🏦', action: () => this._shortcutContaCorrente() },
      { label: 'Central de Trabalho', icon: '📊', action: () => navigate('/') }
    ];

    shortcuts.forEach((sc) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cds-cockpit-sidebar__item';
      btn.innerHTML = `<span>${sc.icon}</span> ${sc.label}`;
      btn.addEventListener('click', sc.action);
      sidebar.appendChild(btn);
    });

    return sidebar;
  }

  _createFooter() {
    const footer = document.createElement('div');
    footer.className = 'cds-cockpit-footer';
    footer.innerHTML = `
      <span>Motor Comercial — Consignações</span>
      <span id="cockpit-footer-count">0 registros</span>
    `;
    return footer;
  }

  _createFilters() {
    const container = document.createElement('div');
    container.className = 'cds-consignacoes-filters';

    const searchRow = document.createElement('div');
    searchRow.className = 'cds-consignacoes-filters__row cds-consignacoes-filters__row--search';

    const searchField = document.createElement('div');
    searchField.className = 'cds-consignacoes-filters__field cds-consignacoes-filters__field--wide';
    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.className = 'cds-consignacoes-filters__input';
    searchInput.placeholder = 'Pesquisar documento, cliente, consignado, produto, observação...';
    searchInput.dataset.filter = 'search';
    searchInput.addEventListener('input', (e) => {
      clearTimeout(this.searchTimeout);
      this.searchTimeout = setTimeout(() => {
        this.filters.search = e.target.value;
        this._applyClientPipeline();
      }, 300);
    });
    searchField.appendChild(searchInput);
    searchRow.appendChild(searchField);
    container.appendChild(searchRow);

    const row1 = document.createElement('div');
    row1.className = 'cds-consignacoes-filters__row';
    row1.appendChild(this._createFilterSelect('empresa', 'Empresa', [
      { value: '', label: 'Todas' },
      { value: 'cremolicia', label: 'Cremolicia' }
    ]));
    row1.appendChild(this._createFilterSelect('filial', 'Filial', [
      { value: '', label: 'Todas' },
      { value: 'matriz', label: 'Matriz' },
      { value: 'filial1', label: 'Filial 1' }
    ]));
    row1.appendChild(this._createFilterSelect('status', 'Situação', [
      { value: '', label: 'Todas' },
      { value: 'RASCUNHO', label: 'Rascunho' },
      { value: 'ENTREGUE', label: 'Entregue' },
      { value: 'ACERTADA', label: 'Acertada' },
      { value: 'ENCERRADA', label: 'Encerrada' },
      { value: 'CANCELADA', label: 'Cancelada' }
    ]));
    container.appendChild(row1);

    const row2 = document.createElement('div');
    row2.className = 'cds-consignacoes-filters__row';
    row2.appendChild(this._createFilterInput('cliente', 'Cliente'));
    row2.appendChild(this._createFilterInput('consignado', 'Consignado'));
    row2.appendChild(this._createFilterInput('documento', 'Documento'));
    container.appendChild(row2);

    const row3 = document.createElement('div');
    row3.className = 'cds-consignacoes-filters__row';
    row3.appendChild(this._createFilterSelect('prestacao', 'Fechamento', [
      { value: '', label: 'Todas' },
      { value: 'ABERTA', label: 'Aberta' },
      { value: 'FECHADA', label: 'Fechada' },
      { value: 'ATRASADA', label: 'Atrasada' }
    ]));
    row3.appendChild(this._createFilterInput('operador', 'Operador'));
    row3.appendChild(this._createFilterDate('periodoInicio', 'Período início'));
    row3.appendChild(this._createFilterDate('periodoFim', 'Período fim'));
    container.appendChild(row3);

    const actions = document.createElement('div');
    actions.className = 'cds-consignacoes-filters__actions';

    actions.appendChild(Button.create({ text: 'Pesquisar', variant: 'primary', onClick: () => this._applyFilters() }));
    actions.appendChild(Button.create({ text: 'Limpar Filtros', variant: 'ghost', onClick: () => this._clearFilters() }));
    actions.appendChild(Button.create({ text: 'Salvar favorito', variant: 'ghost', onClick: () => this._saveFavoriteFilter() }));
    actions.appendChild(Button.create({ text: 'Carregar favorito', variant: 'ghost', onClick: () => this._loadFavoriteFilter() }));

    container.appendChild(actions);

    const indicator = document.createElement('div');
    indicator.id = 'cockpit-filtros-ativos';
    indicator.className = 'cds-filtros-ativos';
    indicator.hidden = true;
    container.appendChild(indicator);

    return container;
  }

  _createFilterSelect(name, label, options) {
    const container = document.createElement('div');
    container.className = 'cds-consignacoes-filters__field';

    const labelEl = document.createElement('label');
    labelEl.textContent = label;
    container.appendChild(labelEl);

    const select = document.createElement('select');
    select.className = 'cds-consignacoes-filters__select';
    select.dataset.filter = name;
    select.value = this.filters[name] || '';
    options.forEach((opt) => {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      select.appendChild(option);
    });
    select.addEventListener('change', (e) => {
      this.filters[name] = e.target.value;
      this._applyClientPipeline();
    });
    container.appendChild(select);
    return container;
  }

  _createFilterInput(name, placeholder) {
    const container = document.createElement('div');
    container.className = 'cds-consignacoes-filters__field';

    const labelEl = document.createElement('label');
    labelEl.textContent = placeholder;
    container.appendChild(labelEl);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'cds-consignacoes-filters__input';
    input.placeholder = placeholder;
    input.dataset.filter = name;
    input.value = this.filters[name] || '';
    input.addEventListener('input', (e) => {
      clearTimeout(this.searchTimeout);
      this.searchTimeout = setTimeout(() => {
        this.filters[name] = e.target.value;
        this._applyClientPipeline();
      }, 300);
    });
    container.appendChild(input);
    return container;
  }

  _createFilterDate(name, label) {
    const container = document.createElement('div');
    container.className = 'cds-consignacoes-filters__field';

    const labelEl = document.createElement('label');
    labelEl.textContent = label;
    container.appendChild(labelEl);

    const input = document.createElement('input');
    input.type = 'date';
    input.className = 'cds-consignacoes-filters__input';
    input.dataset.filter = name;
    input.value = this.filters[name] || '';
    input.addEventListener('change', (e) => {
      this.filters[name] = e.target.value;
      this._applyClientPipeline();
    });
    container.appendChild(input);
    return container;
  }

  _createContent() {
    const container = document.createElement('div');
    container.className = 'cds-consignacoes-content cds-consignacoes-table--virtual-ready';
    container.id = 'consignacoes-content';

    if (this.loading) {
      container.appendChild(Loading.create({ message: loadingText('CARREGANDO_CONSIGNACAO') }));
    } else if (this.error) {
      container.appendChild(Alert.create({
        message: resolveOperationalError(this.error, { context: 'consignacao' })
          || ErrorMessages.CONSIGNACAO_CARREGAR,
        variant: 'error',
        dismissible: true
      }));
    } else if (this.consignacoes.length === 0) {
      container.appendChild(EmptyState.create(emptyState('CONSIGNACOES')));
    } else {
      container.appendChild(this._createTable());
    }

    return container;
  }

  _createTable() {
    const columns = [
      { key: 'indicador', label: '' },
      { key: 'pendencias', label: 'Pendências' },
      { key: 'documento', label: 'Documento', sortable: true },
      { key: 'cliente', label: 'Cliente', sortable: true },
      { key: 'consignado', label: 'Consignado' },
      { key: 'status', label: 'Status', sortable: true },
      { key: 'prestacao', label: 'Fechamento' },
      { key: 'valor', label: 'Valor', sortable: true },
      { key: 'saldo', label: 'Saldo', sortable: true },
      { key: 'entrega', label: 'Entrega', sortable: true },
      { key: 'ultimaMovimentacao', label: 'Última Mov.', sortable: true },
      { key: 'usuario', label: 'Operador' },
      { key: 'acoes', label: 'Ações' }
    ];

    const data = this.consignacoes.map((c) => ({
      id: c.id,
      indicador: this._createVisualIndicator(c),
      pendencias: this._createPendenciasIndicator(c),
      documento: c.documento,
      cliente: c.clienteNome || c.cliente,
      consignado: c.consignado,
      status: createOperationalBadge(c),
      prestacao: c.aguardandoEntrega ? 'Aguardando Entrega' : c.prestacaoStatus,
      valor: this._formatCurrency(c.valor, c),
      saldo: this._formatCurrency(c.saldo, c),
      entrega: this._formatDate(c.dataEntrega),
      ultimaMovimentacao: this._formatDate(c.ultimaMovimentacao),
      usuario: c.usuario,
      acoes: this._createActionMenu(c),
      _raw: c
    }));

    return Table.create({
      columns,
      data,
      sortable: true,
      onSort: (column) => this._handleSort(column),
      onRowClick: (row) => this._openDrawer(row._raw || row)
    });
  }

  _createPendenciasIndicator(consignacao) {
    const count = countPendenciasForConsignacao(this.pendenciasAlertas || [], consignacao.id);
    const el = document.createElement('span');
    el.className = `cds-cockpit-pendencias${count > 0 ? ' cds-cockpit-pendencias--alert' : ''}`;
    if (count > 0) {
      el.innerHTML = `<span class="cds-pendencias-badge-count">${count}</span>`;
      el.title = `${count} pendência(s)`;
    } else {
      el.textContent = '—';
      el.title = 'Sem pendências';
    }
    return el;
  }

  _createVisualIndicator(consignacao) {
    const el = document.createElement('span');
    el.className = 'cds-cockpit-indicator';
    el.title = 'Normal';
    if (consignacao.urgente) {
      el.classList.add('cds-cockpit-indicator--urgente');
      el.title = 'Urgente';
    } else if (consignacao.prestacaoAtrasada) {
      el.classList.add('cds-cockpit-indicator--atrasada');
      el.title = 'Fechamento atrasado';
    } else if (consignacao.prestacaoAberta) {
      el.classList.add('cds-cockpit-indicator--aberta');
      el.title = 'Fechamento em aberto';
    }
    return el;
  }

  _createActionMenu(consignacao) {
    const status = String(consignacao.status || '').toUpperCase();
    const actions = [
      { label: 'Visualizar', icon: '👁️', onClick: () => this._openDrawer(consignacao) }
    ];

    if (status === 'RASCUNHO') {
      actions.push(
        { label: 'Editar', icon: '✏️', onClick: () => this._editConsignacao(consignacao) },
        { label: 'Entregar', icon: '📦', onClick: () => this._deliverConsignacao(consignacao) }
      );
    }

    if (status === 'ENTREGUE') {
      actions.push({
        label: '+ Adicionar produto',
        icon: '➕',
        onClick: () => this._abrirEntregaComplementar(consignacao)
      });
      actions.push({
        label: 'Fechar Atendimento',
        icon: '💰',
        onClick: () => this._openPrestacao(consignacao)
      });
    }

    if (status !== 'CANCELADA' && status !== 'RASCUNHO') {
      // perfil / conta / timeline disponíveis para estados não cancelados
    }

    actions.push(
      { label: 'Perfil Comercial', icon: '👤', onClick: () => this._openDrawer(consignacao, 'perfil') },
      { label: 'Conta Corrente', icon: '🏦', onClick: () => this._openDrawer(consignacao, 'financeiro') },
      { label: 'Linha do Tempo', icon: '📜', onClick: () => this._openDrawer(consignacao, 'timeline') },
      { label: 'Duplicar', icon: '📋', onClick: () => this._duplicateConsignacao(consignacao) }
    );

    if (podeCancelarPreparacao(consignacao)) {
      actions.push({
        label: 'Cancelar preparação',
        icon: '❌',
        onClick: () => this._cancelConsignacao(consignacao),
        danger: true
      });
    }

    actions.push({ label: 'Imprimir', icon: '🖨️', onClick: () => this._printConsignacao(consignacao) });

    return ActionMenu.create({ actions, triggerIcon: '⋮' });
  }

  _createPagination() {
    return Pagination.create({
      currentPage: this.pagination.currentPage,
      totalPages: this.pagination.totalPages,
      totalItems: this.totalCount,
      pageSize: this.pagination.pageSize,
      onPageChange: (page) => this._handlePageChange(page)
    });
  }

  _createCards() {
    const host = document.getElementById('cockpit-cards');
    if (!host) return;

    host.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'cds-cockpit-cards__grid';

    const d = this.dashboardData || {};
    const items = this.allConsignacoes;

    const cards = [
      { title: 'Consignações Abertas', value: d.consignacoesAbertas ?? items.filter((c) => c.status === 'RASCUNHO' || c.status === 'ENTREGUE').length, icon: '📂', color: 'primary' },
      { title: 'Entregues', value: d.entregues ?? items.filter((c) => c.status === 'ENTREGUE').length, icon: '📦', color: 'success' },
      { title: 'Fechamento em Aberto', value: d.prestacaoAberta ?? items.filter((c) => c.prestacaoAberta).length, icon: '💰', color: 'warning' },
      { title: 'Fechamento Atrasado', value: d.prestacaoAtrasada ?? items.filter((c) => c.prestacaoAtrasada).length, icon: '⏰', color: 'error' },
      { title: 'Saldo em Aberto', value: this._formatCurrency(d.saldoEmAberto ?? items.reduce((s, c) => s + (c.saldo || 0), 0)), icon: '⚖️', color: 'warning' },
      { title: 'Clientes Ativos', value: d.clientesAtivos ?? new Set(items.map((c) => c.clienteId).filter(Boolean)).size, icon: '👥', color: 'primary' },
      { title: 'Valor Consignado', value: this._formatCurrency(d.valorConsignado ?? items.reduce((s, c) => s + (c.valor || 0), 0)), icon: '💎', color: 'success' },
      { title: 'Recebimentos do Dia', value: this._formatCurrency(d.recebimentosDia || 0), icon: '💵', color: 'success' }
    ];

    cards.forEach((cfg) => grid.appendChild(StatCard.create(cfg)));
    host.appendChild(grid);
  }

  async _loadData(options = {}) {
    const silent = options.silent === true;
    if (!silent) {
      this.loading = true;
      this.error = null;
      this._updateContent();
    }

    try {
      const apiParams = {};
      if (this.filters.status) apiParams.status = this.filters.status;
      const clienteFilter = String(this.filters.cliente || '').trim();
      if (/^\d+$/.test(clienteFilter)) {
        apiParams.clienteId = clienteFilter;
      } else if (clienteFilter) {
        apiParams.busca = clienteFilter;
      }
      const search = String(this.filters.search || '').trim();
      if (search && !apiParams.busca) apiParams.busca = search;
      if (this.filters.documento) apiParams.busca = this.filters.documento;

      // RCM-04.B — sempre consulta o backend; invalida snapshot local
      this.allConsignacoes = [];
      this.consignacoes = [];

      const [listResult, dashboard, pendenciasPayload] = await Promise.all([
        this.api.listarConsignacoes({ ...apiParams, _t: Date.now() }),
        this.projectionApi.obterProjecaoDashboard({ _t: Date.now() }).catch(() => ({})),
        this.projectionApi.obterProjecaoPendencias({ _t: Date.now() }).catch(() => ({}))
      ]);

      const items = (listResult.items || []).map((item) => mapConsignacaoView(item));
      const resumoMap = {};

      // Só enriquece resumo financeiro para consignações já entregues (RASCUNHO não calcula)
      const paraResumo = items.filter((item) => String(item.status || '').toUpperCase() !== 'RASCUNHO');
      await Promise.all(paraResumo.slice(0, 50).map(async (item) => {
        try {
          const resumo = await this.projectionApi.obterResumoPrestacao({ consignacaoId: item.id });
          resumoMap[item.id] = resumo;
        } catch {
          resumoMap[item.id] = {};
        }
      }));

      this.allConsignacoes = items.map((item) => enrichConsignacaoOperationalFlags(item, resumoMap));
      this.dashboardData = dashboard;
      this.pendenciasAlertas = buildViewFromPayload(pendenciasPayload).alertas || [];
      this.lastUpdated = new Date();
      this.loading = false;

      this._applyClientPipeline();
      this._updateFiltrosAtivos();
      this._createCards();
      this._updateHeaderMeta();

      if (this.cockpitDrawer && this.drawerOpen) {
        await this.cockpitDrawer.refresh();
      }
    } catch (error) {
      this.loading = false;
      this.error = error;
      if (!silent) this._updateContent();
    }
  }

  _applyClientPipeline() {
    let filtered = [...this.allConsignacoes];

    const q = (this.filters.search || '').toLowerCase();
    if (q) {
      filtered = filtered.filter((c) => {
        const blob = [
          c.documento, c.cliente, c.clienteNome, c.clienteDocumento, c.clienteFantasia,
          c.clienteTelefone, c.consignado, c.observacao, c.produtoResumo, c.id, c.clienteId
        ]
          .map((v) => String(v || '').toLowerCase())
          .join(' ');
        return blob.includes(q) || blob.replace(/\D/g, '').includes(q.replace(/\D/g, ''));
      });
    }

    if (this.filters.cliente) {
      const term = this.filters.cliente.toLowerCase();
      const termDigits = term.replace(/\D/g, '');
      filtered = filtered.filter((c) => {
        const nome = String(c.clienteNome || c.cliente || '').toLowerCase();
        const fantasia = String(c.clienteFantasia || '').toLowerCase();
        const doc = String(c.clienteDocumento || '').toLowerCase();
        const tel = String(c.clienteTelefone || '').toLowerCase();
        const id = String(c.clienteId || '');
        const obs = String(c.observacao || '').toLowerCase();
        return nome.includes(term)
          || fantasia.includes(term)
          || doc.includes(term)
          || tel.includes(term)
          || id.includes(term)
          || obs.includes(term)
          || (termDigits && (doc.replace(/\D/g, '').includes(termDigits) || tel.replace(/\D/g, '').includes(termDigits)));
      });
    }
    if (this.filters.consignado) {
      const term = this.filters.consignado.toLowerCase();
      filtered = filtered.filter((c) => String(c.consignado || '').toLowerCase().includes(term));
    }
    if (this.filters.documento) {
      const term = this.filters.documento.toLowerCase();
      filtered = filtered.filter((c) => {
        const doc = String(c.documento || '').toLowerCase();
        const id = String(c.id || '');
        const cliDoc = String(c.clienteDocumento || '').toLowerCase();
        return doc.includes(term) || id.includes(term) || cliDoc.includes(term);
      });
    }
    if (this.filters.operador) {
      const term = this.filters.operador.toLowerCase();
      filtered = filtered.filter((c) => String(c.usuario || '').toLowerCase().includes(term));
    }
    if (this.filters.prestacao === 'ABERTA') {
      filtered = filtered.filter((c) => c.prestacaoAberta);
    } else if (this.filters.prestacao === 'FECHADA') {
      filtered = filtered.filter((c) => !c.prestacaoAberta && c.status === 'ACERTADA');
    } else if (this.filters.prestacao === 'ATRASADA') {
      filtered = filtered.filter((c) => c.prestacaoAtrasada);
    }
    if (this.filters.periodoInicio) {
      const start = new Date(this.filters.periodoInicio);
      filtered = filtered.filter((c) => new Date(c.data || c.dataAbertura) >= start);
    }
    if (this.filters.periodoFim) {
      const end = new Date(this.filters.periodoFim);
      end.setHours(23, 59, 59, 999);
      filtered = filtered.filter((c) => new Date(c.data || c.dataAbertura) <= end);
    }

    filtered = this._applySort(filtered);

    this.totalCount = filtered.length;
    this.pagination.totalPages = Math.max(1, Math.ceil(this.totalCount / this.pagination.pageSize));
    if (this.pagination.currentPage > this.pagination.totalPages) {
      this.pagination.currentPage = 1;
    }

    const start = (this.pagination.currentPage - 1) * this.pagination.pageSize;
    this.consignacoes = filtered.slice(start, start + this.pagination.pageSize);

    this._updateFiltrosAtivos();
    this._updateContent();
    this._updatePagination();
    this._updateFooter();
  }

  _getFiltrosAtivos() {
    const chips = [];
    if (this.filters.status) chips.push({ label: 'Status', value: this.filters.status });
    if (this.filters.cliente) chips.push({ label: 'Cliente', value: this.filters.cliente });
    if (this.filters.documento) chips.push({ label: 'Documento', value: this.filters.documento });
    if (this.filters.consignado) chips.push({ label: 'Consignado', value: this.filters.consignado });
    if (this.filters.prestacao) chips.push({ label: 'Fechamento', value: this.filters.prestacao });
    if (this.filters.operador) chips.push({ label: 'Operador', value: this.filters.operador });
    if (this.filters.search) chips.push({ label: 'Busca', value: this.filters.search });
    if (this.filters.periodoInicio || this.filters.periodoFim) {
      const ini = this.filters.periodoInicio || '…';
      const fim = this.filters.periodoFim || '…';
      chips.push({ label: 'Período', value: `${ini} → ${fim}` });
    }
    return chips;
  }

  _updateFiltrosAtivos() {
    const host = document.getElementById('cockpit-filtros-ativos');
    if (!host) return;
    const chips = this._getFiltrosAtivos();
    if (!chips.length) {
      host.hidden = true;
      host.innerHTML = '';
      return;
    }
    host.hidden = false;
    host.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'cds-filtros-ativos__title';
    title.textContent = 'Filtros ativos:';
    host.appendChild(title);
    chips.forEach((chip) => {
      const el = document.createElement('span');
      el.className = 'cds-filtros-ativos__chip';
      el.innerHTML = `<strong>${chip.label}:</strong> ${chip.value}`;
      host.appendChild(el);
    });
    const limpar = document.createElement('button');
    limpar.type = 'button';
    limpar.className = 'cds-filtros-ativos__limpar';
    limpar.textContent = 'Limpar Filtros';
    limpar.addEventListener('click', () => this._clearFilters());
    host.appendChild(limpar);
  }

  _bindFocusRefresh() {
    if (this._focusRefreshBound) return;
    this._focusRefreshBound = true;
    this._onFocusRefresh = () => {
      if (!document.getElementById('consignacoes-content')) return;
      this._invalidateLocalCache();
      this._loadData({ silent: true });
    };
    window.addEventListener('focus', this._onFocusRefresh);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this._onFocusRefresh();
    });
  }

  _invalidateLocalCache() {
    this.allConsignacoes = [];
    this.consignacoes = [];
    this.dashboardData = null;
    this.lastUpdated = null;
  }

  _updatePagination() {
    const host = document.getElementById('cockpit-pagination');
    if (!host) return;
    host.innerHTML = '';
    host.appendChild(this._createPagination());
  }

  _applySort(items) {
    const { column, direction } = this.sort;
    if (!column || column === 'acoes' || column === 'indicador') return items;

    return [...items].sort((a, b) => {
      let av = a[column];
      let bv = b[column];
      if (column === 'data') {
        av = new Date(a.data || a.dataAbertura || 0).getTime();
        bv = new Date(b.data || b.dataAbertura || 0).getTime();
      }
      if (column === 'entrega') {
        av = new Date(a.dataEntrega || 0).getTime();
        bv = new Date(b.dataEntrega || 0).getTime();
      }
      if (typeof av === 'string') av = av.toLowerCase();
      if (typeof bv === 'string') bv = bv.toLowerCase();
      if (av < bv) return direction === 'asc' ? -1 : 1;
      if (av > bv) return direction === 'asc' ? 1 : -1;
      return 0;
    });
  }

  _updateContent() {
    const content = document.getElementById('consignacoes-content');
    if (!content) return;
    content.innerHTML = '';
    const inner = this._createContent();
    content.replaceWith(inner);
    inner.id = 'consignacoes-content';
  }

  _updateHeaderMeta() {
    const updated = document.getElementById('cockpit-updated');
    if (updated && this.lastUpdated) {
      updated.textContent = `Última atualização: ${this.lastUpdated.toLocaleTimeString('pt-BR')}`;
    }
  }

  _updateFooter() {
    const footer = document.getElementById('cockpit-footer-count');
    if (footer) footer.textContent = `${this.totalCount} registros`;
  }

  _applyFilters() {
    this.pagination.currentPage = 1;
    this._loadData();
  }

  _clearFilters() {
    this.filters = {
      empresa: '',
      filial: '',
      cliente: '',
      consignado: '',
      documento: '',
      status: '',
      prestacao: '',
      periodoInicio: '',
      periodoFim: '',
      operador: '',
      search: ''
    };
    document.querySelectorAll('[data-filter]').forEach((el) => {
      el.value = '';
    });
    this.pagination.currentPage = 1;
    this._loadData();
  }

  async _saveFavoriteFilter() {
    const nome = await promptDialog({
      title: 'Salvar filtro favorito',
      message: 'Nome do filtro:',
      placeholder: 'Ex: Prestações atrasadas'
    });
    if (!nome) return;

    const favorites = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
    favorites.push({ nome, filters: { ...this.filters }, savedAt: new Date().toISOString() });
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
    notify('Filtro salvo com sucesso.', 'success');
  }

  async _loadFavoriteFilter() {
    const favorites = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
    if (!favorites.length) {
      notify('Nenhum filtro favorito salvo.', 'info');
      return;
    }

    const escolha = await choiceDialog({
      title: 'Carregar filtro favorito',
      message: 'Selecione um filtro:',
      choices: favorites.map((f) => ({ label: f.nome, value: f }))
    });
    if (!escolha) return;

    this.filters = { ...escolha.filters };
    document.querySelectorAll('[data-filter]').forEach((el) => {
      const key = el.dataset.filter;
      if (key && this.filters[key] !== undefined) el.value = this.filters[key];
    });
    this._applyFilters();
  }

  _handleSort(column) {
    if (this.sort.column === column) {
      this.sort.direction = this.sort.direction === 'asc' ? 'desc' : 'asc';
    } else {
      this.sort.column = column;
      this.sort.direction = 'asc';
    }
    this._applyClientPipeline();
  }

  _handlePageChange(page) {
    this.pagination.currentPage = page;
    this._applyClientPipeline();
  }

  async _openDrawer(consignacao, tab = 'resumo') {
    this.selectedId = consignacao.id;
    this.drawerOpen = true;

    if (this.activeDrawer) {
      this.activeDrawer.remove();
      this.activeDrawer = null;
    }

    const drawerContent = document.createElement('div');
    this.cockpitDrawer = new CockpitDrawer(this, consignacao);
    this.cockpitDrawer.activeTab = tab;
    await this.cockpitDrawer.mount(drawerContent);

    const footer = this._createDrawerFooter(consignacao);

    const drawer = Drawer.create({
      title: `Consignação ${consignacao.documento}`,
      content: drawerContent,
      footer,
      size: 'lg',
      open: true,
      onClose: () => {
        this.drawerOpen = false;
        this.selectedId = null;
        this.activeDrawer = null;
        this.cockpitDrawer = null;
        // RCM-04.B — retornar da edição/detalhe força nova leitura
        this._invalidateLocalCache();
        this._loadData({ silent: true });
      }
    });

    this.activeDrawer = drawer;
    document.body.appendChild(drawer);
  }

  _createDrawerFooter(consignacao) {
    const container = document.createElement('div');
    container.className = 'cds-consignacao-drawer__footer';
    const status = String(consignacao.status || '').toUpperCase();

    if (status === 'CANCELADA') {
      const cancel = lerCancelamento(consignacao);
      const info = document.createElement('p');
      info.className = 'cds-consignacao-drawer__cancelada';
      info.textContent = cancel?.mensagem || MENSAGEM_CANCELADA_NOVA;
      container.appendChild(info);
      container.appendChild(Button.create({
        text: 'Imprimir',
        variant: 'secondary',
        onClick: () => this._printConsignacao(consignacao)
      }));
      return container;
    }

    if (status === 'RASCUNHO') {
      container.appendChild(Button.create({ text: 'Editar', variant: 'secondary', onClick: () => this._editConsignacao(consignacao) }));
      container.appendChild(Button.create({ text: 'Entregar', variant: 'primary', onClick: () => this._deliverConsignacao(consignacao) }));
      container.appendChild(Button.create({
        text: 'Cancelar preparação',
        variant: 'danger',
        onClick: () => this._cancelConsignacao(consignacao)
      }));
      return container;
    }

    if (status === 'ENTREGUE') {
      container.appendChild(Button.create({
        text: '+ Adicionar produto',
        variant: 'secondary',
        onClick: () => this._abrirEntregaComplementar(consignacao)
      }));
      container.appendChild(Button.create({
        text: 'Fechar Atendimento',
        variant: 'primary',
        onClick: () => this._openPrestacao(consignacao)
      }));
    }

    return container;
  }

  async _abrirEntregaComplementar(consignacao) {
    const {
      podeAdicionarProdutoComplementar,
      MENSAGEM_PRESTACAO_ENCERRADA
    } = require('../EntregaComplementar/entregaComplementarMappers');
    const check = podeAdicionarProdutoComplementar(consignacao);
    if (!check.elegivel) {
      notify(check.mensagem || MENSAGEM_PRESTACAO_ENCERRADA, 'warning');
      return;
    }
    await navigate(routeWithActiveContext(
      `/consignacoes/${consignacao.id}/entrega-complementar`,
      this.navigationContext
    ));
  }

  _startAutoRefresh() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = setInterval(() => {
      if (!document.getElementById('consignacoes-content')) {
        clearInterval(this.refreshTimer);
        return;
      }
      this._loadData({ silent: true });
    }, REFRESH_INTERVAL_MS);
  }

  _exportCsv() {
    const rows = this.allConsignacoes.length ? this.allConsignacoes : this.consignacoes;
    if (!rows.length) {
      notify('Nenhum dado para exportar.', 'warning');
      return;
    }

    const header = ['Documento', 'Cliente', 'Consignado', 'Status', 'Fechamento', 'Valor', 'Saldo', 'Entrega', 'Operador'];
    const lines = rows.map((c) => [
      c.documento, c.cliente, c.consignado, c.status, c.prestacaoStatus,
      c.valor, c.saldo, c.dataEntrega, c.usuario
    ].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));

    const csv = [header.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `central-operacoes-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    notify('Exportação concluída.', 'success');
  }

  _shortcutNovaPrestacao() {
    const alvo = this.allConsignacoes.find((c) => c.status === 'ENTREGUE');
    if (!alvo) {
      notify('Nenhuma consignação entregue disponível.', 'info');
      return;
    }
    this._openPrestacao(alvo);
  }

  _shortcutEntregar() {
    const alvo = this.allConsignacoes.find((c) => c.status === 'RASCUNHO');
    if (!alvo) {
      notify('Nenhuma consignação em rascunho para entregar.', 'info');
      return;
    }
    this._deliverConsignacao(alvo);
  }

  _shortcutContaCorrente() {
    const alvo = this.allConsignacoes.find((c) => c.status === 'ENTREGUE' || c.status === 'ACERTADA');
    if (!alvo) {
      notify('Selecione uma consignação na tabela para ver conta corrente.', 'info');
      return;
    }
    navigate(routeWithActiveContext(`/conta-corrente?clienteId=${alvo.clienteId}`, this.navigationContext));
  }

  _navigateToNew() {
    navigate(buildRouteWithCliente360Context('/consignacoes/nova', this.navigationContext));
  }

  async _editConsignacao(consignacao) {
    if (String(consignacao.status || '').toUpperCase() === 'CANCELADA') {
      notify(MENSAGEM_CANCELADA_NOVA, 'warning');
      return;
    }
    if (consignacao.status !== 'RASCUNHO') {
      notify('Somente consignações em rascunho podem ser editadas.', 'warning');
      return;
    }
    await navigate(buildRouteWithCliente360Context(
      `/consignacoes/nova?consignacaoId=${consignacao.id}`,
      this.navigationContext
    ));
  }

  _deliverConsignacao(consignacao) {
    navigate(routeWithActiveContext(`/consignacoes/${consignacao.id}/entrega`, this.navigationContext));
  }

  async _openPrestacao(consignacao) {
    try {
      if (consignacao.status === 'ENTREGUE') {
        await withLoading(loadingText('ABRINDO_PRESTACAO'), () => this.api.abrirPrestacao(consignacao.id));
      }
      await navigate(routeWithActiveContext(`/consignacoes/${consignacao.id}/prestacao`, this.navigationContext));
    } catch (error) {
      notifyError('PRESTACAO_ABRIR', error);
    }
  }

  async _cancelConsignacao(consignacao) {
    if (!podeCancelarPreparacao(consignacao)) {
      if (String(consignacao.status || '').toUpperCase() === 'CANCELADA') {
        notify(MENSAGEM_CANCELADA_NOVA, 'warning');
      } else {
        notifyWarning('SOMENTE_RASCUNHO');
      }
      return;
    }

    const confirmed = await confirmDialog({
      ...ConfirmMessages.CANCELAR_CONSIGNACAO,
      message: `Cancelar esta consignação?\nEsta ação cancelará a preparação e a entrega não será realizada.`
    });
    if (!confirmed) return;

    const motivo = await choiceDialog({
      title: 'Motivo do cancelamento',
      message: 'Selecione o motivo:',
      choices: MOTIVOS_CANCELAMENTO.map((m) => ({
        label: m.label,
        value: m.value,
        variant: m.value === 'OUTRO' ? 'secondary' : 'primary'
      }))
    });
    if (!motivo) return;

    let observacao = null;
    if (motivo === 'OUTRO') {
      observacao = await promptDialog({
        title: 'Descreva o motivo',
        label: 'Observação',
        placeholder: 'Informe o motivo do cancelamento'
      });
      if (observacao == null) return;
      observacao = String(observacao).trim() || null;
    }

    try {
      await withLoading(loadingText('CANCELANDO_CONSIGNACAO'), () => this.api.cancelarConsignacao(consignacao.id, {
        motivo,
        observacao
      }));
      notifySuccess('CONSIGNACAO_CANCELADA');
      await this._loadData();
    } catch (error) {
      notifyError('CONSIGNACAO_CANCELAR', error);
    }
  }

  async _duplicateConsignacao(consignacao) {
    const confirmed = await confirmDialog({
      ...ConfirmMessages.DUPLICAR_CONSIGNACAO,
      message: `Deseja duplicar a consignação ${consignacao.documento}?`
    });
    if (!confirmed) return;

    try {
      const completa = await carregarConsignacaoCompleta(this.api, this.projectionApi, consignacao.id);
      const created = await withLoading(loadingText('DUPLICANDO_CONSIGNACAO'), async () => {
        const result = await this.api.criarConsignacao({
          clienteId: completa.clienteId,
          perfilComercialId: completa.perfilComercialId,
          documentoExterno: completa.documentoExterno || null,
          observacao: `Duplicada de ${completa.documento}`,
          dataAbertura: new Date().toISOString().split('T')[0],
          usuarioId: getUsuarioId()
        });
        const nova = result.consignacao || result;
        for (const item of completa.itens || []) {
          await this.api.adicionarItem(nova.id, {
            produtoId: item.produtoId,
            quantidade: Number(item.quantidade),
            precoUnitario: Number(item.preco || item.precoUnitario || 0)
          });
        }
        return nova;
      });

      notifySuccess('CONSIGNACAO_DUPLICADA');
      await navigate(`/consignacoes/${created.id}/entrega`);
    } catch (error) {
      notifyError('CONSIGNACAO_DUPLICAR', error);
    }
  }

  _printConsignacao(consignacao) {
    this._openDrawer(consignacao).then(() => window.print());
  }

  _formatCurrency(value, item = null) {
    if (item && (item.aguardandoEntrega || String(item.status || '').toUpperCase() === 'RASCUNHO')) {
      return item.valorLabel || '—';
    }
    if (value == null || value === '') return '—';
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);
  }

  _formatDate(date) {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('pt-BR');
  }

  _formatDateTime(date) {
    if (!date) return '-';
    return new Date(date).toLocaleString('pt-BR');
  }
}

module.exports = ConsignacoesPage;
