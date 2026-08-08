/**
 * MCI-01 / MCC-03 — Modos oficiais de entrada de conversão física na Compra
 *
 * Nunca solicitar ao operador: "1 Litro = XXX Kg".
 * O fator é sempre derivado de volume + peso informados.
 */

const ModoEntradaConversao = Object.freeze({
  /** Peso por embalagem (ex.: 20 CX · cada CX 5 L · peso 3,375 Kg) */
  PESO_POR_EMBALAGEM: 'PESO_POR_EMBALAGEM',
  /** Peso total + volume total (ex.: 100 L · 67,500 Kg) */
  PESO_TOTAL: 'PESO_TOTAL'
});

module.exports = ModoEntradaConversao;
