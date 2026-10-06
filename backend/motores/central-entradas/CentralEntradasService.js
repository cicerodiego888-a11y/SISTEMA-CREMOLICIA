/**
 * CentralEntradasService — Fachada oficial da Central Inteligente de Entradas.
 *
 * Sprint 2: listagem paginada, dashboard, detalhe, histórico e máquina de estados.
 *
 * @class CentralEntradasService
 */

const centralEntradasFlags = require('./config/centralEntradasFlags');
const CentralDocumentoService = require('./services/CentralDocumentoService');
const CentralHistoricoService = require('./services/CentralHistoricoService');
const CentralDashboardService = require('./services/CentralDashboardService');
const CentralSincronizacaoService = require('./services/CentralSincronizacaoService');
const CentralProcessamentoService = require('./services/CentralProcessamentoService');
const CentralComprasBridgeService = require('./services/CentralComprasBridgeService');
const CentralScoreDocumentoService = require('./services/CentralScoreDocumentoService');
const CentralAlertasService = require('./services/CentralAlertasService');
const CentralScoreFornecedorService = require('./services/CentralScoreFornecedorService');
const CentralPendenciasService = require('./services/CentralPendenciasService');
const CentralOperacionalDashboardService = require('./services/CentralOperacionalDashboardService');
const CentralAtencaoService = require('./services/CentralAtencaoService');
const { listarPresets } = require('./utils/filtrosRapidosCentral');
const CentralConfigService = require('./services/CentralConfigService');
const CentralEventosService = require('./services/CentralEventosService');
const CentralNotificacoesService = require('./services/CentralNotificacoesService');
const CentralUploadService = require('./services/CentralUploadService');
const CentralEntradasOrchestrator = require('./CentralEntradasOrchestrator');
const CentralNsuControleService = require('./services/CentralNsuControleService');
const CentralManifestacaoService = require('./services/CentralManifestacaoService');
const CentralMirxService = require('./services/CentralMirxService');
const CentralHealthMonitorService = require('./services/CentralHealthMonitorService');
const CentralDiagnosticoService = require('./services/CentralDiagnosticoService');
const sefazGate = require('./services/CentralSefazOperationalGate');
const centralSyncExecucao = require('./services/CentralSyncExecucaoService');
const centralSyncBackground = require('./services/CentralSyncBackgroundService');
const centralXmlWaitScheduler = require('./services/CentralXmlWaitScheduler');
const { ORIGENS } = require('./config/centralEventosTipos');
const CentralDocumentosRepository = require('./repositories/CentralDocumentosRepository');
const CentralHistoricoRepository = require('./repositories/CentralHistoricoRepository');
const CentralNsuRepository = require('./repositories/CentralNsuRepository');
const { validarTransicao } = require('./core/MaquinaEstadosDocumento');
const { TODOS: STATUS_TODOS, LABELS_UI, isValido } = require('./core/DocumentoFiscalStatus');
const { paraDetalheCompletoDTO } = require('./utils/centralEntradasMapper');

const VERSAO_MODULO = '1.0.0-ce01';

