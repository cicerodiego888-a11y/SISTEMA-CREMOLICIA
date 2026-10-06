'use strict';

/**
 * COM-UX-02.1 — barra única de produtos e grade.
 * Busca local, sem endpoint novo e sem alteração de payload.
 */

const fs = require('fs');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const PRODUTOS = [
  { id: 42, codigo: '42', codigo_barras: '7891000000042', nome: 'AÇAÍ', descricao: 'Tigela frozen', preco_venda: 55, saldo_fiscal: 4532, unidade: 'kg', ncm: '20079990', ativo: 1 },
  { id: 40, codigo: '40', codigo_barras: '7891000000040', nome: 'SORVETE CASCÃO', descricao: 'Casquinha crocante', preco_venda: 9, saldo_fiscal: 12, unidade: 'un', ncm: '21050010', ativo: 1 },
  { id: 51, codigo: '51', codigo_barras: '7891000000051', nome: 'AÇAÍ COM MORANGO', descricao: 'Tigela', preco_venda: 60, saldo_fiscal: 20, unidade: 'kg', ativo: 1 }
];
const CLIENTES = [{ id: 9, nome: 'MARIA SILVA', cpf_cnpj: '123.456.789-00' }];

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
    chamadas.push({ metodo: String(opts.method || 'GET').toUpperCase(), url: String(url) });
    const rota = String(url);
    const body = rota.includes('/produtos') ? PRODUTOS : rota.includes('/clientes') ? CLIENTES : [];
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => body };
  };
  window.eval(read('frontend/erp/js/nfe.js'));
  window.eval(read('frontend/erp/js/pedidos.js'));
  window.API_URL = 'http://localhost/api';
  window.document.getElementById('page-content').innerHTML = window.pedHtmlDocumento(tipo, { clientes: CLIENTES, produtos: PRODUTOS });
  window.opcPrepararEditor('pedNovo', { clientes: CLIENTES, produtos: PRODUTOS });
  return { window, chamadas, doc: window.document };
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

function inserir(ctx, texto) {
  const campo = barra(ctx.doc);
  campo.focus();
  digitar(ctx.window, campo, texto);
  tecla(ctx.window, campo, 'Enter');
}

