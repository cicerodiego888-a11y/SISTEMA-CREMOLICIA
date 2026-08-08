/**
 * EntregaConsignacao Page — Estação de confirmação (UX-20)
 *
 * Shell: Shared UI Workspace. Checklist interno (sem muro visual).
 *
 * @module frontend/modules/motor-comercial/pages/EntregaConsignacao
 */

const Workspace = require('../../../../shared/ui/Workspace');
const Button = require('../../components/base/Button');
const Table = require('../../components/data/Table');
const Loading = require('../../components/base/Loading');
const EmptyState = require('../../components/base/EmptyState');
const Alert = require('../../components/base/Alert');
const Badge = require('../../components/base/Badge');
const theme = require('../../theme');
const MotorComercialApi = require('../../api/MotorComercialApi');
const ProjectionApi = require('../../api/ProjectionApi');
const {
  notify,
  navigate,
  confirmDialog,
  choiceDialog,
  withLoading,
  carregarConsignacaoCompleta,
  isOperadorAutorizado,
  getUsuarioId
} = require('../../utils/operacional');
const {
  solicitarLiberacaoLimite,
  carregarLiberacaoSessao,
  salvarLiberacaoSessao,
  buildFingerprintLimite,
  liberacaoCompativel
} = require('../../utils/autorizacaoGerencial');
const {
  parseNavigationContext,
  resolveBackPath,
  routeWithActiveContext,
  buildRouteWithCliente360Context,
  getBackButtonLabel
} = require('../../utils/cliente360Context');
const {
  exibirDialogoTermoEntrega,
  processarEscolhaTermo
} = require('../../services/TermoEntregaConsignacaoService');
const {
  ensureRegistered,
  RecoveryStatus,
  Operations,
  saveEntrega,
  saveAuthorization,
  loadAuthorization,
  resumeEntrega,
  completeOperacoesEntrega,
  operationalMessage
} = require('../../recovery');
const {
  ErrorMessages,
  ConfirmMessages,
  emptyState,
  notifySuccess,
  notifyError,
  notifyWarning,
  notifyRecovery,
  loadingText
} = require('../../messages');

class EntregaConsignacaoPage {
  constructor(consignacaoId, routeQuery = {}) {
    this.routeQuery = routeQuery;
    this.navigationContext = parseNavigationContext(routeQuery);
    this.api = new MotorComercialApi();
    this.projectionApi = new ProjectionApi();
    this.consignacaoId = consignacaoId;
    
    // Consignation data
    this.consignacao = null;
    this.resumoPrestacao = null;
    this.liberacaoLimiteSessao = loadAuthorization(Operations.ENTREGA, consignacaoId)
      || loadAuthorization(Operations.PREPARAR_ENTREGA, consignacaoId)
      || carregarLiberacaoSessao(consignacaoId);
    
    // Loading states
    this.loading = {
      consignacao: true,
      prestacao: true,
      delivering: false
    };
    
    // Errors
    this.error = null;
    
    // Checklist state
    this.checklist = {
      clienteValido: false,
      perfilAtivo: false,
      limiteSuficiente: false,
      documentoValido: false,
      itensCadastrados: false,
      quantidadesValidas: false,
      consignacaoRascunho: false,
      operadorAutorizado: false
    };
  }

  /**
   * Creates entrega consignação page.
   * @param {string} consignacaoId
   * @returns {HTMLElement}
   */
  static create(consignacaoId, query = {}) {
    const page = new EntregaConsignacaoPage(consignacaoId, query);
    return page.render();
  }

  /**
   * Renders the page.
   * @returns {HTMLElement}
   */
  render() {
    this.root = Workspace.create({
      variant: 'station',
      className: 'cds-entrega-workspace',
      header: this._buildWorkspaceHeader(),
      body: Workspace.Body.create({
        children: this._createContent(),
        scroll: true,
        className: 'cds-entrega-body'
      }),
      footer: this._buildWorkspaceFooter()
    });
    this.root.id = 'entrega-estacao-root';
    this.root.dataset.uxSprint = 'UX-20';
    this.root.dataset.sharedUiReference = 'entrega';
    this.root.dataset.estacaoTrabalho = 'entrega';

    setTimeout(() => this._loadData(), 0);
    return this.root;
  }

