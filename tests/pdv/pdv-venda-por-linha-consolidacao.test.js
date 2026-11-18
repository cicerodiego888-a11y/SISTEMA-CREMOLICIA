/**
 * LINHA DE PRODUTOS 09 — Depois de "Adicionar ao carrinho" o carrinho é um carrinho normal (PDV Desktop e Mobile).
 * Compara o carrinho montado pela Linha com o montado pela adição normal, campo a campo, e usa as ações
 * normais do carrinho (somar, remover, totalizar) sobre os itens que vieram da Linha.
 * Executar: npm run test:pdv-venda-linha-consolidacao
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
  console.error('Banco isolado ausente. Execute: node -r ./tests/pdv/_bancoIsolado.js --test tests/pdv/pdv-venda-por-linha-consolidacao.test.js');
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

async function inserirProduto(codigo, nome, linha, preco, estoque = 500) {
  return (await run(`INSERT INTO produtos (codigo, nome, unidade, preco_venda, ativo, natureza_cadastro, item_fiscal, linha_produtos_id,
      estoque_atual, saldo_nao_fiscal, saldo_fiscal)
    VALUES (?, ?, 'UN', ?, 1, 'PRODUZIDO', 1, ?, ?, ?, 0)`, [codigo, nome, preco, linha, estoque, estoque])).id;
}

async function contagens() {
  return {
    vendas: (await get('SELECT COUNT(*) AS q FROM vendas')).q,
    movimentos: (await get('SELECT COUNT(*) AS q FROM estoque_movimentacoes')).q,
    estoque: (await get('SELECT SUM(estoque_atual) AS q FROM produtos')).q,
    produtos: (await get('SELECT COUNT(*) AS q FROM produtos')).q,
    linhas: (await get('SELECT COUNT(*) AS q FROM linhas_produtos')).q
  };
}

/* ── Desktop ─────────────────────────────────────────────────────────── */

async function desktopOcioso(w) {
  for (let estavel = 0; estavel < 3;) {
    await new Promise((resolve) => setTimeout(resolve, 30));
    estavel = w.jQuery.active === 0 ? estavel + 1 : 0;
  }
}

/** Fluxo normal do PDV Desktop: produto → Resolver → UC-01 → modal de quantidade → carrinho. */
async function adicionarNormalDesktop(w, produtoId, quantidade) {
  const $ = w.jQuery;
  const qtd = () => json(w.__pdvTeste.carrinho()).filter((i) => i.id === produtoId).reduce((s, i) => s + i.quantidade, 0);
  const antes = qtd();
  const avisos = w.__notificacoes.length;
  $('#modalQuantidadeProduto').remove();
  w.adicionarProdutoConsultaPDV(produtoId);
  await esperar(() => w.document.getElementById('inputQuantidadeProduto'), 'modal de quantidade do fluxo normal');
  $('#inputQuantidadeProduto').val(String(quantidade));
  $('#btnConfirmarQuantidadeProduto').trigger('click');
  await esperar(() => qtd() > antes || w.__notificacoes.slice(avisos).some((n) => n.tipo !== 'success'), 'resultado do fluxo normal');
  await desktopOcioso(w);
}

async function linhaDesktop(w, linhaId, total, distribuicao) {
  await amb.desktopConcluido(w, linhaId, total, distribuicao);
  const erro = await amb.desktopAdicionar(w);
  await desktopOcioso(w);
  return erro;
}

const carrinhoDesktop = (w) => json(w.__pdvTeste.carrinho());
const resumoDesktop = (w) => carrinhoDesktop(w).map((item) => [item.id, item.nome, item.quantidade]);

/* ── Mobile ──────────────────────────────────────────────────────────── */

