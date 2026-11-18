/**
 * Linha de Produtos (FABRICA-MODELO-01). Banco temporário. Não usa o banco oficial.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const { salvarOrdem } = require('../../backend/modules/fabrica-loja/OrdemProducaoService');
const bootstrapLinhasProdutos = require('../../backend/modules/fabrica-loja/migrations/010_linhas_produtos');
const bootstrapOrdens = require('../../backend/modules/fabrica-loja/migrations/005_ordens_producao');
const bootstrapFichas = require('../../backend/modules/fabrica-loja/migrations/002_fichas_tecnicas');

const dir = path.join(os.tmpdir(), 'cds-fabrica-loja-testes');
fs.mkdirSync(dir, { recursive: true });
const arquivo = path.join(dir, 'linhas-produtos.db');
for (const sufixo of ['', '-wal', '-shm']) {
  fs.rmSync(arquivo + sufixo, { force: true });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
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

async function colunas(db, tabela) {
  return (await all(db, `PRAGMA table_info(${tabela})`)).map((c) => c.name);
}

describe('Linha de Produtos', () => {
  let db;
  let cremoso;
  let fruta;
  let precificacaoAntes;

  before(async () => {
    db = new sqlite3.Database(arquivo);
    await run(db, `
      CREATE TABLE produtos (
        id INTEGER PRIMARY KEY,
        codigo TEXT,
        nome TEXT,
        unidade TEXT,
        ativo INTEGER DEFAULT 1,
        estoque_atual REAL DEFAULT 0,
        saldo_fiscal REAL DEFAULT 0,
        saldo_nao_fiscal REAL DEFAULT 0,
        natureza_cadastro TEXT,
        linha_comercial_id INTEGER
      )
    `);
    await run(db, 'CREATE TABLE linhas_comerciais (id INTEGER PRIMARY KEY, nome TEXT, ativo INTEGER DEFAULT 1)');
    await run(db, "INSERT INTO linhas_comerciais (id, nome) VALUES (2, 'CREMOSA'), (27, 'FRUTA AO LEITE')");
    await run(db, 'CREATE TABLE estoque_movimentacoes (id INTEGER PRIMARY KEY, produto_id INTEGER NOT NULL, operacao TEXT)');
    await run(db, `INSERT INTO produtos (id, codigo, nome, unidade, estoque_atual, saldo_fiscal, natureza_cadastro, linha_comercial_id) VALUES
      (4, '0002', 'Picolé Chocolate', 'UN', 180, 180, 'PRODUZIDO', 2),
      (16, '00014', 'Picolé Abacaxi', 'UN', 250, 250, 'PRODUZIDO', 2),
      (5, '0003', 'Picolé Coco', 'UN', 1100, 1100, 'PRODUZIDO', 27),
      (59, '0056', 'Leite em pó', 'KG', 10, 10, 'INSUMO', NULL)`);
    precificacaoAntes = {
      schema: await get(db, "SELECT sql FROM sqlite_master WHERE name = 'linhas_comerciais'"),
      linhas: await all(db, 'SELECT * FROM linhas_comerciais ORDER BY id'),
      produtos: await all(db, 'SELECT id, linha_comercial_id FROM produtos ORDER BY id')
    };
    await bootstrapFichas(db);
    await bootstrapOrdens(db);
    await bootstrapLinhasProdutos(db);
    await bootstrapLinhasProdutos(db);
    cremoso = (await run(db, "INSERT INTO linhas_produtos (codigo, nome) VALUES ('PIC-CREMOSO', 'Picolé Cremoso')")).id;
    fruta = (await run(db, "INSERT INTO linhas_produtos (codigo, nome) VALUES ('PIC-FRUTA', 'Picolé Fruta ao Leite')")).id;
  });

  after(() => {
    if (db) db.close();
  });

  it('1. linha sem produtos é válida', async () => {
    const vazia = (await run(db, "INSERT INTO linhas_produtos (nome) VALUES ('Linha Vazia')")).id;
    const row = await get(db, 'SELECT COUNT(*) AS q FROM produtos WHERE linha_produtos_id = ?', [vazia]);
    assert.equal(row.q, 0);
    await run(db, 'DELETE FROM linhas_produtos WHERE id = ?', [vazia]);
  });

  it('2. produto sem linha é válido', async () => {
    const leite = await get(db, 'SELECT linha_produtos_id FROM produtos WHERE id = 59');
    assert.equal(leite.linha_produtos_id, null);
  });

  it('3. vários produtos na mesma linha, vinculados por ID', async () => {
    await run(db, 'UPDATE produtos SET linha_produtos_id = ? WHERE id IN (4, 16)', [cremoso]);
    const rows = await all(db, 'SELECT id FROM produtos WHERE linha_produtos_id = ? ORDER BY id', [cremoso]);
    assert.deepEqual(rows.map((r) => r.id), [4, 16]);
  });

  it('4. produto não pertence a duas linhas', async () => {
    const tabelasVinculo = await all(db, `
      SELECT m.name FROM sqlite_master m
      WHERE m.type = 'table' AND m.name <> 'produtos'
        AND EXISTS (SELECT 1 FROM pragma_table_info(m.name) c WHERE c.name = 'linha_produtos_id')
    `);
    assert.deepEqual(tabelasVinculo, []);
    await run(db, 'UPDATE produtos SET linha_produtos_id = ? WHERE id = 16', [fruta]);
    const abacaxi = await get(db, 'SELECT linha_produtos_id FROM produtos WHERE id = 16');
    assert.equal(abacaxi.linha_produtos_id, fruta);
    await run(db, 'UPDATE produtos SET linha_produtos_id = ? WHERE id = 16', [cremoso]);
  });

  it('4b. vínculo exige linha existente e linha com produtos não é apagada', async () => {
    await assert.rejects(run(db, 'UPDATE produtos SET linha_produtos_id = 999 WHERE id = 5'), /Linha de Produtos inexistente/);
    await assert.rejects(
      run(db, "INSERT INTO produtos (id, nome, linha_produtos_id) VALUES (900, 'X', 999)"),
      /Linha de Produtos inexistente/
    );
    await assert.rejects(run(db, 'DELETE FROM linhas_produtos WHERE id = ?', [cremoso]), /possui produtos vinculados/);
  });

  it('4c. nome e código da linha não se repetem', async () => {
    await assert.rejects(run(db, "INSERT INTO linhas_produtos (nome) VALUES (' picolé cremoso ')"), /UNIQUE/);
    await assert.rejects(run(db, "INSERT INTO linhas_produtos (codigo, nome) VALUES ('PIC-CREMOSO', 'Outra')"), /UNIQUE/);
  });

  it('5. linha não possui estoque', async () => {
    const cols = await colunas(db, 'linhas_produtos');
    assert.deepEqual(cols, ['id', 'codigo', 'nome', 'descricao', 'ativo', 'created_at', 'updated_at']);
    const estoque = await all(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%linha%' AND name LIKE '%estoque%'");
    assert.deepEqual(estoque, []);
    const saldos = await all(db, 'SELECT id, estoque_atual, saldo_fiscal FROM produtos WHERE id IN (4, 16) ORDER BY id');
    assert.deepEqual(saldos, [{ id: 4, estoque_atual: 180, saldo_fiscal: 180 }, { id: 16, estoque_atual: 250, saldo_fiscal: 250 }]);
    const movs = await get(db, 'SELECT COUNT(*) AS q FROM estoque_movimentacoes');
    assert.equal(movs.q, 0);
  });

  it('6. linha não pode ser produto de OP', async () => {
    await assert.rejects(
      salvarOrdem(db, { origem: 'MANUAL', itens: [{ linha_produtos_id: cremoso, quantidade_planejada: 10 }] }, null, {}),
      (e) => e.codigo === 'PRODUTO_OBRIGATORIO' || e.code === 'PRODUTO_OBRIGATORIO'
    );
    assert.equal(await get(db, 'SELECT id FROM produtos WHERE id = ?', [cremoso]), undefined);
    await assert.rejects(
      salvarOrdem(db, { origem: 'MANUAL', itens: [{ produto_id: cremoso, quantidade_planejada: 10 }] }, null, {}),
      (e) => /PRODUTO_NAO_ENCONTRADO/.test(String(e.codigo || e.code))
    );
    assert.ok(!(await colunas(db, 'ordem_producao_itens')).includes('linha_produtos_id'));
    const ordem = await salvarOrdem(db, { origem: 'MANUAL', itens: [{ produto_id: 16, quantidade_planejada: 10, unidade: 'UN' }] }, null, {});
    assert.equal(ordem.itens[0].produto_id, 16);
  });

  it('7. linha não substitui produto_id', async () => {
    assert.ok(!(await colunas(db, 'linhas_produtos')).includes('produto_id'));
    const rows = await all(db, 'SELECT id, linha_produtos_id FROM produtos WHERE linha_produtos_id IS NOT NULL ORDER BY id');
    assert.deepEqual(rows, [{ id: 4, linha_produtos_id: cremoso }, { id: 16, linha_produtos_id: cremoso }]);
  });

  it('8. Linha de Produtos não altera a Linha de Precificação', async () => {
    assert.deepEqual(await get(db, "SELECT sql FROM sqlite_master WHERE name = 'linhas_comerciais'"), precificacaoAntes.schema);
    assert.deepEqual(await all(db, 'SELECT * FROM linhas_comerciais ORDER BY id'), precificacaoAntes.linhas);
    assert.deepEqual(await all(db, 'SELECT id, linha_comercial_id FROM produtos WHERE id IN (4, 5, 16, 59) ORDER BY id'), precificacaoAntes.produtos);
  });

  it('9. resolver de preço não conhece Linha de Produtos', () => {
    const fonte = fs.readFileSync(path.join(__dirname, '../../backend/modules/comercial/preco/ComercialPrecoResolver.js'), 'utf8');
    assert.ok(!/linha_produtos|linhas_produtos/.test(fonte));
  });
});
