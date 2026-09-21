/**
 * RCM-8.13.3 — Mapeamento visual da aba Financeiro (somente apresentação).
 *
 * Não altera regra de crédito, ledger ou prestação.
 *
 * @module frontend/modules/motor-comercial/pages/Consignacoes/cockpitFinanceiroMappers
 */

/**
 * Separa AR da operação, estoque consignado da operação e saldo devedor global.
 *
 * @param {{ contaCorrente?: Object, perfil?: Object, situacao?: Object }} fontes
 * @returns {{
 *   aReceberDestaOperacao: number,
 *   estoqueConsignadoDestaOperacao: number,
 *   saldoDevedorGlobalCliente: number
 * }}
 */
function mapFinanceiroConsignacao({ contaCorrente = null, perfil = null, situacao = null } = {}) {
  const cc = contaCorrente || {};
  const aReceberDestaOperacao = Number(cc.saldoEmAberto ?? 0);
  const estoqueConsignadoDestaOperacao = Number(
    cc.estoqueConsignado != null
      ? cc.estoqueConsignado
      : Math.max(0, Number(cc.saldoAtual ?? 0) - aReceberDestaOperacao)
  );
  const saldoDevedorGlobalCliente = Number(
    perfil?.saldoAberto
    ?? situacao?.saldoDevedor
    ?? situacao?.saldo
    ?? 0
  );

  return {
    aReceberDestaOperacao,
    estoqueConsignadoDestaOperacao,
    saldoDevedorGlobalCliente
  };
}

module.exports = {
  mapFinanceiroConsignacao
};
