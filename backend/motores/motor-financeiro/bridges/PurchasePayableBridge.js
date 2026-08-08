/**
 * MFE-06 — Bridge Compras → Contas a Pagar (adaptador temporário)
 *
 * FEATURE_MFE_AP=OFF → no-op (legado INSERT financeiro continua).
 * FEATURE_MFE_AP=ON  → FinancialGateway → Pipeline → Ledger → FinancialPayableHandler.
 *
 * Nunca chama Pipeline diretamente (Regra 3.5 / 3.6).
 */

const {
  FeatureFlag,
  FinancialContext,
  OrigemFinanceira
} = require('../domain/enums');

const OPERACAO_PARA_EVENTO = Object.freeze({
  compra_confirmada: 'PURCHASE_CONFIRMED',
  purchase_confirmed: 'PURCHASE_CONFIRMED',
  compra_cancelada: 'PURCHASE_CANCELLED',
  purchase_cancelled: 'PURCHASE_CANCELLED',
  criar: 'ACCOUNT_PAYABLE_CREATED',
  created: 'ACCOUNT_PAYABLE_CREATED',
  atualizar: 'ACCOUNT_PAYABLE_UPDATED',
  updated: 'ACCOUNT_PAYABLE_UPDATED',
  cancelar: 'ACCOUNT_PAYABLE_CANCELLED',
  cancelled: 'ACCOUNT_PAYABLE_CANCELLED',
  baixar: 'ACCOUNT_PAYABLE_SETTLED',
  settled: 'ACCOUNT_PAYABLE_SETTLED',
  parcial: 'ACCOUNT_PAYABLE_PARTIAL',
  partial: 'ACCOUNT_PAYABLE_PARTIAL',
  vencido: 'ACCOUNT_PAYABLE_OVERDUE',
  overdue: 'ACCOUNT_PAYABLE_OVERDUE',
  renegociar: 'ACCOUNT_PAYABLE_RENEGOTIATED',
  renegotiated: 'ACCOUNT_PAYABLE_RENEGOTIATED'
});

class PurchasePayableBridge {
  constructor(motor) {
    this.motor = motor;
  }

  isAtivo() {
    return Boolean(this.motor?.featureFlags?.isEnabled(FeatureFlag.FEATURE_MFE_AP));
  }

  /**
   * @param {object} db
   * @param {object} operacao
   */
  async publicar(db, operacao = {}) {
    if (!this.isAtivo()) {
      return { ok: true, skipped: true, reason: 'FEATURE_MFE_AP_OFF' };
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
      return { ok: false, error: `operação Compra-AP desconhecida: ${tipoOp}` };
    }

    const isCompra = eventType === 'PURCHASE_CONFIRMED' || eventType === 'PURCHASE_CANCELLED';
    const metodo = isCompra ? 'publicarCompra' : 'publicarContaPagar';

    const r = await this.motor.gateway[metodo](db, {
      eventType,
      canal: isCompra ? 'COMPRA' : 'CONTA_PAGAR',
      origem: operacao.origem || OrigemFinanceira.COMPRA || OrigemFinanceira.ERP,
      operationId: operacao.operationId,
      correlationId: operacao.correlationId,
      traceId: operacao.traceId,
      idempotencyKey: operacao.idempotencyKey
        || `compra-ap:${tipoOp || eventType}:${operacao.compra_id || 'x'}:${Date.now()}`,
      operadorId: operacao.operadorId ?? operacao.usuario_id ?? null,
      valor: Number(operacao.valor ?? operacao.total ?? 0),
      valor_pago: operacao.valor_pago,
      valor_restante: operacao.valor_restante,
      titulo_id: operacao.titulo_id ?? operacao.conta_pagar_id ?? null,
      conta_pagar_id: operacao.conta_pagar_id ?? operacao.titulo_id ?? null,
      compra_id: operacao.compra_id ?? operacao.id ?? null,
      fornecedor: operacao.fornecedor || null,
      pessoa_nome: operacao.fornecedor || operacao.pessoa_nome || null,
      numero_parcela: operacao.numero_parcela ?? null,
      total_parcelas: operacao.total_parcelas ?? null,
      data_vencimento: operacao.data_vencimento ?? operacao.vencimento ?? null,
      data_compra: operacao.data_compra ?? null,
      forma_pagamento: operacao.forma_pagamento ?? null,
      condicao_pagamento: operacao.condicao_pagamento ?? null,
      parcelas: operacao.parcelas || null,
      persistirTitulo: operacao.persistirTitulo !== false,
      bridge: 'PURCHASE_AP',
      payload: operacao.payload
    });

    return {
      ...r,
      bridge: 'PurchasePayableBridge',
      context: r.context || FinancialContext.ERP
    };
  }
}

module.exports = {
  PurchasePayableBridge,
  OPERACAO_PARA_EVENTO
};
