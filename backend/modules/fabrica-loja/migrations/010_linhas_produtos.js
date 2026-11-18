'use strict';

/**
 * Linha de Produtos (FABRICA-MODELO-01).
 *
 * Agrupa produtos físicos (ex.: "Picolé Cremoso" → sabores). Não é produto:
 * não tem produto_id, não tem estoque, não é fabricada e não entra em OP.
 * Não confundir com `linhas_comerciais` (Linha de Precificação).
 *
 * Cardinalidade: Linha 0..N produtos; Produto 0..1 Linha (produtos.linha_produtos_id).
 */

function run(db, sql) {
  return new Promise((resolve, reject) => {
    db.run(sql, (err) => {
      if (err && !/duplicate column name/i.test(err.message || '')) reject(err);
      else resolve();
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

async function bootstrapLinhasProdutos(db) {
  await run(db, `
    CREATE TABLE IF NOT EXISTS linhas_produtos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo TEXT,
      nome TEXT NOT NULL,
      descricao TEXT,
      ativo INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `);
  await run(db, 'CREATE UNIQUE INDEX IF NOT EXISTS idx_linhas_produtos_nome ON linhas_produtos(lower(trim(nome)))');
  await run(db, `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_linhas_produtos_codigo
    ON linhas_produtos(trim(codigo))
    WHERE codigo IS NOT NULL AND trim(codigo) <> ''
  `);

  const produtos = await get(db, `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'produtos'`);
  if (!produtos) return;

  await run(db, 'ALTER TABLE produtos ADD COLUMN linha_produtos_id INTEGER REFERENCES linhas_produtos(id)');
  await run(db, 'CREATE INDEX IF NOT EXISTS idx_produtos_linha_produtos ON produtos(linha_produtos_id)');

  // PRAGMA foreign_keys é por conexão; os triggers garantem a relação em qualquer conexão.
  await run(db, `
    CREATE TRIGGER IF NOT EXISTS trg_produtos_linha_produtos_insert
    BEFORE INSERT ON produtos
    WHEN NEW.linha_produtos_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM linhas_produtos WHERE id = NEW.linha_produtos_id)
    BEGIN
      SELECT RAISE(ABORT, 'Linha de Produtos inexistente.');
    END
  `);
  await run(db, `
    CREATE TRIGGER IF NOT EXISTS trg_produtos_linha_produtos_update
    BEFORE UPDATE OF linha_produtos_id ON produtos
    WHEN NEW.linha_produtos_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM linhas_produtos WHERE id = NEW.linha_produtos_id)
    BEGIN
      SELECT RAISE(ABORT, 'Linha de Produtos inexistente.');
    END
  `);
  await run(db, `
    CREATE TRIGGER IF NOT EXISTS trg_linhas_produtos_delete
    BEFORE DELETE ON linhas_produtos
    WHEN EXISTS (SELECT 1 FROM produtos WHERE linha_produtos_id = OLD.id)
    BEGIN
      SELECT RAISE(ABORT, 'Linha de Produtos possui produtos vinculados. Desative a linha.');
    END
  `);
}

module.exports = bootstrapLinhasProdutos;
