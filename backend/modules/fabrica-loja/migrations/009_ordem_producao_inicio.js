/**
 * Marca quando a ordem entrou em produção.
 * Não movimenta estoque e não cria execução.
 */

function run(db, sql) {
  return new Promise((resolve, reject) => {
    db.run(sql, (err) => {
      if (err && !/duplicate column name/i.test(err.message || '')) reject(err);
      else resolve();
    });
  });
}

async function bootstrapInicioProducao(db) {
  await run(db, 'ALTER TABLE ordens_producao ADD COLUMN producao_iniciada_em TEXT');
  await run(db, 'ALTER TABLE ordens_producao ADD COLUMN producao_usuario_id INTEGER');
  await run(db, 'ALTER TABLE ordens_producao ADD COLUMN producao_usuario_nome TEXT');
}

module.exports = bootstrapInicioProducao;
