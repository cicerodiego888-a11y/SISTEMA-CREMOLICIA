/**
 * MFE-01 — Schema fundação (sem migração de legado)
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

async function bootstrapMotorFinanceiroSchema(db) {
  await run(
    db,
    `
    CREATE TABLE IF NOT EXISTS financial_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ledger_id TEXT NOT NULL DEFAULT 'default',
      event_id INTEGER,
      evento TEXT NOT NULL,
      origem TEXT NOT NULL,
      tipo TEXT NOT NULL,
      tipo_lancamento TEXT,
      natureza TEXT,
      valor REAL NOT NULL,
      moeda TEXT DEFAULT 'BRL',
      conta TEXT NOT NULL,
      conta_financeira TEXT,
      centro_custo TEXT,
      historico TEXT,
      operador INTEGER,
      correlation_id TEXT NOT NULL,
      causation_id TEXT,
      idempotency_key TEXT NOT NULL,
      motor TEXT NOT NULL DEFAULT 'MotorFinanceiro',
      detalhes_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `
  );

  await run(
    db,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_fin_ledger_idempotency
     ON financial_ledger(idempotency_key)`
  );
  await run(
    db,
    `CREATE INDEX IF NOT EXISTS idx_fin_ledger_corr ON financial_ledger(correlation_id)`
  );
  await run(
    db,
    `CREATE INDEX IF NOT EXISTS idx_fin_ledger_conta ON financial_ledger(conta, created_at)`
  );
  // Índices de colunas MFE-03 (event_id, conta_financeira) ficam em 002 —
  // bases já criadas no MFE-01 antigo não têm essas colunas até o ALTER.
  await run(db, `CREATE INDEX IF NOT EXISTS idx_fin_ledger_ledger_id ON financial_ledger(ledger_id)`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_fin_ledger_created_at ON financial_ledger(created_at)`);

  await run(
    db,
    `
    CREATE TABLE IF NOT EXISTS financial_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      origem TEXT NOT NULL,
      payload_json TEXT,
      correlation_id TEXT NOT NULL,
      causation_id TEXT,
      idempotency_key TEXT NOT NULL,
      operador_id INTEGER,
      status TEXT NOT NULL DEFAULT 'RECEIVED',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `
  );

  await run(
    db,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_fin_events_idempotency
     ON financial_events(idempotency_key)`
  );
  await run(
    db,
    `CREATE INDEX IF NOT EXISTS idx_fin_events_corr ON financial_events(correlation_id)`
  );
  await run(
    db,
    `CREATE INDEX IF NOT EXISTS idx_fin_events_type ON financial_events(type, created_at)`
  );

  await run(
    db,
    `
    CREATE TABLE IF NOT EXISTS financial_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER,
      event_type TEXT NOT NULL,
      payload_json TEXT,
      correlation_id TEXT,
      idempotency_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      processed_at DATETIME
    )
  `
  );

  await run(
    db,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_fin_outbox_idempotency
     ON financial_outbox(idempotency_key)`
  );
  await run(
    db,
    `CREATE INDEX IF NOT EXISTS idx_fin_outbox_status ON financial_outbox(status, created_at)`
  );

  await run(
    db,
    `
    CREATE TABLE IF NOT EXISTS financial_dead_letter (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER,
      event_type TEXT,
      payload_json TEXT,
      correlation_id TEXT,
      idempotency_key TEXT,
      erro TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `
  );

  await run(
    db,
    `
    CREATE TABLE IF NOT EXISTS financial_idempotency (
      idempotency_key TEXT PRIMARY KEY,
      event_type TEXT,
      correlation_id TEXT,
      result_ref TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `
  );

  await run(
    db,
    `
    CREATE TABLE IF NOT EXISTS financial_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      acao TEXT NOT NULL,
      origem TEXT,
      operador_id INTEGER,
      correlation_id TEXT,
      causation_id TEXT,
      detalhe_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `
  );

  await run(
    db,
    `CREATE INDEX IF NOT EXISTS idx_fin_audit_corr ON financial_audit(correlation_id)`
  );

  console.log('[MFE-01] Schema Motor Financeiro pronto.');
}

module.exports = { bootstrapMotorFinanceiroSchema };
