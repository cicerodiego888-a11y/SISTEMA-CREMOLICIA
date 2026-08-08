/**
 * CanaisVendaRepository — Persistência de canais de venda (RCM-04.1)
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

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

function normalizar(row) {
  if (!row) return null;
  return {
    ...row,
    ativo: row.ativo === 1 || row.ativo === '1' || row.ativo === true
  };
}

class CanaisVendaRepository {
  async listar({ apenasAtivos = false } = {}) {
    let sql = 'SELECT * FROM canais_venda WHERE 1=1';
    const params = [];
    if (apenasAtivos) {
      sql += ' AND ativo = 1';
    }
    sql += ' ORDER BY nome COLLATE NOCASE';
    const rows = await all(sql, params);
    return rows.map(normalizar);
  }

  async buscarPorId(id) {
    const row = await get('SELECT * FROM canais_venda WHERE id = ?', [id]);
    return normalizar(row);
  }

  async buscarPorCodigo(codigo) {
    const row = await get(
      'SELECT * FROM canais_venda WHERE UPPER(codigo) = UPPER(?)',
      [codigo]
    );
    return normalizar(row);
  }

  /**
   * Próximo ID sequencial contínuo (MAX(id)+1).
   * Evita saltos do AUTOINCREMENT do SQLite após exclusões/testes.
   */
  async _proximoId() {
    const row = await get('SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM canais_venda');
    return Number(row?.next_id) || 1;
  }

  async _sincronizarSequence(maxId) {
    const seq = Number(maxId) || 0;
    try {
      const existe = await get(
        `SELECT name FROM sqlite_sequence WHERE name = ?`,
        ['canais_venda']
      );
      if (existe) {
        await run(`UPDATE sqlite_sequence SET seq = ? WHERE name = ?`, [seq, 'canais_venda']);
      } else if (seq > 0) {
        await run(`INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)`, ['canais_venda', seq]);
      }
    } catch (_) {
      // sqlite_sequence pode não existir se a tabela ainda não usou AUTOINCREMENT
    }
  }

  async criar({ codigo, nome, ativo = true }) {
    const nextId = await this._proximoId();
    await run(
      `INSERT INTO canais_venda (id, codigo, nome, ativo, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [nextId, String(codigo).trim().toUpperCase(), String(nome).trim(), ativo ? 1 : 0]
    );
    await this._sincronizarSequence(nextId);
    return this.buscarPorId(nextId);
  }

  async atualizar(id, { codigo, nome, ativo }) {
    const existente = await this.buscarPorId(id);
    if (!existente) return null;

    const novoCodigo = codigo !== undefined
      ? String(codigo).trim().toUpperCase()
      : existente.codigo;
    const novoNome = nome !== undefined ? String(nome).trim() : existente.nome;
    const novoAtivo = ativo !== undefined
      ? (ativo ? 1 : 0)
      : (existente.ativo ? 1 : 0);

    await run(
      `UPDATE canais_venda
       SET codigo = ?, nome = ?, ativo = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [novoCodigo, novoNome, novoAtivo, id]
    );
    return this.buscarPorId(id);
  }

  async excluir(id) {
    const emUso = await get(
      'SELECT COUNT(*) AS total FROM tabela_preco_valores WHERE canal_venda_id = ?',
      [id]
    );
    if ((emUso?.total || 0) > 0) {
      const err = new Error('Não é possível excluir: canal vinculado a valores de tabela de preço');
      err.statusCode = 400;
      throw err;
    }

    const result = await run('DELETE FROM canais_venda WHERE id = ?', [id]);
    const maxRow = await get('SELECT COALESCE(MAX(id), 0) AS max_id FROM canais_venda');
    await this._sincronizarSequence(maxRow?.max_id || 0);
    return { changes: result.changes };
  }
}

module.exports = new CanaisVendaRepository();
