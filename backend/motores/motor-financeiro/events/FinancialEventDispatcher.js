/**
 * MFE-02 — FinancialEventDispatcher
 *
 * Valida evento, localiza handler, controla retries, aplica lançamentos no Ledger.
 * Nunca executa regra de negócio operacional (caixa/AR/AP).
 */

const { HandlerNotFoundError } = require('../domain/errors');
const { FeatureFlag } = require('../domain/enums');
const FinancialLedgerEntry = require('../domain/FinancialLedgerEntry');
const { resolverTipoEventoParaPipeline } = require('./FinancialEventTypes');

class FinancialEventDispatcher {
  /**
   * @param {object} opts
   * @param {import('../ledger/FinancialLedger')} [opts.ledger]
   * @param {import('../services/FeatureFlagsService')} [opts.featureFlags]
   * @param {import('../services/FinancialAuditService')} [opts.audit]
   * @param {number} [opts.maxRetries]
   */
  constructor(opts = {}) {
    /** @type {Map<string, import('./handlers/BaseFinancialEventHandler')>} */
    this._handlers = new Map();
    this._any = [];
    this.ledger = opts.ledger || null;
    this.ledgerService = opts.ledgerService || null;
    this.featureFlags = opts.featureFlags || null;
    this.audit = opts.audit || null;
    this.maxRetries = Number.isFinite(opts.maxRetries) ? opts.maxRetries : 2;
  }

  registrarHandler(type, handler) {
    this._handlers.set(type, handler);
  }

  obterHandler(type) {
    return this._handlers.get(type)
      || this._handlers.get(resolverTipoEventoParaPipeline(type))
      || null;
  }

  onAny(handler) {
    this._any.push(handler);
  }

  /**
   * Compat MFE-01 — listeners leves (não substituem handlers oficiais).
   */
  on(type, fn) {
    const existing = this._handlers.get(type);
    if (existing && typeof existing.handle === 'function') {
      const prev = existing;
      this._handlers.set(type, {
        eventType: type,
        nome: 'CompositeListener',
        handle: async (evento, ctx) => {
          const r = await prev.handle(evento, ctx);
          await fn(evento, ctx);
          return r;
        },
        proporLancamentos: (e) => (prev.proporLancamentos ? prev.proporLancamentos(e) : [])
      });
      return;
    }
    this._handlers.set(type, {
      eventType: type,
      nome: 'LegacyListener',
      handle: async (evento, ctx) => {
        await fn(evento, ctx);
        return { ok: true, lancamentos: [] };
      },
      proporLancamentos: () => []
    });
  }

  /**
   * @param {object} db
   * @param {import('../domain/FinancialEvent')} evento
   */
  async dispatch(db, evento) {
    const started = Date.now();
    const handler = this.obterHandler(evento.type);

    if (!handler) {
      const err = new HandlerNotFoundError(evento.type);
      await this._audit(db, {
        acao: 'DISPATCH_NO_HANDLER',
        evento,
        status: 'FAILED',
        handler: null,
        retry: 0,
        erro: err.message,
        durationMs: Date.now() - started
      });
      throw err;
    }

    let lastError = null;
    let attempt = 0;
    const maxAttempts = this.maxRetries + 1;

    while (attempt < maxAttempts) {
      attempt += 1;
      try {
        await this._audit(db, {
          acao: 'DISPATCH_ATTEMPT',
          evento,
          status: 'PROCESSING',
          handler: handler.nome || handler.constructor?.name,
          retry: attempt - 1,
          durationMs: Date.now() - started
        });

        const resultado = await handler.handle(evento, { db, attempt });
        let lancamentos = Array.isArray(resultado?.lancamentos) ? resultado.lancamentos : [];

        // MFE-03: todo evento processado gera lançamento(s)
        if (lancamentos.length === 0 && this.ledgerService) {
          const { proporLancamentosDoEvento } = require('../ledger/EventToLedgerMapper');
          lancamentos = proporLancamentosDoEvento(evento);
        }

        const entries = [];
        const ledgerApi = this.ledgerService || this.ledger;

        if (lancamentos.length > 0) {
          if (this.featureFlags) {
            this.featureFlags.assertEnabled(FeatureFlag.FIN_LEDGER);
          }
          for (let i = 0; i < lancamentos.length; i += 1) {
            const proposta = lancamentos[i];
            const entry = await ledgerApi.criarLancamento
              ? await ledgerApi.criarLancamento(db, FinancialLedgerEntry.criar({
                ...proposta,
                eventId: evento.id,
                evento: evento.type,
                origem: proposta.origem || evento.origem,
                operador: proposta.operador ?? evento.operadorId,
                correlationId: proposta.correlationId || evento.correlationId,
                causationId: proposta.causationId || String(evento.id || evento.causationId || ''),
                idempotencyKey: proposta.idempotencyKey
                  || `${evento.idempotencyKey}:ledger:${i}`,
                historico: proposta.historico || `Evento ${evento.type}`
              }), { fromPipeline: true })
              : await this.ledger.append(db, FinancialLedgerEntry.criar({
                ...proposta,
                eventId: evento.id,
                evento: evento.type,
                origem: proposta.origem || evento.origem,
                operador: proposta.operador ?? evento.operadorId,
                correlationId: proposta.correlationId || evento.correlationId,
                causationId: proposta.causationId || String(evento.id || evento.causationId || ''),
                idempotencyKey: proposta.idempotencyKey
                  || `${evento.idempotencyKey}:ledger:${i}`
              }), { fromPipeline: true });
            entries.push(entry);
          }
        }

        for (const fn of this._any) {
          await fn(evento, { db, entries });
        }

        await this._audit(db, {
          acao: 'DISPATCH_SUCCESS',
          evento,
          status: 'PROCESSED',
          handler: handler.nome || handler.constructor?.name,
          retry: attempt - 1,
          durationMs: Date.now() - started,
          detalheExtra: { lancamentos: entries.length }
        });

        return {
          ok: true,
          handler: handler.nome || handler.constructor?.name,
          attempts: attempt,
          retries: attempt - 1,
          durationMs: Date.now() - started,
          ledgerEntries: entries
        };
      } catch (error) {
        lastError = error;
        if (error && error.code === 'MFE_HANDLER_NOT_FOUND') throw error;
        if (error && error.code === 'MFE_FLAG_OFF') throw error;

        await this._audit(db, {
          acao: 'DISPATCH_RETRY',
          evento,
          status: 'RETRY',
          handler: handler.nome || handler.constructor?.name,
          retry: attempt - 1,
          erro: error.message,
          durationMs: Date.now() - started
        });

        if (attempt >= maxAttempts) break;
      }
    }

    await this._audit(db, {
      acao: 'DISPATCH_FAILED',
      evento,
      status: 'FAILED',
      handler: handler.nome || handler.constructor?.name,
      retry: attempt - 1,
      erro: lastError?.message,
      durationMs: Date.now() - started
    });

    throw lastError || new Error('Dispatcher falhou sem erro explícito');
  }

  /** @deprecated use dispatch — mantido para compat testes leves */
  async dispatchInterno(evento) {
    const list = [];
    const h = this.obterHandler(evento.type);
    if (h) list.push(h);
    for (const fn of this._any) {
      await fn(evento);
    }
    return { dispatched: list.length + this._any.length };
  }

  async _audit(db, {
    acao, evento, status, handler, retry, erro, durationMs, detalheExtra
  }) {
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
        handler,
        retry,
        erro: erro || null,
        durationMs,
        timestamp: new Date().toISOString(),
        ...(detalheExtra || {})
      }
    });
  }
}

module.exports = FinancialEventDispatcher;
