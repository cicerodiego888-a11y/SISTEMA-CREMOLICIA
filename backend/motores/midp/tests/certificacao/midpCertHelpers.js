/**
 * Helpers de certificação MIDP V1.0 — somente validação (não altera algoritmos).
 * @module motores/midp/tests/certificacao/midpCertHelpers
 */

'use strict';

const MidpService = require('../../MidpService');
const { montarFromItens } = require('../../../fiscal-nao-fiscal');
const { resolverPagamentosNfce } = require('../../../../services/fiscal/xmlBuilder');

const EPS = 0.02;
const QTY_EPS = 0.001;

function arredondar2(v) {
  return Number(Number(v || 0).toFixed(2));
}

function fo({ max, min, nf }) {
  const margem = arredondar2(Math.max(0, max - min));
  return {
    valorFiscalMaximo: max,
    valorFiscalMinimo: min,
    valorFiscalEfetivo: max,
    valorNaoFiscal: nf,
    margemFiscalDisponivel: margem,
    possuiMargemFiscal: margem > 0.009,
    totalFiscal: max,
    totalNaoFiscal: nf
  };
}

function itemInteiro({ qtd = 10, preco = 15, qFiscal = null, qNao = 0, unidade = 'UN' } = {}) {
  const quantidade = qtd;
  const quantidade_fiscal = qFiscal != null ? qFiscal : quantidade;
  const quantidade_nao_fiscal = qNao;
  return {
    quantidade,
    preco_unitario: preco,
    quantidade_fiscal,
    quantidade_nao_fiscal,
    valor_fiscal: arredondar2(quantidade_fiscal * preco),
    valor_nao_fiscal: arredondar2(quantidade_nao_fiscal * preco),
    produto_fracionado: 0,
    unidade
  };
}

function itemFracionavel({ qtd = 5, preco = 30, qFiscal = null, qNao = 0, unidade = 'KG' } = {}) {
  const quantidade = qtd;
  const quantidade_fiscal = qFiscal != null ? qFiscal : quantidade;
  const quantidade_nao_fiscal = qNao;
  return {
    quantidade,
    preco_unitario: preco,
    quantidade_fiscal,
    quantidade_nao_fiscal,
    valor_fiscal: arredondar2(quantidade_fiscal * preco),
    valor_nao_fiscal: arredondar2(quantidade_nao_fiscal * preco),
    produto_fracionado: 1,
    unidade
  };
}

function soma(lista, predicado) {
  return arredondar2(
    (lista || []).reduce((acc, p) => {
      if (predicado && !predicado(p)) return acc;
      return acc + Number(p.valor || 0);
    }, 0)
  );
}

function formaEh(p, nomes) {
  const f = String(p.forma_pagamento || '').toLowerCase();
  return nomes.some((n) => f === n || f.includes(n));
}

function aplicarItensAjuste(itens, decisao) {
  if (!decisao || !Array.isArray(decisao.itensAjuste)) return itens;
  return (itens || []).map((item, i) => {
    const adj = decisao.itensAjuste[i];
    if (!adj) return item;
    return {
      ...item,
      quantidade_fiscal: Number(adj.quantidade_fiscal),
      quantidade_nao_fiscal: Number(adj.quantidade_nao_fiscal),
      valor_fiscal: Number(adj.valor_fiscal),
      valor_nao_fiscal: Number(adj.valor_nao_fiscal)
    };
  });
}

/**
 * Executa pipeline de certificação:
 * Motor Fiscal (intervalo) → MIDP → Distribuidor → invariantes NFC-e / estoque / financeiro
 */
