/**
 * MIDP — Logger estruturado da distribuição (RC3).
 */

const MidpResult = require('./MidpResult');

function resumirPagamentos(pagamentos = []) {
  return (pagamentos || []).map((p) => ({
    forma_pagamento: p.forma_pagamento || null,
    valor: Number(p.valor || 0),
    tipo_recebimento: p.tipo_recebimento || null
  }));
}

/**
 * @param {object} entrada
 * @param {import('./MidpResult')} resultado
 * @param {object} [meta]
 */
function registrarDistribuicao(entrada = {}, resultado, meta = {}) {
  const decisao = resultado && resultado.decisao ? resultado.decisao : null;
  const fo = entrada.fiscalOperacional || null;

  const payload = {
    motor: 'MIDP',
    versao: (resultado && resultado.versao) || MidpResult.VERSAO,
    midpAtivado: meta.midpAtivado === true || (resultado && resultado.midpAtivado === true),
    politica: (resultado && resultado.politica) || null,
    algoritmo: (resultado && resultado.algoritmo) || null,
    origem: (resultado && resultado.origem)
      || entrada.origem
      || meta.origem
      || 'DESCONHECIDA',
    valorFiscal: Number(entrada.valorFiscal || 0),
    valorNaoFiscal: Number(entrada.valorNaoFiscal || 0),
    intervaloFiscal: fo
      ? {
        valorFiscalMaximo: fo.valorFiscalMaximo,
        valorFiscalMinimo: fo.valorFiscalMinimo,
        margemFiscalDisponivel: fo.margemFiscalDisponivel,
        possuiMargemFiscal: fo.possuiMargemFiscal === true
      }
      : null,
    decisao: decisao
      ? {
        valorFiscalEfetivo: decisao.valorFiscalEfetivo,
        valorFiscalEfetivoProposto: decisao.valorFiscalEfetivoProposto,
        quantidadeFiscal: decisao.quantidadeFiscal,
        quantidadeNaoFiscal: decisao.quantidadeNaoFiscal,
        valorFiscalPIX: decisao.valorFiscalPIX,
        valorFiscalDinheiro: decisao.valorFiscalDinheiro,
        economiaDinheiro: decisao.economiaDinheiro,
        valorEletronico: decisao.valorEletronico,
        valorDinheiro: decisao.valorDinheiro
      }
      : null,
    pagamentosEntrada: resumirPagamentos(entrada.pagamentos),
    tempoMs: resultado ? resultado.tempoMs : 0,
    distribuicao: {
      pagamentosFiscal: resumirPagamentos(resultado && resultado.pagamentosFiscal),
      pagamentosNaoFiscal: resumirPagamentos(resultado && resultado.pagamentosNaoFiscal),
      saldoFiscal: resultado ? resultado.saldoFiscal : undefined,
      saldoNaoFiscal: resultado ? resultado.saldoNaoFiscal : undefined
    }
  };

  console.log('[MIDP]', JSON.stringify(payload));
  return payload;
}

module.exports = {
  registrarDistribuicao,
  resumirPagamentos
};
