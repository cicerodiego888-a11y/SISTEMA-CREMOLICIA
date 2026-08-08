/**
 * MCC-02 / MCC-02.1 — Domínio ConversaoFisicaLote (versionado)
 *
 * A conversão física pertence ao LOTE, nunca ao produto.
 * Correções geram nova versão — nunca UPDATE de quantidade/fator.
 */

const { OrigemConversaoFisica, MotivoVersaoConversao } = require('./enums');

class ConversaoFisicaLote {
  constructor(props = {}) {
    this.id = props.id != null ? Number(props.id) : null;
    this.produtoId = Number(props.produtoId ?? props.produto_id);
    this.loteId = Number(props.loteId ?? props.lote_id);
    this.unidadeBase = String(props.unidadeBase || props.unidade_base || '').trim().toUpperCase();
    this.unidadeDestino = String(props.unidadeDestino || props.unidade_destino || '').trim().toUpperCase();
    this.quantidadeBase = Number(props.quantidadeBase ?? props.quantidade_base);
    this.quantidadeDestino = Number(props.quantidadeDestino ?? props.quantidade_destino);
    this.fator = props.fator != null
      ? Number(props.fator)
      : ConversaoFisicaLote.calcularFator(this.quantidadeBase, this.quantidadeDestino);
    this.origem = String(props.origem || OrigemConversaoFisica.MANUAL).toUpperCase();
    this.versao = Number(props.versao != null ? props.versao : 1);
    this.ativa = props.ativa === false || props.ativa === 0 || props.ativa === '0'
      ? false
      : true;
    this.substituiId = props.substituiId != null
      ? Number(props.substituiId)
      : (props.substitui_id != null ? Number(props.substitui_id) : null);
    this.motivo = props.motivo != null ? String(props.motivo).toUpperCase() : null;
    this.usuarioId = props.usuarioId != null
      ? Number(props.usuarioId)
      : (props.usuario_id != null ? Number(props.usuario_id) : null);
    this.createdAt = props.createdAt || props.created_at || null;
    this.updatedAt = props.updatedAt || props.updated_at || null;
    this.loteCodigo = props.loteCodigo || props.lote_codigo || props.lote || null;
  }

  static calcularFator(quantidadeBase, quantidadeDestino) {
    const base = Number(quantidadeBase);
    const dest = Number(quantidadeDestino);
    if (!Number.isFinite(base) || base <= 0) {
      const err = new Error('quantidade_base deve ser > 0 para ConversaoFisicaLote.');
      err.status = 400;
      throw err;
    }
    if (!Number.isFinite(dest) || dest <= 0) {
      const err = new Error('quantidade_destino deve ser > 0 para ConversaoFisicaLote.');
      err.status = 400;
      throw err;
    }
    return dest / base;
  }

  static fromRow(row) {
    if (!row) return null;
    return new ConversaoFisicaLote(row);
  }

  static criar({
    produtoId,
    loteId,
    unidadeBase,
    unidadeDestino,
    quantidadeBase,
    quantidadeDestino,
    origem = OrigemConversaoFisica.MANUAL,
    loteCodigo = null,
    id = null,
    versao = 1,
    ativa = true,
    substituiId = null,
    motivo = null,
    usuarioId = null
  }) {
    return new ConversaoFisicaLote({
      id,
      produtoId,
      loteId,
      unidadeBase,
      unidadeDestino,
      quantidadeBase,
      quantidadeDestino,
      fator: ConversaoFisicaLote.calcularFator(quantidadeBase, quantidadeDestino),
      origem,
      loteCodigo,
      versao,
      ativa,
      substituiId,
      motivo,
      usuarioId
    });
  }

  validar() {
    const erros = [];
    if (!Number.isFinite(this.produtoId)) erros.push('produto_id obrigatório.');
    if (!Number.isFinite(this.loteId)) erros.push('lote_id obrigatório.');
    if (!this.unidadeBase) erros.push('unidade_base obrigatória.');
    if (!this.unidadeDestino) erros.push('unidade_destino obrigatória.');
    if (this.unidadeBase === this.unidadeDestino) {
      erros.push('unidade_destino deve ser diferente da unidade_base.');
    }
    if (!Number.isFinite(this.quantidadeBase) || this.quantidadeBase <= 0) {
      erros.push('quantidade_base deve ser > 0.');
    }
    if (!Number.isFinite(this.quantidadeDestino) || this.quantidadeDestino <= 0) {
      erros.push('quantidade_destino deve ser > 0.');
    }
    if (!Number.isFinite(this.fator) || this.fator <= 0) {
      erros.push('fator inválido.');
    }
    if (!Object.values(OrigemConversaoFisica).includes(this.origem)) {
      erros.push(`origem inválida: ${this.origem}`);
    }
    if (!Number.isFinite(this.versao) || this.versao < 1) {
      erros.push('versao deve ser >= 1.');
    }
    if (this.motivo != null && !Object.values(MotivoVersaoConversao).includes(this.motivo)) {
      erros.push(`motivo inválido: ${this.motivo}`);
    }
    return { ok: erros.length === 0, erros };
  }

  converterParaDestino(quantidadeNaBase) {
    return Number(quantidadeNaBase) * this.fator;
  }

  converterParaBase(quantidadeNoDestino) {
    return Number(quantidadeNoDestino) / this.fator;
  }

  toJSON() {
    return {
      id: this.id,
      produto_id: this.produtoId,
      lote_id: this.loteId,
      unidade_base: this.unidadeBase,
      unidade_destino: this.unidadeDestino,
      quantidade_base: this.quantidadeBase,
      quantidade_destino: this.quantidadeDestino,
      fator: this.fator,
      origem: this.origem,
      versao: this.versao,
      ativa: this.ativa ? 1 : 0,
      substitui_id: this.substituiId,
      motivo: this.motivo,
      usuario_id: this.usuarioId,
      lote_codigo: this.loteCodigo,
      created_at: this.createdAt,
      updated_at: this.updatedAt
    };
  }
}

module.exports = ConversaoFisicaLote;
