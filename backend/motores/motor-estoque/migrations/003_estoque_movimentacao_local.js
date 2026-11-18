/**
 * Registra o local nas movimentações do Motor de Estoque.
 */

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function run(db, sql) {
  return new Promise((resolve, reject) => {
    db.run(sql, (err) => (err ? reject(err) : resolve()));
  });
}

async function bootstrapLocalMovimentacao(db) {
  const colunas = await all(db, 'PRAGMA table_info(estoque_movimentacoes)');
  if (!colunas.some((coluna) => coluna.name === 'local')) {
    await run(db, 'ALTER TABLE estoque_movimentacoes ADD COLUMN local TEXT');
  }
}

module.exports = { bootstrapLocalMovimentacao };
