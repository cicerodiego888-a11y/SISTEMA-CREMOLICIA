/**
 * 003 — Configuração Comercial / Venda no Atacado (RCM-04.5)
 *
 * @param {Object} db
 * @returns {Promise<void>}
 */
function migration003ConfiguracaoComercial(db) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(
        `
        CREATE TABLE IF NOT EXISTS configuracao_comercial (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          atacado_habilitado INTEGER NOT NULL DEFAULT 0,
          quantidade_minima REAL NOT NULL DEFAULT 30,
          tipo_contagem TEXT NOT NULL DEFAULT 'TOTAL_VENDA',
          permitir_produtos_diferentes INTEGER NOT NULL DEFAULT 1,
          permitir_categorias_diferentes INTEGER NOT NULL DEFAULT 1,
          canal_atacado_id INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (canal_atacado_id) REFERENCES canais_venda(id)
        )
        `,
        (err) => {
          if (err) return reject(err);

          db.get('SELECT id FROM configuracao_comercial LIMIT 1', [], (getErr, row) => {
            if (getErr) return reject(getErr);
            if (row) return resolve();

            db.get(
              `SELECT id FROM canais_venda WHERE UPPER(codigo) = 'ATACADO' LIMIT 1`,
              [],
              (canalErr, canal) => {
                if (canalErr) return reject(canalErr);
                db.run(
                  `
                  INSERT INTO configuracao_comercial (
                    atacado_habilitado, quantidade_minima, tipo_contagem,
                    permitir_produtos_diferentes, permitir_categorias_diferentes,
                    canal_atacado_id
                  ) VALUES (0, 30, 'TOTAL_VENDA', 1, 1, ?)
                  `,
                  [canal?.id || null],
                  (insErr) => (insErr ? reject(insErr) : resolve())
                );
              }
            );
          });
        }
      );
    });
  });
}

module.exports = migration003ConfiguracaoComercial;
