/**
 * MCI-01 — UnidadeNaoPermitidaError
 * Unidade comercial incompatível com o canal Compra / produto.
 */

class UnidadeNaoPermitidaError extends Error {
  constructor(message, extras = {}) {
    super(
      message
      || `Unidade comercial "${extras.unidade || ''}" não permitida para esta entrada.`
    );
    this.name = 'UnidadeNaoPermitidaError';
    this.codigo = 'MCI_UNIDADE_NAO_PERMITIDA';
    this.status = 422;
    this.unidade = extras.unidade ?? null;
    this.produtoId = extras.produtoId ?? null;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, UnidadeNaoPermitidaError);
    }
  }

  toJSON() {
    return {
      name: this.name,
      codigo: this.codigo,
      status: this.status,
      message: this.message,
      unidade: this.unidade,
      produtoId: this.produtoId
    };
  }
}

module.exports = UnidadeNaoPermitidaError;
