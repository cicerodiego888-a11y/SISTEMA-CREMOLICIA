/**
 * LinhasComerciaisRepository (RCM-05.5)
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

function normalizarLinha(row) {
  if (!row) return null;
  const grupo = row.grupo_nome || row.categoria_nome || null;
  return {
    id: row.id,
    codigo: row.codigo,
    descricao: row.descricao,
    nome: row.descricao,
    ativo: row.ativo === 1 || row.ativo === true || row.ativo === '1',
    categoria_origem_id: row.categoria_origem_id != null ? Number(row.categoria_origem_id) : null,
    grupo: grupo,
    grupo_comercial: grupo,
    categoria_nome: grupo,
    created_at: row.created_at,
    updated_at: row.updated_at,
    // RCM-8.7 — painel rico
    produtos_vinculados: row.produtos_vinculados != null ? Number(row.produtos_vinculados) : undefined,
    tabelas_com_preco: row.tabelas_com_preco != null ? Number(row.tabelas_com_preco) : undefined,
    ultima_alteracao: row.ultima_alteracao || row.updated_at || row.created_at || null,
    canais_com_preco: row.canais_com_preco || null
  };
}

function normalizarGrade(row) {
  if (!row) return null;
  return {
    id: row.valor_id || null,
    linha_id: row.linha_id || null,
    canal_venda_id: row.canal_venda_id,
    canal_codigo: row.canal_codigo,
    canal_nome: row.canal_nome,
    canal_ativo: row.canal_ativo === 1 || row.canal_ativo === true,
    preco: row.preco != null && row.preco !== '' ? Number(row.preco) : null,
    forma_comercializacao: row.forma_comercializacao
      ? String(row.forma_comercializacao).toUpperCase()
      : null,
    unidade_comercial: row.unidade_comercial
      ? String(row.unidade_comercial).toUpperCase()
      : null
  };
}

class LinhasComerciaisRepository {
  async listar({ apenasAtivos = false, busca = null } = {}) {
    // RCM-8.2 / RCM-8.7 — pesquisa + enriquecimento (produtos, tabelas, última alteração)
    let sql = `
      SELECT lc.*, c.nome AS grupo_nome,
        (SELECT COUNT(*) FROM produtos p WHERE p.linha_comercial_id = lc.id) AS produtos_vinculados,
        (SELECT COUNT(DISTINCT v.tabela_preco_id)
           FROM tabela_preco_valores v
          WHERE v.linha_comercial_id = lc.id AND COALESCE(v.ativo,1)=1) AS tabelas_com_preco,
        (SELECT GROUP_CONCAT(DISTINCT UPPER(cv.codigo))
           FROM tabela_preco_valores v
           INNER JOIN tabelas_preco t ON t.id = v.tabela_preco_id
           LEFT JOIN canais_venda cv ON cv.id = t.canal_venda_id
          WHERE v.linha_comercial_id = lc.id AND COALESCE(v.ativo,1)=1) AS canais_com_preco,
        COALESCE(
          (SELECT MAX(COALESCE(t.updated_at, t.created_at, v.created_at))
             FROM tabela_preco_valores v
             INNER JOIN tabelas_preco t ON t.id = v.tabela_preco_id
            WHERE v.linha_comercial_id = lc.id),
          lc.updated_at,
          lc.created_at
        ) AS ultima_alteracao
      FROM linhas_comerciais lc
      LEFT JOIN categorias c ON c.id = lc.categoria_origem_id
      WHERE 1=1`;
    const params = [];
    if (apenasAtivos) sql += ' AND lc.ativo = 1';
    if (busca && String(busca).trim()) {
      sql += ` AND (
        lc.codigo LIKE ? OR lc.descricao LIKE ?
        OR IFNULL(c.nome, '') LIKE ? OR IFNULL(c.codigo, '') LIKE ?
      )`;
      const like = `%${String(busca).trim()}%`;
      params.push(like, like, like, like);
    }
    sql += ' ORDER BY lc.descricao COLLATE NOCASE';
    return (await all(sql, params)).map(normalizarLinha);
  }

  async buscarPorId(id) {
    return normalizarLinha(
      await get(
        `SELECT lc.*, c.nome AS grupo_nome
         FROM linhas_comerciais lc
         LEFT JOIN categorias c ON c.id = lc.categoria_origem_id
         WHERE lc.id = ?`,
        [id]
      )
    );
  }

  async buscarPorCodigo(codigo) {
    return normalizarLinha(
      await get('SELECT * FROM linhas_comerciais WHERE UPPER(codigo) = UPPER(?)', [codigo])
    );
  }

  async contarProdutosVinculados(id) {
    const row = await get(
      'SELECT COUNT(*) AS total FROM produtos WHERE linha_comercial_id = ?',
      [id]
    );
    return Number(row?.total || 0);
  }

  async criar({ codigo, descricao, ativo = true }) {
    const result = await run(
      `INSERT INTO linhas_comerciais (codigo, descricao, ativo, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
      [String(codigo).trim().toUpperCase(), String(descricao).trim(), ativo ? 1 : 0]
    );
    return this.buscarPorId(result.lastID);
  }

  async atualizar(id, { codigo, descricao, ativo }) {
    const existente = await this.buscarPorId(id);
    if (!existente) return null;
    await run(
      `UPDATE linhas_comerciais
       SET codigo = ?, descricao = ?, ativo = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        codigo !== undefined ? String(codigo).trim().toUpperCase() : existente.codigo,
        descricao !== undefined ? String(descricao).trim() : existente.descricao,
        ativo !== undefined ? (ativo ? 1 : 0) : (existente.ativo ? 1 : 0),
        id
      ]
    );
    return this.buscarPorId(id);
  }

  async desativar(id) {
    await run(
      `UPDATE linhas_comerciais SET ativo = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [id]
    );
    return this.buscarPorId(id);
  }

  async excluir(id) {
    const total = await this.contarProdutosVinculados(id);
    if (total > 0) {
      const err = new Error('Esta Linha de Precificação está vinculada a um ou mais produtos.');
      err.statusCode = 400;
      err.code = 'LINHA_EM_USO';
      err.permite_desativar = true;
      throw err;
    }
    await run('DELETE FROM linha_comercial_valores WHERE linha_id = ?', [id]);
    return run('DELETE FROM linhas_comerciais WHERE id = ?', [id]);
  }

  async montarGradeValores(linhaId = null) {
    const rows = await all(
      `
      SELECT
        c.id AS canal_venda_id,
        c.codigo AS canal_codigo,
        c.nome AS canal_nome,
        c.ativo AS canal_ativo,
        v.id AS valor_id,
        v.linha_id,
        v.preco,
        v.forma_comercializacao,
        v.unidade_comercial
      FROM canais_venda c
      LEFT JOIN linha_comercial_valores v
        ON v.canal_venda_id = c.id AND v.linha_id = ?
      WHERE c.ativo = 1
      ORDER BY c.nome COLLATE NOCASE
      `,
      [linhaId || 0]
    );
    return rows.map(normalizarGrade);
  }

  async upsertValores(linhaId, valores = []) {
    for (const item of valores) {
      const canalId = Number(item.canal_venda_id);
      const preco = Number(item.preco);
      if (!Number.isFinite(canalId) || canalId <= 0) {
        throw Object.assign(new Error('canal_venda_id inválido'), { statusCode: 400 });
      }
      if (!Number.isFinite(preco) || preco < 0) {
        throw Object.assign(new Error('Não é permitido preço negativo'), { statusCode: 400 });
      }
      const forma = item.forma_comercializacao
        ? String(item.forma_comercializacao).trim().toUpperCase()
        : null;
      const unidade = item.unidade_comercial
        ? String(item.unidade_comercial).trim().toUpperCase()
        : null;

      await run(
        `
        INSERT INTO linha_comercial_valores (
          linha_id, canal_venda_id, preco, forma_comercializacao, unidade_comercial
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(linha_id, canal_venda_id)
        DO UPDATE SET
          preco = excluded.preco,
          forma_comercializacao = excluded.forma_comercializacao,
          unidade_comercial = excluded.unidade_comercial
        `,
        [linhaId, canalId, preco, forma, unidade]
      );
    }
  }

  async salvarCompleto({ id = null, codigo, descricao, ativo = true, valores = [] }) {
    await run('BEGIN');
    try {
      let linhaId = id;
      if (linhaId) {
        await this.atualizar(linhaId, { codigo, descricao, ativo });
        await run('DELETE FROM linha_comercial_valores WHERE linha_id = ?', [linhaId]);
      } else {
        const criada = await this.criar({ codigo, descricao, ativo });
        linhaId = criada.id;
      }
      await this.upsertValores(linhaId, valores || []);
      await run('COMMIT');
      try {
        const ComercialPrecoResolver = require('../preco/ComercialPrecoResolver');
        ComercialPrecoResolver.invalidateCacheLinha(linhaId);
      } catch (_) { /* noop */ }
      const linha = await this.buscarPorId(linhaId);
      const grade = await this.montarGradeValores(linhaId);
      return { ...linha, valores: grade };
    } catch (err) {
      await run('ROLLBACK');
      throw err;
    }
  }

  async ultimoRelatorioMigracao() {
    return get(
      `SELECT * FROM linhas_comerciais_migracao_log ORDER BY id DESC LIMIT 1`
    );
  }
}

module.exports = new LinhasComerciaisRepository();
