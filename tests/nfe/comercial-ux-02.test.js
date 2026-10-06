'use strict';

/**
 * COM-UX-02 — documento comercial de orçamento e pedido direto.
 * Não consulta banco e não altera payload.
 */

const fs = require('fs');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const PRODUTOS = [
  { id: 1, codigo: '001', codigo_barras: '7891000000011', nome: 'SUNDAE', descricao: 'Copo tradicional', preco_venda: 11, saldo_fiscal: 0, unidade: 'UN', ncm: '21050010', ativo: 1 },
  { id: 15, codigo: '200', nome: 'AÇAÍ', descricao: 'Tigela frozen', preco_venda: 9, saldo_fiscal: 2, unidade: 'UN', ativo: 1 }
];
const CLIENTES = [
  { id: 9, nome: 'MARIA SILVA', cpf_cnpj: '123.456.789-00', telefone: '11999990000', cidade: 'São Paulo', tipo_comercial_descricao: 'Varejo' }
];

function montar(tipo = 'pedido') {
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
    chamadas.push({ metodo, url: String(url), body: opts.body ? JSON.parse(opts.body) : undefined });
    const rota = String(url);
    let body = [];
    if (rota.includes('/produtos')) body = PRODUTOS;
    else if (rota.includes('/clientes')) body = CLIENTES;
    else body = { id: 4, codigo: tipo === 'orcamento' ? 'ORC-1' : 'PED-1' };
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => body };
  };
  window.eval(read('frontend/erp/js/nfe.js'));
  window.eval(read('frontend/erp/js/pedidos.js'));
  window.API_URL = 'http://localhost/api';
  window.nfeNotificar = () => {};
  window.pedAbrirOrcamento = () => {};
  window.pedAbrirPedido = () => {};
  window.document.getElementById('page-content').innerHTML = window.pedHtmlDocumento(tipo, { clientes: CLIENTES, produtos: PRODUTOS });
  window.opcPrepararEditor('pedNovo', { clientes: CLIENTES, produtos: PRODUTOS });
  return { window, chamadas, doc: window.document };
}

function linha(doc) {
  return doc.querySelector('#pedNovoItens tr[data-opc-item]');
}

function digitar(window, input, texto) {
  input.value = texto;
  input.dispatchEvent(new window.InputEvent('input', { bubbles: true }));
}

