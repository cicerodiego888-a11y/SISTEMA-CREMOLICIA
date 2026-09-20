/**
 * CockpitDrawer — Drawer operacional com abas da Central.
 *
 * Sprint O-3: Central de Operações Comerciais.
 *
 * @module frontend/modules/motor-comercial/pages/Consignacoes/CockpitDrawer
 */

const Tabs = require('../../components/navigation/Tabs');
const Button = require('../../components/base/Button');
const Loading = require('../../components/base/Loading');
const EmptyState = require('../../components/base/EmptyState');
const Alert = require('../../components/base/Alert');
const Timeline = require('../../components/special/Timeline');
const StatCard = require('../../components/data/StatCard');
const { createOperationalBadge } = require('./badges');
const { carregarConsignacaoCompleta, navigate } = require('../../utils/operacional');

const DRAWER_TABS = [
  { key: 'resumo', label: 'Resumo' },
  { key: 'itens', label: 'Itens' },
  { key: 'timeline', label: 'Linha do Tempo' },
  { key: 'movimentacoes', label: 'Movimentações' },
  { key: 'prestacao', label: 'Fechamento' },
  { key: 'financeiro', label: 'Financeiro' },
  { key: 'perfil', label: 'Perfil Comercial' },
  { key: 'indicadores', label: 'Indicadores' },
  { key: 'auditoria', label: 'Auditoria' }
];

class CockpitDrawer {
  constructor(page, consignacao) {
    this.page = page;
    this.consignacao = consignacao;
    this.activeTab = 'resumo';
    this.cache = {};
    this.loadingTab = false;
    this.root = null;
    this.panelEl = null;
  }

  async mount(container) {
    this.root = container;
    container.className = 'cds-cockpit-drawer';
    container.appendChild(this._renderTabs());
    this.panelEl = document.createElement('div');
    this.panelEl.className = 'cds-cockpit-drawer__panel';
    container.appendChild(this.panelEl);
    await this._renderActiveTab();
    return container;
  }

  async refresh() {
    this.cache = {};
    await this._renderActiveTab();
  }

  _renderTabs() {
    return Tabs.create({
      tabs: DRAWER_TABS,
      activeTab: this.activeTab,
      onTabChange: async (key) => {
        this.activeTab = key;
        const tabsHost = this.root.querySelector('.cds-tabs');
        if (tabsHost) {
          const replacement = this._renderTabs();
          tabsHost.replaceWith(replacement);
        }
        await this._renderActiveTab();
      }
    });
  }

  async _renderActiveTab() {
    if (!this.panelEl) return;
    this.panelEl.innerHTML = '';
    this.panelEl.appendChild(Loading.create({ message: 'Carregando painel...' }));

    try {
      const content = await this._loadTabContent(this.activeTab);
      this.panelEl.innerHTML = '';
      this.panelEl.appendChild(content);
    } catch (error) {
      this.panelEl.innerHTML = '';
      this.panelEl.appendChild(Alert.create({
        message: 'Erro ao carregar painel: ' + error.message,
        variant: 'error',
        dismissible: true
      }));
    }
  }

  async _loadTabContent(tabKey) {
    if (this.cache[tabKey]) return this.cache[tabKey];

    let content;
    switch (tabKey) {
      case 'resumo':
        content = await this._tabResumo();
        break;
      case 'itens':
        content = await this._tabItens();
        break;
      case 'timeline':
        content = await this._tabTimeline();
        break;
      case 'movimentacoes':
        content = await this._tabMovimentacoes();
        break;
      case 'prestacao':
        content = await this._tabPrestacao();
        break;
      case 'financeiro':
        content = await this._tabFinanceiro();
        break;
      case 'perfil':
        content = await this._tabPerfil();
        break;
      case 'indicadores':
        content = await this._tabIndicadores();
        break;
      case 'auditoria':
        content = await this._tabAuditoria();
        break;
      default:
        content = EmptyState.create({ title: 'Aba indisponível' });
    }

    this.cache[tabKey] = content;
    return content;
  }

