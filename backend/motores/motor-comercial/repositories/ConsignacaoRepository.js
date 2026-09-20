/**
 * ConsignacaoRepository — Persistência do Aggregate Consignacao.
 *
 * Implementa IConsignacaoRepository.
 *
 * Diretriz CDS — PATCH semântico:
 * ausência de campo em atualizar() nunca apaga valor; só persiste o enviado.
 *
 * @class ConsignacaoRepository
 * @extends BaseRepository
 */

const BaseRepository = require('../infrastructure/base/BaseRepository');
const { TABELAS } = require('../config/comercialConstants');
const {
  mapConsignacaoFromRow,
  mapDocumentoComercialToColumns,
  mapGrupoPrestacaoContasToColumns,
  expandConsignacaoEmbeddedForPatch
} = require('../utils/comercialMapper');

const MAPA_CAMPOS = {
  clienteId: 'cliente_id',
  perfilComercialId: 'perfil_comercial_id',
  status: 'status',
  valorTotalEntregue: 'valor_total_entregue',
  valorTotalAcertado: 'valor_total_acertado',
  valorTotalPago: 'valor_total_pago',
  saldoAberto: 'saldo_aberto',
  observacao: 'observacao',
  documentoExterno: 'documento_externo',
  usuarioAberturaId: 'usuario_abertura_id',
  usuarioEncerramentoId: 'usuario_encerramento_id',
  dataAbertura: 'data_abertura',
  dataEntrega: 'data_entrega',
  dataEncerramento: 'data_encerramento'
};

class ConsignacaoRepository extends BaseRepository {
  static TABELA = TABELAS.CONSIGNACOES;

  /**
   * Expansão completa para INSERT (defaults/nulls permitidos).
   * @param {Object} dados
   * @returns {Object}
   */
  _expandirCamposEmbedded(dados) {
    const docCols = mapDocumentoComercialToColumns(dados.documento);
    const prestacaoCols = mapGrupoPrestacaoContasToColumns(
      dados.prestacaoContasAtiva || dados.prestacaoContas
    );
    return { ...docCols, ...prestacaoCols };
  }

  /**
   * Instrumentação temporária — PATCH vs wipe por omissão.
   * @param {number|string} id
   * @param {Object} dados
   * @param {string[]} camposPersistidos
   * @param {{ ignorados: string[], prestacaoAlterada: boolean, documentoAlterado: boolean }} meta
   */
  _logAtualizacaoPatch(id, dados, camposPersistidos, meta) {
    const recebidos = Object.keys(dados || {});
    const ignoradosScalar = Object.keys(MAPA_CAMPOS).filter((k) => !(k in (dados || {})));
    const ignorados = [...ignoradosScalar, ...(meta.ignorados || [])];

    console.log('========================');
    console.log('CONSIGNACAO UPDATE');
    console.log('========================');
    console.log(`id=${id}`);
    console.log('Campos recebidos:', recebidos);
    console.log('Campos persistidos:', camposPersistidos);
    console.log('Campos ignorados:', ignorados);
    console.log('Prestação alterada?', meta.prestacaoAlterada === true);
    console.log('Documento alterado?', meta.documentoAlterado === true);
    console.log('========================');
  }

  async buscarPorId(id) {
    return this._executar(async () => {
      const sql = this._obterSql();
      await sql.whenReady();
      const row = await sql.get(
        `SELECT c.*,
          cl.nome AS cliente_nome,
          cl.cpf_cnpj AS cliente_documento,
          cl.telefone AS cliente_telefone,
          NULL AS cliente_fantasia
         FROM ${ConsignacaoRepository.TABELA} c
         LEFT JOIN clientes cl ON cl.id = c.cliente_id
         WHERE c.id = ?`,
        [id]
      );
      return mapConsignacaoFromRow(row);
    });
  }

