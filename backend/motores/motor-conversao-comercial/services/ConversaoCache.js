/**
 * MCC-02 — Cache interno por operação
 * Chave: produto + lote + contexto + unidade origem + quantidade
 * Não reutiliza fatores entre lotes.
 */

class ConversaoCache {
  constructor() {
    /** @type {Map<string, Map<string, object>>} */
    this._porOperacao = new Map();
  }

  _chave({
    produtoId,
    loteId,
    quantidade,
    unidadeOrigem,
    contexto,
    unidadeBase
  }) {
    return [
      produtoId ?? '',
      loteId ?? '',
      Number(quantidade),
      String(unidadeOrigem || '').toUpperCase(),
      String(contexto || ''),
      String(unidadeBase || '').toUpperCase()
    ].join('|');
  }

  get(operacaoId, entrada) {
    if (!operacaoId) return null;
    const bucket = this._porOperacao.get(String(operacaoId));
    if (!bucket) return null;
    return bucket.get(this._chave(entrada)) || null;
  }

  set(operacaoId, entrada, resultado) {
    if (!operacaoId) return;
    const key = String(operacaoId);
    if (!this._porOperacao.has(key)) {
      this._porOperacao.set(key, new Map());
    }
    this._porOperacao.get(key).set(this._chave(entrada), resultado);
  }

  limpar(operacaoId) {
    if (operacaoId == null) {
      this._porOperacao.clear();
      return;
    }
    this._porOperacao.delete(String(operacaoId));
  }

  tamanho(operacaoId) {
    if (operacaoId == null) return this._porOperacao.size;
    return this._porOperacao.get(String(operacaoId))?.size || 0;
  }
}

module.exports = ConversaoCache;