  _buildWorkspaceHeader() {
    const doc = this.consignacao?.documento || this.consignacaoId || '—';
    const cliente = this._clienteLabel();
    return Workspace.Header.create({
      title: 'Entrega',
      subtitle: 'Confirme os itens e entregue',
      context: `Documento: ${doc} · Cliente: ${cliente}`,
      onBack: () => this._handleCancel()
    });
  }

  _clienteLabel() {
    const c = this.consignacao;
    if (!c) return '—';
    const nome = c.clienteNome || c.cliente_nome || c.nome_cliente;
    if (nome) return nome;
    if (typeof c.cliente === 'string' && c.cliente && !/^\d+$/.test(c.cliente)) return c.cliente;
    if (c.cliente && typeof c.cliente === 'object') {
      return c.cliente.nome || c.cliente.razaoSocial || c.cliente.nomeFantasia || '—';
    }
    const id = c.clienteId ?? c.cliente_id;
    return id != null ? `Cliente #${id}` : '—';
  }

  _checklistLabels() {
    return [
      { key: 'clienteValido', label: 'Cliente válido' },
      { key: 'perfilAtivo', label: 'Cliente habilitado' },
      { key: 'limiteSuficiente', label: 'Limite suficiente' },
      { key: 'documentoValido', label: 'Documento válido' },
      { key: 'itensCadastrados', label: 'Itens cadastrados' },
      { key: 'quantidadesValidas', label: 'Quantidades válidas' },
      { key: 'consignacaoRascunho', label: 'Consignação em RASCUNHO' },
      { key: 'operadorAutorizado', label: 'Operador autorizado' }
    ];
  }

  _pendenciasEntrega() {
    return this._checklistLabels().filter((item) => !this.checklist[item.key]);
  }

  _podeEditarRascunho() {
    const st = String(this.consignacao?.status || '').toUpperCase();
    return st === 'RASCUNHO' && !!this.consignacaoId;
  }

  _abrirRascunhoParaRevisar() {
    if (!this.consignacaoId) return;
    const path = `/consignacoes/nova?consignacaoId=${this.consignacaoId}`;
    const clienteId = this.navigationContext?.clienteId || this.consignacao?.clienteId;
    if (clienteId) {
      navigate(buildRouteWithCliente360Context(path, clienteId, {
        origem: this.navigationContext?.origem || 'central'
      }));
      return;
    }
    navigate(routeWithActiveContext(path, this.navigationContext));
  }

  /**
   * Creates content based on loading state.
   * @private
   */
  _createContent() {
    const container = document.createElement('div');
    container.className = 'cds-entrega-content';
    container.id = 'entrega-content';

    if (this.loading.consignacao || this.loading.prestacao) {
      container.appendChild(Loading.create({ message: loadingText('CARREGANDO_CONSIGNACAO') }));
      return container;
    }

    if (this.error) {
      container.appendChild(Alert.create({
        message: this.error.message || operationalMessage(this.error, { context: 'entrega' }),
        variant: 'error',
        dismissible: true
      }));
      return container;
    }

    if (!this.consignacao) {
      container.appendChild(EmptyState.create(emptyState('PRESTACAO_NAO_ENCONTRADA')));
      return container;
    }

    container.appendChild(this._createIdentityLine());
    container.appendChild(this._createStatusBanner());
    container.appendChild(this._createChecklistSection());
    container.appendChild(this._createItemsSection());

    return container;
  }

  _createIdentityLine() {
    const wrap = document.createElement('div');
    wrap.className = 'cds-entrega-identity';
    const totalValue = (this.consignacao.itens || []).reduce(
      (sum, item) => sum + (this._itemQuantidade(item) * this._itemPreco(item)),
      0
    );
    wrap.innerHTML = `
      <span>Itens: <strong>${(this.consignacao.itens || []).length}</strong></span>
      <span>Total: <strong>${this._formatCurrency(totalValue)}</strong></span>
      <span>Status: <strong>${this.consignacao.status || '—'}</strong></span>
    `;
    return wrap;
  }

