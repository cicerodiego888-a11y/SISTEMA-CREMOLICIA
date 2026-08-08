/**
 * FiscalIntervalResult — Resultado do intervalo fiscal permitido (RC2).
 *
 * Contrato:
 * {
 *   valorFiscalMaximo,
 *   valorFiscalMinimo,
 *   margemFiscalDisponivel,
 *   possuiMargemFiscal,
 *   algoritmo,
 *   versao,
 *   tempoMs
 * }
 *
 * Nesta RC2 (isolamento apenas):
 * máximo = mínimo = valor fiscal atual; margem = 0; possuiMargemFiscal = false.
 */

class FiscalIntervalResult {
  /**
   * @param {object} params
   * @param {number} params.valorFiscalMaximo
   * @param {number} params.valorFiscalMinimo
   * @param {number} params.margemFiscalDisponivel
   * @param {boolean} params.possuiMargemFiscal
   * @param {string} [params.algoritmo]
   * @param {string} [params.versao]
   * @param {number} [params.tempoMs]
   */
  constructor({
    valorFiscalMaximo = 0,
    valorFiscalMinimo = 0,
    margemFiscalDisponivel = 0,
    possuiMargemFiscal = false,
    algoritmo = FiscalIntervalResult.ALGORITMO,
    versao = FiscalIntervalResult.VERSAO,
    tempoMs = 0
  } = {}) {
    this.valorFiscalMaximo = Number(valorFiscalMaximo) || 0;
    this.valorFiscalMinimo = Number(valorFiscalMinimo) || 0;
    this.margemFiscalDisponivel = Number(margemFiscalDisponivel) || 0;
    this.possuiMargemFiscal = possuiMargemFiscal === true;
    this.algoritmo = algoritmo || FiscalIntervalResult.ALGORITMO;
    this.versao = versao || FiscalIntervalResult.VERSAO;
    this.tempoMs = Number(tempoMs) || 0;
  }

  toJSON() {
    return {
      valorFiscalMaximo: this.valorFiscalMaximo,
      valorFiscalMinimo: this.valorFiscalMinimo,
      margemFiscalDisponivel: this.margemFiscalDisponivel,
      possuiMargemFiscal: this.possuiMargemFiscal,
      algoritmo: this.algoritmo,
      versao: this.versao,
      tempoMs: this.tempoMs
    };
  }
}

FiscalIntervalResult.VERSAO = 'RC3';
FiscalIntervalResult.ALGORITMO = 'FiscalIntervalCalculator→FiscalMarginCalculator.RC3';

module.exports = FiscalIntervalResult;
