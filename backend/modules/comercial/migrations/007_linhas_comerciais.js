/**
 * 007 — Schema Políticas Comerciais / linhas_comerciais (RCM-05.5)
 *
 * A-1: seeds automáticos e classificação de produtos DESATIVADOS.
 * Políticas passam a ser cadastradas manualmente pela empresa.
 *
 * @param {Object} db
 * @returns {Promise<void>}
 */
function migration007LinhasComerciais(db) {
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
        await runSql(`
          CREATE TABLE IF NOT EXISTS linhas_comerciais (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            codigo TEXT NOT NULL UNIQUE,
            descricao TEXT NOT NULL,
            ativo INTEGER NOT NULL DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        await runSql(`
          CREATE TABLE IF NOT EXISTS linha_comercial_valores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            linha_id INTEGER NOT NULL,
            canal_venda_id INTEGER NOT NULL,
            preco DECIMAL(12,4) NOT NULL DEFAULT 0,
            forma_comercializacao TEXT DEFAULT NULL,
            unidade_comercial TEXT DEFAULT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(linha_id, canal_venda_id),
            FOREIGN KEY (linha_id) REFERENCES linhas_comerciais(id) ON DELETE CASCADE,
            FOREIGN KEY (canal_venda_id) REFERENCES canais_venda(id)
          )
        `);

        await runSql(
          `CREATE INDEX IF NOT EXISTS idx_linha_valores_linha ON linha_comercial_valores(linha_id)`
        );

        if (!(await colunaExiste('produtos', 'linha_comercial_id'))) {
          await runSql(
            `ALTER TABLE produtos ADD COLUMN linha_comercial_id INTEGER REFERENCES linhas_comerciais(id)`
          );
        }

        await runSql(`
          CREATE TABLE IF NOT EXISTS linhas_comerciais_migracao_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            gerado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
            classificados INTEGER NOT NULL DEFAULT 0,
            nao_classificados INTEGER NOT NULL DEFAULT 0,
            detalhes_json TEXT
          )
        `);

        // A-1: não cria PIC_ESP/PIC_COM/SORVETE/CASQUINHA nem classifica produtos
        console.log(
          '[RCM-05.5/A-1] Schema Politicas Comerciais OK — seeds automaticos desativados'
        );

        resolve();
      } catch (err) {
        reject(err);
      }
    }

    run();
  });
}

module.exports = migration007LinhasComerciais;