  _createStatusBanner() {
    const banner = document.createElement('div');
    const ready = this._canDeliver() && !this._precisaLiberacaoLimite();
    banner.className = `cds-entrega-status-banner ${ready ? 'cds-entrega-status-banner--ok' : 'cds-entrega-status-banner--block'}`;

    if (ready) {
      banner.textContent = 'Pronto para entregar';
      return banner;
    }

    if (this._precisaLiberacaoLimite()) {
      banner.textContent = 'Liberação de limite necessária antes de entregar';
      return banner;
    }

    const pending = this._pendenciasEntrega();
    const title = document.createElement('div');
    title.className = 'cds-entrega-status-banner__title';
    title.textContent = 'Revise os dados — há pendências para liberar a entrega';
    banner.appendChild(title);

    if (pending.length) {
      const list = document.createElement('ul');
      list.className = 'cds-entrega-status-banner__list';
      pending.forEach((p) => {
        const li = document.createElement('li');
        li.textContent = p.label;
        list.appendChild(li);
      });
      banner.appendChild(list);
    }

    if (this._podeEditarRascunho()) {
      const hint = document.createElement('p');
      hint.className = 'cds-entrega-status-banner__hint';
      hint.textContent = this.checklist.itensCadastrados
        ? 'Abra o rascunho para corrigir os dados e voltar à entrega.'
        : 'Esta consignação ainda não tem itens. Abra o rascunho para incluir produtos.';
      banner.appendChild(hint);

      const actions = document.createElement('div');
      actions.className = 'cds-entrega-status-banner__actions';
      actions.appendChild(Button.create({
        text: this.checklist.itensCadastrados ? 'Abrir rascunho' : 'Incluir itens no rascunho',
        variant: 'secondary',
        onClick: () => this._abrirRascunhoParaRevisar()
      }));
      banner.appendChild(actions);
    }

    return banner;
  }

  _createHeader() {
    return this._buildWorkspaceHeader();
  }

  /**
   * Creates consignation details.
   * @private
   */
  _createConsignacaoDetails() {
    const card = Card.create({
      title: 'Dados da Consignação',
      content: this._createConsignacaoDetailsContent()
    });
    return card;
  }

  /**
   * Creates consignation details content.
   * @private
   */
  _createConsignacaoDetailsContent() {
    const container = document.createElement('div');
    container.className = 'cds-entrega-details';

    const fields = [
      { label: 'Documento', value: this.consignacao.documento },
      { label: 'Cliente', value: this.consignacao.cliente },
      { label: 'Consignado', value: this.consignacao.consignado },
      { label: 'Empresa', value: this.consignacao.empresa },
      { label: 'Filial', value: this.consignacao.filial },
      { label: 'Data', value: this._formatDate(this.consignacao.data) },
      { label: 'Status', value: Badge.createStatus(this.consignacao.status) },
      { label: 'Usuário', value: this.consignacao.usuario }
    ];

    fields.forEach(field => {
      const fieldEl = document.createElement('div');
      fieldEl.className = 'cds-entrega-details__field';
      fieldEl.innerHTML = `
        <label>${field.label}</label>
        <div>${field.value instanceof HTMLElement ? field.value.outerHTML : field.value}</div>
      `;
      container.appendChild(fieldEl);
    });

    return container;
  }

  _itemQuantidade(item) {
    const q = Number(item?.quantidade ?? item?.quantidadeEntregue ?? 0);
    return Number.isFinite(q) ? q : 0;
  }

  _itemPreco(item) {
    const p = Number(item?.preco ?? item?.precoUnitario ?? 0);
    return Number.isFinite(p) ? p : 0;
  }

