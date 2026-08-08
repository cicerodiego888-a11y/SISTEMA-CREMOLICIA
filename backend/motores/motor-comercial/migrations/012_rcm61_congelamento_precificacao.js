/**
 * RCM-6.1 — Congelamento completo da precificação no item da consignação
 * ADD only. Compat: itens antigos sem UC usam unidade base do produto.
 *
 * @param {Object} db
 * @returns {Promise<void>}
 */
function migration012Rcm61CongelamentoPrecificacao(db) {
  return new Promise((resolve, reject) => {
    const cols = [
      ['linha_comercial_id', 'INTEGER'],
      ['tabela_preco_id', 'INTEGER'],
      ['canal_venda', 'TEXT'],
      ['unidade_comercial', 'TEXT'],
      ['preco_origem', 'TEXT'],
      ['preco_fallback', 'INTEGER NOT NULL DEFAULT 0']
    ];

    const addCol = (name, type) =>
      new Promise((res, rej) => {
        db.run(
          `ALTER TABLE consignacoes_itens ADD COLUMN ${name} ${type}`,
          (err) => {
            if (err && !/duplicate column/i.test(err.message || '')) return rej(err);
            res();
          }
        );
      });

    (async () => {
      try {
        for (const [name, type] of cols) {
          await addCol(name, type);
        }
        console.log('[RCM-6.1] migration 012_rcm61_congelamento_precificacao aplicada');
        resolve();
      } catch (err) {
        reject(err);
      }
    })();
  });
}

module.exports = migration012Rcm61CongelamentoPrecificacao;
