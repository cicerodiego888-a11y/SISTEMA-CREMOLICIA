/**
 * Natureza do produto usada pelo cadastro de insumos.
 * Banco temporário. Não usa o banco oficial e não movimenta estoque.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const { aplicarNaturezaCadastro, classificarNatureza } = require('../../backend/modules/fabrica-loja/naturezaCadastro');
const { listarInsumos } = require('../../backend/modules/fabrica-loja');

const dir = path.join(os.tmpdir(), 'cds-fabrica-loja-testes');
fs.mkdirSync(dir, { recursive: true });
const arquivo = path.join(dir, 'natureza-cadastro.db');
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

describe('Natureza do cadastro de insumos', () => {
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
        ativo INTEGER DEFAULT 1,
        natureza_cadastro TEXT,
        observacoes TEXT
      )
    `);
    await run(db, "INSERT INTO produtos (id, codigo, nome, unidade, estoque_atual, saldo_fiscal, natureza_cadastro) VALUES (10, 'PIC', 'Picolé', 'UN', 1630, 1630, 'PRODUZIDO')");
    await run(db, "INSERT INTO produtos (id, codigo, nome, unidade, estoque_atual, saldo_fiscal, natureza_cadastro) VALUES (11, 'COM', 'Copo', 'UN', 40, 40, 'COMERCIAL')");
    await run(db, "INSERT INTO produtos (id, codigo, nome, unidade, estoque_atual, saldo_fiscal) VALUES (12, 'LEI', 'Leite', 'L', 25, 25)");
  });

  after(() => {
    if (db) db.close();
  });

  it('aceita somente as naturezas oficiais', () => {
    assert.equal(classificarNatureza(' insumo '), 'INSUMO');
    assert.equal(classificarNatureza('produzido'), 'PRODUZIDO');
    assert.equal(classificarNatureza('texto livre'), null);
  });

  it('grava INSUMO sem alterar estoque e sem aparecer produto produzido na busca', async () => {
    const alterou = await aplicarNaturezaCadastro(db, 12, {
      natureza_cadastro: 'INSUMO',
      observacoes: 'Câmara fria'
    });
    assert.equal(alterou, true);
    const leite = await get(db, 'SELECT natureza_cadastro, observacoes, estoque_atual, saldo_fiscal, saldo_nao_fiscal FROM produtos WHERE id = 12');
    assert.equal(leite.natureza_cadastro, 'INSUMO');
    assert.equal(leite.observacoes, 'Câmara fria');
    assert.equal(Number(leite.estoque_atual), 25);
    assert.equal(Number(leite.saldo_fiscal), 25);
    assert.equal(Number(leite.saldo_nao_fiscal), 0);

    const busca = await listarInsumos(db, 'lei');
    assert.deepEqual(busca.map((item) => item.id), [12]);
    const produzido = await listarInsumos(db, 'pic');
    assert.equal(produzido.length, 0);
    const comercial = await listarInsumos(db, 'copo');
    assert.equal(comercial.length, 0);

    const picole = await get(db, 'SELECT estoque_atual, natureza_cadastro FROM produtos WHERE id = 10');
    assert.equal(Number(picole.estoque_atual), 1630);
    assert.equal(picole.natureza_cadastro, 'PRODUZIDO');
  });

  it('não grava natureza inválida e não mexe no estoque', async () => {
    await aplicarNaturezaCadastro(db, 11, { natureza_cadastro: 'MATERIA' });
    const copo = await get(db, 'SELECT natureza_cadastro, estoque_atual FROM produtos WHERE id = 11');
    assert.equal(copo.natureza_cadastro, 'COMERCIAL');
    assert.equal(Number(copo.estoque_atual), 40);
  });

  it('insumo inativo continua fora da busca de novo componente', async () => {
    await run(db, 'UPDATE produtos SET ativo = 0 WHERE id = 12');
    const busca = await listarInsumos(db, 'leite');
    assert.equal(busca.length, 0);
    const leite = await get(db, 'SELECT estoque_atual, natureza_cadastro FROM produtos WHERE id = 12');
    assert.equal(leite.natureza_cadastro, 'INSUMO');
    assert.equal(Number(leite.estoque_atual), 25);
  });
});
