/**
 * RCM-7.1 — Tipos Comerciais do Cliente
 * ADD only: tipos_comerciais + clientes.tipo_comercial_id
 * Seeds iniciais + migração automática para Consumidor Final.
 *
 * @param {Object} db
 * @returns {Promise<void>}
 */
function migration018TiposComerciais(db) {
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

    (async () => {
      try {
        await run(`
          CREATE TABLE IF NOT EXISTS tipos_comerciais (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            codigo TEXT NOT NULL UNIQUE,
            descricao TEXT NOT NULL,
            canal_padrao TEXT NOT NULL,
            ativo INTEGER NOT NULL DEFAULT 1,
            observacoes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        await run(
          `CREATE INDEX IF NOT EXISTS idx_tipos_comerciais_canal
           ON tipos_comerciais(canal_padrao)`
        );
        await run(
          `CREATE INDEX IF NOT EXISTS idx_tipos_comerciais_ativo
           ON tipos_comerciais(ativo)`
        );

        // Canais extras necessários aos tipos (sem alterar canais existentes)
        const canaisExtra = [
          ['CONSIGNADO', 'Consignado'],
          ['DELIVERY', 'Delivery']
        ];
        for (const [codigo, nome] of canaisExtra) {
          await run(
            `INSERT OR IGNORE INTO canais_venda (codigo, nome, ativo)
             VALUES (?, ?, 1)`,
            [codigo, nome]
          );
        }

        const totalTipos = await get(`SELECT COUNT(*) AS total FROM tipos_comerciais`);
        const tabelaVazia = Number(totalTipos?.total || 0) === 0;

        // Seed completo só na 1ª instalação (tabela vazia).
        // Se o operador limpar tipos, NÃO recriar no próximo boot (evita IDs 337+).
        const seedsCompletos = [
          ['CONSUMIDOR_FINAL', 'Consumidor Final', 'VAREJO', null],
          ['CONSIGNADO', 'Consignado', 'CONSIGNADO', null],
          ['ATACADISTA', 'Atacadista', 'ATACADO', null],
          ['REVENDEDOR', 'Revendedor', 'ATACADO', null],
          ['DISTRIBUIDOR', 'Distribuidor', 'ATACADO', null],
          ['EVENTO', 'Evento', 'EVENTO', null],
          ['FRANQUIA', 'Franquia', 'VAREJO', null],
          ['CLIENTE_ESPECIAL', 'Cliente Especial', 'VAREJO', null],
          ['DELIVERY', 'Delivery', 'DELIVERY', null]
        ];
        const seedsMinimos = [
          ['CONSUMIDOR_FINAL', 'Consumidor Final', 'VAREJO', null]
        ];
        const seeds = tabelaVazia ? seedsCompletos : seedsMinimos;

        for (const [codigo, descricao, canal, obs] of seeds) {
          await run(
            `INSERT OR IGNORE INTO tipos_comerciais
               (codigo, descricao, canal_padrao, ativo, observacoes)
             VALUES (?, ?, ?, 1, ?)`,
            [codigo, descricao, canal, obs]
          );
        }

        try {
          await run(
            `ALTER TABLE clientes ADD COLUMN tipo_comercial_id INTEGER
             REFERENCES tipos_comerciais(id)`
          );
        } catch (alterErr) {
          if (!/duplicate column/i.test(alterErr.message || '')) throw alterErr;
        }

        await run(
          `CREATE INDEX IF NOT EXISTS idx_clientes_tipo_comercial
           ON clientes(tipo_comercial_id)`
        );

        const consumidor = await get(
          `SELECT id FROM tipos_comerciais
           WHERE UPPER(codigo) = 'CONSUMIDOR_FINAL' LIMIT 1`
        );
        if (consumidor?.id) {
          await run(
            `UPDATE clientes
             SET tipo_comercial_id = ?
             WHERE tipo_comercial_id IS NULL`,
            [consumidor.id]
          );
        }

        console.log('[RCM-7.1] migration 018_tipos_comerciais aplicada');
        resolve();
      } catch (err) {
        reject(err);
      }
    })();
  });
}

module.exports = migration018TiposComerciais;
