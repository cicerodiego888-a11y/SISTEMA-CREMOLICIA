/**
 * MFE-03 — FinancialOperation
 * Representa uma operação financeira unificada (domínio).
 * Sem regras operacionais de caixa/banco/AR/AP.
 */

const crypto = require('crypto');
const {
  FinancialOperationType,
  OrigemFinanceira,
  MeioFinanceiro,
  MOEDA_PADRAO,
  isFinancialOperationTypeValido
} = require('./enums');
const { FinancialValidationError } = require('./errors');
const { criarTrilhaAuditoriaFinanceira } = require('./FinancialAuditTrail');

class FinancialOperation {
  constructor(props = {}) {
    this.id = props.id ?? props.operationId ?? null;
    this.operationId = this.id;
    this.type = props.type || props.tipo || null;
    this.origem = props.origem || OrigemFinanceira.MFE;
    this.meio = props.meio || props.meioFinanceiro || null;
    this.valor = props.valor != null ? Number(props.valor) : null;
    this.moeda = props.moeda || MOEDA_PADRAO;
    this.documentId = props.documentId || props.documentoId || null;
    this.status = props.status || 'DRAFT';
    this.payload = props.payload && typeof props.payload === 'object' ? { ...props.payload } : {};

    const trail = criarTrilhaAuditoriaFinanceira(props);
    this.correlationId = trail.correlationId;
    this.traceId = trail.traceId;
    this.eventId = trail.eventId;
    this.idempotencyKey = trail.idempotencyKey;

    this.usuario = props.usuario ?? props.operadorId ?? props.operador ?? null;
    this.empresa = props.empresa ?? props.empresaId ?? null;
    this.createdAt = props.createdAt || props.created_at || new Date().toISOString();
  }

  static criar(props = {}) {
    const id = props.id
      || props.operationId
      || (crypto.randomUUID ? crypto.randomUUID() : `op-${Date.now()}`);
    return new FinancialOperation({ ...props, id, operationId: id });
  }

  validar() {
    const erros = [];
    if (!this.operationId) erros.push('operationId é obrigatório');
    if (!this.type || !isFinancialOperationTypeValido(this.type)) {
      erros.push(`type inválido: ${this.type}`);
    }
    if (!this.origem) erros.push('origem é obrigatória');
    if (!this.correlationId) erros.push('correlationId é obrigatório');
    if (!this.traceId) erros.push('traceId é obrigatório');
    if (!this.idempotencyKey) erros.push('idempotencyKey é obrigatória');
    if (this.meio != null && !Object.prototype.hasOwnProperty.call(MeioFinanceiro, this.meio)) {
      erros.push(`meio inválido: ${this.meio}`);
    }
    return { ok: erros.length === 0, erros };
  }

  assertValid() {
    const v = this.validar();
    if (!v.ok) throw new FinancialValidationError(v.erros);
    return this;
  }

  toJSON() {
    return {
      id: this.id,
      operationId: this.operationId,
      type: this.type,
      origem: this.origem,
      meio: this.meio,
      valor: this.valor,
      moeda: this.moeda,
      documentId: this.documentId,
      status: this.status,
      correlationId: this.correlationId,
      traceId: this.traceId,
      eventId: this.eventId,
      idempotencyKey: this.idempotencyKey,
      usuario: this.usuario,
      empresa: this.empresa,
      createdAt: this.createdAt,
      payload: this.payload
    };
  }
}

FinancialOperation.Types = FinancialOperationType;

module.exports = FinancialOperation;