describe('COM-UX-02.1 — barra única de produtos', () => {
  it('1–2) uma única barra e nenhuma busca dentro das linhas', () => {
    for (const tipo of ['orcamento', 'pedido']) {
      const ctx = montar(tipo);
      assert.equal(ctx.doc.querySelectorAll('[data-opc-busca-barra]').length, 1);
      assert.equal(ctx.doc.querySelectorAll('#pedNovoItens [data-opc-busca-input]').length, 0);
      assert.equal(ctx.doc.querySelectorAll('#pedNovoItens select.form-select').length, 0);
      inserir(ctx, 'acai');
      assert.equal(ctx.doc.querySelectorAll('[data-opc-busca-barra]').length, 1);
      assert.equal(ctx.doc.querySelectorAll('#pedNovoItens [data-opc-busca-input]').length, 0);
      assert.ok(ctx.doc.querySelector('#pedNovoItens [data-campo="produto"].opc-produto-oculto'));
      ctx.window.close();
    }
  });

  it('3) busca por nome', () => {
    const ctx = montar();
    digitar(ctx.window, barra(ctx.doc), 'morango');
    assert.equal(ctx.doc.querySelector('[data-opc-busca-id] strong').textContent, 'AÇAÍ COM MORANGO');
    ctx.window.close();
  });

  it('4) busca por código', () => {
    const ctx = montar();
    digitar(ctx.window, barra(ctx.doc), '42');
    assert.equal(ctx.doc.querySelector('[data-opc-busca-id]').getAttribute('data-opc-busca-id'), '42');
    ctx.window.close();
  });

  it('5) busca por código de barras', () => {
    const ctx = montar();
    digitar(ctx.window, barra(ctx.doc), '7891000000040');
    assert.equal(ctx.doc.querySelector('[data-opc-busca-id]').getAttribute('data-opc-busca-id'), '40');
    ctx.window.close();
  });

  it('6) busca por descrição', () => {
    const ctx = montar();
    digitar(ctx.window, barra(ctx.doc), 'casquinha');
    assert.equal(ctx.doc.querySelector('[data-opc-busca-id] strong').textContent, 'SORVETE CASCÃO');
    ctx.window.close();
  });

  it('7) normalização de acentos e espaços', () => {
    const ctx = montar();
    digitar(ctx.window, barra(ctx.doc), 'acai');
    const nomes = [...ctx.doc.querySelectorAll('[data-opc-busca-id] strong')].map((el) => el.textContent);
    assert.deepEqual(nomes, ['AÇAÍ', 'AÇAÍ COM MORANGO']);
    digitar(ctx.window, barra(ctx.doc), 'sorvete  cascao');
    assert.equal(ctx.doc.querySelector('[data-opc-busca-id] strong').textContent, 'SORVETE CASCÃO');
    ctx.window.close();
  });

  it('8) Enter seleciona e insere o produto', () => {
    const ctx = montar();
    inserir(ctx, '42');
    const linha = ctx.doc.querySelector('#pedNovoItens tr[data-opc-item]');
    assert.equal(linha.querySelector('[data-campo="produto"]').value, '42');
    assert.equal(linha.querySelector('[data-ped-campo="nome"]').textContent, 'AÇAÍ');
    ctx.window.close();
  });

  it('9–11) ArrowDown, ArrowUp e Escape', () => {
    const ctx = montar();
    const campo = barra(ctx.doc);
    digitar(ctx.window, campo, 'acai');
    tecla(ctx.window, campo, 'ArrowDown');
    const itens = ctx.doc.querySelectorAll('[data-opc-busca-id]');
    assert.equal(itens[1].classList.contains('active'), true);
    tecla(ctx.window, campo, 'ArrowUp');
    assert.equal(itens[0].classList.contains('active'), true);
    tecla(ctx.window, campo, 'Escape');
    assert.equal(ctx.doc.querySelector('[data-opc-busca-resultados]').hidden, true);
    assert.equal(ctx.doc.querySelectorAll('#pedNovoItens tr[data-opc-item]').length, 0);
    ctx.window.close();
  });

  it('12–13) o produto entra na grade e o foco volta para a barra', () => {
    const ctx = montar();
    inserir(ctx, 'aca');
    inserir(ctx, 'sor');
    const linhas = ctx.doc.querySelectorAll('#pedNovoItens tr[data-opc-item]');
    assert.equal(linhas.length, 2);
    assert.equal(linhas[0].querySelector('[data-ped-campo="nome"]').textContent, 'AÇAÍ');
    assert.equal(linhas[1].querySelector('[data-ped-campo="nome"]').textContent, 'SORVETE CASCÃO');
    assert.equal(ctx.doc.activeElement, barra(ctx.doc));
    assert.equal(barra(ctx.doc).value, '');
    ctx.window.close();
  });

  it('14–16) quantidade e preço continuam editáveis e o subtotal segue o recálculo existente', () => {
    const ctx = montar();
    inserir(ctx, '42');
    const linha = ctx.doc.querySelector('#pedNovoItens tr[data-opc-item]');
    const qtd = linha.querySelector('[data-campo="quantidade"]');
    const preco = linha.querySelector('[data-campo="preco"]');
    assert.equal(preco.value, '55.00');
    qtd.value = '2';
    qtd.dispatchEvent(new ctx.window.InputEvent('input', { bubbles: true }));
    assert.equal(linha.querySelector('[data-campo="subtotal"]').textContent, 'R$ 110,00');
    preco.value = '10';
    preco.dispatchEvent(new ctx.window.InputEvent('input', { bubbles: true }));
    assert.equal(linha.querySelector('[data-campo="subtotal"]').textContent, 'R$ 20,00');
    assert.equal(linha.querySelector('[data-campo="subtotal"]').querySelector('input'), null);
    ctx.window.close();
  });

  it('17–19) remover item, contador e estado vazio', () => {
    const ctx = montar();
    assert.match(ctx.doc.getElementById('pedNovoVazio').textContent, /Nenhum produto adicionado/);
    assert.equal(ctx.doc.getElementById('pedNovoGrade').hidden, true);
    assert.equal(ctx.doc.getElementById('pedNovoContador').textContent, '0 itens');
    inserir(ctx, '42');
    inserir(ctx, '40');
    assert.equal(ctx.doc.getElementById('pedNovoContador').textContent, '2 itens');
    assert.equal(ctx.doc.getElementById('pedNovoVazio').hidden, true);
    const linhas = ctx.doc.querySelectorAll('#pedNovoItens tr[data-opc-item]');
    ctx.window.opcRemoverItem(linhas[0].querySelector('button'), 'pedNovo');
    assert.equal(ctx.doc.querySelectorAll('#pedNovoItens tr[data-opc-item]').length, 1);
    assert.equal(ctx.doc.getElementById('pedNovoContador').textContent, '1 item');
    ctx.window.opcRemoverItem(ctx.doc.querySelector('#pedNovoItens button'), 'pedNovo');
    assert.equal(ctx.doc.querySelectorAll('#pedNovoItens tr[data-opc-item]').length, 0);
    assert.equal(ctx.doc.getElementById('pedNovoVazio').hidden, false);
    assert.equal(ctx.doc.getElementById('pedNovoContador').textContent, '0 itens');
    ctx.window.close();
  });

  it('20–21) a busca não faz GET nem POST', () => {
    const ctx = montar();
    const gets = ctx.chamadas.filter((c) => c.url.includes('/produtos')).length;
    const posts = ctx.chamadas.filter((c) => c.metodo === 'POST').length;
    digitar(ctx.window, barra(ctx.doc), 'acai');
    tecla(ctx.window, barra(ctx.doc), 'ArrowDown');
    inserir(ctx, 'sor');
    assert.equal(ctx.chamadas.filter((c) => c.url.includes('/produtos')).length, gets);
    assert.equal(ctx.chamadas.filter((c) => c.metodo === 'POST').length, posts);
    ctx.window.close();
  });

  it('22) payload permanece compatível e produto repetido não soma quantidade', () => {
    const ctx = montar();
    ctx.doc.getElementById('pedNovoCliente').value = '9';
    inserir(ctx, '42');
    inserir(ctx, '42');
    const dados = ctx.window.opcLerEditor('pedNovo');
    assert.deepEqual(Object.keys(dados).sort(), ['cliente_id', 'desconto', 'forma_pagamento', 'itens', 'parcelas']);
    assert.equal(dados.itens.length, 2);
    dados.itens.forEach((item) => {
      assert.deepEqual(Object.keys(item).sort(), ['preco_unitario', 'produto_id', 'quantidade']);
      assert.equal(item.produto_id, 42);
      assert.equal(item.quantidade, 1);
    });
    ctx.window.close();
  });

  it('o botão adicionar produto só foca a barra', () => {
    const ctx = montar();
    ctx.window.opcPrepararNovaInclusao('pedNovo');
    assert.equal(ctx.doc.querySelectorAll('#pedNovoItens tr[data-opc-item]').length, 0);
    assert.equal(ctx.doc.activeElement, barra(ctx.doc));
    ctx.window.close();
  });

  it('clique fora fecha os resultados', () => {
    const ctx = montar();
    digitar(ctx.window, barra(ctx.doc), 'acai');
    assert.equal(ctx.doc.querySelector('[data-opc-busca-resultados]').hidden, false);
    ctx.doc.body.dispatchEvent(new ctx.window.MouseEvent('mousedown', { bubbles: true }));
    assert.equal(ctx.doc.querySelector('[data-opc-busca-resultados]').hidden, true);
    ctx.window.close();
  });

  it('NF-e manual usa a mesma barra, sem busca na linha e sem mudar o payload do editor', () => {
    const ctx = montar();
    ctx.doc.body.innerHTML = ctx.window.nfeHtmlDocumentoManual({ ambiente: '2' }, { clientes: CLIENTES, produtos: PRODUTOS });
    ctx.window.opcPrepararEditor('nfeManual', { clientes: CLIENTES, produtos: PRODUTOS });
    assert.equal(ctx.doc.querySelectorAll('#nfeManualEditor [data-opc-busca-barra]').length, 1);
    assert.equal(ctx.doc.querySelectorAll('#nfeManualItens tr').length, 0);
    assert.match(ctx.doc.getElementById('nfeManualVazio').textContent, /Nenhum produto adicionado/);
    inserir(ctx, 'aca');
    assert.equal(ctx.doc.activeElement, barra(ctx.doc));
    inserir(ctx, 'sor');
    const linhas = ctx.doc.querySelectorAll('#nfeManualItens tr[data-opc-item]');
    assert.equal(linhas.length, 2);
    assert.equal(ctx.doc.querySelectorAll('#nfeManualItens [data-opc-busca-input]').length, 0);
    assert.equal(linhas[0].querySelector('[data-campo="produto"]').value, '42');
    assert.equal(linhas[0].querySelector('[data-campo="preco"]').value, '55.00');
    assert.equal(linhas[0].querySelector('[data-nfe-codigo]').textContent, '42');
    assert.equal(linhas[1].querySelector('[data-ped-campo="nome"], [data-nfe-nome]').textContent, 'SORVETE CASCÃO');
    assert.equal(ctx.doc.activeElement, barra(ctx.doc));
    const dados = ctx.window.opcLerEditor('nfeManual');
    assert.deepEqual(Object.keys(dados.itens[0]).sort(), ['preco_unitario', 'produto_id', 'quantidade']);
    assert.equal(ctx.chamadas.filter((c) => c.metodo === 'POST').length, 0);
    ctx.window.nfeManualAdicionarProduto();
    assert.equal(ctx.doc.querySelectorAll('#nfeManualItens tr').length, 2);
    assert.equal(ctx.doc.activeElement, barra(ctx.doc));
    ctx.window.close();
  });
});
