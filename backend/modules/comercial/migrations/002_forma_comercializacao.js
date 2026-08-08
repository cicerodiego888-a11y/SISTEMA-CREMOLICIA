/**
 * 002 — Forma de Comercialização no produto (RCM-04.3)
 *
 * @param {Object} db
 * @returns {Promise<void>}
 */
function migration002FormaComercializacao(db) {
  const colunas = [
    `ALTER TABLE produtos ADD COLUMN forma_comercializacao TEXT DEFAULT 'UNIDADE'`,
    `ALTER TABLE produtos ADD COLUMN unidade_venda TEXT`,
    `ALTER TABLE produtos ADD COLUMN quantidade_bolas REAL DEFAULT 0`,
    `ALTER TABLE produtos ADD COLUMN peso_medio_bola REAL DEFAULT 0`,
    `ALTER TABLE produtos ADD COLUMN forma_personalizada_nome TEXT`,
    `ALTER TABLE produtos ADD COLUMN forma_personalizada_unidade TEXT`
  ];

  return new Promise((resolve, reject) => {
    let pendentes = colunas.length;
    if (pendentes === 0) return resolve();

    colunas.forEach((sql) => {
      db.run(sql, (err) => {
        if (err && !/duplicate column/i.test(err.message || '')) {
          return reject(err);
        }
        pendentes -= 1;
        if (pendentes === 0) {
          // Backfill a partir de flags legadas
          db.run(
            `
            UPDATE produtos
            SET forma_comercializacao = CASE
              WHEN COALESCE(produto_fracionado, vendido_por_peso, 0) = 1
                   AND LOWER(COALESCE(unidade, '')) IN ('l', 'ml', 'lt', 'litro', 'litros')
                THEN 'VOLUME'
              WHEN COALESCE(produto_fracionado, vendido_por_peso, 0) = 1
                THEN 'PESO'
              ELSE COALESCE(NULLIF(TRIM(forma_comercializacao), ''), 'UNIDADE')
            END
            WHERE forma_comercializacao IS NULL
               OR TRIM(forma_comercializacao) = ''
               OR forma_comercializacao = 'UNIDADE'
            `,
            (backfillErr) => {
              // Não sobrescreve CASQUINHA/PERSONALIZADA já gravadas; o WHERE acima
              // só preenche/ajusta UNIDADE vazio ou legado fracionado.
              // Reexecutar o CASE apenas para fracionados ainda como UNIDADE:
              db.run(
                `
                UPDATE produtos
                SET forma_comercializacao = CASE
                  WHEN COALESCE(produto_fracionado, vendido_por_peso, 0) = 1
                       AND LOWER(COALESCE(unidade, '')) IN ('l', 'ml', 'lt', 'litro', 'litros')
                    THEN 'VOLUME'
                  WHEN COALESCE(produto_fracionado, vendido_por_peso, 0) = 1
                    THEN 'PESO'
                  ELSE forma_comercializacao
                END
                WHERE COALESCE(forma_comercializacao, 'UNIDADE') = 'UNIDADE'
                  AND COALESCE(produto_fracionado, vendido_por_peso, 0) = 1
                `,
                (err2) => {
                  if (backfillErr && !/no such/i.test(backfillErr.message || '')) {
                    return reject(backfillErr);
                  }
                  if (err2 && !/no such/i.test(err2.message || '')) {
                    return reject(err2);
                  }
                  resolve();
                }
              );
            }
          );
        }
      });
    });
  });
}

module.exports = migration002FormaComercializacao;
