/**
 * MCC — Motor de Conversão Comercial (CORE)
 *
 * MCC-01: Converter()
 * MCC-02: Conversão Física por Lote
 * MCC-02.1: Versionamento da Conversão Física
 * MCI-01: Integração Entrada de Mercadorias (orchestrator)
 * MCC-03: Integração operacional Entrada → estoque base
 * EST-MCC-01: Ajuste de Estoque → MCC → Motor Estoque
 */

const ConversaoComercialService = require('./services/ConversaoComercialService');
const ConversaoAgrupamentoService = require('./services/ConversaoAgrupamentoService');
const ConversaoFracionamentoService = require('./services/ConversaoFracionamentoService');
const ConversaoFisicaService = require('./services/ConversaoFisicaService');
const ConversaoCompostaService = require('./services/ConversaoCompostaService');
const ConversaoCache = require('./services/ConversaoCache');
const {
  ConversaoFisicaCalculator,
  CalcularConversaoFisica
} = require('./services/ConversaoFisicaCalculator');
const ConversaoFisicaLoteService = require('./services/ConversaoFisicaLoteService');
const UnidadeComercial = require('./domain/UnidadeComercial');
const ResultadoConversao = require('./domain/Conversao');
const ConversaoFisicaLote = require('./domain/ConversaoFisicaLote');
const ConversaoFisicaObrigatoriaError = require('./domain/ConversaoFisicaObrigatoriaError');
const ConversaoFisicaImutavelError = require('./domain/ConversaoFisicaImutavelError');
const PesoInvalidoError = require('./domain/PesoInvalidoError');
const VolumeInvalidoError = require('./domain/VolumeInvalidoError');
const UnidadeNaoPermitidaError = require('./domain/UnidadeNaoPermitidaError');
const ConversaoNaoCadastradaError = require('./domain/ConversaoNaoCadastradaError');
const {
  TipoConversao,
  ContextoConversao,
  OrigemConversaoFisica,
  MotivoVersaoConversao,
  MOTOR_NOME,
  MOTOR_VERSAO
} = require('./domain/enums');
const {
  validarEntradaConverter,
  normalizarContexto
} = require('./validators/ConversaoValidator');
const { resolverUnidadeComercialOficial } = require('./services/resolverUnidadeComercialOficial');
const ConversaoFisicaLoteRepository = require('./repositories/ConversaoFisicaLoteRepository');
const { bootstrapConversaoFisicaLoteSchema } = require('./migrations/001_conversoes_fisicas_lotes');
const { bootstrapConversaoFisicaLoteVersionamento } = require('./migrations/002_versionamento_conversao_fisica');
const CompraConversaoOrchestrator = require('./integracao/compra/CompraConversaoOrchestrator');
const ModoEntradaConversao = require('./integracao/compra/ModoEntradaConversao');
const EntradaMercadoriasOperacionalService = require('./integracao/compra/EntradaMercadoriasOperacionalService');
const PdvConversaoOrchestrator = require('./integracao/pdv/PdvConversaoOrchestrator');
const PdvVendaOperacionalService = require('./integracao/pdv/PdvVendaOperacionalService');
const ComercialConversaoOrchestrator = require('./integracao/comercial/ComercialConversaoOrchestrator');
const ComercialOperacionalService = require('./integracao/comercial/ComercialOperacionalService');
const FiscalOperacionalService = require('./integracao/fiscal/FiscalOperacionalService');
const EstoqueAdjustmentOrchestrator = require('./integracao/estoque/EstoqueAdjustmentOrchestrator');
const EstoqueAdjustmentOperacionalService = require('./integracao/estoque/EstoqueAdjustmentOperacionalService');

async function bootstrapMccSchema(db) {
  await bootstrapConversaoFisicaLoteSchema(db);
  await bootstrapConversaoFisicaLoteVersionamento(db);
}

/** Instância singleton do serviço oficial */
const motor = new ConversaoComercialService();
const compraOrchestrator = new CompraConversaoOrchestrator({ mcc: motor });
const entradaOperacional = new EntradaMercadoriasOperacionalService({
  orchestrator: compraOrchestrator,
  mcc: motor
});
const pdvOrchestrator = new PdvConversaoOrchestrator({ mcc: motor });
const pdvOperacional = new PdvVendaOperacionalService({
  orchestrator: pdvOrchestrator,
  mcc: motor
});
const comercialOrchestrator = new ComercialConversaoOrchestrator({ mcc: motor });
const comercialOperacional = new ComercialOperacionalService({
  orchestrator: comercialOrchestrator,
  mcc: motor
});
const fiscalOperacional = new FiscalOperacionalService();
const estoqueAdjustmentOrchestrator = new EstoqueAdjustmentOrchestrator({ mcc: motor });
const estoqueAdjustmentOperacional = new EstoqueAdjustmentOperacionalService({
  orchestrator: estoqueAdjustmentOrchestrator,
  mcc: motor
});

function Converter(entrada) {
  return motor.Converter(entrada);
}

function ConverterAsync(entrada) {
  return motor.ConverterAsync(entrada);
}

function limparCache(operacaoId) {
  return motor.limparCache(operacaoId);
}

module.exports = {
  Converter,
  ConverterAsync,
  converter: Converter,
  CalcularConversaoFisica,
  limparCache,
  motor,
  compraOrchestrator,
  CompraConversaoOrchestrator,
  ModoEntradaConversao,
  EntradaMercadoriasOperacionalService,
  entradaOperacional,
  PdvConversaoOrchestrator,
  PdvVendaOperacionalService,
  pdvOrchestrator,
  pdvOperacional,
  ComercialConversaoOrchestrator,
  ComercialOperacionalService,
  comercialOrchestrator,
  comercialOperacional,
  FiscalOperacionalService,
  fiscalOperacional,
  EstoqueAdjustmentOrchestrator,
  EstoqueAdjustmentOperacionalService,
  estoqueAdjustmentOrchestrator,
  estoqueAdjustmentOperacional,
  ConversaoComercialService,
  ConversaoAgrupamentoService,
  ConversaoFracionamentoService,
  ConversaoFisicaService,
  ConversaoCompostaService,
  ConversaoFisicaCalculator,
  ConversaoFisicaLoteService,
  ConversaoCache,
  UnidadeComercial,
  ResultadoConversao,
  ConversaoFisicaLote,
  ConversaoFisicaObrigatoriaError,
  ConversaoFisicaImutavelError,
  PesoInvalidoError,
  VolumeInvalidoError,
  UnidadeNaoPermitidaError,
  ConversaoNaoCadastradaError,
  resolverUnidadeComercialOficial,
  ConversaoFisicaLoteRepository,
  TipoConversao,
  ContextoConversao,
  OrigemConversaoFisica,
  MotivoVersaoConversao,
  MOTOR_NOME,
  MOTOR_VERSAO,
  validarEntradaConverter,
  normalizarContexto,
  bootstrapConversaoFisicaLoteSchema: bootstrapMccSchema,
  bootstrapConversaoFisicaLoteVersionamento,
  bootstrapMccSchema,
  /** APIs oficiais versionamento */
  consultarConversaoAtiva: ConversaoFisicaLoteService.consultarConversaoAtiva,
  consultarHistorico: ConversaoFisicaLoteService.consultarHistorico,
  criarNovaVersao: ConversaoFisicaLoteService.criarNovaVersao,
  criarVersaoInicial: ConversaoFisicaLoteService.criarVersaoInicial
};