class CentralEntradasService {
  /**
   * @param {Object} [deps]
   * @param {Object|null} [deps.db]
   */
  constructor(deps = {}) {
    /** @private */
    this._db = deps.db ?? null;
    /** @private */
    this._flags = deps.flags ?? centralEntradasFlags;

    const repoDeps = { db: this._db };
    const documentosRepository = new CentralDocumentosRepository(repoDeps);
    const historicoRepository = new CentralHistoricoRepository(repoDeps);
    const nsuRepository = new CentralNsuRepository(repoDeps);

    /** @private */
    this._documentosRepository = documentosRepository;
    /** @private */
    this._documentoService = deps.documentoService
      ?? new CentralDocumentoService({ documentosRepository });
    /** @private */
    this._historicoService = deps.historicoService
      ?? new CentralHistoricoService({ historicoRepository });
    /** @private */
    this._dashboardService = deps.dashboardService
      ?? new CentralDashboardService({ documentosRepository, nsuRepository });
    /** @private */
    this._sincronizacaoService = deps.sincronizacaoService
      ?? new CentralSincronizacaoService();
    /** @private */
    this._processamentoService = deps.processamentoService
      ?? new CentralProcessamentoService({ documentosRepository, historicoRepository });
    /** @private */
    this._comprasBridgeService = deps.comprasBridgeService
      ?? new CentralComprasBridgeService({ documentosRepository, historicoRepository });
    /** @private */
    this._scoreDocumentoService = deps.scoreDocumentoService
      ?? new CentralScoreDocumentoService();
    /** @private */
    this._alertasService = deps.alertasService
      ?? new CentralAlertasService({ documentosRepository, nsuRepository });
    /** @private */
    this._scoreFornecedorService = deps.scoreFornecedorService
      ?? new CentralScoreFornecedorService({ documentosRepository, scoreService: this._scoreDocumentoService });
    /** @private */
    this._pendenciasService = deps.pendenciasService
      ?? new CentralPendenciasService({ documentosRepository, nsuRepository });
    /** @private */
    this._operacionalService = deps.operacionalService
      ?? new CentralOperacionalDashboardService({ documentosRepository, nsuRepository });
    /** @private */
    this._atencaoService = deps.atencaoService
      ?? new CentralAtencaoService({ documentosRepository, nsuRepository });
    /** @private */
    this._configService = deps.configService ?? new CentralConfigService();
    /** @private */
    this._eventosService = deps.eventosService ?? new CentralEventosService();
    /** @private */
    this._notificacoesService = deps.notificacoesService ?? new CentralNotificacoesService();
    /** @private */
    this._uploadService = deps.uploadService ?? new CentralUploadService();
    this._nsuRepository = nsuRepository;
    this._nsuControleService = deps.nsuControleService
      ?? new CentralNsuControleService({ nsuRepository, documentosRepository });
    this._mirxService = deps.mirxService
      ?? new CentralMirxService({
        documentosRepository,
        historicoService: this._historicoService,
        processamentoService: this._processamentoService
      });
    this._manifestacaoService = deps.manifestacaoService
      ?? new CentralManifestacaoService({ documentosRepository, configService: this._configService });
    this._orchestrator = deps.orchestrator
      ?? new CentralEntradasOrchestrator({
        documentosRepository,
        historicoService: this._historicoService,
        processamentoService: this._processamentoService,
        sincronizacaoService: this._sincronizacaoService,
        comprasBridgeService: this._comprasBridgeService
      });
    this._healthMonitor = deps.healthMonitor
      ?? new CentralHealthMonitorService({
        documentosRepository,
        nsuRepository,
        eventosService: this._eventosService,
        nsuControleService: this._nsuControleService,
        flags: this._flags
      });
    this._diagnosticoService = deps.diagnosticoService
      ?? new CentralDiagnosticoService({
        documentosRepository,
        nsuControleService: this._nsuControleService,
        eventosService: this._eventosService
      });
  }

  /**
   * @returns {boolean}
   */
  estaHabilitado() {
    return this._flags.estaHabilitado();
  }

  /**
   * @returns {Promise<Object>}
   */
  async obterHealth() {
    return this._healthMonitor.obter({
      versao: VERSAO_MODULO,
      sprint: 'CE-01'
    });
  }

  /**
   * @returns {Object}
   */
  obterMetadados() {
    return {
      modulo: 'Central Inteligente de Entradas',
      versao: VERSAO_MODULO,
      descricao: 'Caixa de Entrada Fiscal (Inbox) — sincroniza, armazena, organiza, monitora e disponibiliza documentos',
      estados: STATUS_TODOS.map((status) => ({
        codigo: status,
        label: LABELS_UI[status] || status
      })),
      filtrosRapidos: listarPresets()
    };
  }