  async _getBundle() {
    if (this.cache._bundle) return this.cache._bundle;
    const [completa, timeline, historico, prestacao, contaCorrente, indicadores, perfil, situacao] = await Promise.all([
      carregarConsignacaoCompleta(this.page.api, this.page.projectionApi, this.consignacao.id),
      this.page.projectionApi.listarTimeline({ consignacaoId: this.consignacao.id }).catch(() => []),
      this.page.projectionApi.listarMovimentacoes({ consignacaoId: this.consignacao.id }).catch(() => []),
      this.page.projectionApi.obterResumoPrestacao({ consignacaoId: this.consignacao.id }).catch(() => null),
      this.page.projectionApi.obterProjecaoContaCorrente({ consignacaoId: this.consignacao.id }).catch(() => null),
      this.page.projectionApi.obterProjecaoIndicadores({ consignacaoId: this.consignacao.id }).catch(() => null),
      this.consignacao.perfilComercialId
        ? this.page.api.obterPerfil(this.consignacao.perfilComercialId).catch(() => null)
        : Promise.resolve(null),
      this.consignacao.clienteId
        ? this.page.projectionApi.obterSituacaoCliente({ clienteId: this.consignacao.clienteId }).catch(() => null)
        : Promise.resolve(null)
    ]);

    this.cache._bundle = { completa, timeline, historico, prestacao, contaCorrente, indicadores, perfil, situacao };
    return this.cache._bundle;
  }

  async _tabResumo() {
    const { completa, prestacao, situacao, perfil } = await this._getBundle();
    const wrap = document.createElement('div');
    wrap.className = 'cds-cockpit-drawer__grid';

    const fields = [
      ['Cliente', completa.cliente],
      ['Perfil', perfil?.perfilTipo || completa.consignado],
      ['Documento', completa.documento],
      ['Abertura', this.page._formatDate(completa.dataAbertura || completa.data)],
      ['Entrega', this.page._formatDate(completa.dataEntrega)],
      ['Status', createOperationalBadge(completa).outerHTML],
      ['Valor', this.page._formatCurrency(completa.valor || prestacao?.valorConsignado || 0)],
      ['Saldo', this.page._formatCurrency(completa.saldo || prestacao?.saldoAtual || 0)],
      ['Limite', this.page._formatCurrency(situacao?.limiteDisponivel || perfil?.limiteComercial || 0)],
      ['Situação', situacao?.situacao || '-'],
      ['Operador', completa.usuario || '-']
    ];

    fields.forEach(([label, value]) => {
      wrap.appendChild(this._field(label, value));
    });

    return wrap;
  }

