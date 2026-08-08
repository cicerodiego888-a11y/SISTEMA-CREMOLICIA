/**
 * Conta Corrente Comercial — Extrato Operacional (UX-11)
 *
 * Primeira tela oficial do Motor Comercial sobre Shared UI Workspace.
 * Viewport: cliente · saldo · extrato · Receber. Análise fora do default.
 *
 * @module frontend/modules/motor-comercial/pages/ContaCorrente
 */

const Workspace = require('../../../../shared/ui/Workspace');
const Button = require('../../components/base/Button');
const Table = require('../../components/data/Table');
const Pagination = require('../../components/data/Pagination');
const Loading = require('../../components/base/Loading');
const EmptyState = require('../../components/base/EmptyState');
const Alert = require('../../components/base/Alert');
const Badge = require('../../components/base/Badge');
const GraphContainer = require('../../components/special/GraphContainer');
const Drawer = require('../../components/special/Drawer');
const Timeline = require('../../components/special/Timeline');
const StatCard = require('../../components/data/StatCard');
const MotorComercialApi = require('../../api/MotorComercialApi');
const ProjectionApi = require('../../api/ProjectionApi');
const MovimentoDrawer = require('./MovimentoDrawer');
const {
  TIPO_LABELS,
  buildResumoFinanceiro,
  buildExtrato,
  buildIndicadores,
  buildGraficos,
  buildAlertas,
  buildPendencias,
  applyExtratoFilters
} = require('./extratoMappers');
const { notify, navigate, choiceDialog } = require('../../utils/operacional');
const { exportToXlsx, exportToPdf } = require('../../utils/exportacao');
const {
  parseNavigationContext,
  resolveBackPath,
  getBackButtonLabel
} = require('../../utils/cliente360Context');
const { ensureStyles: ensureContaCorrenteStyles } = require('./styles');
const {
  emptyState,
  notifySuccess,
  notifyError
} = require('../../messages');

const REFRESH_INTERVAL_MS = 60000;

class ContaCorrentePage {
  constructor(routeParams = {}, routeQuery = {}) {
    this.routeParams = routeParams;
    this.routeQuery = routeQuery;
    this.navigationContext = parseNavigationContext(routeQuery);
    this.api = new MotorComercialApi();
    this.projectionApi = new ProjectionApi();

    this.consignacaoId = routeParams.id || routeQuery.consignacaoId || null;
    this.clienteId = routeQuery.clienteId || null;
    this.clienteNome = routeQuery.clienteNome || 'Cliente';
    this.documentoLabel = routeQuery.documento || '-';
    this.acaoRecebimento = String(routeQuery.acao || '').toLowerCase() === 'recebimento';
    this.valorRecebimentoSugerido = Number(routeQuery.valor || 0) || 0;

    this.filters = {
      periodo: routeQuery.periodo || 'month',
      dataInicio: routeQuery.dataInicio || '',
      dataFim: routeQuery.dataFim || '',
      tipo: '',
      documento: '',
      operador: '',
      status: '',
      valorMin: '',
      valorMax: '',
      search: ''
    };

    this.payload = {};
    this.view = {};
    this.extratoFiltrado = [];
    this.pagination = { page: 1, pageSize: 25, total: 0 };
    this.lastUpdated = null;
    this.refreshTimer = null;
    this.activeDrawer = null;
    this.searchTimeout = null;
    this.analiseAberta = false;
    this.root = null;
  }

  static create(params = {}, query = {}) {
    return new ContaCorrentePage(params, query).render();
  }

  render() {
    ensureContaCorrenteStyles();
    this.root = Workspace.create({
      variant: 'station',
      className: 'cds-conta-corrente-workspace',
      header: this._buildHeader(),
      body: this._buildBody(),
      footer: this._buildFooter()
    });
    this.root.id = 'extrato-root';
    this.root.dataset.uxSprint = 'UX-20';
    this.root.dataset.sharedUiReference = 'conta-corrente';

    setTimeout(() => {
      this._loadData();
      this._startAutoRefresh();
    }, 0);

    return this.root;
  }

  _buildHeader() {
    const refreshBtn = Button.create({
      text: 'Atualizar',
      variant: 'ghost',
      onClick: () => this._loadData()
    });

    return Workspace.Header.create({
      title: 'Conta Corrente',
      subtitle: 'Extrato operacional do cliente',
      context: this._headerContextNode(),
      status: this._headerStatusNode(),
      secondaryActions: [refreshBtn],
      onBack: () => this._voltar()
    });
  }

