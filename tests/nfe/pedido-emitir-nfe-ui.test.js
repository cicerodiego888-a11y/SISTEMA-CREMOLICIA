/**
 * Botão Emitir NF-e no detalhe do pedido.
 * Só interface: fetch simulado, nenhum banco e nenhuma transmissão.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM, VirtualConsole } = require('jsdom');

const raiz = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(raiz, rel), 'utf8');
const SCRIPTS = [
  'frontend/vendor/jquery/jquery.min.js',
  'frontend/shared/js/validarMotivo.js',
  'frontend/shared/js/access-control.js',
  'frontend/shared/js/core.js',
  'frontend/shared/js/vendasHistoricoUi.js',
  'frontend/shared/js/fiscalImpressao.js',
  'frontend/erp/js/nfe.js',
  'frontend/erp/js/pedidos.js',
  'frontend/erp/js/vendas.js',
  'frontend/erp/js/fiscal.js'
];

const janelas = [];
const DIAG_PRONTA = { success: true, pronta: true, itens: [], pendencias: [], chamadasSefaz: 0 };
const CLIENTE = {
  id: 9, nome: 'CICERO', cpf_cnpj: '529.982.247-25',
  rua: 'RUA A', numero: '10', bairro: 'CENTRO', cidade: 'CRATO', uf: 'CE', cep: '63100000'
};
const PRODUTO_CATALOGO = { id: 3, nome: 'AÇAÍ', preco_venda: 60, ativo: 1 };

function pedidoApto(extra = {}) {
  return {
    id: 2,
    codigo: 'PED-000002',
    origem: 'DIRETO',
    status: 'ABERTO',
    cliente_id: 9,
    cliente_nome: 'CICERO',
    cliente_documento: CLIENTE.cpf_cnpj,
    cliente_rua: CLIENTE.rua,
    cliente_numero: CLIENTE.numero,
    cliente_bairro: CLIENTE.bairro,
    cliente_cidade: CLIENTE.cidade,
    cliente_uf: CLIENTE.uf,
    cliente_cep: CLIENTE.cep,
    desconto: 5,
    total_itens: 110,
    total: 105,
    forma_pagamento: 'dinheiro',
    itens: [{ produto_id: 3, produto_nome: 'AÇAÍ', quantidade: 2, preco_unitario: 55, subtotal: 110 }],
    nfe: { pode_emitir: true, acao: 'emitir_pedido', motivo_bloqueio: null, nota: null },
    nfe_relacionadas: [],
    ...extra
  };
}

function criarJanela() {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body><div id="page-content"></div><div id="modal-container"></div></body></html>',
    { url: 'http://localhost/erp/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole() }
  );
  const { window } = dom;
  janelas.push(window);
  window.localStorage.setItem('token', 'token-teste');
  window.localStorage.setItem('user', JSON.stringify({ role: 'admin', perfil: 'ADMIN' }));
  class ModalStub {
    constructor(el) { this.el = el; el.__modal = this; }
    static getInstance(el) { return el.__modal || null; }
    static getOrCreateInstance(el) { return el.__modal || new ModalStub(el); }
    show() { this.el.classList.add('show'); }
    hide() { this.el.classList.remove('show'); }
  }
  window.bootstrap = { Modal: ModalStub };
  for (const rel of SCRIPTS) window.eval(read(rel));
  window.CONFIG_IMPLANTACAO = { recursos: { fiscal: true, nfe: true } };
  window.eval('CONFIG_IMPLANTACAO = window.CONFIG_IMPLANTACAO;');
  window.showNotification = () => {};
  window.confirm = () => true;
  const chamadas = [];
  const rotas = {};
  let duranteProntidao = null;
  window.fetch = async (url, opts = {}) => {
    const u = new URL(url, 'http://localhost');
    const metodo = String(opts.method || 'GET').toUpperCase();
    const rota = `${metodo} ${u.pathname}`;
    chamadas.push({ rota, body: opts.body ? JSON.parse(opts.body) : undefined });
    if (rota === 'GET /api/nfe/prontidao' && duranteProntidao) duranteProntidao(window);
    const r = rotas[rota];
    const status = r ? (r.status || 200) : 404;
    const texto = JSON.stringify(r ? r.body : { success: false });
    return { ok: status < 300, status, headers: { get: () => null }, json: async () => JSON.parse(texto), text: async () => texto };
  };
  rotas['GET /api/nfe/prontidao'] = { body: DIAG_PRONTA };
  rotas['GET /api/clientes'] = { body: [CLIENTE] };
  rotas['GET /api/produtos'] = { body: [PRODUTO_CATALOGO] };
  return {
    window,
    rotas,
    chamadas,
    posts: () => chamadas.filter((c) => c.rota.startsWith('POST ')),
    aoBuscarProntidao: (fn) => { duranteProntidao = fn; }
  };
}

describe('pedido → Emitir NF-e abre a Nova NF-e', () => {
  after(() => {
    for (const w of janelas.splice(0)) w.close();
  });

  it('1/2) detalhe do pedido tem Emitir NF-e; orçamento não tem', async () => {
    const ctx = criarJanela();
    ctx.rotas['GET /api/pedidos/2'] = { body: pedidoApto() };
    ctx.rotas['GET /api/orcamentos/3'] = {
      body: { id: 3, codigo: 'ORC-000003', status: 'RASCUNHO', cliente_nome: 'CICERO', itens: [], total_itens: 0, desconto: 0, total: 0 }
    };
    await ctx.window.pedAbrirPedido(2);
    const doc = ctx.window.document;
    const acoes = doc.getElementById('pedAcoesPedido');
    assert.ok(acoes);
    assert.match(acoes.textContent, /Imprimir/);
    assert.match(acoes.textContent, /Emitir NF-e/);
    assert.match(acoes.textContent, /Cancelar pedido/);
    assert.match(doc.getElementById('modalPedPedido').textContent, /Fechar/);
    assert.equal(doc.getElementById('pedBtnEmitirNfe').disabled, false);

    await ctx.window.pedAbrirOrcamento(3);
    assert.doesNotMatch(doc.getElementById('modalPedOrcamento').textContent, /Emitir NF-e/);
    assert.equal(doc.getElementById('modalPedOrcamento').querySelector('#pedBtnEmitirNfe'), null);
  });

  it('3/4) pedido apto habilita o botão; inelegível mostra o motivo sem esconder o botão', async () => {
    const ctx = criarJanela();
    ctx.rotas['GET /api/pedidos/2'] = { body: pedidoApto() };
    await ctx.window.pedAbrirPedido(2);
    assert.equal(ctx.window.document.getElementById('pedBtnEmitirNfe').disabled, false);
    assert.equal(ctx.window.document.getElementById('pedNfeMotivo'), null);

    ctx.rotas['GET /api/pedidos/2'] = {
      body: pedidoApto({
        nfe: { pode_emitir: false, acao: 'nenhuma', motivo_bloqueio: 'estoque fiscal insuficiente para SORVETE CASCÃO.', nota: null }
      })
    };
    await ctx.window.pedAbrirPedido(2);
    const botao = ctx.window.document.getElementById('pedBtnEmitirNfe');
    assert.ok(botao, 'o botão continua visível');
    assert.equal(botao.disabled, true);
    assert.match(ctx.window.document.getElementById('pedNfeMotivo').textContent, /SORVETE CASCÃO/);
  });

  it('5–13) o clique prepara a Nova NF-e com origem, cliente, itens e preço gravado, sem transmitir', async () => {
    const ctx = criarJanela();
    ctx.rotas['GET /api/pedidos/2'] = { body: pedidoApto() };
    ctx.aoBuscarProntidao((window) => {
      const botao = window.document.getElementById('pedBtnEmitirNfe');
      assert.equal(botao.disabled, true);
      assert.equal(botao.textContent, 'Preparando NF-e...');
    });
    await ctx.window.pedAbrirPedido(2);
    await ctx.window.pedEmitirNfe(2);
    const doc = ctx.window.document;
    assert.ok(doc.getElementById('nfeNovaPainel'));
    assert.equal(doc.getElementById('modalEmitirNfe').dataset.contexto, 'pedidos');
    const origem = doc.getElementById('nfeOrigemComercial');
    assert.match(origem.textContent, /FATURAMENTO/);
    assert.match(origem.textContent, /Pedido de origem:\s*PED-000002/);
    assert.doesNotMatch(origem.textContent, /NF_AVULSA/);
    assert.equal(doc.getElementById('nfeManualCliente').value, '9');
    assert.match(doc.getElementById('nfeManualFichaNome').textContent, /CICERO/);
    const linha = doc.querySelector('#nfeManualItens tr[data-opc-item]');
    assert.equal(linha.dataset.pedidoId, '2');
    assert.equal(linha.querySelector('[data-campo="produto"]').value, '3');
    assert.equal(linha.querySelector('[data-campo="quantidade"]').value, '2');
    assert.equal(linha.querySelector('[data-campo="preco"]').value, '55');
    assert.match(doc.getElementById('nfeManualTotal').textContent, /105,00/);
    assert.deepEqual(ctx.posts(), []);
    assert.ok(ctx.chamadas.every((c) => c.rota.startsWith('GET ')));

    ctx.window.confirmarNfeManual();
    assert.equal(doc.getElementById('modalEmitirNfe').dataset.contexto, 'pedidos');
    assert.deepEqual(ctx.posts(), [], 'continuar para a conferência não transmite');
  });

  it('14) pedido já faturado com NF-e autorizada mostra Ver NF-e', async () => {
    const ctx = criarJanela();
    ctx.rotas['GET /api/pedidos/2'] = {
      body: pedidoApto({
        status: 'FATURADO',
        venda_id: 40,
        nfe: { pode_emitir: false, acao: 'nenhuma', nota: { id: 15, numero: 8, status: 'autorizada' } },
        nfe_relacionadas: [{ id: 15, numero: 8, status: 'autorizada' }]
      })
    };
    await ctx.window.pedAbrirPedido(2);
    const doc = ctx.window.document;
    assert.ok(doc.getElementById('pedBtnVerNfe'));
    assert.match(doc.getElementById('pedBtnVerNfe').textContent, /Ver NF-e/);
    assert.equal(doc.getElementById('pedBtnEmitirNfe'), null);
  });

  it('15) duplo clique não prepara a NF-e duas vezes', async () => {
    const ctx = criarJanela();
    ctx.rotas['GET /api/pedidos/2'] = { body: pedidoApto() };
    await ctx.window.pedAbrirPedido(2);
    const antes = ctx.chamadas.length;
    await Promise.all([ctx.window.pedEmitirNfe(2), ctx.window.pedEmitirNfe(2)]);
    const novas = ctx.chamadas.slice(antes);
    assert.equal(novas.filter((c) => c.rota === 'GET /api/pedidos/2').length, 1);
    assert.equal(novas.filter((c) => c.rota === 'GET /api/nfe/prontidao').length, 2, 'uma preparação consulta a prontidão e abre a Nova NF-e');
    assert.equal(ctx.window.document.querySelectorAll('#nfeManualItens tr[data-opc-item]').length, 1);
    assert.deepEqual(ctx.posts(), []);
  });
});
