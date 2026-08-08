/**
 * MFE-03 — FinancialDocument
 * Documento de origem da operação financeira (referência).
 * Sem regras fiscais/comerciais.
 */

const { FinancialDocumentType } = require('./enums');
const { FinancialValidationError } = require('./errors');

class FinancialDocument {
  constructor(props = {}) {
    this.id = props.id ?? null;
    this.type = props.type || props.tipo || FinancialDocumentType.OUTRO;
    this.referenciaExterna = props.referenciaExterna
      || props.referencia
      || props.externalRef
      || null;
    this.numero = props.numero || null;
    this.serie = props.serie || null;
    this.empresa = props.empresa ?? props.empresaId ?? null;
    this.origemModulo = props.origemModulo || props.origem || null;
    this.metadata = props.metadata && typeof props.metadata === 'object' ? { ...props.metadata } : {};
    this.createdAt = props.createdAt || props.created_at || new Date().toISOString();
  }

  static criar(props = {}) {
    return new FinancialDocument(props);
  }

  validar() {
    const erros = [];
    if (!this.type || !Object.prototype.hasOwnProperty.call(FinancialDocumentType, this.type)) {
      erros.push(`type inválido: ${this.type}`);
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
      type: this.type,
      referenciaExterna: this.referenciaExterna,
      numero: this.numero,
      serie: this.serie,
      empresa: this.empresa,
      origemModulo: this.origemModulo,
      metadata: this.metadata,
      createdAt: this.createdAt
    };
  }
}

FinancialDocument.Types = FinancialDocumentType;

module.exports = FinancialDocument;
