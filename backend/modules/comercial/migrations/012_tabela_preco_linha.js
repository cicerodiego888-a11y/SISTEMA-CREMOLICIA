/**
 * RCM-05.15 — Tabela de Preço ↔ Linha Comercial
 *
 * - tabela_preco_linhas (N:N)
 * - tabela_preco_valores.linha_comercial_id
 * - UNIQUE (tabela, linha, canal) via índice com IFNULL
 * - Backfill a partir de produtos (sem perda de preços)
 *
 * @param {Object} db
 * @returns {Promise<void>}
 */
function migration012TabelaPrecoLinha(db) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(
        `
        CREATE TABLE IF NOT EXISTS tabela_preco_linhas (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tabela_preco_id INTEGER NOT NULL,
          linha_comercial_id INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(tabela_preco_id, linha_comercial_id),
          FOREIGN KEY (tabela_preco_id) REFERENCES tabelas_preco(id) ON DELETE CASCADE,
          FOREIGN KEY (linha_comercial_id) REFERENCES linhas_comerciais(id)
        )
        `,
        (err) => {
          if (err) return reject(err);

          db.all(`PRAGMA table_info(tabela_preco_valores)`, [], (errInfo, cols) => {
            if (errInfo) return reject(errInfo);
            const nomes = new Set((cols || []).map((c) => c.name));

            const afterColuna = () => {
              db.run(
                `CREATE INDEX IF NOT EXISTS idx_tabela_preco_linhas_tabela
                 ON tabela_preco_linhas(tabela_preco_id)`,
                (e1) => {
                  if (e1) return reject(e1);
                  db.run(
                    `CREATE INDEX IF NOT EXISTS idx_tabela_preco_linhas_linha
                     ON tabela_preco_linhas(linha_comercial_id)`,
                    (e2) => {
                      if (e2) return reject(e2);
                      db.run(
                        `CREATE UNIQUE INDEX IF NOT EXISTS uq_tpv_tabela_linha_canal
                         ON tabela_preco_valores(
                           tabela_preco_id,
                           IFNULL(linha_comercial_id, 0),
                           canal_venda_id
                         )`,
                        (e3) => {
                          if (e3 && !/already exists/i.test(e3.message || '')) {
                            // Pode falhar se ainda existir UNIQUE antigo conflitante — segue recreate
                          }
                          recrearSeNecessario(db, nomes)
                            .then(() => backfill(db))
                            .then(resolve)
                            .catch(reject);
                        }
                      );
                    }
                  );
                }
              );
            };

            if (nomes.has('linha_comercial_id')) {
              afterColuna();
              return;
            }

            db.run(
              `ALTER TABLE tabela_preco_valores
               ADD COLUMN linha_comercial_id INTEGER REFERENCES linhas_comerciais(id)`,
              (alterErr) => {
                if (alterErr && !/duplicate column/i.test(alterErr.message || '')) {
                  return reject(alterErr);
                }
                afterColuna();
              }
            );
          });
        }
      );
    });
  });
}

