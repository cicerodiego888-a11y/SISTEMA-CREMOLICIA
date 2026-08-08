/**
 * Central de Clientes — ponto de entrada operacional do Motor Comercial.
 *
 * Sprint UX-01: interface operacional sem exposição de Perfil Comercial.
 *
 * @module frontend/modules/motor-comercial/pages/PerfilComercial
 */

const CadastroLayout = require('../../components/layouts/CadastroLayout');
const Button = require('../../components/base/Button');
const Loading = require('../../components/base/Loading');
const EmptyState = require('../../components/base/EmptyState');
const Alert = require('../../components/base/Alert');
const Badge = require('../../components/base/Badge');
const MotorComercialApi = require('../../api/MotorComercialApi');
const ProjectionApi = require('../../api/ProjectionApi');
const { mapConsignacaoView } = require('../../api/helpers');
const CentralOperacoesView = require('./CentralOperacoesView');
const { buildCentralOperacoesViewModel } = require('./centralOperacoesMappers');
const ClienteOperacionalCard = require('./ClienteOperacionalCard');
const ClienteCadastroView = require('./ClienteCadastroView');
const {
  buildResumoComercial,
  buildPendenciasGrouped
} = require('./cliente360Mappers');
const {
  mapPerfilListItem,
  mapPerfilDetail
} = require('./perfilMappers');
const {
  groupPerfisByCliente,
  enrichClienteCard,
  filtrarClientesOperacional
} = require('./clienteOperacionalMappers');
const {
  buildViewFromPayload
} = require('../Pendencias/pendenciasMappers');
const {
  notify,
  navigate,
  confirmDialog,
  choiceDialog,
  withLoading,
  fetchErp
} = require('../../utils/operacional');
const { buildRouteWithCliente360Context } = require('../../utils/cliente360Context');

const REFRESH_INTERVAL_MS = 60000;

const SEARCH_DEBOUNCE_MS = 350;

class PerfilComercialPage {
  constructor(routeParams = {}, routeQuery = {}) {
    this.routeParams = routeParams;
    this.routeQuery = routeQuery;
    this.api = new MotorComercialApi();
    this.projectionApi = new ProjectionApi();

    if (routeParams.cadastro) {
      this.mode = 'cadastro';
      this.editClienteId = routeParams.id ? Number(routeParams.id) : null;
    } else if (routeParams.id) {
      this.mode = 'panel';
    } else {
      this.mode = 'list';
    }

    this.perfis = [];
    this.clientesOperacionais = [];
    this.perfil = null;
    this.payload = {};
    this.view = {};
    this.headerInfo = null;
    this.search = routeQuery.q || '';
    this.searchTimeout = null;
    this.lastUpdated = null;
    this.refreshTimer = null;
    this.activeDrawer = null;
    this.cadastroView = null;
    this.loading = true;
    this.error = null;
    this.filtersOpen = false;
    this.filters = { status: 'todos', capacidade: '' };
    this.pagination = { page: 1, pageSize: 50, total: 0 };
  }

  static create(params = {}, query = {}) {
    return new PerfilComercialPage(params, query).render();
  }

  render() {
    if (this.mode === 'cadastro') {
      return this._renderCadastroShell();
    }
    if (this.mode === 'panel') {
      return this._render360Shell();
    }
    return this._renderListShell();
  }

  _renderCadastroShell() {
    const layout = CadastroLayout.create({
      header: null,
      toolbar: null,
      content: this._createCadastroContent(),
      sidebar: null
    });
    return layout;
  }

  _createCadastroContent() {
    this.cadastroView = new ClienteCadastroView({
      isEdit: !!this.editClienteId,
      clienteId: this.editClienteId,
      api: this.api,
      onSalvo: (clienteId) => {
        if (clienteId) {
          navigate(`/clientes/${clienteId}`);
        } else {
          navigate('/clientes');
        }
      },
      onCancelar: () => navigate('/clientes')
    });
    return this.cadastroView.render();
  }

