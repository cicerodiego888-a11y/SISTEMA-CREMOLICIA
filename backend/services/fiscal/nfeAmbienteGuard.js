/**
 * Trava de ambiente da NF-e modelo 55.
 *
 * Enquanto a produção não for liberada (sprint própria), toda operação NF-e que
 * chega à SEFAZ — autorização, consulta, status, evento e devolução — só é aceita
 * em homologação (tpAmb = 2). Ambiente ausente ou inválido também é bloqueado.
 *
 * Fonte única do ambiente da NF-e: configuracoes.fiscal_ambiente_nfe (resolverAmbienteNfe).
 * fiscal_ambiente pertence à NFC-e (PDV) e não define o tpAmb da NF-e.
 */

'use strict';

const PRODUCAO_NFE_LIBERADA = false;
const AMBIENTE_HOMOLOGACAO = 2;
const CODIGO_PRODUCAO_BLOQUEADA = 'NFE_PRODUCAO_BLOQUEADA';
const CHAVE_AMBIENTE_NFE = 'fiscal_ambiente_nfe';

function nfeProducaoLiberada() {
  return PRODUCAO_NFE_LIBERADA;
}

/**
 * Ambiente da NF-e modelo 55 a partir das configurações ({ fiscal_ambiente_nfe }).
 * Chave ausente/vazia = homologação (2). Valor diferente de 1/2 = inválido (ambiente null).
 * @returns {{ ambiente: 1|2|null, valido: boolean, origem: 'fiscal_ambiente_nfe'|'padrao', valorConfigurado: string|null }}
 */
function resolverAmbienteNfe(cfg) {
  const bruto = cfg && cfg[CHAVE_AMBIENTE_NFE] != null ? String(cfg[CHAVE_AMBIENTE_NFE]).trim() : '';
  if (!bruto) {
    return { ambiente: AMBIENTE_HOMOLOGACAO, valido: true, origem: 'padrao', valorConfigurado: null };
  }
  if (bruto === '1' || bruto === '2') {
    return { ambiente: Number(bruto), valido: true, origem: CHAVE_AMBIENTE_NFE, valorConfigurado: bruto };
  }
  return { ambiente: null, valido: false, origem: CHAVE_AMBIENTE_NFE, valorConfigurado: bruto };
}

function ambienteNfePermitido(ambiente) {
  const amb = Number(ambiente);
  if (amb === AMBIENTE_HOMOLOGACAO) return true;
  return amb === 1 && PRODUCAO_NFE_LIBERADA;
}

function erroAmbienteNfe(ambiente, operacao) {
  const err = new Error(
    `NF-e em produção não liberada nesta versão (operação: ${operacao || 'nfe'}, ambiente: ${ambiente == null || ambiente === '' ? 'não informado' : ambiente}). ` +
    `Use ${CHAVE_AMBIENTE_NFE} = 2 (homologação).`
  );
  err.code = CODIGO_PRODUCAO_BLOQUEADA;
  err.codigo = CODIGO_PRODUCAO_BLOQUEADA;
  err.statusCode = 403;
  return err;
}

function assertAmbienteNfePermitido(ambiente, operacao) {
  if (!ambienteNfePermitido(ambiente)) {
    throw erroAmbienteNfe(ambiente, operacao);
  }
  return Number(ambiente);
}

module.exports = {
  AMBIENTE_HOMOLOGACAO,
  CODIGO_PRODUCAO_BLOQUEADA,
  CHAVE_AMBIENTE_NFE,
  nfeProducaoLiberada,
  resolverAmbienteNfe,
  ambienteNfePermitido,
  erroAmbienteNfe,
  assertAmbienteNfePermitido
};
