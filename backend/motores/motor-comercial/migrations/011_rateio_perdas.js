/**
 * 011 — Rateio inteligente de perdas (RC4.2)
 * Tabela de rateio por grupo de prestação + auditoria append-only.
 *
 * @param {Object} db
 * @returns {Promise<void>}
 */
function migration011RateioPerdas(db) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(`
        CREATE TABLE IF NOT EXISTS prestacao_rateio_perdas (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          consignacao_id INTEGER NOT NULL,
          grupo_prestacao_contas_id TEXT NOT NULL UNIQUE,
          tipo_rateio TEXT NOT NULL DEFAULT 'CLIENTE',
          valor_total_perdas DECIMAL(12,2) NOT NULL DEFAULT 0,
          valor_cliente DECIMAL(12,2) NOT NULL DEFAULT 0,
          valor_empresa DECIMAL(12,2) NOT NULL DEFAULT 0,
          percentual_cliente DECIMAL(8,4) NOT NULL DEFAULT 0,
          percentual_empresa DECIMAL(8,4) NOT NULL DEFAULT 0,
          motivo_perda TEXT,
          observacao_perda TEXT,
          usuario_id INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (consignacao_id) REFERENCES consignacoes(id) ON DELETE CASCADE
        )
      `, (err) => {
        if (err) return reject(err);
        db.run(`
          CREATE TABLE IF NOT EXISTS prestacao_rateio_perdas_auditoria (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            rateio_id INTEGER,
            consignacao_id INTEGER NOT NULL,
            grupo_prestacao_contas_id TEXT NOT NULL,
            usuario_id INTEGER,
            tipo_rateio TEXT NOT NULL,
            valor_total_perdas DECIMAL(12,2) NOT NULL DEFAULT 0,
            valor_cliente DECIMAL(12,2) NOT NULL DEFAULT 0,
            valor_empresa DECIMAL(12,2) NOT NULL DEFAULT 0,
            percentual_cliente DECIMAL(8,4) NOT NULL DEFAULT 0,
            percentual_empresa DECIMAL(8,4) NOT NULL DEFAULT 0,
            motivo_perda TEXT,
            observacao_perda TEXT,
            acao TEXT NOT NULL DEFAULT 'DEFINIR',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (rateio_id) REFERENCES prestacao_rateio_perdas(id) ON DELETE SET NULL
          )
        `, (err2) => {
          if (err2) return reject(err2);
          db.run(
            `CREATE INDEX IF NOT EXISTS idx_rateio_perdas_consignacao
             ON prestacao_rateio_perdas(consignacao_id)`,
            (err3) => (err3 ? reject(err3) : resolve())
          );
        });
      });
    });
  });
}

module.exports = migration011RateioPerdas;
