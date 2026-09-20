/**
 * Prestação de Contas — Estação de Trabalho (UX-12)
 *
 * Shell: Shared UI Workspace. Grade STAB-04 intacta.
 *
 * @module frontend/modules/motor-comercial/pages/PrestacaoContas
 */

const Workspace = require('../../../../shared/ui/Workspace');
const Button = require('../../components/base/Button');
const Loading = require('../../components/base/Loading');
const EmptyState = require('../../components/base/EmptyState');
const Alert = require('../../components/base/Alert');
const MotorComercialApi = require('../../api/MotorComercialApi');
const ProjectionApi = require('../../api/ProjectionApi');
const FecharConsignacaoView = require('./FecharConsignacaoView');
const {
  MOMENTOS_FECHAMENTO,
  STEP_RETORNOS,
  STEP_RESUMO,
  STEP_ENCERRAMENTO,
  inicializarMomentos,
  buildPainelLateral,
  calcularValorEntregue,
  buildItensFromMovimentacoes,
  mapItensCacheParaPrestacao,
  normalizarMovimentacoes,
  consignacaoElegivelParaPrestacao,
  CAMPOS_RETORNO_ORDEM,
  calcularSaldoItem,
  enriquecerItensPrestacao,
  mapItemConsignacao,
  syncStatusOperacional,
  buildPayloadOperacao,
  validarPayloadOperacao,
  proximoCampoRetorno,
  buildPainelLateralPreview,
  seletorLinhaRetorno,
  LINHA_RETORNO_SELECTOR,
  formatCurrency,
  buildResumoFinalOficial
} = require('./fecharConsignacaoMappers');
const {
  buildPrestacaoSnapshot,
  buildPagamentosHistorico,
  buildFinanceiroFromResumo
} = require('./prestacaoFinanceiroSnapshot');
const {
  buildTimelineOficial,
  renderTimelineElement,
  resolverEstadoPrestacao,
  labelEstadoPrestacao,
  resolverSituacaoFiscal,
  SITUACAO_FISCAL,
  mensagemNfceResultado,
  registrarLogEncerramento,
  labelSituacaoFinanceiraOficial
} = require('./prestacaoOperacionalConsolidacao');
const {
  MENSAGENS_HARDENING,
  safeText,
  humanizarErroOperacional,
  motivoBotaoDesabilitado,
  aplicarTooltipDesabilitado,
  auditarFinalRC1,
  registrarLogOperacional
} = require('./prestacaoHardening');
const { formatDocumento } = require('../../api/helpers');
const {
  cloneBaseline,
  aplicarValorState,
  temAlteracoesPendentes,
  limparDirtyTodos,
  listarPendenciasFromBaseline,
  mesclarServidorPreservandoDirty,
  statusPersistencia,
  labelStatusPersistencia,
  CAMPOS_QTY
} = require('./gradeConsistencia');
const { buildResumoFinanceiroCentral: buildResumoLegacy } = require('./prestacaoCentralMappers');
const {
  imprimirComprovante,
  visualizarComprovante,
  exportarComprovantePdf,
  abrirComprovantePrestacao
} = require('../../services/ComprovanteFechamentoService');
const {
  notify,
  navigate,
  confirmDialog,
  withLoading,
  isOperadorAutorizado,
  getUsuarioId,
  carregarConsignacaoCompleta,
  obterItensCacheConsignacao,
  buscarClientePorIdErp
} = require('../../utils/operacional');
const {
  parseNavigationContext,
  buildRouteWithCliente360Context,
  buildRouteWithCentralTrabalhoContext,
  resolveBackPath,
  getBackButtonLabel,
  routeWithActiveContext,
  ORIGEM_CENTRAL_TRABALHO,
  ORIGEM_CLIENTE_360
} = require('../../utils/cliente360Context');
const {
  podeAdicionarProdutoComplementar
} = require('../EntregaComplementar/entregaComplementarMappers');
const {
  markCentralArrivalGuard,
  logElectronFlow
} = require('../../utils/electronNavigationGuard');
const gradeForense = require('./gradeForenseAudit');
const {
  createOperacaoContext,
  captureContextToken,
  isContextCurrent,
  bumpOperacaoContext,
  patchOperacaoContext
} = require('./prestacaoOperacaoContext');

class PrestacaoContasPage {
  constructor(consignacaoId, routeQuery = {}) {
    this.routeQuery = routeQuery;
    this.navigationContext = parseNavigationContext(routeQuery);
    this.api = new MotorComercialApi();
    this.projectionApi = new ProjectionApi();
    this.consignacaoId = consignacaoId;
    /** RCM-8.6 — contexto imutável da operação aberta (cliente/consignação/prestação). */
    this._disposed = false;
    this._loadTimeout = null;
    this.operacaoContext = createOperacaoContext({
      clienteId: this.navigationContext?.clienteId || null,
      consignacaoId,
      prestacaoId: routeQuery?.prestacaoId || routeQuery?.grupoPrestacaoContasId || null,
      contextVersion: 1
    });

    this.consignacao = null;
    this.resumoPrestacao = null;
    this.historico = null;
    this.contaCorrente = null;
    this.painel = {};
    this.snapshot = {
      financeiro: null,
      itens: [],
      fiscal: null,
      vendaOficial: null,
      statusOperacional: null,
      pagamentos: [],
      timeline: [],
      logOperacional: [],
      auditoria: null
    };
    /** Log de sessão (UX) — últimas ações nesta estação. */
    this.logOperacionalSessao = [];
    this.faturamento = null;
    this.rateioPerda = null;
    this._ultimaFalhaEmitir = null;
    this._emitindoNfce = false;
    this.proximoAtendimento = null;
    this.clienteDetalhe = null;
    this.dataEncerramento = null;

    this.steps = inicializarMomentos(false);
    this.currentStep = STEP_RETORNOS;
    this.encerrado = false;

    /** Rascunho do formulário — NÃO é fonte financeira (STAB-07.1). */
    this.pagamentoDraft = {
      valor: '',
      formaPagamento: 'DINHEIRO',
      observacoes: ''
    };
    this.pagamentoErro = null;
    /** STAB-07.5 — UI da grade (busca/página) — não é SSOT. */
    this.retornosUi = {
      busca: '',
      page: 1,
      pageSize: 10,
      filtro: 'TODOS',
      colunaPreset: 'ALL',
      colunas: {
        entregue: true,
        vendido: true,
        devolvido: true,
        perdido: true,
        cortesia: true,
        saldo: true,
        observacao: true,
        status: true
      }
    };

    this.loading = {
      consignacao: true,
      prestacao: true,
      operation: false
    };
    this.error = null;
    this.refreshTimer = null;
    this.prestacaoPronta = false;
    this.editing = { rowIndex: -1, campo: null, originalValue: null };
    this.focus = { rowIndex: -1, campo: null };
    this.lineStatus = {};
    this.linhasComErro = {};
    this.conferenciaAlerta = null;
    this.salvandoConferencia = false;
    this._skipNextBlur = false;
    this._restaurarFoco = null;
    this._rascunhoRetornosSnapshot = null;
    this._gradeBaseline = [];
    this.persistenciaStatus = 'saved';
    this.root = null;
    this.lastSyncedAt = null;
    this._startedAtRetornos = false;
  }

  static create(consignacaoId, query = {}) {
    const page = new PrestacaoContasPage(consignacaoId, query);
    return page.render();
  }

  render() {
    this._disposed = false;
    this.root = Workspace.create({
      variant: 'station',
      className: 'cds-prestacao-estacao-workspace',
      header: this._buildWorkspaceHeader(),
      body: Workspace.Body.create({
        children: this._createContentShell(),
        scroll: false,
        className: 'cds-prestacao-estacao__body cds-prestacao-estacao__body--fill'
      }),
      footer: this._buildWorkspaceFooter()
    });
    this.root.id = 'prestacao-estacao-root';
    this.root.dataset.uxSprint = 'STAB-07.5';
    this.root.dataset.sharedUiReference = 'prestacao-estacao';
    this.root.dataset.estacaoTrabalho = 'prestacao';
    this.root.dataset.pageDestroyable = 'true';
    this.root.dataset.consignacaoId = String(this.consignacaoId || '');
    this.root.dataset.contextVersion = String(this.operacaoContext.contextVersion);
    this.root.__cdsPageInstance = this;

    this._loadTimeout = setTimeout(() => {
      this._loadTimeout = null;
      if (!this._isAlive()) return;
      this._loadData();
      this._startAutoRefresh();
    }, 0);

    return this.root;
  }

  /**
   * RCM-8.6 — encerra timers/listeners e invalida o contexto da operação.
   * Chamado pelo Router ao desmontar a página.
   */
  destroy() {
    if (this._disposed) return;
    this._disposed = true;
    if (this._loadTimeout) {
      clearTimeout(this._loadTimeout);
      this._loadTimeout = null;
    }
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.operacaoContext = bumpOperacaoContext(this.operacaoContext);
    if (this.root) {
      try {
        delete this.root.__cdsPageInstance;
      } catch (_e) {
        this.root.__cdsPageInstance = null;
      }
    }
  }

  /** @private */
  _isAlive() {
    return !this._disposed && Boolean(this.root);
  }

  /** @private — token da requisição atual */
  _captureContextToken() {
    return captureContextToken(this.operacaoContext);
  }

  /**
   * @private
   * Aceita resposta somente se a tela ainda estiver montada e no mesmo contexto.
   */
  _acceptContextToken(token) {
    if (!this._isAlive()) return false;
    if (this.root && this.root.isConnected === false) {
      this.destroy();
      return false;
    }
    return isContextCurrent(token, this.operacaoContext, { disposed: this._disposed });
  }

  /** @private — sincroniza prestacaoId/clienteId sem invalidar a versão */
  _syncOperacaoContextFromConsignacao(consignacao = {}) {
    const prestacaoId = consignacao?.prestacaoContasAtiva?.id
      || consignacao?.grupoPrestacaoContasId
      || this.operacaoContext?.prestacaoId
      || null;
    const clienteId = consignacao?.clienteId
      || this.navigationContext?.clienteId
      || this.operacaoContext?.clienteId
      || null;
    this.operacaoContext = patchOperacaoContext(this.operacaoContext, {
      consignacaoId: this.consignacaoId,
      clienteId,
      prestacaoId
    });
    if (this.root) {
      this.root.dataset.contextVersion = String(this.operacaoContext.contextVersion);
      if (clienteId != null) this.root.dataset.clienteId = String(clienteId);
      if (prestacaoId != null) this.root.dataset.prestacaoId = String(prestacaoId);
    }
  }

  /** @private — queries escopadas ao root da operação (evita IDs globais de outra tela) */
  _qs(selector) {
    if (!this.root) return null;
    if (this.root.matches?.(selector)) return this.root;
    return this.root.querySelector(selector);
  }

  _buildWorkspaceHeader() {
    return Workspace.Header.create({
      title: 'Prestação de Contas',
      subtitle: this._momentoLabel(),
      context: this._headerContextNode(),
      status: this._headerStatusNode(),
      onBack: () => this._handleCancel()
    });
  }

  _headerContextNode() {
    const wrap = document.createElement('div');
    wrap.className = 'cds-prestacao-estacao__context';
    wrap.id = 'prestacao-estacao-context';
    wrap.innerHTML = `
      <span>Cliente: <strong id="prestacao-cliente">—</strong></span>
      <span>Prestação: <strong id="prestacao-grupo">—</strong></span>
      <span>Consignações: <strong id="prestacao-qtd-consig">—</strong></span>
      <span>Origem: <strong id="prestacao-documento">—</strong></span>
      <span>Estado: <strong id="prestacao-situacao">—</strong></span>
      <span>Financeiro: <strong id="prestacao-financeiro">—</strong></span>
      <span>Fiscal: <strong id="prestacao-fiscal">—</strong></span>
      <span id="prestacao-synced" class="cds-caption"></span>
    `;
    return wrap;
  }

