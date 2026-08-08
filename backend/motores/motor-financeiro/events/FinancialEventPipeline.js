/**
 * MFE-02 — Pipeline oficial de eventos financeiros
 *
 * Origem → Event → Store → Validação → Idempotência → Dispatcher → Ledger → Outbox
 *
 * Única porta de entrada para gerar lançamentos no MFE.
 */

const FinancialEvent = require('../domain/FinancialEvent');
const { FeatureFlag } = require('../domain/enums');
const {
  FinancialValidationError,
  IdempotencyConflictError
} = require('../domain/errors');
const { isEventoCatalogado } = require('./FinancialEventTypes');
const OutboxRepo = require('../repositories/FinancialOutboxRepository');
const DeadLetterRepo = require('../repositories/FinancialDeadLetterRepository');
const EventRepo = require('../repositories/FinancialEventRepository');

class FinancialEventPipeline {
  /**
   * @param {object} deps
   * @param {import('./FinancialEventStore').FinancialEventStore} deps.eventStore
   * @param {import('./FinancialEventDispatcher')} deps.dispatcher
   * @param {import('../services/FeatureFlagsService')} deps.featureFlags
   * @param {import('../services/FinancialAuditService')} deps.audit
   */
  constructor({ eventStore, dispatcher, featureFlags, audit } = {}) {
    this.eventStore = eventStore;
    this.dispatcher = dispatcher;
    this.featureFlags = featureFlags;
    this.audit = audit;
  }

  /**
   * Processa um evento financeiro de ponta a ponta.
   * @returns {Promise<object>}
   */
  async processar(db, entrada) {
    const started = Date.now();

    if (this.featureFlags) {
      this.featureFlags.assertEnabled(FeatureFlag.FIN_EVENTS);
    }

    const evento = entrada instanceof FinancialEvent
      ? entrada
      : FinancialEvent.criar(entrada);

    // 1) Validação estrutural
    const v = evento.validar();
    if (!v.ok) {
      await this._deadLetter(db, evento, `VALIDACAO: ${v.erros.join('; ')}`);
      await this._audit(db, evento, 'PIPELINE_INVALID', 'DEAD_LETTER', {
        erro: v.erros.join('; '),
        durationMs: Date.now() - started
      });
      throw new FinancialValidationError(v.erros);
    }

    if (!isEventoCatalogado(evento.type)) {
      const msg = `tipo fora do catálogo: ${evento.type}`;
      await this._deadLetter(db, evento, msg);
      await this._audit(db, evento, 'PIPELINE_INVALID_TYPE', 'DEAD_LETTER', {
        erro: msg,
        durationMs: Date.now() - started
      });
      throw new FinancialValidationError([msg]);
    }

    // 2) Idempotência — nunca processar duas vezes
    const existente = await this.eventStore.obterPorIdempotencyKey(db, evento.idempotencyKey);
    if (existente) {
      await this._audit(db, evento, 'IDEMPOTENCY_IGNORED', 'IGNORED', {
        handler: null,
        retry: 0,
        durationMs: Date.now() - started,
        eventIdExistente: existente.id
      });
      return {
        ok: true,
        skipped: true,
        reason: 'IDEMPOTENCY',
        event: existente,
        durationMs: Date.now() - started
      };
    }

    // 3) Persistência bruta no Event Store
    let saved;
    try {
      saved = await this.eventStore.persistir(db, evento);
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        await this._audit(db, evento, 'IDEMPOTENCY_IGNORED', 'IGNORED', {
          durationMs: Date.now() - started,
          erro: error.message
        });
        return {
          ok: true,
          skipped: true,
          reason: 'IDEMPOTENCY',
          durationMs: Date.now() - started
        };
      }
      throw error;
    }

    // 4) Dispatcher → handler → ledger
    let dispatchResult;
    try {
      dispatchResult = await this.dispatcher.dispatch(db, saved);
    } catch (error) {
      await this._deadLetter(db, saved, error.message || String(error));
      if (saved.id) {
        await EventRepo.atualizarStatus(db, saved.id, 'DEAD_LETTER');
      }
      await this._audit(db, saved, 'PIPELINE_DEAD_LETTER', 'DEAD_LETTER', {
        handler: error.eventType ? null : undefined,
        erro: error.message,
        durationMs: Date.now() - started
      });
      return {
        ok: false,
        deadLetter: true,
        error: error.message,
        event: saved,
        durationMs: Date.now() - started
      };
    }

    // 5) Outbox (publicação posterior — sem consumidores externos nesta sprint)
    const outbox = await OutboxRepo.inserir(db, {
      eventId: saved.id,
      eventType: saved.type,
      payload: {
        ...saved.payload,
        ledgerEntryIds: (dispatchResult.ledgerEntries || []).map((e) => e.id)
      },
      correlationId: saved.correlationId,
      idempotencyKey: `outbox-${saved.idempotencyKey}`
    });

    await EventRepo.atualizarStatus(db, saved.id, 'PROCESSED');

    await this._audit(db, saved, 'PIPELINE_SUCCESS', 'PROCESSED', {
      handler: dispatchResult.handler,
      retry: dispatchResult.retries,
      durationMs: Date.now() - started,
      outboxId: outbox.id,
      lancamentos: (dispatchResult.ledgerEntries || []).length
    });

    return {
      ok: true,
      skipped: false,
      event: saved,
      dispatch: dispatchResult,
      outbox,
      ledgerEntries: dispatchResult.ledgerEntries || [],
      durationMs: Date.now() - started
    };
  }

  async _deadLetter(db, evento, erro) {
    await DeadLetterRepo.inserir(db, {
      eventId: evento.id || null,
      eventType: evento.type,
      payload: evento.payload || evento.toJSON?.() || {},
      correlationId: evento.correlationId,
      idempotencyKey: evento.idempotencyKey,
      erro: String(erro || 'UNKNOWN')
    });
  }

  async _audit(db, evento, acao, status, extra = {}) {
    if (!this.audit) return;
    await this.audit.registrar({
      db,
      acao,
      origem: evento.origem,
      operadorId: evento.operadorId,
      correlationId: evento.correlationId,
      causationId: evento.causationId,
      detalhe: {
        eventId: evento.id,
        type: evento.type,
        status,
        timestamp: new Date().toISOString(),
        ...extra
      }
    });
  }
}

module.exports = FinancialEventPipeline;
