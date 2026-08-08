/**
 * FiscalOperacionalService — Motor Fiscal × Não Fiscal (RC3).
 *
 * Intervalo via FiscalIntervalCalculator → FiscalMarginCalculator.
 * Valor Fiscal Efetivo permanece = valorFiscalMaximo (sem alteração funcional).
 */

const { calcularTotaisDistribuidos } = require('../../services/fiscalNaoFiscalService');
const FiscalIntervalCalculator = require('./FiscalIntervalCalculator');
const FiscalOperacionalResult = require('./FiscalOperacionalResult');
const FiscalOperacionalLogger = require('./FiscalOperacionalLogger');

function arredondar2(valor) {
  return Number(Number(valor || 0).toFixed(2));
}

/**
 * @param {object} totais
 * @param {number} totais.valorFiscal
 * @param {number} totais.valorNaoFiscal
 * @param {Array} [totais.itens] — quando presentes, habilitam margem real
 * @param {object} [opcoes]
 * @returns {FiscalOperacionalResult}
 */
function montarFromTotais(totais = {}, opcoes = {}) {
  const inicio = Date.now();
  const valorNaoFiscal = arredondar2(totais.valorNaoFiscal);

  const entradaIntervalo = Array.isArray(totais.itens) && totais.itens.length > 0
    ? { itens: totais.itens }
    : {
      valorFiscal: totais.valorFiscal,
      valorNaoFiscal: totais.valorNaoFiscal
    };

  const intervalo = FiscalIntervalCalculator.calcular(
    entradaIntervalo,
    { log: opcoes.log !== false }
  );

  const resultado = new FiscalOperacionalResult({
    valorFiscalMaximo: intervalo.valorFiscalMaximo,
    valorFiscalMinimo: intervalo.valorFiscalMinimo,
    valorFiscalEfetivo: intervalo.valorFiscalMaximo,
    valorNaoFiscal,
    margemFiscalDisponivel: intervalo.margemFiscalDisponivel,
    possuiMargemFiscal: intervalo.possuiMargemFiscal,
    versao: FiscalOperacionalResult.VERSAO,
    algoritmo: FiscalOperacionalResult.ALGORITMO,
    tempoMs: Date.now() - inicio
  });

  if (opcoes.log !== false) {
    FiscalOperacionalLogger.registrar(resultado, { origem: opcoes.origem });
  }

  return resultado;
}

/**
 * @param {Array} itens
 * @param {object} [opcoes]
 * @returns {FiscalOperacionalResult}
 */
function montarFromItens(itens = [], opcoes = {}) {
  const inicio = Date.now();
  const { totalFiscal, totalNaoFiscal } = calcularTotaisDistribuidos(itens);
  const resultado = montarFromTotais(
    {
      valorFiscal: totalFiscal,
      valorNaoFiscal: totalNaoFiscal,
      itens
    },
    opcoes
  );
  resultado.tempoMs = Date.now() - inicio;
  return resultado;
}

/**
 * @param {object} entrada
 * @returns {FiscalOperacionalResult}
 */
function calcular(entrada = {}) {
  if (Array.isArray(entrada.itens)) {
    return montarFromItens(entrada.itens, {
      origem: entrada.origem,
      log: entrada.log
    });
  }

  return montarFromTotais(
    {
      valorFiscal: entrada.valorFiscal,
      valorNaoFiscal: entrada.valorNaoFiscal
    },
    { origem: entrada.origem, log: entrada.log }
  );
}

module.exports = {
  calcular,
  montarFromTotais,
  montarFromItens,
  VERSAO: FiscalOperacionalResult.VERSAO,
  ALGORITMO: FiscalOperacionalResult.ALGORITMO
};
