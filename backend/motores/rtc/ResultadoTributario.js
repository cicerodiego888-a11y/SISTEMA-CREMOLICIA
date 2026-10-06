/**
 * RTC — Resultado tributário por item (saída contratual do motor tributário).
 *
 * IBS/CBS: estrutura apenas. Sem alíquota, base ou valor padrão; um valor só é
 * aceito quando acompanhado da fonte normativa/configuração que o originou.
 */

'use strict';

const ORIGEM_NAO_CONFIGURADO = 'NAO_CONFIGURADO';

const TRIBUTOS_RTC = Object.freeze(['ibs', 'cbs']);

function erroResultado(mensagem) {
  const err = new Error(mensagem);
  err.code = 'RTC_RESULTADO_INVALIDO';
  return err;
}

function numeroOuNulo(valor) {
  if (valor == null || valor === '') return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {string} nome 'ibs' | 'cbs'
 * @param {object} [dados] { cst, cClassTrib, baseCalculo, aliquota, valor, fonte }
 */
function criarTributoRtc(nome, dados = null) {
  if (!dados) {
    return Object.freeze({
      tributo: nome,
      aplicavel: false,
      cst: null,
      cClassTrib: null,
      baseCalculo: null,
      aliquota: null,
      valor: null,
      fonte: ORIGEM_NAO_CONFIGURADO
    });
  }
  const aliquota = numeroOuNulo(dados.aliquota);
  const baseCalculo = numeroOuNulo(dados.baseCalculo);
  const valor = numeroOuNulo(dados.valor);
  const fonte = dados.fonte ? String(dados.fonte).trim() : '';
  if ((aliquota != null || valor != null || baseCalculo != null) && !fonte) {
    throw erroResultado(`${nome.toUpperCase()}: valores tributários exigem a fonte (configuração/norma) que os originou.`);
  }
  return Object.freeze({
    tributo: nome,
    aplicavel: Boolean(dados.aplicavel ?? (aliquota != null || valor != null)),
    cst: dados.cst != null ? String(dados.cst) : null,
    cClassTrib: dados.cClassTrib != null ? String(dados.cClassTrib) : null,
    baseCalculo,
    aliquota,
    valor,
    fonte: fonte || ORIGEM_NAO_CONFIGURADO
  });
}

/**
 * @param {object} dados
 * @param {number} dados.nItem
 * @param {object} [dados.icms] { regime, csosn, cst, origem }
 * @param {object} [dados.pis]  { cst, baseCalculo, aliquota, valor }
 * @param {object} [dados.cofins] { cst, baseCalculo, aliquota, valor }
 * @param {object} [dados.ibs]
 * @param {object} [dados.cbs]
 */
function criarResultadoTributario(dados = {}) {
  const nItem = Number(dados.nItem);
  if (!Number.isInteger(nItem) || nItem < 1) {
    throw erroResultado('nItem inválido no resultado tributário.');
  }
  return Object.freeze({
    nItem,
    icms: Object.freeze({ ...(dados.icms || {}) }),
    pis: Object.freeze({ ...(dados.pis || {}) }),
    cofins: Object.freeze({ ...(dados.cofins || {}) }),
    ibs: criarTributoRtc('ibs', dados.ibs || null),
    cbs: criarTributoRtc('cbs', dados.cbs || null)
  });
}

/**
 * Descreve, em contrato RTC, a tributação que o builder NF-e 55 aplica hoje
 * (ICMSSN102 com CSOSN do produto; PIS/COFINS Outr CST 49 zerados; sem IBS/CBS).
 */
function resultadoDoBuilderNfeAtual(itemContexto) {
  return criarResultadoTributario({
    nItem: itemContexto.nItem,
    icms: {
      regime: 'SIMPLES_NACIONAL',
      grupo: 'ICMSSN102',
      csosn: itemContexto.csosn || '102',
      origem: itemContexto.origem != null ? itemContexto.origem : '0'
    },
    pis: { grupo: 'PISOutr', cst: '49', baseCalculo: 0, aliquota: 0, valor: 0 },
    cofins: { grupo: 'COFINSOutr', cst: '49', baseCalculo: 0, aliquota: 0, valor: 0 }
  });
}

module.exports = {
  ORIGEM_NAO_CONFIGURADO,
  TRIBUTOS_RTC,
  criarTributoRtc,
  criarResultadoTributario,
  resultadoDoBuilderNfeAtual
};