  _headerContextNode() {
    const wrap = document.createElement('div');
    wrap.className = 'cds-conta-corrente__context';
    wrap.innerHTML = `
      <span>Cliente: <strong id="extrato-cliente">${this._escape(this.clienteNome)}</strong></span>
      <span>Documento: <strong id="extrato-documento">${this._escape(this.documentoLabel)}</strong></span>
      <span>Período: <strong id="extrato-periodo">${this._escape(this._periodLabel())}</strong></span>
      <span>Saldo atual: <strong id="extrato-saldo">${this._fmt(null)}</strong></span>
      <span id="extrato-updated" class="cds-caption"></span>
    `;
    return wrap;
  }

  _headerStatusNode() {
    const el = document.createElement('span');
    el.id = 'extrato-status';
    el.className = 'cds-conta-corrente__status';
    el.textContent = this.acaoRecebimento ? 'Recebimento pendente' : '';
    return el;
  }

  _buildBody() {
    const wrap = document.createElement('div');
    wrap.className = 'cds-conta-corrente__body';
    wrap.id = 'extrato-body';

    if (this.acaoRecebimento) {
      wrap.appendChild(this._createRecebimentoBanner());
    }

    wrap.appendChild(this._createCompactToolbar());
    wrap.appendChild(this._sectionHost('extrato-tabela', 'Carregando extrato...'));

    const analise = document.createElement('details');
    analise.className = 'cds-conta-corrente__analise';
    analise.id = 'extrato-analise';
    const summary = document.createElement('summary');
    summary.textContent = 'Análise (KPIs, gráficos e indicadores)';
    analise.appendChild(summary);

    const analiseBody = document.createElement('div');
    analiseBody.className = 'cds-conta-corrente__analise-body';
    analiseBody.appendChild(this._sectionHost('extrato-resumo', 'Carregando resumo...'));
    analiseBody.appendChild(this._sectionHost('extrato-timeline', 'Carregando timeline...'));
    analiseBody.appendChild(this._sectionHost('extrato-indicadores', 'Carregando indicadores...'));
    analiseBody.appendChild(this._sectionHost('extrato-graficos', 'Carregando gráficos...'));
    analiseBody.appendChild(this._sectionHost('extrato-alertas', 'Carregando alertas...'));
    analiseBody.appendChild(this._sectionHost('extrato-pendencias', 'Carregando pendências...'));
    analise.appendChild(analiseBody);

    analise.addEventListener('toggle', () => {
      this.analiseAberta = analise.open;
      if (analise.open) this._renderAnaliseSections();
    });

    wrap.appendChild(analise);

    return Workspace.Body.create({ children: wrap, scroll: true });
  }

  _buildFooter() {
    const voltar = Button.create({
      text: getBackButtonLabel(this.navigationContext, 'Voltar'),
      variant: 'ghost',
      onClick: () => this._voltar()
    });

    const receber = Button.create({
      text: 'Receber',
      variant: 'primary',
      onClick: () => this._abrirRecebimento()
    });
    receber.id = 'extrato-btn-receber';

    const exportar = Button.create({
      text: 'Exportar',
      variant: 'secondary',
      onClick: () => this._exportMenu()
    });

    const count = document.createElement('span');
    count.id = 'extrato-count';
    count.className = 'cds-conta-corrente__count';
    count.textContent = '0 lançamentos';

    return Workspace.Footer.create({
      left: [voltar, count],
      right: [exportar, receber]
    });
  }

  _createCompactToolbar() {
    const bar = document.createElement('div');
    bar.className = 'cds-conta-corrente__toolbar';

    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'cds-extrato-filters__input cds-extrato-filters__input--wide';
    search.placeholder = 'Pesquisar no extrato (documento, descrição, tipo…)';
    search.addEventListener('input', (e) => {
      clearTimeout(this.searchTimeout);
      this.searchTimeout = setTimeout(() => {
        this.filters.search = e.target.value;
        this._applyFilters();
      }, 300);
    });

    const periodo = this._filterSelect('periodo', 'Período', [
      { value: 'today', label: 'Hoje' },
      { value: 'week', label: 'Esta Semana' },
      { value: 'month', label: 'Este Mês' },
      { value: 'quarter', label: 'Trimestre' },
      { value: 'year', label: 'Ano' }
    ]);

    const tipo = this._filterSelect('tipo', 'Tipo', [
      { value: '', label: 'Todos' },
      ...Object.keys(TIPO_LABELS).map((k) => ({ value: k, label: TIPO_LABELS[k] }))
    ]);

    bar.appendChild(search);
    bar.appendChild(periodo);
    bar.appendChild(tipo);
    return bar;
  }

