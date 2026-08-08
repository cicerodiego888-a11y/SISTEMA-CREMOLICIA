/**
 * 006 — Montador de Casquinha (RCM-05.4)
 *
 * - produtos.bolas_min / bolas_max
 * - casquinha_sabores (catálogo)
 * - vendas_itens.quantidade_bolas
 * - venda_item_sabores (relacionamento item × sabores)
 *
 * @param {Object} db
 * @returns {Promise<void>}
 */
function migration006MontadorCasquinha(db) {
  return new Promise((resolve, reject) => {
    function colunaExiste(tabela, coluna) {
      return new Promise((res, rej) => {
        db.all(`PRAGMA table_info(${tabela})`, [], (err, cols) => {
          if (err) return rej(err);
          res(new Set((cols || []).map((c) => c.name)).has(coluna));
        });
      });
    }

    function runSql(sql, params = []) {
      return new Promise((res, rej) => {
        db.run(sql, params, (err) => (err ? rej(err) : res()));
      });
    }

    async function run() {
      try {
        if (!(await colunaExiste('produtos', 'bolas_min'))) {
          await runSql(`ALTER TABLE produtos ADD COLUMN bolas_min INTEGER DEFAULT NULL`);
        }
        if (!(await colunaExiste('produtos', 'bolas_max'))) {
          await runSql(`ALTER TABLE produtos ADD COLUMN bolas_max INTEGER DEFAULT NULL`);
        }

        // Backfill a partir de quantidade_bolas legada
        await runSql(`
          UPDATE produtos
          SET bolas_min = 1,
              bolas_max = CAST(quantidade_bolas AS INTEGER)
          WHERE UPPER(COALESCE(forma_comercializacao, '')) = 'CASQUINHA'
            AND COALESCE(quantidade_bolas, 0) > 0
            AND (bolas_min IS NULL OR bolas_max IS NULL)
        `);

        await runSql(`
          CREATE TABLE IF NOT EXISTS casquinha_sabores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL UNIQUE,
            ativo INTEGER NOT NULL DEFAULT 1,
            ordem INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        const seeds = [
          ['Chocolate', 1],
          ['Morango', 2],
          ['Coco', 3],
          ['Flocos', 4],
          ['Abacaxi', 5],
          ['Goiaba', 6],
          ['Creme', 7]
        ];
        for (const [nome, ordem] of seeds) {
          await runSql(
            `INSERT OR IGNORE INTO casquinha_sabores (nome, ativo, ordem) VALUES (?, 1, ?)`,
            [nome, ordem]
          );
        }

        if (!(await colunaExiste('vendas_itens', 'quantidade_bolas'))) {
          await runSql(`ALTER TABLE vendas_itens ADD COLUMN quantidade_bolas INTEGER DEFAULT NULL`);
        }

        await runSql(`
          CREATE TABLE IF NOT EXISTS venda_item_sabores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            venda_item_id INTEGER NOT NULL,
            sabor_id INTEGER,
            nome TEXT NOT NULL,
            sequencia INTEGER NOT NULL DEFAULT 1,
            FOREIGN KEY (venda_item_id) REFERENCES vendas_itens(id) ON DELETE CASCADE,
            FOREIGN KEY (sabor_id) REFERENCES casquinha_sabores(id)
          )
        `);

        await runSql(
          `CREATE INDEX IF NOT EXISTS idx_venda_item_sabores_item ON venda_item_sabores(venda_item_id)`
        );

        resolve();
      } catch (err) {
        reject(err);
      }
    }

    run();
  });
}

module.exports = migration006MontadorCasquinha;
