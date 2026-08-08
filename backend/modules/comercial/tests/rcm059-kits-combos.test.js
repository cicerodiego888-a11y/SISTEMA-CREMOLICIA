/**
 * RCM-05.9 — Motor de Kits e Combos
 */

const assert = require('assert');
const path = require('path');

const KitService = require(path.join(__dirname, '../kits/KitService'));
const KitItemService = require(path.join(__dirname, '../kits/KitItemService'));
const KitVendaService = require(path.join(__dirname, '../kits/KitVendaService'));
const Forma = require(path.join(__dirname, '../preco/FormaComercializacao'));
const { bootstrapComercialV2Schema } = require(path.join(__dirname, '../index'));
const db = require(path.join(__dirname, '../../../database'));

function whenReady() {
  return new Promise((resolve, reject) => {
    if (typeof db.whenReady === 'function') {
      db.whenReady((err) => (err ? reject(err) : resolve()));
      return;
    }
    setTimeout(resolve, 500);
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

async function criarProduto(nome, preco, estoque = 100) {
  const result = await dbRun(
    `INSERT INTO produtos (nome, codigo, preco_venda, estoque_atual, ativo, unidade)
     VALUES (?, ?, ?, ?, 1, 'UN')`,
    [nome, `P${Date.now()}${Math.floor(Math.random() * 999)}`, preco, estoque]
  );
  return result.lastID;
}

async function run() {
  await whenReady();
  await bootstrapComercialV2Schema(db);

  assert.ok(Forma.FORMAS.KIT === 'KIT', 'forma KIT registrada');
  assert.strictEqual(Forma.unidadePadraoDaForma('KIT'), 'UN');

  const cols = await new Promise((resolve, reject) => {
    db.all(`PRAGMA table_info(kits)`, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
  assert.ok(cols.some((c) => c.name === 'tipo_formacao'), 'coluna tipo_formacao');
  assert.ok(cols.some((c) => c.name === 'modo_fiscal'), 'coluna modo_fiscal');

  const p1 = await criarProduto('Sorvete 2L Teste', 25);
  const p2 = await criarProduto('Refrigerante Teste', 8);
  const p3 = await criarProduto('Casquinha Teste', 3);

  // —— Preço fixo
  const kitFixo = await KitService.criar({
    codigo: `KITFIXO${Date.now()}`,
    descricao: 'Combo Família Fixo',
    tipo_formacao: 'FIXO',
    preco: 49.9,
    modo_fiscal: 'KIT',
    itens: [
      { produto_id: p1, quantidade: 1, obrigatorio: true },
      { produto_id: p2, quantidade: 2, obrigatorio: true },
      { produto_id: p3, quantidade: 4, obrigatorio: true }
    ]
  });
  assert.ok(kitFixo.id, 'kit fixo criado');
  assert.ok(kitFixo.produto_id, 'produto vinculado');
  assert.strictEqual(Number(kitFixo.preco), 49.9);
  assert.strictEqual(kitFixo.itens.length, 3);

  const prodKit = await dbGet(`SELECT * FROM produtos WHERE id = ?`, [kitFixo.produto_id]);
  assert.strictEqual(String(prodKit.forma_comercializacao).toUpperCase(), 'KIT');
  assert.strictEqual(Number(prodKit.eh_kit), 1);
  assert.strictEqual(Number(prodKit.estoque_atual), 0, 'kit sem estoque próprio');

  // —— Soma dos itens
  const kitSoma = await KitService.criar({
    codigo: `KITSOMA${Date.now()}`,
    descricao: 'Combo Soma',
    tipo_formacao: 'SOMA',
    preco: 0,
    modo_fiscal: 'ITENS',
    itens: [
      { produto_id: p1, quantidade: 1 },
      { produto_id: p2, quantidade: 2 }
    ]
  });
  const esperadoSoma = Number((25 + 8 * 2).toFixed(2));
  assert.strictEqual(Number(kitSoma.preco), esperadoSoma, 'preço = soma dos itens');

  // —— Baixa de estoque (cálculo)
  const baixas = KitVendaService.calcularBaixaEstoque(kitFixo, 2);
  assert.strictEqual(baixas.length, 3);
  const b1 = baixas.find((b) => b.produto_id === p1);
  const b2 = baixas.find((b) => b.produto_id === p2);
  const b3 = baixas.find((b) => b.produto_id === p3);
  assert.strictEqual(b1.quantidade, 2);
  assert.strictEqual(b2.quantidade, 4);
  assert.strictEqual(b3.quantidade, 8);

  // —— Histórico (sem FK de venda: usa tabela direta se possível)
  let vendaId = null;
  try {
    const v = await dbRun(
      `INSERT INTO vendas (data_venda, total, forma_pagamento, status)
       VALUES (date('now','localtime'), 49.9, 'dinheiro', 'concluida')`
    );
    vendaId = v.lastID;
  } catch (e1) {
    const v = await dbRun(
      `INSERT INTO vendas (data_venda, total) VALUES (date('now'), 49.9)`
    );
    vendaId = v.lastID;
  }
  const vendaItemFake = await dbRun(
    `INSERT INTO vendas_itens (venda_id, produto_id, quantidade, preco_unitario, subtotal, forma_comercializacao)
     VALUES (?, ?, 1, 49.9, 49.9, 'KIT')`,
    [vendaId, kitFixo.produto_id]
  );
  await KitVendaService.gravarHistorico(vendaItemFake.lastID, kitFixo, baixas.slice(0, 3).map((b) => ({
    ...b,
    quantidade: b.quantidade / 2
  })));
  const hist = await KitVendaService.listarHistoricoDoItem(vendaItemFake.lastID);
  assert.strictEqual(hist.length, 3, 'histórico com 3 itens');

  // —— Fiscal: modo KIT mantém linha; modo ITENS explode
  const itemVenda = {
    id: vendaItemFake.lastID,
    produto_id: kitFixo.produto_id,
    quantidade: 1,
    quantidade_fiscal: 1,
    valor_fiscal: 49.9,
    forma_comercializacao: 'KIT'
  };
  const fiscalKit = await KitVendaService.expandirItensParaFiscal([itemVenda]);
  assert.strictEqual(fiscalKit.length, 1, 'modo KIT = 1 linha fiscal');

  const vendaItemSoma = await dbRun(
    `INSERT INTO vendas_itens (venda_id, produto_id, quantidade, preco_unitario, subtotal, forma_comercializacao)
     VALUES (?, ?, 1, ?, ?, 'KIT')`,
    [vendaId, kitSoma.produto_id, esperadoSoma, esperadoSoma]
  );
  const compsSoma = KitVendaService.calcularBaixaEstoque(kitSoma, 1);
  await KitVendaService.gravarHistorico(vendaItemSoma.lastID, kitSoma, compsSoma);
  const itemSoma = {
    id: vendaItemSoma.lastID,
    produto_id: kitSoma.produto_id,
    quantidade: 1,
    quantidade_fiscal: 1,
    valor_fiscal: esperadoSoma,
    forma_comercializacao: 'KIT'
  };
  const fiscalItens = await KitVendaService.expandirItensParaFiscal([itemSoma]);
  assert.ok(fiscalItens.length >= 2, 'modo ITENS explode componentes');
  const somaFiscal = fiscalItens.reduce((s, i) => s + Number(i.valor_fiscal || 0), 0);
  assert.ok(Math.abs(somaFiscal - esperadoSoma) < 0.02, 'rateio fiscal soma ≈ preço kit');

  // —— Preview PDV / Mobile
  const preview = await KitVendaService.previewVenda(kitFixo.produto_id, { quantidade: 1 });
  assert.strictEqual(preview.descricao, kitFixo.descricao);
  assert.ok(preview.itens.length === 3);
  assert.strictEqual(Number(preview.preco), 49.9);

  // —— KitItemService
  const itens = await KitItemService.listarPorKit(kitFixo.id);
  assert.ok(itens.every((i) => i.preco_individual >= 0), 'preço individual informativo');

  // —— Regressão: não permite kit dentro de kit
  let bloqueou = false;
  try {
    await KitItemService.adicionar(kitFixo.id, { produto_id: kitSoma.produto_id, quantidade: 1 });
  } catch (_) {
    bloqueou = true;
  }
  assert.ok(bloqueou, 'bloqueia kit como componente');

  // —— Busca por produto
  const porProd = await KitService.buscarPorProdutoId(kitFixo.produto_id);
  assert.ok(porProd && porProd.id === kitFixo.id);

  console.log('RCM-05.9 OK — Kits e Combos');
}

run().catch((err) => {
  console.error('RCM-05.9 FALHOU:', err);
  process.exit(1);
});
