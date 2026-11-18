/**
 * LINHA DE PRODUTOS 08 — Precificação dos produtos adicionados pela Venda por Linha (PDV Desktop e Mobile).
 * A Linha não tem preço: cada produto recebe o preço oficial que receberia se fosse adicionado normalmente.
 * Cada cenário compara ADICIONAR NORMALMENTE × ADICIONAR PELA LINHA no mesmo contexto comercial.
 * Desktop: fluxo normal real (adicionarProdutoConsultaPDV + modal de quantidade) contra a Linha.
 * Mobile: mesmos passos do clique na busca (Resolver com o carrinho, regra do carrinho, recálculo oficial).
 * Executar: npm run test:pdv-venda-linha-preco
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
  console.error('Banco isolado ausente. Execute: node -r ./tests/pdv/_bancoIsolado.js --test tests/pdv/pdv-venda-por-linha-preco.test.js');
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

async function inserirProduto(codigo, nome, linha, preco) {
  return (await run(`INSERT INTO produtos (codigo, nome, unidade, preco_venda, ativo, natureza_cadastro, item_fiscal, linha_produtos_id,
      estoque_atual, saldo_nao_fiscal, saldo_fiscal)
    VALUES (?, ?, 'UN', ?, 1, 'PRODUZIDO', 1, ?, 500, 500, 0)`, [codigo, nome, preco, linha])).id;
}

async function contagens() {
  return {
    vendas: (await get('SELECT COUNT(*) AS q FROM vendas')).q,
    itens: (await get('SELECT COUNT(*) AS q FROM vendas_itens')).q,
    movimentos: (await get('SELECT COUNT(*) AS q FROM estoque_movimentacoes')).q,
    estoque: (await get('SELECT SUM(estoque_atual) AS q FROM produtos')).q
  };
}

const porId = (lista) => [...lista].sort((a, b) => Number(a.id) - Number(b.id));

/* ── Desktop ─────────────────────────────────────────────────────────── */

/** Espera o PDV Desktop ficar sem AJAX pendente (inclui o recálculo de canal do carrinho). */
async function desktopOcioso(w) {
  for (let estavel = 0; estavel < 3;) {
    await new Promise((resolve) => setTimeout(resolve, 30));
    estavel = w.jQuery.active === 0 ? estavel + 1 : 0;
  }
}

/** Fluxo normal do PDV Desktop: produto → promoção → Resolver → UC-01 → modal de quantidade → carrinho. */
async function adicionarNormalDesktop(w, produtoId, quantidade) {
  const $ = w.jQuery;
  const qtdAntes = () => json(w.__pdvTeste.carrinho()).filter((i) => i.id === produtoId).reduce((s, i) => s + i.quantidade, 0);
  const antes = qtdAntes();
  const avisos = w.__notificacoes.length;
  $('#modalQuantidadeProduto').remove();
  w.adicionarProdutoConsultaPDV(produtoId);
  await esperar(() => w.document.getElementById('inputQuantidadeProduto'), 'modal de quantidade do fluxo normal');
  $('#inputQuantidadeProduto').val(String(quantidade));
  $('#btnConfirmarQuantidadeProduto').trigger('click');
  await esperar(() => qtdAntes() > antes || w.__notificacoes.slice(avisos).some((n) => n.tipo !== 'success'), 'resultado do fluxo normal');
  await desktopOcioso(w);
}

async function linhaDesktop(w, total, distribuicao) {
  await amb.desktopConcluido(w, ids.linha, total, distribuicao);
  const erro = await amb.desktopAdicionar(w);
  await desktopOcioso(w);
  return erro;
}

const precoDesktop = (item) => ({
  id: item.id,
  quantidade: item.quantidade,
  preco_unitario: item.preco_unitario,
  preco_base: item.preco_base,
  subtotal: item.subtotal,
  desconto_percentual: item.desconto_percentual,
  promocao_id: item.promocao_id,
  desconto_atacado: item.desconto_atacado,
  unidade: item.unidade,
  unidade_comercial: item.unidade_comercial,
  forma_comercializacao: item.forma_comercializacao,
  tipo_venda: item.tipo_venda,
  canal: item.canal,
  tipo_preco: item.tipo_preco,
  preco_origem: item.preco_origem,
  tabela_preco_id: item.tabela_preco_id,
  resolver: item.resolver
});
const carrinhoDesktop = (w) => porId(json(w.__pdvTeste.carrinho()).map(precoDesktop));

/* ── Mobile ──────────────────────────────────────────────────────────── */

