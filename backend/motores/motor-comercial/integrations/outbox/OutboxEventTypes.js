/**
 * Tipos de evento Outbox do Motor Comercial — Sprint P-2.
 *
 * @module motores/motor-comercial/integrations/outbox/OutboxEventTypes
 */

const OUTBOX_EVENT_TYPES = Object.freeze({
  FINANCEIRO_LANCAR_RECEITA: 'FinanceiroLancarReceita',
  FINANCEIRO_REGISTRAR_PAGAMENTO: 'FinanceiroRegistrarPagamento',
  FINANCEIRO_REGISTRAR_PERDA: 'FinanceiroRegistrarPerda',
  ESTOQUE_BAIXAR_PRODUTO: 'EstoqueBaixarProduto',
  ESTOQUE_ENTRADA_DEVOLUCAO: 'EstoqueEntradaDevolucao',
  ESTOQUE_REGISTRAR_PERDA: 'EstoqueRegistrarPerda',
  ESTOQUE_TRANSFERENCIA: 'EstoqueTransferencia'
});

const OUTBOX_BRIDGE_NAMES = Object.freeze({
  FINANCEIRO: 'Financeiro',
  ESTOQUE: 'Estoque',
  CLIENTE: 'Cliente',
  USUARIO: 'Usuario'
});

module.exports = {
  OUTBOX_EVENT_TYPES,
  OUTBOX_BRIDGE_NAMES
};
