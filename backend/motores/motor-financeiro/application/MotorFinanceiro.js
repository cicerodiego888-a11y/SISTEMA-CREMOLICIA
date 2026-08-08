/**
 * MFE — Facade / composição do Motor Financeiro (DI)
 * MFE-07: Liquidação Financeira
 */

const FeatureFlagsService = require('../services/FeatureFlagsService');
const FinancialAuditService = require('../services/FinancialAuditService');
const FinancialAuditRepository = require('../repositories/FinancialAuditRepository');
const FinancialLedgerService = require('../services/FinancialLedgerService');
const FinancialLedger = require('../ledger/FinancialLedger');
const FinancialEventDispatcher = require('../events/FinancialEventDispatcher');
const { FinancialEventStore, FinancialEventPublisher } = require('../events/FinancialEventStore');
const FinancialEventPipeline = require('../events/FinancialEventPipeline');
const { registrarHandlersOficiais } = require('../events/handlers');
const FinancialCashHandler = require('../events/handlers/FinancialCashHandler');
const FinancialReceivableHandler = require('../events/handlers/FinancialReceivableHandler');
const FinancialPayableHandler = require('../events/handlers/FinancialPayableHandler');
const FinancialSettlementHandler = require('../events/handlers/FinancialSettlementHandler');
const { CashOrchestrator } = require('../orchestrators/CashOrchestrator');
const { ReceivableOrchestrator } = require('../orchestrators/ReceivableOrchestrator');
const { PdvArBridge } = require('../bridges/PdvArBridge');
const { ComercialArBridge } = require('../bridges/ComercialArBridge');
const { PurchasePayableBridge } = require('../bridges/PurchasePayableBridge');
const FinancialGateway = require('../gateway/FinancialGateway');
const {
  MOTOR_FINANCEIRO_NOME,
  MOTOR_FINANCEIRO_VERSAO,
  FeatureFlag
} = require('../domain/enums');

function arHandlerAtivo(flags) {
  return flags.isEnabled(FeatureFlag.FEATURE_MFE_AR)
    || flags.isEnabled(FeatureFlag.FEATURE_MFE_PDV_AR)
    || flags.isEnabled(FeatureFlag.FEATURE_MFE_COMERCIAL_AR);
}

class MotorFinanceiro {
  constructor(opts = {}) {
    this.nome = MOTOR_FINANCEIRO_NOME;
    this.versao = MOTOR_FINANCEIRO_VERSAO;

    this.featureFlags = new FeatureFlagsService(opts.featureFlagOverrides || {});

    this.audit = new FinancialAuditService({
      repository: {
        inserir: (db, row) => FinancialAuditRepository.inserir(db, row)
      }
    });

    this.ledgerService = new FinancialLedgerService({
      featureFlags: this.featureFlags,
      audit: this.audit
    });

    this.ledger = new FinancialLedger({
      featureFlags: this.featureFlags,
      audit: this.audit,
      ledgerService: this.ledgerService
    });

    this.dispatcher = new FinancialEventDispatcher({
      ledger: this.ledger,
      ledgerService: this.ledgerService,
      featureFlags: this.featureFlags,
      audit: this.audit,
      maxRetries: opts.maxRetries
    });

    if (opts.registrarHandlers !== false) {
      this.handlers = registrarHandlersOficiais(this.dispatcher);
    } else {
      this.handlers = [];
    }

    this.cashHandler = new FinancialCashHandler({
      featureFlags: this.featureFlags,
      audit: this.audit
    });

    this.receivableHandler = new FinancialReceivableHandler({
      featureFlags: this.featureFlags,
      audit: this.audit
    });

    this.payableHandler = new FinancialPayableHandler({
      featureFlags: this.featureFlags,
      audit: this.audit
    });

    this.settlementHandler = new FinancialSettlementHandler({
      featureFlags: this.featureFlags,
      audit: this.audit
    });

    if (opts.registrarCashHandler !== false) {
      this.dispatcher.onAny(async (evento, ctx) => {
        if (!this.featureFlags.isEnabled(FeatureFlag.FEATURE_MFE_CAIXA)) return;
        await this.cashHandler.consumir(evento, ctx);
      });
    }

    if (opts.registrarReceivableHandler !== false) {
      this.dispatcher.onAny(async (evento, ctx) => {
        if (!arHandlerAtivo(this.featureFlags)) return;
        await this.receivableHandler.consumir(evento, ctx);
      });
    }

    if (opts.registrarPayableHandler !== false) {
      this.dispatcher.onAny(async (evento, ctx) => {
        if (!this.featureFlags.isEnabled(FeatureFlag.FEATURE_MFE_AP)) return;
        await this.payableHandler.consumir(evento, ctx);
      });
    }

    if (opts.registrarSettlementHandler !== false) {
      this.dispatcher.onAny(async (evento, ctx) => {
        if (!this.featureFlags.isEnabled(FeatureFlag.FEATURE_MFE_SETTLEMENT)) return;
        await this.settlementHandler.consumir(evento, ctx);
      });
    }

    this.eventStore = new FinancialEventStore({
      featureFlags: this.featureFlags,
      audit: this.audit
    });

    this.pipeline = new FinancialEventPipeline({
      eventStore: this.eventStore,
      dispatcher: this.dispatcher,
      featureFlags: this.featureFlags,
      audit: this.audit
    });

    this.publisher = new FinancialEventPublisher({
      pipeline: this.pipeline
    });

    this.gateway = new FinancialGateway(this);

    this.cashOrchestrator = new CashOrchestrator(this);
    this.receivableOrchestrator = new ReceivableOrchestrator(this);
    this.pdvArBridge = new PdvArBridge(this);
    this.comercialArBridge = new ComercialArBridge(this);
    this.purchasePayableBridge = new PurchasePayableBridge(this);
  }

