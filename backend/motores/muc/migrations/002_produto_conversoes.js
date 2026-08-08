/**
 * RCM-8.9 — produto_conversoes
 * Conversões físicas permanentes do produto (ex.: LT→KG 0,58).
 * Independente de preço e de lote (conversoes_fisicas_lotes).
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

async function bootstrapProdutoConversoesSchema(db) {
  await run(
    db,
    `
    CREATE TABLE IF NOT EXISTS produto_conversoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      produto_id INTEGER NOT NULL,
      origem TEXT NOT NULL,
      destino TEXT NOT NULL,
      fator REAL NOT NULL,
      tipo TEXT NOT NULL DEFAULT 'FIXA',
      ativo INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE CASCADE,
      UNIQUE(produto_id, origem, destino)
    )
  `
  );

  await run(db, `CREATE INDEX IF NOT EXISTS idx_produto_conversoes_produto ON produto_conversoes(produto_id)`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_produto_conversoes_ativo ON produto_conversoes(produto_id, ativo)`);

  console.log('[RCM-8.9] Schema produto_conversoes pronto.');
}

module.exports = {
  bootstrapProdutoConversoesSchema
};
