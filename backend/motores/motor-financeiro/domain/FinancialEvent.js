/**
 * MFE-01 — Envelope de evento financeiro (domínio)
 */

const { OrigemFinanceira } = require('./enums');
const { FinancialValidationError } = require('./errors');
const crypto = require('crypto');

class FinancialEvent {
  /**
   * @param {object} props
   */
  constructor(props = {}) {
    this.id = props.id ?? null;
    this.type = props.type || props.evento || null;
    this.origem = props.origem || OrigemFinanceira.SISTEMA;
    this.context = props.context || props.contexto || null;
    this.financialStatus = props.financialStatus || props.statusFinanceiro || null;
    this.payload = props.payload && typeof props.payload === 'object' ? { ...props.payload } : {};
    this.correlationId = props.correlationId || props.correlation_id || null;
    this.causationId = props.causationId || props.causation_id || null;
    this.traceId = props.traceId || props.trace_id || null;
    this.idempotencyKey = props.idempotencyKey || props.idempotency_key || null;
    this.operadorId = props.operadorId ?? props.operador_id ?? props.operador ?? null;
    this.timestamp = props.timestamp || props.createdAt || new Date().toISOString();
    this.status = props.status || 'RECEIVED';
  }

  static criar(props = {}) {
    const ev = new FinancialEvent(props);
    if (!ev.idempotencyKey) {
      ev.idempotencyKey = crypto.randomUUID
        ? crypto.randomUUID()
        : `mfe-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }
    if (!ev.correlationId) {
      ev.correlationId = ev.idempotencyKey;
    }
    if (!ev.traceId) {
      ev.traceId = ev.correlationId;
    }
    return ev;
  }

  validar() {
    const erros = [];
    if (!this.type || !String(this.type).trim()) erros.push('type é obrigatório');
    if (!this.origem) erros.push('origem é obrigatória');
    if (!this.idempotencyKey) erros.push('idempotencyKey é obrigatória');
    if (!this.correlationId) erros.push('correlationId é obrigatório');
    if (!this.traceId) erros.push('traceId é obrigatório');
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
      type: this.type,
      origem: this.origem,
      context: this.context,
      financialStatus: this.financialStatus,
      payload: this.payload,
      correlationId: this.correlationId,
      causationId: this.causationId,
      traceId: this.traceId,
      idempotencyKey: this.idempotencyKey,
      operadorId: this.operadorId,
      timestamp: this.timestamp,
      status: this.status
    };
  }
}

module.exports = FinancialEvent;
