/**
 * Fundação Fábrica × Loja.
 * Cria o cadastro da unidade de negócio e, se estiver vazio, registra a operação
 * atual como Loja. Não altera vendas, estoque, compras, financeiro nem NF-e.
 */

const { TIPO_UNIDADE, CODIGO_LOJA_ATUAL } = require('../constants');

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ changes: this.changes, id: this.lastID });
    });
  });
}

async function nomeLojaAtual(db) {
  try {
    const row = await get(db, "SELECT valor FROM configuracoes WHERE chave = 'nome_empresa' LIMIT 1");
    const nome = row && String(row.valor || '').trim();
    if (nome) return nome;
  } catch (err) {
    if (!/no such table/i.test(err.message || '')) throw err;
  }
  return 'Loja';
}

async function bootstrapUnidadesNegocio(db) {
  await run(db, `
    CREATE TABLE IF NOT EXISTS unidades_negocio (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo TEXT NOT NULL,
      nome TEXT NOT NULL,
      tipo TEXT NOT NULL CHECK (tipo IN ('LOJA', 'FABRICA')),
      ativa INTEGER NOT NULL DEFAULT 1 CHECK (ativa IN (0, 1)),
      padrao INTEGER NOT NULL DEFAULT 0 CHECK (padrao IN (0, 1)),
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    )
  `);
  await run(db, `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_unidades_negocio_codigo
    ON unidades_negocio(codigo)
  `);
  await run(db, `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_unidades_negocio_padrao
    ON unidades_negocio(padrao) WHERE padrao = 1
  `);

  const existente = await get(db, 'SELECT COUNT(*) AS total FROM unidades_negocio');
  if (Number(existente && existente.total) === 0) {
    const nome = await nomeLojaAtual(db);
    await run(db, `
      INSERT INTO unidades_negocio (codigo, nome, tipo, ativa, padrao)
      VALUES (?, ?, ?, 1, 1)
    `, [CODIGO_LOJA_ATUAL, nome, TIPO_UNIDADE.LOJA]);
  }

  const fabrica = await get(db, `SELECT id FROM unidades_negocio WHERE tipo = 'FABRICA' LIMIT 1`);
  if (!fabrica) {
    await run(db, `
      INSERT INTO unidades_negocio (codigo, nome, tipo, ativa, padrao)
      VALUES ('FABRICA', 'Fábrica', ?, 1, 0)
    `, [TIPO_UNIDADE.FABRICA]);
  }
}

module.exports = bootstrapUnidadesNegocio;
