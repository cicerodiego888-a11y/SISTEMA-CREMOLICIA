/**
 * Bootstrap de dependências do Motor Comercial.
 *
 * Sprint S-4.1 — ordem oficial:
 * Repositories → Bridges → Outbox → Use Cases → Projection Services
 *
 * @module motores/motor-comercial/infrastructure/di/bootstrapComercial
 */

const InfrastructureError = require('../errors/InfrastructureError');
const IndicadoresProjectionService = require('../../services/projections/IndicadoresProjectionService');
const SaldoProjectionService = require('../../services/projections/SaldoProjectionService');
const DashboardProjectionService = require('../../services/projections/DashboardProjectionService');
const ContaCorrenteProjectionService = require('../../services/projections/ContaCorrenteProjectionService');
const TimelineProjectionService = require('../../services/projections/TimelineProjectionService');
const ResumoPrestacaoProjectionService = require('../../services/projections/ResumoPrestacaoProjectionService');
const HistoricoProjectionService = require('../../services/projections/HistoricoProjectionService');
const SituacaoClienteProjectionService = require('../../services/projections/SituacaoClienteProjectionService');
const InsightsProjectionService = require('../../services/projections/InsightsProjectionService');
const PendenciasProjectionService = require('../../services/projections/PendenciasProjectionService');
const RecomendacoesProjectionService = require('../../services/projections/RecomendacoesProjectionService');
const PlaybooksProjectionService = require('../../services/projections/PlaybooksProjectionService');
const WorkflowProjectionService = require('../../services/projections/WorkflowProjectionService');
const { criarInsightServiceComercial } = require('../../insights');
const { criarRecommendationService } = require('../../recommendations');
const { criarPlaybookService } = require('../../playbooks');
const { criarWorkflowService } = require('../../services/workflow');
const { bootstrapUseCases, registrarBridgesLegados } = require('./bootstrapUseCases');
const { bootstrapOutbox } = require('../../integrations/outbox/bootstrapOutbox');
const { criarBridgeAdapters } = require('../../bridges/adapters');

/**
 * @param {import('./ComercialDependencyContainer')} container
 * @param {Object} deps
 * @param {Object} deps.db
 */
function bootstrapComercialDependencies(container, deps = {}) {
  if (!deps.db) {
    throw new InfrastructureError(
      'bootstrapComercialDependencies: banco de dados obrigatório.'
    );
  }

  const repositories = _bootstrapRepositories(container, deps);
  const bridges = _bootstrapBridges(container, deps);
  _bootstrapOutbox(container, deps, bridges);
  _bootstrapUseCases(container, deps);
  _bootstrapProjectionServices(container, deps, repositories);

  return container;
}

/**
 * @private
 */
function _bootstrapRepositories(container, deps) {
  const factory = container.resolver('repositoryFactory');

  const perfilComercialRepository = factory.criarPerfilComercialRepository();
  const consignacaoRepository = factory.criarConsignacaoRepository();
  const consignacaoItemRepository = factory.criarConsignacaoItemRepository();
  const movimentacaoComercialRepository = factory.criarMovimentacaoComercialRepository();
  const movimentacaoPerfilRepository = factory.criarMovimentacaoPerfilRepository();
  const PrestacaoRateioPerdaRepository = require('../../repositories/PrestacaoRateioPerdaRepository');
  const rateioPerdaRepository = new PrestacaoRateioPerdaRepository(deps.db);

  Object.assign(container, {
    perfilComercialRepository,
    consignacaoRepository,
    consignacaoItemRepository,
    movimentacaoComercialRepository,
    movimentacaoPerfilRepository,
    rateioPerdaRepository
  });

  return {
    perfilComercialRepository,
    consignacaoRepository,
    consignacaoItemRepository,
    movimentacaoComercialRepository,
    movimentacaoPerfilRepository,
    rateioPerdaRepository
  };
}

/**
 * @private
 */
