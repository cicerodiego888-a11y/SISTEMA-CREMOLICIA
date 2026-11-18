/**
 * Ficha técnica: definição de como um produto é fabricado.
 * Não cria ordem de produção, consumo, entrada de estoque nem transferência.
 */

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function run(db, sql) {
  return new Promise((resolve, reject) => {
    db.run(sql, function onRun(err) {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function tabelaExiste(db, nome) {
  const row = await get(db, `
    SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?
  `, [nome]);
  return !!row;
}

async function substituirTabelaAntigaVazia(db) {
  if (!(await tabelaExiste(db, 'fichas_tecnicas'))) return;
  const colunas = await all(db, 'PRAGMA table_info(fichas_tecnicas)');
  if (colunas.some((coluna) => coluna.name === 'codigo')) return;

  const fichas = await get(db, 'SELECT COUNT(*) AS total FROM fichas_tecnicas');
  let itens = 0;
  if (await tabelaExiste(db, 'fichas_tecnicas_itens')) {
    const row = await get(db, 'SELECT COUNT(*) AS total FROM fichas_tecnicas_itens');
    itens = Number(row && row.total) || 0;
  }
  if ((Number(fichas && fichas.total) || 0) > 0 || itens > 0) {
    throw new Error('A tabela fichas_tecnicas já existe com outro formato e contém dados. A inicialização parou para não apagar essas fichas.');
  }

  await run(db, 'DROP TABLE IF EXISTS fichas_tecnicas_itens');
  await run(db, 'DROP TABLE fichas_tecnicas');
}

async function bootstrapFichasTecnicas(db) {
  await substituirTabelaAntigaVazia(db);
  await run(db, `
    CREATE TABLE IF NOT EXISTS fichas_tecnicas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo TEXT NOT NULL,
      nome TEXT NOT NULL,
      produto_id INTEGER,
      produto_nome TEXT,
      rendimento_quantidade REAL,
      rendimento_unidade TEXT,
      observacoes TEXT,
      ativa INTEGER NOT NULL DEFAULT 1 CHECK (ativa IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `);
  await run(db, `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_fichas_tecnicas_codigo
    ON fichas_tecnicas(codigo)
  `);
  await run(db, `
    CREATE TABLE IF NOT EXISTS ficha_tecnica_componentes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ficha_id INTEGER NOT NULL,
      ordem INTEGER NOT NULL,
      produto_id INTEGER,
      descricao TEXT NOT NULL,
      quantidade REAL,
      unidade TEXT,
      observacao TEXT
    )
  `);
  await run(db, `
    CREATE INDEX IF NOT EXISTS idx_ficha_tecnica_componentes_ficha
    ON ficha_tecnica_componentes(ficha_id, ordem)
  `);
  await run(db, `
    CREATE TABLE IF NOT EXISTS ficha_tecnica_etapas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ficha_id INTEGER NOT NULL,
      ordem INTEGER NOT NULL,
      titulo TEXT NOT NULL,
      descricao TEXT,
      tempo_minutos REAL,
      observacao TEXT
    )
  `);
  await run(db, `
    CREATE INDEX IF NOT EXISTS idx_ficha_tecnica_etapas_ficha
    ON ficha_tecnica_etapas(ficha_id, ordem)
  `);
  await run(db, `
    CREATE TABLE IF NOT EXISTS ficha_tecnica_informacoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ficha_id INTEGER NOT NULL,
      ordem INTEGER NOT NULL,
      titulo TEXT NOT NULL,
      valor TEXT
    )
  `);
  await run(db, `
    CREATE INDEX IF NOT EXISTS idx_ficha_tecnica_informacoes_ficha
    ON ficha_tecnica_informacoes(ficha_id, ordem)
  `);
}

module.exports = bootstrapFichasTecnicas;
