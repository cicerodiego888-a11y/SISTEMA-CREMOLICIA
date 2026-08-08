/**
 * MFE-03 — FinancialEntry
 * Linha oficial do modelo unificado (visão de domínio do Ledger).
 *
 * Persistência operacional continua em FinancialLedgerEntry.
 * Esta entidade é o contrato SSOT de campos mínimos da linha financeira.
 */

const {
  TipoLancamentoOperacional,
  NaturezaLancamento,
  OrigemFinanceira,
  MOEDA_PADRAO
} = require('./enums');
const { FinancialValidationError } = require('./errors');
const { criarTrilhaAuditoriaFinanceira } = require('./FinancialAuditTrail');

const TIPOS_ENTRY = new Set(Object.values(TipoLancamentoOperacional));

class FinancialEntry {
  constructor(props = {}) {
    this.id = props.id ?? null;
    this.operationId = props.operationId || props.operation_id || null;
    this.entryType = props.entryType
      || props.tipoLancamento
      || props.tipo_lancamento
      || null;
    this.natureza = props.natureza || null;
    this.conta = props.conta || props.contaFinanceira || props.conta_financeira || null;
    this.valor = Number(props.valor ?? 0);
    this.moeda = props.moeda || MOEDA_PADRAO;
    this.origem = props.origem || OrigemFinanceira.MFE;
    this.referencia = props.referencia || props.historico || null;
    this.usuario = props.usuario ?? props.operador ?? props.operadorId ?? null;
    this.empresa = props.empresa ?? props.empresaId ?? null;

    const trail = criarTrilhaAuditoriaFinanceira(props);
    this.correlationId = trail.correlationId;
    this.traceId = trail.traceId;
    this.eventId = trail.eventId;
    this.idempotencyKey = trail.idempotencyKey;
    this.operationId = this.operationId || trail.operationId;

    this.createdAt = props.createdAt || props.created_at || null;
  }

  static criar(props = {}) {
    return new FinancialEntry(props);
  }

  /**
   * Converte para props de FinancialLedgerEntry (persistência).
   */
  paraLedgerEntryProps(extras = {}) {
    return {
      id: this.id,
      eventId: this.eventId,
      tipoLancamento: this.entryType,
      natureza: this.natureza || NaturezaLancamento.CREDITO,
      contaFinanceira: this.conta,
      valor: this.valor,
      moeda: this.moeda,
      origem: this.origem,
      historico: this.referencia,
      operador: this.usuario,
      correlationId: this.correlationId,
      causationId: extras.causationId || null,
      idempotencyKey: this.idempotencyKey,
      createdAt: this.createdAt,
      detalhes: {
        operationId: this.operationId,
        traceId: this.traceId,
        empresa: this.empresa,
        ...(extras.detalhes || {})
      },
      ...extras
    };
  }

  validar() {
    const erros = [];
    if (!this.operationId) erros.push('operationId é obrigatório');
    if (!this.entryType || !TIPOS_ENTRY.has(this.entryType)) {
      erros.push(`entryType inválido: ${this.entryType}`);
    }
    if (!this.conta) erros.push('conta é obrigatória');
    if (!Number.isFinite(this.valor) || this.valor < 0) {
      erros.push('valor deve ser numérico >= 0');
    }
    if (!this.origem) erros.push('origem é obrigatória');
    if (!this.correlationId) erros.push('correlationId é obrigatório');
    if (!this.traceId) erros.push('traceId é obrigatório');
    if (!this.idempotencyKey) erros.push('idempotencyKey é obrigatória');
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
      entryType: this.entryType,
      natureza: this.natureza,
      conta: this.conta,
      valor: this.valor,
      moeda: this.moeda,
      origem: this.origem,
      referencia: this.referencia,
      usuario: this.usuario,
      empresa: this.empresa,
      correlationId: this.correlationId,
      traceId: this.traceId,
      eventId: this.eventId,
      idempotencyKey: this.idempotencyKey,
      createdAt: this.createdAt
    };
  }
}

module.exports = FinancialEntry;
