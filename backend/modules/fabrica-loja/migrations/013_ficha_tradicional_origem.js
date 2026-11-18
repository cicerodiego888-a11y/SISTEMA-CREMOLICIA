'use strict';

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

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => (err ? reject(err) : resolve()));
  });
}

async function bootstrapFichaTradicionalOrigem(db) {
  const fichaPadrao = await get(db, `
    SELECT 1 AS ok FROM sqlite_master
    WHERE type = 'table' AND name = 'fichas_tecnicas_padrao'
  `);
  if (!fichaPadrao) throw new Error('A tabela de fichas padrão deve existir antes da migração de origem tradicional.');

  const colunas = await all(db, 'PRAGMA table_info(fichas_tecnicas_padrao)');
  if (!colunas.some((coluna) => coluna.name === 'ficha_tradicional_id')) {
    await run(db, `
      ALTER TABLE fichas_tecnicas_padrao
      ADD COLUMN ficha_tradicional_id INTEGER
      REFERENCES fichas_tecnicas(id) ON DELETE RESTRICT
    `);
  }
  await run(db, `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_fichas_tecnicas_padrao_origem_tradicional
    ON fichas_tecnicas_padrao(ficha_tradicional_id)
    WHERE ficha_tradicional_id IS NOT NULL
  `);
}

module.exports = bootstrapFichaTradicionalOrigem;
