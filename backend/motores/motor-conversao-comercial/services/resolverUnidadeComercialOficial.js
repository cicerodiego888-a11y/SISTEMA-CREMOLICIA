/**
 * RCM-8.8 / RCM-8.9 — Resolução oficial de Unidade Comercial → Base
 *
 * Produto possui apenas Unidade Base.
 * Tabela / operação informa Unidade Comercial.
 *
 * Ordem:
 * 1) origem === base → identidade
 * 2) fator em catálogo opcional UC-01 / MUC row
 * 3) conversões permanentes do produto (produto_conversoes)  ← RCM-8.9
 * 4) conversão canônica MUC (mesma dimensão)
 * 5) erro: "Conversão entre X e Y não cadastrada."
 */

const UnidadeComercial = require('../domain/UnidadeComercial');
const ConversaoNaoCadastradaError = require('../domain/ConversaoNaoCadastradaError');
const { TipoConversao } = require('../domain/enums');

let mucConversor;
let produtoConversaoService;
try {
  mucConversor = require('../../muc/converters/ConversorUnidades');
} catch (_) {
  mucConversor = null;
}
try {
  produtoConversaoService = require('../../muc/services/ProdutoConversaoService');
} catch (_) {
  produtoConversaoService = null;
}

function _listaUnidades(produto) {
  if (!produto || typeof produto !== 'object') return [];
  const lista = produto.unidades_comercializacao || produto.unidades || [];
  return Array.isArray(lista) ? lista : [];
}

function _listaConversoes(produto) {
  if (!produto || typeof produto !== 'object') return [];
  const lista = produto.conversoes || produto.produto_conversoes || produto.conversoes_produto || [];
  return Array.isArray(lista) ? lista : [];
}

function _codigoRow(u) {
  return String(u.unidade_comercial || u.codigo || u.unidade || '').trim().toUpperCase();
}

function _unidadeDeConversaoProduto(cod, base, fatorProduto) {
  const fator = Number(fatorProduto.fator);
  const tipo = fator >= 1 ? TipoConversao.AGRUPAMENTO : TipoConversao.FRACIONAMENTO;
  return new UnidadeComercial({
    codigo: cod,
    tipo,
    quantidade: fator,
    unidadeBase: base
  });
}

/**
 * @param {object} opts
 * @param {object} [opts.produto]
 * @param {string} opts.codigo — unidade comercial (tabela / operação)
 * @param {string} opts.unidadeBase — unidade base do produto
 * @returns {import('../domain/UnidadeComercial')}
 */
function resolverUnidadeComercialOficial({ produto = null, codigo, unidadeBase } = {}) {
  const cod = String(codigo || '').trim().toUpperCase();
  const base = String(unidadeBase || '').trim().toUpperCase();
  const produtoId = produto && typeof produto === 'object'
    ? (produto.id ?? produto.produto_id ?? null)
    : null;

  if (!cod) {
    throw new ConversaoNaoCadastradaError('?', base || '?', { produtoId });
  }
  if (!base) {
    throw new ConversaoNaoCadastradaError(cod, '?', { produtoId });
  }

  if (cod === base) {
    return UnidadeComercial.base(base);
  }

  // Alias canônico: LT vs L etc. (identidade após normalização)
  if (mucConversor && typeof mucConversor.normalizarCodigoUnidade === 'function') {
    const nCod = mucConversor.normalizarCodigoUnidade(cod);
    const nBase = mucConversor.normalizarCodigoUnidade(base);
    if (nCod && nBase && nCod === nBase) {
      return UnidadeComercial.base(base);
    }
  }

  const lista = _listaUnidades(produto);
  const row = lista.find((u) => _codigoRow(u) === cod);
  if (row) {
    return UnidadeComercial.fromUc01Row(row, base);
  }

  if (produto && typeof produto === 'object' && produto.fator != null && Number(produto.fator) > 0) {
    return new UnidadeComercial({
      codigo: cod,
      tipo: TipoConversao.AGRUPAMENTO,
      quantidade: Number(produto.fator),
      unidadeBase: base
    });
  }

  // RCM-8.9 — conversões permanentes do produto (antes das canônicas)
  // Fator desejado: 1 UC = fator × Base
  const conversoes = _listaConversoes(produto);
  if (produtoConversaoService && typeof produtoConversaoService.resolverFatorNasConversoes === 'function') {
    const prod = produtoConversaoService.resolverFatorNasConversoes(conversoes, cod, base);
    if (prod && Number.isFinite(prod.fator) && prod.fator > 0) {
      return _unidadeDeConversaoProduto(cod, base, prod);
    }
  }

  const muc = mucConversor && typeof mucConversor.resolverFatorConversao === 'function'
    ? mucConversor.resolverFatorConversao(cod, base)
    : null;

  if (muc && Number.isFinite(muc.fator) && muc.fator > 0) {
    return new UnidadeComercial({
      codigo: cod,
      tipo: muc.tipo || (muc.fator >= 1 ? TipoConversao.AGRUPAMENTO : TipoConversao.FRACIONAMENTO),
      quantidade: muc.fator,
      unidadeBase: base
    });
  }

  throw new ConversaoNaoCadastradaError(cod, base, { produtoId });
}

module.exports = {
  resolverUnidadeComercialOficial
};