  /**
   * Creates summary section.
   * @private
   */
  _createSummarySection() {
    const container = document.createElement('div');
    container.className = 'cds-entrega-summary';

    const totalValue = (this.consignacao.itens || []).reduce(
      (sum, item) => sum + (this._itemQuantidade(item) * this._itemPreco(item)),
      0
    );
    const limiteDisponivel = this.resumoPrestacao?.limiteDisponivel || 0;

    const statCards = [
      StatCard.create({
        title: 'Quantidade de Itens',
        value: (this.consignacao.itens || []).length,
        icon: '📦'
      }),
      StatCard.create({
        title: 'Valor Total',
        value: this._formatCurrency(Number.isFinite(totalValue) ? totalValue : 0),
        icon: '💰'
      }),
      StatCard.create({
        title: 'Limite Disponível',
        value: this._formatCurrency(limiteDisponivel || this.consignacao.limite || 0),
        icon: '📊'
      }),
      StatCard.create({
        title: 'Saldo em Aberto',
        value: this._formatCurrency(this.resumoPrestacao?.saldoAtual ?? 0),
        icon: '💳'
      })
    ];

    statCards.forEach(card => container.appendChild(card));

    return container;
  }

  /**
   * Creates operational checklist.
   * @private
   */
  _createChecklistSection() {
    const container = document.createElement('div');
    container.className = 'cds-entrega-checklist';

    const title = document.createElement('h3');
    title.className = 'cds-entrega-checklist__title';
    title.textContent = 'Lista de verificação operacional';
    container.appendChild(title);

    const checklistItems = this._checklistLabels();

    const checklistContainer = document.createElement('div');
    checklistContainer.className = 'cds-entrega-checklist__items';

    checklistItems.forEach(item => {
      const itemEl = document.createElement('div');
      itemEl.className = `cds-entrega-checklist__item ${this.checklist[item.key] ? 'cds-entrega-checklist__item--valid' : 'cds-entrega-checklist__item--invalid'}`;
      
      const icon = document.createElement('span');
      icon.className = 'cds-entrega-checklist__icon';
      icon.textContent = this.checklist[item.key] ? '✓' : '✗';
      itemEl.appendChild(icon);

      const label = document.createElement('span');
      label.className = 'cds-entrega-checklist__label';
      label.textContent = item.label;
      itemEl.appendChild(label);

      checklistContainer.appendChild(itemEl);
    });

    container.appendChild(checklistContainer);

    return container;
  }

  /**
   * Creates items section.
   * @private
   */
  _createItemsSection() {
    const container = document.createElement('div');
    container.className = 'cds-entrega-items';

    const title = document.createElement('h3');
    title.className = 'cds-entrega-items__title';
    title.textContent = 'Itens da Consignação';
    container.appendChild(title);

    const columns = [
      { key: 'produto', label: 'Produto' },
      { key: 'quantidade', label: 'Quantidade' },
      { key: 'unidade', label: 'Unidade' },
      { key: 'preco', label: 'Preço' },
      { key: 'valor', label: 'Valor' },
      { key: 'observacao', label: 'Observação' },
      { key: 'status', label: 'Status' }
    ];

    const data = (this.consignacao.itens || []).map(item => {
      const qtd = this._itemQuantidade(item);
      const preco = this._itemPreco(item);
      return {
        produto: item.produto || item.produtoNome || `Produto #${item.produtoId}`,
        quantidade: qtd,
        unidade: item.unidade || 'UN',
        preco: this._formatCurrency(preco),
        valor: this._formatCurrency(qtd * preco),
        observacao: item.observacao || '-',
        status: Badge.createStatus(item.status || 'ATIVO')
      };
    });

    const table = Table.create({ columns, data });
    container.appendChild(table);

    return container;
  }

  /**
   * Creates impact panel.
   * @private
   */
  _createImpactPanel() {
    const container = document.createElement('div');
    container.className = 'cds-entrega-impact';

    const title = document.createElement('h3');
    title.className = 'cds-entrega-impact__title';
    title.textContent = 'Impacto da Operação';
    container.appendChild(title);

    const description = document.createElement('p');
    description.className = 'cds-entrega-impact__description';
    description.textContent = 'Após a entrega, as seguintes ações serão executadas:';
    container.appendChild(description);

    const impacts = [
      'O estoque será atualizado.',
      'O limite comercial será consumido.',
      'A consignação passará para entregue.',
      'Você poderá fechar o atendimento em seguida.'
    ];

    const impactsList = document.createElement('ul');
    impactsList.className = 'cds-entrega-impact__list';

    impacts.forEach(impact => {
      const li = document.createElement('li');
      li.textContent = impact;
      impactsList.appendChild(li);
    });

    container.appendChild(impactsList);

    return container;
  }

