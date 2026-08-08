/**
 * MCC-02.1 — Migration: versionamento de conversoes_fisicas_lotes
 *
 * Produto → Lote → Histórico de Conversões → Conversão Ativa
 * Remove UNIQUE(lote_id); passa a UNIQUE parcial (lote_id WHERE ativa=1).
 */

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => {
      if (err && !String(err.message || '').includes('duplicate column')) {
        return reject(err);
      }
      resolve();
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

async function rebuildTabelaComVersionamento(db) {
  await run(db, `DROP TABLE IF EXISTS conversoes_fisicas_lotes_v21`);
  await run(
    db,
    `
    CREATE TABLE conversoes_fisicas_lotes_v21 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      produto_id INTEGER NOT NULL,
      lote_id INTEGER NOT NULL,
      unidade_base TEXT NOT NULL,
      unidade_destino TEXT NOT NULL,
      quantidade_base REAL NOT NULL,
      quantidade_destino REAL NOT NULL,
      fator REAL NOT NULL,
      origem TEXT NOT NULL DEFAULT 'MANUAL',
      versao INTEGER NOT NULL DEFAULT 1,
      ativa INTEGER NOT NULL DEFAULT 1,
      substitui_id INTEGER,
      motivo TEXT,
      usuario_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE CASCADE,
      FOREIGN KEY (lote_id) REFERENCES produtos_lotes(id) ON DELETE CASCADE
    )
  `
  );

  const cols = await all(db, `PRAGMA table_info(conversoes_fisicas_lotes)`);
  const names = new Set(cols.map((c) => c.name));

  if (cols.length) {
    const hasVersao = names.has('versao');
    await run(
      db,
      `
      INSERT INTO conversoes_fisicas_lotes_v21 (
        id, produto_id, lote_id, unidade_base, unidade_destino,
        quantidade_base, quantidade_destino, fator, origem,
        versao, ativa, substitui_id, motivo, usuario_id,
        created_at, updated_at
      )
      SELECT
        id, produto_id, lote_id, unidade_base, unidade_destino,
        quantidade_base, quantidade_destino, fator, origem,
        ${hasVersao ? 'COALESCE(versao, 1)' : '1'},
        ${names.has('ativa') ? 'COALESCE(ativa, 1)' : '1'},
        ${names.has('substitui_id') ? 'substitui_id' : 'NULL'},
        ${names.has('motivo') ? 'motivo' : 'NULL'},
        ${names.has('usuario_id') ? 'usuario_id' : 'NULL'},
        created_at, updated_at
      FROM conversoes_fisicas_lotes
    `
    );
  }

  await run(db, `DROP TABLE IF EXISTS conversoes_fisicas_lotes`);
  await run(db, `ALTER TABLE conversoes_fisicas_lotes_v21 RENAME TO conversoes_fisicas_lotes`);
}

async function bootstrapConversaoFisicaLoteVersionamento(db) {
  // Garante tabela base (MCC-02)
  const { bootstrapConversaoFisicaLoteSchema } = require('./001_conversoes_fisicas_lotes');
  await bootstrapConversaoFisicaLoteSchema(db);

  const cols = await all(db, `PRAGMA table_info(conversoes_fisicas_lotes)`);
  const names = new Set(cols.map((c) => c.name));
  const precisaRebuild = !names.has('versao') || !names.has('ativa');

  // Índice único antigo em lote_id impede múltiplas versões → rebuild
  const indexes = await all(db, `PRAGMA index_list(conversoes_fisicas_lotes)`);
  let temUniqueLoteSimples = false;
  for (const idx of indexes) {
    if (!idx.unique) continue;
    const idxCols = await all(db, `PRAGMA index_info(${idx.name})`);
    if (idxCols.length === 1 && String(idxCols[0].name) === 'lote_id') {
      temUniqueLoteSimples = true;
    }
  }

  if (precisaRebuild || temUniqueLoteSimples) {
    await rebuildTabelaComVersionamento(db);
  } else {
    if (!names.has('versao')) await run(db, `ALTER TABLE conversoes_fisicas_lotes ADD COLUMN versao INTEGER DEFAULT 1`);
    if (!names.has('ativa')) await run(db, `ALTER TABLE conversoes_fisicas_lotes ADD COLUMN ativa INTEGER DEFAULT 1`);
    if (!names.has('substitui_id')) await run(db, `ALTER TABLE conversoes_fisicas_lotes ADD COLUMN substitui_id INTEGER`);
    if (!names.has('motivo')) await run(db, `ALTER TABLE conversoes_fisicas_lotes ADD COLUMN motivo TEXT`);
    if (!names.has('usuario_id')) await run(db, `ALTER TABLE conversoes_fisicas_lotes ADD COLUMN usuario_id INTEGER`);
  }

  await run(
    db,
    `CREATE INDEX IF NOT EXISTS idx_cfl_produto ON conversoes_fisicas_lotes(produto_id)`
  );
  await run(
    db,
    `CREATE INDEX IF NOT EXISTS idx_cfl_lote ON conversoes_fisicas_lotes(lote_id)`
  );
  await run(
    db,
    `CREATE INDEX IF NOT EXISTS idx_cfl_lote_versao ON conversoes_fisicas_lotes(lote_id, versao)`
  );
  // Apenas uma versão ativa por lote
  await run(
    db,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_cfl_lote_ativa
     ON conversoes_fisicas_lotes(lote_id) WHERE COALESCE(ativa, 0) = 1`
  );

  console.log('[MCC-02.1] Versionamento conversoes_fisicas_lotes pronto.');
}

module.exports = {
  bootstrapConversaoFisicaLoteVersionamento,
  rebuildTabelaComVersionamento
};
