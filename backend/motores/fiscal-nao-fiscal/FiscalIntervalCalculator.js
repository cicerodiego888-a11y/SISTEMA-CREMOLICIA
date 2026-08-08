/**
 * FiscalIntervalCalculator — Orquestrador do intervalo fiscal (RC3).
 *
 * Deixa de calcular a margem diretamente.
 * Orquestra: FiscalMarginCalculator → FiscalIntervalResult.
 *
 * NÃO define Valor Fiscal Efetivo.
 */

const { calcularTotaisDistribuidos } = require('../../services/fiscalNaoFiscalService');
const FiscalMarginCalculator = require('./FiscalMarginCalculator');
const FiscalIntervalResult = require('./FiscalIntervalResult');

function arredondar2(valor) {
  return Number(Number(valor || 0).toFixed(2));
}

/**
 * Resolve totais a partir da entrada (compat RC2 / consumidores).
 */
function resolverTotais(entrada = {}) {
  if (entrada.distribuicao && typeof entrada.distribuicao === 'object') {
    const d = entrada.distribuicao;
    const fiscal = d.valorFiscalEfetivo ?? d.valorFiscal ?? d.totalFiscal ?? entrada.valorFiscal;
    const naoFiscal = d.valorNaoFiscal ?? d.totalNaoFiscal ?? entrada.valorNaoFiscal;
    if (fiscal !== undefined || naoFiscal !== undefined) {
      return {
        valorFiscalAtual: arredondar2(fiscal),
        valorNaoFiscal: arredondar2(naoFiscal)
      };
    }
  }

  if (Array.isArray(entrada.itens)) {
    const totais = calcularTotaisDistribuidos(entrada.itens);
    return {
      valorFiscalAtual: totais.totalFiscal,
      valorNaoFiscal: totais.totalNaoFiscal
    };
  }

  const fiscal = entrada.valorFiscal ?? entrada.totalFiscal ?? 0;
  const naoFiscal = entrada.valorNaoFiscal ?? entrada.totalNaoFiscal ?? 0;
  return {
    valorFiscalAtual: arredondar2(fiscal),
    valorNaoFiscal: arredondar2(naoFiscal)
  };
}

function registrarLog(intervalo) {
  const payload = {
    motor: 'FISCAL_INTERVAL_CALCULATOR',
    versao: intervalo.versao,
    algoritmo: intervalo.algoritmo,
    valorFiscalMaximo: intervalo.valorFiscalMaximo,
    valorFiscalMinimo: intervalo.valorFiscalMinimo,
    margemFiscalDisponivel: intervalo.margemFiscalDisponivel,
    possuiMargemFiscal: intervalo.possuiMargemFiscal,
    tempoMs: intervalo.tempoMs
  };
  console.log('[FISCAL-INTERVAL]', JSON.stringify(payload));
  return payload;
}

/**
 * @param {object} entrada
 * @param {object} [opcoes]
 * @param {boolean} [opcoes.log=true]
 * @returns {FiscalIntervalResult}
 */
function calcular(entrada = {}, opcoes = {}) {
  const inicio = Date.now();
  const margem = FiscalMarginCalculator.calcular(entrada, { log: opcoes.log !== false });

  const resultado = new FiscalIntervalResult({
    valorFiscalMaximo: margem.valorFiscalMaximo,
    valorFiscalMinimo: margem.valorFiscalMinimo,
    margemFiscalDisponivel: margem.margemFiscalDisponivel,
    possuiMargemFiscal: margem.possuiMargemFiscal,
    algoritmo: FiscalIntervalResult.ALGORITMO,
    versao: FiscalIntervalResult.VERSAO,
    tempoMs: Date.now() - inicio
  });

  resultado.itensFiscais = margem.itensFiscais;
  resultado.itensNaoFiscais = margem.itensNaoFiscais;
  resultado.valorNaoFiscal = margem.valorNaoFiscal;

  if (opcoes.log !== false) {
    registrarLog(resultado);
  }

  return resultado;
}

module.exports = {
  calcular,
  resolverTotais,
  VERSAO: FiscalIntervalResult.VERSAO,
  ALGORITMO: FiscalIntervalResult.ALGORITMO
};
