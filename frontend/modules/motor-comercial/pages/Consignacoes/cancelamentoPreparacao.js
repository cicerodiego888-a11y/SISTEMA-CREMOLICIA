/**
 * RCM-8.8 — Motivos e fluxo de UI do cancelamento voluntário.
 *
 * @module frontend/modules/motor-comercial/pages/Consignacoes/cancelamentoPreparacao
 */

const MOTIVOS_CANCELAMENTO = Object.freeze([
  { value: 'CLIENTE_DESISTIU', label: 'Cliente desistiu' },
  { value: 'ERRO_PREPARACAO', label: 'Erro na preparação' },
  { value: 'PRODUTO_INDISPONIVEL', label: 'Produto indisponível' },
  { value: 'PEDIDO_DUPLICADO', label: 'Pedido duplicado' },
  { value: 'OUTRO', label: 'Outro' }
]);

const MENSAGEM_CANCELADA_NOVA =
  'Esta consignação foi cancelada. Para realizar uma nova entrega, crie uma nova consignação.';

/**
 * @param {Object|null} consignacao
 * @returns {boolean}
 */
function podeCancelarPreparacao(consignacao) {
  return String(consignacao?.status || '').toUpperCase() === 'RASCUNHO';
}

/**
 * @param {Object|null} consignacao
 * @returns {Object|null}
 */
function lerCancelamento(consignacao) {
  if (!consignacao) return null;
  if (consignacao.cancelamento) return consignacao.cancelamento;
  if (String(consignacao.status || '').toUpperCase() !== 'CANCELADA') return null;

  const obs = String(consignacao.observacao || '');
  const match = obs.match(/\[CANCELAMENTO\]\s*([A-Z_]+)\s*—\s*([^.\n]+)(?:\.\s*(.*))?/i);
  return {
    motivo: match ? String(match[1]).toUpperCase() : null,
    motivoLabel: match
      ? String(match[2]).trim()
      : (MOTIVOS_CANCELAMENTO.find((m) => m.value === consignacao.motivo)?.label || null),
    observacao: match && match[3] ? String(match[3]).trim() : null,
    canceladoEm: consignacao.dataEncerramento || consignacao.dataFechamento || null,
    canceladoPorUsuarioId: consignacao.usuarioEncerramentoId || null,
    mensagem: MENSAGEM_CANCELADA_NOVA
  };
}

module.exports = {
  MOTIVOS_CANCELAMENTO,
  MENSAGEM_CANCELADA_NOVA,
  podeCancelarPreparacao,
  lerCancelamento
};
