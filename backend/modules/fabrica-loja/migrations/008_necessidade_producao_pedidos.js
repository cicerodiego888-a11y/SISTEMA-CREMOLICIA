/**
 * Vários pedidos da loja na mesma necessidade.
 * O pedido_id do cabeçalho permanece para as necessidades antigas.
 * A quantidade por produto fica na tabela filha para limitar a demanda de cada pedido.
 */

function run(db, sql) {
  return new Promise((resolve, reject) => {
    db.run(sql, (err) => (err ? reject(err) : resolve()));
  });
}

async function bootstrapNecessidadePedidos(db) {
  await run(db, `
    CREATE TABLE IF NOT EXISTS necessidade_producao_pedidos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      necessidade_id INTEGER NOT NULL,
      pedido_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `);
  await run(db, `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_necessidade_producao_pedidos_unico
    ON necessidade_producao_pedidos(necessidade_id, pedido_id)
  `);
  await run(db, `
    CREATE INDEX IF NOT EXISTS idx_necessidade_producao_pedidos_pedido
    ON necessidade_producao_pedidos(pedido_id)
  `);
  await run(db, `
    CREATE TABLE IF NOT EXISTS necessidade_producao_pedido_itens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      necessidade_pedido_id INTEGER NOT NULL,
      produto_id INTEGER NOT NULL,
      quantidade REAL NOT NULL,
      unidade TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `);
  await run(db, `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_necessidade_producao_pedido_itens_unico
    ON necessidade_producao_pedido_itens(necessidade_pedido_id, produto_id)
  `);
}

module.exports = bootstrapNecessidadePedidos;