/** Mesmos passos do clique em um produto na busca do PDV Mobile (Resolver, item, regra do carrinho). */
async function adicionarNormalMobile(w, root, produtoId, codigo, qtd) {
  const resolvido = await w.resolverPrecosOficial(
    w.montarItensResolver(w.loadCart()).concat([{ produto_id: produtoId, quantidade: 1 }])
  );
  const row = resolvido.itens.find((r) => Number(r.produto_id) === produtoId);
  const forma = String(row.forma_comercializacao || '').toUpperCase() || 'UNIDADE';
  const next = w.loadCart();
  w.incluirItemNoCarrinhoMobile(next, {
    id: String(produtoId),
    nome: row.nome,
    codigo,
    preco: Number(row.preco_venda),
    qtd,
    forma_comercializacao: forma,
    unidade_comercial: String(row.unidade_comercial || '').toUpperCase() || null,
    tipo_venda: forma === 'PESO' || forma === 'VOLUME' ? 'PESO' : 'UNIDADE',
    canal: String(row.canal || resolvido.canal || 'VAREJO').toUpperCase(),
    quantidade_bolas: null,
    sabores: null,
    kit_id: null,
    kit_itens: null,
    preco_origem: row.preco_origem || null,
    tabela_preco_id: row.tabela_preco_id || null,
    tabela_preco_nome: row.tabela_preco_nome || null,
    linha_comercial_id: row.linha_comercial_id || null,
    preco_congelado: false,
    resolver: 'Motor Oficial'
  });
  w.saveCart(next);
  await w.recalcularCarrinhoViaResolver(root, true);
}

async function linhaMobile(w, root, linhaId, total, distribuicao) {
  const { continuar } = await amb.mobileConcluido(w, root, linhaId, total, distribuicao);
  const pinturas = w.pinturas;
  const toasts = w.toasts.length;
  continuar.click();
  await esperar(() => w.pinturas > pinturas || w.toasts.slice(toasts).some((t) => t.tipo === 'error'), 'resultado da Linha no Mobile');
  const erro = w.toasts.slice(toasts).find((t) => t.tipo === 'error');
  if (erro) {
    w.closeBottomSheet({ immediate: true });
    w.PdvVendaPorLinha.limpar();
  }
  // O sheet fechado fica 180 ms no DOM (animação) com os mesmos ids de botão.
  await esperar(() => !w.document.querySelector('.cds-sheet'), 'sheet da Linha removido');
  return erro ? erro.mensagem : null;
}

const resumoMobile = (w) => amb.carrinhoMobile(w).map((item) => [Number(item.id), item.nome, item.qtd]);

/** Chaves do item montado pelo clique na busca normal do Mobile (pages/pdv.js). */
function chavesItemBuscaMobile() {
  const inicio = fonteMobile.indexOf('const itemForma = result.forma || forma;');
  const trecho = fonteMobile.slice(fonteMobile.indexOf('const item = {', inicio), fonteMobile.indexOf('const next = loadCart();', inicio));
  return [...trecho.matchAll(/^\s+(\w+)(?=[,:])/gm)].map((m) => m[1]);
}

