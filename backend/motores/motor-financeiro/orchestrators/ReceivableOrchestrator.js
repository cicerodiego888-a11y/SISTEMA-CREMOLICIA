/**
 * MFE-05 — ReceivableOrchestrator (adaptador → FinancialGateway)
 *
 * FEATURE_MFE_AR=OFF → no-op (legado continua).
 * Nunca chama Pipeline diretamente (Regra 3.5).
 */

const {
  FeatureFlag,
  FinancialContext,
  OrigemFinanceira
} = require('../domain/enums');

const OPERACAO_PARA_EVENTO = Object.freeze({
  criar: 'ACCOUNT_RECEIVABLE_CREATED',
  created: 'ACCOUNT_RECEIVABLE_CREATED',
  atualizar: 'ACCOUNT_RECEIVABLE_UPDATED',
  updated: 'ACCOUNT_RECEIVABLE_UPDATED',
  cancelar: 'ACCOUNT_RECEIVABLE_CANCELLED',
  cancelled: 'ACCOUNT_RECEIVABLE_CANCELLED',
  baixar: 'ACCOUNT_RECEIVABLE_SETTLED',
  settled: 'ACCOUNT_RECEIVABLE_SETTLED',
  parcial: 'ACCOUNT_RECEIVABLE_PARTIAL',
  partial: 'ACCOUNT_RECEIVABLE_PARTIAL',
  vencido: 'ACCOUNT_RECEIVABLE_OVERDUE',
  overdue: 'ACCOUNT_RECEIVABLE_OVERDUE',
  renegociar: 'ACCOUNT_RECEIVABLE_RENEGOTIATED',
  renegotiated: 'ACCOUNT_RECEIVABLE_RENEGOTIATED'
});

class ReceivableOrchestrator {
  constructor(motor) {
    this.motor = motor;
  }

  isAtivo() {
    return Boolean(this.motor?.featureFlags?.isEnabled(FeatureFlag.FEATURE_MFE_AR));
  }

  async publicarOperacaoAr(db, operacao = {}) {
    if (!this.isAtivo()) {
      return { ok: true, skipped: true, reason: 'FEATURE_MFE_AR_OFF' };
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
      return { ok: false, error: `operação AR desconhecida: ${tipoOp}` };
    }

    const r = await this.motor.gateway.publicarContaReceber(db, {
      eventType,
      origem: operacao.origem || OrigemFinanceira.ERP,
      operationId: operacao.operationId,
      correlationId: operacao.correlationId,
      traceId: operacao.traceId,
      idempotencyKey: operacao.idempotencyKey
        || `ar:${tipoOp}:${operacao.titulo_id || operacao.conta_receber_id || operacao.venda_id || 'x'}:${Date.now()}`,
      operadorId: operacao.operadorId ?? operacao.usuario_id ?? null,
      valor: Number(operacao.valor ?? operacao.valor_parcela ?? 0),
      valor_pago: operacao.valor_pago,
      valor_restante: operacao.valor_restante,
      titulo_id: operacao.titulo_id ?? operacao.conta_receber_id ?? null,
      conta_receber_id: operacao.conta_receber_id ?? operacao.titulo_id ?? null,
      venda_id: operacao.venda_id ?? null,
      cliente_id: operacao.cliente_id ?? null,
      numero_parcela: operacao.numero_parcela ?? null,
      total_parcelas: operacao.total_parcelas ?? null,
      data_vencimento: operacao.data_vencimento ?? operacao.vencimento ?? null,
      parcelas: operacao.parcelas || null,
      payload: operacao.payload
    });

    return {
      ...r,
      context: r.context || FinancialContext.FINANCEIRO
    };
  }
}

module.exports = {
  ReceivableOrchestrator,
  OPERACAO_PARA_EVENTO
};
