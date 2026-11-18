'use strict';

function run(db, sql) {
  return new Promise((resolve, reject) => {
    db.run(sql, (err) => (err ? reject(err) : resolve()));
  });
}

function all(db, sql) {
  return new Promise((resolve, reject) => {
    db.all(sql, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

async function bootstrapFichasIndependentes(db) {
  const colunas = await all(db, 'PRAGMA table_info(fichas_tecnicas_padrao)');
  if (!colunas.some((coluna) => coluna.name === 'ficha_tradicional_id')) return;
  const colunasVersoes = await all(db, 'PRAGMA table_info(fichas_tecnicas_padrao_versoes)');
  if (colunasVersoes.some((coluna) => coluna.name === 'ficha_tradicional_revisao')) return;
  await run(db, `
    UPDATE fichas_tecnicas_padrao
    SET ficha_tradicional_id = NULL
    WHERE ficha_tradicional_id IS NOT NULL
  `);
}

module.exports = bootstrapFichasIndependentes;