function recrearSeNecessario(db, nomesAntes) {
  return new Promise((resolve, reject) => {
    // Se a coluna já existia de execução anterior, não recria.
    if (nomesAntes.has('linha_comercial_id')) return resolve();

    db.run('BEGIN TRANSACTION', (begErr) => {
      if (begErr) return reject(begErr);

      db.run('DROP TABLE IF EXISTS tabela_preco_valores_rcm0515', (dropTmpErr) => {
        if (dropTmpErr) {
          db.run('ROLLBACK', () => reject(dropTmpErr));
          return;
        }

      db.run(
        `
        CREATE TABLE tabela_preco_valores_rcm0515 (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tabela_preco_id INTEGER NOT NULL,
          linha_comercial_id INTEGER,
          canal_venda_id INTEGER NOT NULL,
          preco DECIMAL(12,4) NOT NULL DEFAULT 0,
          forma_comercializacao TEXT DEFAULT NULL,
          unidade_comercial TEXT DEFAULT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (tabela_preco_id) REFERENCES tabelas_preco(id) ON DELETE CASCADE,
          FOREIGN KEY (canal_venda_id) REFERENCES canais_venda(id),
          FOREIGN KEY (linha_comercial_id) REFERENCES linhas_comerciais(id)
        )
        `,
        (cErr) => {
          if (cErr) {
            db.run('ROLLBACK', () => reject(cErr));
            return;
          }

          db.run(
            `
            INSERT INTO tabela_preco_valores_rcm0515 (
              id, tabela_preco_id, linha_comercial_id, canal_venda_id, preco,
              forma_comercializacao, unidade_comercial, created_at
            )
            SELECT
              id, tabela_preco_id, linha_comercial_id, canal_venda_id, preco,
              forma_comercializacao, unidade_comercial, created_at
            FROM tabela_preco_valores
            `,
            (iErr) => {
              if (iErr) {
                db.run('ROLLBACK', () => reject(iErr));
                return;
              }

              db.run('DROP TABLE tabela_preco_valores', (dErr) => {
                if (dErr) {
                  db.run('ROLLBACK', () => reject(dErr));
                  return;
                }

                db.run(
                  'ALTER TABLE tabela_preco_valores_rcm0515 RENAME TO tabela_preco_valores',
                  (rErr) => {
                    if (rErr) {
                      db.run('ROLLBACK', () => reject(rErr));
                      return;
                    }

                    db.run(
                      `CREATE UNIQUE INDEX IF NOT EXISTS uq_tpv_tabela_linha_canal
                       ON tabela_preco_valores(
                         tabela_preco_id,
                         IFNULL(linha_comercial_id, 0),
                         canal_venda_id
                       )`,
                      (uErr) => {
                        if (uErr) {
                          db.run('ROLLBACK', () => reject(uErr));
                          return;
                        }
                        db.run(
                          `CREATE INDEX IF NOT EXISTS idx_tabela_preco_valores_tabela
                           ON tabela_preco_valores(tabela_preco_id)`,
                          (xErr) => {
                            if (xErr) {
                              db.run('ROLLBACK', () => reject(xErr));
                              return;
                            }
                            db.run('COMMIT', (cmtErr) => {
                              if (cmtErr) return reject(cmtErr);
                              resolve();
                            });
                          }
                        );
                      }
                    );
                  }
                );
              });
            }
          );
        }
      );
      });
    });
  });
}

function backfill(db) {
  return new Promise((resolve, reject) => {
    db.run(
      `
      INSERT OR IGNORE INTO tabela_preco_linhas (tabela_preco_id, linha_comercial_id)
      SELECT DISTINCT p.tabela_preco_id, p.linha_comercial_id
      FROM produtos p
      WHERE p.tabela_preco_id IS NOT NULL
        AND p.linha_comercial_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM tabelas_preco t WHERE t.id = p.tabela_preco_id)
        AND EXISTS (SELECT 1 FROM linhas_comerciais l WHERE l.id = p.linha_comercial_id)
      `,
      (e1) => {
        if (e1) return reject(e1);

        // Tabela com exatamente 1 linha vinculada: propaga linha nos valores órfãos
        db.run(
          `
          UPDATE tabela_preco_valores
          SET linha_comercial_id = (
            SELECT tpl.linha_comercial_id
            FROM tabela_preco_linhas tpl
            WHERE tpl.tabela_preco_id = tabela_preco_valores.tabela_preco_id
            LIMIT 1
          )
          WHERE linha_comercial_id IS NULL
            AND (
              SELECT COUNT(*) FROM tabela_preco_linhas tpl2
              WHERE tpl2.tabela_preco_id = tabela_preco_valores.tabela_preco_id
            ) = 1
          `,
          (e2) => {
            if (e2) return reject(e2);

            // Sincroniza preços já tipados por linha → linha_comercial_valores (não sobrescreve se já existir)
            db.run(
              `
              INSERT OR IGNORE INTO linha_comercial_valores (
                linha_id, canal_venda_id, preco, forma_comercializacao, unidade_comercial
              )
              SELECT
                v.linha_comercial_id,
                v.canal_venda_id,
                v.preco,
                v.forma_comercializacao,
                v.unidade_comercial
              FROM tabela_preco_valores v
              WHERE v.linha_comercial_id IS NOT NULL
              `,
              (e3) => {
                if (e3 && !/no such table/i.test(e3.message || '')) return reject(e3);
                resolve();
              }
            );
          }
        );
      }
    );
  });
}

module.exports = migration012TabelaPrecoLinha;