  /**
   * Creates footer with delivery button.
   * @private
   */
  _buildWorkspaceFooter() {
    return Workspace.Footer.create({
      left: [
        Button.create({
          text: getBackButtonLabel(this.navigationContext, 'Voltar'),
          variant: 'ghost',
          onClick: () => this._handleCancel()
        })
      ],
      right: this._footerRightNodes()
    });
  }

  _footerRightNodes() {
    const nodes = [];
    const canDeliver = this._canDeliver();
    const needsLiberacao = this._precisaLiberacaoLimite();

    if (this._podeEditarRascunho() && !canDeliver) {
      nodes.push(Button.create({
        text: this.checklist.itensCadastrados ? 'Revisar rascunho' : 'Incluir itens no rascunho',
        variant: 'secondary',
        onClick: () => this._abrirRascunhoParaRevisar()
      }));
    }

    if (needsLiberacao) {
      nodes.push(Button.create({
        text: 'Entregar',
        variant: 'primary',
        disabled: true,
        onClick: () => {}
      }));
      nodes.push(Button.create({
        text: 'Solicitar Liberação',
        variant: 'secondary',
        disabled: this.loading.delivering,
        onClick: () => this._solicitarLiberacaoLimite()
      }));
    } else {
      nodes.push(Button.create({
        text: this.loading.delivering ? 'Processando...' : 'Entregar',
        variant: 'primary',
        disabled: !canDeliver || this.loading.delivering,
        onClick: () => this._handleDelivery()
      }));
    }
    return nodes;
  }

  _createFooter() {
    return this._buildWorkspaceFooter();
  }

  /**
   * Loads data from API.
   * @private
   */
  async _loadData() {
    this.loading.consignacao = true;
    this.loading.prestacao = true;
    this.error = null;
    this._updateContent();

    try {
      ensureRegistered();
      const helpers = { api: this.api, projectionApi: this.projectionApi };

      // Recovery é best-effort (auth/checkpoint). Consignação recém-criada
      // deve abrir pela API — não bloquear nem alarmar se não houver operação retomável.
      let recovered = null;
      try {
        recovered = await resumeEntrega(this.consignacaoId, helpers);
      } catch (_resumeError) {
        recovered = null;
      }

      const auth = loadAuthorization(Operations.ENTREGA, this.consignacaoId)
        || loadAuthorization(Operations.PREPARAR_ENTREGA, this.consignacaoId)
        || (recovered?.context && typeof recovered.context.toLiberacaoCompat === 'function'
          ? recovered.context.toLiberacaoCompat()
          : null);
      if (auth) {
        this.liberacaoLimiteSessao = auth;
      }

      const [consignacao, resumo] = await Promise.all([
        carregarConsignacaoCompleta(this.api, this.projectionApi, this.consignacaoId),
        this.projectionApi.obterResumoPrestacao({ consignacaoId: this.consignacaoId }).catch(() => null)
      ]);

      this.consignacao = consignacao;
      this.resumoPrestacao = resumo;

      // Só avisa recovery se a API também não trouxe itens e o checkpoint está vazio
      if (
        recovered?.error
        && !(consignacao?.itens?.length)
        && !recovered.state?.checkpoint?.itens?.length
      ) {
        notifyRecovery(
          recovered.error.operationalMessage
          || operationalMessage(recovered.error, { context: 'entrega' })
        );
      }

      saveEntrega(this.consignacaoId, {
        itens: (consignacao.itens || []).map((item) => ({ ...item })),
        statusConsignacao: consignacao.status,
        clienteId: consignacao.clienteId
      }, RecoveryStatus.AGUARDANDO_CONFIRMACAO);

      this._updateChecklist();
      this.loading.consignacao = false;
      this.loading.prestacao = false;
      this._updateContent();
    } catch (error) {
      this.loading.consignacao = false;
      this.loading.prestacao = false;
      this.error = {
        message: operationalMessage(error, { context: 'entrega' }) || ErrorMessages.ENTREGA_CARREGAR,
        technical: String(error && error.message || error || '')
      };
      this._updateContent();
    }
  }

