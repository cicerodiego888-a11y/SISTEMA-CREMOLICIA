/**
 * Destino da compra: o estoque entra no produto vinculado, pelo Motor de Estoque.
 * Banco temporário. Não cria produto, OP nem produção.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const MotorEstoque = require('../../backend/motores/motor-estoque');
const { listarInsumos } = require('../../backend/modules/fabrica-loja');

const dir = path.join(os.tmpdir(), 'cds-fabrica-loja-testes');
fs.mkdirSync(dir, { recursive: true });
const arquivo = path.join(dir, 'compra-insumo.db');
for (const sufixo of ['', '-wal', '-shm']) {
  fs.rmSync(arquivo + sufixo, { force: true });
}

function abrir() {
  return new sqlite3.Database(arquivo);
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => (err ? reject(err) : resolve()));
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

describe('Compra vinculada ao produto', () => {
  let db;

  before(async () => {
    db = abrir();
    await run(db, `
      CREATE TABLE produtos (
        id INTEGER PRIMARY KEY,
        codigo TEXT,
        nome TEXT,
        unidade TEXT,
        estoque_atual REAL DEFAULT 0,
        saldo_fiscal REAL DEFAULT 0,
        saldo_nao_fiscal REAL DEFAULT 0,
        controlar_validade INTEGER DEFAULT 0,
        ativo INTEGER DEFAULT 1,
        natureza_cadastro TEXT,
        updated_at TEXT
      )
    `);
    await run(db, "INSERT INTO produtos (id, codigo, nome, unidade, estoque_atual, saldo_fiscal, natureza_cadastro) VALUES (1, 'LEI', 'Leite', 'L', 0, 0, 'INSUMO')");
    await run(db, "INSERT INTO produtos (id, codigo, nome, unidade, estoque_atual, saldo_fiscal, natureza_cadastro) VALUES (2, 'CHO', 'Chocolate', 'KG', 50, 50, 'INSUMO')");
    await run(db, "INSERT INTO produtos (id, codigo, nome, unidade, estoque_atual, saldo_fiscal) VALUES (3, 'FRZ', 'Freezer', 'UN', 0, 0)");
    await MotorEstoque.bootstrapMotorEstoqueSchema(db);
  });

  after(() => {
    if (db) db.close();
  });

  it('abastece o insumo vinculado e não trata o freezer como insumo', async () => {
    const compras = fs.readFileSync(path.join(__dirname, '../../backend/rotas/compras.js'), 'utf8');
    const confirmacao = fs.readFileSync(path.join(__dirname, '../../backend/modules/compras/confirmarProdutoItem.js'), 'utf8');
    const vinculo = compras.slice(
      compras.indexOf('function ensureProductForItem('),
      compras.indexOf('function processarItensCompra')
    );
    assert.equal(confirmacao.includes('natureza_cadastro'), false);
    assert.match(confirmacao, /Number\(item\.produto_id\) > 0/);
    assert.match(vinculo, /confirmarProdutoItemCompra\(db, item/);
    assert.match(compras, /MotorEstoque\.entrar\(db,/);

    const antes = await all(db, 'SELECT id FROM produtos ORDER BY id');
    await MotorEstoque.entrar(db, {
      produtoId: 1,
      quantidadeBase: 100,
      quantidadeFiscal: 100,
      origem: MotorEstoque.OrigemEstoque.COMPRA,
      referenciaTipo: 'compra',
      referenciaId: 90,
      motivo: 'ENTRADA_COMPRA:90'
    });
    await MotorEstoque.entrar(db, {
      produtoId: 2,
      quantidadeBase: 30,
      quantidadeFiscal: 30,
      origem: MotorEstoque.OrigemEstoque.COMPRA,
      referenciaTipo: 'compra',
      referenciaId: 90
    });
    await MotorEstoque.entrar(db, {
      produtoId: 3,
      quantidadeBase: 1,
      quantidadeFiscal: 1,
      origem: MotorEstoque.OrigemEstoque.COMPRA,
      referenciaTipo: 'compra',
      referenciaId: 90
    });

    const depois = await all(db, 'SELECT id, nome, natureza_cadastro, estoque_atual FROM produtos ORDER BY id');
    assert.deepEqual(depois.map((row) => row.id), antes.map((row) => row.id));
    assert.equal(Number(depois[0].estoque_atual), 100);
    assert.equal(depois[0].natureza_cadastro, 'INSUMO');
    assert.equal(Number(depois[1].estoque_atual), 80);
    assert.equal(depois[1].natureza_cadastro, 'INSUMO');
    assert.equal(Number(depois[2].estoque_atual), 1);
    assert.equal(depois[2].natureza_cadastro, null);

    const insumos = await listarInsumos(db, '');
    assert.deepEqual(insumos.map((item) => item.id).sort(), [1, 2]);
    const freezer = await get(db, 'SELECT natureza_cadastro FROM produtos WHERE id = 3');
    assert.notEqual(freezer.natureza_cadastro, 'INSUMO');

    const movimentos = await all(db, "SELECT operacao FROM estoque_movimentacoes WHERE referencia_id = 90");
    assert.equal(movimentos.length, 3);
    assert.equal(movimentos.every((row) => row.operacao === 'ENTRADA'), true);
  });
});