  /**
   * @param {Object} [filtros]
   * @returns {Promise<{ documentos: Object[], paginacao: Object }>}
   */
  async listarDocumentos(filtros = {}) {
    return this._documentoService.listar(filtros);
  }

  /**
   * @param {number|string} id
   * @returns {Promise<Object|null>}
   */
  async obterDocumento(id) {
    return this._documentoService.obterPorId(id);
  }

  /**
   * @param {number|string} id
   * @returns {Promise<Object|null>}
   */
  async obterDocumentoDetalhe(id) {
    const documento = await this._documentoService.obterBrutoPorId(id);
    if (!documento) return null;

    const historico = await this._historicoService.listarPorDocumento(id);
    return paraDetalheCompletoDTO(documento, historico);
  }

  /**
   * @param {number|string} documentoId
   * @returns {Promise<Object[]>}
   */
  async obterHistorico(documentoId) {
    return this._historicoService.listarPorDocumento(documentoId);
  }

  /**
   * @returns {Promise<Object>}
   */
  async obterDashboard() {
    return this._dashboardService.obterResumo();
  }

  /**
   * @param {number|string} id
   * @param {string} novoStatus
   * @param {Object} [opcoes]
   * @returns {Promise<Object>}
   */
  async alterarStatus(id, novoStatus, opcoes = {}) {
    const documento = await this._documentoService.obterBrutoPorId(id);

    if (!documento) {
      const erro = new Error('Documento não encontrado');
      erro.statusCode = 404;
      throw erro;
    }

    if (!isValido(novoStatus)) {
      const erro = new Error(`Status inválido: ${novoStatus}`);
      erro.statusCode = 400;
      throw erro;
    }

    const validacao = validarTransicao(documento.status, novoStatus);
    if (!validacao.valido) {
      const erro = new Error(validacao.erro);
      erro.statusCode = 400;
      throw erro;
    }

    const atualizado = await this._documentoService.atualizar(id, {
      status: novoStatus,
      statusDetalhe: opcoes.detalhe ?? null,
      usuarioId: opcoes.usuarioId ?? null
    });

    if (documento.status !== novoStatus) {
      await this._historicoService.registrar({
        documentoId: id,
        statusAnterior: documento.status,
        statusNovo: novoStatus,
        usuarioId: opcoes.usuarioId ?? null,
        detalhe: opcoes.detalhe
          ?? `Transição: ${documento.status} → ${novoStatus}`
      });
    }

    return atualizado;
  }

  /**
   * @returns {Promise<Object>}
   */
  async sincronizar(opcoes = {}) {
    return centralSyncExecucao.executar({
      origem: opcoes.origem || ORIGENS.MANUAL,
      ignorarHorario: true
    });
  }

  /**
   * Sincronização ao abrir a Central (respeita mutex).
   *
   * @returns {Promise<Object|null>}
   */
  async sincronizarAoAbrir() {
    const cfg = await this._configService.obterResumo();
    if (!cfg.syncAoAbrir) {
      return {
        sucesso: true,
        ignorado: true,
        motivo: 'sync_ao_abrir desabilitado',
        operacional: true
      };
    }
    return this.sincronizar({ origem: ORIGENS.ABRIR_CENTRAL });
  }

  /**
   * Abre a Central sem consultar a SEFAZ.
   *
   * @returns {Promise<Object>}
   */
  async abrirCentral() {
    const [health, dashboard] = await Promise.all([
      this.obterHealth(),
      this.obterDashboard()
    ]);

    const sefazDisponivel = health.sefazDisponivel !== false;
    return {
      sucesso: true,
      centralAberta: true,
      sefazDisponivel,
      health,
      dashboard,
      nsu: health.nsu || dashboard.sincronizacao || null,
      ultimaSincronizacaoNsu: dashboard.sincronizacao?.dataSincronizacao || dashboard.ultimaSincronizacao || null,
      ultimaTentativaSync: health.ultimaExecucaoAutomatica || null,
      mensagem: sefazDisponivel
        ? 'Central aberta'
        : 'Central aberta — SEFAZ indisponível'
    };
  }

