/**
 * MCC-02 — Migration: conversoes_fisicas_lotes
 * MCC-02.1 — já inclui campos de versionamento na criação limpa.
 *
 * Relacionamento: Produto 1:N Conversões | Lote 1:N versões (1 ativa)
 */

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => {
      if (err && !String(err.message || '').includes('duplicate column')) {
        return reject(err);
      }
      resolve();
    });
  });
}

async function bootstrapConversaoFisicaLoteSchema(db) {
  await run(
    db,
    `
    CREATE TABLE IF NOT EXISTS conversoes_fisicas_lotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      produto_id INTEGER NOT NULL,
      lote_id INTEGER NOT NULL,
      unidade_base TEXT NOT NULL,
      unidade_destino TEXT NOT NULL,
      quantidade_base REAL NOT NULL,
      quantidade_destino REAL NOT NULL,
      fator REAL NOT NULL,
      origem TEXT NOT NULL DEFAULT 'MANUAL',
      versao INTEGER NOT NULL DEFAULT 1,
      ativa INTEGER NOT NULL DEFAULT 1,
      substitui_id INTEGER,
      motivo TEXT,
      usuario_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE CASCADE,
      FOREIGN KEY (lote_id) REFERENCES produtos_lotes(id) ON DELETE CASCADE
    )
  `
  );

  await run(
    db,
    `CREATE INDEX IF NOT EXISTS idx_cfl_produto ON conversoes_fisicas_lotes(produto_id)`
  );
  await run(
    db,
    `CREATE INDEX IF NOT EXISTS idx_cfl_lote ON conversoes_fisicas_lotes(lote_id)`
  );

  console.log('[MCC-02] Schema conversoes_fisicas_lotes pronto.');
}

module.exports = { bootstrapConversaoFisicaLoteSchema };
