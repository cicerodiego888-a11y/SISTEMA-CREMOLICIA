/**
 * LINHA DE PRODUTOS 07 — Unidade de cada produto validada antes de a Linha ir ao carrinho (PDV Desktop e Mobile).
 * A quantidade da Linha continua aceitando fração (25,5); cada produto é validado pela regra que o PDV normal
 * já usa: quem é vendido por unidade exige quantidade inteira, quem é fracionado aceita fração.
 * Com um único produto inválido nada entra no carrinho e a distribuição continua na tela para correção.
 * Executar: npm run test:pdv-venda-linha-unidade
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const TMP = path.resolve(os.tmpdir()).toLowerCase();
if (!process.env.DB_DIR || !path.resolve(process.env.DB_DIR).toLowerCase().startsWith(TMP)) {
  console.error('Banco isolado ausente. Execute: node -r ./tests/pdv/_bancoIsolado.js --test tests/pdv/pdv-venda-por-linha-unidade.test.js');
  process.exit(1);
}
for (const sufixo of ['', '-wal', '-shm']) {
  fs.rmSync(path.join(process.env.DB_DIR, 'mercadao.db' + sufixo), { force: true });
}
const DIR_CONFIG = path.join(process.env.DB_DIR, 'config');
fs.rmSync(DIR_CONFIG, { recursive: true, force: true });

const express = require('express');
const db = require('../../backend/database');
const bootstrapLinhasProdutos = require('../../backend/modules/fabrica-loja/migrations/010_linhas_produtos');
const { json, extrairFuncao, esperar, fonteDesktop, fonteMobile, criarAmbiente } = require('./_vendaPorLinhaJsdom');

const ids = {};
let servidor;
let amb;

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}
function get(sql, params = []) {
  return new Promise((resolve, reject) => db.get(sql, params, (e, r) => (e ? reject(e) : resolve(r || null))));
}

async function api(method, rota, body) {
  const resposta = await fetch(amb.base + rota, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-perfil-teste': 'SUPER_ADMIN' },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: resposta.status, body: await resposta.json().catch(() => null) };
}

async function inserirProduto(codigo, nome, linha, preco, { unidade = 'UN', forma = 'UNIDADE', fracionado = 0 } = {}) {
  return (await run(`INSERT INTO produtos (codigo, nome, unidade, preco_venda, ativo, natureza_cadastro, item_fiscal, linha_produtos_id,
      estoque_atual, saldo_nao_fiscal, saldo_fiscal, forma_comercializacao, produto_fracionado, vendido_por_peso)
    VALUES (?, ?, ?, ?, 1, 'PRODUZIDO', 1, ?, 50, 50, 0, ?, ?, ?)`, [codigo, nome, unidade, preco, linha, forma, fracionado, fracionado])).id;
}

async function contagens() {
  return {
    vendas: (await get('SELECT COUNT(*) AS q FROM vendas')).q,
    itens: (await get('SELECT COUNT(*) AS q FROM vendas_itens')).q,
    movimentos: (await get('SELECT COUNT(*) AS q FROM estoque_movimentacoes')).q,
    estoque: (await get('SELECT SUM(estoque_atual) AS q FROM produtos')).q
  };
}

/** Desktop com espiões: o carrinho não pode ser tocado quando a validação recusa. */
async function abrirDesktopEspionado() {
  const w = await amb.abrirDesktop();
  w.eval(`
    window.__toquesCarrinho = { adicionar: 0, atualizar: 0 };
    const adicionarOriginal = adicionarItemNoCarrinho;
    const atualizarOriginal = atualizarCarrinho;
    adicionarItemNoCarrinho = function () { __toquesCarrinho.adicionar += 1; return adicionarOriginal.apply(this, arguments); };
    atualizarCarrinho = function () { __toquesCarrinho.atualizar += 1; return atualizarOriginal.apply(this, arguments); };
  `);
  return w;
}

/** Mobile com espião em saveCart. */
async function abrirMobileEspionado() {
  const ambiente = await amb.abrirMobile();
  ambiente.w.eval(`
    window.__gravacoesCarrinho = 0;
    const saveCartOriginal = saveCart;
    saveCart = function () { __gravacoesCarrinho += 1; return saveCartOriginal.apply(this, arguments); };
  `);
  return ambiente;
}

const msgInteira = (nome) => `A quantidade de ${nome} deve ser inteira.`;
const porId = (pares) => [...pares].sort((a, b) => a[0] - b[0]);

