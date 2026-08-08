/**
 * MFE-04 — FinancialCashHandler
 *
 * Consome eventos de Caixa APÓS o Ledger.
 * Nunca cria lançamentos financeiros diretamente.
 * Sempre parte de ledgerEntries já materializados pelo Pipeline.
 */

const {
  FeatureFlag,
  FinancialContext,
  FinancialStatus
} = require('../../domain/enums');
const { isEventoCaixa, resolverTipoEventoParaPipeline } = require('../FinancialEventTypes');

class FinancialCashHandler {
  constructor(opts = {}) {
    this.nome = 'FinancialCashHandler';
    this.featureFlags = opts.featureFlags || null;
    this.audit = opts.audit || null;
    /** @type {Map<string|number, object>} */
    this._projecoes = new Map();
  }

  estaAtivo() {
    return Boolean(this.featureFlags && this.featureFlags.isEnabled(FeatureFlag.FEATURE_MFE_CAIXA));
  }

  /**
   * Hook pós-ledger (dispatcher.onAny).
   * @param {object} evento
   * @param {{ db: object, entries: object[] }} ctx
   */
  async consumir(evento, ctx = {}) {
    const started = Date.now();
    if (!this.estaAtivo()) {
      return { ok: true, skipped: true, reason: 'FEATURE_MFE_CAIXA_OFF' };
    }
    if (!isEventoCaixa(evento?.type)) {
      return { ok: true, skipped: true, reason: 'NOT_CASH_EVENT' };
    }

    const entries = Array.isArray(ctx.entries) ? ctx.entries : [];
    if (entries.length === 0) {
      const err = new Error('FinancialCashHandler: evento de caixa sem LedgerEntry — proibido inventar lançamento');
      await this._auditar(ctx.db, evento, FinancialStatus.FAILED, started, { erro: err.message });
      throw err;
    }

    const tipoCanonico = resolverTipoEventoParaPipeline(evento.type);
    const key = String(evento.id || evento.idempotencyKey);
    if (this._projecoes.has(key)) {
      await this._auditar(ctx.db, evento, FinancialStatus.COMPLETED, started, {
        idempotent: true,
        handler: this.nome
      });
      return { ok: true, idempotent: true, projection: this._projecoes.get(key) };
    }

    const projection = {
      eventId: evento.id,
      operationId: evento.payload?.operationId || evento.idempotencyKey,
      correlationId: evento.correlationId,
      traceId: evento.traceId || evento.correlationId,
      context: evento.context || FinancialContext.CAIXA,
      status: FinancialStatus.COMPLETED,
      tipo: tipoCanonico,
      tipoOriginal: evento.type,
      sessaoId: evento.payload?.sessao_id || evento.payload?.sessaoId || null,
      caixaId: evento.payload?.caixa_id || evento.payload?.caixaId || null,
      terminalId: evento.payload?.terminal_id || evento.payload?.terminalId || null,
      valor: Number(evento.payload?.valor ?? entries[0]?.valor ?? 0),
      ledgerEntryIds: entries.map((e) => e.id),
      ledgerCount: entries.length,
      processedAt: new Date().toISOString(),
      durationMs: 0
    };
    projection.durationMs = Date.now() - started;
    this._projecoes.set(key, projection);

    await this._auditar(ctx.db, evento, FinancialStatus.COMPLETED, started, {
      handler: this.nome,
      context: projection.context,
      ledgerEntryIds: projection.ledgerEntryIds,
      operationId: projection.operationId
    });

    return { ok: true, projection };
  }

  obterProjecao(eventIdOrKey) {
    return this._projecoes.get(String(eventIdOrKey)) || null;
  }

  listarProjecoes() {
    return [...this._projecoes.values()];
  }

  async _auditar(db, evento, status, started, extra = {}) {
    if (!this.audit) return;
    await this.audit.registrar({
      db,
      acao: 'CASH_HANDLER',
      origem: evento?.origem,
      operadorId: evento?.operadorId,
      correlationId: evento?.correlationId,
      detalhe: {
        evento: evento?.type,
        eventId: evento?.id,
        status,
        handler: this.nome,
        durationMs: Date.now() - started,
        context: evento?.context || FinancialContext.CAIXA,
        traceId: evento?.traceId || evento?.correlationId,
        idempotencyKey: evento?.idempotencyKey,
        ...extra
      }
    });
  }
}

module.exports = FinancialCashHandler;
