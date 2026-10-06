'use strict';

/**
 * PROD-UX-01 — busca local de produto e foco operacional.
 * Não consulta banco, não chama SEFAZ e não altera payload.
 */

const fs = require('fs');
const path = require('path');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const PRODUTOS = [
  { id: 1, codigo: '001', codigo_barras: '7891000000011', nome: 'SUNDAE', descricao: 'Copo tradicional', preco_venda: 11, saldo_fiscal: 0, ativo: 1 },
  { id: 2, codigo: '015', codigo_barras: '7891000000015', nome: 'SUNDAÉ CHOCOLATE', descricao: 'Calda', preco_venda: 12, saldo_fiscal: 4, ativo: 1 },
  { id: 15, codigo: '200', codigo_barras: '7891000000200', nome: 'AÇAÍ', descricao: 'Tigela frozen', preco_venda: 9, saldo_fiscal: 2, ativo: 1 }
];

function muitosSundaes() {
  return Array.from({ length: 12 }, (_, i) => ({
    id: 100 + i,
    codigo: String(100 + i),
    codigo_barras: `7891000001${String(i).padStart(3, '0')}`,
    nome: `SUNDAE ${i + 1}`,
    descricao: 'Linha teste',
    preco_venda: 10 + i,
    saldo_fiscal: i,
    ativo: 1
  }));
}

function montar(produtos = PRODUTOS) {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost/erp/',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const { window } = dom;
  window.localStorage.setItem('token', 'token-teste');
  window.API_URL = 'http://localhost/api';
  const chamadas = [];
  window.fetch = async (url) => {
    chamadas.push(String(url));
    const rota = String(url);
    const body = rota.includes('/produtos') ? produtos : [];
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => body };
  };
  window.eval(read('frontend/erp/js/nfe.js'));
  window.eval(read('frontend/erp/js/pedidos.js'));
  window.API_URL = 'http://localhost/api';
  window.document.body.innerHTML = window.opcHtmlEditor('pedNovo', { clientes: [{ id: 9, nome: 'MARIA' }], produtos });
  window.opcPrepararEditor('pedNovo', { clientes: [], produtos });
  return { window, chamadas, doc: window.document };
}

function linha(doc, indice = 0) {
  return doc.querySelectorAll('#pedNovoItens tr[data-opc-item]')[indice];
}

function barra(doc) {
  return doc.querySelector('[data-opc-busca-barra]');
}

function digitar(window, input, texto) {
  input.value = texto;
  input.dispatchEvent(new window.InputEvent('input', { bubbles: true }));
}