  async _tabItens() {
    const { completa } = await this._getBundle();
    const wrap = document.createElement('div');

    let entregas = [];
    try {
      const payload = await this.page.api.consultarEntregasConsignacao(this.consignacao.id);
      entregas = payload?.entregas || [];
    } catch (_e) {
      entregas = [];
    }

    if (entregas.length) {
      entregas.forEach((ev) => {
        const bloco = document.createElement('div');
        bloco.className = 'cds-cockpit-drawer__entrega-bloco';
        const when = ev.dataHora ? new Date(ev.dataHora).toLocaleString('pt-BR') : '—';
        bloco.innerHTML = `<h4>${ev.label} — ${when}</h4>`;
        (ev.itens || []).forEach((item) => {
          const row = document.createElement('div');
          row.className = 'cds-cockpit-drawer__item';
          row.innerHTML = `
            <div class="cds-cockpit-drawer__item-name">${item.produtoNome || item.produtoId}</div>
            <div class="cds-cockpit-drawer__item-meta">
              <span>Qtd: ${item.quantidade}</span>
              <span>${this.page._formatCurrency(item.valor || 0)}</span>
            </div>
          `;
          bloco.appendChild(row);
        });
        wrap.appendChild(bloco);
      });
      return wrap;
    }

    if (!completa.itens?.length) {
      wrap.appendChild(EmptyState.create({ title: 'Sem itens', description: 'Nenhum item na consignação' }));
      return wrap;
    }

    completa.itens.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'cds-cockpit-drawer__item';
      row.innerHTML = `
        <div class="cds-cockpit-drawer__item-name">${item.produto || item.produtoId}</div>
        <div class="cds-cockpit-drawer__item-meta">
          <span>Qtd: ${item.quantidade}</span>
          <span>${this.page._formatCurrency(item.preco || item.precoUnitario || 0)}</span>
        </div>
      `;
      wrap.appendChild(row);
    });
    return wrap;
  }

  async _tabTimeline() {
    const { timeline } = await this._getBundle();
    return Timeline.create({
      events: timeline,
      emptyTitle: 'Sem eventos',
      emptyDescription: 'Nenhum evento na timeline'
    });
  }

  async _tabMovimentacoes() {
    const { historico } = await this._getBundle();
    const wrap = document.createElement('div');

    const filter = document.createElement('input');
    filter.className = 'cds-consignacoes-filters__input';
    filter.placeholder = 'Filtrar movimentações...';
    wrap.appendChild(filter);

    const list = document.createElement('div');
    list.className = 'cds-cockpit-drawer__mov-list';

    const render = (term = '') => {
      list.innerHTML = '';
      const q = term.toLowerCase();
      const items = (historico || []).filter((mov) => {
        const blob = `${mov.tipo || ''} ${mov.descricao || ''} ${mov.tipoMovimentacao || ''}`.toLowerCase();
        return !q || blob.includes(q);
      });

      if (!items.length) {
        list.appendChild(EmptyState.create({ title: 'Sem movimentações', description: 'Nenhum registro encontrado' }));
        return;
      }

      items.forEach((mov) => {
        const row = document.createElement('div');
        row.className = 'cds-cockpit-drawer__mov';
        row.innerHTML = `
          <div class="cds-cockpit-drawer__mov-date">${this.page._formatDateTime(mov.data || mov.dataMovimentacao)}</div>
          <div class="cds-cockpit-drawer__mov-type">${this._labelMovimentacao(mov)}</div>
          <div class="cds-cockpit-drawer__mov-desc">${mov.descricao || mov.descricaoResumo || '-'}</div>
        `;
        list.appendChild(row);
      });
    };

    filter.addEventListener('input', (e) => render(e.target.value));
    render();
    wrap.appendChild(list);
    return wrap;
  }

  async _tabPrestacao() {
    const { prestacao } = await this._getBundle();
    const wrap = document.createElement('div');
    if (!prestacao) {
      wrap.appendChild(EmptyState.create({ title: 'Sem prestação', description: 'Nenhuma prestação registrada' }));
      return wrap;
    }

    const cards = document.createElement('div');
    cards.className = 'cds-cockpit-drawer__cards';
    [
      StatCard.create({ title: 'Vendido', value: this.page._formatCurrency(prestacao.valorVendido || 0), icon: '💰' }),
      StatCard.create({ title: 'Recebido', value: this.page._formatCurrency(prestacao.valorRecebido || 0), icon: '💵' }),
      StatCard.create({ title: 'Saldo', value: this.page._formatCurrency(prestacao.saldoAtual || 0), icon: '⚖️', color: 'warning' })
    ].forEach((c) => cards.appendChild(c));
    wrap.appendChild(cards);

    const actions = document.createElement('div');
    actions.className = 'cds-cockpit-drawer__actions';
    actions.appendChild(Button.create({
      text: 'Fechar Atendimento',
      variant: 'primary',
      onClick: () => this.page._openPrestacao(this.consignacao)
    }));
    wrap.appendChild(actions);
    return wrap;
  }

  async _tabFinanceiro() {
    const { contaCorrente, situacao } = await this._getBundle();
    const wrap = document.createElement('div');
    wrap.className = 'cds-cockpit-drawer__grid';

    wrap.appendChild(this._field('Saldo', this.page._formatCurrency(contaCorrente?.saldo ?? situacao?.saldoEmAberto ?? 0)));
    wrap.appendChild(this._field('Saldo em Aberto', this.page._formatCurrency(contaCorrente?.saldoEmAberto ?? 0)));
    wrap.appendChild(this._field('Limite Disponível', this.page._formatCurrency(situacao?.limiteDisponivel ?? 0)));

    const movs = contaCorrente?.movimentacoes || [];
    if (!movs.length) {
      wrap.appendChild(EmptyState.create({ title: 'Sem movimentações financeiras' }));
      return wrap;
    }

    movs.slice(0, 8).forEach((mov) => {
      wrap.appendChild(this._field(mov.tipo || 'Movimento', `${this.page._formatCurrency(mov.valor || 0)} — ${this.page._formatDate(mov.data)}`));
    });
    return wrap;
  }

  async _tabPerfil() {
    const { perfil, situacao } = await this._getBundle();
    const wrap = document.createElement('div');
    wrap.className = 'cds-cockpit-drawer__grid';

    if (!perfil) {
      wrap.appendChild(EmptyState.create({ title: 'Perfil não encontrado' }));
      return wrap;
    }

    wrap.appendChild(this._field('Tipo', perfil.perfilTipo));
    wrap.appendChild(this._field('Limite', this.page._formatCurrency(perfil.limiteComercial || 0)));
    wrap.appendChild(this._field('Saldo Aberto', this.page._formatCurrency(perfil.saldoAberto || 0)));
    wrap.appendChild(this._field('Score', situacao?.score ?? '-'));
    wrap.appendChild(this._field('Nível de Risco', situacao?.nivelRisco ?? '-'));

    const actions = document.createElement('div');
    actions.className = 'cds-cockpit-drawer__actions';
    actions.appendChild(Button.create({
      text: 'Abrir Perfil',
      variant: 'secondary',
      onClick: () => navigate('/clientes')
    }));
    wrap.appendChild(actions);
    return wrap;
  }

  async _tabIndicadores() {
    const { indicadores } = await this._getBundle();
    const wrap = document.createElement('div');
    wrap.className = 'cds-cockpit-drawer__cards';

    if (!indicadores) {
      wrap.appendChild(EmptyState.create({ title: 'Indicadores indisponíveis' }));
      return wrap;
    }

    const cards = [
      { title: 'Conversão', value: `${indicadores.percentualVenda ?? 0}%`, icon: '📈' },
      { title: 'Perdas', value: this.page._formatCurrency(indicadores.valorPerdido || 0), icon: '❌' },
      { title: 'Cortesias', value: this.page._formatCurrency(indicadores.valorCortesia || 0), icon: '🎁' },
      { title: 'Ticket Médio', value: this.page._formatCurrency(indicadores.ticketMedio || indicadores.valorVendido || 0), icon: '🧾' },
      { title: 'Recebimento', value: this.page._formatCurrency(indicadores.valorRecebido || 0), icon: '💵' },
      { title: 'Consignações', value: String(indicadores.totalConsignacoes || 0), icon: '📦' }
    ];

    cards.forEach((cfg) => wrap.appendChild(StatCard.create(cfg)));
    return wrap;
  }

  async _tabAuditoria() {
    const { historico, timeline } = await this._getBundle();
    const wrap = document.createElement('div');
    const eventos = [...(historico || []), ...(timeline || [])];

    if (!eventos.length) {
      wrap.appendChild(EmptyState.create({ title: 'Sem registros de auditoria' }));
      return wrap;
    }

    eventos.slice(0, 20).forEach((ev) => {
      const row = document.createElement('div');
      row.className = 'cds-cockpit-drawer__audit';
      row.innerHTML = `
        <div><strong>${ev.usuarioId || ev.usuario || 'Sistema'}</strong> — ${this.page._formatDateTime(ev.data || ev.dataMovimentacao || ev.timestamp)}</div>
        <div>${ev.tipo || ev.tipoMovimentacao || ev.titulo || 'Operação'}</div>
        <div class="cds-cockpit-drawer__audit-meta">
          Origem: ${ev.origem || 'LEDGER'}
          ${ev.correlationId ? ` | Correlation: ${ev.correlationId}` : ''}
          ${ev.requestId ? ` | Request: ${ev.requestId}` : ''}
        </div>
      `;
      wrap.appendChild(row);
    });
    return wrap;
  }

  _labelMovimentacao(mov = {}) {
    const tipo = mov.tipo || mov.tipoMovimentacao || '-';
    if (tipo === 'TERMO_ENTREGA_EMITIDO') return 'Termo de Entrega emitido';
    return tipo;
  }

  _field(label, value) {
    const el = document.createElement('div');
    el.className = 'cds-cockpit-drawer__field';
    el.innerHTML = `<label>${label}</label><div>${value}</div>`;
    return el;
  }
}

module.exports = CockpitDrawer;
