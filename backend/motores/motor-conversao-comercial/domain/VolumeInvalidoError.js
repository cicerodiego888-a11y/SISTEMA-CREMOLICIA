/**
 * MCI-01 — VolumeInvalidoError
 * Volume/quantidade base deve ser numérico e maior que zero.
 */

class VolumeInvalidoError extends Error {
  constructor(message, extras = {}) {
    super(message || 'Volume inválido. Informe um volume maior que zero.');
    this.name = 'VolumeInvalidoError';
    this.codigo = 'MCI_VOLUME_INVALIDO';
    this.status = 400;
    this.volume = extras.volume ?? null;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, VolumeInvalidoError);
    }
  }

  toJSON() {
    return {
      name: this.name,
      codigo: this.codigo,
      status: this.status,
      message: this.message,
      volume: this.volume
    };
  }
}

module.exports = VolumeInvalidoError;
