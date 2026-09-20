/**
 * Central de Trabalho Comercial — UX-03 / UX-09 / UX-10 / UX-21.
 *
 * UX-21: Centro de Operações (Shared UI Workspace). Sem alterar regras/APIs.
 *
 * @module frontend/modules/motor-comercial/pages/Dashboard
 */

const ProjectionApi = require('../../api/ProjectionApi');
const MotorComercialApi = require('../../api/MotorComercialApi');
const CentralTrabalhoView = require('./CentralTrabalhoView');
const RecebimentoRapidoModal = require('./RecebimentoRapidoModal');
const { buildCentralTrabalhoViewModel } = require('./centralTrabalhoMappers');
const {
  consignacaoElegivelParaPrestacao,
  mensagemErroOperacional
} = require('../PrestacaoContas/fecharConsignacaoMappers');
const { buildRouteWithCentralTrabalhoContext } = require('../../utils/cliente360Context');
const { navigate, notify, withLoading, getUsuarioId } = require('../../utils/operacional');
const {
  isCentralActionBlocked,
  logElectronFlow,
  clearCentralArrivalGuard
} = require('../../utils/electronNavigationGuard');
const {
  notifySuccess,
  notifyWarning,
  notifyInfo,
  notifyError,
  loadingText
} = require('../../messages');

const REFRESH_INTERVAL_MS = 60000;

function getOperadorAuditoria() {
  try {
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    return {
      usuarioId: getUsuarioId(),
      usuarioNome: user?.nome || user?.username || `usuario:${getUsuarioId()}`
    };
  } catch {
    return { usuarioId: getUsuarioId(), usuarioNome: null };
  }
}

class DashboardPage {
  constructor() {
    this.projectionApi = new ProjectionApi();
    this.api = new MotorComercialApi();
    this.viewModel = {};
    this.refreshTimer = null;
  }

  static create() {
    return new DashboardPage().render();
  }

  render() {
    this.root = CentralTrabalhoView.renderLoading();
    this.root.classList.add('cds-central-trabalho-host');

    setTimeout(() => {
      this._loadData();
      this._startAutoRefresh();
    }, 0);

    return this.root;
  }

  _getCtx() {
    return {
      formatCurrency: (v) => this._formatCurrency(v),
      formatDate: (v) => this._formatDate(v),
      onAtualizar: () => this._loadData(),
      onAcao: (acao) => this._executarAcao(acao),
      onAtalho: (atalho) => this._executarAtalho(atalho),
      onReceber: (item) => this._abrirRecebimentoContaCorrente(item)
    };
  }

  async _loadData() {
    try {
      const [
        dashboard,
        indicadores,
        timeline,
        historico,
        pendencias,
        consignacoesResult,
        perfisResult
      ] = await Promise.all([
        this.projectionApi.obterProjecaoDashboard({}).catch(() => ({})),
        this.projectionApi.obterProjecaoIndicadores({}).catch(() => ({})),
        this.projectionApi.listarTimeline({ limite: 20 }).catch(() => []),
        this.projectionApi.listarMovimentacoes({ limite: 20 }).catch(() => []),
        this.projectionApi.obterProjecaoPendencias({}).catch(() => ({})),
        this.api.listarConsignacoes({ pageSize: 100 }).catch(() => ({ items: [] })),
        this.api.listarPerfis({ pageSize: 200 }).catch(() => ({ items: [] }))
      ]);

      this.viewModel = buildCentralTrabalhoViewModel({
        dashboard,
        indicadores,
        timeline,
        historico,
        pendencias,
        consignacoes: consignacoesResult.items || [],
        perfis: perfisResult.items || []
      });

      this._renderView();
    } catch (error) {
      console.error('[Central de Trabalho]', error);
    }
  }

  _renderView() {
    const next = CentralTrabalhoView.render(this.viewModel, this._getCtx());
    next.classList.add('cds-central-trabalho-host');

    const current = this.root && document.body.contains(this.root)
      ? this.root
      : document.getElementById('central-trabalho-root')
        || document.querySelector('.cds-central-trabalho-host');

    if (current && current.parentNode) {
      current.parentNode.replaceChild(next, current);
    }

    this.root = next;

    logElectronFlow({
      evento: 'CENTRAL_RENDER',
      tela: 'CentralTrabalho',
      cliente: this.viewModel.trabalhoPrioritario?.[0]?.clienteNome || '-',
      operacao: this.viewModel.acaoPrincipal?.label || '-',
      router: '/'
    });
  }

