/**
 * Handlers Outbox → Bridges do Motor Comercial.
 *
 * @module motores/motor-comercial/integrations/outbox/ComercialOutboxHandlers
 */

const { OUTBOX_EVENT_TYPES } = require('./OutboxEventTypes');

/**
 * @param {Object} bridges
 * @returns {Object<string, Function>}
 */
function criarComercialOutboxHandlers(bridges = {}) {
  const financeiro = bridges.financeiroBridge ?? null;
  const estoque = bridges.estoqueBridge ?? null;

  return {
    [OUTBOX_EVENT_TYPES.FINANCEIRO_LANCAR_RECEITA]: async (payload) => {
      if (!financeiro?.registrarReceitaConsignacao) {
        throw new Error('FinanceiroBridge.registrarReceitaConsignacao não disponível');
      }
      return financeiro.registrarReceitaConsignacao(payload);
    },

    [OUTBOX_EVENT_TYPES.FINANCEIRO_REGISTRAR_PAGAMENTO]: async (payload) => {
      if (!financeiro?.registrarRecebimento) {
        throw new Error('FinanceiroBridge.registrarRecebimento não disponível');
      }
      return financeiro.registrarRecebimento(payload);
    },

    [OUTBOX_EVENT_TYPES.FINANCEIRO_REGISTRAR_PERDA]: async (payload) => {
      if (!financeiro?.registrarPerda) {
        throw new Error('FinanceiroBridge.registrarPerda não disponível');
      }
      return financeiro.registrarPerda(payload);
    },

    [OUTBOX_EVENT_TYPES.ESTOQUE_BAIXAR_PRODUTO]: async (payload) => {
      if (!estoque?.registrarSaidaConsignacao) {
        throw new Error('EstoqueBridge.registrarSaidaConsignacao não disponível');
      }
      return estoque.registrarSaidaConsignacao(payload);
    },

    [OUTBOX_EVENT_TYPES.ESTOQUE_ENTRADA_DEVOLUCAO]: async (payload) => {
      if (!estoque?.registrarEntradaConsignacao) {
        throw new Error('EstoqueBridge.registrarEntradaConsignacao não disponível');
      }
      return estoque.registrarEntradaConsignacao(payload);
    },

    [OUTBOX_EVENT_TYPES.ESTOQUE_REGISTRAR_PERDA]: async (payload) => {
      if (typeof estoque?.registrarPerdaConsignacao !== 'function') {
        throw new Error('EstoqueBridge.registrarPerdaConsignacao não disponível');
      }
      return estoque.registrarPerdaConsignacao(payload);
    },

    [OUTBOX_EVENT_TYPES.ESTOQUE_TRANSFERENCIA]: async (payload) => {
      if (!estoque?.registrarTransferencia) {
        throw new Error('EstoqueBridge.registrarTransferencia não disponível');
      }
      return estoque.registrarTransferencia(payload);
    }
  };
}

module.exports = { criarComercialOutboxHandlers };
