/**
 * ConfiguracaoComercialRepository — Persistência singleton (RCM-04.5)
 */

const db = require('../../../database');

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

function normalizar(row) {
  if (!row) return null;
  return {
    id: row.id,
    atacado_habilitado: row.atacado_habilitado === 1 || row.atacado_habilitado === true,
    quantidade_minima: Number(row.quantidade_minima || 0),
    tipo_contagem: String(row.tipo_contagem || 'TOTAL_VENDA').toUpperCase(),
    permitir_produtos_diferentes: row.permitir_produtos_diferentes === 1 || row.permitir_produtos_diferentes === true,
    permitir_categorias_diferentes: row.permitir_categorias_diferentes === 1 || row.permitir_categorias_diferentes === true,
    canal_atacado_id: row.canal_atacado_id != null ? Number(row.canal_atacado_id) : null,
    canal_atacado_codigo: row.canal_atacado_codigo || null,
    canal_atacado_nome: row.canal_atacado_nome || null,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

class ConfiguracaoComercialRepository {
  async obter() {
    const row = await get(
      `
      SELECT
        cc.*,
        c.codigo AS canal_atacado_codigo,
        c.nome AS canal_atacado_nome
      FROM configuracao_comercial cc
      LEFT JOIN canais_venda c ON c.id = cc.canal_atacado_id
      ORDER BY cc.id ASC
      LIMIT 1
      `
    );
    return normalizar(row);
  }

  async salvar(dados) {
    const atual = await this.obter();
    if (!atual) {
      await run(
        `
        INSERT INTO configuracao_comercial (
          atacado_habilitado, quantidade_minima, tipo_contagem,
          permitir_produtos_diferentes, permitir_categorias_diferentes,
          canal_atacado_id, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `,
        [
          dados.atacado_habilitado ? 1 : 0,
          Number(dados.quantidade_minima) || 30,
          String(dados.tipo_contagem || 'TOTAL_VENDA').toUpperCase(),
          dados.permitir_produtos_diferentes ? 1 : 0,
          dados.permitir_categorias_diferentes ? 1 : 0,
          dados.canal_atacado_id || null
        ]
      );
      return this.obter();
    }

    await run(
      `
      UPDATE configuracao_comercial SET
        atacado_habilitado = ?,
        quantidade_minima = ?,
        tipo_contagem = ?,
        permitir_produtos_diferentes = ?,
        permitir_categorias_diferentes = ?,
        canal_atacado_id = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [
        dados.atacado_habilitado ? 1 : 0,
        Number(dados.quantidade_minima) || 30,
        String(dados.tipo_contagem || 'TOTAL_VENDA').toUpperCase(),
        dados.permitir_produtos_diferentes ? 1 : 0,
        dados.permitir_categorias_diferentes ? 1 : 0,
        dados.canal_atacado_id || null,
        atual.id
      ]
    );
    return this.obter();
  }
}

module.exports = new ConfiguracaoComercialRepository();
