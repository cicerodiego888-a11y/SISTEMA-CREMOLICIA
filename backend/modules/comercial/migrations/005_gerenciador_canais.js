/**
 * 005 — Gerenciador de Canais (RCM-05.3)
 *
 * - produtos.participa_atacado (DEFAULT 1 = compat: todos elegíveis)
 * - vendas.canal_venda (cabeçalho da venda)
 *
 * @param {Object} db
 * @returns {Promise<void>}
 */
function migration005GerenciadorCanais(db) {
  return new Promise((resolve, reject) => {
    function colunaExiste(tabela, coluna) {
      return new Promise((res, rej) => {
        db.all(`PRAGMA table_info(${tabela})`, [], (err, cols) => {
          if (err) return rej(err);
          res(new Set((cols || []).map((c) => c.name)).has(coluna));
        });
      });
    }

    async function run() {
      try {
        if (!(await colunaExiste('produtos', 'participa_atacado'))) {
          await new Promise((res, rej) => {
            db.run(
              `ALTER TABLE produtos ADD COLUMN participa_atacado INTEGER DEFAULT 1`,
              [],
              (err) => (err ? rej(err) : res())
            );
          });
        }
        if (!(await colunaExiste('vendas', 'canal_venda'))) {
          await new Promise((res, rej) => {
            db.run(
              `ALTER TABLE vendas ADD COLUMN canal_venda TEXT DEFAULT 'VAREJO'`,
              [],
              (err) => (err ? rej(err) : res())
            );
          });
        }
        resolve();
      } catch (err) {
        reject(err);
      }
    }

    run();
  });
}

module.exports = migration005GerenciadorCanais;
