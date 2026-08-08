/**
 * MFE-05.1 — Bridge PDV → Contas a Receber (adaptador temporário)
 *
 * FEATURE_MFE_PDV_AR=OFF → no-op (legado INSERT continua).
 * FEATURE_MFE_PDV_AR=ON  → FinancialGateway → Pipeline → Ledger → Handler.
 *
 * Nunca chama Pipeline diretamente (Regra 3.5).
 */

const {
  FeatureFlag,
  FinancialContext,
  OrigemFinanceira
} = require('../domain/enums');

const OPERACAO_PARA_EVENTO = Object.freeze({
  venda_completa: 'SALE_COMPLETED',
  sale_completed: 'SALE_COMPLETED',
  venda_cancelada: 'SALE_CANCELLED',
  sale_cancelled: 'SALE_CANCELLED',
  pagamento_recebido: 'PAYMENT_RECEIVED',
  payment_received: 'PAYMENT_RECEIVED'
});

class PdvArBridge {
  constructor(motor) {
    this.motor = motor;
  }

  isAtivo() {
    return Boolean(this.motor?.featureFlags?.isEnabled(FeatureFlag.FEATURE_MFE_PDV_AR));
  }

  /**
   * @param {object} db
   * @param {object} operacao
   */
  async publicar(db, operacao = {}) {
    if (!this.isAtivo()) {
      return { ok: true, skipped: true, reason: 'FEATURE_MFE_PDV_AR_OFF' };
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
      return { ok: false, error: `operação PDV-AR desconhecida: ${tipoOp}` };
    }

    const gateway = this.motor.gateway;
    const metodo = eventType === 'PAYMENT_RECEIVED'
      ? 'publicarPagamento'
      : (eventType === 'SALE_CANCELLED' ? 'publicarVenda' : 'publicarVenda');

    const r = await gateway[metodo](db, {
      eventType,
      canal: 'PDV_AR',
      origem: operacao.origem || OrigemFinanceira.PDV,
      operationId: operacao.operationId,
      correlationId: operacao.correlationId,
      traceId: operacao.traceId,
      idempotencyKey: operacao.idempotencyKey
        || `pdv-ar:${tipoOp || eventType}:${operacao.venda_id || 'x'}:${Date.now()}`,
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
      persistirTitulo: operacao.persistirTitulo !== false,
      bridge: 'PDV_AR',
      payload: operacao.payload
    });

    return {
      ...r,
      bridge: 'PdvArBridge',
      context: r.context || FinancialContext.PDV
    };
  }
}

module.exports = {
  PdvArBridge,
  OPERACAO_PARA_EVENTO
};