function executarCenario({
  nome,
  itens,
  pagamentos,
  fiscalOperacional,
  origem = 'CERTIFICACAO',
  midpPolitica = 'PRESERVAR_DINHEIRO',
  quiet = false
}) {
  const inicio = Date.now();
  const itensEntrada = (itens || []).map((i) => ({ ...i }));
  const pags = (pagamentos || []).map((p) => ({ ...p }));

  let foResult = fiscalOperacional;
  if (!foResult) {
    foResult = montarFromItens(itensEntrada, { log: false, origem: 'CERTIFICACAO' });
  }

  const midp = MidpService.distribuir({
    fiscalOperacional: foResult,
    valorFiscal: foResult.valorFiscalMaximo ?? foResult.totalFiscal,
    valorNaoFiscal: foResult.valorNaoFiscal ?? foResult.totalNaoFiscal,
    pagamentos: pags,
    itens: itensEntrada,
    midpPolitica,
    midpAtivado: true,
    origem
  });

  const decisao = midp.decisao || null;
  const itensFinais = aplicarItensAjuste(itensEntrada, decisao);

  const produtosFiscal = arredondar2(
    itensFinais.reduce((s, i) => s + Number(i.valor_fiscal || 0), 0)
  );
  const produtosNaoFiscal = arredondar2(
    itensFinais.reduce((s, i) => s + Number(i.valor_nao_fiscal || 0), 0)
  );

  // Quando há decisão MIDP, totais oficiais da venda são os da decisão
  const valorFiscal = decisao
    ? arredondar2(decisao.valorFiscalEfetivo)
    : produtosFiscal;
  const valorNaoFiscal = decisao
    ? arredondar2(decisao.valorNaoFiscal)
    : produtosNaoFiscal;

  const pagFiscal = midp.pagamentosFiscal || [];
  const pagNaoFiscal = midp.pagamentosNaoFiscal || [];
  const pagFiscalTotal = soma(pagFiscal);
  const pagNaoFiscalTotal = soma(pagNaoFiscal);

  const qFiscal = itensFinais.reduce((s, i) => s + Number(i.quantidade_fiscal || 0), 0);
  const qNaoFiscal = itensFinais.reduce((s, i) => s + Number(i.quantidade_nao_fiscal || 0), 0);
  const qVendida = itensFinais.reduce((s, i) => s + Number(i.quantidade || 0), 0);

  const pixFiscal = soma(pagFiscal, (p) => formaEh(p, ['pix']));
  const dinheiroFiscal = soma(pagFiscal, (p) => formaEh(p, ['dinheiro']));
  const pixNaoFiscal = soma(pagNaoFiscal, (p) => formaEh(p, ['pix']));
  const dinheiroNaoFiscal = soma(pagNaoFiscal, (p) => formaEh(p, ['dinheiro']));

  const complemento = decisao ? arredondar2(decisao.valorFiscalDinheiro || 0) : dinheiroFiscal;
  const economia = decisao ? arredondar2(decisao.economiaDinheiro || 0) : 0;

  // NFC-e: pagamentos fiscais devem fechar com vNF (= valor fiscal)
  let xmlFecha = true;
  let xmlSoma = 0;
  let xmlAjustou = false;
  if (valorFiscal > EPS) {
    const vendaFake = {
      pagamentos: [
        ...pagFiscal.map((p) => ({ ...p, tipo_recebimento: 'fiscal' })),
        ...pagNaoFiscal.map((p) => ({ ...p, tipo_recebimento: 'nao_fiscal' }))
      ]
    };
    const prevLog = console.log;
    if (quiet) {
      console.log = () => {};
    }
    try {
      const pagXml = resolverPagamentosNfce(vendaFake, valorFiscal);
      xmlSoma = soma(pagXml);
      xmlFecha = Math.abs(xmlSoma - valorFiscal) <= EPS;
      xmlAjustou = Math.abs(pagFiscalTotal - xmlSoma) > EPS;
    } finally {
      if (quiet) console.log = prevLog;
    }
  } else {
    xmlFecha = true;
    xmlSoma = 0;
  }

  const tempoMs = Date.now() - inicio;

  const log = {
    cenario: nome,
    quantidadeFiscal: Number(qFiscal.toFixed(6)),
    quantidadeNaoFiscal: Number(qNaoFiscal.toFixed(6)),
    valorFiscal,
    valorNaoFiscal,
    pixFiscal,
    dinheiroFiscal,
    pixNaoFiscal,
    dinheiroNaoFiscal,
    complementoUtilizado: complemento,
    economiaDinheiro: economia,
    tempoMs,
    politica: midp.politica,
    algoritmo: midp.algoritmo
  };

  if (!quiet) {
    console.log('[MIDP-CERT]', JSON.stringify(log));
  }

  return {
    nome,
    midp,
    decisao,
    itensFinais,
    foResult,
    valorFiscal,
    valorNaoFiscal,
    produtosFiscal: valorFiscal,
    produtosNaoFiscal: valorNaoFiscal,
    pagFiscalTotal,
    pagNaoFiscalTotal,
    pagFiscal,
    pagNaoFiscal,
    qFiscal,
    qNaoFiscal,
    qVendida,
    pixFiscal,
    dinheiroFiscal,
    pixNaoFiscal,
    dinheiroNaoFiscal,
    complemento,
    economia,
    xmlFecha,
    xmlSoma,
    xmlAjustou,
    tempoMs,
    log
  };
}

function assertInvariantes(r, assert) {
  // Produtos fiscais = Pagamentos fiscais
  assert.ok(
    Math.abs(r.valorFiscal - r.pagFiscalTotal) <= EPS,
    `${r.nome}: produtos fiscais (${r.valorFiscal}) ≠ pagamentos fiscais (${r.pagFiscalTotal})`
  );

  // Produtos não fiscais = Pagamentos não fiscais
  assert.ok(
    Math.abs(r.valorNaoFiscal - r.pagNaoFiscalTotal) <= EPS,
    `${r.nome}: produtos NF (${r.valorNaoFiscal}) ≠ pagamentos NF (${r.pagNaoFiscalTotal})`
  );

  // Σ produtos = Σ pagamentos
  const somaProd = arredondar2(r.valorFiscal + r.valorNaoFiscal);
  const somaPag = arredondar2(r.pagFiscalTotal + r.pagNaoFiscalTotal);
  assert.ok(
    Math.abs(somaProd - somaPag) <= EPS,
    `${r.nome}: Σ produtos (${somaProd}) ≠ Σ pagamentos (${somaPag})`
  );

  // XML fecha
  assert.ok(r.xmlFecha, `${r.nome}: XML NFC-e não fecha (vNF=${r.valorFiscal}, detPag=${r.xmlSoma})`);

  // Quantidades
  for (const item of r.itensFinais) {
    const qF = Number(item.quantidade_fiscal || 0);
    const qN = Number(item.quantidade_nao_fiscal || 0);
    const q = Number(item.quantidade || 0);
    assert.ok(qF >= -QTY_EPS, `${r.nome}: qFiscal negativa`);
    assert.ok(qN >= -QTY_EPS, `${r.nome}: qNaoFiscal negativa`);
    assert.ok(qF <= q + QTY_EPS, `${r.nome}: qFiscal > vendida`);
    assert.ok(qN <= q + QTY_EPS, `${r.nome}: qNaoFiscal > vendida`);
    assert.ok(Math.abs((qF + qN) - q) <= QTY_EPS, `${r.nome}: perda de estoque (qF+qNF≠q)`);
  }

  // Sem perda financeira nos pagamentos de entrada
  // (já coberto por Σ produtos = Σ pagamentos quando pagamentos cobrem a venda)
}

module.exports = {
  EPS,
  fo,
  itemInteiro,
  itemFracionavel,
  executarCenario,
  assertInvariantes,
  arredondar2,
  aplicarItensAjuste
};