  _createRecebimentoBanner() {
    const banner = document.createElement('div');
    banner.className = 'cds-extrato-recebimento-banner';
    const valorTxt = this.valorRecebimentoSugerido > 0
      ? this._formatCurrency(this.valorRecebimentoSugerido)
      : 'saldo em aberto';
    banner.innerHTML = `
      <div>
        <strong>Registrar recebimento</strong>
        <span>Cliente já selecionado. Valor sugerido: <strong>${valorTxt}</strong></span>
      </div>
    `;
    banner.appendChild(Button.create({
      text: 'Receber agora',
      variant: 'primary',
      onClick: () => this._abrirRecebimento()
    }));
    return banner;
  }

  _sectionHost(id, message) {
    const section = document.createElement('section');
    section.className = 'cds-extrato-section';
    section.id = id;
    section.appendChild(Loading.create({ message }));
    return section;
  }

  _filterSelect(name, label, options) {
    const field = document.createElement('div');
    field.className = 'cds-extrato-filters__field';
    field.innerHTML = `<label>${label}</label>`;
    const select = document.createElement('select');
    select.className = 'cds-extrato-filters__input';
    select.dataset.filter = name;
    options.forEach((opt) => {
      const o = document.createElement('option');
      o.value = opt.value;
      o.textContent = opt.label;
      o.selected = this.filters[name] === opt.value;
      select.appendChild(o);
    });
    select.addEventListener('change', (e) => {
      this.filters[name] = e.target.value;
      if (name === 'periodo') this._loadData();
      else this._applyFilters();
    });
    field.appendChild(select);
    return field;
  }

  _voltar() {
    navigate(resolveBackPath(this.navigationContext, this.clienteId ? `/clientes/${this.clienteId}` : '/'));
  }

  _abrirRecebimento() {
    try {
      sessionStorage.setItem('cds-financeiro-recebimento-ctx', JSON.stringify({
        clienteId: this.clienteId,
        clienteNome: this.clienteNome,
        valor: this.valorRecebimentoSugerido || Number(this.view?.resumo?.saldoAtual || 0) || 0,
        consignacaoId: this.consignacaoId,
        origem: 'conta-corrente-ux11'
      }));
    } catch (_error) {
      /* ignore */
    }
    if (typeof window !== 'undefined' && typeof window.loadPage === 'function') {
      window.loadPage('financeiro');
      notify(`Cliente ${this.clienteNome || this.clienteId} pré-selecionado no Financeiro.`, 'info');
      return;
    }
    notify('Abra o módulo Financeiro › Receber para registrar o recebimento.', 'info');
  }

  async _exportMenu() {
    const escolha = await choiceDialog({
      title: 'Exportar extrato',
      message: 'Escolha o formato:',
      choices: [
        { label: 'PDF', value: 'pdf', variant: 'primary' },
        { label: 'Excel', value: 'excel', variant: 'secondary' },
        { label: 'Planilha CSV', value: 'csv', variant: 'secondary' },
        { label: 'Imprimir', value: 'print', variant: 'ghost' }
      ]
    });
    if (escolha === 'pdf') this._exportPdf();
    else if (escolha === 'excel') this._exportExcel();
    else if (escolha === 'csv') this._exportCsv();
    else if (escolha === 'print') window.print();
  }

  _getApiParams() {
    return {
      consignacaoId: this.consignacaoId || undefined,
      clienteId: this.clienteId || undefined,
      dataInicio: this._periodDate('start'),
      dataFim: this._periodDate('end'),
      limite: 500,
      offset: 0
    };
  }

  _periodDate(edge) {
    const now = new Date();
    const start = new Date(now);
    if (this.filters.periodo === 'today') {
      if (edge === 'start') start.setHours(0, 0, 0, 0);
    } else if (this.filters.periodo === 'week') start.setDate(now.getDate() - 7);
    else if (this.filters.periodo === 'month') start.setMonth(now.getMonth() - 1);
    else if (this.filters.periodo === 'quarter') start.setMonth(now.getMonth() - 3);
    else if (this.filters.periodo === 'year') start.setFullYear(now.getFullYear() - 1);
    return edge === 'start' ? start.toISOString() : now.toISOString();
  }

