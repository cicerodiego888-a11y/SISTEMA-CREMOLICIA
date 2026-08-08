/**
 * RCM-04.1 — Fundação Comercial V2
 * Tabelas: canais_venda, tabelas_preco, tabela_preco_valores
 * + produtos.tabela_preco_id (sem remover preços legados)
 *
 * @param {Object} db
 * @returns {Promise<void>}
 */
function migration001CanaisTabelasPreco(db) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(`
        CREATE TABLE IF NOT EXISTS canais_venda (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          codigo TEXT NOT NULL UNIQUE,
          nome TEXT NOT NULL,
          ativo INTEGER NOT NULL DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) return reject(err);

        db.run(`
          CREATE TABLE IF NOT EXISTS tabelas_preco (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            codigo TEXT NOT NULL UNIQUE,
            nome TEXT NOT NULL,
            descricao TEXT,
            ativo INTEGER NOT NULL DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `, (err2) => {
          if (err2) return reject(err2);

          db.run(`
            CREATE TABLE IF NOT EXISTS tabela_preco_valores (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              tabela_preco_id INTEGER NOT NULL,
              canal_venda_id INTEGER NOT NULL,
              preco DECIMAL(12,4) NOT NULL DEFAULT 0,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              UNIQUE(tabela_preco_id, canal_venda_id),
              FOREIGN KEY (tabela_preco_id) REFERENCES tabelas_preco(id) ON DELETE CASCADE,
              FOREIGN KEY (canal_venda_id) REFERENCES canais_venda(id)
            )
          `, (err3) => {
            if (err3) return reject(err3);

            db.run(
              `CREATE INDEX IF NOT EXISTS idx_tabela_preco_valores_tabela
               ON tabela_preco_valores(tabela_preco_id)`,
              (err4) => {
                if (err4) return reject(err4);

                db.run(
                  `CREATE INDEX IF NOT EXISTS idx_tabela_preco_valores_canal
                   ON tabela_preco_valores(canal_venda_id)`,
                  (err5) => {
                    if (err5) return reject(err5);

                    db.run(
                      `ALTER TABLE produtos ADD COLUMN tabela_preco_id INTEGER REFERENCES tabelas_preco(id)`,
                      (alterErr) => {
                        // Coluna já existente é esperada em reexecuções
                        if (alterErr && !/duplicate column/i.test(alterErr.message || '')) {
                          return reject(alterErr);
                        }

                        const seeds = [
                          ['VAREJO', 'Varejo'],
                          ['ATACADO', 'Atacado'],
                          ['EVENTO', 'Evento']
                        ];

                        const stmt = db.prepare(`
                          INSERT OR IGNORE INTO canais_venda (codigo, nome, ativo)
                          VALUES (?, ?, 1)
                        `);

                        for (const [codigo, nome] of seeds) {
                          stmt.run(codigo, nome);
                        }

                        stmt.finalize((finErr) => {
                          if (finErr) return reject(finErr);
                          resolve();
                        });
                      }
                    );
                  }
                );
              }
            );
          });
        });
      });
    });
  });
}

module.exports = migration001CanaisTabelasPreco;
