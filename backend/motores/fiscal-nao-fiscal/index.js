/**
 * Motor Fiscal × Não Fiscal — Fachada pública (RC2).
 *
 * Fornece FiscalOperacionalResult; intervalo via FiscalIntervalCalculator.
 * Não conhece MIDP, pagamentos, TEF, NFC-e ou origens comerciais.
 *
 * @module motores/fiscal-nao-fiscal
 */

const FiscalOperacionalResult = require('./FiscalOperacionalResult');
const FiscalOperacionalService = require('./FiscalOperacionalService');
const FiscalOperacionalLogger = require('./FiscalOperacionalLogger');
const FiscalIntervalCalculator = require('./FiscalIntervalCalculator');
const FiscalIntervalResult = require('./FiscalIntervalResult');
const FiscalMarginCalculator = require('./FiscalMarginCalculator');

module.exports = {
  FiscalOperacionalResult,
  FiscalOperacionalService,
  FiscalOperacionalLogger,
  FiscalIntervalCalculator,
  FiscalIntervalResult,
  FiscalMarginCalculator,
  calcular: FiscalOperacionalService.calcular,
  montarFromTotais: FiscalOperacionalService.montarFromTotais,
  montarFromItens: FiscalOperacionalService.montarFromItens,
  calcularIntervalo: FiscalIntervalCalculator.calcular,
  calcularMargem: FiscalMarginCalculator.calcular,
  VERSAO: FiscalOperacionalResult.VERSAO,
  ALGORITMO: FiscalOperacionalResult.ALGORITMO,
  INTERVAL_VERSAO: FiscalIntervalResult.VERSAO,
  MARGIN_VERSAO: FiscalMarginCalculator.VERSAO
};