  _periodLabel() {
    const map = { today: 'Hoje', week: 'Esta Semana', month: 'Este Mês', quarter: 'Trimestre', year: 'Ano' };
    return map[this.filters.periodo] || this.filters.periodo;
  }

  async _loadData(silent = false) {
    if (!this.consignacaoId && !this.clienteId) {
      this._renderSelectorState();
      return;
    }

    const params = this._getApiParams();

    try {
      const contaCorrenteParams = {
        consignacaoId: params.consignacaoId,
        clienteId: params.clienteId,
        dataInicio: params.dataInicio,
        dataFim: params.dataFim
      };

      const requests = [
        this.projectionApi.listarMovimentacoes(params),
        this.projectionApi.obterProjecaoSaldos(params),
        this.projectionApi.obterProjecaoIndicadores(params),
        this.projectionApi.obterProjecaoDashboard({ clienteId: this.clienteId }),
        this.projectionApi.obterProjecaoInsights({ clienteId: this.clienteId, ...params }),
        this.projectionApi.listarTimeline({ ...params, limite: 15 }),
        this.projectionApi.obterProjecaoContaCorrente(contaCorrenteParams)
      ];

      if (this.consignacaoId) {
        requests.push(this.api.obterConsignacao(this.consignacaoId).catch(() => ({})));
      }
      if (this.clienteId) {
        requests.push(this.projectionApi.obterSituacaoCliente({ clienteId: this.clienteId }));
      }

      const results = await Promise.all(requests);
      const historico = results[0];
      const saldos = results[1];
      const indicadores = results[2];
      const dashboard = results[3];
      const insights = results[4];
      const timeline = results[5];
      const contaCorrente = results[6] || {};
      let consignacao = {};
      let situacao = {};
      let cursor = 7;

      if (this.consignacaoId) {
        consignacao = results[cursor] || {};
        cursor += 1;
      }
      if (this.clienteId) {
        situacao = results[cursor] || {};
      }

      if (consignacao.clienteId) this.clienteId = consignacao.clienteId;
      if (consignacao.cliente) this.clienteNome = consignacao.cliente;
      const doc = consignacao.documento || consignacao.documentoNumero || situacao.documento;
      if (doc) {
        this.documentoLabel = typeof doc === 'object'
          ? (doc.numero || doc.codigo || JSON.stringify(doc))
          : String(doc);
      }

      this.payload = { historico, saldos, indicadores, dashboard, insights, timeline, contaCorrente, situacao, consignacao };
      const saldosData = saldos?.saldos || saldos || {};
      this.view = {
        resumo: buildResumoFinanceiro(contaCorrente, saldosData, situacao),
        extrato: buildExtrato(contaCorrente, historico),
        indicadores: buildIndicadores(indicadores, contaCorrente, saldosData),
        graficos: buildGraficos(indicadores, contaCorrente),
        alertas: buildAlertas(dashboard, insights, situacao),
        pendencias: buildPendencias(dashboard, buildExtrato(contaCorrente, historico))
      };

      this.lastUpdated = new Date();
      this._applyFilters();
      this._updateHeaderMeta();
      if (this.analiseAberta) this._renderAnaliseSections();
    } catch (error) {
      if (!silent) {
        const host = document.getElementById('extrato-tabela');
        if (host) {
          host.innerHTML = '';
          host.appendChild(Alert.create({ message: error.message, variant: 'error', dismissible: true }));
        }
      }
    }
  }

  _applyFilters() {
    this.extratoFiltrado = applyExtratoFilters(this.view.extrato || [], this.filters);
    this.pagination.total = this.extratoFiltrado.length;
    this.pagination.page = 1;
    this._renderExtratoTable();
    this._updateFooter();
  }

  _renderAnaliseSections() {
    this._renderResumo();
    this._renderTimeline();
    this._renderIndicadores();
    this._renderGraficos();
    this._renderAlertas();
    this._renderPendencias();
  }

