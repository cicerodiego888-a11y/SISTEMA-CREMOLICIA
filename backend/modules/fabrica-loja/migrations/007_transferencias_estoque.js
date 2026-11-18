/**
 * Documento da transferência Fábrica → Loja.
 * O saldo continua no Motor de Estoque.
 */

function run(db, sql) {
  return new Promise((resolve, reject) => {
    db.run(sql, (err) => {
      if (err && !/duplicate column name/i.test(err.message || '')) reject(err);
      else resolve();
    });
  });
}

async function bootstrapTransferenciasEstoque(db) {
  await run(db, `
    CREATE TABLE IF NOT EXISTS transferencias_estoque (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo TEXT NOT NULL UNIQUE,
      origem_local TEXT NOT NULL DEFAULT 'FABRICA',
      destino_local TEXT NOT NULL DEFAULT 'LOJA',
      status TEXT NOT NULL DEFAULT 'RASCUNHO',
      data_transferencia TEXT,
      observacao TEXT,
      usuario_id INTEGER,
      usuario_nome TEXT,
      correlation_id TEXT,
      confirmada_em TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `);
  await run(db, `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_transferencias_estoque_correlation
    ON transferencias_estoque(correlation_id)
    WHERE correlation_id IS NOT NULL
  `);
  await run(db, `
    CREATE TABLE IF NOT EXISTS transferencia_estoque_itens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transferencia_id INTEGER NOT NULL,
      produto_id INTEGER NOT NULL,
      produto_nome TEXT,
      quantidade REAL NOT NULL,
      unidade TEXT,
      quantidade_base REAL,
      quantidade_fiscal REAL,
      quantidade_nao_fiscal REAL,
      observacao TEXT
    )
  `);
  await run(db, `
    CREATE INDEX IF NOT EXISTS idx_transferencia_estoque_itens_doc
    ON transferencia_estoque_itens(transferencia_id, id)
  `);
  await run(db, 'ALTER TABLE transferencia_estoque_itens ADD COLUMN quantidade_fiscal REAL');
  await run(db, 'ALTER TABLE transferencia_estoque_itens ADD COLUMN quantidade_nao_fiscal REAL');
}

module.exports = bootstrapTransferenciasEstoque;
