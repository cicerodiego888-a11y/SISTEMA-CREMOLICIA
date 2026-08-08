/**
 * A-1 — Desacoplamento Categoria × Política Comercial
 *
 * Não destrutivo:
 * - Cria N:N produto ↔ política (linhas_comerciais)
 * - Preserva produtos.linha_comercial_id e categorias.linha_comercial_id
 * - Não remove espelhamento histórico; apenas deixa de ser obrigatório
 */

function columnExists(db, table, column) {
  return new Promise((resolve) => {
    db.all(`PRAGMA table_info(${table})`, [], (err, cols) => {
      if (err || !Array.isArray(cols)) return resolve(false);
      resolve(cols.some((c) => String(c.name).toLowerCase() === String(column).toLowerCase()));
    });
  });
}

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
async function migration013PoliticaComercialDesacoplamento(db) {
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS produto_politicas_comerciais (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      produto_id INTEGER NOT NULL,
      linha_comercial_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(produto_id, linha_comercial_id),
      FOREIGN KEY (produto_id) REFERENCES produtos(id),
      FOREIGN KEY (linha_comercial_id) REFERENCES linhas_comerciais(id)
    )`
  );

  await run(
    db,
    `CREATE INDEX IF NOT EXISTS idx_produto_politicas_produto
     ON produto_politicas_comerciais(produto_id)`
  );
  await run(
    db,
    `CREATE INDEX IF NOT EXISTS idx_produto_politicas_linha
     ON produto_politicas_comerciais(linha_comercial_id)`
  );

  // Compat: backfill N:N a partir do FK legado (não apaga o legado)
  const temLinha = await columnExists(db, 'produtos', 'linha_comercial_id');
  if (temLinha) {
    await run(
      db,
      `INSERT OR IGNORE INTO produto_politicas_comerciais (produto_id, linha_comercial_id)
       SELECT p.id, p.linha_comercial_id
       FROM produtos p
       INNER JOIN linhas_comerciais l ON l.id = p.linha_comercial_id
       WHERE p.linha_comercial_id IS NOT NULL AND p.linha_comercial_id > 0`
    );
  }

  console.log('[A-1] migration 013_politica_comercial_desacoplamento aplicada');
}

module.exports = migration013PoliticaComercialDesacoplamento;
