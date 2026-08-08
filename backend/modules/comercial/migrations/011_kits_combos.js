/**
 * 011 — Motor de Kits e Combos (RCM-05.9)
 *
 * @param {Object} db
 * @returns {Promise<void>}
 */
function migration011KitsCombos(db) {
  return new Promise((resolve, reject) => {
    function runSql(sql, params = []) {
      return new Promise((res, rej) => {
        db.run(sql, params, (err) => (err ? rej(err) : res()));
      });
    }

    function all(sql, params = []) {
      return new Promise((res, rej) => {
        db.all(sql, params, (err, rows) => (err ? rej(err) : res(rows || [])));
      });
    }

    async function colunaExiste(tabela, coluna) {
      const cols = await all(`PRAGMA table_info(${tabela})`);
      return new Set((cols || []).map((c) => c.name)).has(coluna);
    }

    async function tabelaExiste(nome) {
      const row = await new Promise((res, rej) => {
        db.get(
          `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
          [nome],
          (err, r) => (err ? rej(err) : res(r || null))
        );
      });
      return Boolean(row);
    }

    async function run() {
      try {
        if (!(await tabelaExiste('kits'))) {
          await runSql(`
            CREATE TABLE kits (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              codigo TEXT NOT NULL UNIQUE,
              descricao TEXT NOT NULL,
              categoria_id INTEGER,
              ativo INTEGER NOT NULL DEFAULT 1,
              preco REAL NOT NULL DEFAULT 0,
              tipo_formacao TEXT NOT NULL DEFAULT 'FIXO',
              permite_alterar_itens INTEGER NOT NULL DEFAULT 0,
              modo_fiscal TEXT NOT NULL DEFAULT 'KIT',
              produto_id INTEGER,
              created_at TEXT DEFAULT (datetime('now','localtime')),
              updated_at TEXT DEFAULT (datetime('now','localtime'))
            )
          `);
        }

        if (!(await tabelaExiste('kit_itens'))) {
          await runSql(`
            CREATE TABLE kit_itens (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              kit_id INTEGER NOT NULL,
              produto_id INTEGER NOT NULL,
              quantidade REAL NOT NULL DEFAULT 1,
              obrigatorio INTEGER NOT NULL DEFAULT 1,
              ordem INTEGER NOT NULL DEFAULT 0,
              UNIQUE(kit_id, produto_id),
              FOREIGN KEY (kit_id) REFERENCES kits(id) ON DELETE CASCADE
            )
          `);
        }

        if (!(await tabelaExiste('venda_item_kit_itens'))) {
          await runSql(`
            CREATE TABLE venda_item_kit_itens (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              venda_item_id INTEGER NOT NULL,
              kit_id INTEGER,
              produto_id INTEGER NOT NULL,
              quantidade REAL NOT NULL DEFAULT 1,
              preco_unitario REAL DEFAULT 0,
              obrigatorio INTEGER NOT NULL DEFAULT 1,
              FOREIGN KEY (venda_item_id) REFERENCES vendas_itens(id) ON DELETE CASCADE
            )
          `);
        }

        await runSql(
          `CREATE INDEX IF NOT EXISTS idx_kits_produto ON kits(produto_id)`
        );
        await runSql(
          `CREATE INDEX IF NOT EXISTS idx_kit_itens_kit ON kit_itens(kit_id)`
        );
        await runSql(
          `CREATE INDEX IF NOT EXISTS idx_venda_item_kit ON venda_item_kit_itens(venda_item_id)`
        );

        if (!(await colunaExiste('produtos', 'eh_kit'))) {
          await runSql(`ALTER TABLE produtos ADD COLUMN eh_kit INTEGER DEFAULT 0`);
        }

        console.log('[RCM-05.9] Kits e Combos: schema OK');
        resolve();
      } catch (err) {
        reject(err);
      }
    }

    run();
  });
}

module.exports = migration011KitsCombos;
