/**
 * RA-2 — Linha de Precificação
 * ADD only: tabela padrão no contexto da venda (configuração comercial).
 * Não remove colunas/tabelas legadas.
 *
 * @param {Object} db
 * @returns {Promise<void>}
 */
function migration015LinhaPrecificacaoRa2(db) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(
        `ALTER TABLE configuracao_comercial ADD COLUMN tabela_preco_padrao_id INTEGER REFERENCES tabelas_preco(id)`,
        (err) => {
          if (err && !/duplicate column/i.test(err.message || '')) {
            return reject(err);
          }

          // Se existir tabela PADRAO ativa e config sem padrão, vincula
          db.get(
            `SELECT id FROM tabelas_preco
             WHERE UPPER(codigo) = 'PADRAO' AND COALESCE(ativo,1) = 1
             LIMIT 1`,
            [],
            (errPadrao, padrao) => {
              if (errPadrao) return reject(errPadrao);
              if (!padrao?.id) {
                console.log('[RA-2] migration 015_linha_precificacao_ra2 aplicada (sem tabela PADRAO)');
                return resolve();
              }
              db.run(
                `UPDATE configuracao_comercial
                 SET tabela_preco_padrao_id = COALESCE(tabela_preco_padrao_id, ?)
                 WHERE tabela_preco_padrao_id IS NULL`,
                [padrao.id],
                (errUp) => {
                  if (errUp) return reject(errUp);
                  console.log('[RA-2] migration 015_linha_precificacao_ra2 aplicada');
                  resolve();
                }
              );
            }
          );
        }
      );
    });
  });
}

module.exports = migration015LinhaPrecificacaoRa2;