  _executarAcao(acao = {}) {
    if (isCentralActionBlocked()) {
      logElectronFlow({
        evento: 'ACAO_BLOQUEADA_GUARD',
        tela: 'CentralTrabalho',
        origem: 'click-residual',
        destino: acao.acaoTipo,
        cliente: acao.clienteId || acao.clienteNome,
        operacao: acao.label || acao.acaoLabel
      });
      return;
    }
    clearCentralArrivalGuard();

    const clienteId = acao.clienteId;
    let consignacaoId = acao.consignacaoId;
    let tipo = acao.acaoTipo;

    logElectronFlow({
      evento: 'CENTRAL_ACAO',
      tela: 'CentralTrabalho',
      origem: 'user',
      destino: tipo,
      cliente: clienteId || acao.clienteNome,
      operacao: consignacaoId || acao.label
    });

    if (tipo === 'prestacao' && !consignacaoId && clienteId) {
      const lista = this.viewModel.proximosFechamentos
        || this.viewModel.proximasPrestacoes
        || [];
      const candidato = lista.find(
        (p) => String(p.clienteId) === String(clienteId)
      );
      consignacaoId = candidato?.consignacaoId;
    }

    if (tipo === 'prestacao' && consignacaoId) {
      const consignacao = this.viewModel.consignacoesById?.[String(consignacaoId)];
      if (consignacao && !consignacaoElegivelParaPrestacao(consignacao)) {
        tipo = 'entrega';
      }
    }

    if (tipo === 'nova-consignacao') {
      const path = clienteId
        ? buildRouteWithCentralTrabalhoContext('/consignacoes/nova', clienteId)
        : '/consignacoes/nova?origem=central';
      navigate(path);
      return;
    }

    if (tipo === 'entrega' && consignacaoId) {
      const path = clienteId
        ? buildRouteWithCentralTrabalhoContext(`/consignacoes/${consignacaoId}/entrega`, clienteId)
        : `/consignacoes/${consignacaoId}/entrega?origem=central`;
      navigate(path);
      return;
    }

    // RCM-8.9 — Entrega Complementar da consignação do card (nunca só por clienteId)
    if (tipo === 'entrega-complementar') {
      if (consignacaoId == null || consignacaoId === '') {
        notify('Não foi possível identificar a consignação do card.', 'warning');
        return;
      }
      if (this._entregaComplementarNavLock) return;
      this._entregaComplementarNavLock = true;
      const path = clienteId
        ? buildRouteWithCentralTrabalhoContext(
          `/consignacoes/${consignacaoId}/entrega-complementar`,
          clienteId
        )
        : `/consignacoes/${consignacaoId}/entrega-complementar?origem=central`;
      try {
        navigate(path);
      } finally {
        setTimeout(() => {
          this._entregaComplementarNavLock = false;
        }, 800);
      }
      return;
    }

    if (tipo === 'prestacao' && consignacaoId) {
      const path = clienteId
        ? buildRouteWithCentralTrabalhoContext(`/consignacoes/${consignacaoId}/prestacao`, clienteId)
        : `/consignacoes/${consignacaoId}/prestacao?origem=central`;
      navigate(path);
      return;
    }

    if (tipo === 'conta-corrente' && clienteId) {
      navigate(buildRouteWithCentralTrabalhoContext('/conta-corrente', clienteId));
      return;
    }

    if (tipo === 'pendencias') {
      navigate('/pendencias?origem=central');
      return;
    }

    if (clienteId) {
      navigate(`/clientes/${clienteId}`);
    }
  }

  _executarAtalho(atalho = {}) {
    switch (atalho.acaoTipo) {
      case 'novo-cliente':
        navigate('/clientes/novo');
        break;
      case 'nova-consignacao':
        navigate('/consignacoes/nova?origem=central');
        break;
      case 'prestacao-locator':
        navigate('/prestacao?origem=central');
        break;
      case 'central-clientes':
        navigate('/clientes');
        break;
      case 'relatorios':
        navigate('/relatorios');
        break;
      default:
        if (atalho.acaoTipo) this._executarAcao(atalho);
        break;
    }
  }

