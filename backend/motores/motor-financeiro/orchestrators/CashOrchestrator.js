/**
 * MFE-04 — CashOrchestrator (adaptador → FinancialGateway)
 *
 * FEATURE_MFE_CAIXA=OFF → no-op (legado continua).
 * Nunca chama Pipeline diretamente (Regra 3.5).
 */

const {
  FeatureFlag,
  FinancialContext,
  OrigemFinanceira
} = require('../domain/enums');

const OPERACAO_PARA_EVENTO = Object.freeze({
  abertura: 'CASH_OPENED',
  fechamento: 'CASH_CLOSED',
  suprimento: 'CASH_SUPPLY',
  sangria: 'CASH_WITHDRAWAL',
  ajuste: 'CASH_ADJUSTMENT',
  conciliacao: 'CASH_RECONCILIATION'
});

class CashOrchestrator {
  /**
   * @param {import('../application/MotorFinanceiro')} motor
   */
  constructor(motor) {
    this.motor = motor;
  }

  isAtivo() {
    return Boolean(
      this.motor?.featureFlags?.isEnabled(FeatureFlag.FEATURE_MFE_CAIXA)
    );
  }

  /**
   * Publica evento de caixa via FinancialGateway (se flag ON).
   * @param {object} db
   * @param {object} operacao
   */
  async publicarOperacaoCaixa(db, operacao = {}) {
    if (!this.isAtivo()) {
      return { ok: true, skipped: true, reason: 'FEATURE_MFE_CAIXA_OFF' };
    }
    if (!this.motor.featureFlags.isEnabled(FeatureFlag.FIN_EVENTS)) {
      return { ok: false, skipped: true, reason: 'FIN_EVENTS_OFF' };
    }
    if (!this.motor.featureFlags.isEnabled(FeatureFlag.FIN_LEDGER)) {
      return { ok: false, skipped: true, reason: 'FIN_LEDGER_OFF' };
    }

    const tipoOp = String(operacao.tipo || operacao.operacao || '').toLowerCase();
    const eventType = OPERACAO_PARA_EVENTO[tipoOp] || operacao.eventType;
    if (!eventType) {
      return { ok: false, error: `operação de caixa desconhecida: ${tipoOp}` };
    }

    const r = await this.motor.gateway.publicarCaixa(db, {
      eventType,
      origem: operacao.origem || OrigemFinanceira.PDV,
      operationId: operacao.operationId,
      correlationId: operacao.correlationId,
      traceId: operacao.traceId,
      idempotencyKey: operacao.idempotencyKey
        || `caixa:${tipoOp}:${operacao.sessao_id || operacao.sessaoId || 'x'}:${operacao.movimentacao_id || operacao.caixa_id || Date.now()}`,
      operadorId: operacao.operadorId ?? operacao.usuario_id ?? null,
      valor: Number(operacao.valor ?? 0),
      sessao_id: operacao.sessao_id ?? operacao.sessaoId ?? null,
      caixa_id: operacao.caixa_id ?? operacao.caixaId ?? null,
      terminal_id: operacao.terminal_id ?? operacao.terminalId ?? null,
      motivo: operacao.motivo || null,
      movimentacao_id: operacao.movimentacao_id ?? null,
      payload: operacao.payload
    });

    return {
      ...r,
      context: r.context || FinancialContext.CAIXA
    };
  }
}

module.exports = {
  CashOrchestrator,
  OPERACAO_PARA_EVENTO
};
