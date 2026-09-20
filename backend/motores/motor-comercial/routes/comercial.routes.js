/**
 * Rotas do Motor Comercial — API REST v1.
 *
 * Sprint S-4.1: controllers lazy + middleware de inicialização.
 *
 * @module motores/motor-comercial/routes/comercial.routes
 */

const express = require('express');
const PerfilComercialController = require('../controllers/PerfilComercialController');
const ConsignacaoController = require('../controllers/ConsignacaoController');
const ProjectionController = require('../controllers/ProjectionController');
const HealthController = require('../controllers/HealthController');
const BridgeDiagnosticController = require('../controllers/BridgeDiagnosticController');
const OutboxController = require('../controllers/OutboxController');
const ResilienceController = require('../controllers/ResilienceController');
const AutorizacaoGerencialController = require('../controllers/AutorizacaoGerencialController');
const {
  RequestIdMiddleware,
  CorrelationIdMiddleware,
  ResponseEnricherMiddleware,
  ErrorHandlerMiddleware,
  LoggingMiddleware,
  IdempotencyMiddleware
} = require('../../../shared/http/middlewares');
const RequireMotorInicializadoMiddleware = require('../http/middlewares/RequireMotorInicializadoMiddleware');

const router = express.Router();

/** @type {Record<string, object>|null} */
let controllersCache = null;

function criarControllers() {
  return {
    perfil: new PerfilComercialController(),
    consignacao: new ConsignacaoController(),
    projection: new ProjectionController(),
    health: new HealthController(),
    bridgeDiagnostic: new BridgeDiagnosticController(),
    outbox: new OutboxController(),
    resilience: new ResilienceController(),
    autorizacaoGerencial: new AutorizacaoGerencialController()
  };
}

function obterControllers() {
  if (!controllersCache) {
    controllersCache = criarControllers();
  }
  return controllersCache;
}

/**
 * @param {'perfil'|'consignacao'|'projection'|'health'|'bridgeDiagnostic'|'outbox'|'resilience'|'autorizacaoGerencial'} grupo
 * @param {string} metodo
 */
function rota(grupo, metodo) {
  return (req, res, next) => obterControllers()[grupo][metodo](req, res, next);
}

router.use(RequestIdMiddleware.create());
router.use(CorrelationIdMiddleware.create());
router.use(ResponseEnricherMiddleware.create());
router.use(LoggingMiddleware.create());
router.use(IdempotencyMiddleware.create());
router.use(RequireMotorInicializadoMiddleware.create());

router.get('/health', rota('health', 'health'));
router.get('/version', rota('health', 'version'));
router.get('/status', rota('health', 'status'));

router.get('/bridges/diagnostic', rota('bridgeDiagnostic', 'diagnostic'));
router.get('/bridges/status', rota('bridgeDiagnostic', 'status'));

router.get('/outbox/status', rota('outbox', 'status'));
router.get('/outbox/pending', rota('outbox', 'pending'));
router.get('/outbox/history', rota('outbox', 'history'));

router.get('/resilience/status', rota('resilience', 'status'));
router.get('/resilience/statistics', rota('resilience', 'statistics'));
router.get('/resilience/circuit-breakers', rota('resilience', 'circuitBreakers'));

router.get('/perfil-comercial', rota('perfil', 'listar'));
router.post('/autorizacoes/gerenciais', rota('autorizacaoGerencial', 'registrar'));
router.get('/perfil-comercial/:id', rota('perfil', 'consultarPorId'));
router.post('/perfil-comercial', rota('perfil', 'criar'));
router.put('/perfil-comercial/:id', rota('perfil', 'atualizar'));
router.patch('/perfil-comercial/:id/bloquear', rota('perfil', 'bloquear'));
router.patch('/perfil-comercial/:id/desbloquear', rota('perfil', 'desbloquear'));
router.patch('/perfil-comercial/:id/limite', rota('perfil', 'alterarLimite'));
router.get('/perfil-comercial/:id/historico', rota('perfil', 'consultarHistorico'));
router.get('/perfil-comercial/:id/score', rota('perfil', 'consultarScore'));
router.get('/perfil-comercial/:id/limite', rota('perfil', 'consultarLimite'));

