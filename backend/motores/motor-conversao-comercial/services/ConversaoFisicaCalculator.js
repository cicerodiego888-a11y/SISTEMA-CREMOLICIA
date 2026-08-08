/**
 * MCI-01 — ConversaoFisicaCalculator
 *
 * Calcula quantidade base → quantidade destino → fator.
 * Independente de UI. Usado pelo MCC.CalcularConversaoFisica() e pelo Orchestrator.
 */

const PesoInvalidoError = require('../domain/PesoInvalidoError');
const VolumeInvalidoError = require('../domain/VolumeInvalidoError');
const ConversaoFisicaLote = require('../domain/ConversaoFisicaLote');
const { OrigemConversaoFisica } = require('../domain/enums');

class ConversaoFisicaCalculator {
  /**
   * @param {object} entrada
   * @param {number} entrada.volume — quantidade na unidade base (ex.: litros)
   * @param {number} entrada.peso — quantidade na unidade destino (ex.: kg)
   * @param {string} [entrada.unidadeBase]
   * @param {string} [entrada.unidadeDestino]
   * @param {string} [entrada.origem]
   * @returns {{ quantidadeBase: number, quantidadeDestino: number, fator: number, unidadeBase: string, unidadeDestino: string, origem: string }}
   */
  calcular({
    volume,
    peso,
    unidadeBase = 'L',
    unidadeDestino = 'KG',
    origem = OrigemConversaoFisica.CALCULADA
  } = {}) {
    const quantidadeBase = Number(volume);
    const quantidadeDestino = Number(peso);

    if (!Number.isFinite(quantidadeBase) || quantidadeBase <= 0) {
      throw new VolumeInvalidoError(undefined, { volume: quantidadeBase });
    }
    if (!Number.isFinite(quantidadeDestino) || quantidadeDestino <= 0) {
      throw new PesoInvalidoError(undefined, { peso: quantidadeDestino });
    }

    const fator = ConversaoFisicaLote.calcularFator(quantidadeBase, quantidadeDestino);

    return {
      quantidadeBase,
      quantidadeDestino,
      fator,
      unidadeBase: String(unidadeBase || 'L').trim().toUpperCase(),
      unidadeDestino: String(unidadeDestino || 'KG').trim().toUpperCase(),
      origem: String(origem || OrigemConversaoFisica.CALCULADA).toUpperCase()
    };
  }
}

/** Instância padrão */
const calculator = new ConversaoFisicaCalculator();

/**
 * Interface oficial MCC: CalcularConversaoFisica({ volume, peso }) → fator
 * Sem depender da UI.
 */
function CalcularConversaoFisica(entrada = {}) {
  return calculator.calcular(entrada);
}

module.exports = {
  ConversaoFisicaCalculator,
  CalcularConversaoFisica,
  calculator
};
