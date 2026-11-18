/**
 * Necessidade de produção: o que a fábrica precisa produzir.
 * Não cria ordem de produção, não baixa estoque e não altera o pedido da loja.
 */

function run(db, sql) {
  return new Promise((resolve, reject) => {
    db.run(sql, function onRun(err) {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function bootstrapNecessidadesProducao(db) {
  await run(db, `
    CREATE TABLE IF NOT EXISTS necessidades_producao (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo TEXT NOT NULL,
      origem TEXT NOT NULL CHECK (origem IN ('PEDIDO_LOJA', 'ABASTECIMENTO', 'PLANEJAMENTO', 'MANUAL')),
      pedido_id INTEGER,
      referencia TEXT,
      descricao TEXT NOT NULL,
      data_necessidade TEXT,
      status TEXT NOT NULL DEFAULT 'ABERTA' CHECK (status IN ('ABERTA', 'CANCELADA')),
      observacoes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `);
  await run(db, `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_necessidades_producao_codigo
    ON necessidades_producao(codigo)
  `);
  await run(db, `
    CREATE INDEX IF NOT EXISTS idx_necessidades_producao_origem
    ON necessidades_producao(origem, status)
  `);
  await run(db, `
    CREATE TABLE IF NOT EXISTS necessidade_producao_itens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      necessidade_id INTEGER NOT NULL,
      ordem INTEGER NOT NULL,
      produto_id INTEGER,
      descricao TEXT NOT NULL,
      quantidade REAL NOT NULL,
      unidade TEXT,
      ficha_tecnica_id INTEGER,
      observacao TEXT
    )
  `);
  await run(db, `
    CREATE INDEX IF NOT EXISTS idx_necessidade_producao_itens_necessidade
    ON necessidade_producao_itens(necessidade_id, ordem)
  `);
}

module.exports = bootstrapNecessidadesProducao;