before(async () => {
  await new Promise((resolve) => db.whenReady(() => resolve()));
  assert.ok(path.resolve(db.dbPath).toLowerCase().startsWith(TMP), `banco fora do temp: ${db.dbPath}`);
  await bootstrapLinhasProdutos(db);

  const { configuracaoRouter } = require('../../backend/modules/comercial');
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = { id: 1, perfil: req.headers['x-perfil-teste'] || 'OPERADOR' }; next(); });
  app.use('/api/configuracoes-avancadas', require('../../backend/rotas/configuracoes_avancadas'));
  app.use('/api/configuracao-comercial', configuracaoRouter);
  app.use('/api/produtos', require('../../backend/rotas/produtos'));
  app.use('/api/fabrica-loja', require('../../backend/rotas/fabrica-loja'));
  servidor = http.createServer(app);
  await new Promise((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  amb = criarAmbiente(`http://127.0.0.1:${servidor.address().port}`);

  const linha = await api('POST', '/fabrica-loja/linhas-produtos', { codigo: 'MISTA', nome: 'Linha Mista' });
  assert.ok(linha.status < 300, JSON.stringify(linha.body));
  ids.linha = linha.body.linha.id;
  ids.abacaxi = await inserirProduto('PC-ABA', 'Picolé Abacaxi', ids.linha, 3);
  ids.chocolate = await inserirProduto('PC-CHOC', 'Picolé Chocolate', ids.linha, 2.5);
  ids.morango = await inserirProduto('PC-MOR', 'Picolé Morango', ids.linha, 2);
  ids.acai = await inserirProduto('ACAI-KG', 'Açaí a Granel', ids.linha, 40, { unidade: 'KG', forma: 'PESO', fracionado: 1 });
  ids.sorvete = await inserirProduto('SORV-MOR', 'Sorvete Morango', null, 5);

  const r = await api('PUT', '/configuracoes-avancadas/comercializacao', { permitirVendaPorProduto: true, permitirVendaPorLinha: true });
  assert.equal(r.status, 200);
});

after(async () => {
  if (amb) amb.fechar();
  fs.rmSync(DIR_CONFIG, { recursive: true, force: true });
  if (servidor) {
    servidor.closeAllConnections();
    await new Promise((resolve) => servidor.close(resolve));
  }
  await new Promise((resolve) => db.close(() => resolve()));
});

