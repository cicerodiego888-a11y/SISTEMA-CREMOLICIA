/**
 * MFE — Orchestrators
 */

const { CashOrchestrator, OPERACAO_PARA_EVENTO: CASH_OPS } = require('./CashOrchestrator');
const { ReceivableOrchestrator, OPERACAO_PARA_EVENTO: AR_OPS } = require('./ReceivableOrchestrator');

module.exports = {
  CashOrchestrator,
  ReceivableOrchestrator,
  OPERACAO_PARA_EVENTO: CASH_OPS,
  OPERACAO_AR_PARA_EVENTO: AR_OPS
};
