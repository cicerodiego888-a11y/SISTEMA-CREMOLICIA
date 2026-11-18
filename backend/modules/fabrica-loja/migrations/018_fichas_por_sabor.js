'use strict';

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

function run(db, sql) {
  return new Promise((resolve, reject) => {
    db.run(sql, (err) => (err ? reject(err) : resolve()));
  });
}

async function garantirColuna(db, tabela, coluna, definicao) {
  const colunas = await all(db, `PRAGMA table_info(${tabela})`);
  if (!colunas.some((item) => item.name === coluna)) {
    await run(db, `ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${definicao}`);
  }
}

async function bootstrapFichasPorSabor(db) {
  await garantirColuna(
    db,
    'fichas_tecnicas_padrao',
    'ficha_tradicional_id',
    'INTEGER REFERENCES fichas_tecnicas(id) ON DELETE RESTRICT'
  );
  await garantirColuna(db, 'fichas_tecnicas_padrao_versoes', 'ficha_tradicional_revisao', 'TEXT');
  await garantirColuna(db, 'fichas_tecnicas_padrao_versoes', 'ficha_tradicional_snapshot', 'TEXT');
  await garantirColuna(db, 'fichas_tecnicas_padrao_versoes', 'ficha_tradicional_snapshot_anterior', 'TEXT');

  await run(db, `
    CREATE INDEX IF NOT EXISTS idx_fichas_tecnicas_padrao_origem_tradicional
    ON fichas_tecnicas_padrao(ficha_tradicional_id)
    WHERE ficha_tradicional_id IS NOT NULL
  `);
  await run(db, `
    CREATE TRIGGER IF NOT EXISTS trg_fichas_tecnicas_padrao_origem_imutavel
    BEFORE UPDATE OF ficha_tradicional_id ON fichas_tecnicas_padrao
    WHEN OLD.ficha_tradicional_id IS NOT NULL
      AND NEW.ficha_tradicional_id IS NOT OLD.ficha_tradicional_id
    BEGIN
      SELECT RAISE(ABORT, 'A origem da ficha por sabor é imutável.');
    END
  `);
}

module.exports = bootstrapFichasPorSabor;
