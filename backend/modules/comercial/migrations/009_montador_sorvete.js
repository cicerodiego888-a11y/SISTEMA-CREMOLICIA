/**
 * 009 — Montador de Sorvete (RCM-05.7)
 * Persiste forma comercial resolvida no item da venda (auditoria).
 *
 * @param {Object} db
 * @returns {Promise<void>}
 */
function migration009MontadorSorvete(db) {
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

    async function run() {
      try {
        if (!(await colunaExiste('vendas_itens', 'forma_comercializacao'))) {
          await runSql(
            `ALTER TABLE vendas_itens ADD COLUMN forma_comercializacao TEXT DEFAULT NULL`
          );
        }
        console.log('[RCM-05.7] Montador de Sorvete: coluna forma_comercializacao em vendas_itens OK');
        resolve();
      } catch (err) {
        reject(err);
      }
    }

    run();
  });
}

module.exports = migration009MontadorSorvete;
