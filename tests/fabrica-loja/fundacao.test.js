/**
 * Fundação Fábrica × Loja. Banco temporário. Não usa o banco oficial.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');

const dir = path.join(os.tmpdir(), 'cds-fabrica-loja-testes');
fs.mkdirSync(dir, { recursive: true });
const arquivo = path.join(dir, 'fundacao.db');
for (const sufixo of ['', '-wal', '-shm']) {
  fs.rmSync(arquivo + sufixo, { force: true });
}

const { bootstrapFabricaLojaSchema, obterContexto, registrarUnidade, constants } = require('../../backend/modules/fabrica-loja');

function abrir() {
  return new sqlite3.Database(arquivo);
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => (err ? reject(err) : resolve()));
  });
}

describe('Fábrica × Loja — fundação', () => {
  let db;

  before(async () => {
    db = abrir();
    await run(db, 'CREATE TABLE vendas (id INTEGER PRIMARY KEY, total REAL)');
    await run(db, 'INSERT INTO vendas (id, total) VALUES (1, 25)');
    await run(db, "CREATE TABLE configuracoes (chave TEXT PRIMARY KEY, valor TEXT)");
    await run(db, "INSERT INTO configuracoes (chave, valor) VALUES ('nome_empresa', 'Cremolícia')");
    await bootstrapFabricaLojaSchema(db);
  });

  after(() => {
    if (db) db.close();
  });

  it('identifica a operação atual como Loja e não duplica ao repetir a base', async () => {
    const contexto = await obterContexto(db);
    assert.equal(contexto.preserva_loja, true);
    assert.equal(contexto.unidade_atual.tipo, 'LOJA');
    assert.equal(contexto.unidade_atual.codigo, 'LOJA');
    assert.equal(contexto.unidade_atual.nome, 'Cremolícia');
    assert.equal(contexto.unidade_atual.padrao, true);
    assert.deepEqual(contexto.fora_de_escopo, constants.FORA_DE_ESCOPO);
    await bootstrapFabricaLojaSchema(db);
    const unidades = contexto.unidades;
    const deNovo = await obterContexto(db);
    assert.equal(deNovo.unidades.length, unidades.length);
    assert.equal(deNovo.unidade_atual.id, contexto.unidade_atual.id);
  });

  it('registrar a Fábrica não troca a Loja atual', async () => {
    const fabrica = await registrarUnidade(db, { codigo: 'fab-01', nome: 'Fábrica', tipo: 'FABRICA' });
    assert.equal(fabrica.tipo, 'FABRICA');
    assert.equal(fabrica.padrao, false);
    const contexto = await obterContexto(db);
    assert.equal(contexto.unidade_atual.tipo, 'LOJA');
    assert.equal(contexto.unidade_atual.codigo, 'LOJA');
    await assert.rejects(
      () => registrarUnidade(db, { codigo: 'FAB-02', nome: 'Outra', tipo: 'FABRICA', padrao: true }),
      (err) => err.code === 'TROCA_DE_CONTEXTO_BLOQUEADA'
    );
  });

  it('não cria fluxo de produção, transferência, compras ou fiscal e preserva a venda', async () => {
    const tabelas = await all(db, "SELECT name FROM sqlite_master WHERE type = 'table'");
    const nomes = tabelas.map((t) => t.name);
    assert.ok(nomes.includes('unidades_negocio'));
    assert.ok(nomes.includes('fichas_tecnicas'));
    assert.ok(nomes.includes('necessidades_producao'));
    assert.equal(nomes.includes('ordens_producao'), true);
    assert.equal(nomes.includes('ordem_producao_itens'), true);
    for (const proibida of ['producao', 'transferencias', 'estoque_movimentacoes']) {
      assert.equal(nomes.includes(proibida), false, proibida);
    }
    const venda = await all(db, 'SELECT id, total FROM vendas');
    assert.deepEqual(venda, [{ id: 1, total: 25 }]);
  });
});
