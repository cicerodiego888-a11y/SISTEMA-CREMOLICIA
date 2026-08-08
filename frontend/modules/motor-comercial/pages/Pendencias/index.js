/**
 * Central de Pendências e Alertas Inteligentes — ERP Proativo
 *
 * Sprint O-8.
 *
 * @module frontend/modules/motor-comercial/pages/Pendencias
 */

const DashboardLayout = require('../../components/layouts/DashboardLayout');
const Button = require('../../components/base/Button');
const StatCard = require('../../components/data/StatCard');
const Table = require('../../components/data/Table');
const Loading = require('../../components/base/Loading');
const EmptyState = require('../../components/base/EmptyState');
const Alert = require('../../components/base/Alert');
const Badge = require('../../components/base/Badge');
const Drawer = require('../../components/special/Drawer');
const ProjectionApi = require('../../api/ProjectionApi');
const PendenciasDrawer = require('./PendenciasDrawer');
const {
  buildViewFromPayload,
  buildFilterParams,
  applyFilters,
  savePendenciaAction,
  toggleFavorite,
  severityVariant,
  loadHistory
} = require('./pendenciasMappers');
const { notify, navigate, confirmDialog, promptDialog } = require('../../utils/operacional');
const {
  parseCliente360Context,
  resolveBackPath,
  routeWithActiveContext,
  getBackButtonLabel
} = require('../../utils/cliente360Context');
const {
  ConfirmMessages,
  emptyState,
  notifySuccess,
  notifyInfo
} = require('../../messages');

const REFRESH_INTERVAL_MS = 60000;

function getOperadorNome() {
  try {
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    return user?.nome || user?.username || 'Operador';
  } catch {
    return 'Operador';
  }
}

class PendenciasPage {
  constructor(routeParams = {}, routeQuery = {}) {
    this.routeParams = routeParams;
    this.routeQuery = routeQuery;
    this.navigationContext = parseCliente360Context(routeQuery);
    this.projectionApi = new ProjectionApi();
    this.payload = {};
    this.view = {};
    this.filteredView = {};
    this.lastUpdated = null;
    this.refreshTimer = null;
    this.activeDrawer = null;
    this.searchTimeout = null;

    this.filters = {
      categoria: routeQuery.categoria || '',
      severidade: routeQuery.severidade || '',
      clienteId: routeQuery.clienteId || '',
      operador: routeQuery.operador || '',
      status: routeQuery.status || '',
      periodo: routeQuery.periodo || 'week',
      search: routeQuery.q || '',
      favoritos: routeQuery.favoritos === '1'
    };
  }

  static create(params = {}, query = {}) {
    return new PendenciasPage(params, query).render();
  }

  render() {
    const layout = DashboardLayout.create({
      header: this._createHeader(),
      sidebar: this._createSidebar(),
      content: this._createContent(),
      footer: this._createFooter()
    });

    setTimeout(() => {
      this._loadData();
      this._startAutoRefresh();
    }, 0);

    return layout;
  }

  _createHeader() {
    const container = document.createElement('div');
    container.className = 'cds-pendencias-header';
    container.innerHTML = `
      <div class="cds-pendencias-header__left">
        <h1 class="cds-pendencias-header__title">Central de Pendências e Alertas</h1>
        <p class="cds-pendencias-header__subtitle">ERP Proativo — o que precisa da sua atenção agora</p>
        <span id="pendencias-updated" class="cds-pendencias-header__updated">Atualizando...</span>
      </div>
    `;
    const actions = document.createElement('div');
    actions.className = 'cds-pendencias-header__actions';
    if (this.navigationContext.locked) {
      actions.appendChild(Button.create({
        text: getBackButtonLabel(this.navigationContext, 'Voltar'),
        variant: 'ghost',
        onClick: () => navigate(resolveBackPath(this.navigationContext, '/clientes'))
      }));
    }
    actions.appendChild(Button.create({ text: 'Atualizar', variant: 'secondary', icon: '🔄', onClick: () => this._loadData() }));
    actions.appendChild(Button.create({
      text: 'Gerar Recomendações',
      variant: 'primary',
      icon: '💡',
      onClick: () => navigate(routeWithActiveContext('/recomendacoes', this.navigationContext))
    }));
    container.appendChild(actions);
    return container;
  }

