/**
 * RA-6 — Tabela de Preços mono-canal + regras comerciais na tabela
 * ADD only. Compat: valores multi-canal antigos permanecem legíveis.
 *
 * @param {Object} db
 * @returns {Promise<void>}
 */
function migration016TabelaMonoCanalRa6(db) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      const cols = [];

      const addCol = (sql) =>
        new Promise((res, rej) => {
          db.run(sql, (err) => {
            if (err && !/duplicate column/i.test(err.message || '')) return rej(err);
            res();
          });
        });

      db.all(`PRAGMA table_info(tabelas_preco)`, [], async (err, rows) => {
        if (err) return reject(err);
        const nomes = new Set((rows || []).map((c) => c.name));

        try {
          if (!nomes.has('canal_venda_id')) {
            await addCol(
              `ALTER TABLE tabelas_preco ADD COLUMN canal_venda_id INTEGER REFERENCES canais_venda(id)`
            );
          }
          if (!nomes.has('atacado_habilitado')) {
            await addCol(`ALTER TABLE tabelas_preco ADD COLUMN atacado_habilitado INTEGER NOT NULL DEFAULT 0`);
          }
          if (!nomes.has('quantidade_minima')) {
            await addCol(`ALTER TABLE tabelas_preco ADD COLUMN quantidade_minima INTEGER NOT NULL DEFAULT 0`);
          }
          if (!nomes.has('tipo_contagem')) {
            await addCol(
              `ALTER TABLE tabelas_preco ADD COLUMN tipo_contagem TEXT NOT NULL DEFAULT 'TOTAL_VENDA'`
            );
          }
          if (!nomes.has('permitir_produtos_diferentes')) {
            await addCol(
              `ALTER TABLE tabelas_preco ADD COLUMN permitir_produtos_diferentes INTEGER NOT NULL DEFAULT 1`
            );
          }
          if (!nomes.has('permitir_categorias_diferentes')) {
            await addCol(
              `ALTER TABLE tabelas_preco ADD COLUMN permitir_categorias_diferentes INTEGER NOT NULL DEFAULT 1`
            );
          }

          // Backfill canal: canal mais frequente nos valores; senão VAREJO
          await new Promise((res, rej) => {
            db.run(
              `
              UPDATE tabelas_preco
              SET canal_venda_id = (
                SELECT v.canal_venda_id
                FROM tabela_preco_valores v
                WHERE v.tabela_preco_id = tabelas_preco.id
                GROUP BY v.canal_venda_id
                ORDER BY COUNT(*) DESC, v.canal_venda_id ASC
                LIMIT 1
              )
              WHERE canal_venda_id IS NULL
                AND EXISTS (
                  SELECT 1 FROM tabela_preco_valores v2
                  WHERE v2.tabela_preco_id = tabelas_preco.id
                )
              `,
              (e1) => (e1 ? rej(e1) : res())
            );
          });

          await new Promise((res, rej) => {
            db.run(
              `
              UPDATE tabelas_preco
              SET canal_venda_id = (
                SELECT id FROM canais_venda WHERE UPPER(codigo) = 'VAREJO' LIMIT 1
              )
              WHERE canal_venda_id IS NULL
              `,
              (e2) => (e2 ? rej(e2) : res())
            );
          });

          // Canais padrão RA-6 (idempotente)
          const seeds = [
            ['VAREJO', 'Varejo'],
            ['ATACADO', 'Atacado'],
            ['CONSIGNADO', 'Consignado'],
            ['DELIVERY', 'Delivery'],
            ['EVENTO', 'Evento']
          ];
          await new Promise((res, rej) => {
            const stmt = db.prepare(
              `INSERT OR IGNORE INTO canais_venda (codigo, nome, ativo) VALUES (?, ?, 1)`
            );
            for (const [codigo, nome] of seeds) {
              stmt.run(codigo, nome);
            }
            stmt.finalize((e) => (e ? rej(e) : res()));
          });

          db.run(
            `CREATE INDEX IF NOT EXISTS idx_tabelas_preco_canal
             ON tabelas_preco(canal_venda_id)`,
            (e3) => {
              if (e3) return reject(e3);
              console.log('[RA-6] migration 016_tabela_mono_canal_ra6 aplicada');
              resolve();
            }
          );
        } catch (e) {
          reject(e);
        }
      });
    });
  });
}

module.exports = migration016TabelaMonoCanalRa6;