  /**
   * @deprecated Uso interno / testes legados. Preferir `gateway.publicar()`.
   */
  processarEvento(db, evento) {
    return this.pipeline.processar(db, evento);
  }

  publicar(db, entrada) {
    return this.gateway.publicar(db, entrada);
  }

  publicarOperacaoCaixa(db, operacao) {
    return this.cashOrchestrator.publicarOperacaoCaixa(db, operacao);
  }

  publicarOperacaoAr(db, operacao) {
    return this.receivableOrchestrator.publicarOperacaoAr(db, operacao);
  }

  publicarPdvAr(db, operacao) {
    return this.pdvArBridge.publicar(db, operacao);
  }

  publicarComercialAr(db, operacao) {
    return this.comercialArBridge.publicar(db, operacao);
  }

  publicarCompraAp(db, operacao) {
    return this.purchasePayableBridge.publicar(db, operacao);
  }

  publicarLiquidacao(db, operacao) {
    return this.gateway.publicarLiquidacao(db, operacao);
  }

  criarLancamento(db, entrada, opts) {
    return this.ledgerService.criarLancamento(db, entrada, opts);
  }

  consultarHistorico(db, filtros) {
    return this.ledgerService.consultarHistorico(db, filtros);
  }

  consultarPorEvento(db, eventId, opts) {
    return this.ledgerService.consultarPorEvento(db, eventId, opts);
  }

  consultarPorCorrelationId(db, correlationId, opts) {
    return this.ledgerService.consultarPorCorrelationId(db, correlationId, opts);
  }

  consultarSaldoLogico(db, filtros) {
    return this.ledgerService.consultarSaldoLogico(db, filtros);
  }

  snapshotFlags() {
    return this.featureFlags.snapshot();
  }

  info() {
    return {
      motor: this.nome,
      versao: this.versao,
      sprint: 'MFE-07',
      flags: this.snapshotFlags(),
      gateway: this.gateway?.nome || null,
      handlers: this.handlers.map((h) => h.eventType),
      cashHandler: this.cashHandler?.nome || null,
      receivableHandler: this.receivableHandler?.nome || null,
      payableHandler: this.payableHandler?.nome || null,
      settlementHandler: this.settlementHandler?.nome || null,
      pdvArBridge: this.pdvArBridge ? 'PdvArBridge' : null,
      comercialArBridge: this.comercialArBridge ? 'ComercialArBridge' : null,
      purchasePayableBridge: this.purchasePayableBridge ? 'PurchasePayableBridge' : null
    };
  }
}

module.exports = MotorFinanceiro;