  _createSidebar() {
    const nav = document.createElement('nav');
    nav.className = 'cds-pendencias-sidebar';
    nav.innerHTML = '<h3>Navegação</h3>';
    [
      { label: 'Painel', icon: '📊', path: '/' },
      { label: 'Pendências', icon: '🔔', path: '/pendencias', active: true },
      { label: 'Consignações', icon: '📦', path: '/consignacoes' },
      { label: 'Clientes', icon: '👥', path: '/clientes' },
      { label: 'Indicadores', icon: '📈', path: '/indicadores' },
      { label: 'Relatórios', icon: '📄', path: '/relatorios' }
    ].forEach((item) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `cds-pendencias-sidebar__item${item.active ? ' cds-pendencias-sidebar__item--active' : ''}`;
      btn.innerHTML = `<span>${item.icon}</span> ${item.label}`;
      btn.addEventListener('click', () => navigate(routeWithActiveContext(item.path, this.navigationContext)));
      nav.appendChild(btn);
    });
    return nav;
  }

  _createFooter() {
    const footer = document.createElement('div');
    footer.className = 'cds-pendencias-footer';
    footer.innerHTML = '<span>ERP Proativo — Motor Comercial</span><span>CDS Platform</span>';
    return footer;
  }

  _createContent() {
    const wrap = document.createElement('div');
    wrap.className = 'cds-pendencias-content';
    wrap.id = 'pendencias-root';
    wrap.appendChild(this._createFilters());
    wrap.appendChild(this._sectionHost('pendencias-resumo', 'Carregando resumo...'));
    wrap.appendChild(this._sectionHost('pendencias-proximas', 'Carregando próximas ações...'));
    wrap.appendChild(this._sectionHost('pendencias-criticas', 'Carregando pendências críticas...'));
    wrap.appendChild(this._sectionHost('pendencias-importantes', 'Carregando pendências importantes...'));
    wrap.appendChild(this._sectionHost('pendencias-informativas', 'Carregando pendências informativas...'));
    wrap.appendChild(this._sectionHost('pendencias-alertas', 'Carregando alertas...'));
    wrap.appendChild(this._sectionHost('pendencias-historico', 'Carregando histórico...'));
    return wrap;
  }

  _sectionHost(id, message) {
    const section = document.createElement('section');
    section.className = 'cds-pendencias-section';
    section.id = id;
    section.appendChild(Loading.create({ message }));
    return section;
  }

  _createFilters() {
    const container = document.createElement('div');
    container.className = 'cds-pendencias-filters';
    const row = document.createElement('div');
    row.className = 'cds-pendencias-filters__row';

    row.appendChild(this._filterSelect('categoria', 'Categoria', [
      { value: '', label: 'Todas' },
      { value: 'FINANCEIRO', label: 'Financeiro' },
      { value: 'COMERCIAL', label: 'Comercial' },
      { value: 'OPERACIONAL', label: 'Operacional' },
      { value: 'INTELIGENCIA', label: 'Análise' }
    ]));
    row.appendChild(this._filterSelect('severidade', 'Severidade', [
      { value: '', label: 'Todas' },
      { value: 'CRITICAL', label: 'Crítica' },
      { value: 'HIGH', label: 'Alta' },
      { value: 'MEDIUM', label: 'Média' },
      { value: 'LOW', label: 'Baixa' },
      { value: 'INFO', label: 'Info' }
    ]));
    row.appendChild(this._filterSelect('status', 'Status', [
      { value: '', label: 'Todos' },
      { value: 'PENDENTE', label: 'Pendente' }
    ]));

    const searchField = document.createElement('div');
    searchField.className = 'cds-pendencias-filters__field';
    searchField.innerHTML = '<label>Pesquisar</label>';
    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.className = 'cds-pendencias-filters__input';
    searchInput.placeholder = 'Buscar alertas...';
    searchInput.value = this.filters.search;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(this.searchTimeout);
      this.searchTimeout = setTimeout(() => {
        this.filters.search = e.target.value;
        this._applyAndRender();
      }, 300);
    });
    searchField.appendChild(searchInput);
    row.appendChild(searchField);

    const favBtn = Button.create({
      text: this.filters.favoritos ? '★ Favoritos' : '☆ Favoritos',
      variant: this.filters.favoritos ? 'primary' : 'ghost',
      onClick: () => {
        this.filters.favoritos = !this.filters.favoritos;
        this._applyAndRender();
        this._renderFilters();
      }
    });
    favBtn.id = 'pendencias-fav-btn';
    row.appendChild(favBtn);

    container.appendChild(row);
    return container;
  }

  _renderFilters() {
    const favBtn = document.getElementById('pendencias-fav-btn');
    if (favBtn) {
      favBtn.textContent = this.filters.favoritos ? '★ Favoritos' : '☆ Favoritos';
    }
  }

  _filterSelect(name, label, options) {
    const field = document.createElement('div');
    field.className = 'cds-pendencias-filters__field';
    field.innerHTML = `<label>${label}</label>`;
    const select = document.createElement('select');
    select.className = 'cds-pendencias-filters__select';
    options.forEach((opt) => {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      option.selected = this.filters[name] === opt.value;
      select.appendChild(option);
    });
    select.addEventListener('change', (e) => {
      this.filters[name] = e.target.value;
      this._applyAndRender();
    });
    field.appendChild(select);
    return field;
  }

  async _loadData(silent = false) {
    const params = buildFilterParams({
      clienteId: this.filters.clienteId || undefined,
      dataInicio: this._periodStart(),
      dataFim: new Date().toISOString()
    });

    try {
      const pendencias = await this.projectionApi.obterProjecaoPendencias(params);
      this.payload = pendencias;
      this.view = buildViewFromPayload(pendencias);
      this._applyAndRender();
      this.lastUpdated = new Date();
      this._updateHeaderMeta();
      this._publishNotificationCount();
    } catch (error) {
      if (!silent) {
        const section = document.getElementById('pendencias-resumo');
        if (section) {
          section.innerHTML = '';
          section.appendChild(Alert.create({ message: error.message, variant: 'error', dismissible: true }));
        }
      }
    }
  }

  _applyAndRender() {
    this.filteredView = applyFilters(this.view, this.filters);
    this._renderAllSections();
  }

  _periodStart() {
    const now = new Date();
    const start = new Date(now);
    if (this.filters.periodo === 'week') start.setDate(now.getDate() - 7);
    else if (this.filters.periodo === 'month') start.setMonth(now.getMonth() - 1);
    else start.setDate(now.getDate() - 1);
    return start.toISOString();
  }

  _updateHeaderMeta() {
    const el = document.getElementById('pendencias-updated');
    if (el && this.lastUpdated) {
      el.textContent = `Atualizado: ${this.lastUpdated.toLocaleTimeString('pt-BR')} — Operador: ${getOperadorNome()}`;
    }
  }

  _publishNotificationCount() {
    if (typeof window !== 'undefined') {
      window.MotorComercial = window.MotorComercial || {};
      window.MotorComercial.pendenciasCount = this.view.notificationCount ?? 0;
      window.dispatchEvent(new CustomEvent('motor-comercial:pendencias-updated', {
        detail: { count: this.view.notificationCount ?? 0 }
      }));
    }
  }

  _renderAllSections() {
    this._renderResumo();
    this._renderProximasAcoes();
    this._renderAlertList('pendencias-criticas', 'Pendências Críticas', this.filteredView.criticas);
    this._renderAlertList('pendencias-importantes', 'Pendências Importantes', this.filteredView.importantes);
    this._renderAlertList('pendencias-informativas', 'Pendências Informativas', this.filteredView.informativas);
    this._renderAlertList('pendencias-alertas', 'Alertas Inteligentes', this.filteredView.alertas);
    this._renderHistorico();
  }

  _renderResumo() {
    const section = document.getElementById('pendencias-resumo');
    if (!section) return;
    section.innerHTML = '';
    const title = document.createElement('h2');
    title.className = 'cds-pendencias-section__title';
    title.textContent = 'Resumo Geral';
    section.appendChild(title);

    const r = this.filteredView.resumo || {};
    const grid = document.createElement('div');
    grid.className = 'cds-pendencias-resumo';

    [
      { title: 'Total Alertas', value: r.total ?? 0, format: 'number', color: 'primary' },
      { title: 'Críticos', value: r.criticos ?? 0, format: 'number', color: 'error' },
      { title: 'Altos', value: r.altos ?? 0, format: 'number', color: 'warning' },
      { title: 'Médios', value: r.medios ?? 0, format: 'number', color: 'info' },
      { title: 'Baixos', value: r.baixos ?? 0, format: 'number', color: 'default' },
      { title: 'Resolvidos Hoje', value: r.resolvidosHoje ?? 0, format: 'number', color: 'success' },
      { title: 'Pendentes', value: r.pendentes ?? 0, format: 'number', color: 'primary' }
    ].forEach((card) => grid.appendChild(StatCard.create(card)));

    section.appendChild(grid);
  }

  _renderProximasAcoes() {
    const section = document.getElementById('pendencias-proximas');
    if (!section) return;
    section.innerHTML = '';

    const title = document.createElement('h2');
    title.className = 'cds-pendencias-section__title';
    title.textContent = 'O que devo fazer agora?';
    section.appendChild(title);

    const items = this.filteredView.proximasAcoes || [];
    if (!items.length) {
      section.appendChild(EmptyState.create(emptyState('PENDENCIAS')));
      return;
    }

    const list = document.createElement('div');
    list.className = 'cds-pendencias-proximas';
    items.forEach((item, index) => {
      const card = document.createElement('div');
      card.className = 'cds-pendencias-proxima';
      card.innerHTML = `
        <span class="cds-pendencias-proxima__rank">${index + 1}</span>
        <div class="cds-pendencias-proxima__body">
          <strong>${item.titulo}</strong>
          <p>${item.acao}</p>
        </div>
      `;
      const actions = document.createElement('div');
      actions.appendChild(Button.create({ text: 'Executar', variant: 'primary', onClick: () => this._navigateAction(item) }));
      actions.appendChild(Button.create({ text: 'Detalhe', variant: 'ghost', onClick: () => {
        const alerta = this.filteredView.alertas.find((a) => a.id === item.id);
        if (alerta) this._openDrawer(alerta);
      }}));
      card.appendChild(actions);
      list.appendChild(card);
    });
    section.appendChild(list);
  }

  _renderAlertList(sectionId, titleText, alertas) {
    const section = document.getElementById(sectionId);
    if (!section) return;
    section.innerHTML = '';

    const title = document.createElement('h2');
    title.className = 'cds-pendencias-section__title';
    title.textContent = titleText;
    section.appendChild(title);

    if (!alertas.length) {
      section.appendChild(EmptyState.create({ title: 'Nenhum item', description: `Sem registros em ${titleText.toLowerCase()}` }));
      return;
    }

    section.appendChild(Table.create({
      columns: [
        { key: 'fav', label: '' },
        { key: 'categoria', label: 'Categoria' },
        { key: 'severidade', label: 'Severidade' },
        { key: 'descricao', label: 'Descrição' },
        { key: 'cliente', label: 'Cliente' },
        { key: 'workflow', label: 'Processo' },
        { key: 'acao', label: 'Ação' },
        { key: 'acoes', label: '' }
      ],
      data: alertas.map((a) => ({
        id: a.id,
        fav: Button.create({
          text: a.favorito ? '★' : '☆',
          variant: 'ghost',
          onClick: (e) => { e.stopPropagation(); toggleFavorite(a.id); this._applyAndRender(); }
        }),
        categoria: Badge.create({ text: a.categoria, variant: 'info' }),
        severidade: Badge.create({ text: a.severidade, variant: severityVariant(a.severidade) }),
        descricao: a.descricao,
        cliente: a.cliente || '-',
        workflow: Button.create({
          text: 'Ver',
          variant: 'ghost',
          onClick: (e) => {
            e.stopPropagation();
            navigate(`/workflow?clienteId=${a.clienteId || ''}&q=${encodeURIComponent(a.workflowRelacionado || '')}`);
          }
        }),
        acao: a.acaoRecomendada || '-',
        acoes: this._rowActions(a),
        _raw: a
      })),
      onRowClick: (row) => this._openDrawer(row._raw)
    }));
  }

  _rowActions(alerta) {
    const wrap = document.createElement('div');
    wrap.className = 'cds-pendencias-row-actions';
    wrap.appendChild(Button.create({ text: '✓', variant: 'ghost', title: 'Resolver', onClick: (e) => { e.stopPropagation(); this._resolveAlerta(alerta); } }));
    wrap.appendChild(Button.create({ text: '⊘', variant: 'ghost', title: 'Ignorar', onClick: (e) => { e.stopPropagation(); this._ignoreAlerta(alerta); } }));
    return wrap;
  }

  _renderHistorico() {
    const section = document.getElementById('pendencias-historico');
    if (!section) return;
    section.innerHTML = '';

    const title = document.createElement('h2');
    title.className = 'cds-pendencias-section__title';
    title.textContent = 'Histórico de Alertas';
    section.appendChild(title);

    const history = loadHistory();
    if (!history.length) {
      section.appendChild(EmptyState.create({ title: 'Sem histórico', description: 'Alertas resolvidos aparecerão aqui' }));
      return;
    }

    section.appendChild(Table.create({
      columns: [
        { key: 'alerta', label: 'Alerta' },
        { key: 'responsavel', label: 'Quem resolveu' },
        { key: 'quando', label: 'Quando' },
        { key: 'tempo', label: 'Tempo' },
        { key: 'obs', label: 'Observações' }
      ],
      data: history.slice(0, 20).map((h) => ({
        alerta: h.alerta,
        responsavel: h.responsavel || '-',
        quando: h.resolvidoEm ? new Date(h.resolvidoEm).toLocaleString('pt-BR') : '-',
        tempo: h.tempoResolucaoHoras != null ? `${h.tempoResolucaoHoras}h` : '-',
        obs: h.observacao || '-'
      }))
    }));
  }

  async _openDrawer(alerta) {
    if (this.activeDrawer) {
      this.activeDrawer.remove();
      this.activeDrawer = null;
    }

    const content = document.createElement('div');
    const panel = new PendenciasDrawer(this, alerta);
    await panel.mount(content);

    const drawer = Drawer.create({
      title: alerta.descricao,
      content,
      size: 'lg',
      open: true,
      onClose: () => { this.activeDrawer = null; }
    });

    this.activeDrawer = drawer;
    document.body.appendChild(drawer);
  }

  _navigateAction(item) {
    if (item.link) navigate(item.link.startsWith('/') ? item.link : '/pendencias');
    else if (item.consignacaoId) navigate(`/consignacoes/${item.consignacaoId}`);
    else if (item.clienteId) navigate(`/clientes/${item.clienteId}`);
  }

  async _resolveAlerta(alerta) {
    const ok = await confirmDialog({
      ...ConfirmMessages.RESOLVER_ALERTA,
      message: `Marcar "${alerta.descricao}" como resolvido?`
    });
    if (!ok) return;
    savePendenciaAction('resolved', alerta, { responsavel: getOperadorNome() });
    notifySuccess('PENDENCIA_RESOLVIDA');
    this._loadData(true);
  }

  async _ignoreAlerta(alerta) {
    const ok = await confirmDialog({
      ...ConfirmMessages.IGNORAR_ALERTA,
      message: `Ignorar "${alerta.descricao}"?`
    });
    if (!ok) return;
    savePendenciaAction('ignored', alerta);
    notifySuccess('PENDENCIA_IGNORADA');
    this._loadData(true);
  }

  async _deferAlerta(alerta) {
    const dias = await promptDialog({ title: 'Adiar alerta', message: 'Adiar por quantos dias?', defaultValue: '1' });
    if (dias == null) return;
    const until = new Date();
    until.setDate(until.getDate() + Number(dias || 1));
    savePendenciaAction('deferred', alerta, { until: until.toISOString() });
    notifyInfo('PENDENCIA_ADIADA', until.toLocaleDateString('pt-BR'));
    this._loadData(true);
  }

  async _delegateAlerta(alerta) {
    const para = await promptDialog({ title: 'Delegar alerta', message: 'Delegar para (nome do operador):', defaultValue: '' });
    if (!para) return;
    savePendenciaAction('delegated', alerta, { para });
    notifySuccess('PENDENCIA_DELEGADA');
  }

  async _observeAlerta(alerta) {
    const obs = await promptDialog({ title: 'Observação', message: 'Registrar observação:', defaultValue: alerta.observacao || '' });
    if (obs == null) return;
    savePendenciaAction('observation', alerta, { observacao: obs });
    notifySuccess('OBSERVACAO_REGISTRADA');
    this._loadData(true);
  }

  _startAutoRefresh() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = setInterval(() => {
      if (!document.getElementById('pendencias-root')) {
        clearInterval(this.refreshTimer);
        return;
      }
      this._loadData(true);
    }, REFRESH_INTERVAL_MS);
  }
}

module.exports = PendenciasPage;
