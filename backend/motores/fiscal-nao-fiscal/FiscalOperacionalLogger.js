/**
 * FiscalOperacionalLogger — Logs do Motor Fiscal × Não Fiscal (RC1).
 */

const FiscalOperacionalResult = require('./FiscalOperacionalResult');

/**
 * @param {import('./FiscalOperacionalResult')} resultado
 * @param {object} [meta]
 */
function registrar(resultado, meta = {}) {
  const payload = {
    motor: 'FISCAL_NAO_FISCAL',
    versao: (resultado && resultado.versao) || FiscalOperacionalResult.VERSAO,
    algoritmo: (resultado && resultado.algoritmo) || FiscalOperacionalResult.ALGORITMO,
    valorFiscalMaximo: resultado ? resultado.valorFiscalMaximo : 0,
    valorFiscalMinimo: resultado ? resultado.valorFiscalMinimo : 0,
    valorFiscalEfetivo: resultado ? resultado.valorFiscalEfetivo : 0,
    valorNaoFiscal: resultado ? resultado.valorNaoFiscal : 0,
    margemFiscalDisponivel: resultado ? resultado.margemFiscalDisponivel : 0,
    possuiMargemFiscal: resultado ? resultado.possuiMargemFiscal === true : false,
    tempoMs: resultado ? resultado.tempoMs : 0,
    origem: meta.origem || null
  };

  console.log('[FISCAL-OPERACIONAL]', JSON.stringify(payload));
  return payload;
}

module.exports = {
  registrar
};