async function abrirMobilePreco() {
  const ambiente = await amb.abrirMobile();
  ambiente.w.eval(extrairFuncao(fonteMobile, 'cartSubtotal'));
  ambiente.w.eval(extrairFuncao(fonteMobile, 'cartTotals'));
  return ambiente;
}

/**
 * Mesmos passos do clique em um produto na busca do PDV Mobile (pages/pdv.js):
 * Resolver com o carrinho atual + 1 un., item com o preço oficial, regra normal do carrinho, recálculo oficial.
 */
async function adicionarNormalMobile(w, root, produtoId, qtd) {
  const resolvido = await w.resolverPrecosOficial(
    w.montarItensResolver(w.loadCart()).concat([{ produto_id: produtoId, quantidade: 1 }])
  );
  const row = resolvido.itens.find((r) => Number(r.produto_id) === produtoId);
  if (!row || row.erro || !Number.isFinite(Number(row.preco_venda))) return false;
  const forma = String(row.forma_comercializacao || '').toUpperCase() || 'UNIDADE';
  const next = w.loadCart();
  w.incluirItemNoCarrinhoMobile(next, {
    id: String(produtoId),
    nome: row.nome,
    codigo: '',
    preco: Number(row.preco_venda),
    qtd,
    forma_comercializacao: forma,
    unidade_comercial: String(row.unidade_comercial || '').toUpperCase() || null,
    tipo_venda: forma === 'PESO' || forma === 'VOLUME' ? 'PESO' : 'UNIDADE',
    canal: String(row.canal || resolvido.canal || 'VAREJO').toUpperCase(),
    preco_origem: row.preco_origem || null,
    tabela_preco_id: row.tabela_preco_id || null,
    tabela_preco_nome: row.tabela_preco_nome || null,
    linha_comercial_id: row.linha_comercial_id || null,
    preco_congelado: false,
    resolver: 'Motor Oficial'
  });
  w.saveCart(next);
  await w.recalcularCarrinhoViaResolver(root, true);
  return true;
}

async function linhaMobile(w, root, total, distribuicao) {
  const { continuar } = await amb.mobileConcluido(w, root, ids.linha, total, distribuicao);
  const pinturas = w.pinturas;
  const toasts = w.toasts.length;
  continuar.click();
  await esperar(() => w.pinturas > pinturas || w.toasts.slice(toasts).some((t) => t.tipo === 'error'), 'resultado da Linha no Mobile');
  const erro = w.toasts.slice(toasts).find((t) => t.tipo === 'error');
  return erro ? erro.mensagem : null;
}

const precoMobile = (item) => ({
  id: Number(item.id),
  qtd: item.qtd,
  preco: item.preco,
  forma_comercializacao: item.forma_comercializacao,
  unidade_comercial: item.unidade_comercial,
  canal: item.canal,
  preco_origem: item.preco_origem,
  tabela_preco_id: item.tabela_preco_id,
  resolver: item.resolver
});
const carrinhoMobile = (w) => porId(amb.carrinhoMobile(w).map(precoMobile));

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

  const linha = await api('POST', '/fabrica-loja/linhas-produtos', { codigo: 'CREM', nome: 'Picolé Cremoso' });
  assert.ok(linha.status < 300, JSON.stringify(linha.body));
  ids.linha = linha.body.linha.id;
  ids.abacaxi = await inserirProduto('PC-ABA', 'Picolé Abacaxi', ids.linha, 2);
  ids.chocolate = await inserirProduto('PC-CHOC', 'Picolé Chocolate', ids.linha, 2.5);
  ids.morango = await inserirProduto('PC-MOR', 'Picolé Morango', ids.linha, 2.2);
  ids.uva = await inserirProduto('PC-UVA', 'Picolé Uva', ids.linha, 3);
  ids.semPreco = await inserirProduto('PC-SEM', 'Picolé Sem Preço', ids.linha, 0);
  ids.sorvete = await inserirProduto('SORV-MOR', 'Sorvete Morango', null, 5);
  await run(`INSERT INTO promocoes (produto_id, preco_original, preco_promocional, desconto_percentual, data_inicio, data_fim, status)
    VALUES (?, 3, 2.4, 20, date('now', '-1 day'), date('now', '+5 day'), 'ativa')`, [ids.uva]);

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

