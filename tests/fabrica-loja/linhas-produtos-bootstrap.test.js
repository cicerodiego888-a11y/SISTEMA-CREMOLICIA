'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-linhas-produtos-bootstrap-'));
process.env.DB_DIR = dbDir;
process.env.PORT = '0';

const db = require('../../backend/database');
const FabricaLoja = require('../../backend/modules/fabrica-loja');

function whenReady() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout aguardando bootstrap do banco')), 60000);
    db.whenReady((err) => {
      clearTimeout(timeout);
      if (err) reject(err);
      else resolve();
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

async function verificarEstrutura() {
  const tabela = await get(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'linhas_produtos'"
  );
  assert.ok(tabela, 'bootstrap oficial deve criar linhas_produtos');
  for (const nome of [
    'linhas_produtos_legado',
    'conversoes_estoque_linha',
    'conversoes_estoque_linha_itens'
  ]) {
    assert.ok(await get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [nome]),
      `migração 011 deve criar ${nome} após a migração 010`);
  }

  const colunasProdutos = await all('PRAGMA table_info(produtos)');
  assert.ok(
    colunasProdutos.some((coluna) => coluna.name === 'linha_produtos_id'),
    'bootstrap oficial deve adicionar produtos.linha_produtos_id'
  );

  for (const nome of [
    'idx_linhas_produtos_nome',
    'idx_linhas_produtos_codigo',
    'idx_produtos_linha_produtos'
  ]) {
    assert.ok(await get('SELECT name FROM sqlite_master WHERE type = ? AND name = ?', [
      nome.startsWith('trg_') ? 'trigger' : 'index',
      nome
    ]), `estrutura ${nome} deve existir`);
  }

  for (const nome of [
    'trg_produtos_linha_produtos_insert',
    'trg_produtos_linha_produtos_update',
    'trg_linhas_produtos_delete'
  ]) {
    assert.ok(await get("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = ?", [nome]));
  }
}

async function main() {
  try {
    assert.ok(db.dbPath.toLowerCase().startsWith(dbDir.toLowerCase()), `banco fora do temporário: ${db.dbPath}`);
    await whenReady();
    await verificarEstrutura();

    const produto = await run(
      `INSERT INTO produtos (codigo, nome, preco_venda, estoque_atual)
       VALUES (?, ?, ?, ?)`,
      ['LP-BOOTSTRAP-TESTE', 'Produto preexistente', 12.5, 37]
    );
    const produtoAntes = await get(
      'SELECT id, codigo, nome, preco_venda, estoque_atual FROM produtos WHERE id = ?',
      [produto.id]
    );

    await run('DROP TABLE IF EXISTS conversoes_estoque_linha_itens');
    await run('DROP TABLE IF EXISTS conversoes_estoque_linha');
    await run('DROP TABLE IF EXISTS linhas_produtos_legado');
    await run('DROP TRIGGER IF EXISTS trg_produtos_linha_produtos_insert');
    await run('DROP TRIGGER IF EXISTS trg_produtos_linha_produtos_update');
    await run('DROP TRIGGER IF EXISTS trg_linhas_produtos_delete');
    await run('DROP INDEX IF EXISTS idx_produtos_linha_produtos');
    await run('DROP TABLE linhas_produtos');
    await run('ALTER TABLE produtos DROP COLUMN linha_produtos_id');

    await FabricaLoja.bootstrapFabricaLojaSchema(db);
    await verificarEstrutura();
    await FabricaLoja.bootstrapFabricaLojaSchema(db);
    await verificarEstrutura();

    const produtoDepois = await get(
      'SELECT id, codigo, nome, preco_venda, estoque_atual FROM produtos WHERE id = ?',
      [produto.id]
    );
    assert.deepEqual(produtoDepois, produtoAntes, 'bootstrap deve preservar os dados preexistentes do produto');

    const contagens = await all(`
      SELECT type, name, COUNT(*) AS quantidade
      FROM sqlite_master
      WHERE name IN (
        'linhas_produtos',
        'linhas_produtos_legado',
        'conversoes_estoque_linha',
        'conversoes_estoque_linha_itens',
        'idx_linhas_produtos_nome',
        'idx_linhas_produtos_codigo',
        'idx_produtos_linha_produtos',
        'trg_produtos_linha_produtos_insert',
        'trg_produtos_linha_produtos_update',
        'trg_linhas_produtos_delete'
      )
      GROUP BY type, name
    `);
    assert.equal(contagens.length, 10, 'não deve haver estruturas duplicadas');
    console.log('OK: bootstrap oficial cria e reaplica a migração 010 sem duplicar estruturas.');
    console.log('OK: produto preexistente permaneceu íntegro na atualização e reaplicação.');
  } finally {
    await new Promise((resolve) => db.close(() => resolve()));
    fs.rmSync(dbDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