  _aplicarFiltrosListagem(queryBase, filtros = {}) {
    let query = queryBase;
    const params = [];

    if (filtros.clienteId != null) {
      query += ' AND c.cliente_id = ?';
      params.push(filtros.clienteId);
    }
    if (filtros.perfilComercialId != null) {
      query += ' AND c.perfil_comercial_id = ?';
      params.push(filtros.perfilComercialId);
    }

    const statusIn = Array.isArray(filtros.statusIn)
      ? filtros.statusIn
      : (filtros.statusIn ? String(filtros.statusIn).split(',') : null);
    const statusLista = (statusIn || [])
      .map((s) => String(s || '').trim().toUpperCase())
      .filter(Boolean);

    if (statusLista.length) {
      query += ` AND c.status IN (${statusLista.map(() => '?').join(',')})`;
      params.push(...statusLista);
    } else if (filtros.status) {
      query += ' AND c.status = ?';
      params.push(filtros.status);
    }

    if (filtros.documentoNumero) {
      query += ' AND c.documento_numero = ?';
      params.push(filtros.documentoNumero);
    }
    // RCM-8.11 — ciclo de prestação (ponteiro embutido)
    if (filtros.prestacaoId != null && filtros.prestacaoId !== '') {
      query += ' AND c.prestacao_id = ?';
      params.push(String(filtros.prestacaoId));
    }
    if (filtros.prestacaoStatus) {
      query += ' AND UPPER(IFNULL(c.prestacao_status, \'\')) = ?';
      params.push(String(filtros.prestacaoStatus).toUpperCase());
    }
    if (filtros.busca || filtros.q) {
      const bruto = String(filtros.busca || filtros.q).trim();
      const termo = `%${bruto}%`;
      const termoDigitos = `%${bruto.replace(/\D/g, '')}%`;
      query += ` AND (
          CAST(c.id AS TEXT) LIKE ?
          OR IFNULL(c.documento_numero, '') LIKE ?
          OR IFNULL(c.observacao, '') LIKE ?
          OR IFNULL(cl.nome, '') LIKE ?
          OR IFNULL(cl.cpf_cnpj, '') LIKE ?
          OR IFNULL(cl.telefone, '') LIKE ?
          OR REPLACE(REPLACE(REPLACE(REPLACE(IFNULL(cl.cpf_cnpj, ''), '.', ''), '-', ''), '/', ''), ' ', '') LIKE ?
          OR REPLACE(REPLACE(REPLACE(REPLACE(IFNULL(cl.telefone, ''), '(', ''), ')', ''), '-', ''), ' ', '') LIKE ?
        )`;
      params.push(termo, termo, termo, termo, termo, termo, termoDigitos, termoDigitos);
    }

    return { query, params };
  }

  async listar(filtros = {}) {
    return this._executar(async () => {
      const sql = this._obterSql();
      await sql.whenReady();

      // RCM-04.B — JOIN clientes para nome/documento/telefone na listagem (SSOT)
      const montado = this._aplicarFiltrosListagem(
        `SELECT c.*,
          cl.nome AS cliente_nome,
          cl.cpf_cnpj AS cliente_documento,
          cl.telefone AS cliente_telefone,
          NULL AS cliente_fantasia,
          (SELECT COUNT(*) FROM consignacoes_itens ci WHERE ci.consignacao_id = c.id) AS quantidade_itens
        FROM ${ConsignacaoRepository.TABELA} c
        LEFT JOIN clientes cl ON cl.id = c.cliente_id
        WHERE 1=1`,
        filtros
      );

      let query = `${montado.query} ORDER BY c.id DESC`;
      const pag = this._paginacao(filtros);
      query += pag.sql;

      const rows = await sql.all(query, [...montado.params, ...pag.params]);
      return rows.map(mapConsignacaoFromRow);
    });
  }

  /**
   * RCM-8.5 — total da listagem sem carregar as linhas.
   */
  async contar(filtros = {}) {
    return this._executar(async () => {
      const sql = this._obterSql();
      await sql.whenReady();
      const montado = this._aplicarFiltrosListagem(
        `SELECT COUNT(*) AS total
         FROM ${ConsignacaoRepository.TABELA} c
         LEFT JOIN clientes cl ON cl.id = c.cliente_id
         WHERE 1=1`,
        filtros
      );
      const row = await sql.get(montado.query, montado.params);
      return Number(row?.total ?? 0);
    });
  }

