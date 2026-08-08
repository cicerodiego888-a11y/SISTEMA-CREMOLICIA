/**
 * Índice das políticas MIDP (RC3 FINAL).
 *
 * @module motores/midp/policies
 */

const IMidpPolicy = require('./IMidpPolicy');
const LegacyDistributionPolicy = require('./LegacyDistributionPolicy');
const PreservarDinheiroPolicy = require('./PreservarDinheiroPolicy');
const PreservarDinheiroCalculator = require('./PreservarDinheiroCalculator');
const MidpPolicyFactory = require('./MidpPolicyFactory');

module.exports = {
  IMidpPolicy,
  LegacyDistributionPolicy,
  PreservarDinheiroPolicy,
  PreservarDinheiroCalculator,
  MidpPolicyFactory,
  obterPolitica: MidpPolicyFactory.obterPolitica,
  POLITICAS_PERMITIDAS: MidpPolicyFactory.POLITICAS_PERMITIDAS
};
