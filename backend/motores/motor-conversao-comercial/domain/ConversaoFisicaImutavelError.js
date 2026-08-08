/**
 * MCC-02.1 — Erro: versões históricas são imutáveis
 * Não permitir UPDATE de quantidade/fator nem exclusão.
 */

class ConversaoFisicaImutavelError extends Error {
  constructor(message, extras = {}) {
    super(
      message
      || 'Conversões físicas históricas são imutáveis. Crie uma nova versão para corrigir.'
    );
    this.name = 'ConversaoFisicaImutavelError';
    this.codigo = 'MCC_CONVERSAO_FISICA_IMUTAVEL';
    this.status = 409;
    this.conversaoId = extras.conversaoId ?? null;
    this.loteId = extras.loteId ?? null;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ConversaoFisicaImutavelError);
    }
  }

  toJSON() {
    return {
      name: this.name,
      codigo: this.codigo,
      status: this.status,
      message: this.message,
      conversaoId: this.conversaoId,
      loteId: this.loteId
    };
  }
}

module.exports = ConversaoFisicaImutavelError;
