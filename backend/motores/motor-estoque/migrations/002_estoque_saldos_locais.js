/**
 * Saldo do produto por local. Não substitui o saldo oficial.
 */

function run(db, sql) {
  return new Promise((resolve, reject) => {
    db.run(sql, (err) => (err ? reject(err) : resolve()));
  });
}

async function bootstrapSaldosLocais(db) {
  await run(db, `
    CREATE TABLE IF NOT EXISTS estoque_saldos_locais (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      produto_id INTEGER NOT NULL,
      local TEXT NOT NULL,
      saldo_fiscal REAL NOT NULL DEFAULT 0,
      saldo_nao_fiscal REAL NOT NULL DEFAULT 0,
      estoque_atual REAL NOT NULL DEFAULT 0
    )
  `);
  await run(db, `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_estoque_saldos_locais_produto
    ON estoque_saldos_locais(produto_id, local)
  `);
}

module.exports = { bootstrapSaldosLocais };
