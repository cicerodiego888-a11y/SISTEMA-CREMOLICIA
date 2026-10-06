/**
 * Vínculo N:N de uma venda/NF-e com vários pedidos comerciais.
 * Não copia itens, não fatura e não altera a tabela legada `pedidos`.
 * O índice único de venda_id em pedidos_comerciais impede vários pedidos
 * na mesma venda; ele vira um índice comum. A unicidade fica em venda_pedidos.
 *
 * @param {Object} db
 * @returns {Promise<void>}
 */
function migration023NfePedidos(db) {
  const run = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, (err) => (err ? reject(err) : resolve()));
  });

  return (async () => {
    await run(`CREATE TABLE IF NOT EXISTS venda_pedidos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      venda_id INTEGER NOT NULL,
      pedido_id INTEGER NOT NULL,
      valor_vinculado REAL NOT NULL DEFAULT 0,
      criado_em DATETIME DEFAULT (datetime('now','localtime')),
      UNIQUE (venda_id, pedido_id)
    )`);
    await run(`CREATE TABLE IF NOT EXISTS nfe_pedidos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nfe_id INTEGER NOT NULL,
      pedido_id INTEGER NOT NULL,
      venda_id INTEGER NOT NULL,
      valor_faturado REAL NOT NULL DEFAULT 0,
      criado_em DATETIME DEFAULT (datetime('now','localtime')),
      UNIQUE (nfe_id, pedido_id)
    )`);
    await run(`CREATE TABLE IF NOT EXISTS venda_pedido_itens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      venda_id INTEGER NOT NULL,
      pedido_id INTEGER NOT NULL,
      pedido_item_id INTEGER NOT NULL,
      venda_item_id INTEGER,
      produto_id INTEGER NOT NULL,
      quantidade REAL NOT NULL,
      preco_unitario REAL NOT NULL,
      subtotal REAL NOT NULL,
      UNIQUE (venda_id, pedido_item_id)
    )`);
    await run('CREATE INDEX IF NOT EXISTS idx_venda_pedidos_pedido ON venda_pedidos(pedido_id)');
    await run('CREATE INDEX IF NOT EXISTS idx_nfe_pedidos_pedido ON nfe_pedidos(pedido_id)');
    await run('DROP INDEX IF EXISTS idx_pedidos_comerciais_venda');
    await run('CREATE INDEX IF NOT EXISTS idx_pedidos_comerciais_venda_lookup ON pedidos_comerciais(venda_id)');
  })();
}

module.exports = migration023NfePedidos;