function _bootstrapBridges(container, deps) {
  const bridges = criarBridgeAdapters({ db: deps.db });
  registrarBridgesLegados(bridges);

  Object.assign(container, {
    clienteBridge: bridges.clienteBridge,
    produtoBridge: bridges.produtoBridge,
    estoqueBridge: bridges.estoqueBridge,
    financeiroBridge: bridges.financeiroBridge,
    usuarioBridge: bridges.usuarioBridge,
    bridgeDiagnosticService: bridges.bridgeDiagnosticService,
    platformGateways: bridges.platformGateways,
    resilienceRegistry: bridges.resilienceRegistry,
    resilienceDiagnosticService: bridges.resilienceRegistry.getDiagnostic()
  });

  return bridges;
}

/**
 * @private
 */
function _bootstrapOutbox(container, deps, bridges) {
  const outbox = bootstrapOutbox({
    db: deps.db,
    bridges: {
      financeiroBridge: bridges.financeiroBridge,
      estoqueBridge: bridges.estoqueBridge
    }
  });

  Object.assign(container, {
    outboxService: outbox.outboxService,
    outboxRepository: outbox.outboxRepository,
    outboxProcessor: outbox.outboxProcessor,
    outboxDispatcher: outbox.outboxDispatcher
  });
}

/**
 * @private
 */
function _bootstrapUseCases(container, deps) {
  bootstrapUseCases(container, deps);
}

/**
 * @private
 */
function _bootstrapProjectionServices(container, deps, repositories) {
  const projectionDeps = {
    db: deps.db,
    ...repositories
  };

  const indicadoresProjectionService = new IndicadoresProjectionService(projectionDeps);
  const saldoProjectionService = new SaldoProjectionService(projectionDeps);
  const dashboardProjectionService = new DashboardProjectionService({
    ...projectionDeps,
    indicadoresService: indicadoresProjectionService,
    saldoService: saldoProjectionService
  });
  const contaCorrenteProjectionService = new ContaCorrenteProjectionService(projectionDeps);
  const timelineProjectionService = new TimelineProjectionService(projectionDeps);
  const resumoPrestacaoProjectionService = new ResumoPrestacaoProjectionService(projectionDeps);
  const historicoProjectionService = new HistoricoProjectionService(projectionDeps);
  const situacaoClienteProjectionService = new SituacaoClienteProjectionService(projectionDeps);

  const insightService = criarInsightServiceComercial();
  const insightsProjectionService = new InsightsProjectionService({
    ...projectionDeps,
    insightService,
    dashboardService: dashboardProjectionService,
    indicadoresService: indicadoresProjectionService,
    saldoService: saldoProjectionService,
    situacaoClienteService: situacaoClienteProjectionService
  });

  const pendenciasProjectionService = new PendenciasProjectionService({
    ...projectionDeps,
    dashboardService: dashboardProjectionService,
    insightsService: insightsProjectionService
  });

  const recommendationService = criarRecommendationService();
  const recomendacoesProjectionService = new RecomendacoesProjectionService({
    ...projectionDeps,
    insightsService: insightsProjectionService,
    pendenciasService: pendenciasProjectionService,
    indicadoresService: indicadoresProjectionService,
    situacaoClienteService: situacaoClienteProjectionService,
    recommendationService
  });

  const playbookService = criarPlaybookService();
  const playbooksProjectionService = new PlaybooksProjectionService({
    ...projectionDeps,
    recomendacoesService: recomendacoesProjectionService,
    insightsService: insightsProjectionService,
    pendenciasService: pendenciasProjectionService,
    playbookService
  });

  const workflowService = criarWorkflowService();
  const workflowProjectionService = new WorkflowProjectionService({
    ...projectionDeps,
    pendenciasService: pendenciasProjectionService,
    recomendacoesService: recomendacoesProjectionService,
    playbooksService: playbooksProjectionService,
    workflowService
  });

  Object.assign(container, {
    indicadoresProjectionService,
    saldoProjectionService,
    dashboardProjectionService,
    contaCorrenteProjectionService,
    timelineProjectionService,
    resumoPrestacaoProjectionService,
    historicoProjectionService,
    situacaoClienteProjectionService,
    insightsProjectionService,
    pendenciasProjectionService,
    recomendacoesProjectionService,
    playbooksProjectionService,
    workflowProjectionService,
    workflowService,
    playbookService,
    recommendationService,
    insightService
  });
}

module.exports = { bootstrapComercialDependencies };
