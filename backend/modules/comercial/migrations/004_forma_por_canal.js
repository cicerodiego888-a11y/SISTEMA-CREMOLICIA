/**
 * 004 — Forma/Unidade comercial por canal na Tabela de Preço (RCM-05.1)
 *
 * NULL = herda forma/unidade do produto (compatibilidade total).
 *
 * @param {Object} db
 * @returns {Promise<void>}
 */
function migration004FormaPorCanal(db) {
  return new Promise((resolve, reject) => {
    db.all(`PRAGMA table_info(tabela_preco_valores)`, [], (err, cols) => {
      if (err) return reject(err);
      const nomes = new Set((cols || []).map((c) => c.name));

      const steps = [];
      if (!nomes.has('forma_comercializacao')) {
        steps.push(
          `ALTER TABLE tabela_preco_valores ADD COLUMN forma_comercializacao TEXT DEFAULT NULL`
        );
      }
      if (!nomes.has('unidade_comercial')) {
        steps.push(
          `ALTER TABLE tabela_preco_valores ADD COLUMN unidade_comercial TEXT DEFAULT NULL`
        );
      }

      if (!steps.length) return resolve();

      let i = 0;
      function next() {
        if (i >= steps.length) return resolve();
        db.run(steps[i], [], (runErr) => {
          if (runErr) return reject(runErr);
          i += 1;
          next();
        });
      }
      next();
    });
  });
}

module.exports = migration004FormaPorCanal;
