/**
 * MFE — Bridges operacionais
 */

const { PdvArBridge, OPERACAO_PARA_EVENTO: PDV_AR_OPS } = require('./PdvArBridge');
const { ComercialArBridge, OPERACAO_PARA_EVENTO: COMERCIAL_AR_OPS } = require('./ComercialArBridge');
const { PurchasePayableBridge, OPERACAO_PARA_EVENTO: COMPRA_AP_OPS } = require('./PurchasePayableBridge');

module.exports = {
  PdvArBridge,
  ComercialArBridge,
  PurchasePayableBridge,
  OPERACAO_PDV_AR_PARA_EVENTO: PDV_AR_OPS,
  OPERACAO_COMERCIAL_AR_PARA_EVENTO: COMERCIAL_AR_OPS,
  OPERACAO_COMPRA_AP_PARA_EVENTO: COMPRA_AP_OPS
};