  _renderResumo() {
    const host = document.getElementById('extrato-resumo');
    if (!host) return;
    host.innerHTML = '';
    const title = document.createElement('h2');
    title.className = 'cds-extrato-section__title';
    title.textContent = 'Resumo Financeiro';
    host.appendChild(title);

    const r = this.view.resumo || {};
    const grid = document.createElement('div');
    grid.className = 'cds-extrato-resumo';
    [
      { title: 'Saldo Inicial', value: this._fmt(r.saldoInicial), color: 'primary' },
      { title: 'Entradas', value: this._fmt(r.entradas), color: 'success' },
      { title: 'Saídas', value: this._fmt(r.saidas), color: 'warning' },
      { title: 'Recebimentos', value: this._fmt(r.recebimentos), color: 'success' },
      { title: 'Perdas', value: this._fmt(r.perdas), color: 'error' },
      { title: 'Cortesias', value: this._fmt(r.cortesias), color: 'warning' },
      { title: 'Devoluções', value: this._fmt(r.devolucoes), color: 'primary' },
      { title: 'Saldo Atual', value: this._fmt(r.saldoAtual), color: 'primary' },
      { title: 'Limite Comercial', value: this._fmt(r.limiteComercial), color: 'primary' },
      { title: 'Limite Utilizado', value: this._fmt(r.limiteUtilizado), color: 'warning' },
      { title: 'Limite Disponível', value: this._fmt(r.limiteDisponivel), color: 'success' }
    ].forEach((c) => grid.appendChild(StatCard.create(c)));
    host.appendChild(grid);
  }

  _renderExtratoTable() {
    const host = document.getElementById('extrato-tabela');
    if (!host) return;
    host.innerHTML = '';

    const title = document.createElement('h2');
    title.className = 'cds-extrato-section__title';
    title.textContent = 'Extrato';
    host.appendChild(title);

    if (!this.extratoFiltrado.length) {
      host.appendChild(EmptyState.create({
        title: 'Sem lançamentos',
        description: 'Nenhuma movimentação no período'
      }));
      return;
    }

    const start = (this.pagination.page - 1) * this.pagination.pageSize;
    const pageItems = this.extratoFiltrado.slice(start, start + this.pagination.pageSize);

    const table = Table.create({
      columns: [
        { key: 'data', label: 'Data' },
        { key: 'tipo', label: 'Tipo' },
        { key: 'descricao', label: 'Descrição' },
        { key: 'valor', label: 'Valor' },
        { key: 'saldo', label: 'Saldo' }
      ],
      data: pageItems.map((row) => {
        const valorNum = row.entrada != null ? Number(row.entrada) : (row.saida != null ? -Number(row.saida) : Number(row.valor || 0));
        return {
          data: this._formatDateTime(row.data),
          tipo: Badge.create({ text: row.tipoLabel || row.tipo || '-', variant: this._tipoVariant(row.tipo) }),
          descricao: row.descricao || row.documento || '-',
          valor: this._formatCurrency(valorNum),
          saldo: row.saldoProjetado != null ? this._formatCurrency(row.saldoProjetado) : '-',
          _raw: row
        };
      }),
      onRowClick: (row) => this._openMovimentoDrawer(row._raw || row)
    });

    host.appendChild(table);

    const totalPages = Math.max(1, Math.ceil(this.pagination.total / this.pagination.pageSize));
    host.appendChild(Pagination.create({
      currentPage: this.pagination.page,
      totalPages,
      totalItems: this.pagination.total,
      pageSize: this.pagination.pageSize,
      onPageChange: (page) => {
        this.pagination.page = page;
        this._renderExtratoTable();
      }
    }));
  }

  _renderTimeline() {
    const host = document.getElementById('extrato-timeline');
    if (!host) return;
    host.innerHTML = '';
    const title = document.createElement('h2');
    title.className = 'cds-extrato-section__title';
    title.textContent = 'Linha do Tempo Financeira';
    host.appendChild(title);
    host.appendChild(Timeline.create({
      events: this.payload.timeline || [],
      emptyTitle: 'Sem eventos',
      emptyDescription: 'Nenhum evento financeiro'
    }));
  }