  /**
   * Prepara recebimento da Conta Corrente Comercial (E5).
   * Operação diária do operador — sem senha/autorização gerencial.
   */
  async _prepararRecebimentoContaCorrente(consignacaoId) {
    const consignacao = await this.api.obterConsignacao(consignacaoId);
    if (!consignacao) {
      throw new Error('Documento comercial não encontrado para recebimento.');
    }

    const status = String(consignacao.status || '').toUpperCase();
    const prest = consignacao.prestacaoContasAtiva;
    const prestAberta = Boolean(prest && String(prest.status || '').toUpperCase() === 'ABERTA');

    if (status === 'QUITADA') {
      throw new Error(
        'Esta dívida já está quitada. O cliente será removido da fila na próxima atualização.'
      );
    }

    if (prestAberta || status === 'EM_PRESTACAO') {
      return consignacao;
    }

    if (status === 'ENTREGUE') {
      await this.api.abrirPrestacao(consignacaoId);
      return this.api.obterConsignacao(consignacaoId);
    }

    if (status === 'ACERTADA' || status === 'ENCERRADA') {
      return consignacao;
    }

    throw new Error(
      `Não é possível registrar recebimento nesta Conta Corrente (status ${status || 'desconhecido'}).`
    );
  }

  /**
   * Modal de Recebimento da Conta Corrente Comercial (dívida pós-encerramento).
   */
  _abrirRecebimentoContaCorrente(item = {}) {
    if (isCentralActionBlocked()) return;
    clearCentralArrivalGuard();

    if (!item.consignacaoId) {
      notifyWarning('SEM_DIVIDA_ELEGIVEL');
      return;
    }

    if (String(item.statusConsignacao || '').toUpperCase() === 'QUITADA') {
      notifyInfo('CLIENTE_QUITADO_FILA');
      this._loadData();
      return;
    }

    logElectronFlow({
      evento: 'CENTRAL_RECEBER_CONTA_CORRENTE',
      tela: 'CentralTrabalho',
      origem: 'user',
      destino: 'modal-conta-corrente',
      cliente: item.clienteId || item.clienteNome,
      operacao: item.consignacaoId
    });

    RecebimentoRapidoModal.open({
      item: {
        ...item,
        origemRecebimento: 'conta-corrente-comercial',
        tituloContexto: 'Conta Corrente Comercial'
      },
      formatCurrency: (v) => this._formatCurrency(v),
      onConfirm: async ({ valor, formaPagamento, observacao }) => {
        try {
          const preparada = await this._prepararRecebimentoContaCorrente(item.consignacaoId);
          const prest = preparada?.prestacaoContasAtiva;
          const prestAberta = Boolean(prest && String(prest.status || '').toUpperCase() === 'ABERTA');

          const auditoria = getOperadorAuditoria();
          const resultado = await withLoading(
            loadingText('REGISTRANDO_RECEBIMENTO'),
            () => this.api.registrarPagamento(item.consignacaoId, {
              valor,
              formaPagamento: formaPagamento || 'DINHEIRO',
              observacao: observacao || null,
              usuarioId: auditoria.usuarioId,
              origem: 'CONTA_CORRENTE_COMERCIAL',
              auditoria: {
                operadorId: auditoria.usuarioId,
                operadorNome: auditoria.usuarioNome,
                documento: item.documentoConsignacao || item.documento || null,
                registradoEm: new Date().toISOString()
              }
            })
          );

          const saldoPos = Number(
            resultado?.totais?.saldo
            ?? resultado?.dados?.totais?.saldo
            ?? NaN
          );
          const valorPago = Number(valor) || 0;
          const valorAberto = Number(item.valorEmAberto) || 0;
          const quitou = (Number.isFinite(saldoPos) && saldoPos <= 0)
            || (valorAberto > 0 && valorPago >= valorAberto - 0.009);

          if (quitou && prestAberta) {
            try {
              await withLoading(
                'Atualizando Conta Corrente...',
                () => this.api.fecharPrestacao(item.consignacaoId, { usuarioId: auditoria.usuarioId })
              );
            } catch (closeError) {
              console.warn('[Central Conta Corrente] fecharPrestacao:', closeError);
            }
          }
          if (quitou) {
            notifySuccess('RECEBIMENTO_QUITADO');
          } else {
            notifySuccess('RECEBIMENTO_PARCIAL');
          }

          await this._loadData();
        } catch (error) {
          const msg = mensagemErroOperacional(error.message, 'pagamento');
          notifyError(msg);
          if (/QUITADA/i.test(error.message || '')) {
            await this._loadData();
          }
          throw new Error(msg);
        }
      }
    });
  }

  /** Compat: alias do recebimento Conta Corrente */
  _abrirRecebimento(item = {}) {
    return this._abrirRecebimentoContaCorrente(item);
  }

  _formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);
  }

  _formatDate(value) {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
  }

  _startAutoRefresh() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = setInterval(() => {
      if (!document.getElementById('central-trabalho-root')) {
        clearInterval(this.refreshTimer);
        return;
      }
      this._loadData();
    }, REFRESH_INTERVAL_MS);
  }
}

module.exports = DashboardPage;
