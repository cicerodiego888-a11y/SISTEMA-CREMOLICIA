/**
 * RCM-7.2 — Canais Permitidos (N:N) nos Tipos Comerciais
 * ADD only. Compat: tipos existentes recebem Canal Permitido = Canal Padrão.
 *
 * @param {Object} db
 * @returns {Promise<void>}
 */
function migration019TiposComerciaisCanais(db) {
  return new Promise((resolve, reject) => {
    const run = (sql, params = []) =>
      new Promise((res, rej) => {
        db.run(sql, params, function onRun(err) {
          if (err) return rej(err);
          res({ lastID: this.lastID, changes: this.changes });
        });
      });

    const get = (sql, params = []) =>
      new Promise((res, rej) => {
        db.get(sql, params, (err, row) => (err ? rej(err) : res(row || null)));
      });

    const all = (sql, params = []) =>
      new Promise((res, rej) => {
        db.all(sql, params, (err, rows) => (err ? rej(err) : res(rows || [])));
      });

    (async () => {
      try {
        await run(`
          CREATE TABLE IF NOT EXISTS tipo_comercial_canais (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tipo_comercial_id INTEGER NOT NULL,
            canal_venda_id INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(tipo_comercial_id, canal_venda_id),
            FOREIGN KEY (tipo_comercial_id) REFERENCES tipos_comerciais(id) ON DELETE CASCADE,
            FOREIGN KEY (canal_venda_id) REFERENCES canais_venda(id)
          )
        `);

        await run(
          `CREATE INDEX IF NOT EXISTS idx_tipo_comercial_canais_tipo
           ON tipo_comercial_canais(tipo_comercial_id)`
        );
        await run(
          `CREATE INDEX IF NOT EXISTS idx_tipo_comercial_canais_canal
           ON tipo_comercial_canais(canal_venda_id)`
        );

        // Compat RCM-7.1: todo tipo sem vínculo recebe o canal padrão
        const tipos = await all(`SELECT id, codigo, canal_padrao FROM tipos_comerciais`);
        for (const tipo of tipos) {
          const canal = await get(
            `SELECT id FROM canais_venda WHERE UPPER(codigo) = UPPER(?) LIMIT 1`,
            [tipo.canal_padrao]
          );
          if (!canal?.id) continue;
          await run(
            `INSERT OR IGNORE INTO tipo_comercial_canais (tipo_comercial_id, canal_venda_id)
             VALUES (?, ?)`,
            [tipo.id, canal.id]
          );
        }

        // Seeds enterprise (exemplos oficiais) — ADD canais extras sem remover o padrão
        const extrasPorCodigo = {
          ATACADISTA: ['EVENTO'],
          REVENDEDOR: ['CONSIGNADO', 'EVENTO'],
          DISTRIBUIDOR: ['CONSIGNADO', 'DELIVERY'],
          CLIENTE_ESPECIAL: ['DELIVERY', 'EVENTO']
        };

        for (const [codigoTipo, canaisExtra] of Object.entries(extrasPorCodigo)) {
          const tipo = await get(
            `SELECT id FROM tipos_comerciais WHERE UPPER(codigo) = ? LIMIT 1`,
            [codigoTipo]
          );
          if (!tipo?.id) continue;
          for (const codigoCanal of canaisExtra) {
            const canal = await get(
              `SELECT id FROM canais_venda WHERE UPPER(codigo) = ? LIMIT 1`,
              [codigoCanal]
            );
            if (!canal?.id) continue;
            await run(
              `INSERT OR IGNORE INTO tipo_comercial_canais (tipo_comercial_id, canal_venda_id)
               VALUES (?, ?)`,
              [tipo.id, canal.id]
            );
          }
        }

        console.log('[RCM-7.2] migration 019_tipos_comerciais_canais aplicada');
        resolve();
      } catch (err) {
        reject(err);
      }
    })();
  });
}

module.exports = migration019TiposComerciaisCanais;
