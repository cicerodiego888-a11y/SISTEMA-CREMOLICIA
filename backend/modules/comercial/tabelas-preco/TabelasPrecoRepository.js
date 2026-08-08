/**
 * TabelasPrecoRepository — Persistência de tabelas de preço (RCM-04.2 / RCM-05.15)
 * Arquitetura: Tabela ↔ Linhas Comerciais → Canal × Forma × Unidade × Preço
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

function normalizarTabela(row) {
  if (!row) return null;
  return {
    ...row,
    ativo: row.ativo === 1 || row.ativo === '1' || row.ativo === true,
    canal_venda_id: row.canal_venda_id != null ? Number(row.canal_venda_id) : null,
    atacado_habilitado: !!(row.atacado_habilitado === 1 || row.atacado_habilitado === true),
    quantidade_minima: Number(row.quantidade_minima || 0),
    tipo_contagem: String(row.tipo_contagem || 'TOTAL_VENDA').toUpperCase(),
    permitir_produtos_diferentes: row.permitir_produtos_diferentes == null
      ? true
      : !!(row.permitir_produtos_diferentes === 1 || row.permitir_produtos_diferentes === true),
    permitir_categorias_diferentes: row.permitir_categorias_diferentes == null
      ? true
      : !!(row.permitir_categorias_diferentes === 1 || row.permitir_categorias_diferentes === true)
  };
}

function normalizarLinhaGrade(row) {
  if (!row) return null;
  return {
    id: row.valor_id || null,
    tabela_preco_id: row.tabela_preco_id || null,
    linha_comercial_id: row.linha_comercial_id != null ? Number(row.linha_comercial_id) : null,
    linha_codigo: row.linha_codigo || null,
    linha_descricao: row.linha_descricao || null,
    canal_venda_id: row.canal_venda_id,
    canal_codigo: row.canal_codigo,
    canal_nome: row.canal_nome,
    canal_ativo: row.canal_ativo === 1 || row.canal_ativo === '1' || row.canal_ativo === true,
    preco: row.preco != null && row.preco !== '' ? Number(row.preco) : null,
    forma_comercializacao: row.forma_comercializacao
      ? String(row.forma_comercializacao).toUpperCase()
      : null,
    unidade_comercial: row.unidade_comercial
      ? String(row.unidade_comercial).toUpperCase()
      : null,
    ativo: row.ativo == null ? true : (row.ativo === 1 || row.ativo === true || row.ativo === '1'),
    created_at: row.created_at || null
  };
}

class TabelasPrecoRepository {
  async listar({ apenasAtivos = false, busca = null, canal_venda_id = null } = {}) {
    let sql = `
      SELECT t.*,
             c.codigo AS canal_codigo,
             c.nome AS canal_nome
      FROM tabelas_preco t
      LEFT JOIN canais_venda c ON c.id = t.canal_venda_id
      WHERE 1=1`;
    const params = [];
    if (apenasAtivos) sql += ' AND t.ativo = 1';
    if (canal_venda_id != null && Number(canal_venda_id) > 0) {
      sql += ' AND t.canal_venda_id = ?';
      params.push(Number(canal_venda_id));
    }
    if (busca && String(busca).trim()) {
      sql += ' AND (t.codigo LIKE ? OR t.nome LIKE ? OR IFNULL(t.descricao, \'\') LIKE ?)';
      const like = `%${String(busca).trim()}%`;
      params.push(like, like, like);
    }
    sql += ' ORDER BY t.id ASC';
    const rows = await all(sql, params);
    const tabelas = rows.map(normalizarTabela);
    for (const t of tabelas) {
      t.linhas = await this.listarLinhasDaTabela(t.id);
    }
    return tabelas;
  }

  async buscarPorId(id) {
    const row = await get(
      `
      SELECT t.*,
             c.codigo AS canal_codigo,
             c.nome AS canal_nome
      FROM tabelas_preco t
      LEFT JOIN canais_venda c ON c.id = t.canal_venda_id
      WHERE t.id = ?
      `,
      [id]
    );
    return normalizarTabela(row);
  }

  /**
   * RA-6: tabela ativa do canal (uma tabela = um canal).
   */
  async buscarAtivaPorCanal(canalCodigoOuId) {
    const raw = canalCodigoOuId;
    if (raw == null || raw === '') return null;
    const asNum = Number(raw);
    if (Number.isFinite(asNum) && asNum > 0 && String(raw).trim() === String(asNum)) {
      return normalizarTabela(
        await get(
          `SELECT t.*, c.codigo AS canal_codigo, c.nome AS canal_nome
           FROM tabelas_preco t
           LEFT JOIN canais_venda c ON c.id = t.canal_venda_id
           WHERE t.canal_venda_id = ? AND COALESCE(t.ativo,1) = 1
           ORDER BY t.id ASC LIMIT 1`,
          [asNum]
        )
      );
    }
    const codigo = String(raw).trim().toUpperCase();
    return normalizarTabela(
      await get(
        `SELECT t.*, c.codigo AS canal_codigo, c.nome AS canal_nome
         FROM tabelas_preco t
         INNER JOIN canais_venda c ON c.id = t.canal_venda_id
         WHERE UPPER(c.codigo) = ? AND COALESCE(t.ativo,1) = 1
         ORDER BY t.id ASC LIMIT 1`,
        [codigo]
      )
    );
  }

  async buscarPorCodigo(codigo) {
    const row = await get(
      'SELECT * FROM tabelas_preco WHERE UPPER(codigo) = UPPER(?)',
      [codigo]
    );
    return normalizarTabela(row);
  }

  async buscarPorNome(nome, excludeId = null) {
    let sql = 'SELECT * FROM tabelas_preco WHERE LOWER(TRIM(nome)) = LOWER(TRIM(?))';
    const params = [nome];
    if (excludeId) {
      sql += ' AND id != ?';
      params.push(excludeId);
    }
    const row = await get(sql, params);
    return normalizarTabela(row);
  }

  async listarLinhasDaTabela(tabelaPrecoId) {
    const rows = await all(
      `
      SELECT l.id, l.codigo, l.descricao, l.ativo
      FROM tabela_preco_linhas tpl
      INNER JOIN linhas_comerciais l ON l.id = tpl.linha_comercial_id
      WHERE tpl.tabela_preco_id = ?
      ORDER BY l.descricao COLLATE NOCASE
      `,
      [tabelaPrecoId]
    );
    return (rows || []).map((r) => ({
      id: Number(r.id),
      codigo: r.codigo,
      descricao: r.descricao,
      ativo: r.ativo === 1 || r.ativo === true
    }));
  }

  async contarProdutosVinculados(id) {
    const row = await get(
      'SELECT COUNT(*) AS total FROM produtos WHERE tabela_preco_id = ?',
      [id]
    );
    return Number(row?.total || 0);
  }

  async criar({
    codigo,
    nome,
    descricao = '',
    ativo = true,
    canal_venda_id = null,
    atacado_habilitado = false,
    quantidade_minima = 0,
    tipo_contagem = 'TOTAL_VENDA',
    permitir_produtos_diferentes = true,
    permitir_categorias_diferentes = true
  }) {
    const result = await run(
      `INSERT INTO tabelas_preco (
         codigo, nome, descricao, ativo, canal_venda_id,
         atacado_habilitado, quantidade_minima, tipo_contagem,
         permitir_produtos_diferentes, permitir_categorias_diferentes,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        String(codigo).trim().toUpperCase(),
        String(nome).trim(),
        descricao != null ? String(descricao) : '',
        ativo ? 1 : 0,
        canal_venda_id != null ? Number(canal_venda_id) : null,
        atacado_habilitado ? 1 : 0,
        Number(quantidade_minima || 0),
        String(tipo_contagem || 'TOTAL_VENDA').toUpperCase(),
        permitir_produtos_diferentes ? 1 : 0,
        permitir_categorias_diferentes ? 1 : 0
      ]
    );
    return this.buscarPorId(result.lastID);
  }

  async atualizar(id, dados = {}) {
    const existente = await this.buscarPorId(id);
    if (!existente) return null;

    const novoCodigo = dados.codigo !== undefined
      ? String(dados.codigo).trim().toUpperCase()
      : existente.codigo;
    const novoNome = dados.nome !== undefined ? String(dados.nome).trim() : existente.nome;
    const novaDescricao = dados.descricao !== undefined
      ? String(dados.descricao || '')
      : (existente.descricao || '');
    const novoAtivo = dados.ativo !== undefined
      ? (dados.ativo ? 1 : 0)
      : (existente.ativo ? 1 : 0);
    const novoCanal = dados.canal_venda_id !== undefined
      ? (dados.canal_venda_id != null ? Number(dados.canal_venda_id) : null)
      : existente.canal_venda_id;
    const atacadoHab = dados.atacado_habilitado !== undefined
      ? (dados.atacado_habilitado ? 1 : 0)
      : (existente.atacado_habilitado ? 1 : 0);
    const qMin = dados.quantidade_minima !== undefined
      ? Number(dados.quantidade_minima || 0)
      : Number(existente.quantidade_minima || 0);
    const tipo = dados.tipo_contagem !== undefined
      ? String(dados.tipo_contagem || 'TOTAL_VENDA').toUpperCase()
      : String(existente.tipo_contagem || 'TOTAL_VENDA').toUpperCase();
    const permProd = dados.permitir_produtos_diferentes !== undefined
      ? (dados.permitir_produtos_diferentes ? 1 : 0)
      : (existente.permitir_produtos_diferentes ? 1 : 0);
    const permCat = dados.permitir_categorias_diferentes !== undefined
      ? (dados.permitir_categorias_diferentes ? 1 : 0)
      : (existente.permitir_categorias_diferentes ? 1 : 0);

    await run(
      `UPDATE tabelas_preco
       SET codigo = ?, nome = ?, descricao = ?, ativo = ?, canal_venda_id = ?,
           atacado_habilitado = ?, quantidade_minima = ?, tipo_contagem = ?,
           permitir_produtos_diferentes = ?, permitir_categorias_diferentes = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        novoCodigo, novoNome, novaDescricao, novoAtivo, novoCanal,
        atacadoHab, qMin, tipo, permProd, permCat, id
      ]
    );
    return this.buscarPorId(id);
  }

  async desativar(id) {
    await run(
      `UPDATE tabelas_preco SET ativo = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [id]
    );
    return this.buscarPorId(id);
  }

  async excluir(id) {
    const total = await this.contarProdutosVinculados(id);
    if (total > 0) {
      const err = new Error(
        'Esta Tabela de Preço está sendo utilizada por um ou mais produtos.'
      );
      err.statusCode = 400;
      err.code = 'TABELA_EM_USO';
      err.permite_desativar = true;
      throw err;
    }

    await run('DELETE FROM tabela_preco_valores WHERE tabela_preco_id = ?', [id]);
    await run('DELETE FROM tabela_preco_linhas WHERE tabela_preco_id = ?', [id]);
    const result = await run('DELETE FROM tabelas_preco WHERE id = ?', [id]);
    return { changes: result.changes };
  }

  /**
   * RA-6: grade Linha × canal único da tabela (sem CROSS JOIN de todos os canais).
   */
  async montarGradePorLinhas(linhaIds = [], tabelaPrecoId = null, canalVendaId = null) {
    const ids = [...new Set((linhaIds || []).map(Number).filter((n) => n > 0))];
    if (!ids.length) return [];

    let canalId = canalVendaId != null ? Number(canalVendaId) : null;
    if ((!canalId || canalId <= 0) && tabelaPrecoId) {
      const t = await this.buscarPorId(tabelaPrecoId);
      canalId = t?.canal_venda_id ? Number(t.canal_venda_id) : null;
    }

    const placeholders = ids.map(() => '?').join(',');

    if (canalId && canalId > 0) {
      const rows = await all(
        `
        SELECT
          l.id AS linha_comercial_id,
          l.codigo AS linha_codigo,
          l.descricao AS linha_descricao,
          c.id AS canal_venda_id,
          c.codigo AS canal_codigo,
          c.nome AS canal_nome,
          c.ativo AS canal_ativo,
          COALESCE(tpv.preco, lcv.preco) AS preco,
          COALESCE(tpv.forma_comercializacao, lcv.forma_comercializacao) AS forma_comercializacao,
          COALESCE(tpv.unidade_comercial, lcv.unidade_comercial) AS unidade_comercial,
          COALESCE(tpv.ativo, 1) AS ativo,
          tpv.id AS valor_id,
          tpv.tabela_preco_id
        FROM linhas_comerciais l
        INNER JOIN canais_venda c ON c.id = ?
        LEFT JOIN linha_comercial_valores lcv
          ON lcv.linha_id = l.id AND lcv.canal_venda_id = c.id
        LEFT JOIN tabela_preco_valores tpv
          ON tpv.tabela_preco_id = ?
          AND tpv.linha_comercial_id = l.id
          AND tpv.canal_venda_id = c.id
        WHERE l.id IN (${placeholders})
          AND COALESCE(l.ativo, 1) = 1
        ORDER BY l.descricao COLLATE NOCASE
        `,
        [canalId, tabelaPrecoId || 0, ...ids]
      );
      return rows.map(normalizarLinhaGrade);
    }

    // Compat legado: sem canal na tabela → comportamento multi-canal antigo
    const rows = await all(
      `
      SELECT
        l.id AS linha_comercial_id,
        l.codigo AS linha_codigo,
        l.descricao AS linha_descricao,
        c.id AS canal_venda_id,
        c.codigo AS canal_codigo,
        c.nome AS canal_nome,
        c.ativo AS canal_ativo,
        COALESCE(tpv.preco, lcv.preco) AS preco,
        COALESCE(tpv.forma_comercializacao, lcv.forma_comercializacao) AS forma_comercializacao,
        COALESCE(tpv.unidade_comercial, lcv.unidade_comercial) AS unidade_comercial,
        tpv.id AS valor_id,
        tpv.tabela_preco_id
      FROM linhas_comerciais l
      CROSS JOIN canais_venda c
      LEFT JOIN linha_comercial_valores lcv
        ON lcv.linha_id = l.id AND lcv.canal_venda_id = c.id
      LEFT JOIN tabela_preco_valores tpv
        ON tpv.tabela_preco_id = ?
        AND tpv.linha_comercial_id = l.id
        AND tpv.canal_venda_id = c.id
      WHERE l.id IN (${placeholders})
        AND c.ativo = 1
        AND COALESCE(l.ativo, 1) = 1
      ORDER BY l.descricao COLLATE NOCASE, c.nome COLLATE NOCASE
      `,
      [tabelaPrecoId || 0, ...ids]
    );
    return rows.map(normalizarLinhaGrade);
  }

  /**
   * Grade da tabela: se houver linhas vinculadas, Linha×Canal;
   * senão fallback legado (somente canais).
   */
  async montarGradeValores(tabelaPrecoId = null) {
    if (tabelaPrecoId) {
      const tabela = await this.buscarPorId(tabelaPrecoId);
      const linhas = await this.listarLinhasDaTabela(tabelaPrecoId);
      if (linhas.length) {
        return this.montarGradePorLinhas(
          linhas.map((l) => l.id),
          tabelaPrecoId,
          tabela?.canal_venda_id || null
        );
      }

      const legado = await all(
        `
        SELECT
          c.id AS canal_venda_id,
          c.codigo AS canal_codigo,
          c.nome AS canal_nome,
          c.ativo AS canal_ativo,
          v.id AS valor_id,
          v.tabela_preco_id,
          v.linha_comercial_id,
          v.preco,
          v.forma_comercializacao,
          v.unidade_comercial,
          v.created_at,
          l.codigo AS linha_codigo,
          l.descricao AS linha_descricao
        FROM canais_venda c
        LEFT JOIN tabela_preco_valores v
          ON v.canal_venda_id = c.id AND v.tabela_preco_id = ?
        LEFT JOIN linhas_comerciais l ON l.id = v.linha_comercial_id
        WHERE c.ativo = 1
        ORDER BY c.nome COLLATE NOCASE
        `,
        [tabelaPrecoId]
      );
      return legado.map(normalizarLinhaGrade);
    }

    // Nova tabela sem linhas: grade vazia (UI pede seleção)
    return [];
  }

  async listarValores(tabelaPrecoId) {
    return this.montarGradeValores(tabelaPrecoId);
  }

  async substituirLinhas(tabelaPrecoId, linhaIds = []) {
    const ids = [...new Set((linhaIds || []).map(Number).filter((n) => n > 0))];
    await run('DELETE FROM tabela_preco_linhas WHERE tabela_preco_id = ?', [tabelaPrecoId]);
    for (const linhaId of ids) {
      const linha = await get(
        'SELECT id FROM linhas_comerciais WHERE id = ?',
        [linhaId]
      );
      if (!linha) {
        throw Object.assign(new Error(`Linha comercial ${linhaId} não encontrada`), {
          statusCode: 400
        });
      }
      await run(
        `INSERT INTO tabela_preco_linhas (tabela_preco_id, linha_comercial_id)
         VALUES (?, ?)`,
        [tabelaPrecoId, linhaId]
      );
    }
    return ids;
  }

  async substituirValores(tabelaPrecoId, valores = []) {
    await run('DELETE FROM tabela_preco_valores WHERE tabela_preco_id = ?', [tabelaPrecoId]);

    for (const item of valores) {
      const canalId = Number(item.canal_venda_id);
      const preco = Number(item.preco);
      const linhaId = item.linha_comercial_id != null && item.linha_comercial_id !== ''
        ? Number(item.linha_comercial_id)
        : null;

      if (!Number.isFinite(canalId) || canalId <= 0) {
        throw Object.assign(new Error('canal_venda_id inválido'), { statusCode: 400 });
      }
      if (!Number.isFinite(preco) || preco < 0) {
        throw Object.assign(new Error('Não é permitido preço negativo'), { statusCode: 400 });
      }

      const canal = await get('SELECT id FROM canais_venda WHERE id = ?', [canalId]);
      if (!canal) {
        throw Object.assign(new Error(`Canal de venda ${canalId} não encontrado`), {
          statusCode: 400
        });
      }

      if (linhaId) {
        const linha = await get('SELECT id FROM linhas_comerciais WHERE id = ?', [linhaId]);
        if (!linha) {
          throw Object.assign(new Error(`Linha comercial ${linhaId} não encontrada`), {
            statusCode: 400
          });
        }
      }

      const forma = item.forma_comercializacao
        ? String(item.forma_comercializacao).trim().toUpperCase()
        : null;
      const unidade = item.unidade_comercial
        ? String(item.unidade_comercial).trim().toUpperCase()
        : null;

      await run(
        `
        INSERT INTO tabela_preco_valores (
          tabela_preco_id, linha_comercial_id, canal_venda_id, preco,
          forma_comercializacao, unidade_comercial, ativo
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        [
          tabelaPrecoId,
          linhaId || null,
          canalId,
          preco,
          forma || null,
          unidade || null,
          item.ativo === false || item.ativo === 0 ? 0 : 1
        ]
      );

      // RA-2: escrita oficial é tabela_preco_valores.
      // Não grava mais em linha_comercial_valores (compat somente leitura).
      if (linhaId) {
        try {
          const ComercialPrecoResolver = require('../preco/ComercialPrecoResolver');
          ComercialPrecoResolver.invalidateCache(tabelaPrecoId);
          ComercialPrecoResolver.invalidateCacheLinha(linhaId);
        } catch (_) { /* ignore */ }
      }
    }
  }

  async salvarCompleto({
    id = null,
    codigo,
    nome,
    descricao = '',
    ativo = true,
    canal_venda_id = null,
    atacado_habilitado = false,
    quantidade_minima = 0,
    tipo_contagem = 'TOTAL_VENDA',
    permitir_produtos_diferentes = true,
    permitir_categorias_diferentes = true,
    valores = [],
    linhas_ids = null
  }) {
    await run('BEGIN TRANSACTION');
    try {
      let tabelaId = id ? Number(id) : null;

      if (tabelaId) {
        const existente = await this.buscarPorId(tabelaId);
        if (!existente) {
          throw Object.assign(new Error('Tabela de preço não encontrada'), { statusCode: 404 });
        }
        await this.atualizar(tabelaId, {
          codigo,
          nome,
          descricao,
          ativo,
          canal_venda_id: canal_venda_id !== undefined ? canal_venda_id : existente.canal_venda_id,
          atacado_habilitado,
          quantidade_minima,
          tipo_contagem,
          permitir_produtos_diferentes,
          permitir_categorias_diferentes
        });
      } else {
        const criada = await this.criar({
          codigo,
          nome,
          descricao,
          ativo,
          canal_venda_id,
          atacado_habilitado,
          quantidade_minima,
          tipo_contagem,
          permitir_produtos_diferentes,
          permitir_categorias_diferentes
        });
        tabelaId = criada.id;
      }

      if (Array.isArray(linhas_ids)) {
        await this.substituirLinhas(tabelaId, linhas_ids);
      } else if (Array.isArray(valores) && valores.some((v) => v.linha_comercial_id)) {
        const fromValores = valores
          .map((v) => Number(v.linha_comercial_id))
          .filter((n) => n > 0);
        await this.substituirLinhas(tabelaId, fromValores);
      }

      if (Array.isArray(valores)) {
        await this.substituirValores(tabelaId, valores);
      }

      await run('COMMIT');

      try {
        const ComercialPrecoResolver = require('../preco/ComercialPrecoResolver');
        ComercialPrecoResolver.invalidateCache(tabelaId);
      } catch (_) { /* ignore */ }

      const tabela = await this.buscarPorId(tabelaId);
      const linhas = await this.listarLinhasDaTabela(tabelaId);
      const grade = await this.montarGradeValores(tabelaId);
      return { ...tabela, linhas, valores: grade };
    } catch (error) {
      await run('ROLLBACK').catch(() => {});
      throw error;
    }
  }

  async salvarValores(tabelaPrecoId, valores = []) {
    await run('BEGIN TRANSACTION');
    try {
      await this.substituirValores(tabelaPrecoId, valores);
      await run('COMMIT');
    } catch (error) {
      await run('ROLLBACK').catch(() => {});
      throw error;
    }
    try {
      const ComercialPrecoResolver = require('../preco/ComercialPrecoResolver');
      ComercialPrecoResolver.invalidateCache(tabelaPrecoId);
    } catch (_) { /* ignore */ }
    return this.montarGradeValores(tabelaPrecoId);
  }
}

module.exports = new TabelasPrecoRepository();
