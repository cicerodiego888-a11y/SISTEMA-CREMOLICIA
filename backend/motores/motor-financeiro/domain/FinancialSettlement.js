/**
 * MFE-07 — FinancialSettlement
 *
 * Representa uma liquidação financeira.
 * O meio de pagamento é atributo da liquidação — não um fluxo separado.
 */

const crypto = require('crypto');
const {
  MeioFinanceiro,
  FinancialContext,
  FinancialStatus,
  MOEDA_PADRAO,
  isMeioFinanceiroValido
} = require('./enums');
const { FinancialValidationError } = require('./errors');

const SettlementStatus = Object.freeze({
  PENDING: 'PENDING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  REVERSED: 'REVERSED',
  CANCELLED: 'CANCELLED'
});

function novoId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `stl-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

class FinancialSettlement {
  constructor(props = {}) {
    this.id = props.id || props.settlementId || novoId();
    this.titleId = props.titleId ?? props.tituloId ?? props.titulo_id ?? null;
    this.operationId = props.operationId || props.operation_id || null;
    this.meioFinanceiro = props.meioFinanceiro || props.meio_financeiro || MeioFinanceiro.OUTRO;
    this.valor = props.valor != null ? Number(props.valor) : null;
    this.data = props.data || props.dataLiquidacao || new Date().toISOString().slice(0, 10);
    this.status = props.status || SettlementStatus.PENDING;
    this.context = props.context || FinancialContext.FINANCEIRO;
    this.documentoOrigem = props.documentoOrigem || props.documento_origem || null;
    this.usuario = props.usuario ?? props.operadorId ?? props.usuario_id ?? null;
    this.empresa = props.empresa ?? props.empresa_id ?? null;
    this.eventId = props.eventId || null;
    this.correlationId = props.correlationId || null;
    this.traceId = props.traceId || null;
    this.moeda = props.moeda || MOEDA_PADRAO;
    this.createdAt = props.createdAt || new Date().toISOString();
    this.metadata = props.metadata && typeof props.metadata === 'object' ? { ...props.metadata } : {};
  }

  static criar(props = {}) {
    return new FinancialSettlement(props);
  }

  validar() {
    const erros = [];
    if (!this.id) erros.push('id é obrigatório');
    if (!isMeioFinanceiroValido(this.meioFinanceiro)) {
      erros.push(`meioFinanceiro inválido: ${this.meioFinanceiro}`);
    }
    if (this.valor == null || !Number.isFinite(this.valor) || this.valor < 0) {
      erros.push('valor inválido');
    }
    if (!this.status) erros.push('status é obrigatório');
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
      settlementId: this.id,
      titleId: this.titleId,
      operationId: this.operationId,
      meioFinanceiro: this.meioFinanceiro,
      valor: this.valor,
      data: this.data,
      status: this.status,
      context: this.context,
      documentoOrigem: this.documentoOrigem,
      usuario: this.usuario,
      empresa: this.empresa,
      eventId: this.eventId,
      correlationId: this.correlationId,
      traceId: this.traceId,
      moeda: this.moeda,
      createdAt: this.createdAt,
      metadata: this.metadata
    };
  }
}

FinancialSettlement.Status = SettlementStatus;
FinancialSettlement.FinancialStatus = FinancialStatus;
FinancialSettlement.MeioFinanceiro = MeioFinanceiro;

module.exports = FinancialSettlement;