  /**
   * Upload manual de XML — reutiliza persistência DF-e + pipeline oficial.
   *
   * @param {Object[]} arquivos
   * @param {Object} [opcoes]
   * @returns {Promise<Object>}
   */
  async uploadDocumentos(arquivos = [], opcoes = {}) {
    return this._uploadService.processarUpload(arquivos, opcoes);
  }

  /**
   * @param {string} chave
   * @returns {Promise<Object>}
   */
  async buscarPorChave(chave) {
    return this._sincronizacaoService.buscarPorChave(chave);
  }

  /**
   * @param {number|string} id
   * @returns {Promise<{ xml: string }|null>}
   */
  async obterXmlDocumento(id) {
    const documento = await this._documentosRepository.buscarPorId(id);
    if (!documento || !documento.xml) return null;

    return {
      id: documento.id,
      chave: documento.chave,
      xml: documento.xml
    };
  }

  /**
   * Parse persistido (somente leitura — não gera parse).
   *
   * @param {number|string} id
   * @returns {Promise<Object|null>}
   */
  async obterParseDocumento(id) {
    const documento = await this._documentosRepository.buscarPorId(id);
    if (!documento) return null;

    return {
      id: documento.id,
      chave: documento.chave,
      parseDisponivel: Boolean(documento.parseJson),
      parse: documento.parseJson || null,
      miipResumo: documento.miipResumoJson || null,
      processadoEm: documento.processadoEm || null
    };
  }

  /**
   * @param {number|string} id
   * @param {Object} [opcoes]
   * @returns {Promise<Object>}
   */
  async processarDocumento(id, opcoes = {}) {
    return this._orchestrator.processar(id, opcoes);
  }

  /**
   * @param {number|string} id
   * @param {Object} [opcoes]
   * @returns {Promise<Object>}
   */
  async recuperarXmlDocumento(id, opcoes = {}) {
    return this._orchestrator.recuperarXml(id, opcoes);
  }

  /**
   * @param {number|string} id
   * @param {Object} [opcoes]
   * @returns {Promise<Object>}
   */
  async reprocessarDocumento(id, opcoes = {}) {
    return this._mirxService.reprocessar(id, opcoes);
  }

  /**
   * @param {number|string} id
   * @param {string} tipo
   * @param {Object} [opcoes]
   * @returns {Promise<Object>}
   */
  async prepararManifestacao(id, tipo, opcoes = {}) {
    return this._manifestacaoService.preparar(id, tipo, opcoes);
  }

  /**
   * @returns {Promise<Object>}
   */
  async obterDiagnostico() {
    return this._diagnosticoService.obter();
  }

  /**
   * @returns {Promise<Object>}
   */
  async obterControleNsu() {
    return this._nsuControleService.obterEstado();
  }

  /**
   * @param {number|string} id
   * @param {Object} [dados]
   * @returns {Promise<Object>}
   */
  async concluirRevisao(id, dados = {}) {
    return this._comprasBridgeService.concluirRevisao(id, dados);
  }

  /**
   * @param {number|string} id
   * @returns {Promise<Object>}
   */
  async obterPayloadCompra(id) {
    return this._comprasBridgeService.montarPayloadAbrirCompra(id);
  }

  /**
   * @param {number|string} id
   * @param {Object} [opcoes]
   * @returns {Promise<Object>}
   */
  async abrirCompra(id, opcoes = {}) {
    return this._comprasBridgeService.registrarAberturaCompra(id, opcoes);
  }

  /**
   * @param {number|string} documentoId
   * @param {number|string} compraId
   * @param {Object} [opcoes]
   * @returns {Promise<Object>}
   */
  async vincularCompra(documentoId, compraId, opcoes = {}) {
    return this._comprasBridgeService.vincularCompra(documentoId, compraId, opcoes);
  }

