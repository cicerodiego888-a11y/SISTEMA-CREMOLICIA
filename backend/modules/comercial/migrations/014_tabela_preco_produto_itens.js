/**
 * RA-1.1 — Tabela de Preço × Produto × Canal (novo modelo)
 *
 * ADD only. Não remove Política / linhas_comerciais.
 */

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

/**
 * @param {import('sqlite3').Database} db
 */
async function migration014TabelaPrecoProdutoItens(db) {
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS tabela_preco_produto_itens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tabela_preco_id INTEGER NOT NULL,
      produto_id INTEGER NOT NULL,
      canal_venda_id INTEGER NOT NULL,
      preco DECIMAL(12,4) NOT NULL DEFAULT 0,
      forma_comercializacao TEXT DEFAULT NULL,
      unidade_comercial TEXT DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(tabela_preco_id, produto_id, canal_venda_id),
      FOREIGN KEY (tabela_preco_id) REFERENCES tabelas_preco(id) ON DELETE CASCADE,
      FOREIGN KEY (produto_id) REFERENCES produtos(id),
      FOREIGN KEY (canal_venda_id) REFERENCES canais_venda(id)
    )`
  );

  await run(
    db,
    `CREATE INDEX IF NOT EXISTS idx_tp_prod_itens_tabela
     ON tabela_preco_produto_itens(tabela_preco_id)`
  );
  await run(
    db,
    `CREATE INDEX IF NOT EXISTS idx_tp_prod_itens_produto
     ON tabela_preco_produto_itens(produto_id)`
  );
  await run(
    db,
    `CREATE INDEX IF NOT EXISTS idx_tp_prod_itens_produto_canal
     ON tabela_preco_produto_itens(produto_id, canal_venda_id)`
  );

  console.log('[RA-1.1] migration 014_tabela_preco_produto_itens aplicada');
}

module.exports = migration014TabelaPrecoProdutoItens;
