/**
 * MFE-03 — Trilha de auditoria financeira obrigatória
 *
 * Toda operação deve carregar:
 * operationId · correlationId · traceId · eventId · idempotencyKey
 */

const crypto = require('crypto');

function novoId(prefixo = 'mfe') {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${prefixo}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * @param {object} props
 * @returns {{ operationId, correlationId, traceId, eventId, idempotencyKey }}
 */
function criarTrilhaAuditoriaFinanceira(props = {}) {
  const idempotencyKey = props.idempotencyKey
    || props.idempotency_key
    || novoId('idemp');
  const correlationId = props.correlationId
    || props.correlation_id
    || idempotencyKey;
  const traceId = props.traceId
    || props.trace_id
    || correlationId;
  const operationId = props.operationId
    || props.operation_id
    || props.id
    || null;
  const eventId = props.eventId
    || props.event_id
    || null;

  return {
    operationId,
    correlationId,
    traceId,
    eventId,
    idempotencyKey
  };
}

function assertTrilhaAuditoriaCompleta(trail, { exigirEventId = false, exigirOperationId = true } = {}) {
  const erros = [];
  if (exigirOperationId && !trail.operationId) erros.push('operationId ausente');
  if (!trail.correlationId) erros.push('correlationId ausente');
  if (!trail.traceId) erros.push('traceId ausente');
  if (!trail.idempotencyKey) erros.push('idempotencyKey ausente');
  if (exigirEventId && trail.eventId == null) erros.push('eventId ausente');
  return { ok: erros.length === 0, erros };
}

module.exports = {
  criarTrilhaAuditoriaFinanceira,
  assertTrilhaAuditoriaCompleta,
  novoId
};
