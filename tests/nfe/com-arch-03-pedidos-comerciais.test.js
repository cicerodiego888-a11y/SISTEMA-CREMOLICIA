'use strict';

/**
 * COM-ARCH-03 — pedidos legada intacta e pedidos_comerciais como modelo novo.
 * Não usa o banco oficial.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const migration022 = require('../../backend/modules/comercial/migrations/022_pedidos_comerciais');
const pedidos = require('../../backend/services/pedidos/orcamentoPedidoService');
const emissor = require('../../backend/services/fiscal/nfeEmissorVenda');

const DDL_PEDIDOS_LEGADA = `CREATE TABLE pedidos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        codigo VARCHAR(50) UNIQUE,
        data_pedido DATE NOT NULL,
        cliente_id INTEGER,
        total DECIMAL(10,2) NOT NULL DEFAULT 0,
        desconto DECIMAL(10,2) DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'AGUARDANDO_FATURAMENTO',
        representante_id INTEGER,
        representante_nome TEXT,
        observacao TEXT,
        operador_id INTEGER,
        venda_id INTEGER,
        faturado_em DATETIME,
        faturado_por INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME, natureza_operacao TEXT, cfop TEXT, frete REAL DEFAULT 0, acrescimo REAL DEFAULT 0, transportadora TEXT, volumes REAL DEFAULT 0, peso REAL DEFAULT 0, dados_adicionais TEXT, mod_frete TEXT,
        FOREIGN KEY (cliente_id) REFERENCES clientes(id),
        FOREIGN KEY (venda_id) REFERENCES vendas(id)
      )`;

function abrir(arquivo) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(arquivo, (err) => (err ? reject(err) : resolve(db)));
  });
}
function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}
function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}
function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

describe('COM-ARCH-03 — separação pedidos legada × pedido comercial', () => {
  const arquivo = path.join(os.tmpdir(), `cds-arch-03-${process.pid}.db`);
  let db;

  after(async () => {
    if (db) await new Promise((resolve) => db.close(() => resolve()));
    fs.rmSync(arquivo, { force: true });
  });

  it('banco híbrido: legado intacto, modelo novo operacional, origem da NF-e', async () => {
    db = await abrir(arquivo);
    await run(db, 'PRAGMA foreign_keys = ON');
    await run(db, `CREATE TABLE clientes (
      id INTEGER PRIMARY KEY, nome TEXT, cpf_cnpj TEXT, rua TEXT, numero TEXT,
      bairro TEXT, cidade TEXT, uf TEXT, cep TEXT, inscricao_estadual TEXT
    )`);
    await run(db, 'CREATE TABLE produtos (id INTEGER PRIMARY KEY, nome TEXT)');
    await run(db, 'CREATE TABLE vendas (id INTEGER PRIMARY KEY, codigo TEXT, data_venda DATE NOT NULL, total REAL NOT NULL, pedido_id INTEGER)');
    await run(db, DDL_PEDIDOS_LEGADA);
    await run(db, `CREATE TABLE pedido_itens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pedido_id INTEGER NOT NULL,
      produto_id INTEGER NOT NULL,
      quantidade REAL NOT NULL,
      preco_unitario REAL NOT NULL,
      subtotal REAL NOT NULL,
      FOREIGN KEY (pedido_id) REFERENCES pedidos(id),
      FOREIGN KEY (produto_id) REFERENCES produtos(id)
    )`);
    await run(db, 'INSERT INTO clientes (id, nome) VALUES (1, ?)', ['MARIA']);
    await run(db, 'INSERT INTO produtos (id, nome) VALUES (1, ?)', ['AÇAÍ']);
    await run(db, 'INSERT INTO vendas (id, data_venda, total) VALUES (7, ?, 20)', ['2026-10-05']);
    const sqlAntes = (await get(db, "SELECT sql FROM sqlite_master WHERE name = 'pedidos'")).sql;

    await migration022(db);
    await migration022(db);

    const sqlDepois = (await get(db, "SELECT sql FROM sqlite_master WHERE name = 'pedidos'")).sql;
    assert.equal(sqlDepois, sqlAntes);
    assert.equal(await get(db, 'SELECT COUNT(*) AS n FROM pedidos').then((r) => r.n), 0);
    const comercial = await all(db, 'PRAGMA table_info(pedidos_comerciais)');
    const nomes = comercial.map((c) => c.name);
    for (const campo of ['id', 'codigo', 'origem', 'orcamento_id', 'cliente_id', 'total', 'desconto', 'total_itens', 'forma_pagamento', 'parcelas', 'observacoes', 'usuario_id', 'primeiro_vencimento', 'status', 'venda_id', 'created_at', 'updated_at', 'faturado_em']) {
      assert.ok(nomes.includes(campo), campo);
    }
    const idx = await all(db, "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'pedidos_comerciais'");
    assert.ok(idx.some((i) => i.name === 'idx_pedidos_comerciais_orcamento'));
    assert.equal(idx.some((i) => i.name === 'idx_pedidos_orcamento'), false);
    const fk = await all(db, 'PRAGMA foreign_key_list(pedido_itens)');
    assert.ok(fk.some((item) => item.from === 'pedido_id' && item.table === 'pedidos_comerciais'));
    assert.equal(fk.some((item) => item.table === 'pedidos'), false);

    const deps = { db };
    const orcamentosAntes = await pedidos.listarOrcamentos({}, deps);
    const pedidosAntes = await pedidos.listarPedidos({}, deps);
    assert.deepEqual(orcamentosAntes, []);
    assert.deepEqual(pedidosAntes, []);

    const orc = await pedidos.criarOrcamento({ cliente_id: 1, itens: [{ produto_id: 1, quantidade: 2, preco_unitario: 10 }] }, {}, deps);
    const aprovado = await pedidos.aprovarOrcamento(orc.id, {}, deps);
    assert.equal(aprovado.origem, 'ORCAMENTO');
    assert.equal(aprovado.orcamento_id, orc.id);
    assert.equal(aprovado.venda_id, null);
    const orcDepois = await pedidos.obterOrcamento(orc.id, deps);
    assert.equal(orcDepois.pedido_id, aprovado.id);
    assert.equal(orcDepois.status, 'APROVADO');
    const itens = await all(db, 'SELECT pedido_id, produto_id, quantidade FROM pedido_itens WHERE pedido_id = ?', [aprovado.id]);
    assert.equal(itens.length, 1);
    assert.equal(itens[0].quantidade, 2);

    const direto = await pedidos.criarPedidoDireto({ cliente_id: 1, itens: [{ produto_id: 1, quantidade: 1, preco_unitario: 9 }] }, {}, deps);
    assert.equal(direto.origem, 'DIRETO');
    assert.equal(direto.orcamento_id, null);
    const lista = await pedidos.listarPedidos({}, deps);
    assert.equal(lista.length, 2);
    assert.equal(await get(db, 'SELECT COUNT(*) AS n FROM pedidos').then((r) => r.n), 0);
    assert.equal(await get(db, 'SELECT COUNT(*) AS n FROM pedidos_comerciais').then((r) => r.n), 2);
    assert.equal(await get(db, 'SELECT COUNT(*) AS n FROM vendas').then((r) => r.n), 1);

    assert.deepEqual(await emissor.resolverOrigemNfeVenda(7, db), { origem: 'MANUAL', pedidoId: null });
    await run(db, 'UPDATE pedidos_comerciais SET venda_id = 7, status = ? WHERE id = ?', ['FATURADO', direto.id]);
    assert.deepEqual(await emissor.resolverOrigemNfeVenda(7, db), { origem: 'PEDIDO', pedidoId: direto.id });
    assert.equal((await get(db, 'SELECT pedido_id FROM vendas WHERE id = 7')).pedido_id, null);
  });
});
