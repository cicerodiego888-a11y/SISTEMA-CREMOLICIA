/**
 * UC-01.1 — Migration: prioridade, unidade_padrao, conversao_por_lote, canais
 * Compatível com UC-01 (mantém permite_*).
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

async function bootstrapUc011Schema(db) {
  const colunas = [
    `ALTER TABLE produto_unidades_comercializacao ADD COLUMN prioridade INTEGER DEFAULT 1`,
    `ALTER TABLE produto_unidades_comercializacao ADD COLUMN unidade_padrao INTEGER DEFAULT 0`,
    `ALTER TABLE produto_unidades_comercializacao ADD COLUMN conversao_por_lote INTEGER DEFAULT 0`,
    `ALTER TABLE produto_unidades_comercializacao ADD COLUMN canais_comercializacao TEXT`
  ];

  for (const sql of colunas) {
    await run(db, sql);
  }

  await run(
    db,
    `CREATE INDEX IF NOT EXISTS idx_puc_prioridade ON produto_unidades_comercializacao(produto_id, prioridade)`
  );
  await run(
    db,
    `CREATE INDEX IF NOT EXISTS idx_puc_padrao ON produto_unidades_comercializacao(produto_id, unidade_padrao)`
  );

  // Backfill canais a partir dos flags UC-01 (permite_*)
  const rows = await all(
    db,
    `
      SELECT id, permite_compra, permite_venda, permite_pdv, canais_comercializacao
      FROM produto_unidades_comercializacao
      WHERE canais_comercializacao IS NULL OR TRIM(canais_comercializacao) = ''
    `
  );

  for (const row of rows) {
    const canais = {
      compra: Number(row.permite_compra) === 1 ? 1 : 0,
      venda_erp: Number(row.permite_venda) === 1 ? 1 : 0,
      venda_atacado: Number(row.permite_venda) === 1 ? 1 : 0,
      venda_varejo: Number(row.permite_venda) === 1 ? 1 : 0,
      pdv: Number(row.permite_pdv) === 1 ? 1 : 0,
      nfce: Number(row.permite_pdv) === 1 ? 1 : 0,
      nfe: Number(row.permite_venda) === 1 ? 1 : 0,
      comercial: Number(row.permite_venda) === 1 ? 1 : 0,
      orcamento: Number(row.permite_venda) === 1 ? 1 : 0
    };
    await run(
      db,
      `UPDATE produto_unidades_comercializacao SET canais_comercializacao = ?, prioridade = COALESCE(prioridade, 1) WHERE id = ?`,
      [JSON.stringify(canais), row.id]
    );
  }

  console.log('[UC-01.1] Schema refinado (canais / prioridade / padrão / conversão por lote).');
}

module.exports = { bootstrapUc011Schema };