  async inserir(dados) {
    return this._executar(async () => {
      const sql = this._obterSql();
      await sql.whenReady();
      const embedded = this._expandirCamposEmbedded(dados);

      const result = await sql.run(
        `INSERT INTO ${ConsignacaoRepository.TABELA} (
          cliente_id, perfil_comercial_id, status,
          documento_numero, documento_serie, documento_sequencial, documento_data_emissao, documento_situacao,
          prestacao_id, prestacao_numero, prestacao_status, prestacao_data_abertura, prestacao_data_fechamento,
          valor_total_entregue, valor_total_acertado, valor_total_pago, saldo_aberto,
          observacao, usuario_abertura_id, usuario_encerramento_id,
          data_abertura, data_entrega, data_encerramento, documento_externo
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          dados.clienteId,
          dados.perfilComercialId,
          dados.status ?? 'RASCUNHO',
          embedded.documento_numero,
          embedded.documento_serie,
          embedded.documento_sequencial,
          embedded.documento_data_emissao,
          embedded.documento_situacao ?? 'RASCUNHO',
          embedded.prestacao_id,
          embedded.prestacao_numero,
          embedded.prestacao_status,
          embedded.prestacao_data_abertura,
          embedded.prestacao_data_fechamento,
          dados.valorTotalEntregue ?? 0,
          dados.valorTotalAcertado ?? 0,
          dados.valorTotalPago ?? 0,
          dados.saldoAberto ?? 0,
          dados.observacao ?? null,
          dados.usuarioAberturaId ?? null,
          dados.usuarioEncerramentoId ?? null,
          dados.dataAbertura ?? null,
          dados.dataEntrega ?? null,
          dados.dataEncerramento ?? null,
          dados.documentoExterno ?? null
        ]
      );

      return this.buscarPorId(result.lastID);
    });
  }

  /**
   * Atualização parcial (PATCH semântico).
   * Somente colunas explicitamente informadas são persistidas.
   * Ausência de prestacaoContasAtiva/documento ≠ limpar colunas embutidas.
   *
   * @param {number|string} id
   * @param {Object} dados
   * @returns {Promise<Object|null>}
   */
  async atualizar(id, dados) {
    return this._executar(async () => {
      const sql = this._obterSql();
      await sql.whenReady();

      const payload = dados || {};
      const { sets, params } = this._montarCamposUpdate(payload, MAPA_CAMPOS);
      const { cols: embedded, meta } = expandConsignacaoEmbeddedForPatch(payload);

      Object.entries(embedded).forEach(([col, val]) => {
        sets.push(`${col} = ?`);
        params.push(val);
      });

      const camposPersistidos = [
        ...Object.keys(MAPA_CAMPOS).filter((k) => payload[k] !== undefined).map((k) => MAPA_CAMPOS[k]),
        ...Object.keys(embedded)
      ];

      this._logAtualizacaoPatch(id, payload, camposPersistidos, meta);

      if (!sets.length) {
        return this.buscarPorId(id);
      }

      sets.push('updated_at = CURRENT_TIMESTAMP');
      await sql.run(
        `UPDATE ${ConsignacaoRepository.TABELA} SET ${sets.join(', ')} WHERE id = ?`,
        [...params, id]
      );

      return this.buscarPorId(id);
    });
  }

  /**
   * RCM-8.8 — UPDATE condicional para cancelamento concorrente seguro.
   * @param {number|string} id
   * @param {string} statusEsperado
   * @param {Object} dados
   * @returns {Promise<Object|null>} null se o status não coincidir
   */
  async atualizarSeStatus(id, statusEsperado, dados) {
    return this._executar(async () => {
      const sql = this._obterSql();
      await sql.whenReady();

      const payload = dados || {};
      const { sets, params } = this._montarCamposUpdate(payload, MAPA_CAMPOS);
      const { cols: embedded, meta } = expandConsignacaoEmbeddedForPatch(payload);

      Object.entries(embedded).forEach(([col, val]) => {
        sets.push(`${col} = ?`);
        params.push(val);
      });

      this._logAtualizacaoPatch(id, payload, [
        ...Object.keys(MAPA_CAMPOS).filter((k) => payload[k] !== undefined).map((k) => MAPA_CAMPOS[k]),
        ...Object.keys(embedded)
      ], meta);

      if (!sets.length) {
        const atual = await this.buscarPorId(id);
        if (!atual || String(atual.status) !== String(statusEsperado)) return null;
        return atual;
      }

      sets.push('updated_at = CURRENT_TIMESTAMP');
      const result = await sql.run(
        `UPDATE ${ConsignacaoRepository.TABELA}
         SET ${sets.join(', ')}
         WHERE id = ? AND status = ?`,
        [...params, id, statusEsperado]
      );

      const changes = Number(result?.changes ?? result?.rowsAffected ?? 0);
      if (changes < 1) return null;
      return this.buscarPorId(id);
    });
  }

  /**
   * @param {string} serie
   * @returns {Promise<number>}
   */
  async obterMaxSequencialDocumento(serie) {
    return this._executar(async () => {
      const sql = this._obterSql();
      await sql.whenReady();
      const row = await sql.get(
        `SELECT MAX(documento_sequencial) AS maxSeq
         FROM ${ConsignacaoRepository.TABELA}
         WHERE documento_serie = ?`,
        [serie]
      );
      return Number(row?.maxSeq ?? 0);
    });
  }

  /**
   * @param {string} serie
   * @returns {Promise<number>}
   */
  async obterProximoSequencialDocumento(serie) {
    const atual = await this.obterMaxSequencialDocumento(serie);
    return atual + 1;
  }
}

module.exports = ConsignacaoRepository;
