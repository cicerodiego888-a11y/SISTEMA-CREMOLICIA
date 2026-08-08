/**
 * MidpDecisionResult — Decisão MIDP do Valor Fiscal Efetivo (RC3 FINAL).
 *
 * Este valor NÃO pertence ao Motor Fiscal.
 * O Motor Fiscal só fornece o intervalo [mínimo, máximo].
 *
 * Contrato oficial (PRESERVAR_DINHEIRO):
 * {
 *   valorFiscalEfetivo,
 *   quantidadeFiscal,
 *   valorFiscalPIX,
 *   valorFiscalDinheiro,
 *   valorNaoFiscal,
 *   quantidadeNaoFiscal,
 *   economiaDinheiro,
 *   politica,
 *   algoritmo,
 *   versao,
 *   tempoMs
 * }
 *
 * valorFiscalPIX = meios eletrônicos alocados ao fiscal (PIX, cartão, voucher, …).
 */

class MidpDecisionResult {
  /**
   * @param {object} params
   */
  constructor({
    valorFiscalEfetivo = 0,
    valorFiscalEfetivoProposto = null,
    quantidadeFiscal = 0,
    valorFiscalPIX = 0,
    valorFiscalDinheiro = 0,
    valorNaoFiscal = 0,
    quantidadeNaoFiscal = 0,
    economiaDinheiro = 0,
    politica = null,
    algoritmo = null,
    versao = MidpDecisionResult.VERSAO,
    tempoMs = 0,
    valorFiscalMaximo = 0,
    valorFiscalMinimo = 0,
    margemFiscalDisponivel = 0,
    valorEletronico = 0,
    valorDinheiro = 0,
    itensAjuste = null
  } = {}) {
    const efetivo = valorFiscalEfetivoProposto != null
      ? Number(valorFiscalEfetivoProposto)
      : Number(valorFiscalEfetivo);

    this.valorFiscalEfetivo = Number(efetivo) || 0;
    /** @deprecated use valorFiscalEfetivo — alias de compatibilidade RC3 inicial */
    this.valorFiscalEfetivoProposto = this.valorFiscalEfetivo;
    this.quantidadeFiscal = Number(quantidadeFiscal) || 0;
    this.valorFiscalPIX = Number(valorFiscalPIX) || 0;
    this.valorFiscalDinheiro = Number(valorFiscalDinheiro) || 0;
    this.valorNaoFiscal = Number(valorNaoFiscal) || 0;
    this.quantidadeNaoFiscal = Number(quantidadeNaoFiscal) || 0;
    this.economiaDinheiro = Number(economiaDinheiro) || 0;
    this.politica = politica || null;
    this.algoritmo = algoritmo || null;
    this.versao = versao || MidpDecisionResult.VERSAO;
    this.tempoMs = Number(tempoMs) || 0;
    this.valorFiscalMaximo = Number(valorFiscalMaximo) || 0;
    this.valorFiscalMinimo = Number(valorFiscalMinimo) || 0;
    this.margemFiscalDisponivel = Number(margemFiscalDisponivel) || 0;
    this.valorEletronico = Number(valorEletronico) || 0;
    this.valorDinheiro = Number(valorDinheiro) || 0;
    this.itensAjuste = Array.isArray(itensAjuste) ? itensAjuste : null;
  }

  toJSON() {
    return {
      valorFiscalEfetivo: this.valorFiscalEfetivo,
      quantidadeFiscal: this.quantidadeFiscal,
      valorFiscalPIX: this.valorFiscalPIX,
      valorFiscalDinheiro: this.valorFiscalDinheiro,
      valorNaoFiscal: this.valorNaoFiscal,
      quantidadeNaoFiscal: this.quantidadeNaoFiscal,
      economiaDinheiro: this.economiaDinheiro,
      politica: this.politica,
      algoritmo: this.algoritmo,
      versao: this.versao,
      tempoMs: this.tempoMs
    };
  }
}

MidpDecisionResult.VERSAO = 'RC3';

module.exports = MidpDecisionResult;
