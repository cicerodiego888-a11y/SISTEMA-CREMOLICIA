'use strict';

function run(db, sql) {
  return new Promise((resolve, reject) => {
    db.run(sql, (err) => (err ? reject(err) : resolve()));
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

async function garantirTriggerComExclusaoAutorizada(db, nome, sql) {
  const trigger = await get(db, `
    SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?
  `, [nome]);
  if (trigger && /fichas_tecnicas_padrao_exclusao_autorizada/i.test(trigger.sql || '')) return;
  await run(db, `DROP TRIGGER IF EXISTS ${nome}`);
  await run(db, sql);
}

async function bootstrapExclusaoFichasPadrao(db) {
  await run(db, `
    CREATE TABLE IF NOT EXISTS fichas_tecnicas_padrao_exclusao_autorizada (
      ficha_padrao_id INTEGER PRIMARY KEY
    )
  `);

  await garantirTriggerComExclusaoAutorizada(db, 'trg_fichas_tecnicas_padrao_versoes_publicada_delete', `
    CREATE TRIGGER trg_fichas_tecnicas_padrao_versoes_publicada_delete
    BEFORE DELETE ON fichas_tecnicas_padrao_versoes
    WHEN OLD.estado = 'PUBLICADA'
      AND NOT EXISTS (
        SELECT 1 FROM fichas_tecnicas_padrao_exclusao_autorizada
        WHERE ficha_padrao_id = OLD.ficha_padrao_id
      )
    BEGIN
      SELECT RAISE(ABORT, 'Versão publicada não pode ser excluída.');
    END
  `);
  for (const [tabela, campo] of [
    ['fichas_tecnicas_padrao_versao_componentes', 'versao_id'],
    ['fichas_tecnicas_padrao_versao_etapas', 'versao_id'],
    ['fichas_tecnicas_padrao_versao_informacoes', 'versao_id']
  ]) {
    const nome = `trg_${tabela}_publicada_delete`;
    await garantirTriggerComExclusaoAutorizada(db, nome, `
      CREATE TRIGGER ${nome}
      BEFORE DELETE ON ${tabela}
      WHEN EXISTS (
        SELECT 1 FROM fichas_tecnicas_padrao_versoes
        WHERE id = OLD.${campo} AND estado = 'PUBLICADA'
      )
      AND NOT EXISTS (
        SELECT 1 FROM fichas_tecnicas_padrao_exclusao_autorizada autorizada
        JOIN fichas_tecnicas_padrao_versoes versao
          ON versao.ficha_padrao_id = autorizada.ficha_padrao_id
        WHERE versao.id = OLD.${campo}
      )
      BEGIN
        SELECT RAISE(ABORT, 'Conteúdo de versão publicada é imutável.');
      END
    `);
  }
}

module.exports = bootstrapExclusaoFichasPadrao;
