/**
 * RA-6.8 — Índices de desempenho (somente índices; sem alteração de comportamento)
 *
 * Evidência: hot path Resolver filtra produtos.linha_comercial_id e
 * tabela_preco_valores por canal; idx_canal pode ter sido perdido no recreate da 012.
 *
 * @param {Object} db
 * @returns {Promise<void>}
 */
function migration017Ra68IndicesPerformance(db) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      const run = (sql) =>
        new Promise((res, rej) => {
          db.run(sql, (err) => {
            if (err && !/already exists/i.test(err.message || '')) return rej(err);
            res();
          });
        });

      (async () => {
        try {
          await run(
            `CREATE INDEX IF NOT EXISTS idx_produtos_linha_comercial
             ON produtos(linha_comercial_id)`
          );
          await run(
            `CREATE INDEX IF NOT EXISTS idx_tabela_preco_valores_canal
             ON tabela_preco_valores(canal_venda_id)`
          );
          await run(
            `CREATE INDEX IF NOT EXISTS idx_tabela_preco_valores_linha
             ON tabela_preco_valores(linha_comercial_id)`
          );
          await run(
            `CREATE UNIQUE INDEX IF NOT EXISTS uq_tpv_tabela_linha_canal
             ON tabela_preco_valores(
               tabela_preco_id,
               IFNULL(linha_comercial_id, 0),
               canal_venda_id
             )`
          );
          console.log('[RA-6.8] migration 017_ra68_indices_performance aplicada');
          resolve();
        } catch (err) {
          reject(err);
        }
      })();
    });
  });
}

module.exports = migration017Ra68IndicesPerformance;