  _renderListShell() {
    const layout = CadastroLayout.create({
      header: this._createListHeader(),
      toolbar: this._createSearchToolbar(),
      content: this._createListContent(),
      sidebar: null
    });

    setTimeout(() => this._loadPerfis(), 0);
    return layout;
  }

  _render360Shell() {
    const layout = CadastroLayout.create({
      header: null,
      toolbar: null,
      content: this._create360Content(),
      sidebar: null
    });

    setTimeout(() => {
      this._loadCentralOperacoes();
      this._startAutoRefresh();
    }, 0);

    return layout;
  }

  /* ===================== LIST MODE ===================== */

  _createListHeader() {
    const el = document.createElement('div');
    el.className = 'cds-cliente360-list-header cds-central-clientes-header';
    el.innerHTML = `
      <div>
        <h1>CENTRAL DE CLIENTES</h1>
      </div>
    `;
    const actions = document.createElement('div');
    actions.className = 'cds-cliente360-list-header__actions';
    actions.appendChild(Button.create({
      text: 'Filtros',
      variant: 'ghost',
      onClick: () => this._toggleFiltros()
    }));
    actions.appendChild(Button.create({
      text: 'Atualizar',
      variant: 'secondary',
      onClick: () => this._loadPerfis()
    }));
    actions.appendChild(Button.create({
      text: 'Novo Cliente',
      variant: 'primary',
      onClick: () => navigate('/clientes/novo')
    }));
    el.appendChild(actions);
    return el;
  }

  _toggleFiltros() {
    this.filtersOpen = !this.filtersOpen;
    const panel = document.getElementById('central-clientes-filtros');
    if (panel) panel.hidden = !this.filtersOpen;
  }

  _createFiltrosPanel() {
    const panel = document.createElement('div');
    panel.id = 'central-clientes-filtros';
    panel.className = 'cds-central-clientes-filtros';
    panel.hidden = !this.filtersOpen;

    const statusLabel = document.createElement('label');
    statusLabel.textContent = 'Status';
    const statusSelect = document.createElement('select');
    statusSelect.className = 'cds-central-clientes-filtros__select';
    [
      { value: 'todos', label: 'Todos' },
      { value: 'ativo', label: 'Ativo' },
      { value: 'bloqueado', label: 'Bloqueado' },
      { value: 'inativo', label: 'Inativo' }
    ].forEach((opt) => {
      const o = document.createElement('option');
      o.value = opt.value;
      o.textContent = opt.label;
      if (this.filters.status === opt.value) o.selected = true;
      statusSelect.appendChild(o);
    });
    statusSelect.addEventListener('change', (e) => {
      this.filters.status = e.target.value;
      this._renderListCards();
    });

    panel.appendChild(statusLabel);
    panel.appendChild(statusSelect);
    return panel;
  }

  _createSearchToolbar() {
    const toolbar = document.createElement('div');
    toolbar.className = 'cds-cliente360-search cds-central-clientes-toolbar';

    const label = document.createElement('span');
    label.className = 'cds-central-clientes-toolbar__label';
    label.textContent = 'Pesquisar Cliente';
    toolbar.appendChild(label);

    const input = document.createElement('input');
    input.type = 'search';
    input.className = 'cds-cliente360-search__input';
    input.placeholder = 'Nome, CPF/CNPJ, telefone, código ou documento...';
    input.value = this.search;
    input.setAttribute('aria-label', 'Pesquisar Cliente');
    input.addEventListener('input', (e) => {
      clearTimeout(this.searchTimeout);
      this.searchTimeout = setTimeout(() => {
        this.search = e.target.value;
        this._renderListCards();
      }, SEARCH_DEBOUNCE_MS);
    });
    toolbar.appendChild(input);
    toolbar.appendChild(this._createFiltrosPanel());
    return toolbar;
  }

