/**
 * Resolve erro técnico → mensagem operacional do catálogo UX-1.
 *
 * @module frontend/modules/motor-comercial/messages/resolveOperationalError
 */

const ErrorMessages = require('./ErrorMessages');
const RecoveryMessages = require('./RecoveryMessages');

/**
 * @param {Error|string|Object} error
 * @param {{ context?: string }} [options]
 * @returns {string}
 */
function resolveOperationalError(error, options = {}) {
  if (error && error.operationalMessage) {
    return String(error.operationalMessage);
  }

  const raw = String((error && error.message) || error || '').trim();
  const ctx = String(options.context || '').toLowerCase();

  if (/network|failed to fetch|offline|econnrefused|timeout|net::|socket/i.test(raw)) {
    return RecoveryMessages.CONEXAO;
  }
  if (/checksum|corrupt|integridade|invalid checkpoint/i.test(raw)) {
    return RecoveryMessages.OPERACAO_CORROMPIDA;
  }
  if (/autoriza.*expir|auth.*expir/i.test(raw)) {
    return RecoveryMessages.AUTH_EXPIRADA;
  }
  if (/expir/i.test(raw)) {
    return RecoveryMessages.OPERACAO_EXPIRADA;
  }
  if (/não encontrada|nao encontrada|not found|404|removid/i.test(raw)) {
    if (ctx.includes('cliente')) return ErrorMessages.CLIENTE_NAO_ENCONTRADO;
    return RecoveryMessages.OPERACAO_REMOVIDA;
  }
  if (/não pode mais ser retomada|nao pode mais ser retomada|not resumable/i.test(raw)) {
    return RecoveryMessages.RETOMADA_INDISPONIVEL;
  }
  if (/permiss|autorizad|forbidden|401|403/i.test(raw)) {
    return ErrorMessages.PERMISSAO;
  }
  if (/identificador|id.*não|id.*nao|sem id/i.test(raw)) {
    return ErrorMessages.CONSIGNACAO_ID_AUSENTE;
  }

  if (ctx.includes('criar') || ctx.includes('create')) return ErrorMessages.CONSIGNACAO_CRIAR;
  if (ctx.includes('rascunho') || ctx.includes('draft')) return ErrorMessages.CONSIGNACAO_SALVAR_RASCUNHO;
  if (ctx.includes('entrega') || ctx.includes('deliver')) return ErrorMessages.ENTREGA_REGISTRAR;
  if (ctx.includes('pagamento') || ctx.includes('payment')) return ErrorMessages.PAGAMENTO_REGISTRAR;
  if (ctx.includes('prestacao') || ctx.includes('prestação')) return ErrorMessages.PRESTACAO_CARREGAR;
  if (ctx.includes('perfil')) return ErrorMessages.PERFIL_CARREGAR;
  if (ctx.includes('dashboard')) return ErrorMessages.DASHBOARD_CARREGAR;

  // Nunca devolver mensagem genérica opaca — orientar o próximo passo
  if (raw && raw.length < 180 && !/typeerror|cannot read|undefined is not|null is not/i.test(raw)) {
    return raw;
  }

  return RecoveryMessages.RETOMADA_INDISPONIVEL;
}

module.exports = {
  resolveOperationalError
};