describe('PDV — preço dos produtos adicionados pela Venda por Linha', () => {
  it('a Linha reutiliza o caminho de preço do PDV normal (sem preço, cálculo ou contexto próprios)', () => {
    const fluxo = extrairFuncao(fonteDesktop, 'adicionarDistribuicaoLinhaNoCarrinhoPdv');
    const normal = extrairFuncao(fonteDesktop, 'iniciarFluxoAdicionarProdutoPdv');
    assert.match(normal, /enriquecerProdutoCanalPdv\(produto, seguirAposCanal\);/, 'fluxo normal resolve sem quantidade');
    assert.match(fluxo, /enriquecerProdutoCanalPdv\(produto, resolve\);/, 'Linha faz a mesma chamada ao Resolver');
    assert.match(fluxo, /buscarPromocaoAtivaProduto\(produtoParaVenda\.id\)/, 'mesma busca de promoção');
    assert.match(fluxo, /adicionarItemNoCarrinho\(/, 'mesmo cálculo do carrinho');
    assert.doesNotMatch(fluxo, /\.ajax\(|fetch\(|resolver-precos|subtotal|desconto_atacado|linha_produtos_id/, 'nenhum cálculo ou chamada de preço própria');
    const fluxoMobile = extrairFuncao(fonteMobile, 'adicionarDistribuicaoLinhaNoCarrinhoMobile');
    assert.match(fluxoMobile, /resolverPrecosOficial\(montarItensResolver\(next\)/, 'Mobile usa o Resolver oficial com o carrinho como contexto');
    assert.match(fluxoMobile, /incluirItemNoCarrinhoMobile\(next, novo\)/, 'Mobile usa a regra normal do carrinho');
    assert.doesNotMatch(fluxoMobile, /fetch\(|resolver-precos|linha_produtos_id|preco \* |\* item\.quantidade/, 'Mobile sem cálculo próprio');
  });

  it('Desktop 1–6 e 13. mesmo preço do fluxo normal, preços diferentes por produto, subtotal e total normais', async () => {
    const antes = await contagens();
    const normal = await amb.abrirDesktop();
    await adicionarNormalDesktop(normal, ids.abacaxi, 30);
    await adicionarNormalDesktop(normal, ids.chocolate, 40);
    await adicionarNormalDesktop(normal, ids.morango, 30);

    const linha = await amb.abrirDesktop();
    assert.equal(await linhaDesktop(linha, '100', [[ids.abacaxi, '30'], [ids.chocolate, '40'], [ids.morango, '30']]), null);

    const viaNormal = carrinhoDesktop(normal);
    const viaLinha = carrinhoDesktop(linha);
    assert.deepEqual(viaLinha, viaNormal, 'Linha = adição normal, campo a campo');
    assert.deepEqual(viaLinha.map((i) => [i.id, i.quantidade, i.preco_unitario, i.subtotal]), porId([
      { id: ids.abacaxi, q: 30, p: 2, s: 60 },
      { id: ids.chocolate, q: 40, p: 2.5, s: 100 },
      { id: ids.morango, q: 30, p: 2.2, s: 66 }
    ]).map((e) => [e.id, e.q, e.p, e.s]), 'cada produto com o próprio preço, sem preço médio');
    assert.equal(viaLinha[0].preco_unitario, await amb.precoOficial(ids.abacaxi), 'preço é o do Resolver oficial');
    assert.equal(linha.calcularSubtotal(), 226);
    assert.equal(linha.obterTotalVendaPDV(), 226, 'total = soma dos itens');
    assert.equal(normal.obterTotalVendaPDV(), 226);
    assert.ok(viaLinha.every((i) => i.unidade === 'UN' && i.resolver === 'Motor Oficial'));
    assert.deepEqual(await contagens(), antes, 'sem venda e sem estoque');
  });

  it('Desktop 4. a quantidade não altera o preço unitário', async () => {
    const w = await amb.abrirDesktop();
    assert.equal(await linhaDesktop(w, '3', [[ids.abacaxi, '1'], [ids.chocolate, '1'], [ids.morango, '1']]), null);
    assert.deepEqual(carrinhoDesktop(w).map((i) => i.preco_unitario), [2, 2.5, 2.2]);
  });

  it('Desktop 8. promoção ativa é aplicada exatamente como no fluxo normal', async () => {
    const normal = await amb.abrirDesktop();
    await adicionarNormalDesktop(normal, ids.uva, 10);
    const linha = await amb.abrirDesktop();
    assert.equal(await linhaDesktop(linha, '10', [[ids.uva, '10']]), null);
    assert.deepEqual(carrinhoDesktop(linha), carrinhoDesktop(normal));
    const [item] = carrinhoDesktop(linha);
    assert.equal(item.preco_unitario, 2.4, 'preço promocional');
    assert.equal(item.preco_base, 3, 'preço oficial continua como base');
    assert.ok(item.promocao_id, 'promoção vinculada ao item');
    assert.equal(item.subtotal, 24);
  });

  it('Desktop 9 e 10. produto sem preço: nada entra, carrinho anterior intacto, distribuição mantida', async () => {
    const normal = await amb.abrirDesktop();
    await adicionarNormalDesktop(normal, ids.semPreco, 5);
    assert.deepEqual(json(normal.__pdvTeste.carrinho()), [], 'o fluxo normal também não deixa entrar sem preço');
    assert.ok(normal.__notificacoes.some((n) => n.mensagem === 'Quantidade ou preço inválido.'), 'recusado pelo preço no fluxo normal');
    assert.equal(await amb.precoOficial(ids.semPreco), 0, 'Resolver oficial não encontra preço');

    const w = await amb.abrirDesktop();
    w.adicionarItemNoCarrinho(json(w.__pdvTeste.produto(ids.sorvete)), 2, 5);
    const carrinhoAntes = json(w.__pdvTeste.carrinho());
    await amb.desktopConcluido(w, ids.linha, '15', [[ids.abacaxi, '10'], [ids.semPreco, '5']]);
    assert.equal(await amb.desktopAdicionar(w), 'Não foi possível encontrar o preço de Picolé Sem Preço.');
    assert.deepEqual(json(w.__pdvTeste.carrinho()), carrinhoAntes, 'carrinho exatamente como estava');
    assert.ok(amb.visivelDesktop(w, 'etapaProdutosLinhaPdv'), 'lista continua disponível para correção');
    assert.equal(w.jQuery(`[data-quantidade-produto-id="${ids.abacaxi}"]`).val(), '10');
    assert.equal(w.jQuery(`[data-quantidade-produto-id="${ids.semPreco}"]`).val(), '5');
  });

  it('Mobile 1–6 e 12. mesmo preço do fluxo normal, preços diferentes por produto, total normal', async () => {
    const normal = await abrirMobilePreco();
    for (const [id, qtd] of [[ids.abacaxi, 30], [ids.chocolate, 40], [ids.morango, 30]]) {
      assert.ok(await adicionarNormalMobile(normal.w, normal.root, id, qtd));
    }
    const linha = await abrirMobilePreco();
    assert.equal(await linhaMobile(linha.w, linha.root, '100', [[ids.abacaxi, '30'], [ids.chocolate, '40'], [ids.morango, '30']]), null);

    const viaLinha = carrinhoMobile(linha.w);
    assert.deepEqual(viaLinha, carrinhoMobile(normal.w), 'Linha = adição normal, campo a campo');
    assert.deepEqual(viaLinha.map((i) => [i.id, i.qtd, i.preco]), porId([
      { id: ids.abacaxi, q: 30, p: 2 }, { id: ids.chocolate, q: 40, p: 2.5 }, { id: ids.morango, q: 30, p: 2.2 }
    ]).map((e) => [e.id, e.q, e.p]));
    assert.equal(linha.w.cartSubtotal(amb.carrinhoMobile(linha.w)), 226);
    assert.equal(linha.w.cartTotals(amb.carrinhoMobile(linha.w)).total, 226, 'total = soma dos itens');
    assert.equal(normal.w.cartTotals(amb.carrinhoMobile(normal.w)).total, 226);
  });

  it('Mobile 4 e 8. quantidade não altera o preço unitário; produto em promoção igual ao fluxo normal do Mobile', async () => {
    const linha = await abrirMobilePreco();
    assert.equal(await linhaMobile(linha.w, linha.root, '4', [[ids.abacaxi, '1'], [ids.chocolate, '1'], [ids.morango, '1'], [ids.uva, '1']]), null);
    assert.deepEqual(carrinhoMobile(linha.w).map((i) => i.preco), [2, 2.5, 2.2, 3]);

    const normal = await abrirMobilePreco();
    assert.ok(await adicionarNormalMobile(normal.w, normal.root, ids.uva, 10));
    const viaLinha = await abrirMobilePreco();
    assert.equal(await linhaMobile(viaLinha.w, viaLinha.root, '10', [[ids.uva, '10']]), null);
    assert.deepEqual(carrinhoMobile(viaLinha.w), carrinhoMobile(normal.w));
  });

  it('Mobile 9 e 10. produto sem preço: nada entra, carrinho anterior intacto, distribuição mantida', async () => {
    const { w, root } = await abrirMobilePreco();
    w.sessionStorage.setItem('cds-mobile-pdv-cart', JSON.stringify([
      { id: String(ids.sorvete), nome: 'Sorvete Morango', preco: 5, qtd: 2, forma_comercializacao: 'UNIDADE', unidade_comercial: 'UN' }
    ]));
    const carrinhoAntes = w.sessionStorage.getItem('cds-mobile-pdv-cart');
    const { continuar } = await amb.mobileConcluido(w, root, ids.linha, '15', [[ids.abacaxi, '10'], [ids.semPreco, '5']]);
    const distribuicao = json(w.PdvVendaPorLinha.distribuicaoConfirmada());
    continuar.click();
    const erro = () => w.document.getElementById('pdv-linha-conclusao-erro');
    await esperar(() => erro()?.style.display === '', 'erro no Mobile');
    assert.equal(erro().textContent, 'Não foi possível encontrar o preço de Picolé Sem Preço.');
    assert.equal(w.sessionStorage.getItem('cds-mobile-pdv-cart'), carrinhoAntes, 'carrinho exatamente como estava');
    assert.deepEqual(json(w.PdvVendaPorLinha.distribuicaoConfirmada()), distribuicao, 'distribuição mantida');
  });

  it('7. contexto de canal/tabela (atacado oficial por quantidade) igual ao fluxo normal, item a item, Desktop e Mobile', async () => {
    const atacado = await get(`SELECT id FROM canais_venda WHERE UPPER(codigo) = 'ATACADO'`);
    assert.ok(atacado, 'canal ATACADO');
    const tabelas = require('../../backend/modules/comercial/tabelas-preco/TabelasPrecoService');
    await tabelas.criar({
      codigo: 'ATAC-LP08', nome: 'Atacado LP08', canal_venda_id: atacado.id, ativo: true,
      atacado_habilitado: true, quantidade_minima: 100, tipo_contagem: 'TOTAL_VENDA',
      itens: [
        { produto_id: ids.abacaxi, canal_venda_id: atacado.id, preco: 1.5 },
        { produto_id: ids.chocolate, canal_venda_id: atacado.id, preco: 1.8 }
      ]
    });
    const cfg = await api('PUT', '/configuracao-comercial', { atacado_habilitado: true, quantidade_minima: 100, tipo_contagem: 'TOTAL_VENDA' });
    assert.equal(cfg.status, 200, JSON.stringify(cfg.body));
    const oficial = await amb.enviar('configuracao-comercial/resolver-precos', {
      itens: [{ produto_id: ids.abacaxi, quantidade: 40 }, { produto_id: ids.chocolate, quantidade: 60 }]
    });
    assert.equal(oficial.canal, 'ATACADO', 'Resolver oficial: 100 itens → atacado');
    assert.deepEqual(oficial.itens.map((r) => Number(r.preco_venda)), [1.5, 1.8], 'preço da tabela de atacado por produto');

    const normal = await amb.abrirDesktop();
    await normal.carregarConfigComercialPdv();
    await adicionarNormalDesktop(normal, ids.abacaxi, 40);
    await adicionarNormalDesktop(normal, ids.chocolate, 60);
    const linha = await amb.abrirDesktop();
    await linha.carregarConfigComercialPdv();
    assert.equal(await linhaDesktop(linha, '100', [[ids.abacaxi, '40'], [ids.chocolate, '60']]), null);
    const viaLinha = carrinhoDesktop(linha);
    assert.deepEqual(viaLinha, carrinhoDesktop(normal), 'Desktop: Linha = adição normal no contexto de atacado');
    assert.deepEqual(viaLinha.map((i) => [i.id, i.quantidade, i.preco_unitario, i.canal]), [
      [ids.abacaxi, 40, 1.5, 'ATACADO'], [ids.chocolate, 60, 1.8, 'ATACADO']
    ], 'dois itens independentes (40 + 60), cada um com o preço da tabela');

    const normalM = await abrirMobilePreco();
    assert.ok(await adicionarNormalMobile(normalM.w, normalM.root, ids.abacaxi, 40));
    assert.ok(await adicionarNormalMobile(normalM.w, normalM.root, ids.chocolate, 60));
    const linhaM = await abrirMobilePreco();
    assert.equal(await linhaMobile(linhaM.w, linhaM.root, '100', [[ids.abacaxi, '40'], [ids.chocolate, '60']]), null);
    const viaLinhaM = carrinhoMobile(linhaM.w);
    assert.deepEqual(viaLinhaM, carrinhoMobile(normalM.w), 'Mobile: Linha = adição normal no contexto de atacado');
    assert.deepEqual(viaLinhaM.map((i) => [i.id, i.qtd, i.preco, i.canal]), [
      [ids.abacaxi, 40, 1.5, 'ATACADO'], [ids.chocolate, 60, 1.8, 'ATACADO']
    ]);
  });
});
