/**
 * MFE-07 — FinancialSettlementHandler
 *
 * Consome eventos de liquidação APÓS o Ledger.
 * Nunca cria lançamentos financeiros diretamente.
 * Materializa FinancialSettlement (projeção piloto).
 */

const {
  FeatureFlag,
  FinancialContext,
  FinancialStatus,
  MeioFinanceiro
} = require('../../domain/enums');
const { isEventoSettlement, resolverTipoEventoParaPipeline } = require('../FinancialEventTypes');
const FinancialSettlement = require('../../domain/FinancialSettlement');

const EVENTO_PARA_MEIO = Object.freeze({
  PIX_SETTLED: MeioFinanceiro.PIX,
  PIX_LIQUIDADO: MeioFinanceiro.PIX,
  TEF_SETTLED: MeioFinanceiro.TEF,
  TEF_LIQUIDADO: MeioFinanceiro.TEF,
  CASH_SETTLED: MeioFinanceiro.DINHEIRO,
  DINHEIRO_LIQUIDADO: MeioFinanceiro.DINHEIRO,
  CARD_SETTLED: MeioFinanceiro.CARTAO_CREDITO,
  CARTAO_LIQUIDADO: MeioFinanceiro.CARTAO_CREDITO,
  CHECK_SETTLED: MeioFinanceiro.CHEQUE,
  CHEQUE_LIQUIDADO: MeioFinanceiro.CHEQUE,
  BANK_TRANSFER_SETTLED: MeioFinanceiro.TRANSFERENCIA,
  TRANSFERENCIA_LIQUIDADA: MeioFinanceiro.TRANSFERENCIA,
  BOLETO_SETTLED: MeioFinanceiro.BOLETO,
  BOLETO_LIQUIDADO: MeioFinanceiro.BOLETO,
  PAYMENT_SETTLED: MeioFinanceiro.OUTRO,
  LIQUIDACAO_REALIZADA: MeioFinanceiro.OUTRO
});

class FinancialSettlementHandler {
  constructor(opts = {}) {
    this.nome = 'FinancialSettlementHandler';
    this.featureFlags = opts.featureFlags || null;
    this.audit = opts.audit || null;
    /** @type {Map<string, object>} */
    this._settlements = new Map();
  }

  estaAtivo() {
    return Boolean(
      this.featureFlags && this.featureFlags.isEnabled(FeatureFlag.FEATURE_MFE_SETTLEMENT)
    );
  }

  async consumir(evento, ctx = {}) {
    const started = Date.now();
    if (!this.estaAtivo()) {
      return { ok: true, skipped: true, reason: 'FEATURE_MFE_SETTLEMENT_OFF' };
    }
    if (!isEventoSettlement(evento?.type)) {
      return { ok: true, skipped: true, reason: 'NOT_SETTLEMENT_EVENT' };
    }

    const entries = Array.isArray(ctx.entries) ? ctx.entries : [];
    if (entries.length === 0) {
      const err = new Error('FinancialSettlementHandler: evento sem LedgerEntry — proibido inventar lançamento');
      await this._auditar(ctx.db, evento, FinancialStatus.FAILED, started, { erro: err.message });
      throw err;
    }

    const key = String(evento.id || evento.idempotencyKey);
    if (this._settlements.has(key)) {
      await this._auditar(ctx.db, evento, FinancialStatus.COMPLETED, started, {
        idempotent: true,
        handler: this.nome
      });
      return { ok: true, idempotent: true, settlement: this._settlements.get(key) };
    }

    const payload = evento.payload || {};
    const tipoCanonico = resolverTipoEventoParaPipeline(evento.type);
    const meio = payload.meioFinanceiro
      || payload.meio_financeiro
      || EVENTO_PARA_MEIO[evento.type]
      || EVENTO_PARA_MEIO[tipoCanonico]
      || MeioFinanceiro.OUTRO;

    const statusSettlement = this._statusPorTipo(evento.type, tipoCanonico);
    const settlement = FinancialSettlement.criar({
      id: payload.settlementId || payload.settlement_id || null,
      titleId: payload.titleId || payload.titulo_id || payload.conta_receber_id || payload.conta_pagar_id || null,
      operationId: payload.operationId || evento.idempotencyKey,
      meioFinanceiro: meio,
      valor: Number(payload.valor ?? entries[0]?.valor ?? 0),
      data: payload.data || payload.dataLiquidacao || new Date().toISOString().slice(0, 10),
      status: statusSettlement,
      context: evento.context || FinancialContext.FINANCEIRO,
      documentoOrigem: payload.documentoOrigem || payload.documento_origem || null,
      usuario: evento.operadorId ?? payload.usuario ?? null,
      empresa: payload.empresa ?? payload.empresa_id ?? null,
      eventId: evento.id,
      correlationId: evento.correlationId,
      traceId: evento.traceId || evento.correlationId,
      metadata: {
        tipoOriginal: evento.type,
        tipoCanonico,
        ledgerEntryIds: entries.map((e) => e.id),
        tituloAtualizado: Boolean(payload.titleId || payload.titulo_id)
      }
    }).assertValid();

    const json = settlement.toJSON();
    json.durationMs = Date.now() - started;
    json.ledgerEntryIds = entries.map((e) => e.id);
    json.FinancialStatus = statusSettlement === FinancialSettlement.Status.FAILED
      ? FinancialStatus.FAILED
      : (statusSettlement === FinancialSettlement.Status.REVERSED
        ? FinancialStatus.ROLLED_BACK
        : FinancialStatus.COMPLETED);

    this._settlements.set(key, json);

    await this._auditar(ctx.db, evento, json.FinancialStatus, started, {
      handler: this.nome,
      settlementId: json.id,
      meioFinanceiro: json.meioFinanceiro,
      status: json.status,
      operationId: json.operationId,
      eventId: evento.id,
      correlationId: json.correlationId,
      traceId: json.traceId,
      titleId: json.titleId,
      context: json.context,
      FinancialContext: json.context,
      FinancialStatus: json.FinancialStatus,
      durationMs: json.durationMs
    });

    return { ok: true, settlement: json };
  }

  _statusPorTipo(tipoOriginal, tipoCanonico) {
    const t = String(tipoOriginal || tipoCanonico || '');
    if (t === 'PAYMENT_REVERSED' || t === 'LIQUIDACAO_ESTORNADA') {
      return FinancialSettlement.Status.REVERSED;
    }
    if (t === 'PAYMENT_FAILED' || t === 'LIQUIDACAO_FALHOU') {
      return FinancialSettlement.Status.FAILED;
    }
    return FinancialSettlement.Status.COMPLETED;
  }

  obterSettlement(eventIdOrKey) {
    return this._settlements.get(String(eventIdOrKey)) || null;
  }

  listarSettlements() {
    return [...this._settlements.values()];
  }

  async _auditar(db, evento, status, started, extra = {}) {
    if (!this.audit) return;
    await this.audit.registrar({
      db,
      acao: 'SETTLEMENT_HANDLER',
      origem: evento?.origem,
      operadorId: evento?.operadorId,
      correlationId: evento?.correlationId,
      detalhe: {
        evento: evento?.type,
        eventId: evento?.id,
        status,
        handler: this.nome,
        durationMs: Date.now() - started,
        context: evento?.context || FinancialContext.FINANCEIRO,
        traceId: evento?.traceId || evento?.correlationId,
        idempotencyKey: evento?.idempotencyKey,
        ...extra
      }
    });
  }
}

module.exports = FinancialSettlementHandler;