  _renderIndicadores() {
    const host = document.getElementById('extrato-indicadores');
    if (!host) return;
    host.innerHTML = '';
    const title = document.createElement('h2');
    title.className = 'cds-extrato-section__title';
    title.textContent = 'Indicadores';
    host.appendChild(title);
    const grid = document.createElement('div');
    grid.className = 'cds-extrato-indicadores';
    (this.view.indicadores || []).forEach((ind) => {
      const cell = document.createElement('div');
      cell.className = 'cds-extrato-indicator';
      cell.innerHTML = `<label>${ind.label}</label><div>${this._formatIndicator(ind)}</div>`;
      grid.appendChild(cell);
    });
    host.appendChild(grid);
  }

  _renderGraficos() {
    const host = document.getElementById('extrato-graficos');
    if (!host) return;
    host.innerHTML = '';
    const title = document.createElement('h2');
    title.className = 'cds-extrato-section__title';
    title.textContent = 'Gráficos';
    host.appendChild(title);
    const grid = document.createElement('div');
    grid.className = 'cds-extrato-graficos';
    [
      { key: 'entradasSaidas', title: 'Entradas x Saídas' },
      { key: 'saldoPorPeriodo', title: 'Saldo por Período' },
      { key: 'recebimentos', title: 'Recebimentos' },
      { key: 'perdas', title: 'Perdas' },
      { key: 'cortesias', title: 'Cortesias' },
      { key: 'evolucaoDiaria', title: 'Evolução Diária' }
    ].forEach((def) => {
      const series = (this.view.graficos || {})[def.key] || [];
      grid.appendChild(GraphContainer.create({
        title: def.title,
        content: series.length
          ? this._renderChart(series)
          : EmptyState.create({ title: 'Sem dados', description: `Projeção "${def.title}" indisponível` })
      }));
    });
    host.appendChild(grid);
  }

