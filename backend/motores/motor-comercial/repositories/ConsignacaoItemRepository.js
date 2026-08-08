/**
 * ConsignacaoItemRepository — Persistência de itens da Consignacao.
 *
 * Implementa IConsignacaoItemRepository.
 *
 * @class ConsignacaoItemRepository
 * @extends BaseRepository
 */

const BaseRepository = require('../infrastructure/base/BaseRepository');
const { TABELAS } = require('../config/comercialConstants');
const { mapConsignacaoItemFromRow } = require('../utils/comercialMapper');

const MAPA_CAMPOS = {
  consignacaoId: 'consignacao_id',
  produtoId: 'produto_id',
  quantidadeEntregue: 'quantidade_entregue',
  quantidadeDevolvida: 'quantidade_devolvida',
  quantidadeVendida: 'quantidade_vendida',
  quantidadePerdida: 'quantidade_perdida',
  quantidadeCortesia: 'quantidade_cortesia',
  precoUnitario: 'preco_unitario',
  subtotalEntregue: 'subtotal_entregue',
  subtotalAcertado: 'subtotal_acertado',
  observacao: 'observacao',
  // RCM-6.1 — snapshot de precificação (imutável após insert)
  linhaComercialId: 'linha_comercial_id',
  tabelaPrecoId: 'tabela_preco_id',
  canalVenda: 'canal_venda',
  unidadeComercial: 'unidade_comercial',
  precoOrigem: 'preco_origem',
  precoFallback: 'preco_fallback'
};

/** SELECT com enriquecimento de cadastro (STAB-06.6.1 — somente leitura). */
const SELECT_ITEM_ENRIQUECIDO = `
  SELECT
    ci.*,
    p.nome AS produto_nome,
    p.codigo AS produto_codigo,
    COALESCE(p.unidade, 'UN') AS produto_unidade
  FROM ${TABELAS.CONSIGNACOES_ITENS} ci
  LEFT JOIN produtos p ON p.id = ci.produto_id
`;

class ConsignacaoItemRepository extends BaseRepository {
  static TABELA = TABELAS.CONSIGNACOES_ITENS;

  async buscarPorId(id) {
    return this._executar(async () => {
      const sql = this._obterSql();
      await sql.whenReady();
      try {
        const row = await sql.get(
          `${SELECT_ITEM_ENRIQUECIDO} WHERE ci.id = ?`,
          [id]
        );
        return mapConsignacaoItemFromRow(row);
      } catch (_erroJoin) {
        // Ambientes sem tabela produtos (testes isolados) — mantém contrato sem nome
        const row = await sql.get(
          `SELECT * FROM ${ConsignacaoItemRepository.TABELA} WHERE id = ?`,
          [id]
        );
        return mapConsignacaoItemFromRow(row);
      }
    });
  }

  async listarPorConsignacao(consignacaoId, filtros = {}) {
    return this._executar(async () => {
      const sql = this._obterSql();
      await sql.whenReady();

      const params = [consignacaoId];
      let filtroProduto = '';
      if (filtros.produtoId != null) {
        filtroProduto = ' AND ci.produto_id = ?';
        params.push(filtros.produtoId);
      }

      const pag = this._paginacao(filtros);
      params.push(...pag.params);

      try {
        const query = `${SELECT_ITEM_ENRIQUECIDO} WHERE ci.consignacao_id = ?${filtroProduto} ORDER BY ci.id ASC${pag.sql}`;
        const rows = await sql.all(query, params);
        return rows.map(mapConsignacaoItemFromRow);
      } catch (_erroJoin) {
        const paramsFallback = [consignacaoId];
        let query = `SELECT * FROM ${ConsignacaoItemRepository.TABELA} WHERE consignacao_id = ?`;
        if (filtros.produtoId != null) {
          query += ' AND produto_id = ?';
          paramsFallback.push(filtros.produtoId);
        }
        query += ` ORDER BY id ASC${pag.sql}`;
        paramsFallback.push(...pag.params);
        const rows = await sql.all(query, paramsFallback);
        return rows.map(mapConsignacaoItemFromRow);
      }
    });
  }

  async inserir(dados) {
    return this._executar(async () => {
      const sql = this._obterSql();
      await sql.whenReady();

      const result = await sql.run(
        `INSERT INTO ${ConsignacaoItemRepository.TABELA} (
          consignacao_id, produto_id,
          quantidade_entregue, quantidade_devolvida, quantidade_vendida,
          quantidade_perdida, quantidade_cortesia,
          preco_unitario, subtotal_entregue, subtotal_acertado,
          linha_comercial_id, tabela_preco_id, canal_venda,
          unidade_comercial, preco_origem, preco_fallback
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          dados.consignacaoId,
          dados.produtoId,
          dados.quantidadeEntregue ?? 0,
          dados.quantidadeDevolvida ?? 0,
          dados.quantidadeVendida ?? 0,
          dados.quantidadePerdida ?? 0,
          dados.quantidadeCortesia ?? 0,
          dados.precoUnitario ?? 0,
          dados.subtotalEntregue ?? 0,
          dados.subtotalAcertado ?? 0,
          dados.linhaComercialId ?? null,
          dados.tabelaPrecoId ?? null,
          dados.canalVenda ?? null,
          dados.unidadeComercial ?? null,
          dados.precoOrigem ?? null,
          dados.precoFallback != null ? (dados.precoFallback ? 1 : 0) : 0
        ]
      );

      return this.buscarPorId(result.lastID);
    });
  }

  async atualizar(id, dados) {
    return this._executar(async () => {
      const sql = this._obterSql();
      await sql.whenReady();

      const { sets, params } = this._montarCamposUpdate(dados, MAPA_CAMPOS);
      if (!sets.length) {
        return this.buscarPorId(id);
      }

      sets.push('updated_at = CURRENT_TIMESTAMP');
      await sql.run(
        `UPDATE ${ConsignacaoItemRepository.TABELA} SET ${sets.join(', ')} WHERE id = ?`,
        [...params, id]
      );

      return this.buscarPorId(id);
    });
  }

  async remover(id) {
    return this._executar(async () => {
      const sql = this._obterSql();
      await sql.whenReady();
      const result = await sql.run(
        `DELETE FROM ${ConsignacaoItemRepository.TABELA} WHERE id = ?`,
        [id]
      );
      return result.changes > 0;
    });
  }
}

module.exports = ConsignacaoItemRepository;
