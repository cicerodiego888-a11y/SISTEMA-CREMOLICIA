/**
 * MCC-04 — Estoque rejeita qualquer dado comercial / fator.
 * Conversão é exclusiva do MCC.
 */

class QuantidadeComercialRejeitadaError extends Error {
  constructor(message, extras = {}) {
    super(
      message
      || 'Motor de Estoque aceita somente quantidadeBase. Conversão deve ocorrer no MCC.'
    );
    this.name = 'QuantidadeComercialRejeitadaError';
    this.codigo = 'ESTOQUE_QTD_COMERCIAL_REJEITADA';
    this.status = 400;
    this.campo = extras.campo || null;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, QuantidadeComercialRejeitadaError);
    }
  }

  toJSON() {
    return {
      name: this.name,
      codigo: this.codigo,
      status: this.status,
      message: this.message,
      campo: this.campo
    };
  }
}

module.exports = QuantidadeComercialRejeitadaError;