function tecla(window, el, key) {
  el.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

describe('COM-UX-02 — documento comercial', () => {
  it('1) novo orçamento renderiza o documento, sem modal', () => {
    const ctx = montar('orcamento');
    const html = ctx.doc.getElementById('pedNovoEditor').textContent;
    assert.match(html, /ORÇAMENTO/);
    assert.match(html, /Novo orçamento/);
    assert.match(html, /Documento comercial/);
    assert.equal(ctx.doc.getElementById('modalPedNovo'), null);
    assert.equal(ctx.doc.querySelector('.ped-doc-rodape').textContent.includes('Salvar orçamento'), true);
    ctx.window.close();
  });

  it('2) novo pedido renderiza o documento', () => {
    const ctx = montar('pedido');
    const html = ctx.doc.getElementById('pedNovoEditor').textContent;
    assert.match(html, /PEDIDO/);
    assert.match(html, /Novo pedido direto/);
    assert.match(html, /Documento comercial de venda/);
    assert.match(html, /Resumo do pedido/);
    assert.match(html, /Total do pedido/);
    assert.equal(ctx.doc.querySelector('.ped-doc-rodape').textContent.includes('Salvar pedido'), true);
    ctx.window.close();
  });

  it('3) cliente selecionado continua no select e aparece na ficha', () => {
    const ctx = montar();
    const select = ctx.doc.getElementById('pedNovoCliente');
    select.value = '9';
    select.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
    assert.equal(ctx.window.opcLerEditor('pedNovo').cliente_id, 9);
    assert.equal(ctx.doc.getElementById('pedNovoClienteFicha').hidden, false);
    assert.match(ctx.doc.getElementById('pedNovoClienteNome').textContent, /MARIA SILVA/);
    assert.match(ctx.doc.getElementById('pedNovoClienteTelefone').textContent, /11999990000/);
    ctx.window.close();
  });

  it('4–8) produto selecionado preenche preço, código e devolve o foco à barra', () => {
    const ctx = montar();
    ctx.window.opcAdicionarItem('pedNovo');
    const select = linha(ctx.doc).querySelector('[data-campo="produto"]');
    select.value = '1';
    select.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
    assert.equal(linha(ctx.doc).querySelector('[data-campo="preco"]').value, '11.00');
    assert.equal(linha(ctx.doc).querySelector('[data-ped-campo="codigo"]').textContent, '001');
    assert.equal(linha(ctx.doc).querySelector('[data-ped-campo="unidade"]').textContent, 'UN');
    assert.equal(ctx.doc.activeElement, ctx.doc.querySelector('[data-opc-busca-barra]'));
    ctx.window.close();
  });

  it('5) busca por nome', () => {
    const ctx = montar();
    digitar(ctx.window, ctx.doc.querySelector('[data-opc-busca-barra]'), 'sunda');
    assert.equal(ctx.doc.querySelector('[data-opc-busca-id] strong').textContent, 'SUNDAE');
    ctx.window.close();
  });

  it('6) busca por código', () => {
    const ctx = montar();
    digitar(ctx.window, ctx.doc.querySelector('[data-opc-busca-barra]'), '001');
    assert.equal(ctx.doc.querySelector('[data-opc-busca-id]').getAttribute('data-opc-busca-id'), '1');
    ctx.window.close();
  });

  it('7) busca por descrição', () => {
    const ctx = montar();
    digitar(ctx.window, ctx.doc.querySelector('[data-opc-busca-barra]'), 'tigela');
    assert.equal(ctx.doc.querySelector('[data-opc-busca-id] strong').textContent, 'AÇAÍ');
    ctx.window.close();
  });

  it('9–11) Enter na quantidade vai ao preço; Enter no preço volta à barra', () => {
    const ctx = montar();
    ctx.window.opcAdicionarItem('pedNovo');
    const atual = linha(ctx.doc);
    const qtd = atual.querySelector('[data-campo="quantidade"]');
    qtd.focus();
    tecla(ctx.window, qtd, 'Enter');
    assert.equal(ctx.doc.activeElement, atual.querySelector('[data-campo="preco"]'));
    tecla(ctx.window, atual.querySelector('[data-campo="preco"]'), 'Enter');
    assert.equal(ctx.doc.querySelectorAll('#pedNovoItens tr[data-opc-item]').length, 1);
    assert.equal(ctx.doc.activeElement, ctx.doc.querySelector('[data-opc-busca-barra]'));
    ctx.window.close();
  });

  it('12–15) subtotal, total, desconto e forma de pagamento', () => {
    const ctx = montar();
    ctx.window.opcAdicionarItem('pedNovo');
    const tr = linha(ctx.doc);
    tr.querySelector('[data-campo="produto"]').value = '1';
    tr.querySelector('[data-campo="quantidade"]').value = '10';
    tr.querySelector('[data-campo="preco"]').value = '11';
    ctx.doc.getElementById('pedNovoDesconto').value = '3';
    ctx.doc.getElementById('pedNovoForma').value = 'pix';
    ctx.window.opcRecalcular('pedNovo');
    assert.equal(tr.querySelector('[data-campo="subtotal"]').textContent, 'R$ 110,00');
    assert.equal(ctx.doc.getElementById('pedNovoResumoProdutos').textContent, 'R$ 110,00');
    assert.equal(ctx.doc.getElementById('pedNovoResumoDesconto').textContent, 'R$ 3,00');
    assert.equal(ctx.doc.getElementById('pedNovoTotal').textContent, 'R$ 107,00');
    const dados = ctx.window.opcLerEditor('pedNovo');
    assert.equal(dados.desconto, 3);
    assert.equal(dados.forma_pagamento, 'pix');
    assert.deepEqual(Object.keys(dados.itens[0]).sort(), ['preco_unitario', 'produto_id', 'quantidade']);
    ctx.window.close();
  });

  it('16–17) salvar orçamento e pedido usam os POST existentes', async () => {
    for (const tipo of ['orcamento', 'pedido']) {
      const ctx = montar(tipo);
      ctx.doc.getElementById('pedNovoCliente').value = '9';
      ctx.window.opcAdicionarItem('pedNovo');
      const tr = linha(ctx.doc);
      tr.querySelector('[data-campo="produto"]').value = '1';
      tr.querySelector('[data-campo="quantidade"]').value = '2';
      tr.querySelector('[data-campo="preco"]').value = '11';
      const antes = ctx.chamadas.length;
      await ctx.window.pedSalvarNovoDocumento(tipo);
      const post = ctx.chamadas.slice(antes).find((c) => c.metodo === 'POST');
      assert.ok(post);
      assert.match(post.url, tipo === 'orcamento' ? /\/orcamentos$/ : /\/pedidos$/);
      assert.deepEqual(Object.keys(post.body).sort(), ['cliente_id', 'desconto', 'forma_pagamento', 'itens', 'parcelas']);
      assert.equal(post.body.itens[0].produto_id, 1);
      ctx.window.close();
    }
  });

  it('18) cancelar volta à lista sem POST', async () => {
    const ctx = montar();
    const antes = ctx.chamadas.filter((c) => c.metodo === 'POST').length;
    await ctx.window.pedCancelarNovoDocumento();
    assert.equal(ctx.chamadas.filter((c) => c.metodo === 'POST').length, antes);
    assert.ok(ctx.doc.getElementById('pedTabelaPedidos'));
    ctx.window.close();
  });

  it('19) abrir o documento não faz POST', async () => {
    const ctx = montar();
    ctx.chamadas.length = 0;
    await ctx.window.pedAbrirNovoDocumento('orcamento');
    assert.equal(ctx.chamadas.filter((c) => c.metodo === 'POST').length, 0);
    assert.equal(ctx.chamadas.filter((c) => c.url.includes('/produtos')).length, 1);
    ctx.window.close();
  });

  it('20) selecionar produto não faz POST', () => {
    const ctx = montar();
    const antes = ctx.chamadas.filter((c) => c.metodo === 'POST').length;
    ctx.window.opcAdicionarItem('pedNovo');
    const select = linha(ctx.doc).querySelector('[data-campo="produto"]');
    select.value = '15';
    select.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
    assert.equal(ctx.chamadas.filter((c) => c.metodo === 'POST').length, antes);
    assert.equal(linha(ctx.doc).querySelector('[data-campo="preco"]').value, '9.00');
    ctx.window.close();
  });
});
