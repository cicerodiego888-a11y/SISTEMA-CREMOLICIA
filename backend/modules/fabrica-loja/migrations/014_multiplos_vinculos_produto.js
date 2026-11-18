'use strict';

function get(db, sql) {
  return new Promise((resolve, reject) => {
    db.get(sql, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function run(db, sql) {
  return new Promise((resolve, reject) => {
    db.run(sql, (err) => (err ? reject(err) : resolve()));
  });
}

async function bootstrapMultiplosVinculosProduto(db) {
  const tabela = await get(db, `
    SELECT 1 AS ok FROM sqlite_master
    WHERE type = 'table' AND name = 'fichas_tecnicas_padrao_vinculos'
  `);
  if (!tabela) throw new Error('A tabela de vínculos de fichas padrão deve existir antes da migração.');

  await run(db, 'DROP INDEX IF EXISTS idx_fichas_tecnicas_padrao_vinculos_produto_ativo');
  await run(db, `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_fichas_tecnicas_padrao_vinculos_produto_ficha_ativo
    ON fichas_tecnicas_padrao_vinculos(produto_id, ficha_padrao_id)
    WHERE ativo = 1
  `);
}

module.exports = bootstrapMultiplosVinculosProduto;
