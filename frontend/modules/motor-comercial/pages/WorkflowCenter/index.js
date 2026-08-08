/**
 * Central de Workflow Operacional — Sprint O-11.
 *
 * @module frontend/modules/motor-comercial/pages/WorkflowCenter
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
const KanbanColumn = require('../../components/special/KanbanColumn');
const KanbanCard = require('../../components/special/KanbanCard');
const Timeline = require('../../components/special/Timeline');
const ProjectionApi = require('../../api/ProjectionApi');
const WorkflowDrawer = require('./WorkflowDrawer');
const {
  buildViewFromPayload,
  buildFilterParams,
  applyFilters,
  updateWorkflowStatus,
  assignResponsavel,
  colunaLabel,
  formatTempo,
  slaVariant,
  exportRows,
  downloadCsv,
  downloadExcelPlaceholder,
  loadHistory
} = require('./workflowMappers');
const { notify, navigate, confirmDialog, promptDialog } = require('../../utils/operacional');
const {
  ConfirmMessages,
  emptyState,
  notifySuccess,
  notifyWarning,
  notifyInfo
} = require('../../messages');

const REFRESH_INTERVAL_MS = 60000;

class WorkflowCenterPage {
  constructor(routeParams = {}, routeQuery = {}) {
    this.routeParams = routeParams;
    this.routeQuery = routeQuery;
    this.projectionApi = new ProjectionApi();
    this.view = {};
    this.filteredView = {};
    this.activeWorkflow = null;
    this.activeDrawer = null;
    this.refreshTimer = null;
    this.searchTimeout = null;

    this.filters = {
      empresa: routeQuery.empresa || '',
      filial: routeQuery.filial || '',
      operador: routeQuery.operador || '',
      clienteId: routeQuery.clienteId || '',
      categoria: routeQuery.categoria || '',
      prioridade: routeQuery.prioridade || '',
      status: routeQuery.status || '',
      sla: routeQuery.sla || '',
      search: routeQuery.q || '',
      periodo: routeQuery.periodo || 'week'
    };
  }

  static create(params = {}, query = {}) {
    return new WorkflowCenterPage(params, query).render();
  }

  render() {
    const layout = DashboardLayout.create({
      header: this._header(),
      sidebar: this._sidebar(),
      content: this._content(),
      footer: this._footer()
    });
    setTimeout(() => { this._loadData(); this._startAutoRefresh(); }, 0);
    return layout;
  }

  _header() {
    const el = document.createElement('header');
    el.className = 'cds-workflow-header cds-page-header';
    el.innerHTML = `
      <div>
        <p class="cds-eyebrow">Motor Comercial</p>
        <h1 class="cds-title">Central de Processos</h1>
        <p class="cds-description">Acompanhamento operacional — filas, prazos e distribuição.</p>
        <p id="workflow-updated" class="cds-caption"></p>
      </div>
    `;
    const actions = document.createElement('div');
    actions.className = 'cds-workflow-header__actions';
    actions.appendChild(Button.create({ text: 'Atualizar', variant: 'secondary', onClick: () => this._loadData() }));
    actions.appendChild(Button.create({ text: 'Planilha', variant: 'ghost', onClick: () => this._export('csv') }));
    actions.appendChild(Button.create({ text: 'Excel', variant: 'ghost', onClick: () => this._export('excel') }));
    actions.appendChild(Button.create({ text: 'PDF', variant: 'ghost', onClick: () => this._export('pdf') }));
    el.appendChild(actions);
    return el;
  }

  _sidebar() {
    const nav = document.createElement('nav');
    nav.className = 'cds-workflow-sidebar';
    [
      { l: 'Painel', p: '/' },
      { l: 'Processos', p: '/workflow', active: true },
      { l: 'Pendências', p: '/pendencias' },
      { l: 'Recomendações', p: '/recomendacoes' },
      { l: 'Guias Operacionais', p: '/playbooks' },
      { l: 'Clientes', p: '/clientes' }
    ].forEach((i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `cds-workflow-sidebar__item${i.active ? ' cds-workflow-sidebar__item--active' : ''}`;
      b.textContent = i.l;
      b.addEventListener('click', () => navigate(i.p));
      nav.appendChild(b);
    });
    return nav;
  }

  _footer() {
    const f = document.createElement('div');
    f.className = 'cds-workflow-footer';
    f.textContent = 'Central de Processos — Motor Comercial CDS';
    return f;
  }

  _content() {
    const w = document.createElement('div');
    w.className = 'cds-workflow-content';
    w.id = 'workflow-root';
    w.appendChild(this._executiveFilters());
    w.appendChild(this._host('wf-resumo', 'Resumo...'));
    w.appendChild(this._host('wf-fila', 'Fila operacional...'));
    w.appendChild(this._host('wf-ativos', 'Processos ativos...'));
    w.appendChild(this._host('wf-kanban', 'Kanban...'));
    w.appendChild(this._host('wf-sla', 'SLA...'));
    w.appendChild(this._host('wf-distribuicao', 'Distribuição...'));
    w.appendChild(this._host('wf-timeline', 'Linha do tempo...'));
    w.appendChild(this._host('wf-historico', 'Histórico...'));
    return w;
  }

  _host(id, msg) {
    const s = document.createElement('section');
    s.id = id;
    s.className = 'cds-workflow-section';
    if (msg) s.appendChild(Loading.create({ message: msg }));
    return s;
  }

  _executiveFilters() {
    const c = document.createElement('div');
    c.className = 'cds-workflow-filters';

    const row1 = document.createElement('div');
    row1.className = 'cds-workflow-filters__row';

    const empresa = document.createElement('select');
    empresa.innerHTML = '<option value="">Empresa — Todas</option><option value="cremolicia">Cremolicia</option>';
    empresa.value = this.filters.empresa;
    empresa.addEventListener('change', (e) => { this.filters.empresa = e.target.value; });

    const filial = document.createElement('select');
    filial.innerHTML = '<option value="">Filial — Todas</option><option value="matriz">Matriz</option><option value="filial1">Filial 1</option>';
    filial.value = this.filters.filial;
    filial.addEventListener('change', (e) => { this.filters.filial = e.target.value; });

    const operador = document.createElement('input');
    operador.placeholder = 'Operador';
    operador.value = this.filters.operador;
    operador.addEventListener('input', (e) => {
      clearTimeout(this.searchTimeout);
      this.searchTimeout = setTimeout(() => {
        this.filters.operador = e.target.value;
        this._applyAndRender();
      }, 300);
    });

    const periodo = document.createElement('select');
    [['week', 'Esta semana'], ['today', 'Hoje'], ['month', 'Este mês']].forEach(([v, l]) => {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = l;
      o.selected = this.filters.periodo === v;
      periodo.appendChild(o);
    });
    periodo.addEventListener('change', (e) => {
      this.filters.periodo = e.target.value;
      this._loadData();
    });

    row1.appendChild(empresa);
    row1.appendChild(filial);
    row1.appendChild(operador);
    row1.appendChild(periodo);
    c.appendChild(row1);

    const row2 = document.createElement('div');
    row2.className = 'cds-workflow-filters__row';

    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'Pesquisar processo, cliente, documento...';
    search.value = this.filters.search;
    search.addEventListener('input', (e) => {
      clearTimeout(this.searchTimeout);
      this.searchTimeout = setTimeout(() => {
        this.filters.search = e.target.value;
        this._applyAndRender();
      }, 300);
    });

    const status = document.createElement('select');
    status.innerHTML = '<option value="">Status — Todos</option>';
    ['novo', 'emAndamento', 'aguardando', 'bloqueado', 'concluido'].forEach((s) => {
      const o = document.createElement('option');
      o.value = s;
      o.textContent = colunaLabel(s);
      o.selected = this.filters.status === s;
      status.appendChild(o);
    });
    status.addEventListener('change', (e) => { this.filters.status = e.target.value; this._applyAndRender(); });

    const sla = document.createElement('select');
    sla.innerHTML = '<option value="">SLA — Todos</option><option value="DENTRO">Dentro do prazo</option><option value="PROXIMO">Próximo vencimento</option><option value="VENCIDO">Vencido</option>';
    sla.value = this.filters.sla;
    sla.addEventListener('change', (e) => { this.filters.sla = e.target.value; this._applyAndRender(); });

    const prioridade = document.createElement('select');
    prioridade.innerHTML = '<option value="">Prioridade</option><option value="URGENT">Urgente</option><option value="HIGH">Alta</option><option value="NORMAL">Normal</option><option value="LOW">Baixa</option>';
    prioridade.value = this.filters.prioridade;
    prioridade.addEventListener('change', (e) => { this.filters.prioridade = e.target.value; this._applyAndRender(); });

    row2.appendChild(search);
    row2.appendChild(status);
    row2.appendChild(sla);
    row2.appendChild(prioridade);
    c.appendChild(row2);
    return c;
  }

  async _loadData(silent = false) {
    try {
      const params = buildFilterParams({ clienteId: this.filters.clienteId || undefined });
      const payload = await this.projectionApi.obterProjecaoWorkflow(params);
      this.view = buildViewFromPayload(payload);
      this._applyAndRender();
      const el = document.getElementById('workflow-updated');
      if (el) el.textContent = `Atualizado: ${new Date().toLocaleTimeString('pt-BR')}`;
    } catch (error) {
      if (!silent) {
        const s = document.getElementById('wf-resumo');
        if (s) {
          s.innerHTML = '';
          s.appendChild(Alert.create({ message: error.message, variant: 'error' }));
        }
      }
    }
  }

  _applyAndRender() {
    this.filteredView = applyFilters(this.view, this.filters);
    this._renderAll();
  }

  _renderAll() {
    this._renderResumo();
    this._renderFila();
    this._renderAtivos();
    this._renderKanban();
    this._renderSla();
    this._renderDistribuicao();
    this._renderTimeline();
    this._renderHistorico();
  }

  _renderResumo() {
    const s = document.getElementById('wf-resumo');
    if (!s) return;
    s.innerHTML = '<h2>Resumo Executivo</h2>';
    const r = this.filteredView.resumo || {};
    const g = document.createElement('div');
    g.className = 'cds-workflow-kpis';
    [
      { title: 'Processos ativos', value: r.workflowsAtivos, color: 'primary' },
      { title: 'Concluídos hoje', value: r.concluidosHoje, color: 'success' },
      { title: 'Bloqueados', value: r.bloqueados, color: 'warning' },
      { title: 'Em atraso', value: r.emAtraso, color: 'error' },
      { title: 'Tempo médio', value: formatTempo(r.tempoMedioMinutos), format: 'text' },
      { title: 'SLA cumprido', value: r.slaCumprido, format: 'percent' },
      { title: 'SLA vencido', value: r.slaVencido, color: 'error' },
      { title: 'Eficiência', value: r.eficiencia, format: 'percent', color: 'info' }
    ].forEach((c) => g.appendChild(StatCard.create(c)));
    s.appendChild(g);
  }

  _renderFila() {
    const s = document.getElementById('wf-fila');
    if (!s) return;
    s.innerHTML = '<h2>Fila Operacional</h2>';
    const list = this.filteredView.fila || [];
    if (!list.length) {
      s.appendChild(EmptyState.create(emptyState('WORKFLOW_FILA')));
      return;
    }
    s.appendChild(Table.create({
      columns: [
        { key: 'cliente', label: 'Cliente' },
        { key: 'documento', label: 'Documento' },
        { key: 'workflow', label: 'Processo' },
        { key: 'responsavel', label: 'Responsável' },
        { key: 'prioridade', label: 'Prioridade' },
        { key: 'status', label: 'Status' },
        { key: 'prazo', label: 'Prazo' },
        { key: 'tempo', label: 'Tempo' }
      ],
      data: list.slice(0, 50).map((w) => ({
        cliente: w.cliente,
        documento: w.documento || '—',
        workflow: w.titulo,
        responsavel: w.responsavel,
        prioridade: w.prioridade,
        status: colunaLabel(w.coluna),
        prazo: w.sla?.prazo ? new Date(w.sla.prazo).toLocaleString('pt-BR') : '—',
        tempo: formatTempo(w.tempoDecorridoMinutos),
        _raw: w
      })),
      onRowClick: (row) => this._openDrawer(row._raw)
    }));
  }

  _renderAtivos() {
    const s = document.getElementById('wf-ativos');
    if (!s) return;
    s.innerHTML = '<h2>Processos Ativos</h2>';
    const ativos = (this.filteredView.workflows || []).filter((w) => w.coluna !== 'concluido');
    if (!ativos.length) {
      s.appendChild(EmptyState.create({ title: 'Nenhum ativo', description: '' }));
      return;
    }
    const g = document.createElement('div');
    g.className = 'cds-workflow-ativos';
    ativos.slice(0, 12).forEach((w) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'cds-workflow-ativo-card';
      card.innerHTML = `<strong>${w.titulo}</strong><span>${w.cliente}</span>`;
      card.addEventListener('click', () => this._openDrawer(w));
      g.appendChild(card);
    });
    s.appendChild(g);
  }

  _renderKanban() {
    const s = document.getElementById('wf-kanban');
    if (!s) return;
    s.innerHTML = '<h2>Kanban</h2>';
    const board = document.createElement('div');
    board.className = 'cds-workflow-kanban';

    const columns = [
      { key: 'novo', title: 'Novo', status: 'primary' },
      { key: 'emAndamento', title: 'Em andamento', status: 'warning' },
      { key: 'aguardando', title: 'Aguardando', status: 'neutral' },
      { key: 'bloqueado', title: 'Bloqueado', status: 'error' },
      { key: 'concluido', title: 'Concluído', status: 'success' }
    ];

    const kanban = this.filteredView.kanban || {};

    columns.forEach((col) => {
      const items = kanban[col.key] || [];
      const column = KanbanColumn.create({
        title: col.title,
        count: items.length,
        status: col.status
      });
      const content = column.querySelector('.cds-kanban-column__content');

      items.forEach((w) => {
        const tags = document.createElement('div');
        tags.appendChild(Badge.create({ text: w.prioridade, variant: slaVariant(w.sla?.indicador) }));
        if (w.playbook) tags.appendChild(Badge.create({ text: w.playbook, variant: 'info' }));

        const desc = [
          w.cliente,
          w.documento ? `Doc: ${w.documento}` : null,
          w.responsavel,
          `Tempo: ${formatTempo(w.tempoDecorridoMinutos)}`,
          w.sla?.status ? `SLA: ${w.sla.status}` : null
        ].filter(Boolean).join(' · ');

        const card = KanbanCard.create({
          title: w.titulo,
          description: desc,
          priority: w.prioridade === 'URGENT' || w.prioridade === 'HIGH' ? 'high' : w.prioridade === 'LOW' ? 'low' : 'medium',
          tags
        });
        card.addEventListener('click', () => this._openDrawer(w));
        content.appendChild(card);
      });

      board.appendChild(column);
    });

    s.appendChild(board);
  }

  _renderSla() {
    const s = document.getElementById('wf-sla');
    if (!s) return;
    s.innerHTML = '<h2>SLA</h2>';
    const sla = this.filteredView.sla || {};
    const g = document.createElement('div');
    g.className = 'cds-workflow-sla-kpis';
    [
      { title: 'Dentro do prazo', value: sla.dentroPrazo, color: 'success' },
      { title: 'Próximo vencimento', value: sla.proximoVencimento, color: 'warning' },
      { title: 'Vencido', value: sla.vencido, color: 'error' }
    ].forEach((c) => g.appendChild(StatCard.create(c)));
    s.appendChild(g);

    const list = document.createElement('div');
    list.className = 'cds-workflow-sla-list';
    (sla.itens || []).slice(0, 15).forEach((item) => {
      const row = document.createElement('div');
      row.className = 'cds-workflow-sla-row';
      row.appendChild(Badge.create({ text: item.indicador || 'verde', variant: slaVariant(item.indicador) }));
      const text = document.createElement('span');
      text.textContent = `${item.titulo} — ${item.status === 'VENCIDO' ? `Excedido ${formatTempo(item.excedidoMinutos)}` : `Restante ${formatTempo(item.restanteMinutos)}`}`;
      row.appendChild(text);
      list.appendChild(row);
    });
    s.appendChild(list);
  }

  _renderDistribuicao() {
    const s = document.getElementById('wf-distribuicao');
    if (!s) return;
    s.innerHTML = '<h2>Distribuição por Operador</h2>';
    const rows = this.filteredView.distribuicao || [];
    if (!rows.length) {
      s.appendChild(EmptyState.create({ title: 'Sem dados', description: '' }));
      return;
    }
    s.appendChild(Table.create({
      columns: [
        { key: 'operador', label: 'Operador' },
        { key: 'quantidade', label: 'Quantidade' },
        { key: 'tempo', label: 'Tempo médio' },
        { key: 'eficiencia', label: 'Eficiência' },
        { key: 'sla', label: 'SLA vencido' }
      ],
      data: rows.map((r) => ({
        operador: r.operador,
        quantidade: r.quantidade,
        tempo: formatTempo(r.tempoMedioMinutos),
        eficiencia: `${r.eficiencia ?? 0}%`,
        sla: r.slaVencido
      }))
    }));
  }

  _renderTimeline() {
    const s = document.getElementById('wf-timeline');
    if (!s) return;
    s.innerHTML = '<h2>Linha do Tempo Operacional</h2>';
    const events = (this.filteredView.timeline || []).map((e) => ({
      titulo: e.titulo,
      data: e.data,
      descricao: `${e.tipo || ''} · ${e.cliente || ''} · SLA ${e.sla || ''}`,
      tipo: e.prioridade
    }));
    s.appendChild(Timeline.create({ events, emptyTitle: 'Sem eventos', emptyDescription: '' }));
  }

  _renderHistorico() {
    const s = document.getElementById('wf-historico');
    if (!s) return;
    s.innerHTML = '<h2>Histórico Local</h2>';
    const hist = loadHistory().slice(0, 20);
    if (!hist.length) {
      s.appendChild(EmptyState.create(emptyState('WORKFLOW_HISTORICO')));
      return;
    }
    s.appendChild(Table.create({
      columns: [
        { key: 'acao', label: 'Ação' },
        { key: 'usuario', label: 'Usuário' },
        { key: 'quando', label: 'Quando' }
      ],
      data: hist.map((h) => ({
        acao: h.acao,
        usuario: h.usuario || h.responsavel || '—',
        quando: h.quando ? new Date(h.quando).toLocaleString('pt-BR') : '—'
      }))
    }));
  }

  _openDrawer(workflow) {
    this.activeWorkflow = workflow;
    const content = document.createElement('div');
    const drawer = WorkflowDrawer.create
      ? WorkflowDrawer.create(this, workflow)
      : new WorkflowDrawer(this, workflow);

    if (this.activeDrawer?.close) this.activeDrawer.close();

    this.activeDrawer = Drawer.create({
      title: workflow.titulo || 'Processo',
      content,
      size: 'lg',
      open: true,
      onClose: () => { this.activeDrawer = null; },
      footer: this._drawerFooter(workflow)
    });

    drawer.mount(content);
  }

  _drawerFooter(workflow) {
    const w = document.createElement('div');
    w.className = 'cds-workflow-drawer-footer';
    w.appendChild(Button.create({
      text: 'Atribuir a mim',
      variant: 'secondary',
      onClick: () => {
        assignResponsavel(workflow.id, null);
        notifySuccess('WORKFLOW_RESPONSAVEL');
        this._loadData(true);
      }
    }));
    w.appendChild(Button.create({
      text: 'Em andamento',
      variant: 'primary',
      onClick: () => {
        updateWorkflowStatus(workflow.id, 'emAndamento', 'EM_ANDAMENTO');
        notifySuccess('WORKFLOW_STATUS');
        this._loadData(true);
      }
    }));
    w.appendChild(Button.create({
      text: 'Concluir',
      variant: 'success',
      onClick: async () => {
        const ok = await confirmDialog(ConfirmMessages.CONCLUIR_WORKFLOW);
        if (!ok) return;
        updateWorkflowStatus(workflow.id, 'concluido', 'CONCLUIDO');
        notifySuccess('WORKFLOW_CONCLUIDO');
        this._loadData(true);
        if (this.activeDrawer?.close) this.activeDrawer.close();
      }
    }));
    return w;
  }

  _export(format) {
    const rows = exportRows(this.filteredView);
    if (!rows.length) {
      notifyWarning('NADA_PARA_EXPORTAR');
      return;
    }
    if (format === 'csv') downloadCsv(rows);
    else if (format === 'excel') downloadExcelPlaceholder(rows);
    else notifyInfo('EXPORT_PDF_EM_BREVE');
  }

  _startAutoRefresh() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = setInterval(() => this._loadData(true), REFRESH_INTERVAL_MS);
  }
}

module.exports = WorkflowCenterPage;