  /**
   * @returns {Promise<Object>}
   */
  async listarAlertas() {
    return this._alertasService.listarAlertas();
  }

  /**
   * @param {Object} [opcoes]
   * @returns {Promise<Object>}
   */
  async obterPendencias(opcoes = {}) {
    return this._pendenciasService.obterPendencias(opcoes);
  }

  /**
   * @returns {Promise<Object>}
   */
  async obterOperacional() {
    return this._operacionalService.obterIndicadores();
  }

  /**
   * @returns {Promise<Object>}
   */
  async obterItensAtencao() {
    return this._atencaoService.obterItensAtencao();
  }

  /**
   * @param {number|string} id
   * @returns {Promise<Object|null>}
   */
  async obterScoreDocumento(id) {
    const documento = await this._documentosRepository.buscarPorId(id);
    if (!documento) return null;

    const score = this._scoreDocumentoService.calcular(documento);
    return {
      documentoId: documento.id,
      chave: documento.chave,
      parseDisponivel: Boolean(documento.parseJson),
      miipDisponivel: Boolean(documento.miipResumoJson || documento.miipSessaoId),
      scoreGeral: score.scoreGeral,
      scoreCor: score.cor,
      fatores: score.fatores,
      detalhes: score.detalhes,
      resumo: documento.miipResumoJson?.resumo || null,
      processadoEm: documento.processadoEm || null
    };
  }

  /**
   * @param {string} cnpj
   * @param {Object} [opcoes]
   * @returns {Promise<Object|null>}
   */
  async obterEstatisticasFornecedor(cnpj, opcoes = {}) {
    return this._scoreFornecedorService.obterEstatisticas(cnpj, opcoes);
  }

  /**
   * @returns {Promise<Object>}
   */
  async obterConfiguracoes() {
    return this._configService.obterResumo();
  }

  /**
   * @param {Object} alteracoes
   * @returns {Promise<Object>}
   */
  async atualizarConfiguracoes(alteracoes) {
    const { emitirEvento, TIPOS_EVENTO } = require('./utils/centralEventosEmitter');
    const resultado = await this._configService.atualizar(alteracoes);
    await emitirEvento({
      tipo: TIPOS_EVENTO.CONFIG_ALTERADA,
      origem: 'api',
      descricao: 'Configurações da Central atualizadas',
      resultado: 'sucesso',
      sucesso: true,
      detalhe: alteracoes
    });
    await centralSyncBackground.reiniciar();
    await centralXmlWaitScheduler.reiniciar();
    return resultado;
  }

  /**
   * @param {Object} [filtros]
   * @returns {Promise<Object>}
   */
  async listarEventos(filtros = {}) {
    return this._eventosService.listarLog(filtros);
  }

  /**
   * @returns {Promise<Object>}
   */
  obterStatusServico() {
    return {
      ...centralSyncBackground.obterStatus(),
      xmlWait: centralXmlWaitScheduler.obterStatus(),
      sefaz: sefazGate.obterEstado()
    };
  }

  /**
   * @param {Object} [filtros]
   * @returns {Promise<Object>}
   */
  async listarNotificacoes(filtros = {}) {
    const [notificacoes, naoLidas] = await Promise.all([
      this._notificacoesService.listar(filtros),
      this._notificacoesService.contarNaoLidas()
    ]);
    return { notificacoes, naoLidas };
  }

  /**
   * @param {number|string} id
   * @returns {Promise<boolean>}
   */
  async marcarNotificacaoLida(id) {
    return this._notificacoesService.marcarLida(id);
  }

  /**
   * @returns {Promise<number>}
   */
  async marcarTodasNotificacoesLidas() {
    return this._notificacoesService.marcarTodasLidas();
  }
}

module.exports = CentralEntradasService;
