/**
 * PrestacaoRateioPerdaRepository — RC4.2
 */

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    consignacaoId: row.consignacao_id,
    grupoPrestacaoContasId: row.grupo_prestacao_contas_id,
    tipoRateio: row.tipo_rateio,
    valorTotalPerdas: Number(row.valor_total_perdas || 0),
    valorCliente: Number(row.valor_cliente || 0),
    valorEmpresa: Number(row.valor_empresa || 0),
    percentualCliente: Number(row.percentual_cliente || 0),
    percentualEmpresa: Number(row.percentual_empresa || 0),
    motivoPerda: row.motivo_perda || null,
    observacaoPerda: row.observacao_perda || null,
    usuarioId: row.usuario_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

class PrestacaoRateioPerdaRepository {
  /**
   * @param {Object} db — sqlite3 Database
   */
  constructor(db) {
    this._db = db;
  }

  _run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this._db.run(sql, params, function onRun(err) {
        if (err) return reject(err);
        resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }

  _get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this._db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
    });
  }

  _all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this._db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
    });
  }

  async buscarPorGrupo(grupoPrestacaoContasId) {
    const row = await this._get(
      'SELECT * FROM prestacao_rateio_perdas WHERE grupo_prestacao_contas_id = ? LIMIT 1',
      [String(grupoPrestacaoContasId)]
    );
    return mapRow(row);
  }

  async buscarPorConsignacao(consignacaoId) {
    const row = await this._get(
      `SELECT * FROM prestacao_rateio_perdas
       WHERE consignacao_id = ?
       ORDER BY id DESC LIMIT 1`,
      [Number(consignacaoId)]
    );
    return mapRow(row);
  }

  async upsert(dados) {
    const existente = await this.buscarPorGrupo(dados.grupoPrestacaoContasId);
    const agora = new Date().toISOString();

    if (existente) {
      await this._run(
        `UPDATE prestacao_rateio_perdas SET
          tipo_rateio = ?,
          valor_total_perdas = ?,
          valor_cliente = ?,
          valor_empresa = ?,
          percentual_cliente = ?,
          percentual_empresa = ?,
          motivo_perda = ?,
          observacao_perda = ?,
          usuario_id = ?,
          updated_at = ?
         WHERE id = ?`,
        [
          dados.tipoRateio,
          dados.valorTotalPerdas,
          dados.valorCliente,
          dados.valorEmpresa,
          dados.percentualCliente,
          dados.percentualEmpresa,
          dados.motivoPerda || null,
          dados.observacaoPerda || null,
          dados.usuarioId ?? null,
          agora,
          existente.id
        ]
      );
      return this.buscarPorGrupo(dados.grupoPrestacaoContasId);
    }

    const ins = await this._run(
      `INSERT INTO prestacao_rateio_perdas (
        consignacao_id, grupo_prestacao_contas_id, tipo_rateio,
        valor_total_perdas, valor_cliente, valor_empresa,
        percentual_cliente, percentual_empresa,
        motivo_perda, observacao_perda, usuario_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Number(dados.consignacaoId),
        String(dados.grupoPrestacaoContasId),
        dados.tipoRateio,
        dados.valorTotalPerdas,
        dados.valorCliente,
        dados.valorEmpresa,
        dados.percentualCliente,
        dados.percentualEmpresa,
        dados.motivoPerda || null,
        dados.observacaoPerda || null,
        dados.usuarioId ?? null,
        agora,
        agora
      ]
    );
    const row = await this._get('SELECT * FROM prestacao_rateio_perdas WHERE id = ?', [ins.lastID]);
    return mapRow(row);
  }

  async registrarAuditoria(dados) {
    await this._run(
      `INSERT INTO prestacao_rateio_perdas_auditoria (
        rateio_id, consignacao_id, grupo_prestacao_contas_id, usuario_id,
        tipo_rateio, valor_total_perdas, valor_cliente, valor_empresa,
        percentual_cliente, percentual_empresa, motivo_perda, observacao_perda, acao, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        dados.rateioId ?? null,
        Number(dados.consignacaoId),
        String(dados.grupoPrestacaoContasId),
        dados.usuarioId ?? null,
        dados.tipoRateio,
        dados.valorTotalPerdas,
        dados.valorCliente,
        dados.valorEmpresa,
        dados.percentualCliente,
        dados.percentualEmpresa,
        dados.motivoPerda || null,
        dados.observacaoPerda || null,
        dados.acao || 'DEFINIR',
        new Date().toISOString()
      ]
    );
  }

  async listarAuditoria(consignacaoId, { limite = 50 } = {}) {
    const rows = await this._all(
      `SELECT * FROM prestacao_rateio_perdas_auditoria
       WHERE consignacao_id = ?
       ORDER BY id DESC LIMIT ?`,
      [Number(consignacaoId), Number(limite) || 50]
    );
    return rows.map((r) => ({
      id: r.id,
      rateioId: r.rateio_id,
      consignacaoId: r.consignacao_id,
      grupoPrestacaoContasId: r.grupo_prestacao_contas_id,
      usuarioId: r.usuario_id,
      tipoRateio: r.tipo_rateio,
      valorTotalPerdas: Number(r.valor_total_perdas || 0),
      valorCliente: Number(r.valor_cliente || 0),
      valorEmpresa: Number(r.valor_empresa || 0),
      percentualCliente: Number(r.percentual_cliente || 0),
      percentualEmpresa: Number(r.percentual_empresa || 0),
      motivoPerda: r.motivo_perda,
      observacaoPerda: r.observacao_perda,
      acao: r.acao,
      createdAt: r.created_at
    }));
  }

  /** Indicadores para relatórios futuros */
  async agregarIndicadores({ dataInicio = null, dataFim = null } = {}) {
    let sql = `
      SELECT
        COALESCE(SUM(valor_total_perdas), 0) AS total_perdido,
        COALESCE(SUM(valor_cliente), 0) AS perda_cliente,
        COALESCE(SUM(valor_empresa), 0) AS perda_empresa,
        motivo_perda,
        COUNT(*) AS qtd
      FROM prestacao_rateio_perdas
      WHERE 1=1
    `;
    const params = [];
    if (dataInicio) {
      sql += ' AND date(updated_at) >= date(?)';
      params.push(dataInicio);
    }
    if (dataFim) {
      sql += ' AND date(updated_at) <= date(?)';
      params.push(dataFim);
    }
    sql += ' GROUP BY motivo_perda';

    const porMotivo = await this._all(sql, params);
    const totais = await this._get(
      `SELECT
         COALESCE(SUM(valor_total_perdas), 0) AS total_perdido,
         COALESCE(SUM(valor_cliente), 0) AS perda_cliente,
         COALESCE(SUM(valor_empresa), 0) AS perda_empresa
       FROM prestacao_rateio_perdas`,
      []
    );

    return {
      totalPerdido: Number(totais?.total_perdido || 0),
      perdaAssumidaCliente: Number(totais?.perda_cliente || 0),
      perdaAssumidaEmpresa: Number(totais?.perda_empresa || 0),
      perdasPorMotivo: (porMotivo || []).map((r) => ({
        motivo: r.motivo_perda || '—',
        total: Number(r.total_perdido || 0),
        quantidade: Number(r.qtd || 0)
      }))
    };
  }
}

module.exports = PrestacaoRateioPerdaRepository;
