/**
 * LegacyDistributionPolicy — Política oficial LEGADO (RC2).
 *
 * Reproduz exatamente o comportamento do DistribuidorPagamento
 * via MidpEngine. Não altera o algoritmo.
 *
 * @module motores/midp/policies/LegacyDistributionPolicy
 */

const IMidpPolicy = require('./IMidpPolicy');
const MidpEngine = require('../MidpEngine');
const MidpResult = require('../MidpResult');

class LegacyDistributionPolicy extends IMidpPolicy {
  getNome() {
    return 'LEGADO';
  }

  getAlgoritmo() {
    return 'DistribuidorPagamento';
  }

  /**
   * @param {import('./IMidpPolicy').MidpPolicyEntrada} entrada
   * @param {import('./IMidpPolicy').MidpPolicyContexto} [contexto]
   * @returns {MidpResult}
   */
  executar(entrada = {}, contexto = {}) {
    const resultado = MidpEngine.executar(entrada, {
      midpAtivado: contexto.midpAtivado === true
    });

    return new MidpResult({
      pagamentosFiscal: resultado.pagamentosFiscal,
      pagamentosNaoFiscal: resultado.pagamentosNaoFiscal,
      tempoMs: resultado.tempoMs,
      saldoFiscal: resultado.saldoFiscal,
      saldoNaoFiscal: resultado.saldoNaoFiscal,
      midpAtivado: contexto.midpAtivado === true,
      politica: this.getNome(),
      algoritmo: this.getAlgoritmo(),
      origem: contexto.origem || null,
      versao: MidpResult.VERSAO
    });
  }
}

module.exports = LegacyDistributionPolicy;
