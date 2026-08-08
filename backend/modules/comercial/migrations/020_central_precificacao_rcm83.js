/**
 * 020 — RCM-8.3 Central de Precificação
 * - Historico de alterações de preço
 * - Status ativo/inativo por célula (linha e produto)
 *
 * @param {Object} db
 * @returns {Promise<void>}
 */
function migration020CentralPrecificacao(db) {
  return new Promise((resolve, reject) => {
    function runSql(sql, params = []) {
      return new Promise((res, rej) => {
        db.run(sql, params, (err) => (err ? rej(err) : res()));
      });
    }

    function all(sql) {
      return new Promise((res, rej) => {
        db.all(sql, [], (err, rows) => (err ? rej(err) : res(rows || [])));
      });
    }

    async function colunaExiste(tabela, coluna) {
      const cols = await all(`PRAGMA table_info(${tabela})`);
      return new Set((cols || []).map((c) => c.name)).has(coluna);
    }

    async function run() {
      try {
        await runSql(`
          CREATE TABLE IF NOT EXISTS tabela_preco_historico (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tabela_preco_id INTEGER NOT NULL,
            referencia_tipo TEXT NOT NULL,
            referencia_id INTEGER NOT NULL,
            referencia_label TEXT,
            preco_anterior DECIMAL(12,4),
            preco_novo DECIMAL(12,4),
            unidade_anterior TEXT,
            unidade_nova TEXT,
            usuario TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (tabela_preco_id) REFERENCES tabelas_preco(id) ON DELETE CASCADE
          )
        `);
        await runSql(
          `CREATE INDEX IF NOT EXISTS idx_tp_hist_tabela
           ON tabela_preco_historico(tabela_preco_id, created_at DESC)`
        );

        if (!(await colunaExiste('tabela_preco_valores', 'ativo'))) {
          await runSql(
            `ALTER TABLE tabela_preco_valores ADD COLUMN ativo INTEGER NOT NULL DEFAULT 1`
          );
        }
        if (!(await colunaExiste('tabela_preco_produto_itens', 'ativo'))) {
          await runSql(
            `ALTER TABLE tabela_preco_produto_itens ADD COLUMN ativo INTEGER NOT NULL DEFAULT 1`
          );
        }

        console.log('[RCM-8.3] Central de Precificação — histórico + status OK');
        resolve();
      } catch (err) {
        reject(err);
      }
    }

    run();
  });
}

module.exports = migration020CentralPrecificacao;
