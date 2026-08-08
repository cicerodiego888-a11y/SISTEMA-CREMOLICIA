/**
 * Bootstrap de Use Cases do Motor Comercial.
 *
 * Sprint O-13 — wiring com bridges reais da plataforma CDS.
 *
 * @module motores/motor-comercial/infrastructure/di/bootstrapUseCases
 */

const perfilUseCases = require('../../usecases/perfil');
const consignacaoUseCases = require('../../usecases/consignacao');
const BridgeRegistry = require('../../bridges/BridgeRegistry');
const ClienteBridge = require('../../bridges/ClienteBridge');
const ProdutoBridge = require('../../bridges/ProdutoBridge');
const EstoqueBridge = require('../../bridges/EstoqueBridge');
const FinanceiroBridge = require('../../bridges/FinanceiroBridge');
const UsuarioBridge = require('../../bridges/UsuarioBridge');

/**
 * Logger silencioso para bridges legados (sem console.log em produção).
 */
const bridgeLogger = {
  info: () => {},
  error: () => {},
  warn: () => {}
};

/**
 * @param {import('./ComercialDependencyContainer')} container
 * @param {Object} deps
 * @param {Object} [deps.db]
 */
function bootstrapUseCases(container, deps = {}) {
  const unitOfWork = container.resolver('unitOfWork');
  const eventPublisher = container.resolver('eventPublisher');

  const bridges = {
    clienteBridge: container.clienteBridge,
    produtoBridge: container.produtoBridge,
    estoqueBridge: container.estoqueBridge,
    financeiroBridge: container.financeiroBridge,
    usuarioBridge: container.usuarioBridge
  };

  if (!bridges.clienteBridge) {
    const InfrastructureError = require('../errors/InfrastructureError');
    throw new InfrastructureError('Bridges não registradas antes dos Use Cases.');
  }

  const baseDeps = {
    unitOfWork,
    eventPublisher,
    perfilComercialRepository: container.perfilComercialRepository,
    consignacaoRepository: container.consignacaoRepository,
    consignacaoItemRepository: container.consignacaoItemRepository,
    movimentacaoComercialRepository: container.movimentacaoComercialRepository,
    movimentacaoPerfilRepository: container.movimentacaoPerfilRepository,
    rateioPerdaRepository: container.rateioPerdaRepository,
    clienteBridge: bridges.clienteBridge,
    produtoBridge: bridges.produtoBridge,
    estoqueBridge: bridges.estoqueBridge,
    financeiroBridge: bridges.financeiroBridge,
    usuarioBridge: bridges.usuarioBridge,
    outboxService: container.outboxService ?? null
  };

  const ativarPerfilComercialUseCase = new perfilUseCases.AtivarPerfilComercialUseCase(baseDeps);
  const inativarPerfilComercialUseCase = new perfilUseCases.InativarPerfilComercialUseCase(baseDeps);

  Object.assign(container, {
    criarPerfilComercialUseCase: new perfilUseCases.CriarPerfilComercialUseCase(baseDeps),
    atualizarPerfilComercialUseCase: new perfilUseCases.AtualizarPerfilComercialUseCase({
      ...baseDeps,
      ativarPerfilComercialUseCase,
      inativarPerfilComercialUseCase
    }),
    ativarPerfilComercialUseCase,
    inativarPerfilComercialUseCase,
    bloquearPerfilComercialUseCase: new perfilUseCases.BloquearPerfilComercialUseCase(baseDeps),
    desbloquearPerfilComercialUseCase: new perfilUseCases.DesbloquearPerfilComercialUseCase(baseDeps),
    alterarLimiteComercialUseCase: new perfilUseCases.AlterarLimiteComercialUseCase(baseDeps),
    registrarLiberacaoGerencialUseCase: new perfilUseCases.RegistrarLiberacaoGerencialUseCase(baseDeps),
    consultarHistoricoPerfilUseCase: new perfilUseCases.ConsultarHistoricoPerfilUseCase(baseDeps),
    consultarScoreConfiabilidadeUseCase: new perfilUseCases.ConsultarScoreConfiabilidadeUseCase(baseDeps),
    consultarLimiteDisponivelUseCase: new perfilUseCases.ConsultarLimiteDisponivelUseCase(baseDeps),

    criarConsignacaoUseCase: new consignacaoUseCases.CriarConsignacaoUseCase(baseDeps),
    editarConsignacaoUseCase: new consignacaoUseCases.EditarConsignacaoUseCase(baseDeps),
    cancelarConsignacaoRascunhoUseCase: new consignacaoUseCases.CancelarConsignacaoRascunhoUseCase(baseDeps),
    adicionarItemConsignacaoUseCase: new consignacaoUseCases.AdicionarItemConsignacaoUseCase(baseDeps),
    removerItemConsignacaoUseCase: new consignacaoUseCases.RemoverItemConsignacaoUseCase(baseDeps),
    alterarQuantidadeItemUseCase: new consignacaoUseCases.AlterarQuantidadeItemUseCase(baseDeps),
    consultarItensConsignacaoUseCase: new consignacaoUseCases.ConsultarItensConsignacaoUseCase(baseDeps),
    validarConsignacaoUseCase: new consignacaoUseCases.ValidarConsignacaoUseCase(baseDeps),
    validarEntregaConsignacaoUseCase: new consignacaoUseCases.ValidarEntregaConsignacaoUseCase(baseDeps),
    registrarEntregaConsignacaoUseCase: new consignacaoUseCases.RegistrarEntregaConsignacaoUseCase(baseDeps),
    registrarDevolucaoAntesPrestacaoUseCase: new consignacaoUseCases.RegistrarDevolucaoAntesPrestacaoUseCase(baseDeps),
    transferirItensEntreConsignacoesUseCase: new consignacaoUseCases.TransferirItensEntreConsignacoesUseCase(baseDeps),
    abrirPrestacaoUseCase: new consignacaoUseCases.AbrirPrestacaoUseCase(baseDeps),
    registrarVendaPrestacaoUseCase: new consignacaoUseCases.RegistrarVendaPrestacaoUseCase(baseDeps),
    registrarPerdaUseCase: new consignacaoUseCases.RegistrarPerdaUseCase(baseDeps),
    definirRateioPerdaUseCase: new consignacaoUseCases.DefinirRateioPerdaUseCase(baseDeps),
    consultarRateioPerdaUseCase: new consignacaoUseCases.ConsultarRateioPerdaUseCase(baseDeps),
    registrarCortesiaUseCase: new consignacaoUseCases.RegistrarCortesiaUseCase(baseDeps),
    registrarPagamentoPrestacaoUseCase: new consignacaoUseCases.RegistrarPagamentoPrestacaoUseCase(baseDeps),
    fecharPrestacaoUseCase: new consignacaoUseCases.FecharPrestacaoUseCase(baseDeps),
    reabrirPrestacaoUseCase: new consignacaoUseCases.ReabrirPrestacaoUseCase(baseDeps),
    registrarEmissaoTermoEntregaUseCase: new consignacaoUseCases.RegistrarEmissaoTermoEntregaUseCase(baseDeps)
  });

  container.finalizarPrestacaoComVendaOficialUseCase =
    new consignacaoUseCases.FinalizarPrestacaoComVendaOficialUseCase({
      ...baseDeps,
      fecharPrestacaoUseCase: container.fecharPrestacaoUseCase
    });

  container.emitirNfcePrestacaoUseCase =
    new consignacaoUseCases.EmitirNfcePrestacaoUseCase(baseDeps);

  container.posNfcePrestacaoUseCase =
    new consignacaoUseCases.PosNfcePrestacaoUseCase({
      ...baseDeps,
      finalizarPrestacaoComVendaOficialUseCase: container.finalizarPrestacaoComVendaOficialUseCase
    });

  return container;
}

/**
 * Registra bridges legados no BridgeRegistry delegando aos gateways reais.
 * @param {Object} bridges
 */
function registrarBridgesLegados(bridges) {
  const platform = bridges.platformGateways;
  const noopPublisher = { publish: async () => {} };
  const bridgeDeps = { httpClient: null, logger: bridgeLogger, eventPublisher: noopPublisher, platform };

  if (!BridgeRegistry.has('ClienteBridge')) {
    BridgeRegistry.register('ClienteBridge', () => new ClienteBridge(bridgeDeps), { motor: 'cliente', real: true });
    BridgeRegistry.register('ProdutoBridge', () => new ProdutoBridge(bridgeDeps), { motor: 'produto', real: true });
    BridgeRegistry.register('EstoqueBridge', () => new EstoqueBridge(bridgeDeps), { motor: 'estoque', real: true });
    BridgeRegistry.register('FinanceiroBridge', () => new FinanceiroBridge(bridgeDeps), { motor: 'financeiro', real: true });
    BridgeRegistry.register('UsuarioBridge', () => new UsuarioBridge(bridgeDeps), { motor: 'usuario', real: true });
  }
}

module.exports = { bootstrapUseCases, registrarBridgesLegados };
