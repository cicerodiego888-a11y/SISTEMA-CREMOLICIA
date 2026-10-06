/**
 * COM-ARCH-03 — Pedido comercial separado da tabela legada `pedidos`.
 * Cria somente `pedidos_comerciais` e os índices do modelo NF-E-04.0.
 * Não altera `pedidos`, `pedidos_itens`, vendas nem notas.
 *
 * `pedido_itens` vazio que ainda aponta para `pedidos` é recriado com o
 * mesmo formato, referenciando `pedidos_comerciais`. Com dados, a migration para.
 *
 * @param {Object} db
 * @returns {Promise<void>}
 */
function migration022PedidosComerciais(db) {
  const all = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
  const run = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, (err) => (err ? reject(err) : resolve()));
  });

  const ddlPedido = `CREATE TABLE IF NOT EXISTS pedidos_comerciais (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo TEXT,
      origem TEXT NOT NULL CHECK (origem IN ('ORCAMENTO','DIRETO')),
      orcamento_id INTEGER,
      cliente_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'ABERTO' CHECK (status IN ('ABERTO','FATURADO','CANCELADO')),
      total_itens REAL NOT NULL DEFAULT 0,
      desconto REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      forma_pagamento TEXT,
      parcelas INTEGER,
      primeiro_vencimento DATE,
      observacoes TEXT,
      venda_id INTEGER,
      usuario_id INTEGER,
      faturado_em DATETIME,
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      updated_at DATETIME DEFAULT (datetime('now','localtime')),
      CHECK ((origem = 'ORCAMENTO' AND orcamento_id IS NOT NULL) OR (origem = 'DIRETO' AND orcamento_id IS NULL)),
      FOREIGN KEY (orcamento_id) REFERENCES orcamentos(id),
      FOREIGN KEY (cliente_id) REFERENCES clientes(id),
      FOREIGN KEY (venda_id) REFERENCES vendas(id)
    )`;

  const ddlItens = `CREATE TABLE pedido_itens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pedido_id INTEGER NOT NULL,
      produto_id INTEGER NOT NULL,
      quantidade REAL NOT NULL,
      preco_unitario REAL NOT NULL,
      subtotal REAL NOT NULL,
      FOREIGN KEY (pedido_id) REFERENCES pedidos_comerciais(id),
      FOREIGN KEY (produto_id) REFERENCES produtos(id)
    )`;

  return (async () => {
    await run(ddlPedido);
    await run('CREATE UNIQUE INDEX IF NOT EXISTS idx_pedidos_comerciais_orcamento ON pedidos_comerciais(orcamento_id) WHERE orcamento_id IS NOT NULL');
    await run('CREATE INDEX IF NOT EXISTS idx_pedidos_comerciais_venda_lookup ON pedidos_comerciais(venda_id)');

    const existe = await all("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'pedido_itens'");
    if (!existe.length) {
      await run(ddlItens);
    } else {
      const fks = await all('PRAGMA foreign_key_list(pedido_itens)');
      const apontaLegado = fks.some((fk) => fk.table === 'pedidos' && fk.from === 'pedido_id');
      if (apontaLegado) {
        const contagem = await all('SELECT COUNT(*) AS n FROM pedido_itens');
        if (Number(contagem[0] && contagem[0].n) > 0) {
          throw new Error('pedido_itens possui dados e ainda referencia a tabela legada pedidos.');
        }
        await run('ALTER TABLE pedido_itens RENAME TO pedido_itens_fk_legado');
        await run(ddlItens);
        await run('DROP TABLE pedido_itens_fk_legado');
      }
    }
    await run('CREATE INDEX IF NOT EXISTS idx_pedido_itens_pedido ON pedido_itens(pedido_id)');
  })();
}

module.exports = migration022PedidosComerciais;
