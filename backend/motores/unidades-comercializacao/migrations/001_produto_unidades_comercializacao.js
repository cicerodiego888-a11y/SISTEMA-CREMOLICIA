/**
 * UC-01 — Migration: produto_unidades_comercializacao + flags no produto
 *
 * SSOT de estoque permanece em produtos (unidade + saldo).
 * Esta tabela NÃO cria estoques paralelos.
 * NÃO altera produto_unidades (MUC legado) nem vendas_itens.
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

async function bootstrapUnidadesComercializacaoSchema(db) {
  await run(
    db,
    `
    CREATE TABLE IF NOT EXISTS produto_unidades_comercializacao (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      produto_id INTEGER NOT NULL,
      descricao TEXT NOT NULL,
      tipo TEXT NOT NULL,
      unidade_comercial TEXT NOT NULL,
      quantidade REAL NOT NULL DEFAULT 1,
      unidade_base TEXT NOT NULL,
      permite_compra INTEGER NOT NULL DEFAULT 1,
      permite_venda INTEGER NOT NULL DEFAULT 1,
      permite_pdv INTEGER NOT NULL DEFAULT 1,
      ordem INTEGER NOT NULL DEFAULT 0,
      ativo INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE CASCADE
    )
  `
  );

  await run(
    db,
    `CREATE INDEX IF NOT EXISTS idx_puc_produto ON produto_unidades_comercializacao(produto_id)`
  );
  await run(
    db,
    `CREATE INDEX IF NOT EXISTS idx_puc_tipo ON produto_unidades_comercializacao(tipo)`
  );
  await run(
    db,
    `CREATE INDEX IF NOT EXISTS idx_puc_ativo ON produto_unidades_comercializacao(produto_id, ativo)`
  );

  // Flags de conversão física no cadastro (sem fator — fator entra na compra, sprint futura)
  await run(db, `ALTER TABLE produtos ADD COLUMN utiliza_conversao_fisica INTEGER DEFAULT 0`);
  await run(db, `ALTER TABLE produtos ADD COLUMN unidade_conversao_fisica TEXT`);

  console.log('[UC-01] Schema produto_unidades_comercializacao pronto.');
}

module.exports = { bootstrapUnidadesComercializacaoSchema };
