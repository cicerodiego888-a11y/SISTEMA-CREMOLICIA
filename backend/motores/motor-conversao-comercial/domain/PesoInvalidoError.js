/**
 * MCI-01 — PesoInvalidoError
 * Peso deve ser numérico e maior que zero.
 */

class PesoInvalidoError extends Error {
  constructor(message, extras = {}) {
    super(message || 'Peso inválido. Informe um peso maior que zero.');
    this.name = 'PesoInvalidoError';
    this.codigo = 'MCI_PESO_INVALIDO';
    this.status = 400;
    this.peso = extras.peso ?? null;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, PesoInvalidoError);
    }
  }

  toJSON() {
    return {
      name: this.name,
      codigo: this.codigo,
      status: this.status,
      message: this.message,
      peso: this.peso
    };
  }
}

module.exports = PesoInvalidoError;
