/**
 * MFE-02 — Event Store aprimorado
 * Persiste evento bruto, valida estrutura, imutabilidade do payload, origem/operador/correlação.
 * Não despacha nem escreve ledger — isso é papel do Pipeline/Dispatcher.
 */

const { IFinancialEventStore, IFinancialPublisher } = require('../contracts');
const FinancialEvent = require('../domain/FinancialEvent');
const { FeatureFlag } = require('../domain/enums');
const { FinancialValidationError, IdempotencyConflictError } = require('../domain/errors');
const { isEventoCatalogado } = require('./FinancialEventTypes');
const EventRepo = require('../repositories/FinancialEventRepository');
const IdempotencyRepo = require('../repositories/FinancialIdempotencyRepository');

class FinancialEventStore extends IFinancialEventStore {
  constructor({ featureFlags, audit } = {}) {
    super();
    this.featureFlags = featureFlags;
    this.audit = audit;
  }

  /**
   * Persiste evento bruto (imutável). Idempotência no store.
   */
  async persistir(db, entrada, { exigirCatalogo = true } = {}) {
    if (this.featureFlags) {
      this.featureFlags.assertEnabled(FeatureFlag.FIN_EVENTS);
    }

    const evento = entrada instanceof FinancialEvent
      ? entrada
      : FinancialEvent.criar(entrada);

    const estrutura = evento.validar();
    if (!estrutura.ok) {
      throw new FinancialValidationError(estrutura.erros);
    }

    if (exigirCatalogo && !isEventoCatalogado(evento.type)) {
      throw new FinancialValidationError([`tipo de evento fora do catálogo oficial: ${evento.type}`]);
    }

    const existente = await EventRepo.obterPorIdempotencyKey(db, evento.idempotencyKey);
    if (existente) {
      throw new IdempotencyConflictError(evento.idempotencyKey);
    }

    const saved = await EventRepo.inserir(db, evento);

    await IdempotencyRepo.registrar(db, saved.idempotencyKey, {
      eventType: saved.type,
      correlationId: saved.correlationId,
      resultRef: String(saved.id)
    });

    if (this.audit) {
      await this.audit.registrar({
        db,
        acao: 'EVENT_PERSISTED',
        origem: saved.origem,
        operadorId: saved.operadorId,
        correlationId: saved.correlationId,
        causationId: saved.causationId,
        detalhe: {
          eventId: saved.id,
          type: saved.type,
          status: 'RECEIVED',
          etapa: 'EVENT_STORE'
        }
      });
    }

    return saved;
  }

  async obterPorIdempotencyKey(db, key) {
    return EventRepo.obterPorIdempotencyKey(db, key);
  }

  async atualizarStatus(db, eventId, status) {
    return EventRepo.atualizarStatus(db, eventId, status);
  }
}

/**
 * Publisher oficial — delega ao Pipeline (única porta de entrada).
 */
class FinancialEventPublisher extends IFinancialPublisher {
  constructor({ pipeline } = {}) {
    super();
    this.pipeline = pipeline;
  }

  async publicar(db, evento) {
    if (!this.pipeline) {
      throw new Error('FinancialEventPublisher requer FinancialEventPipeline (MFE-02)');
    }
    return this.pipeline.processar(db, evento);
  }
}

module.exports = { FinancialEventStore, FinancialEventPublisher };
