/**
 * MIDP — Motor Inteligente de Distribuição de Pagamentos (RC3 FINAL)
 *
 * RC3 FINAL: PreservarDinheiroPolicy decide valorFiscalEfetivo /
 * quantidades com prioridade aos meios eletrônicos; DistribuidorPagamento
 * recebe apenas valores finais (sem produtos/margem/política).
 *
 * MidpService NÃO conhece políticas concretas — apenas a factory.
 */

const configService = require('../../services/configuracaoService');
const MidpPolicyFactory = require('./policies/MidpPolicyFactory');
const MidpLogger = require('./MidpLogger');
const MidpResult = require('./MidpResult');

function normalizarPagamentosEntrada(pagamentos, formaPagamentoPadrao) {
  if (!Array.isArray(pagamentos) || pagamentos.length === 0) {
    return [{
      forma_pagamento: formaPagamentoPadrao || 'dinheiro',
      valor: 0
    }];
  }

  return pagamentos.map((p) => ({
    forma_pagamento: p.forma_pagamento || formaPagamentoPadrao || 'dinheiro',
    valor: Number(p.valor || 0),
    tef_transacao_id: p.tef_transacao_id || null,
    nsu: p.nsu || null,
    autorizacao: p.autorizacao || null
  }));
}

function isMidpAtivado(override) {
  if (typeof override === 'boolean') {
    return override;
  }
  if (typeof configService.isMidpAtivado === 'function') {
    return configService.isMidpAtivado() === true;
  }
  return configService.readConfig().midp_ativado === true;
}

/**
 * @param {object} entrada
 * @param {number} [entrada.valorFiscal]
 * @param {number} [entrada.valorNaoFiscal]
 * @param {object} [entrada.fiscalOperacional] — FiscalOperacionalResult (Motor Fiscal)
 * @param {Array}  [entrada.itens] — itens distribuídos (para PRESERVAR_DINHEIRO FINAL)
 * @param {Array}  entrada.pagamentos
 * @param {string} [entrada.formaPagamentoPadrao]
 * @param {string} [entrada.origem]
 * @param {boolean} [entrada.midpAtivado]
 * @param {string} [entrada.midpPolitica]
 * @returns {import('./MidpResult')}
 */
function distribuir(entrada = {}) {
  const fiscalOperacional = entrada.fiscalOperacional || null;
  const valorFiscal = Number(
    fiscalOperacional?.valorFiscalEfetivo
      ?? fiscalOperacional?.valorFiscalMaximo
      ?? fiscalOperacional?.totalFiscal
      ?? entrada.valorFiscal
      ?? 0
  );
  const valorNaoFiscal = Number(
    fiscalOperacional?.valorNaoFiscal
      ?? fiscalOperacional?.totalNaoFiscal
      ?? entrada.valorNaoFiscal
      ?? 0
  );
  const itens = Array.isArray(entrada.itens) ? entrada.itens : [];
  const pagamentosNormalizados = normalizarPagamentosEntrada(
    entrada.pagamentos,
    entrada.formaPagamentoPadrao
  );
  const midpAtivado = isMidpAtivado(entrada.midpAtivado);
  const origem = entrada.origem || null;

  // 3.8D.3.2: produção seleciona só por midp_ativado; midpPolitica = override de testes
  const factoryOpts = { midpAtivado };
  if (entrada.midpPolitica !== undefined && entrada.midpPolitica !== null) {
    factoryOpts.politica = entrada.midpPolitica;
  }
  const politica = MidpPolicyFactory.obterPolitica(factoryOpts);

  const resultado = politica.executar(
    {
      valorFiscal,
      valorNaoFiscal,
      pagamentos: pagamentosNormalizados,
      fiscalOperacional,
      itens
    },
    { midpAtivado, origem }
  );

  MidpLogger.registrarDistribuicao(
    {
      origem,
      valorFiscal,
      valorNaoFiscal,
      pagamentos: pagamentosNormalizados,
      fiscalOperacional,
      itensCount: itens.length
    },
    resultado,
    { midpAtivado, origem }
  );

  return resultado;
}

module.exports = {
  distribuir,
  isMidpAtivado,
  normalizarPagamentosEntrada,
  VERSAO: MidpResult.VERSAO
};