  _headerStatusNode() {
    const el = document.createElement('span');
    el.id = 'prestacao-persistencia';
    el.className = 'cds-prestacao-estacao__persistencia';
    el.textContent = labelStatusPersistencia(this.persistenciaStatus);
    return el;
  }

  _momentoLabel() {
    if (this.encerrado) return 'Atendimento concluído';
    return MOMENTOS_FECHAMENTO[this.currentStep]?.label || 'Estação de trabalho';
  }

  _createContentShell() {
    const shell = document.createElement('div');
    shell.className = 'cds-fechar-consignacao__conteudo cds-prestacao-estacao__conteudo';
    shell.id = 'fechar-consignacao-content';

    if (this.loading.consignacao || this.loading.prestacao) {
      shell.appendChild(Loading.create({ message: 'Carregando atendimento...' }));
    } else if (this.error) {
      shell.appendChild(Alert.create({
        message: 'Erro ao carregar: ' + this.error.message,
        variant: 'error',
        dismissible: true
      }));
    } else if (!this.consignacao) {
      shell.appendChild(EmptyState.create({
        title: 'Consignação não encontrada',
        description: 'O documento solicitado não existe'
      }));
    } else {
      // STAB-07.2 — timeline fica na coluna direita do Resumo (sem duplicar)
      if (this.currentStep !== STEP_RESUMO) {
        shell.appendChild(this._renderTimelineBar());
      }
      shell.appendChild(this._renderMomentoAtual());
    }

    return shell;
  }

  _pushLogOperacional(acao, detalhes = {}) {
    this.logOperacionalSessao.unshift({
      em: new Date().toISOString(),
      acao,
      detalhes
    });
    if (this.logOperacionalSessao.length > 20) {
      this.logOperacionalSessao.length = 20;
    }
  }

  /** Mapeia steps STAB-07.1 → marcadores legados da timeline informativa. */
  _timelineStepMarker() {
    if (this.encerrado || this.currentStep >= STEP_ENCERRAMENTO) return 4;
    if (this.currentStep >= STEP_RESUMO) return 3;
    return 1;
  }

  _renderTimelineBar() {
    const financeiro = this.snapshot?.financeiro || this._syncSnapshotFinanceiro();
    const timeline = buildTimelineOficial({
      consignacao: this.consignacao || {},
      financeiro,
      faturamento: this.faturamento,
      encerrado: this.encerrado,
      emitindoNfce: Boolean(this._emitindoNfce),
      currentStep: this._timelineStepMarker()
    });
    return renderTimelineElement(timeline);
  }

  _estadoOperacionalAtual() {
    return resolverEstadoPrestacao({
      encerrado: this.encerrado,
      emitindoNfce: Boolean(this._emitindoNfce),
      faturamento: this.faturamento,
      prestacaoAberta: this.prestacaoPronta
        || String(this.consignacao?.prestacaoContasAtiva?.status || '').toUpperCase() === 'ABERTA',
      currentStep: this.currentStep
    });
  }

  _renderMomentoAtual() {
    const key = MOMENTOS_FECHAMENTO[this.currentStep]?.key;
    return FecharConsignacaoView.renderMomento(key, this._viewState(), this._viewCtx());
  }

  _syncSnapshotFinanceiro() {
    const consignacao = this.consignacao || {};
    const financeiroBase = this.resumoPrestacao || {};
    const valorVendaHint = Number(
      financeiroBase.valorVenda
      ?? financeiroBase.valorVendido
      ?? financeiroBase.totalVendido
      ?? 0
    );
    const fiscal = resolverSituacaoFiscal(this.faturamento || {}, {
      emitindo: Boolean(this._emitindoNfce),
      valorVenda: valorVendaHint
    });
    const financeiroPre = buildFinanceiroFromResumo(financeiroBase);
    const timeline = buildTimelineOficial({
      consignacao,
      financeiro: financeiroPre,
      faturamento: this.faturamento,
      encerrado: this.encerrado,
      emitindoNfce: Boolean(this._emitindoNfce),
      currentStep: this._timelineStepMarker()
    });
    const built = buildPrestacaoSnapshot(financeiroBase, {
      consignacaoId: this.consignacaoId,
      clienteId: consignacao.clienteId || this.navigationContext?.clienteId || null,
      cliente: consignacao.clienteNome || consignacao.cliente || null,
      documento: formatDocumento(consignacao.documento, consignacao.id || this.consignacaoId),
      origem: 'resumoPrestacao',
      itens: this.resumoPrestacao?.itens || [],
      fiscal,
      vendaOficial: this.faturamento?.vendaId
        ? { vendaId: this.faturamento.vendaId, nfce: this.faturamento.nfce || null }
        : null,
      statusOperacional: this._estadoOperacionalAtual(),
      pagamentos: buildPagamentosHistorico(this.historico || []),
      timeline,
      logOperacional: this.logOperacionalSessao || []
    });
    this.snapshot = built;
    return built.financeiro;
  }

  _recalcularPainel() {
    const itens = this.resumoPrestacao?.itens || [];
    const financeiro = this._syncSnapshotFinanceiro();
    this.painel = buildPainelLateral(this.resumoPrestacao, itens, financeiro);
  }

  _buildWorkspaceFooter() {
    return Workspace.Footer.create({
      className: 'cds-prestacao-estacao__footer',
      left: this._footerLeftNodes(),
      right: this._footerRightNodes()
    });
  }

  _footerLeftNodes() {
    if (this.encerrado) return [];
    // STAB-07.2 — Voltar no rodapé esquerdo (Resumo) ou saída da estação (Retornos)
    if (this.currentStep === STEP_RESUMO) {
      const dis = this.loading.operation;
      const dirty = temAlteracoesPendentes(this.resumoPrestacao?.itens || []);
      const motivo = motivoBotaoDesabilitado('voltar', { loading: dis, dirty });
      return [
        aplicarTooltipDesabilitado(Button.create({
          text: 'Voltar',
          variant: 'ghost',
          disabled: dis,
          title: dis ? motivo : null,
          onClick: () => this._goBack()
        }), dis ? motivo : '')
      ];
    }
    const disabled = this.loading.operation;
    const title = motivoBotaoDesabilitado('voltar', {
      loading: this.loading.operation,
      dirty: false
    });
    const nodes = [
      aplicarTooltipDesabilitado(Button.create({
        text: getBackButtonLabel(this.navigationContext, 'Voltar'),
        variant: 'ghost',
        disabled,
        title: disabled ? title : null,
        onClick: () => this._handleCancel()
      }), disabled ? title : '')
    ];

    // RCM-8.7 — na Prestação, complementar na MESMA consignação (não criar documento novo)
    if (this.currentStep === STEP_RETORNOS) {
      const check = podeAdicionarProdutoComplementar(this.consignacao);
      if (check.elegivel) {
        nodes.push(Button.create({
          text: '+ Adicionar produto',
          variant: 'secondary',
          disabled,
          title: 'Adiciona produtos nesta mesma consignação (Entrega Complementar)',
          onClick: () => this._abrirEntregaComplementar()
        }));
      }
    }
    return nodes;
  }

  async _abrirEntregaComplementar() {
    const check = podeAdicionarProdutoComplementar(this.consignacao);
    if (!check.elegivel) {
      notify(check.mensagem || 'Entrega complementar indisponível.', 'warning');
      return;
    }
    const dirty = temAlteracoesPendentes(this.resumoPrestacao?.itens || []);
    if (dirty) {
      const ok = await confirmDialog({
        title: 'Alterações não salvas',
        message: 'Há alterações na grade ainda não salvas. Deseja continuar para a Entrega Complementar?'
      });
      if (!ok) return;
    }
    const path = routeWithActiveContext(
      `/consignacoes/${this.consignacaoId}/entrega-complementar`,
      this.navigationContext,
      { retorno: 'prestacao' }
    );
    // routeWithActiveContext sem lock devolve path puro — garantir query retorno
    const url = path.includes('retorno=')
      ? path
      : `${path}${path.includes('?') ? '&' : '?'}retorno=prestacao`;
    await navigate(url);
  }

