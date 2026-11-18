'use strict';

/**
 * Conversão do estoque dos produtos-linha legados (FABRICA-CONVERSAO-02).
 *
 * - linhas_produtos_legado: produto que hoje "funciona como linha" → Linha de Produtos.
 * - conversoes_estoque_linha: uma conversão por correlation_id (não repete).
 * - conversoes_estoque_linha_itens: quanto cada sabor recebeu.
 *
 * O saldo continua só em produtos (Motor de Estoque); estas tabelas são o registro da operação.
 */

function run(db, sql) {
  return new Promise((resolve, reject) => {
    db.run(sql, (err) => (err ? reject(err) : resolve()));
  });
}

async function bootstrapConversoesEstoqueLinha(db) {
  await run(db, `
    CREATE TABLE IF NOT EXISTS linhas_produtos_legado (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      linha_produtos_id INTEGER NOT NULL REFERENCES linhas_produtos(id),
      produto_id INTEGER NOT NULL UNIQUE REFERENCES produtos(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `);
  await run(db, 'CREATE INDEX IF NOT EXISTS idx_linhas_produtos_legado_linha ON linhas_produtos_legado(linha_produtos_id)');

  await run(db, `
    CREATE TABLE IF NOT EXISTS conversoes_estoque_linha (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      correlation_id TEXT NOT NULL UNIQUE,
      linha_produtos_id INTEGER NOT NULL REFERENCES linhas_produtos(id),
      produto_origem_id INTEGER NOT NULL REFERENCES produtos(id),
      quantidade_total REAL NOT NULL,
      quantidade_fiscal REAL NOT NULL DEFAULT 0,
      quantidade_nao_fiscal REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'CONCLUIDA',
      observacao TEXT,
      usuario_id INTEGER,
      usuario_nome TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `);
  await run(db, 'CREATE INDEX IF NOT EXISTS idx_conversoes_estoque_linha_origem ON conversoes_estoque_linha(produto_origem_id)');

  await run(db, `
    CREATE TABLE IF NOT EXISTS conversoes_estoque_linha_itens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversao_id INTEGER NOT NULL REFERENCES conversoes_estoque_linha(id),
      produto_id INTEGER NOT NULL REFERENCES produtos(id),
      quantidade_fiscal REAL NOT NULL DEFAULT 0,
      quantidade_nao_fiscal REAL NOT NULL DEFAULT 0,
      quantidade_total REAL NOT NULL DEFAULT 0,
      estoque_antes REAL,
      estoque_depois REAL,
      reativado INTEGER NOT NULL DEFAULT 0
    )
  `);
  await run(db, 'CREATE INDEX IF NOT EXISTS idx_conversoes_estoque_linha_itens_conversao ON conversoes_estoque_linha_itens(conversao_id)');
}

module.exports = bootstrapConversoesEstoqueLinha;