  /**
   * Updates checklist based on data.
   * @private
   */
  _updateChecklist() {
    if (!this.consignacao) return;

    this.checklist.clienteValido = !!this.consignacao.clienteId;
    this.checklist.perfilAtivo = this.consignacao.perfilStatus === 'ATIVO';
    this.checklist.documentoValido = !!this.consignacao.documento && this.consignacao.documento !== '-';
    const itens = this.consignacao.itens || [];
    this.checklist.itensCadastrados = itens.length > 0;
    this.checklist.quantidadesValidas = itens.every((item) => this._itemQuantidade(item) > 0);
    this.checklist.consignacaoRascunho = this.consignacao.status === 'RASCUNHO';
    this.checklist.operadorAutorizado = isOperadorAutorizado();

    const totalValue = itens.reduce((sum, item) => sum + (this._itemQuantidade(item) * this._itemPreco(item)), 0);
    const limiteDisponivel = Number(
      this.resumoPrestacao?.limiteDisponivel
      ?? this.consignacao?.limite
      ?? 0
    );
    const fingerprint = buildFingerprintLimite({
      clienteId: this.consignacao?.clienteId,
      valorEntrega: totalValue,
      creditoDisponivel: limiteDisponivel
    });
    const liberacao = this.liberacaoLimiteSessao;
    const liberacaoMesmaOperacao = Boolean(
      liberacao?.autorizado
      && String(liberacao.consignacaoId || '') === String(this.consignacaoId)
      && (!liberacao.expiresAt || new Date(liberacao.expiresAt).getTime() >= Date.now())
    );
    const liberacaoOk = liberacaoCompativel(liberacao, fingerprint) || liberacaoMesmaOperacao;
    this.checklist.limiteSuficiente = limiteDisponivel <= 0 || totalValue <= limiteDisponivel || liberacaoOk;
  }

  _precisaLiberacaoLimite() {
    if (!this.consignacao) return false;
    const itens = this.consignacao.itens || [];
    const totalValue = itens.reduce((sum, item) => sum + (this._itemQuantidade(item) * this._itemPreco(item)), 0);
    const limiteDisponivel = Number(
      this.resumoPrestacao?.limiteDisponivel
      ?? this.consignacao?.limite
      ?? 0
    );
    if (limiteDisponivel <= 0 || totalValue <= limiteDisponivel) return false;
    return !this.checklist.limiteSuficiente;
  }

  async _solicitarLiberacaoLimite() {
    const itens = this.consignacao?.itens || [];
    const totalValue = itens.reduce((sum, item) => sum + (this._itemQuantidade(item) * this._itemPreco(item)), 0);
    const limiteDisponivel = Number(
      this.resumoPrestacao?.limiteDisponivel
      ?? this.consignacao?.limite
      ?? 0
    );
    const fingerprint = buildFingerprintLimite({
      clienteId: this.consignacao?.clienteId,
      valorEntrega: totalValue,
      creditoDisponivel: limiteDisponivel
    });

    const liberacao = await solicitarLiberacaoLimite({
      clienteId: this.consignacao?.clienteId,
      clienteNome: this.consignacao?.clienteNome,
      consignacaoId: this.consignacaoId,
      valorEntrega: totalValue,
      creditoDisponivel: limiteDisponivel,
      valorExcedido: Math.max(0, totalValue - limiteDisponivel),
      fingerprint
    }, (payload) => this.api.registrarAutorizacaoGerencial(payload));

    if (!liberacao) return;
    this.liberacaoLimiteSessao = liberacao;
    saveAuthorization(Operations.ENTREGA, this.consignacaoId, liberacao);
    saveAuthorization(Operations.PREPARAR_ENTREGA, this.consignacaoId, liberacao);
    salvarLiberacaoSessao(this.consignacaoId, liberacao);
    this._updateChecklist();
    this._updateContent();
  }

  /**
   * Checks if delivery is allowed.
   * @private
   */
  _canDeliver() {
    return Object.values(this.checklist).every(value => value === true);
  }

