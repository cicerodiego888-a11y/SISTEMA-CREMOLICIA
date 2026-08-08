class LedgerImmutableError extends Error {
  constructor(message = 'Ledger financeiro é append-only. UPDATE e DELETE são proibidos.') {
    super(message);
    this.name = 'LedgerImmutableError';
    this.code = 'MFE_LEDGER_IMMUTABLE';
    this.status = 409;
  }
}

class IdempotencyConflictError extends Error {
  constructor(idempotencyKey) {
    super(`Evento já processado: ${idempotencyKey}`);
    this.name = 'IdempotencyConflictError';
    this.code = 'MFE_IDEMPOTENCY_CONFLICT';
    this.status = 409;
    this.idempotencyKey = idempotencyKey;
  }
}

class FeatureFlagDisabledError extends Error {
  constructor(flag) {
    super(`Feature flag desligada: ${flag}`);
    this.name = 'FeatureFlagDisabledError';
    this.code = 'MFE_FLAG_OFF';
    this.status = 503;
    this.flag = flag;
  }
}

class FinancialValidationError extends Error {
  constructor(erros = []) {
    const list = Array.isArray(erros) ? erros : [erros];
    super(list.join(' '));
    this.name = 'FinancialValidationError';
    this.code = 'MFE_VALIDATION';
    this.status = 400;
    this.erros = list;
  }
}

class LedgerEntryDirectForbiddenError extends Error {
  constructor(message = 'Proibido criar LedgerEntry fora do pipeline de eventos (MFE-02).') {
    super(message);
    this.name = 'LedgerEntryDirectForbiddenError';
    this.code = 'MFE_LEDGER_DIRECT_FORBIDDEN';
    this.status = 403;
  }
}

class HandlerNotFoundError extends Error {
  constructor(eventType) {
    super(`Nenhum handler registrado para o evento: ${eventType}`);
    this.name = 'HandlerNotFoundError';
    this.code = 'MFE_HANDLER_NOT_FOUND';
    this.status = 422;
    this.eventType = eventType;
  }
}

module.exports = {
  LedgerImmutableError,
  IdempotencyConflictError,
  FeatureFlagDisabledError,
  FinancialValidationError,
  LedgerEntryDirectForbiddenError,
  HandlerNotFoundError
};
