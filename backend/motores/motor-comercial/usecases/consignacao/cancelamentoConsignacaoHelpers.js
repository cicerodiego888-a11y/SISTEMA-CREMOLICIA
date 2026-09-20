/**
 * RCM-8.8 — Helpers de cancelamento voluntário da preparação.
 *
 * Status oficiais (constraints): RASCUNHO | ENTREGUE | ACERTADA | QUITADA | ENCERRADA | CANCELADA
 * Não existe VALIDADA no modelo persistido — preparação = RASCUNHO.
 *
 * Persistência sem migration: reutiliza data_encerramento, usuario_encerramento_id, observacao.
 *
 * @module motores/motor-comercial/usecases/consignacao/cancelamentoConsignacaoHelpers
 */

const { STATUS_RASCUNHO, STATUS_CANCELADA } = require('./consignacaoUseCaseHelpers');

const MOTIVOS_CANCELAMENTO = Object.freeze({
  CLIENTE_DESISTIU: 'Cliente desistiu',
  ERRO_PREPARACAO: 'Erro na preparação',
  PRODUTO_INDISPONIVEL: 'Produto indisponível',
  PEDIDO_DUPLICADO: 'Pedido duplicado',
  OUTRO: 'Outro'
});

const MOTIVOS_VALIDOS = Object.freeze(Object.keys(MOTIVOS_CANCELAMENTO));

const PREFIXO_OBS_CANCELAMENTO = '[CANCELAMENTO]';

const MENSAGEM_JA_CANCELADA = 'Esta consignação já está cancelada.';
const MENSAGEM_NAO_ELEGIVEL =
  'Somente consignações em preparação (RASCUNHO) podem ser canceladas.';
const MENSAGEM_NOVA_CONSIGNACAO =
  'Esta consignação foi cancelada. Para realizar uma nova entrega, crie uma nova consignação.';

/**
 * @param {Object|null} consignacao
 * @returns {{ elegivel: boolean, codigo: string|null, mensagem: string|null, idempotente: boolean }}
 */
function avaliarElegibilidadeCancelamento(consignacao) {
  if (!consignacao) {
    return {
      elegivel: false,
      codigo: 'CONSIGNACAO_NAO_ENCONTRADA',
      mensagem: 'Consignação não encontrada',
      idempotente: false
    };
  }

  const status = String(consignacao.status || '').toUpperCase();

  if (status === STATUS_CANCELADA) {
    return {
      elegivel: false,
      codigo: 'CONSIGNACAO_JA_CANCELADA',
      mensagem: MENSAGEM_JA_CANCELADA,
      idempotente: true
    };
  }

  if (status !== STATUS_RASCUNHO) {
    return {
      elegivel: false,
      codigo: 'CONSIGNACAO_NAO_ESTA_EM_RASCUNHO',
      mensagem: MENSAGEM_NAO_ELEGIVEL,
      idempotente: false
    };
  }

  return { elegivel: true, codigo: null, mensagem: null, idempotente: false };
}

/**
 * @param {string} motivo
 * @returns {boolean}
 */
function motivoCancelamentoValido(motivo) {
  return MOTIVOS_VALIDOS.includes(String(motivo || '').toUpperCase());
}

/**
 * Monta texto de observação auditável sem coluna dedicada.
 * @param {string} motivoCodigo
 * @param {string|null} observacao
 * @param {string|null} observacaoAnterior
 * @returns {string}
 */
function montarObservacaoCancelamento(motivoCodigo, observacao = null, observacaoAnterior = null) {
  const codigo = String(motivoCodigo || '').toUpperCase();
  const label = MOTIVOS_CANCELAMENTO[codigo] || codigo;
  const extra = observacao ? String(observacao).trim() : '';
  const linha = extra
    ? `${PREFIXO_OBS_CANCELAMENTO} ${codigo} — ${label}. ${extra}`
    : `${PREFIXO_OBS_CANCELAMENTO} ${codigo} — ${label}.`;

  const anterior = String(observacaoAnterior || '').trim();
  if (!anterior) return linha;
  if (anterior.includes(PREFIXO_OBS_CANCELAMENTO)) return anterior;
  return `${anterior}\n${linha}`;
}

/**
 * Extrai metadados de cancelamento a partir dos campos reutilizados.
 * @param {Object|null} consignacao
 * @returns {Object|null}
 */
function extrairCancelamento(consignacao) {
  if (!consignacao) return null;
  const status = String(consignacao.status || '').toUpperCase();
  if (status !== STATUS_CANCELADA) return null;

  const obs = String(consignacao.observacao || '');
  let motivo = null;
  let motivoLabel = null;
  let observacaoLivre = null;

  const match = obs.match(/\[CANCELAMENTO\]\s*([A-Z_]+)\s*—\s*([^.\n]+)(?:\.\s*(.*))?/i);
  if (match) {
    motivo = String(match[1] || '').toUpperCase();
    motivoLabel = String(match[2] || '').trim();
    observacaoLivre = match[3] ? String(match[3]).trim() : null;
  }

  return {
    status: STATUS_CANCELADA,
    motivo,
    motivoLabel: motivoLabel || (motivo ? MOTIVOS_CANCELAMENTO[motivo] : null),
    observacao: observacaoLivre,
    canceladoEm: consignacao.dataEncerramento || consignacao.dataFechamento || null,
    canceladoPorUsuarioId: consignacao.usuarioEncerramentoId || null,
    mensagem: MENSAGEM_NOVA_CONSIGNACAO
  };
}

module.exports = {
  MOTIVOS_CANCELAMENTO,
  MOTIVOS_VALIDOS,
  PREFIXO_OBS_CANCELAMENTO,
  MENSAGEM_JA_CANCELADA,
  MENSAGEM_NAO_ELEGIVEL,
  MENSAGEM_NOVA_CONSIGNACAO,
  STATUS_ELEGIVEIS_CANCELAMENTO: Object.freeze([STATUS_RASCUNHO]),
  avaliarElegibilidadeCancelamento,
  motivoCancelamentoValido,
  montarObservacaoCancelamento,
  extrairCancelamento
};
