/**
 * IMidpPolicy — Contrato oficial de política MIDP (RC2).
 *
 * Toda decisão de distribuição passa por uma implementação deste contrato.
 * MidpService NÃO conhece políticas concretas — apenas a factory.
 *
 * @module motores/midp/policies/IMidpPolicy
 */

/**
 * @typedef {object} MidpPolicyEntrada
 * @property {number} valorFiscal
 * @property {number} valorNaoFiscal
 * @property {Array} pagamentos — já normalizados
 * @property {object} [fiscalOperacional] — FiscalOperacionalResult (intervalo do Motor Fiscal)
 * @property {Array} [itens] — itens da venda (quantidade/preço/fracionável) para PRESERVAR_DINHEIRO
 */

/**
 * @typedef {object} MidpPolicyContexto
 * @property {boolean} [midpAtivado]
 * @property {string} [origem] — apenas metadado/log; nunca seleciona política
 */

class IMidpPolicy {
  /**
   * Nome oficial da política (ex.: LEGADO, PRESERVAR_DINHEIRO).
   * @returns {string}
   */
  getNome() {
    throw new Error('IMidpPolicy.getNome() não implementado');
  }

  /**
   * Identificador do algoritmo interno.
   * @returns {string}
   */
  getAlgoritmo() {
    throw new Error('IMidpPolicy.getAlgoritmo() não implementado');
  }

  /**
   * Executa a distribuição e retorna MidpResult.
   *
   * @param {MidpPolicyEntrada} _entrada
   * @param {MidpPolicyContexto} [_contexto]
   * @returns {import('../MidpResult')}
   */
  executar(_entrada, _contexto) {
    throw new Error('IMidpPolicy.executar() não implementado');
  }
}

module.exports = IMidpPolicy;