before(async () => {
  await new Promise((resolve) => db.whenReady(() => resolve()));
  assert.ok(path.resolve(db.dbPath).toLowerCase().startsWith(TMP), `banco fora do temp: ${db.dbPath}`);
  await bootstrapLinhasProdutos(db);
  const comercial = require('../../backend/modules/comercial');
  await comercial.bootstrapComercialV2Schema(db);

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = { id: 1, perfil: req.headers['x-perfil-teste'] || 'OPERADOR' }; next(); });
  app.use('/api/configuracoes-avancadas', require('../../backend/rotas/configuracoes_avancadas'));
  app.use('/api/configuracao-comercial', comercial.configuracaoRouter);
  app.use('/api/produtos', require('../../backend/rotas/produtos'));
  app.use('/api/fabrica-loja', require('../../backend/rotas/fabrica-loja'));
  servidor = http.createServer(app);
  await new Promise((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  amb = criarAmbiente(`http://127.0.0.1:${servidor.address().port}`);

  const criarLinha = async (codigo, nome) => {
    const r = await api('POST', '/fabrica-loja/linhas-produtos', { codigo, nome });
    assert.ok(r.status < 300, JSON.stringify(r.body));
    return r.body.linha.id;
  };
  ids.cremosa = await criarLinha('CREM', 'Linha Cremosa');
  ids.fruta = await criarLinha('FRUTA', 'Linha Fruta');
  ids.chocolate = await inserirProduto('PC-CHOC', 'Picolé Chocolate', ids.cremosa, 2.5);
  ids.morango = await inserirProduto('PC-MOR', 'Picolé Morango', ids.cremosa, 2);
  ids.abacaxi = await inserirProduto('PC-ABA', 'Picolé Abacaxi', ids.cremosa, 3);
  ids.uva = await inserirProduto('PF-UVA', 'Picolé Uva', ids.fruta, 2.2);
  ids.limao = await inserirProduto('PF-LIM', 'Picolé Limão', ids.fruta, 1.8, 10);
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

describe('PDV Desktop — carrinho depois da Venda por Linha', () => {
  it('1, 2, 3 e 4. Linha Cremosa 100 vira Chocolate 40, Morango 30 e Abacaxi 30, separados e por produto_id', async () => {
    const antes = await contagens();
    const w = await amb.abrirDesktop();
    assert.equal(await linhaDesktop(w, ids.cremosa, '100', [[ids.chocolate, '40'], [ids.morango, '30'], [ids.abacaxi, '30']]), null);
    assert.deepEqual(resumoDesktop(w), [
      [ids.chocolate, 'Picolé Chocolate', 40],
      [ids.morango, 'Picolé Morango', 30],
      [ids.abacaxi, 'Picolé Abacaxi', 30]
    ], 'na ordem da lista da Linha');
    const carrinho = carrinhoDesktop(w);
    assert.ok(!carrinho.some((item) => /Linha Cremosa/.test(item.nome)), 'a Linha não é item');
    assert.ok(carrinho.every((item) => Number.isInteger(item.id) && [ids.chocolate, ids.morango, ids.abacaxi].includes(item.id)));
    assert.doesNotMatch(JSON.stringify(carrinho), /linha_produtos|Linha Cremosa|venda_por_linha|origem_linha/, 'sem marcador de Linha no item');
    assert.equal(w.document.querySelectorAll('#tabelaItensVendaPdv .item-remover').length, 3, 'três linhas visuais, nenhuma da Linha');
    assert.doesNotMatch(w.document.getElementById('tabelaItensVendaPdv').textContent, /Linha Cremosa/);
    assert.deepEqual(await contagens(), antes, 'sem produto, linha, venda ou estoque novos');
  });

  it('5. produto repetido soma pela regra normal: Chocolate 10 no carrinho + 20 pela Linha = 30 numa linha só', async () => {
    const w = await amb.abrirDesktop();
    await adicionarNormalDesktop(w, ids.chocolate, 10);
    assert.equal(await linhaDesktop(w, ids.cremosa, '20', [[ids.chocolate, '20']]), null);
    assert.deepEqual(resumoDesktop(w), [[ids.chocolate, 'Picolé Chocolate', 30]]);

    const normal = await amb.abrirDesktop();
    await adicionarNormalDesktop(normal, ids.chocolate, 10);
    await adicionarNormalDesktop(normal, ids.chocolate, 20);
    assert.deepEqual(carrinhoDesktop(w), carrinhoDesktop(normal), 'mesmo resultado de somar pela busca normal');
  });

  it('6. duas Linhas alimentam o mesmo carrinho sem agrupamento por Linha', async () => {
    const w = await amb.abrirDesktop();
    assert.equal(await linhaDesktop(w, ids.cremosa, '50', [[ids.chocolate, '30'], [ids.abacaxi, '20']]), null);
    assert.equal(await linhaDesktop(w, ids.fruta, '15', [[ids.uva, '10'], [ids.limao, '5']]), null);
    assert.deepEqual(resumoDesktop(w), [
      [ids.chocolate, 'Picolé Chocolate', 30],
      [ids.abacaxi, 'Picolé Abacaxi', 20],
      [ids.uva, 'Picolé Uva', 10],
      [ids.limao, 'Picolé Limão', 5]
    ]);
    assert.equal(w.calcularSubtotal(), 30 * 2.5 + 20 * 3 + 10 * 2.2 + 5 * 1.8);
    assert.doesNotMatch(w.document.getElementById('tabelaItensVendaPdv').innerHTML, /Linha (Cremosa|Fruta)/, 'sem cabeçalho/grupo de Linha');
  });

  it('7. carrinho que já tinha produtos fica intacto', async () => {
    const w = await amb.abrirDesktop();
    await adicionarNormalDesktop(w, ids.sorvete, 2);
    await adicionarNormalDesktop(w, ids.uva, 4);
    const antes = carrinhoDesktop(w);
    assert.equal(await linhaDesktop(w, ids.cremosa, '10', [[ids.morango, '10']]), null);
    const depois = carrinhoDesktop(w);
    assert.deepEqual(depois.slice(0, 2), antes, 'Sorvete e Uva exatamente como estavam');
    assert.deepEqual(depois.slice(2).map((item) => [item.id, item.quantidade]), [[ids.morango, 10]]);
  });

  it('8. falha num produto da segunda Linha não altera o carrinho já montado', async () => {
    const antes = await contagens();
    const w = await amb.abrirDesktop();
    assert.equal(await linhaDesktop(w, ids.cremosa, '30', [[ids.chocolate, '15'], [ids.morango, '15']]), null);
    const montado = carrinhoDesktop(w);
    await amb.desktopConcluido(w, ids.fruta, '25', [[ids.uva, '5'], [ids.limao, '20']]);
    assert.match(await amb.desktopAdicionar(w), /Saldo insuficiente para Picolé Limão/);
    assert.deepEqual(carrinhoDesktop(w), montado, 'Uva não entrou sozinha');
    w.bootstrap.Modal.getOrCreateInstance(w.document.getElementById('modalVendaPorLinhaPdv')).hide();
    assert.deepEqual(carrinhoDesktop(w), montado);
    assert.deepEqual(await contagens(), antes);
  });

  it('9. itens vindos da Linha são idênticos aos adicionados normalmente e seguem as ações normais do carrinho', async () => {
    const normal = await amb.abrirDesktop();
    await adicionarNormalDesktop(normal, ids.sorvete, 1);
    await adicionarNormalDesktop(normal, ids.abacaxi, 30);
    await adicionarNormalDesktop(normal, ids.chocolate, 40);
    await adicionarNormalDesktop(normal, ids.morango, 30);

    const linha = await amb.abrirDesktop();
    await adicionarNormalDesktop(linha, ids.sorvete, 1);
    assert.equal(await linhaDesktop(linha, ids.cremosa, '100', [[ids.chocolate, '40'], [ids.morango, '30'], [ids.abacaxi, '30']]), null);

    const ordenarItens = (itens) => itens.slice().sort((a, b) => a.id - b.id);
    assert.deepEqual(ordenarItens(carrinhoDesktop(linha)), ordenarItens(carrinhoDesktop(normal)), 'item a item, todos os campos');
    const linhasOrdenadas = (w) => Array.from(w.document.querySelectorAll('#tabelaItensVendaPdv tr'))
      .map((tr) => tr.outerHTML.replace(/data-index="\d+"/g, 'data-index="#"'))
      .sort();
    assert.deepEqual(linhasOrdenadas(linha), linhasOrdenadas(normal), 'mesmas linhas de produto, sem depender da ordem de inclusão');
    assert.equal(linha.obterTotalVendaPDV(), normal.obterTotalVendaPDV());

    await adicionarNormalDesktop(linha, ids.morango, 5);
    await adicionarNormalDesktop(normal, ids.morango, 5);
    linha.removerItemCarrinho(carrinhoDesktop(linha).findIndex((item) => item.id === ids.abacaxi));
    normal.removerItemCarrinho(carrinhoDesktop(normal).findIndex((item) => item.id === ids.abacaxi));
    assert.deepEqual(carrinhoDesktop(linha), carrinhoDesktop(normal), 'somar pela busca e remover funcionam igual');
    assert.deepEqual(resumoDesktop(linha), [
      [ids.sorvete, 'Sorvete Morango', 1],
      [ids.chocolate, 'Picolé Chocolate', 40],
      [ids.morango, 'Picolé Morango', 35]
    ]);
    assert.equal(linha.obterTotalVendaPDV(), 5 + 40 * 2.5 + 35 * 2);
  });

  it('a Linha não fica guardada no PDV depois da inclusão', async () => {
    const w = await amb.abrirDesktop();
    assert.equal(await linhaDesktop(w, ids.cremosa, '10', [[ids.chocolate, '10']]), null);
    assert.equal(w.PdvVendaPorLinha.obterSelecao(), null);
    const fluxo = extrairFuncao(fonteDesktop, 'adicionarDistribuicaoLinhaNoCarrinhoPdv');
    assert.doesNotMatch(fluxo, /linha_produtos_id|linhaProdutosId|quantidade_total/, 'a Linha não passa para o item nem para a venda');
  });
});

describe('PDV Mobile — carrinho depois da Venda por Linha', () => {
  it('1, 2, 3 e 4. Linha vira produtos separados por produto_id, sem item de Linha', async () => {
    const { w, root } = await amb.abrirMobile();
    assert.equal(await linhaMobile(w, root, ids.cremosa, '100', [[ids.chocolate, '40'], [ids.morango, '30'], [ids.abacaxi, '30']]), null);
    assert.deepEqual(resumoMobile(w), [
      [ids.abacaxi, 'Picolé Abacaxi', 30],
      [ids.chocolate, 'Picolé Chocolate', 40],
      [ids.morango, 'Picolé Morango', 30]
    ]);
    assert.doesNotMatch(JSON.stringify(amb.carrinhoMobile(w)), /linha_produtos|Linha Cremosa|venda_por_linha|origem_linha/);
  });

  it('5, 6 e 7. carrinho existente intacto, produto repetido somado e duas Linhas no mesmo carrinho', async () => {
    const { w, root } = await amb.abrirMobile();
    await adicionarNormalMobile(w, root, ids.sorvete, 'SORV-MOR', 2);
    await adicionarNormalMobile(w, root, ids.chocolate, 'PC-CHOC', 10);
    const sorvete = amb.carrinhoMobile(w)[0];
    assert.equal(await linhaMobile(w, root, ids.cremosa, '20', [[ids.chocolate, '20']]), null);
    assert.equal(await linhaMobile(w, root, ids.fruta, '8', [[ids.uva, '5'], [ids.limao, '3']]), null);
    assert.deepEqual(resumoMobile(w), [
      [ids.sorvete, 'Sorvete Morango', 2],
      [ids.chocolate, 'Picolé Chocolate', 30],
      [ids.limao, 'Picolé Limão', 3],
      [ids.uva, 'Picolé Uva', 5]
    ]);
    assert.deepEqual(amb.carrinhoMobile(w)[0], sorvete, 'item anterior intacto');
  });

  it('8. falha na segunda Linha não altera o carrinho já montado', async () => {
    const { w, root } = await amb.abrirMobile();
    assert.equal(await linhaMobile(w, root, ids.cremosa, '10', [[ids.morango, '10']]), null);
    const montado = amb.carrinhoMobile(w);
    assert.match(await linhaMobile(w, root, ids.fruta, '9,5', [[ids.uva, '5'], [ids.limao, '4,5']]) || '', /A quantidade de Picolé Limão deve ser inteira\./);
    assert.deepEqual(amb.carrinhoMobile(w), montado);
  });

  it('9. itens da Linha têm os mesmos campos e valores da adição normal', async () => {
    const normal = await amb.abrirMobile();
    await adicionarNormalMobile(normal.w, normal.root, ids.chocolate, 'PC-CHOC', 40);
    await adicionarNormalMobile(normal.w, normal.root, ids.morango, 'PC-MOR', 30);

    const linha = await amb.abrirMobile();
    assert.equal(await linhaMobile(linha.w, linha.root, ids.cremosa, '70', [[ids.chocolate, '40'], [ids.morango, '30']]), null);

    assert.deepEqual(amb.carrinhoMobile(linha.w), amb.carrinhoMobile(normal.w), 'item a item, todos os campos');
    const chavesNormal = chavesItemBuscaMobile();
    assert.ok(chavesNormal.length >= 15, `chaves da busca normal: ${chavesNormal}`);
    assert.deepEqual(Object.keys(amb.carrinhoMobile(linha.w)[0]).sort(), [...chavesNormal].sort(), 'mesmo formato de item da busca normal');

    await adicionarNormalMobile(linha.w, linha.root, ids.morango, 'PC-MOR', 5);
    assert.deepEqual(resumoMobile(linha.w), [[ids.chocolate, 'Picolé Chocolate', 40], [ids.morango, 'Picolé Morango', 35]]);
  });
});
