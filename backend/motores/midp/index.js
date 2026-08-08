/**
 * MIDP — Motor Inteligente de Distribuição de Pagamentos
 *
 * Fachada pública do módulo. Ponto de entrada único para distribuição
 * de meios de pagamento Fiscal × Não Fiscal.
 *
 * @module motores/midp
 */

const MidpService = require('./MidpService');
const MidpEngine = require('./MidpEngine');
const MidpResult = require('./MidpResult');
const MidpDecisionResult = require('./MidpDecisionResult');
const MidpLogger = require('./MidpLogger');
const policies = require('./policies');

module.exports = {
  MidpService,
  MidpEngine,
  MidpResult,
  MidpDecisionResult,
  MidpLogger,
  policies,
  MidpPolicyFactory: policies.MidpPolicyFactory,
  IMidpPolicy: policies.IMidpPolicy,
  LegacyDistributionPolicy: policies.LegacyDistributionPolicy,
  PreservarDinheiroPolicy: policies.PreservarDinheiroPolicy,
  distribuir: MidpService.distribuir,
  isMidpAtivado: MidpService.isMidpAtivado,
  obterPolitica: policies.obterPolitica,
  VERSAO: MidpResult.VERSAO
};
