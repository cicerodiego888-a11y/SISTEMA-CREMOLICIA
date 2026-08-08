/**
 * MFE-03 — Schema operacional do ledger (colunas + índices)
 *
 * Compatível com financial_ledger criado no MFE-01 antigo (sem event_id etc.).
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

function tableColumns(db, table) {
  return new Promise((resolve, reject) => {
    if (typeof db.all !== 'function') {
      return resolve(new Set());
    }
    db.all(`PRAGMA table_info(${table})`, (err, rows) => {
      if (err) return reject(err);
      resolve(new Set((rows || []).map((r) => r.name)));
    });
  });
}

async function bootstrapLedgerOperacionalSchema(db) {
  const cols = [
    ['event_id', 'INTEGER'],
    ['tipo_lancamento', 'TEXT'],
    ['natureza', 'TEXT'],
    ['moeda', "TEXT DEFAULT 'BRL'"],
    ['conta_financeira', 'TEXT'],
    ['historico', 'TEXT']
  ];

  const existing = await tableColumns(db, 'financial_ledger');
  for (const [name, type] of cols) {
    if (existing.size === 0 || !existing.has(name)) {
      await run(db, `ALTER TABLE financial_ledger ADD COLUMN ${name} ${type}`);
    }
  }

  // Backfill leve: conta_financeira ← conta quando vazia
  await run(
    db,
    `UPDATE financial_ledger
     SET conta_financeira = conta
     WHERE (conta_financeira IS NULL OR conta_financeira = '')
       AND conta IS NOT NULL`
  );
  await run(
    db,
    `UPDATE financial_ledger
     SET natureza = tipo
     WHERE (natureza IS NULL OR natureza = '')
       AND tipo IS NOT NULL`
  );
  await run(
    db,
    `UPDATE financial_ledger
     SET tipo_lancamento = 'OUTROS'
     WHERE tipo_lancamento IS NULL OR tipo_lancamento = ''`
  );
  await run(
    db,
    `UPDATE financial_ledger
     SET moeda = 'BRL'
     WHERE moeda IS NULL OR moeda = ''`
  );

  await run(db, `CREATE INDEX IF NOT EXISTS idx_fin_ledger_ledger_id ON financial_ledger(ledger_id)`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_fin_ledger_event_id ON financial_ledger(event_id)`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_fin_ledger_created_at ON financial_ledger(created_at)`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_fin_ledger_conta_fin ON financial_ledger(conta_financeira)`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_fin_ledger_corr_mfe03 ON financial_ledger(correlation_id)`);

  console.log('[MFE-03] Schema Ledger Operacional pronto.');
}

module.exports = { bootstrapLedgerOperacionalSchema };
