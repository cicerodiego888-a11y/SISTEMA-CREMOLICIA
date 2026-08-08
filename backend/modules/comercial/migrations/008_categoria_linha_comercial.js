/**
 * 008 — Schema Categoria × Linha Comercial (RCM-05.6)
 *
 * A-1: o espelhamento/criação automática foi DESATIVADO.
 * Esta migration apenas garante colunas/índices legados (não destrutivo).
 *
 * @param {Object} db
 * @returns {Promise<void>}
 */
function migration008CategoriaLinhaComercial(db) {
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

    function colunaExiste(tabela, coluna) {
      return all(`PRAGMA table_info(${tabela})`).then(
        (cols) => new Set((cols || []).map((c) => c.name)).has(coluna)
      );
    }

    async function run() {
      try {
        if (!(await colunaExiste('categorias', 'linha_comercial_id'))) {
          await runSql(
            `ALTER TABLE categorias ADD COLUMN linha_comercial_id INTEGER REFERENCES linhas_comerciais(id)`
          );
        }
        if (!(await colunaExiste('categorias', 'codigo'))) {
          await runSql(`ALTER TABLE categorias ADD COLUMN codigo TEXT`);
        }
        if (!(await colunaExiste('linhas_comerciais', 'categoria_origem_id'))) {
          await runSql(
            `ALTER TABLE linhas_comerciais ADD COLUMN categoria_origem_id INTEGER REFERENCES categorias(id)`
          );
        }

        await runSql(
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_linhas_categoria_origem
           ON linhas_comerciais(categoria_origem_id)
           WHERE categoria_origem_id IS NOT NULL`
        );

        await runSql(`
          CREATE TABLE IF NOT EXISTS categoria_linha_migracao_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            gerado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
            sincronizados INTEGER NOT NULL DEFAULT 0,
            corrigidos INTEGER NOT NULL DEFAULT 0,
            inconsistencias INTEGER NOT NULL DEFAULT 0,
            detalhes_json TEXT
          )
        `);

        // A-1: não cria / não espelha Categoria → Política Comercial
        console.log(
          '[RCM-05.6/A-1] Schema Categoria×Linha OK — espelhamento desativado (Politicas sao cadastro independente)'
        );

        resolve();
      } catch (err) {
        reject(err);
      }
    }

    run();
  });
}

module.exports = migration008CategoriaLinhaComercial;
