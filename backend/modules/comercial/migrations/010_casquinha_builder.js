/**
 * 010 — Montador de Casquinha V2 (RCM-05.8)
 *
 * - casquinha_sabores: codigo, cor, descricao
 * - categorias: casquinha_bolas_min/max + permitir_repetir
 * - Seeds de sabores adicionais
 *
 * @param {Object} db
 * @returns {Promise<void>}
 */
function migration010CasquinhaBuilder(db) {
  return new Promise((resolve, reject) => {
    function runSql(sql, params = []) {
      return new Promise((res, rej) => {
        db.run(sql, params, (err) => (err ? rej(err) : res()));
      });
    }

    function all(sql, params = []) {
      return new Promise((res, rej) => {
        db.all(sql, params, (err, rows) => (err ? rej(err) : res(rows || [])));
      });
    }

    async function colunaExiste(tabela, coluna) {
      const cols = await all(`PRAGMA table_info(${tabela})`);
      return new Set((cols || []).map((c) => c.name)).has(coluna);
    }

    async function garantirSabor(codigo, nome, cor, ordem) {
      const existente = await new Promise((res, rej) => {
        db.get(
          `SELECT id FROM casquinha_sabores WHERE UPPER(nome) = UPPER(?) OR UPPER(COALESCE(codigo,'')) = UPPER(?)`,
          [nome, codigo],
          (err, row) => (err ? rej(err) : res(row || null))
        );
      });
      if (existente) {
        await runSql(
          `UPDATE casquinha_sabores
           SET codigo = COALESCE(codigo, ?),
               cor = COALESCE(cor, ?),
               descricao = COALESCE(descricao, ?),
               ativo = 1
           WHERE id = ?`,
          [codigo, cor, nome, existente.id]
        );
        return;
      }
      await runSql(
        `INSERT INTO casquinha_sabores (codigo, nome, descricao, cor, ativo, ordem)
         VALUES (?, ?, ?, ?, 1, ?)`,
        [codigo, nome, nome, cor, ordem]
      );
    }

    async function run() {
      try {
        if (!(await colunaExiste('casquinha_sabores', 'codigo'))) {
          await runSql(`ALTER TABLE casquinha_sabores ADD COLUMN codigo TEXT`);
        }
        if (!(await colunaExiste('casquinha_sabores', 'cor'))) {
          await runSql(`ALTER TABLE casquinha_sabores ADD COLUMN cor TEXT`);
        }
        if (!(await colunaExiste('casquinha_sabores', 'descricao'))) {
          await runSql(`ALTER TABLE casquinha_sabores ADD COLUMN descricao TEXT`);
        }

        if (!(await colunaExiste('categorias', 'casquinha_bolas_min'))) {
          await runSql(
            `ALTER TABLE categorias ADD COLUMN casquinha_bolas_min INTEGER DEFAULT 1`
          );
        }
        if (!(await colunaExiste('categorias', 'casquinha_bolas_max'))) {
          await runSql(
            `ALTER TABLE categorias ADD COLUMN casquinha_bolas_max INTEGER DEFAULT 4`
          );
        }
        if (!(await colunaExiste('categorias', 'casquinha_permitir_repetir'))) {
          await runSql(
            `ALTER TABLE categorias ADD COLUMN casquinha_permitir_repetir INTEGER DEFAULT 1`
          );
        }

        await runSql(
          `UPDATE casquinha_sabores
           SET descricao = nome
           WHERE descricao IS NULL OR descricao = ''`
        );
        await runSql(
          `UPDATE casquinha_sabores
           SET codigo = UPPER(REPLACE(REPLACE(nome, ' ', '_'), '-', '_'))
           WHERE codigo IS NULL OR codigo = ''`
        );

        const seeds = [
          ['CHOCOLATE', 'Chocolate', '#5D4037', 1],
          ['MORANGO', 'Morango', '#E91E63', 2],
          ['BAUNILHA', 'Baunilha', '#FFF8E1', 3],
          ['FLOCOS', 'Flocos', '#FFFDE7', 4],
          ['NAPOLITANO', 'Napolitano', '#F8BBD0', 5],
          ['LIMAO', 'Limão', '#CDDC39', 6],
          ['ABACAXI', 'Abacaxi', '#FFEB3B', 7],
          ['UVA', 'Uva', '#7B1FA2', 8],
          ['COCO', 'Coco', '#ECEFF1', 9],
          ['CREME', 'Creme', '#FFE0B2', 10]
        ];
        for (const [codigo, nome, cor, ordem] of seeds) {
          await garantirSabor(codigo, nome, cor, ordem);
        }

        // Categorias com linha CASQUINHA / forma CASQUINHA → defaults
        await runSql(`
          UPDATE categorias
          SET casquinha_bolas_min = COALESCE(casquinha_bolas_min, 1),
              casquinha_bolas_max = COALESCE(casquinha_bolas_max, 4),
              casquinha_permitir_repetir = COALESCE(casquinha_permitir_repetir, 1)
          WHERE UPPER(COALESCE(nome, '')) LIKE '%CASQUIN%'
             OR linha_comercial_id IN (
               SELECT id FROM linhas_comerciais WHERE UPPER(codigo) = 'CASQUINHA'
             )
        `);

        console.log('[RCM-05.8] Casquinha Builder: schema + seeds OK');
        resolve();
      } catch (err) {
        reject(err);
      }
    }

    run();
  });
}

module.exports = migration010CasquinhaBuilder;