  _createListContent() {
    const wrap = document.createElement('div');
    wrap.id = 'cliente360-list-content';
    wrap.className = 'cds-cliente360-list-content';
    wrap.appendChild(Loading.create({ message: 'Carregando clientes...' }));
    return wrap;
  }

  async _loadPerfis() {
    this.loading = true;
    this._updateListContent();

    try {
      const { items, total } = await this.api.listarPerfis({
        page: this.pagination.page,
        pageSize: this.pagination.pageSize
      });
      this.perfis = (items || []).map(mapPerfilListItem);
      this.clientesOperacionais = groupPerfisByCliente(this.perfis);
      this.pagination.total = total || this.perfis.length;
      this.loading = false;
      this._updateListContent();
      this._renderListCards();
      this._enrichClientesEmBackground();
    } catch (error) {
      this.loading = false;
      this.error = error;
      this._updateListContent();
    }
  }

  async _enrichClientesEmBackground() {
    const clientes = [...this.clientesOperacionais];
    await Promise.allSettled(clientes.map(async (cliente) => {
      try {
        const situacao = await this.projectionApi.obterSituacaoCliente({ clienteId: cliente.clienteId });
        const idx = this.clientesOperacionais.findIndex((c) => c.clienteId === cliente.clienteId);
        if (idx >= 0) {
          this.clientesOperacionais[idx] = enrichClienteCard(this.clientesOperacionais[idx], situacao);
        }
      } catch (_error) {
        // mantém dados básicos do perfil
      }
    }));
    this._renderListCards();
  }

  _updateListContent() {
    const host = document.getElementById('cliente360-list-content');
    if (!host) return;
    host.innerHTML = '';
    if (this.loading) {
      host.appendChild(Loading.create({ message: 'Carregando clientes...' }));
    } else if (this.error) {
      host.appendChild(Alert.create({ message: this.error.message, variant: 'error', dismissible: true }));
    } else {
      host.appendChild(this._createListCardsHost());
    }
  }

  _createListCardsHost() {
    const wrap = document.createElement('div');
    wrap.id = 'central-clientes-cards';
    wrap.className = 'cds-central-clientes-grid';
    return wrap;
  }

  _renderListCards() {
    const host = document.getElementById('central-clientes-cards') || document.getElementById('cliente360-list-content');
    if (!host) return;

    const filtered = filtrarClientesOperacional(this.clientesOperacionais, this.search, this.filters);

    host.innerHTML = '';
    if (!filtered.length) {
      host.appendChild(EmptyState.create({
        title: 'Nenhum cliente encontrado',
        description: 'Ajuste a pesquisa ou cadastre um novo cliente'
      }));
      return;
    }

    filtered.forEach((cliente) => {
      const clienteId = Number(cliente.clienteId);
      host.appendChild(ClienteOperacionalCard.create(cliente, {
        formatCurrency: (v) => this._formatCurrency(v),
        onAbrir: (c) => {
          const id = Number(c?.clienteId || clienteId);
          if (!Number.isFinite(id) || id <= 0) {
            notify('Cliente inválido: ID não encontrado.', 'error');
            return;
          }
          navigate(`/clientes/${id}`);
        },
        onEditar: (c) => navigate(`/clientes/${Number(c?.clienteId || clienteId)}/editar`),
        onHistorico: (c) => navigate(`/clientes/${Number(c?.clienteId || clienteId)}#historico`),
        onContaCorrente: (c) => navigate(buildRouteWithCliente360Context('/conta-corrente', Number(c?.clienteId || clienteId), { clienteNome: c.nome })),
        onDesativar: (c) => this._desativarCliente(c),
        onExcluir: (c) => this._excluirCliente(c)
      }));
    });
  }

