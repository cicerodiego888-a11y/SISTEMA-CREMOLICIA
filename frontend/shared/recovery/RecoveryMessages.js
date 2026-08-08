/**
 * CDS Recovery Framework — Mensagens operacionais (nunca técnicas ao operador)
 *
 * UX-1: mensagens específicas com próximo passo (sem genéricas opacas).
 *
 * @module frontend/shared/recovery/RecoveryMessages
 */

const MESSAGES = Object.freeze({
  NOT_RESUMABLE:
    'Não foi possível retomar esta operação automaticamente.\n\nAbra pela Central de Consignações e continue de onde parou.',
  REMOVED:
    'Esta operação foi removida ou não está mais disponível.\n\nAtualize a lista na Central de Consignações.',
  RECOVER_FAILED:
    'Não foi possível retomar esta operação automaticamente.\n\nAbra pela Central de Consignações e continue de onde parou.',
  CONNECTION:
    'Verifique sua conexão e tente novamente.\n\nSe a operação já tiver sido salva, continue pela Central.',
  CORRUPT:
    'O rascunho local desta operação não pode ser usado.\n\nAbra a consignação pela Central — os dados oficiais estão no servidor.',
  EXPIRED:
    'O prazo para retomar esta operação expirou.\n\nInicie novamente ou abra pela Central de Consignações.',
  AUTH_EXPIRED:
    'A autorização gerencial desta operação expirou.\n\nSolicite nova liberação se ainda precisar continuar.'
});

/**
 * Converte erro técnico em mensagem operacional.
 * @param {Error|string|Object} error
 * @returns {string}
 */
function toOperationalMessage(error) {
  const raw = String(
    (error && error.operationalMessage)
    || (error && error.message)
    || error
    || ''
  );

  if (/não encontrada|nao encontrada|not found|404|removid/i.test(raw)) {
    return MESSAGES.REMOVED;
  }
  if (/checksum|corrupt|integridade|invalid checkpoint/i.test(raw)) {
    return MESSAGES.CORRUPT;
  }
  if (/network|failed to fetch|offline|econnrefused|timeout|net::|socket/i.test(raw)) {
    return MESSAGES.CONNECTION;
  }
  if (/autoriza.*expir|auth.*expir/i.test(raw)) {
    return MESSAGES.AUTH_EXPIRED;
  }
  if (/expir/i.test(raw)) {
    return MESSAGES.EXPIRED;
  }
  if (/não pode mais ser retomada|nao pode mais ser retomada/i.test(raw)) {
    return MESSAGES.NOT_RESUMABLE;
  }
  if (/não foi possível recuperar|nao foi possivel recuperar|não foi possível retomar|nao foi possivel retomar/i.test(raw)) {
    return MESSAGES.RECOVER_FAILED;
  }

  // Erros legíveis curtos passam ao operador; técnicos caem no fallback com próximo passo
  if (raw && raw.length < 180 && !/typeerror|cannot read|undefined is not|null is not/i.test(raw)) {
    return raw;
  }

  return MESSAGES.RECOVER_FAILED;
}

function createOperationalError(codeOrMessage, cause) {
  const message = MESSAGES[codeOrMessage] || codeOrMessage || MESSAGES.RECOVER_FAILED;
  const err = new Error(message);
  err.operational = true;
  err.operationalMessage = message;
  if (cause) err.cause = cause;
  return err;
}

module.exports = {
  MESSAGES,
  toOperationalMessage,
  createOperationalError
};
