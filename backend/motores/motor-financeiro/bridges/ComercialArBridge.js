/**
 * MFE-05.1 — Bridge Motor Comercial → Contas a Receber (adaptador temporário)
 *
 * FEATURE_MFE_COMERCIAL_AR=OFF → no-op (legado continua).
 * FEATURE_MFE_COMERCIAL_AR=ON  → FinancialGateway → Pipeline → Ledger → Handler.
 *
 * Nunca chama Pipeline diretamente (Regra 3.5).
 */

const {
  FeatureFlag,
  FinancialContext,
  OrigemFinanceira
} = require('../domain/enums');

const OPERACAO_PARA_EVENTO = Object.freeze({
  credito_gerado: 'COMMERCIAL_CREDIT_GENERATED',
  commercial_credit_generated: 'COMMERCIAL_CREDIT_GENERATED',
  credito_usado: 'COMMERCIAL_CREDIT_USED',
  commercial_credit_used: 'COMMERCIAL_CREDIT_USED',
  pagamento_recebido: 'PAYMENT_RECEIVED',
  payment_received: 'PAYMENT_RECEIVED',
  venda_completa: 'SALE_COMPLETED',
  sale_completed: 'SALE_COMPLETED',
  venda_cancelada: 'SALE_CANCELLED',
  sale_cancelled: 'SALE_CANCELLED'
});

class ComercialArBridge {
  constructor(motor) {
    this.motor = motor;
  }

  isAtivo() {
    return Boolean(this.motor?.featureFlags?.isEnabled(FeatureFlag.FEATURE_MFE_COMERCIAL_AR));
  }

  /**
   * @param {object} db
   * @param {object} operacao
   */
  async publicar(db, operacao = {}) {
    if (!this.isAtivo()) {
      return { ok: true, skipped: true, reason: 'FEATURE_MFE_COMERCIAL_AR_OFF' };
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
      return { ok: false, error: `operação Comercial-AR desconhecida: ${tipoOp}` };
    }

    const gateway = this.motor.gateway;
    let metodo = 'publicarCreditoComercial';
    if (eventType === 'PAYMENT_RECEIVED') metodo = 'publicarRecebimento';
    else if (eventType === 'SALE_COMPLETED' || eventType === 'SALE_CANCELLED') metodo = 'publicarVenda';
    else if (eventType === 'COMMERCIAL_CREDIT_USED') metodo = 'publicarCreditoComercial';

    const r = await gateway[metodo](db, {
      eventType,
      canal: 'COMERCIAL_AR',
      origem: operacao.origem || OrigemFinanceira.COMERCIAL,
      operationId: operacao.operationId,
      correlationId: operacao.correlationId,
      traceId: operacao.traceId,
      idempotencyKey: operacao.idempotencyKey
        || `comercial-ar:${tipoOp || eventType}:${operacao.consignacao_id || operacao.cliente_id || 'x'}:${Date.now()}`,
      operadorId: operacao.operadorId ?? operacao.usuario_id ?? null,
      valor: Number(operacao.valor ?? 0),
      valor_pago: operacao.valor_pago,
      valor_restante: operacao.valor_restante,
      titulo_id: operacao.titulo_id ?? operacao.conta_receber_id ?? null,
      conta_receber_id: operacao.conta_receber_id ?? operacao.titulo_id ?? null,
      venda_id: operacao.venda_id ?? null,
      consignacao_id: operacao.consignacao_id ?? null,
      cliente_id: operacao.cliente_id ?? null,
      numero_parcela: operacao.numero_parcela ?? null,
      total_parcelas: operacao.total_parcelas ?? null,
      data_vencimento: operacao.data_vencimento ?? operacao.vencimento ?? null,
      parcelas: operacao.parcelas || null,
      persistirTitulo: operacao.persistirTitulo !== false,
      bridge: 'COMERCIAL_AR',
      payload: operacao.payload
    });

    return {
      ...r,
      bridge: 'ComercialArBridge',
      context: r.context || FinancialContext.COMERCIAL
    };
  }
}

module.exports = {
  ComercialArBridge,
  OPERACAO_PARA_EVENTO
};
