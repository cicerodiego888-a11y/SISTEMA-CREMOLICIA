/**
 * MCC-04 — Schema auditoria Motor de Estoque
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

async function bootstrapMotorEstoqueSchema(db) {
  await run(
    db,
    `
    CREATE TABLE IF NOT EXISTS estoque_movimentacoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      produto_id INTEGER NOT NULL,
      quantidade_base REAL NOT NULL,
      quantidade_fiscal REAL NOT NULL DEFAULT 0,
      quantidade_nao_fiscal REAL NOT NULL DEFAULT 0,
      operacao TEXT NOT NULL,
      origem TEXT NOT NULL,
      lote_id INTEGER,
      referencia_tipo TEXT,
      referencia_id INTEGER,
      saldo_antes REAL,
      saldo_depois REAL,
      usuario_id INTEGER,
      motivo TEXT,
      motor TEXT NOT NULL DEFAULT 'MotorEstoque',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE CASCADE
    )
  `
  );

  await run(
    db,
    `CREATE INDEX IF NOT EXISTS idx_est_mov_produto ON estoque_movimentacoes(produto_id)`
  );
  await run(
    db,
    `CREATE INDEX IF NOT EXISTS idx_est_mov_lote ON estoque_movimentacoes(lote_id)`
  );
  await run(
    db,
    `CREATE INDEX IF NOT EXISTS idx_est_mov_origem ON estoque_movimentacoes(origem, operacao)`
  );

  await run(
    db,
    `
    CREATE TABLE IF NOT EXISTS estoque_reservas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      produto_id INTEGER NOT NULL,
      quantidade_base REAL NOT NULL,
      origem TEXT NOT NULL,
      referencia_tipo TEXT,
      referencia_id INTEGER,
      status TEXT NOT NULL DEFAULT 'ATIVA',
      lote_id INTEGER,
      usuario_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      liberada_at DATETIME,
      FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE CASCADE
    )
  `
  );

  await run(
    db,
    `CREATE INDEX IF NOT EXISTS idx_est_res_produto ON estoque_reservas(produto_id, status)`
  );

  console.log('[MCC-04] Schema Motor de Estoque pronto.');
}

module.exports = { bootstrapMotorEstoqueSchema };
