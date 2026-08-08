function normalizarItemFiscal(valor) {
  return Number(valor) === 1 ? 1 : 0;
}

function separarItensFiscalNaoFiscal(itens = []) {
  const itensFiscal = [];
  const itensNaoFiscal = [];

  let totalFiscal = 0;
  let totalNaoFiscal = 0;

  for (const item of itens) {
    const subtotal = Number(item.subtotal || 0);

    if (normalizarItemFiscal(item.item_fiscal) === 1) {
      itensFiscal.push(item);
      totalFiscal += subtotal;
    } else {
      itensNaoFiscal.push(item);
      totalNaoFiscal += subtotal;
    }
  }

  return {
    itensFiscal,
    itensNaoFiscal,
    totalFiscal,
    totalNaoFiscal
  };
}

/**
 * Soma pura dos valores fiscal / não fiscal dos itens já distribuídos.
 * Regra histórica — não altera arredondamento nem origem dos campos.
 */
function calcularTotaisDistribuidos(itens = []) {
  let totalFiscal = 0;
  let totalNaoFiscal = 0;

  for (const item of itens) {
    totalFiscal += Number(item.valor_fiscal || 0);
    totalNaoFiscal += Number(item.valor_nao_fiscal || 0);
  }

  return {
    totalFiscal: Number(totalFiscal.toFixed(2)),
    totalNaoFiscal: Number(totalNaoFiscal.toFixed(2))
  };
}

/**
 * Retorna FiscalOperacionalResult (RC1) com getters de compatibilidade
 * totalFiscal / totalNaoFiscal / valorFiscal.
 * Destructuring legado continua funcionando.
 */
function separarItensDistribuidos(itens) {
  const FiscalOperacionalService = require('../motores/fiscal-nao-fiscal/FiscalOperacionalService');
  return FiscalOperacionalService.montarFromItens(itens, { log: true });
}

module.exports = {
  normalizarItemFiscal,
  separarItensFiscalNaoFiscal,
  calcularTotaisDistribuidos,
  separarItensDistribuidos
};
