/**
 * MFE-03 — FinancialAllocation
 * Infraestrutura de rateio financeiro.
 * Sem regras operacionais nesta sprint.
 */

const { MOEDA_PADRAO } = require('./enums');
const { FinancialValidationError } = require('./errors');

class FinancialAllocation {
  constructor(props = {}) {
    this.id = props.id ?? null;
    this.operationId = props.operationId || props.operation_id || null;
    this.entryId = props.entryId || props.entry_id || null;
    this.centroCusto = props.centroCusto || props.centro_custo || null;
    this.conta = props.conta || props.contaFinanceira || null;
    this.percentual = props.percentual != null ? Number(props.percentual) : null;
    this.valor = props.valor != null ? Number(props.valor) : null;
    this.moeda = props.moeda || MOEDA_PADRAO;
    this.metadata = props.metadata && typeof props.metadata === 'object' ? { ...props.metadata } : {};
    this.createdAt = props.createdAt || props.created_at || null;
  }

  static criar(props = {}) {
    return new FinancialAllocation(props);
  }

  /**
   * Validação estrutural mínima — sem regras de rateio.
   */
  validar() {
    const erros = [];
    if (!this.operationId) erros.push('operationId é obrigatório');
    if (this.percentual != null && (!Number.isFinite(this.percentual) || this.percentual < 0)) {
      erros.push('percentual inválido');
    }
    if (this.valor != null && (!Number.isFinite(this.valor) || this.valor < 0)) {
      erros.push('valor inválido');
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
      entryId: this.entryId,
      centroCusto: this.centroCusto,
      conta: this.conta,
      percentual: this.percentual,
      valor: this.valor,
      moeda: this.moeda,
      metadata: this.metadata,
      createdAt: this.createdAt
    };
  }
}

module.exports = FinancialAllocation;
