/**
 * Mensageria operacional do Motor Comercial — UX-1
 *
 * SSOT de comunicação com o operador.
 *
 * @module frontend/modules/motor-comercial/messages
 */

const SuccessMessages = require('./SuccessMessages');
const ErrorMessages = require('./ErrorMessages');
const WarningMessages = require('./WarningMessages');
const InfoMessages = require('./InfoMessages');
const RecoveryMessages = require('./RecoveryMessages');
const EmptyMessages = require('./EmptyMessages');
const LoadingMessages = require('./LoadingMessages');
const ConfirmMessages = require('./ConfirmMessages');
const { resolveOperationalError } = require('./resolveOperationalError');

function _notifyRaw(message, variant) {
  const { notify } = require('../utils/operacional');
  notify(message, variant);
}

/**
 * @param {string} keyOrText — chave do catálogo SuccessMessages ou texto já resolvido
 */
function notifySuccess(keyOrText) {
  const msg = SuccessMessages[keyOrText] || keyOrText;
  _notifyRaw(msg, 'success');
  return msg;
}

function notifyError(keyOrText, error) {
  let msg = ErrorMessages[keyOrText] || keyOrText;
  if (error && !ErrorMessages[keyOrText]) {
    msg = resolveOperationalError(error, { context: keyOrText });
  } else if (error && ErrorMessages[keyOrText] && error.message) {
    // Mantém mensagem de catálogo; detalhe técnico fica só no console se necessário
  }
  _notifyRaw(msg, 'error');
  return msg;
}

function notifyWarning(keyOrText) {
  const msg = WarningMessages[keyOrText] || keyOrText;
  _notifyRaw(msg, 'warning');
  return msg;
}

function notifyInfo(keyOrText, ...args) {
  const entry = InfoMessages[keyOrText];
  const msg = typeof entry === 'function' ? entry(...args) : (entry || keyOrText);
  _notifyRaw(msg, 'info');
  return msg;
}

/**
 * Recuperação parcial — operação parcialmente concluída.
 * @param {string} keyOrText
 */
function notifyRecovery(keyOrText) {
  const msg = RecoveryMessages[keyOrText] || keyOrText;
  _notifyRaw(msg, 'warning');
  return msg;
}

function loadingText(keyOrText) {
  return LoadingMessages[keyOrText] || keyOrText;
}

function emptyState(key) {
  const entry = EmptyMessages[key];
  if (!entry) return { title: key, description: '' };
  return { title: entry.title, description: entry.description || '' };
}

function confirmCopy(key, overrides = {}) {
  const entry = ConfirmMessages[key] || {};
  return {
    title: overrides.title || entry.title || 'Confirmar',
    message: overrides.message || entry.message || 'Deseja continuar?'
  };
}

function operationalMessage(error, options) {
  return resolveOperationalError(error, options);
}

module.exports = {
  SuccessMessages,
  ErrorMessages,
  WarningMessages,
  InfoMessages,
  RecoveryMessages,
  EmptyMessages,
  LoadingMessages,
  ConfirmMessages,
  resolveOperationalError,
  operationalMessage,
  notifySuccess,
  notifyError,
  notifyWarning,
  notifyInfo,
  notifyRecovery,
  loadingText,
  emptyState,
  confirmCopy
};
