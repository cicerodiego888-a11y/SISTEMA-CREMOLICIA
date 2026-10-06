'use strict';

/**
 * COM-UX-04 — impressão somente leitura de orçamento e pedido.
 * Usa o documento já carregado. Não grava, não recalcula preço e não emite.
 */

const fs = require('fs');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const ORCAMENTO = {
  id: 1,
  codigo: 'ORC-000001',
  status: 'RASCUNHO',
  created_at: '2026-10-05 18:40:00',
  cliente_nome: 'Cicero Diego',
  cliente_documento: '03859459309',
  cliente_telefone: '88996255866',
  cliente_rua: 'Rua das Flores',
  cliente_numero: '10',
  cliente_bairro: 'Centro',
  cliente_cidade: 'Juazeiro do Norte',
  cliente_uf: 'CE',
  total_itens: 66.5,
  desconto: 0,
  total: 66.5,
  forma_pagamento: 'pix',
  parcelas: null,
  observacoes: 'Entregar após as 14h',
  itens: [
    { produto_id: 42, produto_codigo: '42', produto_nome: 'AÇAÍ', produto_unidade: 'kg', quantidade: 1, preco_unitario: 55, subtotal: 55 },
    { produto_id: 40, produto_codigo: '40', produto_nome: 'SORVETE CASCÃO', produto_unidade: 'un', quantidade: 1, preco_unitario: 9, subtotal: 9 }
  ]
};

const PEDIDO = {
  id: 8,
  codigo: 'PED-000008',
  status: 'ABERTO',
  created_at: '2026-10-05 19:10:00',
  cliente_nome: 'Maria Silva',
  cliente_documento: '12345678900',
  cliente_telefone: '85999990000',
  cliente_cidade: 'Fortaleza',
  cliente_uf: 'CE',
  total_itens: 20,
  desconto: 2,
  total: 18,
  forma_pagamento: 'prazo',
  parcelas: 3,
  observacoes: '',
  venda_id: null,
  itens: [
    { produto_id: 7, produto_codigo: '07', produto_nome: 'ÁGUA', produto_unidade: 'un', quantidade: 2, preco_unitario: 10, subtotal: 20 }
  ]
};

function carregar() {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="page-content"></div></body></html>', {
    url: 'http://localhost/erp/',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const { window } = dom;
  window.API_URL = 'http://localhost/api';
  window.localStorage.setItem('token', 'token-teste');
  const chamadas = [];
  window.fetch = async (url, opts = {}) => {
    const metodo = String(opts.method || 'GET').toUpperCase();
    chamadas.push({ metodo, url: String(url) });
    const rota = String(url);
    let body = {};
    if (rota.includes('/orcamentos/')) body = ORCAMENTO;
    else if (rota.includes('/pedidos/')) body = PEDIDO;
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => body };
  };
  window.print = () => { window.__impressoes = (window.__impressoes || 0) + 1; };
  window.eval(read('frontend/erp/js/nfe.js'));
  window.eval(read('frontend/erp/js/pedidos.js'));
  window.API_URL = 'http://localhost/api';
  window.nfeNotificar = () => {};
  return { window, chamadas, doc: window.document };
}

