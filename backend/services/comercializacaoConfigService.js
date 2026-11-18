/**
 * Comercialização (Configurações → Avançado): como a empresa vende.
 *
 * Ponto único de leitura de `comercializacao.permitirVendaPorLinha` e
 * `comercializacao.permitirVendaPorProduto`. As duas são independentes e
 * globais da empresa (gravadas em configuracoes.json da pasta de dados).
 * Padrão: só venda por produto, como o CDS sempre funcionou.
 *
 * A Linha é só uma forma de seleção: a venda continua sendo de produtos (produto_id).
 */

'use strict';

const configService = require('./configuracaoService');

const AVISO_NENHUMA_FORMA = 'Nenhuma forma de venda está habilitada.';

function obterComercializacao(cfg) {
  return configService.getComercializacao(cfg);
}

function isVendaPorLinhaPermitida(cfg) {
  return obterComercializacao(cfg).permitirVendaPorLinha === true;
}

function isVendaPorProdutoPermitida(cfg) {
  return obterComercializacao(cfg).permitirVendaPorProduto === true;
}

function nenhumaFormaDeVendaHabilitada(cfg) {
  return !isVendaPorLinhaPermitida(cfg) && !isVendaPorProdutoPermitida(cfg);
}

/** Configuração + aviso quando nenhuma forma de venda está ligada (estado permitido). */
function resumoComercializacao(cfg) {
  const comercializacao = obterComercializacao(cfg);
  const nenhuma = !comercializacao.permitirVendaPorLinha && !comercializacao.permitirVendaPorProduto;
  return { ...comercializacao, aviso: nenhuma ? AVISO_NENHUMA_FORMA : null };
}

function salvarComercializacao(entrada) {
  configService.saveComercializacao(entrada);
  return resumoComercializacao();
}

module.exports = {
  AVISO_NENHUMA_FORMA,
  obterComercializacao,
  isVendaPorLinhaPermitida,
  isVendaPorProdutoPermitida,
  nenhumaFormaDeVendaHabilitada,
  resumoComercializacao,
  salvarComercializacao
};
