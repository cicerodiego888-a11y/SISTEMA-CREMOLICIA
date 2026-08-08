/**
 * MIDP RC2 — Engine de distribuição (algoritmo interno).
 *
 * Reutiliza o algoritmo legado em DistribuidorPagamento.js
 * SEM copiar e SEM alterar comportamento.
 * Consumido pelas políticas (ex.: LegacyDistributionPolicy).
 */

const { distribuirPagamentos } = require('../../services/DistribuidorPagamento');
const MidpResult = require('./MidpResult');

/**
 * Executa a distribuição oficial via algoritmo legado encapsulado.
 *
 * @param {object} entrada
 * @param {number} entrada.valorFiscal
 * @param {number} entrada.valorNaoFiscal
 * @param {Array} entrada.pagamentos — já normalizados
 * @param {object} [opcoes]
 * @param {boolean} [opcoes.midpAtivado]
 * @returns {MidpResult}
 */
function executar(entrada = {}, opcoes = {}) {
  const inicio = Date.now();
  const valorFiscal = Number(entrada.valorFiscal || 0);
  const valorNaoFiscal = Number(entrada.valorNaoFiscal || 0);
  const pagamentos = Array.isArray(entrada.pagamentos) ? entrada.pagamentos : [];

  const legado = distribuirPagamentos(pagamentos, valorFiscal, valorNaoFiscal);
  const tempoMs = Date.now() - inicio;

  return new MidpResult({
    pagamentosFiscal: legado.recebimentosFiscal || [],
    pagamentosNaoFiscal: legado.recebimentosNaoFiscal || [],
    tempoMs,
    saldoFiscal: legado.saldoFiscal,
    saldoNaoFiscal: legado.saldoNaoFiscal,
    midpAtivado: opcoes.midpAtivado === true
  });
}

module.exports = {
  executar
};
