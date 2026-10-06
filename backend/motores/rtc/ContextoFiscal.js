/**
 * RTC — Contexto fiscal de uma operação (entrada contratual do motor tributário).
 * Somente estrutura: não calcula tributo, não define alíquota.
 */

'use strict';

const MODELOS = Object.freeze({ NFE: '55', NFCE: '65' });

function onlyDigits(valor) {
  return String(valor == null ? '' : valor).replace(/\D/g, '');
}

function erroContexto(mensagem) {
  const err = new Error(mensagem);
  err.code = 'RTC_CONTEXTO_INVALIDO';
  return err;
}

/**
 * @param {object} dados
 * @param {'55'|'65'} dados.modelo
 * @param {number} dados.ambiente 1=produção 2=homologação
 * @param {string} dados.uf UF do emitente (sigla)
 * @param {string} dados.crt CRT do emitente
 * @param {string} [dados.cnpjEmitente]
 * @param {string} [dados.ufDestino]
 * @param {string} [dados.cfop]
 * @param {string} [dados.naturezaOperacao]
 * @param {Array<object>} [dados.itens] { produtoId, ncm, cfop, csosn, origem, quantidadeFiscal, valorFiscal }
 */
function criarContextoFiscal(dados = {}) {
  const modelo = String(dados.modelo || '');
  if (!Object.values(MODELOS).includes(modelo)) {
    throw erroContexto(`Modelo fiscal inválido para o contexto RTC: ${modelo || '(vazio)'}.`);
  }
  const ambiente = Number(dados.ambiente);
  if (![1, 2].includes(ambiente)) {
    throw erroContexto('Ambiente fiscal inválido para o contexto RTC.');
  }
  const uf = String(dados.uf || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(uf)) {
    throw erroContexto('UF do emitente inválida para o contexto RTC.');
  }

  const itens = (Array.isArray(dados.itens) ? dados.itens : []).map((item, idx) => Object.freeze({
    nItem: idx + 1,
    produtoId: item.produtoId ?? item.produto_id ?? null,
    ncm: onlyDigits(item.ncm || item.produto_ncm) || null,
    cfop: onlyDigits(item.cfop || dados.cfop) || null,
    csosn: item.csosn != null ? String(item.csosn) : null,
    origem: item.origem != null ? String(item.origem) : null,
    quantidadeFiscal: Number(item.quantidadeFiscal ?? item.quantidade_fiscal ?? 0) || 0,
    valorFiscal: Number(item.valorFiscal ?? item.valor_fiscal ?? 0) || 0
  }));

  return Object.freeze({
    modelo,
    ambiente,
    uf,
    ufDestino: dados.ufDestino ? String(dados.ufDestino).trim().toUpperCase() : uf,
    crt: String(dados.crt || ''),
    cnpjEmitente: onlyDigits(dados.cnpjEmitente) || null,
    cfop: onlyDigits(dados.cfop) || null,
    naturezaOperacao: dados.naturezaOperacao ? String(dados.naturezaOperacao) : null,
    itens: Object.freeze(itens)
  });
}

module.exports = {
  MODELOS,
  criarContextoFiscal
};
