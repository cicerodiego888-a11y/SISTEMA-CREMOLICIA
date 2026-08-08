/**
 * COM-01 — Resolve quantidade base via MCC (Motor Comercial).
 * Sem UnitOfWork/db: retorna identidade (compat testes unitários sem DB).
 * RCM-6.1 — unidadeOrigem deve vir do snapshot do item (UC congelada).
 */

const mcc = require('../../motor-conversao-comercial');
const { resolverUnidadeComercialCongelada } = require('./unidadeComercialCongelada');

/**
 * @param {import('../infrastructure/transactions/UnitOfWork')|null} uow
 * @param {Object} params
 * @returns {Promise<{ quantidadeBase: number, quantidadeComercial: number, unidadeOrigem: string, auditoria: Object|null }>}
 */
async function resolverQuantidadeBaseMcc(uow, params = {}) {
  const quantidadeComercial = Number(params.quantidade);
  let unidadeOrigem = params.unidadeOrigem
    || params.unidadeComercial
    || params.unidade_comercial
    || null;

  if (!unidadeOrigem && params.item) {
    const uc = resolverUnidadeComercialCongelada(params.item);
    unidadeOrigem = uc.unidadeComercial;
  } else if (!unidadeOrigem && (params.unidadeBase || params.unidade)) {
    const uc = resolverUnidadeComercialCongelada({
      id: params.itemId || params.consignacaoItemId,
      unidade: params.unidadeBase || params.unidade
    });
    unidadeOrigem = uc.unidadeComercial;
  }

  const db = uow && typeof uow.obterDbTransacional === 'function'
    ? uow.obterDbTransacional()
    : null;

  if (!db || !params.produtoId || !(quantidadeComercial > 0)) {
    return {
      quantidadeBase: quantidadeComercial,
      quantidadeComercial,
      unidadeOrigem: unidadeOrigem || null,
      auditoria: null
    };
  }

  const operacional = mcc.comercialOperacional
    || new mcc.ComercialOperacionalService({ mcc: mcc.motor });

  const r = await operacional.converterQuantidade(db, {
    produtoId: params.produtoId,
    quantidade: quantidadeComercial,
    unidadeOrigem,
    loteId: params.loteId || null,
    consignacaoId: params.consignacaoId || null,
    operacao: params.operacao || null,
    usuarioId: params.usuarioId || null
  });

  return {
    quantidadeBase: Number(r.quantidadeConvertida),
    quantidadeComercial,
    unidadeOrigem: r.unidadeOrigem,
    auditoria: r.auditoria
  };
}

module.exports = { resolverQuantidadeBaseMcc };
