/**
 * RCM-6.1 — Resolve Unidade Comercial congelada no item (compat itens antigos).
 */

/**
 * @param {Object} item — item mapeado da consignação
 * @param {Object} [opts]
 * @returns {{ unidadeComercial: string, herdadaDaBase: boolean }}
 */
function resolverUnidadeComercialCongelada(item = {}, opts = {}) {
  const congelada = String(item.unidadeComercial || item.unidade_comercial || '').trim().toUpperCase();
  if (congelada) {
    return { unidadeComercial: congelada, herdadaDaBase: false };
  }

  const base = String(
    item.unidade
    || item.produtoUnidade
    || item.produto_unidade
    || opts.unidadeBase
    || 'UN'
  ).trim().toUpperCase() || 'UN';

  if (!opts.silencioso) {
    console.warn(
      '[RCM-6.1] Item sem Unidade Comercial congelada — usando Unidade Base do Produto:',
      base,
      '(itemId=',
      item.id,
      ')'
    );
  }

  return { unidadeComercial: base, herdadaDaBase: true };
}

module.exports = { resolverUnidadeComercialCongelada };