  _renderChart(series) {
    const container = document.createElement('div');
    container.className = 'cds-extrato-chart';
    series.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'cds-extrato-chart__row';
      row.innerHTML = `
        <span>${item.periodo || item.label || item.data || '-'}</span>
        <span>${item.percentual != null ? `${item.percentual}%` : this._formatCurrency(item.valor)}</span>
      `;
      container.appendChild(row);
    });
    return container;
  }

  _renderAlertas() {
    const host = document.getElementById('extrato-alertas');
    if (!host) return;
    host.innerHTML = '';
    const title = document.createElement('h2');
    title.className = 'cds-extrato-section__title';
    title.textContent = 'Alertas';
    host.appendChild(title);
    if (!(this.view.alertas || []).length) {
      host.appendChild(EmptyState.create(emptyState('CONTA_CORRENTE_ALERTAS')));
      return;
    }
    (this.view.alertas || []).forEach((a) => {
      host.appendChild(Alert.create({
        message: `${a.tipo}: ${a.mensagem}`,
        variant: a.severidade === 'CRITICAL' ? 'error' : 'warning',
        dismissible: false
      }));
    });
  }

  _renderPendencias() {
    const host = document.getElementById('extrato-pendencias');
    if (!host) return;
    host.innerHTML = '';
    const title = document.createElement('h2');
    title.className = 'cds-extrato-section__title';
    title.textContent = 'Pendências';
    host.appendChild(title);
    const items = this.view.pendencias || [];
    if (!items.length) {
      host.appendChild(EmptyState.create(emptyState('CONTA_CORRENTE_PENDENCIAS')));
      return;
    }
    host.appendChild(Table.create({
      columns: [
        { key: 'tipo', label: 'Tipo' },
        { key: 'mensagem', label: 'Descrição' },
        { key: 'severidade', label: 'Severidade' }
      ],
      data: items.map((p) => ({
        tipo: p.tipo || p.status || '-',
        mensagem: p.mensagem || p.descricao || '-',
        severidade: p.severidade || '-'
      }))
    }));
  }

  _renderSelectorState() {
    const host = document.getElementById('extrato-tabela');
    if (host) {
      host.innerHTML = '';
      host.appendChild(EmptyState.create({
        title: 'Selecione um cliente ou consignação',
        description: 'Acesse pela Central do Cliente ou pela Central de Trabalho'
      }));
    }
    this._updateHeaderMeta();
  }

  async _openMovimentoDrawer(movimento) {
    if (this.activeDrawer) {
      this.activeDrawer.remove();
      this.activeDrawer = null;
    }
    const content = document.createElement('div');
    const panel = new MovimentoDrawer(this, movimento);
    await panel.mount(content);
    const drawer = Drawer.create({
      title: `Movimentação — ${movimento.tipoLabel || movimento.tipo || ''}`,
      content,
      size: 'lg',
      open: true,
      onClose: () => { this.activeDrawer = null; }
    });
    this.activeDrawer = drawer;
    document.body.appendChild(drawer);
  }

  _startAutoRefresh() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = setInterval(() => {
      if (!document.getElementById('extrato-root')) {
        clearInterval(this.refreshTimer);
        return;
      }
      this._loadData(true);
    }, REFRESH_INTERVAL_MS);
  }

  _updateHeaderMeta() {
    const updated = document.getElementById('extrato-updated');
    const cliente = document.getElementById('extrato-cliente');
    const periodo = document.getElementById('extrato-periodo');
    const documento = document.getElementById('extrato-documento');
    const saldo = document.getElementById('extrato-saldo');
    const status = document.getElementById('extrato-status');
    const saldoAtual = this.view?.resumo?.saldoAtual;

    if (updated && this.lastUpdated) {
      updated.textContent = `Atualizado: ${this.lastUpdated.toLocaleTimeString('pt-BR')}`;
    }
    if (cliente) cliente.textContent = this.clienteNome;
    if (periodo) periodo.textContent = this._periodLabel();
    if (documento) documento.textContent = this.documentoLabel || '-';
    if (saldo) saldo.textContent = this._fmt(saldoAtual);
    if (status) {
      const valor = Number(saldoAtual || 0);
      status.textContent = this.acaoRecebimento
        ? 'Recebimento pendente'
        : (valor > 0 ? 'Saldo em aberto' : (valor < 0 ? 'Crédito' : 'Quitado'));
    }
  }

  _updateFooter() {
    const footer = document.getElementById('extrato-count');
    if (footer) footer.textContent = `${this.pagination.total} lançamentos`;
  }

  _tipoVariant(tipo) {
    if (['PERDA', 'CANCELAMENTO'].includes(tipo)) return 'error';
    if (['PAGAMENTO', 'VENDA_PRESTACAO', 'VENDA'].includes(tipo)) return 'success';
    if (['CORTESIA', 'ABERTURA_PRESTACAO'].includes(tipo)) return 'warning';
    return 'info';
  }

  _fmt(value) {
    return value == null ? '-' : this._formatCurrency(value);
  }

  _formatIndicator(ind) {
    if (ind.value == null) return '-';
    if (ind.format === 'currency') return this._formatCurrency(ind.value);
    if (ind.format === 'days') return `${ind.value} dias`;
    return String(ind.value);
  }

  _formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);
  }

  _formatDateTime(date) {
    if (!date) return '-';
    return new Date(date).toLocaleString('pt-BR');
  }

  _escape(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  _exportCsv() {
    const rows = this.extratoFiltrado.map((r) => [
      r.data, r.documento, r.tipoLabel, r.descricao, r.entrada, r.saida, r.saldoProjetado, r.operador, r.correlationId
    ]);
    const csv = ['Data,Documento,Tipo,Descrição,Entrada,Saída,Saldo,Operador,CorrelationId',
      ...rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
    this._download(csv, 'extrato-conta-corrente.csv', 'text/csv;charset=utf-8;');
    notifySuccess('PLANILHA_EXPORTADA');
  }

  _exportExcel() {
    const headers = ['Data', 'Documento', 'Tipo', 'Descrição', 'Entrada', 'Saída', 'Saldo'];
    const rows = this.extratoFiltrado.map((r) => [
      r.data, r.documento, r.tipoLabel, r.descricao, r.entrada, r.saida, r.saldoProjetado
    ]);
    exportToXlsx(headers, rows, 'extrato-conta-corrente.xlsx');
    notifySuccess('EXCEL_EXPORTADO');
  }

  _exportPdf() {
    const headers = ['Data', 'Documento', 'Tipo', 'Descrição', 'Entrada', 'Saída', 'Saldo'];
    const rows = this.extratoFiltrado.map((r) => [
      r.data, r.documento, r.tipoLabel, r.descricao, r.entrada, r.saida, r.saldoProjetado
    ]);
    const result = exportToPdf({
      title: 'Extrato Conta Corrente Comercial',
      headers,
      rows,
      filename: 'extrato-conta-corrente.pdf'
    });
    if (result.ok) notifySuccess('PDF_EXPORTADO');
    else notifyError('PDF_EXPORTAR', result);
  }

  _download(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }
}

module.exports = ContaCorrentePage;