describe('COM-UX-04 — impressão de orçamento e pedido', () => {
  it('1-2) a visualização do orçamento e do pedido tem o botão Imprimir', async () => {
    const ctx = carregar();
    await ctx.window.pedAbrirOrcamento(1);
    const orcamento = ctx.doc.getElementById('pedBtnImprimirOrcamento');
    assert.ok(orcamento);
    assert.match(orcamento.textContent, /Imprimir/);
    assert.match(ctx.doc.getElementById('modalPedOrcamento').textContent, /Aprovar e gerar pedido/);
    await ctx.window.pedAbrirPedido(8);
    const pedido = ctx.doc.getElementById('pedBtnImprimirPedido');
    assert.ok(pedido);
    assert.match(pedido.textContent, /Imprimir/);
    ctx.window.close();
  });

  it('3-15) a folha usa o snapshot salvo, sem preço de catálogo', () => {
    const ctx = carregar();
    const html = ctx.window.pedHtmlDocumentoImpresso('orcamento', ORCAMENTO);
    assert.match(html, /CDS Sistemas/);
    assert.match(html, /DOCUMENTO COMERCIAL/);
    assert.match(html, /ORÇAMENTO/);
    assert.match(html, /ORC-000001/);
    assert.match(html, /05\/10\/2026/);
    assert.match(html, /Rascunho/);
    assert.match(html, /Cicero Diego/);
    assert.match(html, /03859459309/);
    assert.match(html, /88996255866/);
    assert.match(html, /Rua das Flores, 10/);
    assert.match(html, /Juazeiro do Norte\/CE/);
    assert.match(html, /AÇAÍ/);
    assert.match(html, /SORVETE CASCÃO/);
    assert.match(html, /R\$ 55,00/);
    assert.match(html, /R\$ 9,00/);
    assert.match(html, /R\$ 66,50/);
    assert.match(html, /PIX/);
    assert.match(html, /Entregar após as 14h/);
    assert.doesNotMatch(html, /<input|<select|<button/i);
    assert.doesNotMatch(html, /999,00/);

    const pedido = ctx.window.pedHtmlDocumentoImpresso('pedido', PEDIDO);
    assert.match(pedido, /PEDIDO/);
    assert.match(pedido, /PED-000008/);
    assert.match(pedido, /Aberto/);
    assert.match(pedido, /Maria Silva/);
    assert.match(pedido, /ÁGUA/);
    assert.match(pedido, />2</);
    assert.match(pedido, /R\$ 10,00/);
    assert.match(pedido, /R\$ 20,00/);
    assert.match(pedido, /R\$ 2,00/);
    assert.match(pedido, /R\$ 18,00/);
    assert.match(pedido, /A prazo/);
    assert.match(pedido, /3x/);
    assert.doesNotMatch(pedido, /OBSERVAÇÕES/);
    ctx.window.close();
  });

  it('16-20) imprimir não faz POST e não altera status, venda, estoque ou financeiro', async () => {
    const ctx = carregar();
    await ctx.window.pedAbrirOrcamento(1);
    const antes = ctx.chamadas.length;
    const botao = ctx.doc.getElementById('pedBtnImprimirOrcamento');
    assert.equal(botao.getAttribute('onclick'), 'pedImprimirOrcamentoAberto()');
    ctx.window.pedImprimirOrcamentoAberto();
    assert.ok(ctx.window.__impressoes >= 1);
    assert.equal(ctx.chamadas.length, antes);
    assert.equal(ctx.chamadas.some((c) => c.metodo !== 'GET'), false);
    assert.equal(ORCAMENTO.status, 'RASCUNHO');
    assert.equal(ORCAMENTO.venda_id, undefined);
    const folha = ctx.doc.querySelector('[data-ped-impressao="orcamento"]');
    assert.ok(folha);
    assert.match(folha.textContent, /ORC-000001/);
    ctx.window.pedImprimirOrcamentoAberto();
    assert.equal(ctx.doc.querySelectorAll('[data-ped-impressao="orcamento"]').length, 1);
    assert.match(ctx.doc.querySelector('[data-ped-impressao="orcamento"]').textContent, /ORC-000001/);
    const fonte = `${ctx.window.pedAbrirImpressao}\n${ctx.window.pedHtmlDocumentoImpresso}\n${ctx.window.pedImprimirOrcamentoAberto}`;
    assert.doesNotMatch(fonte, /fetch|nfeRequest|estoque|financeiro|aprovar|faturar/i);
    const css = read('frontend/css/comercial-documento.css');
    assert.match(css, /@media print/);
    assert.match(css, /size:\s*A4/);
    assert.match(css, /table-header-group/);
    ctx.window.close();
  });
});
