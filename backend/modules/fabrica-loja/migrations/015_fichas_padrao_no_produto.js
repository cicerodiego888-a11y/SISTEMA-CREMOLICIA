'use strict';

function run(db, sql) {
  return new Promise((resolve, reject) => {
    db.run(sql, (err) => (err ? reject(err) : resolve()));
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function all(db, sql) {
  return new Promise((resolve, reject) => {
    db.all(sql, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

async function tabelaExiste(db, nome) {
  return !!(await get(db, `
    SELECT 1 AS existe FROM sqlite_master WHERE type = 'table' AND name = ?
  `, [nome]));
}

async function garantirColuna(db, tabela, coluna, definicao) {
  if (!(await tabelaExiste(db, tabela))) return;
  const colunas = await all(db, `PRAGMA table_info(${tabela})`);
  if (colunas.some((item) => item.name === coluna)) return;
  await run(db, `ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${definicao}`);
}

async function bootstrapFichaPadraoSemProduto(db) {
  await garantirColuna(db, 'necessidade_producao_itens', 'ficha_padrao_vinculo_id', 'INTEGER');
  await garantirColuna(db, 'necessidade_producao_itens', 'ficha_padrao_versao_id', 'INTEGER');
  await garantirColuna(db, 'necessidade_producao_itens', 'ficha_padrao_snapshot', 'TEXT');
  await garantirColuna(db, 'ordem_producao_itens', 'ficha_padrao_vinculo_id', 'INTEGER');
  await garantirColuna(db, 'ordem_producao_itens', 'ficha_padrao_versao_id', 'INTEGER');
  await garantirColuna(db, 'ordem_producao_itens', 'ficha_padrao_snapshot', 'TEXT');

  for (const [tabela, indice, coluna] of [
    ['necessidade_producao_itens', 'idx_necessidade_producao_itens_ficha_padrao', 'ficha_padrao_vinculo_id'],
    ['ordem_producao_itens', 'idx_ordem_producao_itens_ficha_padrao', 'ficha_padrao_vinculo_id']
  ]) {
    if (await tabelaExiste(db, tabela)) {
      await run(db, `CREATE INDEX IF NOT EXISTS ${indice} ON ${tabela}(${coluna})`);
    }
  }
}

module.exports = bootstrapFichaPadraoSemProduto;