function tecla(window, el, key) {
  el.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

describe('PROD-UX-01 — busca local e foco', () => {
  let ctx;

  before(() => {
    ctx = montar();
  });

  after(() => {
    if (ctx) ctx.window.close();
  });

  it('1) produtos carregados uma vez; a busca não pede /api/produtos de novo', async () => {
    const fresco = montar();
    const antes = fresco.chamadas.length;
    await fresco.window.opcCarregarCadastros();
    const produtos = fresco.chamadas.filter((url) => url.includes('/produtos'));
    assert.equal(produtos.length, 1);
    digitar(fresco.window, barra(fresco.doc), 'sunda');
    assert.equal(fresco.chamadas.filter((url) => url.includes('/produtos')).length, 1);
    assert.equal(fresco.chamadas.length, antes + 2);
    fresco.window.close();
  });

  it('2) busca por nome', () => {
    digitar(ctx.window, barra(ctx.doc), 'sunda');
    const nomes = [...ctx.doc.querySelectorAll('[data-opc-busca-id] strong')].map((el) => el.textContent);
    assert.deepEqual(nomes, ['SUNDAE', 'SUNDAÉ CHOCOLATE']);
  });

  it('3) busca por código', () => {
    digitar(ctx.window, barra(ctx.doc), '015');
    assert.equal(ctx.doc.querySelector('[data-opc-busca-id]').getAttribute('data-opc-busca-id'), '2');
  });

  it('4) busca por código de barras', () => {
    digitar(ctx.window, barra(ctx.doc), '7891000000200');
    assert.equal(ctx.doc.querySelector('[data-opc-busca-id]').getAttribute('data-opc-busca-id'), '15');
  });

  it('5) busca por descrição', () => {
    digitar(ctx.window, barra(ctx.doc), 'tigela');
    assert.equal(ctx.doc.querySelector('[data-opc-busca-id] strong').textContent, 'AÇAÍ');
  });

  it('6) busca sem acento', () => {
    digitar(ctx.window, barra(ctx.doc), 'acai');
    assert.equal(ctx.doc.querySelector('[data-opc-busca-id] strong').textContent, 'AÇAÍ');
  });

  it('7) busca vazia fecha os resultados e o select interno continua completo', () => {
    digitar(ctx.window, barra(ctx.doc), 'sunda');
    digitar(ctx.window, barra(ctx.doc), '');
    const lista = ctx.doc.querySelector('[data-opc-busca-resultados]');
    assert.equal(lista.hidden, true);
    const tmp = ctx.doc.createElement('div');
    tmp.innerHTML = ctx.window.opcHtmlSelectProduto('pedNovo', PRODUTOS, '');
    assert.equal(tmp.querySelectorAll('option').length, PRODUTOS.length + 1);
  });

  it('8) nenhum resultado', () => {
    digitar(ctx.window, barra(ctx.doc), 'xyzxyz');
    const lista = ctx.doc.querySelector('[data-opc-busca-resultados]');
    assert.equal(lista.hidden, false);
    assert.equal(lista.querySelector('[data-opc-busca-id]'), null);
    assert.match(lista.textContent, /Nenhum produto encontrado/);
  });

  it('9–13) seleção insere o produto na grade, preenche o preço e devolve o foco à barra', () => {
    digitar(ctx.window, barra(ctx.doc), 'chocolate');
    const botao = ctx.doc.querySelector('[data-opc-busca-id]');
    botao.dispatchEvent(new ctx.window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    const atual = linha(ctx.doc, 0);
    assert.equal(atual.querySelector('[data-campo="produto"]').value, '2');
    assert.equal(atual.querySelector('[data-campo="preco"]').value, '12.00');
    assert.equal(ctx.doc.activeElement, barra(ctx.doc));
    assert.equal(ctx.doc.querySelector('[data-opc-busca-resultados]').hidden, true);
    assert.equal(ctx.doc.querySelectorAll('#pedNovoItens [data-opc-busca-input]').length, 0);
  });

  it('14) Enter na quantidade vai para o preço e não altera o produto', () => {
    const atual = linha(ctx.doc, 0);
    const qtd = atual.querySelector('[data-campo="quantidade"]');
    qtd.focus();
    qtd.value = '10';
    qtd.dispatchEvent(new ctx.window.InputEvent('input', { bubbles: true }));
    assert.equal(atual.querySelector('[data-campo="produto"]').value, '2');
    tecla(ctx.window, qtd, 'Enter');
    assert.equal(ctx.doc.activeElement, atual.querySelector('[data-campo="preco"]'));
    assert.equal(qtd.value, '10');
  });

  it('15–16) Enter no preço devolve o foco à barra, sem linha vazia e sem POST', () => {
    const antes = ctx.doc.querySelectorAll('#pedNovoItens tr[data-opc-item]').length;
    const preco = linha(ctx.doc, 0).querySelector('[data-campo="preco"]');
    preco.focus();
    preco.value = '11';
    tecla(ctx.window, preco, 'Enter');
    assert.equal(ctx.doc.querySelectorAll('#pedNovoItens tr[data-opc-item]').length, antes);
    assert.equal(ctx.doc.activeElement, barra(ctx.doc));
    assert.equal(ctx.chamadas.filter((url) => !url.startsWith('GET ') && url.includes('/pedidos')).length, 0);
  });

  it('17) Escape fecha os resultados', () => {
    const input = barra(ctx.doc);
    digitar(ctx.window, input, 'sunda');
    tecla(ctx.window, input, 'Escape');
    assert.equal(ctx.doc.querySelector('[data-opc-busca-resultados]').hidden, true);
  });

  it('18) setas navegam os resultados e Enter insere o ativo', () => {
    const input = barra(ctx.doc);
    digitar(ctx.window, input, 'sunda');
    tecla(ctx.window, input, 'ArrowDown');
    const itens = ctx.doc.querySelectorAll('[data-opc-busca-id]');
    assert.equal(itens[1].classList.contains('active'), true);
    tecla(ctx.window, input, 'ArrowUp');
    assert.equal(itens[0].classList.contains('active'), true);
    tecla(ctx.window, input, 'ArrowDown');
    tecla(ctx.window, input, 'Enter');
    const linhas = ctx.doc.querySelectorAll('#pedNovoItens tr[data-opc-item]');
    assert.equal(linhas[linhas.length - 1].querySelector('[data-campo="produto"]').value, '2');
    assert.equal(ctx.doc.activeElement, barra(ctx.doc));
  });

  it('19) select interno continua preenchendo o preço pela função existente', () => {
    ctx.window.opcAdicionarItem('pedNovo');
    const select = linha(ctx.doc, 2).querySelector('[data-campo="produto"]');
    select.value = '1';
    select.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
    assert.equal(linha(ctx.doc, 2).querySelector('[data-campo="preco"]').value, '11.00');
    assert.equal(ctx.doc.activeElement, barra(ctx.doc));
  });

  it('20) payload continua só com produto_id, quantidade e preco_unitario', () => {
    const dados = ctx.window.opcLerEditor('pedNovo');
    assert.deepEqual(Object.keys(dados).sort(), ['cliente_id', 'desconto', 'forma_pagamento', 'itens', 'parcelas']);
    dados.itens.forEach((item) => {
      assert.deepEqual(Object.keys(item).sort(), ['preco_unitario', 'produto_id', 'quantidade']);
    });
    const escolhido = dados.itens.find((item) => item.quantidade === 10);
    assert.equal(escolhido.produto_id, 2);
    assert.equal(escolhido.preco_unitario, 11);
  });

  it('limita a 10 resultados', () => {
    const extra = montar(muitosSundaes());
    digitar(extra.window, barra(extra.doc), 'sunda');
    assert.equal(extra.doc.querySelectorAll('[data-opc-busca-id]').length, 10);
    assert.match(extra.doc.querySelector('[data-opc-busca-resultados]').textContent, /Digite mais caracteres para refinar/);
    extra.window.close();
  });

  it('NF-e manual usa a mesma busca e o mesmo foco, sem campo novo no editor', () => {
    const dom = montar();
    dom.doc.body.innerHTML = `<div id="nfeManualEditor" data-opc-editor>${dom.window.opcHtmlBarraProduto()}
      <div id="nfeManualVazio"></div><div id="nfeManualGrade"><table><tbody id="nfeManualItens"></tbody></table></div>
      <input id="nfeManualDesconto" value="0"><select id="nfeManualForma"><option value="dinheiro">Dinheiro</option></select></div>`;
    dom.window.opcPrepararEditor('nfeManual', { produtos: PRODUTOS, clientes: [] });
    const input = barra(dom.doc);
    assert.ok(input);
    digitar(dom.window, input, '001');
    tecla(dom.window, input, 'Enter');
    assert.equal(dom.doc.querySelector('[data-campo="produto"]').value, '1');
    assert.equal(dom.doc.querySelector('[data-campo="preco"]').value, '11.00');
    assert.equal(dom.doc.activeElement, input);
    const dados = dom.window.opcLerEditor('nfeManual');
    assert.deepEqual(Object.keys(dados.itens[0]).sort(), ['preco_unitario', 'produto_id', 'quantidade']);
    dom.window.close();
  });
});
