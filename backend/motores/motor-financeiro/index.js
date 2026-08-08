/**
 * Motor Financeiro Enterprise (MFE) — CORE
 *
 * MFE-01: Fundação · MFE-02: Pipeline · MFE-03: Ledger + Modelo Unificado (SSOT)
 * MFE-05.1: Bridge PDV + Comercial → AR
 */

const MotorFinanceiro = require('./application/MotorFinanceiro');
const {
  bootstrapMotorFinanceiro,
  obterMotor,
  resetMotorParaTestes,
  bootstrapMotorFinanceiroSchema
} = require('./bootstrap/MotorFinanceiroBootstrap');

const FinancialLedger = require('./ledger/FinancialLedger');
const FinancialLedgerService = require('./services/FinancialLedgerService');
const FinancialEvent = require('./domain/FinancialEvent');
const FinancialLedgerEntry = require('./domain/FinancialLedgerEntry');
const FinancialOperation = require('./domain/FinancialOperation');
const FinancialEntry = require('./domain/FinancialEntry');
const FinancialDocument = require('./domain/FinancialDocument');
const FinancialAllocation = require('./domain/FinancialAllocation');
const FinancialAuditTrail = require('./domain/FinancialAuditTrail');
const FinancialEventDispatcher = require('./events/FinancialEventDispatcher');
const FinancialEventPipeline = require('./events/FinancialEventPipeline');
const {
  FinancialEventStore,
  FinancialEventPublisher
} = require('./events/FinancialEventStore');
const FinancialEventTypesModule = require('./events/FinancialEventTypes');
const handlers = require('./events/handlers');
const FeatureFlagsService = require('./services/FeatureFlagsService');
const FinancialAuditService = require('./services/FinancialAuditService');
const { proporLancamentosDoEvento } = require('./ledger/EventToLedgerMapper');

const contracts = require('./contracts');
const {
  MOTOR_FINANCEIRO_NOME,
  MOTOR_FINANCEIRO_VERSAO,
  MOTOR_FINANCEIRO_CODIGO,
  TipoLancamento,
  NaturezaLancamento,
  TipoLancamentoOperacional,
  FinancialOperationType,
  OrigemFinanceira,
  MeioFinanceiro,
  FinancialDocumentType,
  FeatureFlag,
  FinancialContext,
  FinancialStatus,
  MOEDA_PADRAO,
  isOrigemFinanceiraValida,
  isMeioFinanceiroValido,
  isFinancialOperationTypeValido,
  isFinancialContextValido,
  isFinancialStatusValido
} = require('./domain/enums');
const {
  LedgerImmutableError,
  IdempotencyConflictError,
  FeatureFlagDisabledError,
  FinancialValidationError,
  LedgerEntryDirectForbiddenError,
  HandlerNotFoundError
} = require('./domain/errors');

const FinancialCashHandler = require('./events/handlers/FinancialCashHandler');
const FinancialReceivableHandler = require('./events/handlers/FinancialReceivableHandler');
const FinancialPayableHandler = require('./events/handlers/FinancialPayableHandler');
const FinancialSettlementHandler = require('./events/handlers/FinancialSettlementHandler');
const FinancialInstallment = require('./domain/FinancialInstallment');
const FinancialSettlement = require('./domain/FinancialSettlement');
const { CashOrchestrator } = require('./orchestrators/CashOrchestrator');
const { ReceivableOrchestrator } = require('./orchestrators/ReceivableOrchestrator');
const { PdvArBridge, ComercialArBridge, PurchasePayableBridge } = require('./bridges');
const FinancialGateway = require('./gateway/FinancialGateway');
const adapters = require('./adapters');

const motor = obterMotor();

module.exports = {
  MotorFinanceiro,
  motor,
  bootstrapMotorFinanceiro,
  bootstrapMotorFinanceiroSchema,
  obterMotor,
  resetMotorParaTestes,

  FinancialLedger,
  FinancialLedgerService,
  FinancialEvent,
  FinancialLedgerEntry,
  FinancialOperation,
  FinancialEntry,
  FinancialDocument,
  FinancialAllocation,
  FinancialAuditTrail,
  FinancialCashHandler,
  FinancialReceivableHandler,
  FinancialPayableHandler,
  FinancialSettlementHandler,
  FinancialInstallment,
  FinancialSettlement,
  CashOrchestrator,
  ReceivableOrchestrator,
  PdvArBridge,
  ComercialArBridge,
  PurchasePayableBridge,
  FinancialGateway,
  FinancialEventDispatcher,
  FinancialEventPipeline,
  FinancialEventStore,
  FinancialEventPublisher,
  FinancialEventTypes: FinancialEventTypesModule,
  OfficialFinancialEventTypes: FinancialEventTypesModule.OfficialFinancialEventTypes,
  isEventoCatalogado: FinancialEventTypesModule.isEventoCatalogado,
  isEventoOficial: FinancialEventTypesModule.isEventoOficial,
  isEventoCaixa: FinancialEventTypesModule.isEventoCaixa,
  isEventoAr: FinancialEventTypesModule.isEventoAr,
  isEventoAp: FinancialEventTypesModule.isEventoAp,
  isEventoSettlement: FinancialEventTypesModule.isEventoSettlement,
  resolverTipoEventoParaPipeline: FinancialEventTypesModule.resolverTipoEventoParaPipeline,
  proporLancamentosDoEvento,
  handlers,
  FeatureFlagsService,
  FinancialAuditService,
  FinancialAudit: FinancialAuditService,

  ...contracts,
  contracts,
  adapters,
  publicarEventoCaixaMfe: adapters.publicarEventoCaixaMfe,
  publicarEventoArMfe: adapters.publicarEventoArMfe,
  publicarEventoPdvArMfe: adapters.publicarEventoPdvArMfe,
  publicarEventoComercialArMfe: adapters.publicarEventoComercialArMfe,
  publicarEventoCompraApMfe: adapters.publicarEventoCompraApMfe,

  MOTOR_FINANCEIRO_NOME,
  MOTOR_FINANCEIRO_VERSAO,
  MOTOR_FINANCEIRO_CODIGO,
  TipoLancamento,
  NaturezaLancamento,
  TipoLancamentoOperacional,
  FinancialOperationType,
  OrigemFinanceira,
  MeioFinanceiro,
  FinancialDocumentType,
  FeatureFlag,
  FinancialContext,
  FinancialStatus,
  MOEDA_PADRAO,
  isOrigemFinanceiraValida,
  isMeioFinanceiroValido,
  isFinancialOperationTypeValido,
  isFinancialContextValido,
  isFinancialStatusValido,
  LedgerImmutableError,
  IdempotencyConflictError,
  FeatureFlagDisabledError,
  FinancialValidationError,
  LedgerEntryDirectForbiddenError,
  HandlerNotFoundError,

  orchestrators: require('./orchestrators')
};