  /**
   * Updates content area.
   * @private
   */
  _updateContent() {
    const host = document.getElementById('entrega-content')
      || this.root?.querySelector('.cds-entrega-content');
    if (host && host.parentNode) {
      host.replaceWith(this._createContent());
    }
    if (this.root) {
      Workspace.compose(this.root, {
        header: this._buildWorkspaceHeader()
      });
    }
    this._updateFooter();
  }

  _updateFooter() {
    if (!this.root) return;
    Workspace.compose(this.root, {
      footer: this._buildWorkspaceFooter()
    });
  }

  /**
   * Handles delivery.
   * @private
   */
  async _handleDelivery() {
    if (!this._canDeliver()) {
      notifyWarning('ENTREGA_CHECKLIST');
      return;
    }

    const confirmed = await confirmDialog(ConfirmMessages.CONFIRMAR_ENTREGA);
    if (!confirmed) return;

    this.loading.delivering = true;
    this._updateFooter();

    try {
      await withLoading(loadingText('REGISTRANDO_ENTREGA'), () => this.api.entregarConsignacao(this.consignacaoId, {
        observacao: 'Entrega confirmada via ERP',
        usuarioId: getUsuarioId(),
        liberacaoGerencial: this.liberacaoLimiteSessao || null,
        supervisorToken: this.liberacaoLimiteSessao?.supervisorToken || null
      }));

      completeOperacoesEntrega(this.consignacaoId);
      this.loading.delivering = false;
      this._updateFooter();
      notifySuccess('ENTREGA_REGISTRADA');
      await this._showSuccessDialog();
    } catch (error) {
      this.loading.delivering = false;
      this._updateFooter();

      // Pós-commit (outbox/eventos) pode falhar depois do domínio já gravar ENTREGUE.
      const jaEntregue = await this._verificarEntregaJaPersistida();
      if (jaEntregue) {
        completeOperacoesEntrega(this.consignacaoId);
        notifyRecovery('ENTREGA_OK_EVENTOS_FALHOU');
        await this._showSuccessDialog();
        return;
      }

      notifyError('ENTREGA_REGISTRAR', error);
    }
  }

  /**
   * Confirma no servidor se a entrega já foi commitada apesar de erro HTTP.
   * @private
   * @returns {Promise<boolean>}
   */
  async _verificarEntregaJaPersistida() {
    try {
      const atual = await this.api.obterConsignacao(this.consignacaoId);
      const status = String(atual?.status || '').toUpperCase();
      if (status === 'ENTREGUE') {
        this.consignacao = { ...this.consignacao, ...atual };
        return true;
      }
    } catch (_reloadError) {
      // ignora — mantém o erro original da entrega
    }
    return false;
  }

  async _showSuccessDialog() {
    // RCM-04.4 — abre Resumo Inteligente (Motor de Comprovantes)
    await navigate(routeWithActiveContext(
      `/consignacoes/${this.consignacaoId}/comprovante`,
      this.navigationContext
    ));
  }

  async _handleCancel() {
    const backLabel = this.navigationContext.locked ? 'a Central do Cliente' : 'a Central de Consignações';
    const confirmed = await confirmDialog({
      ...ConfirmMessages.CANCELAR_ENTREGA,
      message: `Deseja cancelar a entrega e voltar para ${backLabel}?`
    });
    if (confirmed) {
      await navigate(resolveBackPath(this.navigationContext, '/consignacoes'));
    }
  }

  /**
   * Gets friendly error message.
   * @private
   */
  _getFriendlyErrorMessage(error) {
    return operationalMessage(error, { context: 'entrega' }) || ErrorMessages.ENTREGA_REGISTRAR;
  }

  /**
   * Generates correlation ID.
   * @private
   */
  _generateCorrelationId() {
    return 'corr-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  }

  /**
   * Generates request ID.
   * @private
   */
  _generateRequestId() {
    return 'req-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  }

  /**
   * Formats currency.
   * @private
   */
  _formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(value);
  }

  /**
   * Formats date.
   * @private
   */
  _formatDate(date) {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('pt-BR');
  }
}

module.exports = EntregaConsignacaoPage;
