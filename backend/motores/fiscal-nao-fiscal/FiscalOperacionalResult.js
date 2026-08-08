/**
 * FiscalOperacionalResult — Contrato oficial de saída do Motor Fiscal × Não Fiscal.
 *
 * RC2: valores de intervalo (máximo / mínimo / margem) vêm do FiscalIntervalCalculator.
 * Valor Fiscal Efetivo permanece = valorFiscalMaximo (sem alteração funcional vs RC1).
 *
 * Compatibilidade legado:
 * - valorFiscal → valorFiscalEfetivo
 * - totalFiscal → valorFiscalEfetivo
 * - totalNaoFiscal → valorNaoFiscal
 */

class FiscalOperacionalResult {
  /**
   * @param {object} params
   * @param {number} params.valorFiscalMaximo
   * @param {number} params.valorFiscalMinimo
   * @param {number} params.valorFiscalEfetivo
   * @param {number} params.valorNaoFiscal
   * @param {number} params.margemFiscalDisponivel
   * @param {boolean} params.possuiMargemFiscal
   * @param {string} [params.versao]
   * @param {string} [params.algoritmo]
   * @param {number} [params.tempoMs]
   */
  constructor({
    valorFiscalMaximo = 0,
    valorFiscalMinimo = 0,
    valorFiscalEfetivo = 0,
    valorNaoFiscal = 0,
    margemFiscalDisponivel = 0,
    possuiMargemFiscal = false,
    versao = FiscalOperacionalResult.VERSAO,
    algoritmo = FiscalOperacionalResult.ALGORITMO,
    tempoMs = 0
  } = {}) {
    this.valorFiscalMaximo = Number(valorFiscalMaximo) || 0;
    this.valorFiscalMinimo = Number(valorFiscalMinimo) || 0;
    this.valorFiscalEfetivo = Number(valorFiscalEfetivo) || 0;
    this.valorNaoFiscal = Number(valorNaoFiscal) || 0;
    this.margemFiscalDisponivel = Number(margemFiscalDisponivel) || 0;
    this.possuiMargemFiscal = possuiMargemFiscal === true;
    this.versao = versao || FiscalOperacionalResult.VERSAO;
    this.algoritmo = algoritmo || FiscalOperacionalResult.ALGORITMO;
    this.tempoMs = Number(tempoMs) || 0;
  }

  /** Compatibilidade: código legado que lê valorFiscal. */
  get valorFiscal() {
    return this.valorFiscalEfetivo;
  }

  /** Compatibilidade: retorno histórico de separarItensDistribuidos. */
  get totalFiscal() {
    return this.valorFiscalEfetivo;
  }

  /** Compatibilidade: retorno histórico de separarItensDistribuidos. */
  get totalNaoFiscal() {
    return this.valorNaoFiscal;
  }

  toJSON() {
    return {
      valorFiscalMaximo: this.valorFiscalMaximo,
      valorFiscalMinimo: this.valorFiscalMinimo,
      valorFiscalEfetivo: this.valorFiscalEfetivo,
      valorNaoFiscal: this.valorNaoFiscal,
      margemFiscalDisponivel: this.margemFiscalDisponivel,
      possuiMargemFiscal: this.possuiMargemFiscal,
      versao: this.versao,
      algoritmo: this.algoritmo,
      tempoMs: this.tempoMs,
      // aliases legados (somente leitura)
      valorFiscal: this.valorFiscal,
      totalFiscal: this.totalFiscal,
      totalNaoFiscal: this.totalNaoFiscal
    };
  }
}

FiscalOperacionalResult.VERSAO = 'RC3';
FiscalOperacionalResult.ALGORITMO = 'FiscalMarginCalculator+efetivoInalterado';

module.exports = FiscalOperacionalResult;
