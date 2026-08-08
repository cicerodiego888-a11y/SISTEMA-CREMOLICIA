/**
 * Central de Playbooks Operacionais — GPS Operacional
 *
 * Sprint O-10.
 *
 * @module frontend/modules/motor-comercial/pages/Playbooks
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
const PlaybooksDrawer = require('./PlaybooksDrawer');
const {
  buildViewFromPayload,
  buildFilterParams,
  applyFilters,
  startPlaybook,
  updateChecklistItem,
  saveInstance,
  loadHistory,
  toggleFavorite,
  categoriaLabel,
  statusChecklistVariant
} = require('./playbooksMappers');
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
  notifyWarning,
  notifyInfo
} = require('../../messages');

const REFRESH_INTERVAL_MS = 60000;

class PlaybooksPage {
  constructor(routeParams = {}, routeQuery = {}) {
    this.routeParams = routeParams;
    this.routeQuery = routeQuery;
    this.navigationContext = parseCliente360Context(routeQuery);
    this.projectionApi = new ProjectionApi();
    this.view = {};
    this.filteredView = {};
    this.activePlaybook = null;
    this.activeDrawer = null;
    this.refreshTimer = null;
    this.searchTimeout = null;

    this.filters = {
      categoria: routeQuery.categoria || '',
      search: routeQuery.q || '',
      favoritos: routeQuery.favoritos === '1',
      emAndamento: false,
      clienteId: routeQuery.clienteId || '',
      playbookId: routeQuery.playbookId || ''
    };
  }

  static create(params = {}, query = {}) {
    return new PlaybooksPage(params, query).render();
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
    el.className = 'cds-playbooks-header cds-page-header';
    el.innerHTML = `
      <div>
        <p class="cds-eyebrow">Motor Comercial</p>
        <h1 class="cds-title">Central de Guias Operacionais</h1>
        <p class="cds-description">Roteiros guiados passo a passo para o dia a dia comercial.</p>
        <p id="playbooks-updated" class="cds-caption"></p>
      </div>
    `;
    const actions = document.createElement('div');
    actions.className = 'cds-playbooks-header__actions';
    if (this.navigationContext.locked && !this.activePlaybook) {
      actions.appendChild(Button.create({
        text: getBackButtonLabel(this.navigationContext, 'Voltar'),
        variant: 'ghost',
        onClick: () => navigate(resolveBackPath(this.navigationContext, '/clientes'))
      }));
    }
    actions.appendChild(Button.create({ text: 'Atualizar', variant: 'secondary', onClick: () => this._loadData() }));
    actions.appendChild(Button.create({ text: 'PDF', variant: 'ghost', onClick: () => this._export('pdf') }));
    actions.appendChild(Button.create({ text: 'Excel', variant: 'ghost', onClick: () => this._export('excel') }));
    actions.appendChild(Button.create({ text: 'Planilha', variant: 'ghost', onClick: () => this._export('csv') }));
    if (this.activePlaybook) {
      actions.appendChild(Button.create({ text: '← Voltar', variant: 'ghost', onClick: () => { this.activePlaybook = null; this._renderAll(); } }));
    }
    el.appendChild(actions);
    return el;
  }

  _sidebar() {
    const nav = document.createElement('nav');
    nav.className = 'cds-playbooks-sidebar';
    [
      { l: 'Painel', p: '/' },
      { l: 'Pendências', p: '/pendencias' },
      { l: 'Recomendações', p: '/recomendacoes' },
      { l: 'Guias Operacionais', p: '/playbooks', active: true },
      { l: 'Processos', p: '/workflow' },
      { l: 'Clientes', p: '/clientes' }
    ].forEach((i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `cds-playbooks-sidebar__item${i.active ? ' cds-playbooks-sidebar__item--active' : ''}`;
      b.textContent = i.l;
      b.addEventListener('click', () => navigate(routeWithActiveContext(i.p, this.navigationContext)));
      nav.appendChild(b);
    });
    return nav;
  }

  _footer() {
    const f = document.createElement('div');
    f.className = 'cds-playbooks-footer';
    f.textContent = 'Guias Operacionais — Motor Comercial CDS';
    return f;
  }

  _content() {
    const w = document.createElement('div');
    w.className = 'cds-playbooks-content';
    w.id = 'playbooks-root';
    w.appendChild(this._filters());
    w.appendChild(this._host('pb-kpis', 'KPIs...'));
    w.appendChild(this._host('pb-categorias', 'Categorias...'));
    w.appendChild(this._host('pb-lista', 'Guias operacionais...'));
    w.appendChild(this._host('pb-fluxo', ''));
    w.appendChild(this._host('pb-historico', 'Histórico...'));
    return w;
  }

  _host(id, msg) {
    const s = document.createElement('section');
    s.id = id;
    s.className = 'cds-playbooks-section';
    if (msg) s.appendChild(Loading.create({ message: msg }));
    return s;
  }

  _filters() {
    const c = document.createElement('div');
    c.className = 'cds-playbooks-filters';
    const row = document.createElement('div');
    row.className = 'cds-playbooks-filters__row';

    const sel = document.createElement('select');
    sel.innerHTML = '<option value="">Todas categorias</option>';
    ['COBRANCA', 'RENEGOCIACAO', 'ENTREGA', 'PRESTACAO', 'RECUPERACAO', 'VISITA_COMERCIAL', 'ATUALIZACAO_CADASTRAL', 'BLOQUEIO', 'LIBERACAO', 'CLIENTE_VIP']
      .forEach((cat) => {
        const o = document.createElement('option');
        o.value = cat;
        o.textContent = categoriaLabel(cat);
        o.selected = this.filters.categoria === cat;
        sel.appendChild(o);
      });
    sel.addEventListener('change', (e) => { this.filters.categoria = e.target.value; this._applyAndRender(); });

    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'Pesquisar guia operacional...';
    search.value = this.filters.search;
    search.addEventListener('input', (e) => {
      clearTimeout(this.searchTimeout);
      this.searchTimeout = setTimeout(() => { this.filters.search = e.target.value; this._applyAndRender(); }, 300);
    });

    row.appendChild(sel);
    row.appendChild(search);
    row.appendChild(Button.create({ text: '★ Favoritos', variant: this.filters.favoritos ? 'primary' : 'ghost', onClick: () => { this.filters.favoritos = !this.filters.favoritos; this._applyAndRender(); } }));
    row.appendChild(Button.create({ text: 'Em andamento', variant: this.filters.emAndamento ? 'primary' : 'ghost', onClick: () => { this.filters.emAndamento = !this.filters.emAndamento; this._applyAndRender(); } }));
    c.appendChild(row);
    return c;
  }

  async _loadData(silent = false) {
    try {
      const params = buildFilterParams({ clienteId: this.filters.clienteId || undefined });
      const payload = await this.projectionApi.obterProjecaoPlaybooks(params);
      this.view = buildViewFromPayload(payload);
      if (this.filters.playbookId) {
        this.activePlaybook = this.view.playbooks.find((p) => p.id === this.filters.playbookId)
          || this.view.playbooks.find((p) => p.codigo === this.filters.playbookId);
      }
      this._applyAndRender();
      const el = document.getElementById('playbooks-updated');
      if (el) el.textContent = `Atualizado: ${new Date().toLocaleTimeString('pt-BR')}`;
    } catch (error) {
      if (!silent) {
        const s = document.getElementById('pb-kpis');
        if (s) { s.innerHTML = ''; s.appendChild(Alert.create({ message: error.message, variant: 'error' })); }
      }
    }
  }

  _applyAndRender() {
    this.filteredView = applyFilters(this.view, this.filters);
    this._renderAll();
  }

  _renderAll() {
    this._renderKpis();
    this._renderCategorias();
    if (this.activePlaybook) {
      this._renderFluxo();
      const lista = document.getElementById('pb-lista');
      if (lista) lista.style.display = 'none';
    } else {
      this._renderLista();
      const lista = document.getElementById('pb-lista');
      if (lista) lista.style.display = '';
      const fluxo = document.getElementById('pb-fluxo');
      if (fluxo) fluxo.innerHTML = '';
    }
    this._renderHistorico();
  }

  _renderKpis() {
    const s = document.getElementById('pb-kpis');
    if (!s) return;
    s.innerHTML = '<h2>Indicadores</h2>';
    const k = this.filteredView.kpis || {};
    const g = document.createElement('div');
    g.className = 'cds-playbooks-kpis';
    [
      { title: 'Iniciados', value: k.iniciados, color: 'primary' },
      { title: 'Em andamento', value: k.emAndamento, color: 'warning' },
      { title: 'Concluídos', value: k.concluidos, color: 'success' },
      { title: 'Taxa conclusão', value: k.taxaConclusao, format: 'percent' },
      { title: 'Tempo médio (min)', value: k.tempoMedioMinutos ?? '—', format: 'text' },
      { title: 'Eficiência', value: k.eficiencia, format: 'percent' }
    ].forEach((c) => g.appendChild(StatCard.create(c)));
    s.appendChild(g);
  }

  _renderCategorias() {
    const s = document.getElementById('pb-categorias');
    if (!s) return;
    s.innerHTML = '<h2>Categorias</h2>';
    const g = document.createElement('div');
    g.className = 'cds-playbooks-categorias';
    Object.entries(this.filteredView.categorias || {}).forEach(([cat, items]) => {
      if (!items.length) return;
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'cds-playbooks-categoria';
      card.innerHTML = `<strong>${categoriaLabel(cat)}</strong><span>${items.length}</span>`;
      card.addEventListener('click', () => { this.filters.categoria = cat; this._applyAndRender(); });
      g.appendChild(card);
    });
    s.appendChild(g);
  }

  _renderLista() {
    const s = document.getElementById('pb-lista');
    if (!s) return;
    s.innerHTML = '<h2>Guias Operacionais</h2>';
    const list = this.filteredView.playbooks || [];
    if (!list.length) {
      s.appendChild(EmptyState.create(emptyState('PLAYBOOKS')));
      return;
    }
    s.appendChild(Table.create({
      columns: [
        { key: 'fav', label: '' },
        { key: 'codigo', label: 'ID' },
        { key: 'nome', label: 'Nome' },
        { key: 'categoria', label: 'Categoria' },
        { key: 'progresso', label: '% Concluído' },
        { key: 'tempoPrevisto', label: 'Tempo previsto' },
        { key: 'tempoRealizado', label: 'Tempo realizado' },
        { key: 'status', label: 'Status' },
        { key: 'acoes', label: '' }
      ],
      data: list.map((p) => ({
        fav: Button.create({ text: p.favorito ? '★' : '☆', variant: 'ghost', onClick: (e) => { e.stopPropagation(); toggleFavorite(p.id); this._loadData(true); } }),
        codigo: p.codigo,
        nome: p.nome,
        categoria: categoriaLabel(p.categoria),
        progresso: `${p.progresso ?? p.percentualConcluido ?? 0}%`,
        tempoPrevisto: p.tempoPrevistoMinutos != null ? `${p.tempoPrevistoMinutos} min` : '—',
        tempoRealizado: p.tempoRealizadoMinutos != null ? `${p.tempoRealizadoMinutos} min` : '—',
        status: p.instanceStatus || 'DISPONIVEL',
        acoes: this._rowActions(p),
        _raw: p
      })),
      onRowClick: (row) => this._openDrawer(row._raw)
    }));
  }

  _rowActions(p) {
    const w = document.createElement('div');
    w.appendChild(Button.create({ text: 'Iniciar', variant: 'primary', onClick: (e) => { e.stopPropagation(); this._startPb(p); } }));
    w.appendChild(Button.create({ text: 'Fluxo', variant: 'ghost', onClick: (e) => { e.stopPropagation(); this._openFluxo(p); } }));
    return w;
  }

  _renderFluxo() {
    const s = document.getElementById('pb-fluxo');
    if (!s || !this.activePlaybook) return;
    const p = this.activePlaybook;
    s.innerHTML = '';
    s.style.display = 'block';

    const title = document.createElement('h2');
    title.textContent = `Fluxo Guiado — ${p.nome}`;
    s.appendChild(title);

    const progress = document.createElement('div');
    progress.className = 'cds-playbooks-progress';
    progress.innerHTML = `<div class="cds-playbooks-progress__bar" style="width:${p.progresso}%"></div><span>${p.progresso}% concluído</span>`;
    s.appendChild(progress);

    const passoAtual = p.passos[p.passoAtual];
    if (passoAtual) {
      const current = document.createElement('div');
      current.className = 'cds-playbooks-passo-atual';
      current.innerHTML = `
        <h3>Passo atual: ${passoAtual.titulo}</h3>
        <p>${passoAtual.descricao}</p>
        ${p.passos[p.passoAtual + 1] ? `<p><em>Próximo:</em> ${p.passos[p.passoAtual + 1].titulo}</p>` : '<p><em>Último passo</em></p>'}
        <p>Tempo estimado total: ${p.tempoEstimadoMinutos} min</p>
      `;
      if (passoAtual.link) {
        current.appendChild(Button.create({ text: 'Abrir tela relacionada', variant: 'secondary', onClick: () => navigate(passoAtual.link) }));
      }
      s.appendChild(current);
    }

    const checklistTitle = document.createElement('h3');
    checklistTitle.textContent = 'Lista de verificação';
    s.appendChild(checklistTitle);

    const checklist = document.createElement('div');
    checklist.className = 'cds-playbooks-checklist';
    (p.checklist || []).forEach((item, idx) => {
      const row = document.createElement('div');
      row.className = 'cds-playbooks-checklist__item';
      row.innerHTML = `
        ${Badge.create({ text: item.status, variant: statusChecklistVariant(item.status) }).outerHTML}
        <span>${item.titulo}</span>
      `;
      const actions = document.createElement('div');
      if (item.status !== 'CONCLUIDO') {
        actions.appendChild(Button.create({ text: 'Concluir', variant: 'primary', onClick: () => this._completeStep(p, item.passoId) }));
        actions.appendChild(Button.create({ text: 'Ignorar', variant: 'ghost', onClick: () => this._ignoreStep(p, item.passoId) }));
      }
      row.appendChild(actions);
      checklist.appendChild(row);
    });
    s.appendChild(checklist);

    const obs = document.createElement('div');
    obs.className = 'cds-playbooks-obs';
    obs.appendChild(Button.create({ text: 'Adicionar observação', variant: 'ghost', onClick: () => this._addObs(p) }));
    s.appendChild(obs);
  }

  _renderHistorico() {
    const s = document.getElementById('pb-historico');
    if (!s) return;
    s.innerHTML = '<h2>Histórico</h2>';
    const h = loadHistory();
    if (!h.length) {
      s.appendChild(EmptyState.create({ title: 'Sem histórico', description: 'Guias operacionais iniciados aparecerão aqui' }));
      return;
    }
    s.appendChild(Table.create({
      columns: [
        { key: 'nome', label: 'Guia operacional' },
        { key: 'acao', label: 'Ação' },
        { key: 'usuario', label: 'Usuário' },
        { key: 'quando', label: 'Quando' },
        { key: 'resultado', label: 'Resultado' }
      ],
      data: h.slice(0, 15).map((x) => ({
        nome: x.nome,
        acao: x.acao,
        usuario: x.usuario || '-',
        quando: x.quando ? new Date(x.quando).toLocaleString('pt-BR') : '-',
        resultado: x.resultado || '-'
      }))
    }));
  }

  async _startPb(p) {
    const ok = await confirmDialog({
      ...ConfirmMessages.INICIAR_PLAYBOOK,
      message: `Iniciar "${p.nome}"? Nenhuma ação será executada automaticamente.`
    });
    if (!ok) return;
    startPlaybook(p, { clienteId: this.filters.clienteId });
    notifySuccess('PLAYBOOK_INICIADO');
    await this._loadData(true);
    this._openFluxo(this.view.playbooks.find((x) => x.id === p.id) || p);
  }

  _openFluxo(p) {
    this.activePlaybook = p;
    this._renderAll();
  }

  async _completeStep(p, passoId) {
    updateChecklistItem(p.id, passoId, 'CONCLUIDO');
    notifySuccess('PLAYBOOK_PASSO_CONCLUIDO');
    await this._loadData(true);
    this.activePlaybook = this.view.playbooks.find((x) => x.id === p.id);
    this._renderAll();
  }

  async _ignoreStep(p, passoId) {
    const ok = await confirmDialog(ConfirmMessages.IGNORAR_PASSO);
    if (!ok) return;
    updateChecklistItem(p.id, passoId, 'IGNORADO');
    await this._loadData(true);
    this.activePlaybook = this.view.playbooks.find((x) => x.id === p.id);
    this._renderAll();
  }

  async _addObs(p) {
    const obs = await promptDialog({ title: 'Observação', message: 'Registrar observação:', defaultValue: p.observacoes || '' });
    if (obs == null) return;
    saveInstance(p.id, { observacoes: obs });
    notifyInfo('PLAYBOOK_OBS_SALVA');
  }

  async _openDrawer(p) {
    if (this.activeDrawer) { this.activeDrawer.remove(); this.activeDrawer = null; }
    const content = document.createElement('div');
    await new PlaybooksDrawer(this, p).mount(content);
    const drawer = Drawer.create({ title: p.nome, content, size: 'lg', open: true, onClose: () => { this.activeDrawer = null; } });
    this.activeDrawer = drawer;
    document.body.appendChild(drawer);
  }

  _export(format) {
    const rows = this.filteredView.playbooks || [];
    if (!rows.length) { notifyWarning('NADA_PARA_EXPORTAR'); return; }
    const header = ['Código', 'Nome', 'Categoria', 'Progresso', 'Status'];
    const lines = rows.map((r) => [r.codigo, r.nome, r.categoria, r.progresso, r.instanceStatus || ''].join(','));
    const csv = [header.join(','), ...lines].join('\n');
    if (format === 'csv' || format === 'excel') {
      const blob = new Blob([csv], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `playbooks.${format === 'excel' ? 'csv' : 'csv'}`;
      a.click();
    } else {
      notifyInfo('EXPORT_PDF_EM_BREVE');
    }
  }

  _startAutoRefresh() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = setInterval(() => {
      if (!document.getElementById('playbooks-root')) { clearInterval(this.refreshTimer); return; }
      this._loadData(true);
    }, REFRESH_INTERVAL_MS);
  }
}

module.exports = PlaybooksPage;
