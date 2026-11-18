/**
 * Grupos livres de insumos. Não classifica natureza, estoque, custo ou fiscal.
 * Não grava grupos de exemplo.
 */

function run(db, sql) {
  return new Promise((resolve, reject) => {
    db.run(sql, (err) => {
      if (err && !/duplicate column name/i.test(err.message || '')) reject(err);
      else resolve();
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

async function bootstrapGruposInsumos(db) {
  await run(db, `
    CREATE TABLE IF NOT EXISTS grupos_insumos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `);
  await run(db, `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_grupos_insumos_nome
    ON grupos_insumos(lower(trim(nome)))
  `);
  const produtos = await get(db, `
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'produtos'
  `);
  if (produtos) {
    await run(db, 'ALTER TABLE produtos ADD COLUMN grupo_insumo_id INTEGER');
  }
}

module.exports = bootstrapGruposInsumos;
