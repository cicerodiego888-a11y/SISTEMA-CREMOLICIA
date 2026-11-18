/**
 * Execução da ordem de produção.
 * Guarda o snapshot da ficha e a chave que impede produzir duas vezes.
 * O saldo continua no Motor de Estoque.
 */

function run(db, sql) {
  return new Promise((resolve, reject) => {
    db.run(sql, function onRun(err) {
      if (err && !/duplicate column name/i.test(err.message || '')) reject(err);
      else resolve();
    });
  });
}

async function bootstrapOrdemProducaoExecucoes(db) {
  await run(db, `
    CREATE TABLE IF NOT EXISTS ordem_producao_execucoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ordem_id INTEGER NOT NULL,
      correlation_id TEXT NOT NULL,
      local TEXT NOT NULL DEFAULT 'FABRICA',
      unidade_negocio_id INTEGER,
      snapshot_json TEXT NOT NULL,
      usuario_id INTEGER,
      usuario_nome TEXT,
      quantidade_planejada REAL,
      quantidade_produzida REAL,
      quantidade_perdida REAL,
      unidade TEXT,
      motivo_perda TEXT,
      observacao_perda TEXT,
      rendimento_real REAL,
      iniciada_em TEXT,
      concluida_em TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `);
  await run(db, 'ALTER TABLE ordem_producao_execucoes ADD COLUMN quantidade_planejada REAL');
  await run(db, 'ALTER TABLE ordem_producao_execucoes ADD COLUMN quantidade_produzida REAL');
  await run(db, 'ALTER TABLE ordem_producao_execucoes ADD COLUMN quantidade_perdida REAL');
  await run(db, 'ALTER TABLE ordem_producao_execucoes ADD COLUMN unidade TEXT');
  await run(db, 'ALTER TABLE ordem_producao_execucoes ADD COLUMN motivo_perda TEXT');
  await run(db, 'ALTER TABLE ordem_producao_execucoes ADD COLUMN observacao_perda TEXT');
  await run(db, 'ALTER TABLE ordem_producao_execucoes ADD COLUMN rendimento_real REAL');
  await run(db, 'ALTER TABLE ordem_producao_execucoes ADD COLUMN iniciada_em TEXT');
  await run(db, 'ALTER TABLE ordem_producao_execucoes ADD COLUMN concluida_em TEXT');
  await run(db, `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ordem_producao_execucoes_correlation
    ON ordem_producao_execucoes(correlation_id)
  `);
  await run(db, `
    CREATE INDEX IF NOT EXISTS idx_ordem_producao_execucoes_ordem
    ON ordem_producao_execucoes(ordem_id, id)
  `);
}

module.exports = bootstrapOrdemProducaoExecucoes;