  async _desativarCliente(cliente) {
    const ok = await confirmDialog({
      title: 'Desativar cliente',
      message: `Deseja desativar as capacidades comerciais de ${cliente.nome}?`,
      confirmLabel: 'Desativar'
    });
    if (!ok) return;

    try {
      await withLoading('Desativando...', async () => {
        for (const perfil of cliente.perfis || []) {
          await this.api.atualizarPerfil(perfil.id, { ativo: false });
        }
      });
      notify('Cliente desativado.', 'success');
      await this._loadPerfis();
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  async _excluirCliente(cliente) {
    const ok = await confirmDialog({
      title: 'Excluir cliente',
      message: `Deseja excluir permanentemente ${cliente.nome}? Esta ação não pode ser desfeita.`,
      danger: true,
      confirmLabel: 'Excluir'
    });
    if (!ok) return;

    try {
      await withLoading('Excluindo...', () => fetchErp(`/clientes/${cliente.clienteId}`, { method: 'DELETE' }));
      notify('Cliente excluído.', 'success');
      await this._loadPerfis();
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  /* ===================== CENTRAL DE OPERAÇÕES DO CLIENTE ===================== */

  _getCentralOperacoesContext() {
    return {
      formatCurrency: (v) => this._formatCurrency(v),
      formatDate: (v) => this._formatDate(v),
      formatDateTime: (v) => this._formatDateTime(v),
      onVoltar: () => navigate('/clientes'),
      onDadosCliente: () => navigate(`/clientes/${this.perfil.clienteId}/editar`),
      onAtualizar: () => this._loadCentralOperacoes(),
      onProximaAcao: (acao) => this._executarAcao(acao),
      onAcaoPrincipal: (acao) => this._executarAcao(acao),
      onContaCorrente: () => this._navigateExtrato(),
      onAbrirDocumento: (doc) => {
        if (doc?.id) {
          navigate(buildRouteWithCliente360Context(`/consignacoes/${doc.id}`, this.perfil.clienteId));
        }
      }
    };
  }

  _executarAcao(acao = {}) {
    const tipo = acao.acaoTipo || acao.id;
    const consignacaoId = acao.consignacaoId;

    switch (tipo) {
      case 'nova-consignacao':
        this._novaConsignacao();
        break;
      case 'prestacao':
      case 'prestacao-destaque':
        if (consignacaoId) {
          navigate(buildRouteWithCliente360Context(`/consignacoes/${consignacaoId}/prestacao`, this.perfil.clienteId));
        } else {
          this._navigatePrestacaoContas();
        }
        break;
      case 'entrega':
      case 'entrega-destaque':
        if (consignacaoId) {
          navigate(buildRouteWithCliente360Context(`/consignacoes/${consignacaoId}/entrega`, this.perfil.clienteId));
        }
        break;
      case 'conta-corrente':
        this._navigateExtrato();
        break;
      case 'historico':
        this._scrollTo('sec-historico');
        break;
      case 'dados-cliente':
        navigate(`/clientes/${this.perfil.clienteId}/editar`);
        break;
      case 'pendencias':
        navigate(buildRouteWithCliente360Context('/pendencias', this.perfil.clienteId));
        break;
      default:
        break;
    }
  }

  _create360Content() {
    const wrap = document.createElement('div');
    wrap.className = 'cds-central-operacoes-host';
    wrap.id = 'central-operacoes-host';
    wrap.appendChild(CentralOperacoesView.renderLoading());
    return wrap;
  }

  _renderCentralOperacoes(viewModel) {
    const host = document.getElementById('central-operacoes-host');
    if (!host) return;
    host.innerHTML = '';
    host.appendChild(CentralOperacoesView.render(viewModel, this._getCentralOperacoesContext()));
    if (window.location.hash === '#historico') {
      setTimeout(() => this._scrollTo('sec-historico'), 100);
    }
  }

  /**
   * Resolve o painel a partir de `/clientes/:id`.
   * O `:id` é SEMPRE o clienteId do ERP (SSOT do nome/cadastro).
   *
   * Bug real no banco: perfil.id=3 é do Cícero, enquanto Francisco é cliente.id=3.
   * Por isso NUNCA chamar obterPerfil(routeId).
   */
  async _resolvePerfil(clienteIdRota) {
    const clienteId = Number(clienteIdRota);
    if (!Number.isFinite(clienteId) || clienteId <= 0) {
      throw new Error('Cliente não encontrado.');
    }

    // 1) ERP primeiro — identidade oficial
    const clienteErp = await fetchErp(`/clientes/${clienteId}`);
    if (!clienteErp || !clienteErp.id) {
      throw new Error('Cliente não encontrado.');
    }

    // 2) Perfis comerciais deste cliente (filtro por cliente_id, nunca por perfil.id)
    const { items } = await this.api.listarPerfis({ clienteId: Number(clienteErp.id), pageSize: 50 });
    const perfisDoCliente = (items || []).filter((p) => Number(p.clienteId) === Number(clienteErp.id));

    let perfilEscolhido = null;
    if (perfisDoCliente.length) {
      perfilEscolhido = perfisDoCliente.find((p) => {
        const tipo = String(p.perfilTipo || p.tipoPerfil || '').toUpperCase();
        return tipo.includes('CONSIGN');
      }) || perfisDoCliente[0];
    }

    // 3) Identidade SEMPRE do ERP — impede abrir Cícero ao clicar em Francisco
    return {
      ...(perfilEscolhido || {}),
      id: perfilEscolhido?.id ?? null,
      clienteId: Number(clienteErp.id),
      clienteNome: clienteErp.nome,
      cliente: {
        ...(typeof perfilEscolhido?.cliente === 'object' && perfilEscolhido.cliente
          ? perfilEscolhido.cliente
          : {}),
        id: Number(clienteErp.id),
        nome: clienteErp.nome,
        documento: clienteErp.cpf_cnpj || null,
        telefone: clienteErp.telefone || null,
        email: clienteErp.email || null,
        cidade: clienteErp.cidade || null,
        uf: clienteErp.uf || null
      },
      telefone: clienteErp.telefone || perfilEscolhido?.telefone || '',
      cpfCnpj: clienteErp.cpf_cnpj || perfilEscolhido?.cpfCnpj || '',
      perfilTipo: perfilEscolhido?.perfilTipo || null,
      status: perfilEscolhido?.status || 'ATIVO',
      bloqueado: !!perfilEscolhido?.bloqueado,
      ativo: perfilEscolhido?.ativo !== false
    };
  }

  async _loadCentralOperacoes(silent = false) {
    const host = document.getElementById('central-operacoes-host');
    if (!silent && host) {
      host.innerHTML = '';
      host.appendChild(CentralOperacoesView.renderLoading());
    }

    try {
      this.perfil = mapPerfilDetail(await this._resolvePerfil(this.routeParams.id));
      const clienteId = this.perfil.clienteId;
      const perfilId = this.perfil.id;
      const params = { clienteId, perfilComercialId: perfilId };

      const [
        perfisResult,
        situacao,
        score,
        consignacoesResult,
        pendenciasPayload,
        contaCorrente,
        saldos,
        timeline,
        historico
      ] = await Promise.all([
        this.api.listarPerfis({ clienteId, pageSize: 50 }).catch(() => ({ items: [] })),
        this.projectionApi.obterSituacaoCliente({ clienteId }).catch(() => ({})),
        perfilId
          ? this.api.obterScorePerfil(perfilId).catch(() => ({}))
          : Promise.resolve({}),
        this.api.listarConsignacoes({ clienteId }).catch(() => ({ items: [] })),
        this.projectionApi.obterProjecaoPendencias({ clienteId }).catch(() => ({})),
        this.projectionApi.obterProjecaoContaCorrente({ clienteId }).catch(() => ({})),
        this.projectionApi.obterProjecaoSaldos({ clienteId }).catch(() => ({})),
        this.projectionApi.listarTimeline({ ...params, limite: 40 }).catch(() => []),
        this.projectionApi.listarMovimentacoes({ ...params, limite: 40 }).catch(() => [])
      ]);

      const perfis = (perfisResult.items || []).map(mapPerfilListItem);
      const consignacoes = (consignacoesResult.items || []).map((c) => mapConsignacaoView(c));
      const pendenciasView = buildViewFromPayload(pendenciasPayload);
      const pendencias = buildPendenciasGrouped(pendenciasView);
      const resumo = buildResumoComercial(this.perfil, situacao, score, consignacoes, pendenciasView, timeline);

      this.payload = {
        situacao,
        score,
        consignacoes,
        contaCorrente: {
          ...contaCorrente,
          saldoAtual: contaCorrente.saldoAtual ?? contaCorrente.saldo ?? saldos.saldoEmAberto
        },
        timeline,
        historico
      };
      this.view = { pendencias };

      const viewModel = buildCentralOperacoesViewModel({
        perfil: this.perfil,
        perfis,
        situacao,
        resumo,
        contaCorrente: this.payload.contaCorrente,
        consignacoes,
        pendencias,
        historico,
        timeline
      });

      this.lastUpdated = new Date();
      this._renderCentralOperacoes(viewModel);
    } catch (error) {
      if (host) {
        host.innerHTML = '';
        host.appendChild(Alert.create({ message: error.message, variant: 'error', dismissible: true }));
      }
    }
  }


  _novaConsignacao() {
    if (!this.perfil?.clienteId) return;
    navigate(buildRouteWithCliente360Context('/consignacoes/nova', this.perfil.clienteId));
  }

  _navigatePrestacaoContas() {
    const elegiveis = (this.payload.consignacoes || []).filter((c) =>
      ['ENTREGUE', 'EM_PRESTACAO', 'ACERTADA'].includes(String(c.status || '').toUpperCase())
    );
    if (!elegiveis.length) {
      notify('Nenhuma consignação disponível para prestação de contas.', 'info');
      return;
    }

    const alvo = elegiveis.length === 1
      ? elegiveis[0]
      : null;

    if (!alvo) {
      choiceDialog({
        title: 'Fechar Consignação',
        message: 'Selecione a consignação para prestação:',
        choices: elegiveis.map((c) => ({
          label: `${c.documento || c.id} — ${c.status}`,
          value: String(c.id)
        }))
      }).then((picked) => {
        if (!picked) return;
        const consignacao = elegiveis.find((c) => String(c.id) === String(picked));
        if (consignacao) {
          navigate(buildRouteWithCliente360Context(`/consignacoes/${consignacao.id}/prestacao`, this.perfil.clienteId));
        }
      });
      return;
    }

    navigate(buildRouteWithCliente360Context(`/consignacoes/${alvo.id}/prestacao`, this.perfil.clienteId));
  }

  _navigateExtrato() {
    if (!this.perfil?.clienteId) {
      notify('Cliente não identificado para abrir o extrato.', 'info');
      return;
    }
    const nome = this.perfil.clienteNome || this.perfil.cliente || '';
    navigate(buildRouteWithCliente360Context('/conta-corrente', this.perfil.clienteId, { clienteNome: nome }));
  }

  _scrollTo(id) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  _startAutoRefresh() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = setInterval(() => {
      if (!document.getElementById('central-operacoes-host')) {
        clearInterval(this.refreshTimer);
        return;
      }
      this._loadCentralOperacoes(true);
    }, REFRESH_INTERVAL_MS);
  }

  _formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);
  }

  _formatDate(date) {
    if (!date || date === '-') return '-';
    return new Date(date).toLocaleDateString('pt-BR');
  }

  _formatDateTime(date) {
    if (!date) return '-';
    return new Date(date).toLocaleString('pt-BR');
  }
}

module.exports = PerfilComercialPage;
