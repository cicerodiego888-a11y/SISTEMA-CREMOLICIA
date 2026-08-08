/**
 * TiposComerciaisRepository — Persistência (RCM-7.1 / RCM-7.2)
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
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function normalizar(row) {
  if (!row) return null;
  return {
    id: row.id,
    codigo: row.codigo,
    descricao: row.descricao,
    canal_padrao: String(row.canal_padrao || '').toUpperCase(),
    ativo: row.ativo === 1 || row.ativo === '1' || row.ativo === true,
    observacoes: row.observacoes || null,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

class TiposComerciaisRepository {
  async listar({ apenasAtivos = false } = {}) {
    let sql = 'SELECT * FROM tipos_comerciais WHERE 1=1';
    const params = [];
    if (apenasAtivos) {
      sql += ' AND ativo = 1';
    }
    sql += ' ORDER BY descricao COLLATE NOCASE';
    const rows = await all(sql, params);
    return rows.map(normalizar);
  }

  async buscarPorId(id) {
    const row = await get('SELECT * FROM tipos_comerciais WHERE id = ?', [id]);
    return normalizar(row);
  }

  async buscarPorCodigo(codigo) {
    const row = await get(
      `SELECT * FROM tipos_comerciais WHERE UPPER(codigo) = UPPER(?) LIMIT 1`,
      [codigo]
    );
    return normalizar(row);
  }

  async listarCanaisPermitidos(tipoId) {
    const rows = await all(
      `SELECT cv.id, cv.codigo, cv.nome, cv.ativo
       FROM tipo_comercial_canais tcc
       INNER JOIN canais_venda cv ON cv.id = tcc.canal_venda_id
       WHERE tcc.tipo_comercial_id = ?
       ORDER BY cv.nome COLLATE NOCASE`,
      [tipoId]
    );
    return (rows || []).map((r) => ({
      id: r.id,
      codigo: String(r.codigo || '').toUpperCase(),
      nome: r.nome || r.codigo,
      ativo: r.ativo === 1 || r.ativo === '1' || r.ativo === true
    }));
  }

  /**
   * Substitui a lista N:N de canais permitidos.
   * @param {number} tipoId
   * @param {number[]} canalIds
   */
  async substituirCanaisPermitidos(tipoId, canalIds = []) {
    await run(`DELETE FROM tipo_comercial_canais WHERE tipo_comercial_id = ?`, [tipoId]);
    const unicos = [...new Set((canalIds || []).map((id) => Number(id)).filter((id) => id > 0))];
    for (const canalId of unicos) {
      await run(
        `INSERT OR IGNORE INTO tipo_comercial_canais (tipo_comercial_id, canal_venda_id)
         VALUES (?, ?)`,
        [tipoId, canalId]
      );
    }
    return this.listarCanaisPermitidos(tipoId);
  }

  async criar({ codigo, descricao, canal_padrao, ativo = true, observacoes = null }) {
    const result = await run(
      `INSERT INTO tipos_comerciais
         (codigo, descricao, canal_padrao, ativo, observacoes, updated_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        String(codigo).trim().toUpperCase(),
        String(descricao).trim(),
        String(canal_padrao).trim().toUpperCase(),
        ativo ? 1 : 0,
        observacoes != null ? String(observacoes).trim() : null
      ]
    );
    return this.buscarPorId(result.lastID);
  }

  async atualizar(id, dados = {}) {
    const existente = await this.buscarPorId(id);
    if (!existente) return null;

    const codigo = dados.codigo !== undefined
      ? String(dados.codigo).trim().toUpperCase()
      : existente.codigo;
    const descricao = dados.descricao !== undefined
      ? String(dados.descricao).trim()
      : existente.descricao;
    const canalPadrao = dados.canal_padrao !== undefined
      ? String(dados.canal_padrao).trim().toUpperCase()
      : existente.canal_padrao;
    const ativo = dados.ativo !== undefined
      ? (dados.ativo ? 1 : 0)
      : (existente.ativo ? 1 : 0);
    const observacoes = dados.observacoes !== undefined
      ? (dados.observacoes != null ? String(dados.observacoes).trim() : null)
      : existente.observacoes;

    await run(
      `UPDATE tipos_comerciais
       SET codigo = ?, descricao = ?, canal_padrao = ?, ativo = ?,
           observacoes = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [codigo, descricao, canalPadrao, ativo, observacoes, id]
    );
    return this.buscarPorId(id);
  }

  async excluir(id) {
    const emUso = await get(
      'SELECT COUNT(*) AS total FROM clientes WHERE tipo_comercial_id = ?',
      [id]
    );
    if ((emUso?.total || 0) > 0) {
      const err = new Error('Não é possível excluir: tipo vinculado a clientes');
      err.statusCode = 400;
      throw err;
    }
    await run(`DELETE FROM tipo_comercial_canais WHERE tipo_comercial_id = ?`, [id]);
    const result = await run('DELETE FROM tipos_comerciais WHERE id = ?', [id]);
    return { changes: result.changes };
  }

  /**
   * Resolve Tipo Comercial + Canal + Tabela ativa a partir do cliente.
   */
  async resolverPorCliente(clienteId) {
    const row = await get(
      `SELECT
         c.id AS cliente_id,
         c.nome AS cliente_nome,
         c.tipo_comercial_id,
         tc.codigo AS tipo_codigo,
         tc.descricao AS tipo_descricao,
         tc.canal_padrao,
         tc.ativo AS tipo_ativo,
         cv.id AS canal_venda_id,
         cv.codigo AS canal_codigo,
         cv.nome AS canal_nome,
         cv.ativo AS canal_ativo
       FROM clientes c
       LEFT JOIN tipos_comerciais tc ON tc.id = c.tipo_comercial_id
       LEFT JOIN canais_venda cv ON UPPER(cv.codigo) = UPPER(tc.canal_padrao)
       WHERE c.id = ?`,
      [clienteId]
    );
    return row || null;
  }
}

module.exports = new TiposComerciaisRepository();
