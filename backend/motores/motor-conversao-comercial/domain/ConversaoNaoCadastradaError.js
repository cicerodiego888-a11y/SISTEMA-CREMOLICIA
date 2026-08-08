/**
 * RCM-8.8 — Conversão MUC ausente entre unidade comercial e unidade base.
 * Mensagem oficial: "Conversão entre X e Y não cadastrada."
 * Nunca: "Unidade comercial não cadastrada para o produto."
 */

class ConversaoNaoCadastradaError extends Error {
  constructor(unidadeOrigem, unidadeBase, extras = {}) {
    const origem = String(unidadeOrigem || extras.unidadeOrigem || '').trim().toUpperCase();
    const base = String(unidadeBase || extras.unidadeBase || '').trim().toUpperCase();
    super(
      extras.message
      || `Conversão entre ${origem || '?'} e ${base || '?'} não cadastrada.`
    );
    this.name = 'ConversaoNaoCadastradaError';
    this.codigo = 'MCC_CONVERSAO_NAO_CADASTRADA';
    this.status = 422;
    this.unidadeOrigem = origem || null;
    this.unidadeBase = base || null;
    this.produtoId = extras.produtoId ?? null;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ConversaoNaoCadastradaError);
    }
  }

  toJSON() {
    return {
      name: this.name,
      codigo: this.codigo,
      status: this.status,
      message: this.message,
      unidadeOrigem: this.unidadeOrigem,
      unidadeBase: this.unidadeBase,
      produtoId: this.produtoId
    };
  }
}

module.exports = ConversaoNaoCadastradaError;
