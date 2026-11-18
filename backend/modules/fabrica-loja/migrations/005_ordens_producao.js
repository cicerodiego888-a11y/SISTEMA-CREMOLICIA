/**
 * Ordem de produção: o que a fábrica pretende produzir.
 * Não consome insumo, não dá entrada de produto e não movimenta estoque.
 */

function run(db, sql) {
  return new Promise((resolve, reject) => {
    db.run(sql, function onRun(err) {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function bootstrapOrdensProducao(db) {
  await run(db, `
    CREATE TABLE IF NOT EXISTS ordens_producao (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'RASCUNHO'
        CHECK (status IN ('RASCUNHO', 'PLANEJADA', 'EM_PRODUCAO', 'CONCLUIDA', 'CANCELADA')),
      data_prevista TEXT,
      prioridade TEXT NOT NULL DEFAULT 'NORMAL'
        CHECK (prioridade IN ('BAIXA', 'NORMAL', 'ALTA', 'URGENTE')),
      origem TEXT NOT NULL
        CHECK (origem IN ('NECESSIDADE', 'PEDIDO_LOJA', 'ABASTECIMENTO', 'PLANEJAMENTO', 'MANUAL')),
      observacao TEXT,
      usuario_id INTEGER,
      usuario_nome TEXT,
      necessidade_id INTEGER,
      pedido_id INTEGER,
      referencia TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `);
  await run(db, `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ordens_producao_codigo
    ON ordens_producao(codigo)
  `);
  await run(db, `
    CREATE INDEX IF NOT EXISTS idx_ordens_producao_status
    ON ordens_producao(status, prioridade)
  `);
  await run(db, `
    CREATE INDEX IF NOT EXISTS idx_ordens_producao_necessidade
    ON ordens_producao(necessidade_id)
  `);
  await run(db, `
    CREATE TABLE IF NOT EXISTS ordem_producao_itens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ordem_id INTEGER NOT NULL,
      ordem INTEGER NOT NULL,
      produto_id INTEGER NOT NULL,
      produto_nome TEXT NOT NULL,
      quantidade_planejada REAL NOT NULL,
      unidade TEXT,
      ficha_tecnica_id INTEGER,
      necessidade_item_id INTEGER,
      observacao TEXT
    )
  `);
  await run(db, `
    CREATE INDEX IF NOT EXISTS idx_ordem_producao_itens_ordem
    ON ordem_producao_itens(ordem_id, ordem)
  `);
  await run(db, `
    CREATE INDEX IF NOT EXISTS idx_ordem_producao_itens_produto
    ON ordem_producao_itens(produto_id)
  `);
}

module.exports = bootstrapOrdensProducao;