describe('PDV — unidade de cada produto validada antes de a Linha ir ao carrinho', () => {
  it('a quantidade da Linha continua aceitando fração e as regras de unidade vêm do PDV normal', async () => {
    const w = await amb.abrirDesktop();
    assert.equal(w.PdvVendaPorLinha.interpretarQuantidadeTotal('25,5'), 25.5, 'regra da Linha intacta');
    assert.equal(w.PdvVendaPorLinha.interpretarQuantidadeTotal('100,5'), 100.5);
    const resolvido = await amb.enviar('configuracao-comercial/resolver-precos', { itens: [{ produto_id: ids.acai, quantidade: 1 }, { produto_id: ids.abacaxi, quantidade: 1 }] });
    assert.equal(resolvido.itens[0].forma_comercializacao, 'PESO', 'Açaí é fracionado no Resolver');
    assert.equal(resolvido.itens[1].forma_comercializacao, 'UNIDADE', 'Abacaxi é por unidade no Resolver');

    const fluxoDesktop = extrairFuncao(fonteDesktop, 'adicionarDistribuicaoLinhaNoCarrinhoPdv');
    assert.match(fluxoDesktop, /normalizarQuantidadePdv\(quantidade, produtoParaVenda\) !== quantidade/, 'Desktop usa a regra normal do PDV');
    const validacao = fluxoDesktop.indexOf('deve ser inteira');
    assert.ok(validacao > 0 && validacao < fluxoDesktop.indexOf('const anterior = carrinho'), 'Desktop valida antes de tocar no carrinho');
    const fluxoMobile = extrairFuncao(fonteMobile, 'adicionarDistribuicaoLinhaNoCarrinhoMobile');
    assert.match(fluxoMobile, /forma === 'PESO' \|\| forma === 'VOLUME'/, 'Mobile usa a regra do sheet normal (PESO/VOLUME fracionam)');
    assert.ok(fluxoMobile.indexOf('deve ser inteira') < fluxoMobile.indexOf('saveCart(next)'), 'Mobile valida antes de gravar o carrinho');
  });

  it('Desktop 1. produto por unidade com quantidade inteira é permitido', async () => {
    const w = await abrirDesktopEspionado();
    await amb.desktopConcluido(w, ids.linha, '100', [[ids.abacaxi, '30'], [ids.chocolate, '25'], [ids.morango, '45']]);
    assert.equal(await amb.desktopAdicionar(w), null);
    assert.deepEqual(porId(amb.itensDesktop(w).map((i) => [i.id, i.quantidade])), porId([[ids.abacaxi, 30], [ids.chocolate, 25], [ids.morango, 45]]));
  });

  it('Desktop 2, 4, 5, 6 e 7. um produto por unidade com fração bloqueia tudo, preserva carrinho e distribuição, e a correção funciona', async () => {
    const antes = await contagens();
    const w = await abrirDesktopEspionado();
    const $ = w.jQuery;
    w.adicionarItemNoCarrinho(json(w.__pdvTeste.produto(ids.sorvete)), 10, 5);
    const carrinhoAntes = json(w.__pdvTeste.carrinho());
    w.__toquesCarrinho.adicionar = 0;
    w.__toquesCarrinho.atualizar = 0;

    const { visivel } = await amb.desktopConcluido(w, ids.linha, '100,5', [[ids.abacaxi, '25,5'], [ids.chocolate, '30'], [ids.morango, '45']]);

    const erro = await amb.desktopAdicionar(w);
    assert.equal(erro, msgInteira('Picolé Abacaxi'), 'mensagem identifica o produto');
    assert.ok(w.__notificacoes.some((n) => n.tipo === 'danger' && n.mensagem === msgInteira('Picolé Abacaxi')));
    assert.deepEqual(json(w.__toquesCarrinho), { adicionar: 0, atualizar: 0 }, 'o carrinho nem foi tocado');
    assert.deepEqual(json(w.__pdvTeste.carrinho()), carrinhoAntes, 'carrinho exatamente como estava');
    assert.ok(visivel('etapaProdutosLinhaPdv'), 'continua na lista');
    assert.equal($(`[data-quantidade-produto-id="${ids.abacaxi}"]`).val(), '25,5', 'valor a corrigir continua no campo');
    assert.equal($(`[data-quantidade-produto-id="${ids.chocolate}"]`).val(), '30');
    assert.equal($(`[data-quantidade-produto-id="${ids.morango}"]`).val(), '45');
    assert.equal($('#btnContinuarLinhaPdv').prop('disabled'), false, 'pode tentar de novo');

    $(`[data-quantidade-produto-id="${ids.abacaxi}"]`).val('25').trigger('input');
    $(`[data-quantidade-produto-id="${ids.morango}"]`).val('45,5').trigger('input');
    assert.equal(await amb.desktopAdicionar(w), msgInteira('Picolé Morango'), 'cada produto é validado individualmente');
    assert.deepEqual(json(w.__pdvTeste.carrinho()), carrinhoAntes);

    $(`[data-quantidade-produto-id="${ids.morango}"]`).val('45').trigger('input');
    $(`[data-quantidade-produto-id="${ids.chocolate}"]`).val('30,5').trigger('input');
    assert.equal(await amb.desktopAdicionar(w), msgInteira('Picolé Chocolate'));

    $(`[data-quantidade-produto-id="${ids.chocolate}"]`).val('30').trigger('input');
    $(`[data-quantidade-produto-id="${ids.acai}"]`).val('0,5').trigger('input');
    assert.equal(await amb.desktopAdicionar(w), null, 'depois de corrigir, adiciona normalmente');
    assert.deepEqual(porId(amb.itensDesktop(w).map((i) => [i.id, i.quantidade])), porId([
      [ids.sorvete, 10], [ids.abacaxi, 25], [ids.chocolate, 30], [ids.morango, 45], [ids.acai, 0.5]
    ]));
    assert.equal(amb.itensDesktop(w)[0].id, ids.sorvete, 'item que já estava continua em primeiro');
    assert.equal(w.PdvVendaPorLinha.obterSelecao(), null);
    assert.deepEqual(await contagens(), antes, 'nenhuma venda nem estoque');
  });

  it('Desktop 3. produto fracionado com quantidade fracionada é permitido (na mesma Linha de produtos por unidade)', async () => {
    const w = await abrirDesktopEspionado();
    await amb.desktopConcluido(w, ids.linha, '32,75', [[ids.acai, '2,75'], [ids.abacaxi, '30']]);
    assert.equal(await amb.desktopAdicionar(w), null);
    assert.deepEqual(porId(amb.itensDesktop(w).map((i) => [i.id, i.quantidade])), porId([[ids.abacaxi, 30], [ids.acai, 2.75]]),
      'fração preservada no produto fracionado');
  });

  it('Mobile 1 e 3. inteiro em produto por unidade e fração em produto fracionado são permitidos', async () => {
    const { w, root } = await abrirMobileEspionado();
    const { continuar } = await amb.mobileConcluido(w, root, ids.linha, '32,75', [[ids.abacaxi, '30'], [ids.acai, '2,75']]);
    continuar.click();
    await esperar(() => amb.carrinhoMobile(w).length === 2, 'carrinho Mobile');
    const itens = amb.itensMobile(w);
    assert.equal(itens.find((i) => i.id === ids.abacaxi).qtd, 30);
    assert.equal(itens.find((i) => i.id === ids.acai).qtd, 2.75);
    assert.equal(amb.carrinhoMobile(w).find((i) => Number(i.id) === ids.acai).forma_comercializacao, 'PESO');
  });

  it('Mobile 2, 4, 5, 6 e 7. um produto por unidade com fração bloqueia tudo, preserva carrinho e distribuição, e a correção funciona', async () => {
    const antes = await contagens();
    const { w, root } = await abrirMobileEspionado();
    const doc = w.document;
    w.sessionStorage.setItem('cds-mobile-pdv-cart', JSON.stringify([
      { id: String(ids.sorvete), nome: 'Sorvete Morango', preco: 5, qtd: 10, forma_comercializacao: 'UNIDADE', unidade_comercial: 'UN' }
    ]));
    const carrinhoAntes = w.sessionStorage.getItem('cds-mobile-pdv-cart');

    const { continuar, voltar } = await amb.mobileConcluido(w, root, ids.linha, '100,5', [[ids.abacaxi, '30'], [ids.chocolate, '25'], [ids.morango, '45,5']]);
    const distribuicao = json(w.PdvVendaPorLinha.distribuicaoConfirmada());
    const erro = () => doc.getElementById('pdv-linha-conclusao-erro');
    continuar.click();
    await esperar(() => erro()?.style.display === '', 'erro no Mobile');
    assert.equal(erro().textContent, msgInteira('Picolé Morango'), 'mensagem identifica o produto');
    assert.ok(w.toasts.some((t) => t.tipo === 'error' && t.mensagem === msgInteira('Picolé Morango')));
    assert.equal(w.__gravacoesCarrinho, 0, 'o carrinho nem foi gravado');
    assert.equal(w.sessionStorage.getItem('cds-mobile-pdv-cart'), carrinhoAntes, 'carrinho exatamente como estava');
    assert.match(doc.getElementById('pdv-linha-corpo').textContent, /Distribuição concluída\./, 'continua na tela');
    assert.deepEqual(json(w.PdvVendaPorLinha.distribuicaoConfirmada()), distribuicao, 'distribuição preservada');
    assert.equal(continuar.disabled, false, 'pode tentar de novo');

    voltar.click();
    const campo = (id) => doc.querySelector(`[data-distribuir-produto-id="${id}"]`);
    assert.equal(campo(ids.morango).value, '45,5', 'valor a corrigir continua no campo');
    assert.equal(campo(ids.abacaxi).value, '30');
    assert.equal(campo(ids.chocolate).value, '25');
    const digitar = (id, valor) => { campo(id).value = valor; campo(id).dispatchEvent(new w.Event('input', { bubbles: true })); };
    digitar(ids.morango, '45');
    digitar(ids.acai, '0,5');
    continuar.click();
    assert.match(doc.getElementById('pdv-linha-corpo').textContent, /Distribuição concluída\./);
    const pinturasAntes = w.pinturas;
    continuar.click();
    await esperar(() => w.pinturas > pinturasAntes, 'fim do fluxo Mobile (recalcular + pintar carrinho)');
    assert.deepEqual(porId(amb.itensMobile(w).map((i) => [i.id, i.qtd])), porId([
      [ids.sorvete, 10], [ids.abacaxi, 30], [ids.chocolate, 25], [ids.morango, 45], [ids.acai, 0.5]
    ]));
    assert.equal(w.PdvVendaPorLinha.obterSelecao(), null);
    assert.deepEqual(await contagens(), antes, 'nenhuma venda nem estoque');
  });
});