  _footerRightNodes() {
    if (this.encerrado) return [];

    const nodes = [];
    const dirty = temAlteracoesPendentes(this.resumoPrestacao?.itens || []);
    const permissao = this._canEncerrar();

    // Retornos → Resumo
    if (this.currentStep === STEP_RETORNOS) {
      const dis = this.loading.operation || this.salvandoConferencia;
      const motivo = motivoBotaoDesabilitado('continuar', {
        loading: this.loading.operation,
        salvando: this.salvandoConferencia,
        dirty: false
      });
      const continuarBtn = aplicarTooltipDesabilitado(Button.create({
        text: this.salvandoConferencia ? 'Salvando…' : 'Continuar para o fechamento',
        variant: 'primary',
        disabled: dis,
        title: dis ? motivo : null,
        onClick: () => this._goNext()
      }), dis ? motivo : '');
      continuarBtn.addEventListener('mousedown', (event) => {
        if (event.button !== 0) return;
        this._skipNextBlur = true;
        this._capturarRascunhoRetornos();
      });
      nodes.push(continuarBtn);
      return nodes;
    }

    if (this.currentStep !== STEP_RESUMO) return nodes;

    // STAB-07.4 — Voltar ghost · Pagar secondary · Emitir primary · Encerrar success
    const financeiro = this.snapshot?.financeiro || this._syncSnapshotFinanceiro();
    const saldoAberto = Number(financeiro.saldoEmAberto || 0);
    const oficial = this._resumoOficial();
    const fiscal = this.snapshot?.fiscal || resolverSituacaoFiscal(this.faturamento || {}, {
      emitindo: Boolean(this._emitindoNfce),
      valorVenda: financeiro.valorVenda
    });

    const pagarDis = this.loading.operation || saldoAberto <= 0.01;
    nodes.push(aplicarTooltipDesabilitado(Button.create({
      text: this.loading.operation ? 'Registrando…' : 'Registrar Pagamento',
      variant: 'secondary',
      disabled: pagarDis,
      title: pagarDis
        ? (saldoAberto <= 0.01
          ? 'Não há saldo em aberto para receber.'
          : 'Registrando pagamento...')
        : null,
      onClick: () => this._registrarPagamento()
    }), pagarDis ? (saldoAberto <= 0.01
      ? 'Não há saldo em aberto para receber.'
      : 'Registrando pagamento...') : ''));

    const podeMostrarEmitir = fiscal.codigo !== SITUACAO_FISCAL.NAO_APLICAVEL
      && fiscal.codigo !== SITUACAO_FISCAL.AUTORIZADA
      && (oficial.podeEmitir
        || fiscal.codigo === SITUACAO_FISCAL.REJEITADA
        || fiscal.codigo === SITUACAO_FISCAL.PENDENTE_REGULARIZACAO
        || fiscal.codigo === SITUACAO_FISCAL.PENDENTE);

    if (podeMostrarEmitir) {
      const emitirDis = this.loading.operation || !permissao || this._emitindoNfce || dirty;
      const motivoEmitir = motivoBotaoDesabilitado('emitir', {
        loading: this.loading.operation,
        emitindo: this._emitindoNfce,
        podeEncerrarPermissao: permissao,
        dirty,
        situacaoFiscal: fiscal.codigo
      });
      nodes.push(aplicarTooltipDesabilitado(Button.create({
        text: this.loading.operation || this._emitindoNfce
          ? 'Emitindo…'
          : 'Emitir NFC-e',
        variant: 'primary',
        disabled: emitirDis,
        title: emitirDis ? motivoEmitir : null,
        onClick: () => this._emitirNfcePrestacao()
      }), emitirDis ? motivoEmitir : ''));
    }

    const encerrarDis = this.loading.operation || !permissao || dirty;
    const motivoEncerrar = motivoBotaoDesabilitado('encerrar', {
      loading: this.loading.operation,
      podeEncerrarPermissao: permissao,
      podeEncerrarFiscal: true,
      dirty,
      situacaoFiscal: fiscal.codigo
    });
    const encerrarBtn = aplicarTooltipDesabilitado(Button.create({
      text: this.loading.operation ? 'Encerrando...' : 'Encerrar Prestação',
      variant: 'success',
      disabled: encerrarDis,
      title: encerrarDis ? motivoEncerrar : null,
      onClick: () => this._encerrarPrestacaoAposFaturamento()
    }), encerrarDis ? motivoEncerrar : '');
    encerrarBtn.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      this._skipNextBlur = true;
    });
    nodes.push(encerrarBtn);

    return nodes;
  }

  _patchCentralOperacional(scopes = []) {
    const root = document.querySelector('.cds-prestacao-central-operacional');
    if (!root) return false;
    return FecharConsignacaoView.patchCentralOperacional(
      root,
      this._viewState(),
      this._viewCtx(),
      scopes
    );
  }

  /** @deprecated sidebar removida no UX-12 — painel só contextual nos momentos */
  _createSidebar() {
    return document.createElement('div');
  }

  _createFooter() {
    return this._buildWorkspaceFooter();
  }

  _viewState() {
    return {
      consignacao: this.consignacao,
      resumoPrestacao: this.resumoPrestacao,
      navigationContext: this.navigationContext,
      pagamentoDraft: this.pagamentoDraft,
      pagamentoErro: this.pagamentoErro,
      loading: this.loading,
      proximoAtendimento: this.proximoAtendimento,
      clienteDetalhe: this.clienteDetalhe,
      dataEncerramento: this.dataEncerramento,
      painel: this.painel,
      snapshot: this.snapshot,
      retornosUi: this.retornosUi,
      editing: this.editing,
      focus: this.focus,
      lineStatus: this.lineStatus,
      linhasComErro: this.linhasComErro,
      conferenciaAlerta: this.conferenciaAlerta,
      salvandoConferencia: this.salvandoConferencia,
      persistenciaStatus: this.persistenciaStatus,
      persistenciaLabel: labelStatusPersistencia(this.persistenciaStatus),
      faturamento: this.faturamento,
      emitindoNfce: Boolean(this._emitindoNfce),
      historico: this.historico,
      ultimaFalhaEmitir: this._ultimaFalhaEmitir || null,
      rateioPerda: this.rateioPerda || null
    };
  }

  _viewCtx() {
    return {
      onItemFocus: (i, campo) => this._onItemFocus(i, campo),
      onItemDraft: (i, campo, v) => this._onItemDraft(i, campo, v),
      onItemKeydown: (e, i, campo, input) => this._onItemKeydown(e, i, campo, input),
      onItemBlur: (i, campo, v) => this._onItemBlur(i, campo, v),
      onItemQtyChange: (i, campo, v) => this._commitItemField(i, campo, v),
      onItemObsChange: (i, v) => this._updateItemObs(i, v),
      onPagamentoChange: (k, v) => this._updatePagamentoField(k, v),
      onRegistrarPagamento: () => this._registrarPagamento(),
      onAbrirHistoricoPagamentos: () => this._abrirHistoricoPagamentos(),
      onContinuarFechamento: () => this._goNext(),
      onRetornosUiChange: (patch) => this._onRetornosUiChange(patch),
      onEncerramentoAcao: (a) => this._handleEncerramentoAcao(a),
      onRetryLinha: (i) => this._retryLinha(i),
      onVisualizarDanfe: (vendaId) => this._abrirDanfe(vendaId),
      onReimprimirDanfe: (vendaId) => this._abrirDanfe(vendaId),
      onSalvarRateioPerda: (payload) => this._salvarRateioPerda(payload),
      onEmitirNfceRetry: () => {
        this._ultimaFalhaEmitir = null;
        this._emitirNfcePrestacao();
      },
      onLimparFalhaEmitir: () => {
        this._ultimaFalhaEmitir = null;
        this._updateContent();
      }
    };
  }

  _abrirHistoricoPagamentos() {
    const lista = this.snapshot?.pagamentos || buildPagamentosHistorico(this.historico || []);
    FecharConsignacaoView.abrirModalHistoricoPagamentos(lista);
  }

  _onRetornosUiChange(patch = {}) {
    this.retornosUi = {
      ...this.retornosUi,
      ...patch,
      colunas: {
        ...(this.retornosUi.colunas || {}),
        ...(patch.colunas || {})
      }
    };
    const root = document.querySelector('.cds-retornos-estacao');
    if (root) {
      FecharConsignacaoView.refreshRetornosGrade(root, this._viewState(), this._viewCtx());
      return;
    }
    this._updateContent();
  }

  _resumoOficial() {
    const financeiro = this.snapshot?.financeiro || this._syncSnapshotFinanceiro();
    return buildResumoFinalOficial({
      financeiro,
      faturamento: this.faturamento
    });
  }

  async _carregarFaturamentoResumo() {
    const token = this._captureContextToken();
    try {
      const data = await this.api.obterResumoFinalPrestacao(this.consignacaoId);
      if (!this._acceptContextToken(token)) return;
      this.faturamento = data?.faturamento || data?.data?.faturamento || null;
    } catch (_e) {
      /* resumo fiscal opcional até primeira emissão */
    }
  }

  async _emitirNfcePrestacao() {
    if (this._emitindoNfce || this.loading.operation) return;
    if (!this._canEncerrar()) {
      notify('Você não tem permissão para emitir nesta prestação.', 'warning');
      return;
    }

    const flush = await this.flushPendingChanges({ silent: true });
    if (!flush.ok || temAlteracoesPendentes(this.resumoPrestacao?.itens || [])) {
      notify('Existem alterações pendentes na grade. Corrija antes de emitir.', 'warning');
      return;
    }

    const prestacaoAberta = await this._garantirPrestacaoAberta();
    if (!prestacaoAberta) return;

    this._emitindoNfce = true;
    this.loading.operation = true;
    this._updateFooter();
    const t0 = Date.now();

    try {
      gradeForense.log('API', {
        evento: 'emitirNfcePrestacao',
        nota: 'STAB-06.3',
        consignacaoId: this.consignacaoId
      });
      const resultado = await withLoading(MENSAGENS_HARDENING.EMITINDO_NFCE, () =>
        this.api.emitirNfcePrestacao(this.consignacaoId, {})
      );
      this.faturamento = resultado?.faturamento || this.faturamento;
      const fat = this.faturamento || {};
      const vendaId = fat.vendaId || resultado?.vendaId || null;

      if (fat.situacaoFiscal === 'AUTORIZADA') {
        notify(mensagemNfceResultado(fat) || MENSAGENS_HARDENING.NFCE_AUTORIZADA, 'success');
        if (vendaId || resultado?.vendaId) {
          notify(MENSAGENS_HARDENING.VENDA_OFICIAL_CRIADA, 'success');
        }
        this._pushLogOperacional('NFC-e autorizada', { vendaId });
        registrarLogOperacional('EMITIR_NFCE', {
          consignacaoId: this.consignacaoId,
          vendaOficial: vendaId,
          nfce: fat.nfce || null,
          resultado: 'AUTORIZADA',
          inicioMs: t0
        });
        const vendaIdDanfe = vendaId || resultado?.fiscal?.vendaId || null;
        this._mostrarCupomFiscal(vendaIdDanfe, resultado?.fiscal || null);
        this._emitindoNfce = false;
        this.loading.operation = false;
        // Após NFC-e ok: encerra automaticamente (sem novo flush/confirmação).
        await this._encerrarAposEmissaoNfce({ vendaId: vendaIdDanfe });
        return;
      }

      if (fat.situacaoFiscal === 'NAO_APLICAVEL') {
        notify(mensagemNfceResultado(fat) || MENSAGENS_HARDENING.EMISSAO_NAO_APLICAVEL, 'success');
        registrarLogOperacional('EMITIR_NFCE', {
          consignacaoId: this.consignacaoId,
          vendaOficial: vendaId,
          resultado: 'NAO_APLICAVEL',
          inicioMs: t0
        });
        this._emitindoNfce = false;
        this.loading.operation = false;
        await this._encerrarAposEmissaoNfce({ vendaId });
        return;
      }

      const fiscalUi = resolverSituacaoFiscal(fat);
      const msgRejeicao = mensagemNfceResultado(fat)
        || (fiscalUi.codigo === SITUACAO_FISCAL.PENDENTE_REGULARIZACAO
          ? MENSAGENS_HARDENING.NFCE_PENDENTE_REGULARIZACAO
          : humanizarErroOperacional(fat.nfce?.motivo || 'NFC-e rejeitada.').mensagem);
      notify(msgRejeicao, 'warning');
      this.pagamentoErro = null;
      this._ultimaFalhaEmitir = humanizarErroOperacional(fat.nfce?.motivo || msgRejeicao);
      this._pushLogOperacional('NFC-e pendente / rejeitada', {
        situacao: fiscalUi.codigo,
        vendaId
      });
      registrarLogOperacional('EMITIR_NFCE', {
        consignacaoId: this.consignacaoId,
        vendaOficial: vendaId,
        nfce: fat.nfce || null,
        resultado: fiscalUi.codigo,
        inicioMs: t0
      });
      // STAB-07.4 — permanece na estação; atualiza só card fiscal
      this._recalcularPainel();
      if (this.currentStep === STEP_RESUMO) {
        const patched = this._patchCentralOperacional(['fiscal']);
        if (!patched) this._updateContent();
        this._updateFooter();
      } else {
        this._updateUI();
      }
    } catch (error) {
      const humanizado = humanizarErroOperacional(error);
      this._ultimaFalhaEmitir = humanizado;
      notify(humanizado.mensagem, humanizado.retryable ? 'warning' : 'error');
      this._pushLogOperacional('Falha ao emitir NFC-e', { tipo: humanizado.tipo });
      registrarLogOperacional('EMITIR_NFCE', {
        consignacaoId: this.consignacaoId,
        resultado: 'ERRO',
        inicioMs: t0,
        detalhes: { tipo: humanizado.tipo, retryable: humanizado.retryable }
      });
      this._recalcularPainel();
      if (this.currentStep === STEP_RESUMO) {
        const patched = this._patchCentralOperacional(['fiscal']);
        if (!patched) this._updateContent();
        this._updateFooter();
      } else {
        this._updateUI();
      }
    } finally {
      this._emitindoNfce = false;
      if (this.loading.operation) {
        this.loading.operation = false;
        this._updateFooter();
      }
    }
  }

  async _encerrarPrestacaoAposFaturamento() {
    // NFC-e é opcional — o operador pode encerrar sem emitir.
    return this._finalizarComVendaOficial({ emitirFiscal: false, fechar: true });
  }

  /**
   * Cupom fiscal (mesmo fluxo do PDV / Módulo Fiscal).
   * Preferência: danfeHtml do Motor Fiscal → imprimirDANFEFiscal(vendaId).
   */
  _mostrarCupomFiscal(vendaId, fiscal = null) {
    if (fiscal?.danfeHtml) {
      if (typeof window !== 'undefined' && window.electronAPI?.abrirComprovante) {
        window.electronAPI.abrirComprovante(fiscal.danfeHtml, {
          silent: false,
          autoFecharMs: 5000
        });
        return;
      }
      const win = typeof window !== 'undefined'
        ? window.open('', '_blank', 'width=380,height=720')
        : null;
      if (win) {
        win.document.open();
        win.document.write(fiscal.danfeHtml);
        win.document.close();
        return;
      }
    }

    if (!vendaId) return;
    if (typeof window !== 'undefined' && typeof window.imprimirDANFEFiscal === 'function') {
      window.imprimirDANFEFiscal(vendaId);
      return;
    }
    this._abrirDanfe(vendaId);
  }

  /**
   * Encerra a prestação logo após NFC-e (AUTORIZADA / NÃO APLICÁVEL).
   * Não refaz flush da grade — a emissão já exigiu grade limpa.
   * Fallback: POST /prestacao/fechar se finalizar-venda-oficial falhar.
   */
  async _encerrarAposEmissaoNfce({ vendaId = null } = {}) {
    if (!this._canEncerrar()) {
      notify('NFC-e ok, mas sem permissão para encerrar automaticamente.', 'warning');
      return;
    }

    this.loading.operation = true;
    this._updateFooter();
    const t0 = Date.now();

    try {
      let resultado = null;
      try {
        resultado = await withLoading(
          MENSAGENS_HARDENING.ENCERRANDO,
          () => this.api.finalizarVendaOficial(this.consignacaoId, {
            emitirFiscal: false,
            fechar: true
          })
        );
      } catch (errFinalize) {
        // Fallback: só fecha a prestação (venda oficial já pode existir pela emissão)
        await withLoading(
          MENSAGENS_HARDENING.ENCERRANDO,
          () => this.api.fecharPrestacao(this.consignacaoId, {})
        );
        resultado = { faturamento: this.faturamento };
        this._pushLogOperacional('Encerramento via fecharPrestacao (fallback pós NFC-e)', {
          erro: String(errFinalize?.message || errFinalize)
        });
      }

      this.faturamento = resultado?.faturamento || this.faturamento;
      this.encerrado = true;
      this.dataEncerramento = new Date();
      this.vendaOficial = resultado?.venda || { id: vendaId || this.faturamento?.vendaId };
      this._recalcularPainel();

      registrarLogEncerramento({
        consignacao: this.consignacao || {},
        financeiro: this.snapshot?.financeiro || {},
        faturamento: this.faturamento,
        usuario: null
      });
      registrarLogOperacional('ENCERRAR_PRESTACAO', {
        consignacaoId: this.consignacaoId,
        vendaOficial: this.faturamento?.vendaId || vendaId || null,
        nfce: this.faturamento?.nfce || null,
        resultado: 'ENCERRADA_POS_NFCE',
        inicioMs: t0
      });

      notify(MENSAGENS_HARDENING.PRESTACAO_ENCERRADA || 'Prestação encerrada automaticamente após a NFC-e.', 'success');
      this._pushLogOperacional('Prestação encerrada automaticamente após NFC-e', {
        vendaId: this.faturamento?.vendaId || vendaId || null
      });

      const clienteId = this.consignacao?.clienteId || this.navigationContext.clienteId;
      if (clienteId) {
        try {
          this.clienteDetalhe = await buscarClientePorIdErp(clienteId);
        } catch (_error) {
          this.clienteDetalhe = null;
        }
      }

      this.currentStep = STEP_ENCERRAMENTO;
      this.steps = inicializarMomentos(true);
      await this._loadData(true, { skipUi: true });
      this._updateUI();
      await this._gerarComprovantePrestacaoAposEncerrar({ autoPrint: false });
    } catch (error) {
      notify(
        humanizarErroOperacional(error).mensagem
          || 'NFC-e emitida, mas não foi possível encerrar automaticamente. Use Encerrar.',
        'warning'
      );
      registrarLogOperacional('ENCERRAR_PRESTACAO', {
        consignacaoId: this.consignacaoId,
        resultado: 'ERRO_POS_NFCE',
        detalhes: { message: String(error?.message || error) }
      });
    } finally {
      this.loading.operation = false;
      this._updateFooter();
    }
  }

  _abrirDanfe(vendaId) {
    if (!vendaId) return;
    const base = (typeof window !== 'undefined' && window.API_URL)
      ? window.API_URL
      : 'http://localhost:3000/api';
    const url = `${base}/fiscal/danfe/venda/${vendaId}`;
    if (typeof window !== 'undefined' && typeof window.imprimirDANFEFiscal === 'function') {
      window.imprimirDANFEFiscal(vendaId);
      return;
    }
    if (typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  _canEncerrar() {
    return isOperadorAutorizado() && !['ACERTADA', 'ENCERRADA', 'QUITADA'].includes(
      String(this.consignacao?.status || '').toUpperCase()
    );
  }

  /**
   * @param {boolean} silent
   * @param {{ skipUi?: boolean }} [options] STAB-07.3 — recarrega dados sem remontar a estação
   */
  async _loadData(silent = false, options = {}) {
    const token = this._captureContextToken();
    if (!this._acceptContextToken(token)) return;

    const skipUi = Boolean(options.skipUi);
    if (!silent) {
      this.loading.consignacao = true;
      this.loading.prestacao = true;
      this._updateUI();
    }

    try {
      const consignacaoId = this.consignacaoId;
      const clienteIdHint = this.operacaoContext?.clienteId
        || this.navigationContext.clienteId
        || undefined;

      const [consignacao, prestacao, historico, contaCorrente, rateioPerda] = await Promise.all([
        carregarConsignacaoCompleta(this.api, this.projectionApi, consignacaoId),
        this.projectionApi.obterResumoPrestacao({ consignacaoId }).catch(() => null),
        this.projectionApi.listarMovimentacoes({ consignacaoId }).catch(() => []),
        this.projectionApi.obterProjecaoContaCorrente({
          consignacaoId,
          clienteId: clienteIdHint
        }).catch(() => null),
        this.api.obterRateioPerda(consignacaoId).catch(() => null)
      ]);

      if (!this._acceptContextToken(token)) return;

      // Resposta de outra consignação nunca aplica (defesa extra além da versão).
      if (consignacao?.id != null && String(consignacao.id) !== String(consignacaoId)) {
        return;
      }

      this.consignacao = consignacao;
      this.historico = historico;
      this.contaCorrente = contaCorrente;
      this.rateioPerda = rateioPerda;
      this._syncOperacaoContextFromConsignacao(consignacao);
      this.resumoPrestacao = this._buildResumoFromData(prestacao, historico, consignacao, contaCorrente);
      limparDirtyTodos(this.resumoPrestacao?.itens || []);
      this._capturarBaseline();
      this.persistenciaStatus = 'saved';
      this._recalcularPainel();

      const statusCons = String(consignacao.status || '').toUpperCase();
      const prestStatus = String(consignacao.prestacaoContasAtiva?.status || '').toUpperCase();
      const jaFechada = ['ACERTADA', 'ENCERRADA', 'QUITADA'].includes(statusCons)
        && prestStatus !== 'ABERTA';

      if (prestStatus === 'ABERTA') {
        this.prestacaoPronta = true;
      } else {
        this.prestacaoPronta = false;
      }

      if (jaFechada && !this.encerrado) {
        this.encerrado = true;
        this.currentStep = STEP_ENCERRAMENTO;
        this.steps = inicializarMomentos(true);
        this.dataEncerramento = this.dataEncerramento || new Date();
        const clienteId = consignacao.clienteId || this.navigationContext.clienteId;
        if (clienteId && !this.clienteDetalhe) {
          try {
            this.clienteDetalhe = await buscarClientePorIdErp(clienteId);
          } catch (_error) {
            this.clienteDetalhe = null;
          }
          if (!this._acceptContextToken(token)) return;
        }
      }

      this.error = null;
    } catch (error) {
      if (!this._acceptContextToken(token)) return;
      this.error = error;
    } finally {
      // Sempre libera loading se a página ainda é desta consignação (evita "Carregando..." eterno)
      const mesmaConsignacao = String(token?.consignacaoId || '') === String(this.consignacaoId || '');
      if (this._disposed) return;
      if (!this._acceptContextToken(token)) {
        if (mesmaConsignacao) {
          this.loading.consignacao = false;
          this.loading.prestacao = false;
          this._updateUI();
        }
        return;
      }
      this.loading.consignacao = false;
      this.loading.prestacao = false;
      if (skipUi) {
        this._updateFooter();
      } else if (this._devePreservarGradeRetornos()) {
        this._atualizarPainelPreview();
        this._updateFooter();
      } else {
        this._updateUI();
      }
    }
  }

  _devePreservarGradeRetornos() {
    return this.currentStep === STEP_RETORNOS
      && Boolean(this._qs('#fechar-retornos-grade'))
      && (
        temAlteracoesPendentes(this.resumoPrestacao?.itens || [])
        || this.editing.rowIndex >= 0
        || document.activeElement?.closest('#fechar-retornos-grade')
      );
  }

  _capturarBaseline() {
    this._gradeBaseline = cloneBaseline(this.resumoPrestacao?.itens || []);
  }

  _atualizarIndicadorPersistencia() {
    if (!this._isAlive()) return;
    const itens = this.resumoPrestacao?.itens || [];
    if (this.salvandoConferencia) {
      this.persistenciaStatus = 'saving';
    } else {
      this.persistenciaStatus = statusPersistencia(itens);
    }
    const host = this._qs('#fechar-persistencia-status');
    if (host) {
      host.dataset.status = this.persistenciaStatus;
      host.textContent = labelStatusPersistencia(this.persistenciaStatus);
      host.hidden = this.currentStep !== STEP_RETORNOS && this.persistenciaStatus === 'saved';
    }
    const headerStatus = this._qs('#prestacao-persistencia');
    if (headerStatus) {
      headerStatus.textContent = labelStatusPersistencia(this.persistenciaStatus);
      headerStatus.dataset.status = this.persistenciaStatus;
    }
    // Não recriar o footer aqui: no Electron o blur do input + compose do footer
    // remove o botão Continuar antes do evento click.
  }

  _syncFocusedInputIntoState() {
    if (typeof document === 'undefined') return;
    const el = document.activeElement;
    if (!el?.dataset?.campo) return;
    const row = el.closest?.('[data-row-index]');
    if (!row) return;
    const index = Number(row.dataset.rowIndex);
    const campo = el.dataset.campo;
    if (!CAMPOS_QTY.includes(campo) && campo !== 'observacao') return;
    this._aplicarAlteracaoState(index, campo, el.value);
  }

  _aplicarAlteracaoState(index, campo, value) {
    const item = this._getItem(index);
    if (!item) return;
    aplicarValorState(item, campo, value);
    gradeForense.log('STATE', {
      evento: 'aplicarAlteracao',
      index,
      campo,
      state: gradeForense.snapshotItem(item)
    });
    this._syncDomFromState(index);
    this._atualizarIndicadorPersistencia();
    this._atualizarPainelPreview();
  }

  _syncDomFromState(index) {
    const item = this._getItem(index);
    const row = this._getLinhaRetornoEl(index);
    if (!item || !row) return;
    CAMPOS_QTY.forEach((campo) => {
      const input = row.querySelector(`input[data-campo="${campo}"]`);
      if (!input) return;
      if (document.activeElement === input) return;
      const next = String(item[campo] || 0);
      if (input.value !== next) input.value = next;
    });
    const saldoEl = row.querySelector('[data-saldo-index]');
    if (saldoEl) saldoEl.textContent = String(item.saldo ?? 0);
    row.classList.toggle('cds-fechar-consignacao__grade-row--dirty', Boolean(item.dirty));
  }

  _buildResumoFromData(prestacao, historico, consignacao = {}, contaCorrente = null) {
    const resumo = {
      ...(prestacao || {}),
      valorVendido: Number(prestacao?.valorVendido ?? prestacao?.totalVendido ?? 0),
      valorRecebido: Number(prestacao?.valorRecebido ?? prestacao?.totalPago ?? prestacao?.valorPago ?? 0),
      saldoAtual: Number(prestacao?.saldoAtual ?? prestacao?.saldo ?? 0),
      valorDevolvido: Number(prestacao?.valorDevolvido ?? prestacao?.totalDevolvido ?? 0),
      valorPerdido: Number(prestacao?.valorPerdido ?? prestacao?.totalPerdido ?? 0),
      valorCortesia: Number(prestacao?.valorCortesia ?? prestacao?.totalCortesia ?? 0)
    };

    // RCM-8.11 — preferir itens do ciclo (grupo) no resumo; fallback consignação da URL
    let itens = null;
    if (Array.isArray(resumo.itens) && resumo.itens.length) {
      itens = resumo.itens.map((item) => mapItemConsignacao(item));
    } else if (Array.isArray(consignacao.itens) && consignacao.itens.length) {
      itens = consignacao.itens.map((item) => mapItemConsignacao({
        ...item,
        consignacaoId: item.consignacaoId ?? consignacao.id,
        documentoConsignacao: consignacao.documento
      }));
    }

    if (!itens?.length) {
      const cache = mapItensCacheParaPrestacao(obterItensCacheConsignacao(consignacao.id));
      if (cache.length) itens = cache;
    }

    if (!itens?.length) {
      itens = buildItensFromMovimentacoes(
        normalizarMovimentacoes(historico),
        consignacao.prestacaoContasAtiva?.id
      );
    }

    const prevItens = this.resumoPrestacao?.itens || [];
    resumo.itens = enriquecerItensPrestacao(
      itens || [],
      consignacao.itens || []
    ).map((item, index) => {
      const prev = prevItens.find((p) => (
        (p.itemId && item.itemId && String(p.itemId) === String(item.itemId))
        || (p.produtoId && item.produtoId && String(p.produtoId) === String(item.produtoId)
          && String(p.consignacaoId || '') === String(item.consignacaoId || ''))
      )) || prevItens[index];
      if (prev?.observacao && !item.observacao) {
        item.observacao = prev.observacao;
      }
      return syncStatusOperacional(item);
    });

    if (!Number(resumo.valorConsignado ?? resumo.valorTotal ?? 0)) {
      resumo.valorConsignado = calcularValorEntregue(consignacao, resumo, resumo.itens);
    }

    resumo.quantidadeConsignacoes = Number(
      prestacao?.quantidadeConsignacoes
      || prestacao?.consignacoes?.length
      || 1
    );
    resumo.consignacoesCiclo = prestacao?.consignacoes || [];
    resumo.grupoPrestacaoContasId = prestacao?.grupoPrestacaoContasId
      || consignacao.prestacaoContasAtiva?.id
      || null;
    resumo.consolidado = Boolean(prestacao?.consolidado) || resumo.quantidadeConsignacoes > 1;

    const fin = buildResumoLegacy(resumo, contaCorrente);
    Object.assign(resumo, fin);
    return resumo;
  }

  _getItem(index) {
    return this.resumoPrestacao?.itens?.[index] || null;
  }

  _onItemFocus(index, campo) {
    const item = this._getItem(index);
    if (!item) return;
    this.editing = {
      rowIndex: index,
      campo,
      originalValue: campo === 'observacao' ? (item.observacao || '') : Number(item[campo] || 0)
    };
    this.focus = { rowIndex: index, campo };
    this._highlightEditingRow(index);
    this._atualizarPainelPreview();
  }

  _onItemDraft(index, campo, value) {
    this._aplicarAlteracaoState(index, campo, value);
  }

  /**
   * Blur apenas sincroniza State (fonte única). Não persiste.
   */
  _onItemBlur(index, campo, value) {
    if (this._skipNextBlur) {
      this._skipNextBlur = false;
      return;
    }
    this._aplicarAlteracaoState(index, campo, value);
    this.editing = { rowIndex: -1, campo: null, originalValue: null };
  }

  _capturarRascunhoRetornos() {
    // STAB-04: payload vem do State — apenas sincroniza o input focado.
    this._syncFocusedInputIntoState();
    this._rascunhoRetornosSnapshot = null;
    return null;
  }

  _onItemKeydown(event, index, campo, input) {
    if (event.key === 'Tab') {
      event.preventDefault();
      const dir = event.shiftKey ? -1 : 1;
      this._skipNextBlur = true;
      this._aplicarAlteracaoState(index, campo, input.value);
      this._navegarCampo(index, campo, dir);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      this._skipNextBlur = true;
      if (campo === 'observacao') {
        this._aplicarAlteracaoState(index, 'observacao', input.value);
        this._navegarCampo(index, campo, 1);
        return;
      }
      this._aplicarAlteracaoState(index, campo, input.value);
      this.flushPendingChanges({ focusNext: { index, campo } });
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      this._cancelarEdicaoLinha(index, campo);
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const dir = event.key === 'ArrowDown' ? 1 : -1;
      this._skipNextBlur = true;
      this._aplicarAlteracaoState(index, campo, input.value);
      this._navegarLinha(index, campo, dir);
    }
  }

  _cancelarEdicaoLinha(index, campo) {
    const item = this._getItem(index);
    if (!item) return;
    const original = this.editing.originalValue;
    if (campo === 'observacao') {
      item.observacao = original ?? '';
    } else if (CAMPOS_QTY.includes(campo)) {
      item[campo] = Number(original ?? 0);
      item.saldo = calcularSaldoItem(item);
      if (item.dirtyCampos) delete item.dirtyCampos[campo];
      item.dirty = Boolean(item.dirtyCampos && Object.keys(item.dirtyCampos).length);
    }
    this.editing = { rowIndex: -1, campo: null, originalValue: null };
    this._syncDomFromState(index);
    this._highlightEditingRow(-1);
    this._atualizarIndicadorPersistencia();
    this._atualizarPainelPreview();
  }

  _navegarCampo(index, campo, direcao) {
    const idx = CAMPOS_RETORNO_ORDEM.indexOf(campo);
    let nextIndex = index;
    let nextCampo = proximoCampoRetorno(campo, direcao);

    if (direcao > 0 && idx === CAMPOS_RETORNO_ORDEM.length - 1) {
      nextIndex = Math.min(index + 1, (this.resumoPrestacao?.itens?.length || 1) - 1);
      nextCampo = CAMPOS_RETORNO_ORDEM[0];
    } else if (direcao < 0 && idx === 0) {
      nextIndex = Math.max(index - 1, 0);
      nextCampo = CAMPOS_RETORNO_ORDEM[CAMPOS_RETORNO_ORDEM.length - 1];
    }

    this._focusCampo(nextIndex, nextCampo);
  }

  _navegarLinha(index, campo, direcao) {
    const nextIndex = Math.min(
      Math.max(index + direcao, 0),
      (this.resumoPrestacao?.itens?.length || 1) - 1
    );
    this._focusCampo(nextIndex, campo);
  }

  _focusCampo(index, campo) {
    this.focus = { rowIndex: index, campo };
    const el = this._getCampoEl(index, campo);
    if (el) {
      el.focus();
      if (typeof el.select === 'function') el.select();
    }
    this._highlightEditingRow(index);
  }

  _getCampoEl(index, campo) {
    return document.querySelector(`${seletorLinhaRetorno(index)} [data-campo="${campo}"]`);
  }

  _getLinhaRetornoEl(index) {
    return document.querySelector(seletorLinhaRetorno(index));
  }

  _highlightEditingRow(index) {
    document.querySelectorAll(`${LINHA_RETORNO_SELECTOR}[data-row-index]`).forEach((row) => {
      const rowIndex = Number(row.dataset.rowIndex);
      row.classList.toggle('cds-fechar-consignacao__grade-row--editando', rowIndex === index);
    });
  }

  _statusOperacionalLabel(index) {
    const item = this._getItem(index);
    if (!item) return 'Pendente';
    syncStatusOperacional(item);
    return item.statusLabel || (item.saldo > 0 ? 'Pendente' : 'Liquidado');
  }

  _setLineStatus(index, state, message = '') {
    this.lineStatus[`${index}-active`] = { state, message };
    const row = this._getLinhaRetornoEl(index);
    const statusEl = row?.querySelector('[data-status-row]');
    if (statusEl) {
      statusEl.dataset.state = state || '';
      if (state === 'saving' || state === 'saved' || state === 'error') {
        statusEl.textContent = message
          || (state === 'saving' ? 'Salvando...' : state === 'saved' ? 'Salvo' : 'Erro');
      } else {
        statusEl.textContent = message || this._statusOperacionalLabel(index);
      }
    }
  }

  async _garantirPrestacaoAberta() {
    if (this.prestacaoPronta) return true;
    if (this.consignacao?.prestacaoContasAtiva?.status === 'ABERTA') {
      this.prestacaoPronta = true;
      return true;
    }
    try {
      await this.api.abrirPrestacao(this.consignacaoId);
      this.prestacaoPronta = true;
      const atualizada = await carregarConsignacaoCompleta(this.api, this.projectionApi, this.consignacaoId);
      this.consignacao = atualizada;
      return true;
    } catch (error) {
      notify(`Prestação não está aberta: ${error.message}`, 'error');
      return false;
    }
  }

  _updateItemObs(index, value) {
    this._aplicarAlteracaoState(index, 'observacao', value);
  }

  async _persistirPendencia(pendencia) {
    if (pendencia.tipo === 'invalido') {
      throw new Error(pendencia.erro);
    }

    const { index, campo, tipo, delta, target, item } = pendencia;
    const payload = buildPayloadOperacao(item, delta, tipo);
    const erros = validarPayloadOperacao(payload, tipo);
    if (erros.length) throw new Error(erros[0]);

    if (tipo !== 'devolucao' && !(await this._garantirPrestacaoAberta())) {
      throw new Error('Não foi possível iniciar o registro desta conferência.');
    }

    payload.usuarioId = getUsuarioId();
    gradeForense.log('PAYLOAD', { tipo, delta, target, payload });
    await this._executarOperacaoPrestacao(tipo, payload);

    if (tipo === 'devolucao') {
      this.consignacao = await carregarConsignacaoCompleta(
        this.api,
        this.projectionApi,
        this.consignacaoId
      );
    }

    const atual = this._getItem(index);
    if (atual) {
      atual[campo] = target;
      atual.saldo = calcularSaldoItem(atual);
      if (item.observacao) atual.observacao = item.observacao;
    }
  }

  /**
   * Mecanismo oficial único de persistência da Grade (STAB-04).
   * Payload sempre derivado do State × baseline — nunca do DOM.
   */
  async flushPendingChanges(options = {}) {
    this._syncFocusedInputIntoState();
    const itens = this.resumoPrestacao?.itens || [];
    if (!itens.length) {
      return { ok: true, falhas: [], pendencias: [] };
    }

    const pendencias = listarPendenciasFromBaseline(
      this._gradeBaseline,
      itens,
      { indices: options.indices || null }
    );

    gradeForense.log('STATE', {
      evento: 'flushPendingChanges',
      dirty: temAlteracoesPendentes(itens),
      state: itens.map(gradeForense.snapshotItem),
      pendencias: pendencias.map((p) => ({
        index: p.index,
        campo: p.campo,
        tipo: p.tipo,
        delta: p.delta
      }))
    });

    if (!pendencias.length) {
      const obsOk = await this._persistirObservacoesPendentes();
      if (obsOk) {
        limparDirtyTodos(itens);
        this._capturarBaseline();
        this.persistenciaStatus = 'saved';
      } else {
        this.persistenciaStatus = 'pending';
      }
      this._atualizarIndicadorPersistencia();
      (this.resumoPrestacao?.itens || []).forEach((_, index) => this._patchLinhaRetorno(index));
      if (options.focusNext) {
        this._navegarCampo(options.focusNext.index, options.focusNext.campo, 1);
      }
      return { ok: obsOk, falhas: obsOk ? [] : [{ message: 'Falha ao salvar observações' }], pendencias: [] };
    }

    this.salvandoConferencia = true;
    this.persistenciaStatus = 'saving';
    this._atualizarIndicadorPersistencia();

    const falhas = [];
    const indicesSalvos = new Set();

    for (const pendencia of pendencias) {
      const { index } = pendencia;
      this._setLineStatus(index, 'saving');
      try {
        await this._persistirPendencia(pendencia);
        delete this.linhasComErro[index];
        this._setLineStatus(index, 'saved');
        this._limparDestaqueErroLinha(index);
        indicesSalvos.add(index);
      } catch (error) {
        const msg = humanizarErroOperacional(error).mensagem;
        const produto = safeText(pendencia.item?.produtoNome || pendencia.item?.produto, 'Produto');
        falhas.push({ index, produto, message: msg });
        this._marcarLinhaErro(index, msg, produto);
        // Não continua o lote: evita abrir venda/perda se devolução falhou no meio.
        break;
      }
    }

    const obsOk = falhas.length === 0
      ? await this._persistirObservacoesPendentes()
      : false;

    await this._reloadResumoSilencioso({ force: falhas.length === 0 });

    if (falhas.length === 0 && obsOk) {
      limparDirtyTodos(this.resumoPrestacao?.itens || []);
      this._capturarBaseline();
      this.persistenciaStatus = 'saved';
      this.conferenciaAlerta = null;
      this._patchConferenciaAlerta();
      if (!options.silent) {
        notify(MENSAGENS_HARDENING.PRESTACAO_SALVA, 'success');
      }
    } else {
      this.conferenciaAlerta =
        'Existem produtos que ainda não puderam ser registrados. Revise apenas os itens destacados.';
      this._patchConferenciaAlerta();
      this.persistenciaStatus = 'pending';
    }

    (this.resumoPrestacao?.itens || []).forEach((_, index) => this._patchLinhaRetorno(index));
    this._atualizarPainelPreview();
    this.salvandoConferencia = false;
    this._atualizarIndicadorPersistencia();

    if (falhas.length === 0 && obsOk && options.focusNext) {
      this._navegarCampo(options.focusNext.index, options.focusNext.campo, 1);
    }

    return { ok: falhas.length === 0 && obsOk, falhas, pendencias };
  }

  async _persistirObservacoesPendentes() {
    const itens = this.resumoPrestacao?.itens || [];
    let ok = true;
    for (let index = 0; index < itens.length; index += 1) {
      const item = itens[index];
      if (!item?.dirtyCampos?.observacao) continue;
      const itemId = Number(item.itemId ?? item.id);
      if (!Number.isFinite(itemId) || itemId <= 0) {
        ok = false;
        continue;
      }
      try {
        this._setLineStatus(index, 'saving');
        await this.api.atualizarObservacaoItem(this.consignacaoId, itemId, {
          observacao: item.observacao || ''
        });
        if (item.dirtyCampos) delete item.dirtyCampos.observacao;
        if (item.dirtyCampos && !Object.keys(item.dirtyCampos).length) {
          item.dirty = false;
        }
        this._setLineStatus(index, 'saved');
      } catch (error) {
        ok = false;
        const msg = humanizarErroOperacional(error).mensagem;
        this._setLineStatus(index, 'error', msg);
      }
    }
    return ok;
  }

  /** @deprecated STAB-04 — use flushPendingChanges */
  async _commitItemField(index, campo, newValue, { focusNext = false } = {}) {
    this._aplicarAlteracaoState(index, campo, newValue);
    return this.flushPendingChanges(
      focusNext ? { focusNext: { index, campo } } : {}
    );
  }

  /** @deprecated STAB-04 — use flushPendingChanges */
  async _salvarConferenciaPendente() {
    return this.flushPendingChanges();
  }

  async _retryLinha(index) {
    const resultado = await this.flushPendingChanges({ indices: [index] });
    if (!resultado.ok) {
      notify(resultado.falhas[0]?.message || 'Falha ao salvar linha.', 'error');
    }
  }

  _marcarLinhaErro(index, message, produto = '') {
    const item = this._getItem(index);
    this.linhasComErro[index] = {
      produto: produto || item?.produto || `Item ${index + 1}`,
      message
    };
    this._setLineStatus(index, 'error', message);
    const row = this._getLinhaRetornoEl(index);
    if (row) {
      row.classList.add('cds-fechar-consignacao__grade-row--erro');
      this._ensureRetryButton(row, index);
    }
    this._patchConferenciaAlerta();
  }

  _limparDestaqueErroLinha(index) {
    delete this.linhasComErro[index];
    const row = this._getLinhaRetornoEl(index);
    if (row) {
      row.classList.remove('cds-fechar-consignacao__grade-row--erro');
      row.querySelector('.cds-fechar-consignacao__retry-btn')?.remove();
    }
    if (!Object.keys(this.linhasComErro).length) {
      this.conferenciaAlerta = null;
      this._patchConferenciaAlerta();
    }
  }

  _ensureRetryButton(row, index) {
    const status = row.querySelector('[data-status-row]');
    if (!status || status.querySelector('.cds-fechar-consignacao__retry-btn')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cds-fechar-consignacao__retry-btn';
    btn.textContent = 'Tentar novamente';
    btn.addEventListener('click', () => this._retryLinha(index));
    status.appendChild(btn);
  }

  _patchConferenciaAlerta() {
    const host = document.getElementById('fechar-conferencia-alerta');
    if (!host) return;
    if (!this.conferenciaAlerta) {
      host.hidden = true;
      host.innerHTML = '';
      return;
    }
    host.hidden = false;
    host.innerHTML = `<strong>${this.conferenciaAlerta}</strong>`;
  }

  async _executarOperacaoPrestacao(tipo, payload) {
    gradeForense.log('PAYLOAD', { tipo, consignacaoId: this.consignacaoId, payload });
    try {
      if (tipo === 'devolucao') {
        // STAB-04/hotfix: devolução permitida com prestação ABERTA (grade unificada).
        // Backend rejeita apenas prestação FECHADA.
        await this.api.registrarDevolucao(this.consignacaoId, payload);
        gradeForense.log('API', { tipo, ok: true, payload });
        return;
      }

      if (tipo === 'venda') {
        await this.api.registrarVenda(this.consignacaoId, payload);
      } else if (tipo === 'perda') {
        await this.api.registrarPerda(this.consignacaoId, payload);
      } else if (tipo === 'cortesia') {
        await this.api.registrarCortesia(this.consignacaoId, payload);
      }
      gradeForense.log('API', { tipo, ok: true, payload });
    } catch (error) {
      gradeForense.log('API', { tipo, ok: false, payload, erro: error?.message || String(error) });
      throw error;
    }
  }

  async _reloadResumoSilencioso({ force = false } = {}) {
    const token = this._captureContextToken();
    if (!this._acceptContextToken(token)) return;

    const stateAntes = (this.resumoPrestacao?.itens || []).map((item) => ({ ...item }));
    const tinhaDirty = temAlteracoesPendentes(stateAntes);
    const consignacaoId = this.consignacaoId;

    const [prestacao, historico, contaCorrente] = await Promise.all([
      this.projectionApi.obterResumoPrestacao({ consignacaoId }).catch(() => null),
      this.projectionApi.listarMovimentacoes({ consignacaoId }).catch(() => []),
      this.projectionApi.obterProjecaoContaCorrente({
        consignacaoId,
        clienteId: this.operacaoContext?.clienteId
          || this.navigationContext.clienteId
          || undefined
      }).catch(() => null)
    ]);

    if (!this._acceptContextToken(token)) return;

    this.historico = historico;
    this.contaCorrente = contaCorrente;
    const novo = this._buildResumoFromData(prestacao, historico, this.consignacao, contaCorrente);

    if (!force && tinhaDirty) {
      novo.itens = mesclarServidorPreservandoDirty(novo.itens || [], stateAntes);
      gradeForense.log('STATE', { evento: 'reloadPreservouDirty', itens: novo.itens.map(gradeForense.snapshotItem) });
    } else {
      limparDirtyTodos(novo.itens || []);
      this._gradeBaseline = cloneBaseline(novo.itens || []);
    }

    this.resumoPrestacao = novo;
    this._recalcularPainel();
  }

  _patchLinhaRetorno(index) {
    const item = this._getItem(index);
    const row = this._getLinhaRetornoEl(index);
    if (!row || !item) return;
    FecharConsignacaoView.patchLinhaRetorno(row, item, index, this._viewState());
  }

  _patchPainelLateral(painel = this.painel) {
    if (!this._isAlive()) return;
    const aside = this._qs('#fechar-painel-lateral');
    if (!aside) {
      this._updateSidebar();
      requestAnimationFrame(() => {
        if (!this._isAlive()) return;
        this._atualizarPainelPreview();
      });
      return;
    }
    FecharConsignacaoView.patchPainelLateral(aside, painel, this._viewState());
    aside.classList.toggle('cds-fechar-consignacao__painel--preview', Boolean(painel?.preview));
  }

  _atualizarPainelPreview() {
    if (!this._isAlive()) return;
    if (this.currentStep !== STEP_RETORNOS || !this.resumoPrestacao?.itens?.length) return;
    const itens = this.resumoPrestacao.itens;
    // Qtds + estimativa R$ da grade; SSOT oficial no snapshot após flush
    const financeiroSsot = this.snapshot?.financeiro || this._syncSnapshotFinanceiro();
    const painelPreview = buildPainelLateralPreview(this.resumoPrestacao, itens, financeiroSsot);
    this.painel = painelPreview;
    this._patchPainelLateral(painelPreview);
    FecharConsignacaoView.patchResumoRapido(
      this._qs('#fechar-retornos-resumo-rapido'),
      painelPreview
    );
    this._atualizarIndicadorPersistencia();
  }

  async _consolidarRetornosAntesAvancar() {
    await this._reloadResumoSilencioso({ force: true });
    limparDirtyTodos(this.resumoPrestacao?.itens || []);
    this._capturarBaseline();
    this._recalcularPainel();
  }

  _updatePainelLocal() {
    this._recalcularPainel();
    this._patchPainelLateral(this.painel);
  }

  _sincronizarPagamentoDoDom() {
    const wrap = document.querySelector('.cds-fechar-consignacao__pagamento-form');
    if (!wrap) return;
    const valorInput = wrap.querySelector('input[type="number"]');
    if (valorInput && valorInput.value !== '') {
      this.pagamentoDraft.valor = String(valorInput.value);
    }
    const select = wrap.querySelector('select');
    if (select && select.value) {
      this.pagamentoDraft.formaPagamento = select.value;
    }
  }

  /** Saldo em aberto do SSOT — nunca misturar com valor digitado no formulário. */
  _saldoDevedorServidor() {
    const financeiro = this.snapshot?.financeiro || this._syncSnapshotFinanceiro();
    return Number(financeiro.saldoEmAberto ?? 0);
  }

  _updatePagamentoField(key, value) {
    this.pagamentoDraft[key] = value;
    this.pagamentoErro = null;
  }

  /**
   * RC4.2 — persiste rateio inteligente de perdas.
   */
  async _salvarRateioPerda(payload = {}) {
    const token = this._captureContextToken();
    if (!(await this._garantirPrestacaoAberta())) return false;
    if (!this._acceptContextToken(token)) return false;
    this.loading.operation = true;
    this._updateFooter();
    try {
      const resultado = await withLoading('Salvando rateio da perda…', () =>
        this.api.definirRateioPerda(this.consignacaoId, {
          tipoRateio: payload.tipoRateio,
          valorCliente: payload.valorCliente,
          valorEmpresa: payload.valorEmpresa,
          campoEditado: payload.campoEditado || null,
          motivoPerda: payload.motivoPerda,
          observacaoPerda: payload.observacaoPerda,
          usuarioId: getUsuarioId()
        })
      );
      if (!this._acceptContextToken(token)) return false;
      this.rateioPerda = {
        ...(this.rateioPerda || {}),
        rateio: resultado?.rateio || resultado?.data?.rateio || payload,
        resumoFinanceiro: resultado?.resumoFinanceiro || resultado?.data?.resumoFinanceiro || null,
        totais: resultado?.totais || resultado?.data?.totais || this.rateioPerda?.totais
      };
      notify('Rateio da perda salvo.', 'success');
      this._pushLogOperacional('Rateio da perda definido', {
        tipo: payload.tipoRateio,
        cliente: payload.valorCliente,
        empresa: payload.valorEmpresa,
        motivo: payload.motivoPerda
      });
      registrarLogOperacional('RATEIO_PERDA', {
        consignacaoId: this.consignacaoId,
        resultado: 'OK',
        detalhes: {
          tipoRateio: payload.tipoRateio,
          valorCliente: payload.valorCliente,
          valorEmpresa: payload.valorEmpresa,
          motivoPerda: payload.motivoPerda
        }
      });
      await this._loadData(true, { skipUi: true });
      if (!this._acceptContextToken(token)) return false;
      this._updateContent();
      return true;
    } catch (error) {
      if (!this._acceptContextToken(token)) return false;
      notify(humanizarErroOperacional(error).mensagem, 'error');
      return false;
    } finally {
      if (!this._acceptContextToken(token)) return false;
      this.loading.operation = false;
      this._updateFooter();
    }
  }

  /**
   * ÚNICA porta FE que cria movimento financeiro na Prestação (STAB-07.1).
   * Navegação nunca chama este método.
   */
  async _registrarPagamento() {
    const token = this._captureContextToken();
    this._sincronizarPagamentoDoDom();
    if (!(await this._garantirPrestacaoAberta())) return false;
    if (!this._acceptContextToken(token)) return false;

    let valor = Number(String(this.pagamentoDraft.valor).replace(',', '.'));
    if (!valor || valor <= 0) {
      this.pagamentoErro = 'Informe um valor válido para o pagamento';
      this._updateContent();
      return false;
    }

    const saldoAberto = this._saldoDevedorServidor();
    if (saldoAberto <= 0) {
      this.pagamentoErro = 'Não há saldo a pagar neste atendimento.';
      this._updateContent();
      return false;
    }

    this.loading.operation = true;
    this.pagamentoErro = null;
    this._updateFooter();

    try {
      await withLoading(MENSAGENS_HARDENING.REGISTRANDO_PAGAMENTO, () => this.api.registrarPagamento(this.consignacaoId, {
        valor,
        formaPagamento: this.pagamentoDraft.formaPagamento || 'DINHEIRO',
        observacao: this.pagamentoDraft.observacoes || null,
        usuarioId: getUsuarioId()
      }));
      if (!this._acceptContextToken(token)) return false;
      notify(MENSAGENS_HARDENING.PAGAMENTO_REGISTRADO, 'success');
      this._pushLogOperacional('Pagamento registrado', {
        valor,
        forma: this.pagamentoDraft.formaPagamento || 'DINHEIRO'
      });
      registrarLogOperacional('REGISTRAR_PAGAMENTO', {
        consignacaoId: this.consignacaoId,
        resultado: 'OK',
        detalhes: { valor }
      });
      this.pagamentoDraft.valor = '';
      this.pagamentoDraft.observacoes = '';
      // STAB-07.3 — soft refresh + patch só dos cards financeiros
      await this._loadData(true, { skipUi: true });
      if (!this._acceptContextToken(token)) return false;
      this._recalcularPainel();
      if (this.currentStep === STEP_RESUMO) {
        const patched = this._patchCentralOperacional(['financeiro', 'pagamentos']);
        if (!patched) this._updateContent();
        this._updateFooter();
        this._updateHeaderMeta();
      } else {
        this._updateUI();
      }
      return true;
    } catch (error) {
      if (!this._acceptContextToken(token)) return false;
      const humanizado = humanizarErroOperacional(error, 'pagamento');
      this.pagamentoErro = humanizado.mensagem;
      this._updateContent();
      return false;
    } finally {
      if (!this._acceptContextToken(token)) return false;
      this.loading.operation = false;
      this._updateFooter();
    }
  }

  /** Retornos → Resumo Final. Nunca registra pagamento. */
  _goNext() {
    const avancar = async () => {
      if (this.currentStep !== STEP_RETORNOS) return;

      this.salvandoConferencia = true;
      this.conferenciaAlerta = null;
      this._patchConferenciaAlerta();
      this._updateFooter();

      const resultado = await this.flushPendingChanges();

      this.salvandoConferencia = false;
      this._updateFooter();

      if (!resultado.ok) {
        notify(
          'Existem produtos que ainda não puderam ser registrados. Revise apenas os itens destacados.',
          'warning'
        );
        return;
      }

      if (temAlteracoesPendentes(this.resumoPrestacao?.itens || [])) {
        notify('Ainda existem alterações pendentes na grade. Aguarde a gravação.', 'warning');
        return;
      }

      await this._consolidarRetornosAntesAvancar();

      this.steps[STEP_RETORNOS].state = 'completed';
      this.currentStep = STEP_RESUMO;
      this.steps[STEP_RESUMO].state = 'current';

      await this._carregarFaturamentoResumo();
      this._updateUI();
      requestAnimationFrame(() => {
        this._recalcularPainel();
        this._patchPainelLateral(this.painel);
      });
    };

    avancar().catch((error) => {
      this.salvandoConferencia = false;
      this._updateFooter();
      notify(humanizarErroOperacional(error).mensagem, 'error');
    });
  }

  async _goBack() {
    if (this.currentStep !== STEP_RESUMO) return;

    this.steps[STEP_RESUMO].state = 'pending';
    this.currentStep = STEP_RETORNOS;
    this.steps[STEP_RETORNOS].state = 'current';
    this._recalcularPainel();
    this._updateUI();
    requestAnimationFrame(() => this._atualizarPainelPreview());
  }

  async _encerrarAtendimento() {
    return this._encerrarPrestacaoAposFaturamento();
  }

  /**
   * STAB-06 / 06.3 — Encerrar (sem emitir de novo). Emissão: _emitirNfcePrestacao.
   */
  async _finalizarComVendaOficial({ emitirFiscal = false, fechar = true, skipConfirm = false } = {}) {
    if (!this._canEncerrar()) {
      notify('Você não tem permissão para encerrar este atendimento.', 'warning');
      return;
    }

    const flush = await this.flushPendingChanges({ silent: true });
    if (!flush.ok || temAlteracoesPendentes(this.resumoPrestacao?.itens || [])) {
      notify('Existem alterações pendentes na grade. Corrija antes de encerrar.', 'warning');
      if (this.currentStep !== STEP_RETORNOS) {
        this.currentStep = STEP_RETORNOS;
        this._updateUI();
      }
      return;
    }

    if (!skipConfirm) {
      const confirmed = await confirmDialog({
        title: 'Encerrar Prestação',
        message: 'Confirma o encerramento desta prestação de contas?'
      });
      if (!confirmed) return;
    }

    if (!(await this._garantirPrestacaoAberta())) return;

    this.loading.operation = true;
    this._updateFooter();
    const t0 = Date.now();

    try {
      gradeForense.log('API', {
        evento: 'finalizarVendaOficial',
        nota: 'STAB-06.3: encerrar após faturamento',
        consignacaoId: this.consignacaoId
      });
      const resultado = await withLoading(
        MENSAGENS_HARDENING.ENCERRANDO,
        () => this.api.finalizarVendaOficial(this.consignacaoId, { emitirFiscal, fechar })
      );
      this.faturamento = resultado?.faturamento || this.faturamento;
      this._recalcularPainel();
      auditarFinalRC1({
        consignacao: this.consignacao || {},
        financeiro: this.snapshot?.financeiro || {},
        faturamento: this.faturamento,
        historico: this.historico || [],
        itens: this.resumoPrestacao?.itens || []
      });
      registrarLogEncerramento({
        consignacao: this.consignacao || {},
        financeiro: this.snapshot?.financeiro || {},
        faturamento: this.faturamento,
        usuario: null
      });
      registrarLogOperacional('ENCERRAR_PRESTACAO', {
        consignacaoId: this.consignacaoId,
        vendaOficial: this.faturamento?.vendaId || null,
        nfce: this.faturamento?.nfce || null,
        resultado: 'ENCERRADA',
        inicioMs: t0
      });
      notify(MENSAGENS_HARDENING.PRESTACAO_ENCERRADA, 'success');
      this._pushLogOperacional('Prestação encerrada', {
        vendaId: this.faturamento?.vendaId || null
      });
      this.encerrado = true;
      this.dataEncerramento = new Date();
      this.vendaOficial = resultado?.venda || { id: this.faturamento?.vendaId };
      this._recalcularPainel();
      if (this.currentStep === STEP_RESUMO) {
        this._patchCentralOperacional(['fiscal', 'info']);
      }

      const clienteId = this.consignacao?.clienteId || this.navigationContext.clienteId;
      if (clienteId) {
        try {
          this.clienteDetalhe = await buscarClientePorIdErp(clienteId);
        } catch (_error) {
          this.clienteDetalhe = null;
        }
      }

      logElectronFlow({
        evento: 'ATENDIMENTO_ENCERRADO',
        tela: 'CentralEncerramento',
        origem: this.navigationContext.origem || '-',
        cliente: clienteId,
        operacao: this.consignacaoId,
        vendaOficial: this.faturamento?.vendaId || null,
        recovery: 'n/a'
      });

      this.currentStep = STEP_ENCERRAMENTO;
      this.steps = inicializarMomentos(true);
      await this._loadData(true, { skipUi: true });
      this._updateUI();
      await this._gerarComprovantePrestacaoAposEncerrar({ autoPrint: false });
    } catch (error) {
      notify(humanizarErroOperacional(error).mensagem, 'error');
      registrarLogOperacional('ENCERRAR_PRESTACAO', {
        consignacaoId: this.consignacaoId,
        resultado: 'ERRO',
        detalhes: { message: String(error?.message || error) }
      });
    } finally {
      this.loading.operation = false;
      this._updateFooter();
    }
  }

  /**
   * RC2.1 — Comprovante de Prestação (Motor de Comprovantes), independente de NFC-e.
   */
  async _gerarComprovantePrestacaoAposEncerrar({ autoPrint = false } = {}) {
    try {
      await withLoading(
        'Gerando comprovante de prestação…',
        () => abrirComprovantePrestacao(this.consignacaoId, { imprimir: autoPrint })
      );
    } catch (error) {
      notify(
        humanizarErroOperacional(error).mensagem
          || 'Prestação encerrada, mas não foi possível gerar o comprovante.',
        'warning'
      );
      this._pushLogOperacional('Falha ao gerar comprovante de prestação', {
        erro: String(error?.message || error)
      });
    }
  }

  async _loadProximoAtendimento() {
    const token = this._captureContextToken();
    try {
      const clienteId = this.consignacao?.clienteId
        || this.operacaoContext?.clienteId
        || this.navigationContext.clienteId;
      if (!clienteId) return;

      const { items } = await this.api.listarConsignacoes({ clienteId, pageSize: 20 });
      if (!this._acceptContextToken(token)) return;
      this.proximoAtendimento = (items || []).find((c) => {
        const status = String(c.status || '').toUpperCase();
        return String(c.id) !== String(this.consignacaoId)
          && (status === 'EM_PRESTACAO' || status === 'ENTREGUE');
      }) || null;
    } catch {
      if (!this._acceptContextToken(token)) return;
      this.proximoAtendimento = null;
    }
  }

  async _handleEncerramentoAcao(acao) {
    const painel = this.painel;
    const clienteId = this.consignacao?.clienteId
      || this.navigationContext.clienteId
      || this.clienteDetalhe?.id;
    const clienteNome = this.clienteDetalhe?.nome
      || this.consignacao?.clienteNome
      || '';
    const saldoDevedor = Number(
      this.snapshot?.financeiro?.saldoEmAberto
      ?? painel?.saldoEmAberto
      ?? painel?.financeiro?.saldoEmAberto
      ?? 0
    );

    switch (acao) {
      case 'imprimir':
      case 'imprimir-comprovante':
        await imprimirComprovante(this.consignacao || this.consignacaoId);
        break;
      case 'pdf':
      case 'visualizar-comprovante':
        await visualizarComprovante(this.consignacao || this.consignacaoId);
        break;
      case 'pdf-download':
        await exportarComprovantePdf(this.consignacao || this.consignacaoId);
        break;
      case 'voltar-cliente':
        if (this.navigationContext.clienteId) {
          await navigate(`/clientes/${this.navigationContext.clienteId}`);
        }
        break;
      case 'voltar-central':
        markCentralArrivalGuard('voltar-central');
        logElectronFlow({
          evento: 'VOLTAR_CENTRAL',
          tela: 'CentralEncerramento',
          origem: 'encerramento',
          destino: '/',
          cliente: clienteId,
          operacao: this.consignacaoId
        });
        await navigate('/');
        break;
      case 'voltar':
        await navigate(resolveBackPath(this.navigationContext, '/consignacoes'));
        break;
      case 'conta-corrente': {
        if (!clienteId) {
          notify('Cliente não identificado para abrir a Conta Corrente.', 'warning');
          return;
        }
        const pathCc = buildRouteWithCentralTrabalhoContext('/conta-corrente', clienteId, {
          clienteNome,
          consignacaoId: this.consignacaoId
        });
        logElectronFlow({
          evento: 'IR_CONTA_CORRENTE',
          tela: 'CentralEncerramento',
          destino: pathCc,
          cliente: clienteId,
          operacao: this.consignacaoId
        });
        await navigate(pathCc);
        break;
      }
      case 'recebimento': {
        if (!clienteId) {
          notify('Cliente não identificado para registrar recebimento.', 'warning');
          return;
        }
        const pathRec = buildRouteWithCentralTrabalhoContext('/conta-corrente', clienteId, {
          clienteNome,
          consignacaoId: this.consignacaoId,
          acao: 'recebimento',
          valor: saldoDevedor
        });
        logElectronFlow({
          evento: 'IR_RECEBIMENTO',
          tela: 'CentralEncerramento',
          destino: pathRec,
          cliente: clienteId,
          operacao: saldoDevedor
        });
        await navigate(pathRec);
        break;
      }
      case 'proximo':
        if (this.proximoAtendimento) {
          const path = this._buildPrestacaoPath(this.proximoAtendimento.id);
          await navigate(path);
        }
        break;
      default:
        break;
    }
  }

  _buildPrestacaoPath(consignacaoId) {
    const clienteId = this.navigationContext.clienteId || this.consignacao?.clienteId;
    if (this.navigationContext.origem === ORIGEM_CENTRAL_TRABALHO) {
      return buildRouteWithCentralTrabalhoContext(`/consignacoes/${consignacaoId}/prestacao`, clienteId);
    }
    if (this.navigationContext.origem === ORIGEM_CLIENTE_360 && clienteId) {
      return buildRouteWithCliente360Context(`/consignacoes/${consignacaoId}/prestacao`, clienteId);
    }
    return `/consignacoes/${consignacaoId}/prestacao`;
  }

  async _handleCancel() {
    const confirmed = await confirmDialog({
      title: 'Sair do atendimento',
      message: 'Deseja sair da Prestação de Contas?'
    });
    if (!confirmed) return;

    // UX-12: nunca voltar para listas intermediárias (ex.: /consignacoes)
    const locator = buildRouteWithCentralTrabalhoContext(
      '/prestacao',
      this.navigationContext.clienteId || this.consignacao?.clienteId
    );
    await navigate(locator);
  }

  _updateUI() {
    if (!this._isAlive()) return;
    this._ensureStartAtRetornos();
    this._updateContent();
    this._updateHeaderMeta();
    this._updateFooter();
  }

  _ensureStartAtRetornos() {
    // STAB-07.1 — fluxo já inicia em Registrar Retornos (step 0)
    if (this.encerrado || this._startedAtRetornos) return;
    if (this.consignacao && !this.loading.consignacao) {
      this.currentStep = STEP_RETORNOS;
      this._startedAtRetornos = true;
      if (Array.isArray(this.steps)) {
        this.steps.forEach((s, i) => {
          s.state = i === STEP_RETORNOS ? 'current' : 'pending';
        });
      }
    }
  }

  _updateHeaderMeta() {
    if (!this._isAlive() || !this.root) return;
    const cliente = this._qs('#prestacao-cliente');
    const grupoEl = this._qs('#prestacao-grupo');
    const qtdEl = this._qs('#prestacao-qtd-consig');
    const documento = this._qs('#prestacao-documento');
    const situacao = this._qs('#prestacao-situacao');
    const financeiroEl = this._qs('#prestacao-financeiro');
    const fiscalEl = this._qs('#prestacao-fiscal');
    const synced = this._qs('#prestacao-synced');
    const persist = this._qs('#prestacao-persistencia');
    const subtitle = this.root.querySelector('.cds-workspace__subtitle');

    const nome = this.consignacao?.clienteNome
      || this.clienteDetalhe?.nome
      || this.consignacao?.cliente?.nome
      || '—';
    const doc = this.consignacao?.documento?.numero
      || this.consignacao?.documento
      || (this.consignacao?.id != null ? `C-${this.consignacao.id}` : '—');
    const grupoId = this.resumoPrestacao?.grupoPrestacaoContasId
      || this.consignacao?.prestacaoContasAtiva?.id
      || '—';
    const qtd = this.resumoPrestacao?.quantidadeConsignacoes
      || this.resumoPrestacao?.consignacoesCiclo?.length
      || 1;

    const financeiro = this.snapshot?.financeiro || this._syncSnapshotFinanceiro();
    const estado = this._estadoOperacionalAtual();
    const fiscal = resolverSituacaoFiscal(this.faturamento || {}, {
      emitindo: Boolean(this._emitindoNfce),
      valorVenda: financeiro.valorVenda
    });

    if (cliente) cliente.textContent = safeText(typeof nome === 'object' ? (nome.nome || '—') : nome);
    if (grupoEl) {
      const raw = String(grupoId);
      // Nunca exibir "—" se houver ponteiro de prestação na consignação
      const fromConsig = this.consignacao?.prestacaoContasAtiva?.id;
      const display = (raw && raw !== '—')
        ? raw
        : (fromConsig ? String(fromConsig) : '—');
      grupoEl.textContent = display.length > 28 ? `${display.slice(0, 24)}…` : display;
      grupoEl.title = display;
    }
    if (qtdEl) qtdEl.textContent = String(qtd);
    if (documento) documento.textContent = safeText(typeof doc === 'object' ? (doc.numero || '—') : doc);
    if (situacao) situacao.textContent = safeText(labelEstadoPrestacao(estado));
    if (financeiroEl) {
      financeiroEl.textContent = safeText(labelSituacaoFinanceiraOficial(financeiro.situacaoFinanceira));
    }
    if (fiscalEl) fiscalEl.textContent = safeText(fiscal.label);
    if (synced) {
      this.lastSyncedAt = new Date();
      synced.textContent = `Atualizado: ${this.lastSyncedAt.toLocaleTimeString('pt-BR')}`;
    }
    if (persist) {
      persist.textContent = labelStatusPersistencia(this.persistenciaStatus);
      persist.dataset.status = this.persistenciaStatus;
    }
    if (subtitle) subtitle.textContent = this._momentoLabel();
  }

  _updateContent() {
    if (!this._isAlive()) return;
    const shell = this._qs('#fechar-consignacao-content');
    if (!shell) return;

    const focusSnapshot = this.focus?.campo
      ? { ...this.focus }
      : null;

    shell.innerHTML = '';

    if (this.loading.consignacao || this.loading.prestacao) {
      shell.appendChild(Loading.create({ message: 'Carregando atendimento...' }));
    } else if (this.error) {
      shell.appendChild(Alert.create({
        message: 'Erro ao carregar: ' + this.error.message,
        variant: 'error',
        dismissible: true
      }));
    } else if (!this.consignacao) {
      shell.appendChild(EmptyState.create({
        title: 'Consignação não encontrada',
        description: 'O documento solicitado não existe'
      }));
    } else {
      shell.appendChild(this._renderTimelineBar());
      shell.appendChild(this._renderMomentoAtual());
    }

    if (focusSnapshot && focusSnapshot.rowIndex >= 0) {
      requestAnimationFrame(() => {
        if (!this._isAlive()) return;
        this._focusCampo(focusSnapshot.rowIndex, focusSnapshot.campo);
      });
    } else {
      const auto = shell.querySelector('[data-autofocus="true"]');
      if (auto) {
        requestAnimationFrame(() => {
          if (!this._isAlive()) return;
          auto.focus();
          if (typeof auto.select === 'function') auto.select();
        });
      }
    }

    if (this.currentStep === STEP_RETORNOS && this.resumoPrestacao?.itens?.length) {
      requestAnimationFrame(() => {
        if (!this._isAlive()) return;
        this._atualizarPainelPreview();
      });
    } else if (this.currentStep >= STEP_RESUMO && this.resumoPrestacao?.itens?.length) {
      requestAnimationFrame(() => {
        if (!this._isAlive()) return;
        this._recalcularPainel();
      });
    }
  }

  _updateStepper() {
    this._updateHeaderMeta();
  }

  _updateSidebar() {
    // UX-12: sidebar removida — grade ocupa o body
  }

  _updateFooter() {
    if (!this._isAlive() || !this.root) return;
    Workspace.compose(this.root, {
      footer: this._buildWorkspaceFooter()
    });
  }

  _startAutoRefresh() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = setInterval(() => {
      if (!this._isAlive()) {
        if (this.refreshTimer) {
          clearInterval(this.refreshTimer);
          this.refreshTimer = null;
        }
        return;
      }
      // Só refresca se ESTE root ainda estiver no documento (não o da próxima tela).
      if (!this.root?.isConnected) {
        this.destroy();
        return;
      }
      if (this.loading.operation || this.encerrado || this.editing.rowIndex >= 0) return;
      if (this.root.querySelector('#fechar-retornos-grade')
        && document.activeElement?.closest?.('#fechar-retornos-grade')) {
        return;
      }
      // Consulta SOMENTE a consignação/prestação aberta nesta estação.
      this._loadData(true);
    }, 45000);
  }

  _formatCurrency(value) {
    return formatCurrency(value);
  }
}

module.exports = PrestacaoContasPage;
