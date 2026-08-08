/**
 * MFE-03 — FinancialLedgerService (API interna operacional)
 */

const { FeatureFlag } = require('../domain/enums');
const FinancialLedgerEntry = require('../domain/FinancialLedgerEntry');
const { LedgerEntryDirectForbiddenError } = require('../domain/errors');
const LedgerRepo = require('../repositories/FinancialLedgerRepository');
const OutboxRepo = require('../repositories/FinancialOutboxRepository');

class FinancialLedgerService {
  /**
   * @param {object} opts
   * @param {import('./FeatureFlagsService')} [opts.featureFlags]
   * @param {import('./FinancialAuditService')} [opts.audit]
   */
  constructor({ featureFlags, audit } = {}) {
    this.featureFlags = featureFlags;
    this.audit = audit;
  }

  /**
   * Cria lançamento (somente via pipeline / fromPipeline).
   */
  async criarLancamento(db, entrada, opts = {}) {
    const started = Date.now();
    if (!opts.fromPipeline) {
      throw new LedgerEntryDirectForbiddenError();
    }
    if (this.featureFlags) {
      this.featureFlags.assertEnabled(FeatureFlag.FIN_LEDGER);
    }

    const entry = entrada instanceof FinancialLedgerEntry
      ? entrada
      : FinancialLedgerEntry.criar(entrada);

    entry.assertValid();

    let saved;
    try {
      saved = await LedgerRepo.inserir(db, entry);
    } catch (error) {
      if (this.audit) {
        await this.audit.registrar({
          db,
          acao: 'LEDGER_CREATE_FAILED',
          origem: entry.origem,
          operadorId: entry.operador,
          correlationId: entry.correlationId,
          causationId: entry.causationId,
          detalhe: {
            erro: error.message,
            status: 'FAILED',
            durationMs: Date.now() - started,
            valor: entry.valor,
            natureza: entry.natureza,
            tipoLancamento: entry.tipoLancamento
          }
        });
      }
      throw error;
    }

    const outbox = await OutboxRepo.inserir(db, {
      eventId: saved.eventId,
      eventType: 'LEDGER_ENTRY_CREATED',
      payload: {
        ledgerEntryId: saved.id,
        eventId: saved.eventId,
        tipoLancamento: saved.tipoLancamento,
        natureza: saved.natureza,
        valor: saved.valor,
        contaFinanceira: saved.contaFinanceira
      },
      correlationId: saved.correlationId,
      idempotencyKey: `ledger-outbox-${saved.idempotencyKey}`
    });

    if (this.audit) {
      await this.audit.registrar({
        db,
        acao: 'LEDGER_CREATE',
        origem: saved.origem,
        operadorId: saved.operador,
        correlationId: saved.correlationId,
        causationId: saved.causationId,
        detalhe: {
          eventId: saved.eventId,
          ledgerEntryId: saved.id,
          valor: saved.valor,
          natureza: saved.natureza,
          tipoLancamento: saved.tipoLancamento,
          contaFinanceira: saved.contaFinanceira,
          status: 'SUCCESS',
          resultado: 'APPENDED',
          outboxId: outbox.id,
          durationMs: Date.now() - started
        }
      });
    }

    saved._outboxId = outbox.id;
    return saved;
  }

  async consultarHistorico(db, filtros = {}) {
    return LedgerRepo.listar(db, filtros);
  }

  async consultarPorEvento(db, eventId, opts = {}) {
    return LedgerRepo.listar(db, { eventId, limit: opts.limit || 100 });
  }

  async consultarPorCorrelationId(db, correlationId, opts = {}) {
    return LedgerRepo.listar(db, { correlationId, limit: opts.limit || 100 });
  }

  /**
   * Saldo lógico (apenas testes / diagnóstico) — soma valores assinados.
   */
  async consultarSaldoLogico(db, { ledgerId = 'default', contaFinanceira } = {}) {
    const rows = await LedgerRepo.listar(db, {
      ledgerId,
      contaFinanceira,
      limit: 10000
    });
    const saldo = rows.reduce((acc, r) => acc + r.valorAssinado, 0);
    return {
      ledgerId,
      contaFinanceira: contaFinanceira || null,
      quantidadeLancamentos: rows.length,
      saldo: Math.round(saldo * 100) / 100
    };
  }

  async update() {
    return LedgerRepo.updateProibido();
  }

  async delete() {
    return LedgerRepo.deleteProibido();
  }
}

module.exports = FinancialLedgerService;
