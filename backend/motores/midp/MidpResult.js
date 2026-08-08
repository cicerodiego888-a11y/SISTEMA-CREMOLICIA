/**
 * MIDP — Resultado da distribuição de meios de pagamento (RC2).
 *
 * Contrato de saída oficial (compatível com RC1):
 * { pagamentosFiscal[], pagamentosNaoFiscal[], tempoMs }
 *
 * Metadados adicionais (RC2, não quebram consumidores):
 * politica, versao, algoritmo, origem, midpAtivado
 */

class MidpResult {
  /**
   * @param {object} params
   * @param {Array} params.pagamentosFiscal
   * @param {Array} params.pagamentosNaoFiscal
   * @param {number} params.tempoMs
   * @param {number} [params.saldoFiscal]
   * @param {number} [params.saldoNaoFiscal]
   * @param {string} [params.versao]
   * @param {boolean} [params.midpAtivado]
   * @param {string} [params.politica]
   * @param {string} [params.algoritmo]
   * @param {string|null} [params.origem]
   */
  constructor({
    pagamentosFiscal = [],
    pagamentosNaoFiscal = [],
    tempoMs = 0,
    saldoFiscal = 0,
    saldoNaoFiscal = 0,
    versao = MidpResult.VERSAO,
    midpAtivado = false,
    politica = null,
    algoritmo = null,
    origem = null
  } = {}) {
    this.pagamentosFiscal = Array.isArray(pagamentosFiscal) ? pagamentosFiscal : [];
    this.pagamentosNaoFiscal = Array.isArray(pagamentosNaoFiscal) ? pagamentosNaoFiscal : [];
    this.tempoMs = Number(tempoMs) || 0;
    this.saldoFiscal = Number(saldoFiscal) || 0;
    this.saldoNaoFiscal = Number(saldoNaoFiscal) || 0;
    this.versao = versao || MidpResult.VERSAO;
    this.midpAtivado = midpAtivado === true;
    this.politica = politica || null;
    this.algoritmo = algoritmo || null;
    this.origem = origem || null;
  }

  /**
   * Forma legada consumida pelo OrquestradorPagamento.
   */
  paraDistribuicaoLegada() {
    return {
      recebimentosFiscal: this.pagamentosFiscal,
      recebimentosNaoFiscal: this.pagamentosNaoFiscal,
      saldoFiscal: this.saldoFiscal,
      saldoNaoFiscal: this.saldoNaoFiscal
    };
  }

  /**
   * Contrato público: campos RC1 + metadados RC2 (aditivos).
   */
  toJSON() {
    return {
      pagamentosFiscal: this.pagamentosFiscal,
      pagamentosNaoFiscal: this.pagamentosNaoFiscal,
      tempoMs: this.tempoMs,
      politica: this.politica,
      versao: this.versao,
      algoritmo: this.algoritmo,
      origem: this.origem,
      midpAtivado: this.midpAtivado
    };
  }
}

MidpResult.VERSAO = 'RC3';

module.exports = MidpResult;
