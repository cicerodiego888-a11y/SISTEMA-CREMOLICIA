/**
 * MCC-02 — Erro oficial: ConversaoFisicaObrigatoriaError
 *
 * Produto exige Conversão Física por Lote e o lote/fator não foi informado.
 * Todos os módulos devem reutilizar esta exceção — nunca validar localmente.
 */

class ConversaoFisicaObrigatoriaError extends Error {
  constructor(message, extras = {}) {
    super(
      message
      || 'Produto exige Conversão Física por Lote. Informe o peso do lote antes de movimentar o estoque.'
    );
    this.name = 'ConversaoFisicaObrigatoriaError';
    this.codigo = 'MCC_CONVERSAO_FISICA_OBRIGATORIA';
    this.status = 422;
    this.produtoId = extras.produtoId ?? null;
    this.loteId = extras.loteId ?? null;
    this.persistido = false;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ConversaoFisicaObrigatoriaError);
    }
  }

  toJSON() {
    return {
      name: this.name,
      codigo: this.codigo,
      status: this.status,
      message: this.message,
      produtoId: this.produtoId,
      loteId: this.loteId
    };
  }
}

module.exports = ConversaoFisicaObrigatoriaError;
