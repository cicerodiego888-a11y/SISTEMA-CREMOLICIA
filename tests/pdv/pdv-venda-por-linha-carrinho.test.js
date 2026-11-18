/**
 * LINHA DE PRODUTOS 06 — Distribuição da Linha vira itens normais do carrinho (PDV Desktop e Mobile).
 * Cada produto_id entra pelo caminho normal do PDV (Resolver oficial de preço + regra normal do carrinho).
 * A Linha não entra no carrinho, não cria venda, não mexe em estoque e não emite NFC-e.
 * Desktop: pdv.js real inteiro no jsdom (jQuery/AJAX reais contra o servidor de teste).
 * Executar: npm run test:pdv-venda-linha-carrinho
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
  console.error('Banco isolado ausente. Execute: node -r ./tests/pdv/_bancoIsolado.js --test tests/pdv/pdv-venda-por-linha-carrinho.test.js');
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
let base;
let amb;
const abrirDesktop = (...a) => amb.abrirDesktop(...a);
const desktopConcluido = (...a) => amb.desktopConcluido(...a);
const desktopAdicionar = (...a) => amb.desktopAdicionar(...a);
const itensDesktop = (...a) => amb.itensDesktop(...a);
const abrirMobile = (...a) => amb.abrirMobile(...a);
const mobileConcluido = (...a) => amb.mobileConcluido(...a);
const carrinhoMobile = (...a) => amb.carrinhoMobile(...a);
const itensMobile = (...a) => amb.itensMobile(...a);
const precoOficial = (...a) => amb.precoOficial(...a);

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

async function api(method, rota, body, perfil = 'OPERADOR') {
  const resposta = await fetch(base + rota, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-perfil-teste': perfil },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: resposta.status, body: await resposta.json().catch(() => null) };
}

async function configurar(produto, linha) {
  const r = await api('PUT', '/configuracoes-avancadas/comercializacao', { permitirVendaPorProduto: produto, permitirVendaPorLinha: linha }, 'SUPER_ADMIN');
  assert.equal(r.status, 200);
}

async function inserirProduto(codigo, nome, linha, preco, estoque = 50) {
  return (await run(`INSERT INTO produtos (codigo, nome, unidade, preco_venda, ativo, natureza_cadastro, item_fiscal, linha_produtos_id, estoque_atual, saldo_nao_fiscal, saldo_fiscal)
    VALUES (?, ?, 'UN', ?, 1, 'PRODUZIDO', 1, ?, ?, ?, 0)`, [codigo, nome, preco, linha, estoque, estoque])).id;
}

async function contagens() {
  return {
    vendas: (await get('SELECT COUNT(*) AS q FROM vendas')).q,
    itens: (await get('SELECT COUNT(*) AS q FROM vendas_itens')).q,
    movimentos: (await get('SELECT COUNT(*) AS q FROM estoque_movimentacoes')).q,
    estoque: (await get('SELECT SUM(estoque_atual) AS q FROM produtos')).q,
    saldos: (await get('SELECT SUM(saldo_nao_fiscal) + SUM(saldo_fiscal) AS q FROM produtos')).q,
    nfce: (await get('SELECT COUNT(*) AS q FROM nfce_notas')).q,
    produtos: (await get('SELECT COUNT(*) AS q FROM produtos')).q,
    linhas: (await get('SELECT COUNT(*) AS q FROM linhas_produtos')).q
  };
}

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
  base = amb.base;

  const criarLinha = async (codigo, nome) => {
    const r = await api('POST', '/fabrica-loja/linhas-produtos', { codigo, nome }, 'SUPER_ADMIN');
    assert.ok(r.status < 300, JSON.stringify(r.body));
    return r.body.linha.id;
  };
  ids.cremoso = await criarLinha('CREM', 'Picolé Cremoso');
  ids.fruta = await criarLinha('FRUTA', 'Picolé de Fruta');
  ids.abacaxi = await inserirProduto('PC-ABA', 'Picolé Abacaxi', ids.cremoso, 3);
  ids.chocolate = await inserirProduto('PC-CHOC', 'Picolé Chocolate', ids.cremoso, 2.5);
  ids.morango = await inserirProduto('PC-MOR', 'Picolé Morango', ids.cremoso, 2);
  ids.uva = await inserirProduto('PF-UVA', 'Picolé Uva', ids.fruta, 2, 10);
  ids.limao = await inserirProduto('PF-LIM', 'Picolé Limão', ids.fruta, 2);
  ids.sorvete = await inserirProduto('SORV-MOR', 'Sorvete Morango', null, 5);
  await configurar(true, true);
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

describe('PDV — distribuição da Linha vira itens do carrinho', () => {
  it('1, 2, 3 e 5. Desktop: carrinho vazio recebe os produtos distribuídos, por produto_id e com a quantidade', async () => {
    const w = await abrirDesktop();
    assert.deepEqual(itensDesktop(w), []);
    await desktopConcluido(w, ids.cremoso, '100', [[ids.abacaxi, '30'], [ids.chocolate, '40'], [ids.morango, '30']]);
    assert.deepEqual(itensDesktop(w), [], 'concluir a distribuição sozinho não adiciona');

    assert.equal(await desktopAdicionar(w), null);
    assert.deepEqual(itensDesktop(w), [
      { id: ids.abacaxi, nome: 'Picolé Abacaxi', quantidade: 30 },
      { id: ids.chocolate, nome: 'Picolé Chocolate', quantidade: 40 },
      { id: ids.morango, nome: 'Picolé Morango', quantidade: 30 }
    ]);
    const carrinho = json(w.__pdvTeste.carrinho());
    assert.equal(carrinho.reduce((soma, item) => soma + item.quantidade, 0), 100);
    assert.ok(carrinho.every((item) => [ids.abacaxi, ids.chocolate, ids.morango].includes(item.id) && !/Cremoso/.test(item.nome)), 'a Linha não entra como produto');
    assert.doesNotMatch(JSON.stringify(carrinho), /linha_produtos/, 'a Linha não é gravada no item');
    assert.equal(w.document.querySelectorAll('#tabelaItensVendaPdv tr').length >= 3, true, 'atualizarCarrinho normal redesenhou a tabela');
  });

  it('4. produtos com quantidade zero não entram', async () => {
    const w = await abrirDesktop();
    await desktopConcluido(w, ids.cremoso, '80', [[ids.abacaxi, '45'], [ids.morango, '35']]);
    assert.equal(await desktopAdicionar(w), null);
    assert.deepEqual(itensDesktop(w).map((item) => item.id), [ids.abacaxi, ids.morango]);

    const zerado = await w.adicionarDistribuicaoLinhaNoCarrinhoPdv({
      linha_produtos_id: ids.cremoso, quantidade_total: 10,
      distribuicao: [{ produto_id: ids.chocolate, quantidade: 0 }, { produto_id: ids.morango, quantidade: 10 }]
    });
    assert.equal(zerado.ok, true);
    assert.ok(!itensDesktop(w).some((item) => item.id === ids.chocolate), 'quantidade 0 não vira item');
  });

  it('6 e 7. carrinho existente é preservado e produto repetido segue a regra normal do carrinho', async () => {
    const w = await abrirDesktop();
    const produtoNormal = (id) => json(w.__pdvTeste.produto(id));
    w.adicionarItemNoCarrinho(produtoNormal(ids.sorvete), 10, 5);
    w.adicionarItemNoCarrinho(produtoNormal(ids.abacaxi), 10, 3);
    const sorveteAntes = json(w.__pdvTeste.carrinho()[0]);

    await desktopConcluido(w, ids.cremoso, '50', [[ids.abacaxi, '20'], [ids.chocolate, '30']]);
    assert.equal(await desktopAdicionar(w), null);
    assert.deepEqual(itensDesktop(w), [
      { id: ids.sorvete, nome: 'Sorvete Morango', quantidade: 10 },
      { id: ids.abacaxi, nome: 'Picolé Abacaxi', quantidade: 30 },
      { id: ids.chocolate, nome: 'Picolé Chocolate', quantidade: 30 }
    ], 'Sorvete preservado, Abacaxi somado (10 + 20) como o PDV já faz, Chocolate novo');
    assert.deepEqual(json(w.__pdvTeste.carrinho()[0]), sorveteAntes, 'item existente intacto');
  });

  it('8. o preço segue o fluxo normal do PDV (Resolver oficial), sem preço de Linha', async () => {
    const w = await abrirDesktop();
    await desktopConcluido(w, ids.cremoso, '100', [[ids.abacaxi, '30'], [ids.chocolate, '25'], [ids.morango, '45']]);
    assert.equal(await desktopAdicionar(w), null);
    for (const item of json(w.__pdvTeste.carrinho())) {
      const oficial = await precoOficial(item.id, item.quantidade);
      assert.equal(item.preco_unitario, oficial, `${item.nome}: preço do Resolver`);
      assert.equal(item.subtotal, Number((item.quantidade * oficial).toFixed(2)));
      assert.equal(item.resolver, 'Motor Oficial');
      assert.equal(item.tipo_venda, 'PESO', 'mesmo tipo de item do fluxo normal');
    }
    const precos = Object.fromEntries(json(w.__pdvTeste.carrinho()).map((item) => [item.id, item.preco_unitario]));
    assert.deepEqual(precos, { [ids.abacaxi]: 3, [ids.chocolate]: 2.5, [ids.morango]: 2 }, 'cada produto com o seu preço');
    assert.match(extrairFuncao(fonteDesktop, 'adicionarDistribuicaoLinhaNoCarrinhoPdv'), /enriquecerProdutoCanalPdv\(/);
    assert.match(extrairFuncao(fonteDesktop, 'adicionarDistribuicaoLinhaNoCarrinhoPdv'), /adicionarItemNoCarrinho\(/);
  });

  it('9, 10 e 11. nenhuma venda, nenhum movimento de estoque e nenhuma NFC-e (Desktop e Mobile)', async () => {
    const antes = await contagens();
    const w = await abrirDesktop();
    await desktopConcluido(w, ids.cremoso, '100', [[ids.abacaxi, '30'], [ids.chocolate, '40'], [ids.morango, '30']]);
    assert.equal(await desktopAdicionar(w), null);
    assert.equal(itensDesktop(w).length, 3);

    const { w: mobile, root } = await abrirMobile();
    const { continuar } = await mobileConcluido(mobile, root, ids.cremoso, '100', [[ids.abacaxi, '30'], [ids.chocolate, '40'], [ids.morango, '30']]);
    continuar.click();
    await esperar(() => carrinhoMobile(mobile).length === 3, 'carrinho Mobile');

    assert.deepEqual(await contagens(), antes);
    for (const fonte of [extrairFuncao(fonteDesktop, 'adicionarDistribuicaoLinhaNoCarrinhoPdv'), extrairFuncao(fonteMobile, 'adicionarDistribuicaoLinhaNoCarrinhoMobile')]) {
      assert.doesNotMatch(fonte, /finalizar|\/vendas|nfce|emitir|estoque\/|movimenta|method:\s*'POST'/i);
    }
  });

  it('12. erro em um produto não deixa parte da distribuição no carrinho', async () => {
    const antes = await contagens();
    const w = await abrirDesktop();
    w.adicionarItemNoCarrinho(json(w.__pdvTeste.produto(ids.sorvete)), 2, 5);
    const carrinhoAntes = json(w.__pdvTeste.carrinho());

    // Saldo insuficiente (Uva tem 10): recusado antes de mexer no carrinho; o modal continua aberto.
    const { visivel } = await desktopConcluido(w, ids.fruta, '25', [[ids.limao, '5'], [ids.uva, '20']]);
    const erro = await desktopAdicionar(w);
    assert.match(erro, /Saldo insuficiente para Picolé Uva/);
    assert.deepEqual(json(w.__pdvTeste.carrinho()), carrinhoAntes, 'Limão não entrou sozinho');
    assert.ok(visivel('etapaProdutosLinhaPdv'), 'continua na lista para o operador corrigir');
    assert.deepEqual(
      Array.from(w.document.querySelectorAll('[data-quantidade-produto-id]')).map((el) => [
        Number(el.getAttribute('data-quantidade-produto-id')),
        el.value
      ]),
      [[ids.limao, '5'], [ids.uva, '20']],
      'quantidades individuais são preservadas após a falha'
    );
    assert.ok(w.__notificacoes.some((n) => n.tipo === 'danger' && /Saldo insuficiente/.test(n.mensagem)));
    w.bootstrap.Modal.getOrCreateInstance(w.document.getElementById('modalVendaPorLinhaPdv')).hide();

    // Falha no meio da inclusão (segundo produto recusado pelo carrinho): desfaz o que já tinha entrado.
    w.eval(`
      const adicionarReal = adicionarItemNoCarrinho;
      adicionarItemNoCarrinho = function (produto) {
        if (Number(produto.id) === ${ids.chocolate}) return;
        return adicionarReal.apply(this, arguments);
      };
    `);
    await desktopConcluido(w, ids.cremoso, '100', [[ids.abacaxi, '30'], [ids.chocolate, '40'], [ids.morango, '30']]);
    assert.match(await desktopAdicionar(w), /Não foi possível adicionar Picolé Chocolate\. Nenhum produto da linha foi incluído no carrinho\./);
    assert.deepEqual(json(w.__pdvTeste.carrinho()), carrinhoAntes, 'Abacaxi (já incluído) foi desfeito');

    // produto_id inválido: erro controlado, nada entra.
    const invalido = await w.adicionarDistribuicaoLinhaNoCarrinhoPdv({
      linha_produtos_id: ids.cremoso, quantidade_total: 20,
      distribuicao: [{ produto_id: ids.morango, quantidade: 10 }, { produto_id: 999999, quantidade: 10 }]
    });
    assert.equal(invalido.ok, false);
    assert.match(invalido.mensagem, /Produto não encontrado/);
    assert.deepEqual(json(w.__pdvTeste.carrinho()), carrinhoAntes);

    // Mobile: quantidade fracionada em produto vendido por unidade é recusada; nada é gravado no carrinho.
    const { w: mobile, root } = await abrirMobile();
    mobile.sessionStorage.setItem('cds-mobile-pdv-cart', JSON.stringify([{ id: String(ids.sorvete), nome: 'Sorvete Morango', preco: 5, qtd: 2, forma_comercializacao: 'UNIDADE' }]));
    const mobileAntes = carrinhoMobile(mobile);
    const { continuar } = await mobileConcluido(mobile, root, ids.cremoso, '100', [[ids.abacaxi, '74,5'], [ids.morango, '25,5']]);
    continuar.click();
    await esperar(() => mobile.document.getElementById('pdv-linha-conclusao-erro')?.style.display === '', 'erro no Mobile');
    assert.match(mobile.document.getElementById('pdv-linha-conclusao-erro').textContent, /A quantidade de Picolé Abacaxi deve ser inteira\./);
    assert.deepEqual(carrinhoMobile(mobile), mobileAntes, 'nada entrou no carrinho Mobile');
    assert.ok(mobile.PdvVendaPorLinha.distribuicaoConfirmada(), 'a distribuição não é perdida');
    assert.ok(mobile.toasts.some((t) => t.tipo === 'error'));

    const foraDaLinha = await mobile.adicionarDistribuicaoLinhaNoCarrinhoMobile(
      { linha_produtos_id: ids.cremoso, quantidade_total: 5, distribuicao: [{ produto_id: ids.sorvete, quantidade: 5 }] },
      mobile.PdvVendaPorLinha.obterSelecao().produtos
    );
    assert.deepEqual(json(foraDaLinha), { ok: false, mensagem: 'Produto não pertence à linha selecionada.' });
    assert.deepEqual(carrinhoMobile(mobile), mobileAntes);

    assert.deepEqual(await contagens(), antes, 'nenhuma venda parcial');
  });

  it('13. depois do sucesso o fluxo da Linha é fechado e o estado temporário é limpo', async () => {
    const w = await abrirDesktop();
    await desktopConcluido(w, ids.cremoso, '10', [[ids.morango, '10']]);
    assert.equal(await desktopAdicionar(w), null);
    assert.equal(w.document.getElementById('modalVendaPorLinhaPdv'), null, 'modal fechado');
    assert.equal(w.PdvVendaPorLinha.obterSelecao(), null, 'estado limpo');
    assert.equal(w.PdvVendaPorLinha.distribuicaoConfirmada(), null);
    assert.deepEqual(itensDesktop(w).map((item) => item.id), [ids.morango], 'carrinho mantido');

    const { w: mobile, root } = await abrirMobile();
    const { continuar } = await mobileConcluido(mobile, root, ids.cremoso, '10', [[ids.morango, '10']]);
    continuar.click();
    await esperar(() => carrinhoMobile(mobile).length === 1, 'carrinho Mobile');
    assert.equal(mobile.PdvVendaPorLinha.obterSelecao(), null, 'estado limpo no Mobile');
    assert.equal(mobile.document.getElementById('cds-mobile-sheet'), null, 'sheet da Linha fechado');
  });

  it('14. Desktop: fluxo completo pela interface', async () => {
    const w = await abrirDesktop();
    const { $ } = await desktopConcluido(w, ids.cremoso, '100', [[ids.abacaxi, '30'], [ids.chocolate, '25'], [ids.morango, '45']]);
    assert.equal($('#somaProdutosLinhaPdv').text(), '100', 'o total soma os campos individuais');
    assert.equal(await desktopAdicionar(w), null);
    assert.deepEqual(itensDesktop(w).map((item) => [item.id, item.quantidade]), [[ids.abacaxi, 30], [ids.chocolate, 25], [ids.morango, 45]]);
    assert.ok(w.__notificacoes.filter((n) => n.tipo === 'success' && /adicionado ao carrinho/.test(n.mensagem)).length >= 3, 'mensagem normal do carrinho');
    assert.ok(!w.__notificacoes.some((n) => n.tipo === 'danger'));
  });

  it('15. Mobile: fluxo completo, carrinho existente preservado e produto repetido somado pela regra normal', async () => {
    const { w, root } = await abrirMobile();
    w.sessionStorage.setItem('cds-mobile-pdv-cart', JSON.stringify([
      { id: String(ids.sorvete), nome: 'Sorvete Morango', preco: 5, qtd: 10, forma_comercializacao: 'UNIDADE', unidade_comercial: 'UN' },
      { id: String(ids.abacaxi), nome: 'Picolé Abacaxi', preco: 3, qtd: 10, forma_comercializacao: 'UNIDADE', unidade_comercial: 'UN' }
    ]));
    const { continuar } = await mobileConcluido(w, root, ids.cremoso, '100', [[ids.abacaxi, '20'], [ids.chocolate, '30'], [ids.morango, '50']]);
    continuar.click();
    await esperar(() => carrinhoMobile(w).length === 4, 'carrinho Mobile');
    assert.deepEqual(itensMobile(w), [
      { id: ids.sorvete, nome: 'Sorvete Morango', qtd: 10 },
      { id: ids.abacaxi, nome: 'Picolé Abacaxi', qtd: 30 },
      { id: ids.chocolate, nome: 'Picolé Chocolate', qtd: 30 },
      { id: ids.morango, nome: 'Picolé Morango', qtd: 50 }
    ]);
    await esperar(() => w.pinturas > 0, 'recalcular/pintar carrinho');
    for (const item of carrinhoMobile(w)) {
      assert.equal(item.preco, await precoOficial(Number(item.id), item.qtd), `${item.nome}: preço do Resolver`);
      assert.equal(item.resolver, 'Motor Oficial');
    }
    assert.ok(w.toasts.some((t) => t.tipo === 'success' && /3 produtos adicionados/.test(t.mensagem)));
    assert.equal(w.PdvVendaPorLinha.obterSelecao(), null);

    const buscaNormal = fonteMobile.slice(fonteMobile.indexOf("results.querySelectorAll('[data-pid]')"), fonteMobile.indexOf("root.querySelector('#pdv-muc-scan')"));
    assert.match(buscaNormal, /incluirItemNoCarrinhoMobile\(next, item\)/, 'a busca normal usa a mesma regra de inclusão');
    assert.match(extrairFuncao(fonteMobile, 'adicionarDistribuicaoLinhaNoCarrinhoMobile'), /incluirItemNoCarrinhoMobile\(next, novo\)/);
  });

  it('16. a venda tradicional por produto continua funcionando', async () => {
    const w = await abrirDesktop();
    w.adicionarItemNoCarrinho(json(w.__pdvTeste.produto(ids.sorvete)), 2, 5);
    w.adicionarItemNoCarrinho(json(w.__pdvTeste.produto(ids.sorvete)), 1, 5);
    assert.deepEqual(itensDesktop(w), [{ id: ids.sorvete, nome: 'Sorvete Morango', quantidade: 3 }]);

    const busca = await api('GET', '/produtos/consulta-pdv/buscar?q=SORV-MOR&modo_fiscal=0');
    assert.equal(busca.body[0].id, ids.sorvete);
    const VendaPagamentoService = require('../../backend/services/vendas/VendaPagamentoService');
    const resposta = await new Promise((resolve) => {
      const res = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(payload) { resolve({ status: this.statusCode, body: payload }); return this; }
      };
      VendaPagamentoService.criarVenda({
        body: {
          total: 10, forma_pagamento: 'dinheiro', valor_recebido: 10, emitir_fiscal: false, origem_pdv: 'PDV_DESKTOP',
          itens: [{ produto_id: ids.sorvete, quantidade: 2, preco_unitario: 5, subtotal: 10 }],
          pagamentos: [{ forma: 'dinheiro', valor: 10 }]
        },
        headers: {}, query: {}, user: { id: 1 }
      }, res);
    });
    assert.ok(resposta.status < 300, `status ${resposta.status}: ${JSON.stringify(resposta.body)}`);
    assert.deepEqual(await get('SELECT produto_id, quantidade FROM vendas_itens ORDER BY id DESC LIMIT 1'), { produto_id: ids.sorvete, quantidade: 2 });
    assert.equal((await get('SELECT estoque_atual FROM produtos WHERE id = ?', [ids.sorvete])).estoque_atual, 48);
  });
});
