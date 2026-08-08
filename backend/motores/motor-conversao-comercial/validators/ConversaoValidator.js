/**
 * MCC-01 — Validadores de entrada do Converter()
 */

const { TipoConversao, ContextoConversao } = require('../domain/enums');

const CONTEXTOS_VALIDOS = new Set(Object.values(ContextoConversao));
const TIPOS_VALIDOS = new Set(Object.values(TipoConversao));

function normalizarContexto(contexto) {
  const raw = String(contexto || 'OUTROS').trim().toUpperCase();
  const map = {
    'NFC-E': ContextoConversao.NFCE,
    NFCE: ContextoConversao.NFCE,
    'NF-E': ContextoConversao.NFE,
    NFE: ContextoConversao.NFE,
    ORCAMENTO: ContextoConversao.ORCAMENTO,
    COMPRA: ContextoConversao.COMPRA,
    VENDA: ContextoConversao.VENDA,
    PDV: ContextoConversao.PDV,
    COMERCIAL: ContextoConversao.COMERCIAL,
    OUTROS: ContextoConversao.OUTROS
  };
  return map[raw] || (CONTEXTOS_VALIDOS.has(contexto) ? contexto : ContextoConversao.OUTROS);
}

/**
 * @param {object} entrada
 * @returns {{ ok: boolean, erros: string[], dados?: object }}
 */
function validarEntradaConverter(entrada = {}) {
  const erros = [];
  const produto = entrada.produto;
  const quantidade = Number(entrada.quantidade);
  const unidadeOrigem = entrada.unidadeOrigem || entrada.unidade_origem || entrada.unidadeComercial;

  if (!produto || (typeof produto !== 'object' && typeof produto !== 'number' && typeof produto !== 'string')) {
    erros.push('Informe o produto (objeto, id ou referência).');
  }
  if (!Number.isFinite(quantidade)) {
    erros.push('Quantidade deve ser numérica.');
  }
  if (Number.isFinite(quantidade) && quantidade < 0) {
    erros.push('Quantidade não pode ser negativa.');
  }
  if (unidadeOrigem == null || String(unidadeOrigem).trim() === '') {
    erros.push('Informe a unidade de origem (unidade comercial).');
  }

  const contexto = normalizarContexto(entrada.contexto);
  const unidadeBase = String(
    (typeof produto === 'object' && produto
      ? (produto.unidade_base || produto.unidadeBase || produto.unidade)
      : '')
    || entrada.unidadeBase
    || 'UN'
  ).trim().toUpperCase();

  if (erros.length) {
    return { ok: false, erros };
  }

  return {
    ok: true,
    dados: {
      produto,
      quantidade,
      unidadeOrigem: String(
        typeof unidadeOrigem === 'object'
          ? (unidadeOrigem.codigo || unidadeOrigem.unidade_comercial || '')
          : unidadeOrigem
      ).trim().toUpperCase(),
      unidadeOrigemObj: typeof unidadeOrigem === 'object' ? unidadeOrigem : null,
      contexto,
      unidadeBase,
      unidades: Array.isArray(entrada.unidades) ? entrada.unidades : (
        typeof produto === 'object' && Array.isArray(produto.unidades_comercializacao)
          ? produto.unidades_comercializacao
          : (typeof produto === 'object' && Array.isArray(produto.unidades) ? produto.unidades : [])
      ),
      operacaoId: entrada.operacaoId || entrada.operationId || null,
      precisao: entrada.precisao || null,
      cadeia: Array.isArray(entrada.cadeia) ? entrada.cadeia : null,
      loteId: entrada.loteId ?? entrada.lote_id
        ?? (typeof entrada.lote === 'object' && entrada.lote ? entrada.lote.id : (
          typeof entrada.lote === 'number' || typeof entrada.lote === 'string' ? entrada.lote : null
        )),
      lote: entrada.lote || null,
      conversaoFisicaLote: entrada.conversaoFisicaLote
        || entrada.conversaoFisica
        || entrada.conversao_fisica_lote
        || null,
      db: entrada.db || null,
      /**
       * MCI-01: na entrada de mercadorias o estoque fica na unidade base.
       * A ConversaoFisicaLote é registrada, mas Converter não aplica L→Kg na quantidade.
       */
      aplicarFisica: entrada.aplicarFisica !== false && entrada.somenteUnidadeBase !== true
    }
  };
}

function assertTipo(tipo) {
  const t = String(tipo || '').toUpperCase();
  if (!TIPOS_VALIDOS.has(t)) {
    const err = new Error(`Tipo de conversão inválido: ${tipo}`);
    err.status = 400;
    throw err;
  }
  return t;
}

module.exports = {
  validarEntradaConverter,
  normalizarContexto,
  assertTipo,
  CONTEXTOS_VALIDOS,
  TIPOS_VALIDOS
};