router.get('/consignacoes', rota('consignacao', 'listar'));
router.get('/consignacoes/proximo-documento', rota('consignacao', 'proximoDocumento'));
router.get('/consignacoes/:id', rota('consignacao', 'consultarPorId'));
router.post('/consignacoes', rota('consignacao', 'criar'));
router.put('/consignacoes/:id', rota('consignacao', 'editar'));
router.delete('/consignacoes/:id', rota('consignacao', 'cancelar'));
router.post('/consignacoes/:id/cancelar', rota('consignacao', 'cancelarPreparacao'));

router.post('/consignacoes/:id/itens', rota('consignacao', 'adicionarItem'));
router.get('/consignacoes/:id/itens', rota('consignacao', 'consultarItens'));
router.put('/consignacoes/:id/itens/:item', rota('consignacao', 'alterarQuantidadeItem'));
router.patch('/consignacoes/:id/itens/:item/observacao', rota('consignacao', 'atualizarObservacaoItem'));
router.delete('/consignacoes/:id/itens/:item', rota('consignacao', 'removerItem'));

router.post('/consignacoes/:id/entrega', rota('consignacao', 'registrarEntrega'));
router.post('/consignacoes/:id/entrega-complementar', rota('consignacao', 'registrarEntregaComplementar'));
router.get('/consignacoes/:id/entregas', rota('consignacao', 'consultarEntregas'));
router.get('/consignacoes/:id/comprovante', rota('consignacao', 'obterComprovante'));
router.post('/consignacoes/:id/comprovante/acoes', rota('consignacao', 'registrarAcaoComprovante'));
router.post('/consignacoes/:id/termo-entrega', rota('consignacao', 'registrarEmissaoTermoEntrega'));
router.post('/consignacoes/:id/devolucao', rota('consignacao', 'registrarDevolucao'));
router.post('/consignacoes/:id/transferencia', rota('consignacao', 'transferir'));

router.post('/consignacoes/:id/prestacao/abrir', rota('consignacao', 'abrirPrestacao'));
router.post('/consignacoes/:id/prestacao/venda', rota('consignacao', 'registrarVenda'));
router.post('/consignacoes/:id/prestacao/perda', rota('consignacao', 'registrarPerda'));
router.get('/consignacoes/:id/prestacao/rateio-perda', rota('consignacao', 'consultarRateioPerda'));
router.put('/consignacoes/:id/prestacao/rateio-perda', rota('consignacao', 'definirRateioPerda'));
router.get('/projections/rateio-perdas/indicadores', rota('projection', 'indicadoresRateioPerdas'));
router.post('/consignacoes/:id/prestacao/cortesia', rota('consignacao', 'registrarCortesia'));
router.post('/consignacoes/:id/prestacao/pagamento', rota('consignacao', 'registrarPagamento'));
router.post('/consignacoes/:id/prestacao/fechar', rota('consignacao', 'fecharPrestacao'));
router.post('/consignacoes/:id/prestacao/reabrir', rota('consignacao', 'reabrirPrestacao'));
router.post('/consignacoes/:id/prestacao/finalizar-venda-oficial', rota('consignacao', 'finalizarVendaOficial'));
router.post('/consignacoes/:id/prestacao/emitir-nfce', rota('consignacao', 'emitirNfcePrestacao'));
router.get('/consignacoes/:id/prestacao/resumo-final', rota('consignacao', 'resumoFinalPrestacao'));
router.post('/vendas/:vendaId/pos-nfce-autorizada', rota('consignacao', 'posNfceAutorizada'));

router.get('/projections/dashboard', rota('projection', 'dashboard'));
router.get('/projections/conta-corrente', rota('projection', 'contaCorrente'));
router.get('/projections/timeline', rota('projection', 'timeline'));
router.get('/projections/resumo-prestacao', rota('projection', 'resumoPrestacao'));
router.get('/projections/saldos', rota('projection', 'saldos'));
router.get('/projections/historico', rota('projection', 'historico'));
router.get('/projections/indicadores', rota('projection', 'indicadores'));
router.get('/projections/insights', rota('projection', 'insights'));
router.get('/projections/pendencias', rota('projection', 'pendencias'));
router.get('/projections/recomendacoes', rota('projection', 'recomendacoes'));
router.get('/projections/playbooks', rota('projection', 'playbooks'));
router.get('/projections/workflow', rota('projection', 'workflow'));
router.get('/projections/situacao-cliente', rota('projection', 'situacaoCliente'));

router.use(ErrorHandlerMiddleware.create());

module.exports = router;
