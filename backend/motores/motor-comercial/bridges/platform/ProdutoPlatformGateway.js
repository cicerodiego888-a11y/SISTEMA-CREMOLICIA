/**
 * ProdutoPlatformGateway — Integração real com cadastro de produtos CDS.
 *
 * Sprint O-13 · RCM-6.1 — resolução de preço no Motor Comercial deve informar canal
 * quando o fluxo for de Consignação (canal: CONSIGNADO).
 *
 * @module motores/motor-comercial/bridges/platform/ProdutoPlatformGateway
 */

const { dbGet } = require('./dbHelpers');
const { assegurarBancoNoGateway } = require('./platformGatewayGuards');
const ComercialPrecoResolver = require('../../../../modules/comercial/preco/ComercialPrecoResolver');

class ProdutoPlatformGateway {
  /**
   * @param {Object} deps
   * @param {Object} deps.db
   */
  constructor(deps = {}) {
    this._db = deps.db;
  }

  /**
   * @param {string|number} produtoId
   * @param {Object} [opts]
   * @param {string} [opts.canal] — obrigatório no fluxo de Consignação (CONSIGNADO)
   * @returns {Promise<Object|null>}
   */
  async buscarPorId(produtoId, opts = {}) {
    assegurarBancoNoGateway(this, 'buscarPorId');
    if (produtoId == null) return null;

    const row = await dbGet(this._db, 'SELECT * FROM produtos WHERE id = ?', [produtoId]);
    if (!row) return null;

    const canal = opts.canal != null && String(opts.canal).trim() !== ''
      ? String(opts.canal).trim().toUpperCase()
      : null;

    const resolveOpts = { produto: row };
    if (canal) resolveOpts.canal = canal;

    const preco = await ComercialPrecoResolver.resolver(resolveOpts);

    const unidadeComercial = String(
      preco.unidade_comercial
      || preco.unidadeComercial
      || row.unidade
      || 'UN'
    ).trim().toUpperCase() || 'UN';

    return {
      id: row.id,
      nome: row.nome,
      descricao: row.descricao ?? row.nome,
      codigo: row.codigo ?? null,
      codigoBarras: row.codigo_barras ?? null,
      unidade: row.unidade ?? 'UN',
      unidadeComercial,
      precoVenda: preco.preco_venda,
      precoCusto: Number(row.preco_custo ?? 0),
      estoqueAtual: Number(row.estoque_atual ?? 0),
      saldoFiscal: Number(row.saldo_fiscal ?? 0),
      saldoNaoFiscal: Number(row.saldo_nao_fiscal ?? 0),
      itemFiscal: Number(row.item_fiscal ?? 0) === 1,
      ativo: Number(row.ativo ?? 1) === 1,
      tabelaPrecoId: preco.tabela_preco_id ?? row.tabela_preco_id ?? null,
      linhaComercialId: preco.linha_comercial_id ?? row.linha_comercial_id ?? null,
      canalVenda: preco.canal || canal || null,
      origem: 'platform:produtos',
      precoOrigem: preco.origem,
      precoFallback: !!preco.fallback
    };
  }

  /**
   * @param {string|number} produtoId
   * @returns {Promise<boolean>}
   */
  async estaAtivo(produtoId) {
    assegurarBancoNoGateway(this, 'estaAtivo');
    if (produtoId == null) return false;
    const row = await dbGet(
      this._db,
      `SELECT
         COALESCE(p.ativo, 1) AS ativo,
         p.categoria_id,
         COALESCE(c.ativo, 1) AS categoria_ativa
       FROM produtos p
       LEFT JOIN categorias c ON c.id = p.categoria_id
       WHERE p.id = ?`,
      [produtoId]
    );
    if (!row) return false;
    if (Number(row.ativo) !== 1) return false;
    if (row.categoria_id != null && Number(row.categoria_ativa) !== 1) return false;
    return true;
  }

  /**
   * @param {string|number} produtoId
   * @param {string} [tabelaPreco]
   * @param {Object} [opts]
   * @param {string} [opts.canal]
   * @returns {Promise<Object>}
   */
  async consultarPreco(produtoId, tabelaPreco, opts = {}) {
    const produto = await this.buscarPorId(produtoId, opts);
    if (!produto) throw new Error('Produto não encontrado');

    return {
      produtoId,
      tabelaPreco: tabelaPreco || 'PADRAO',
      precoVenda: produto.precoVenda,
      precoCusto: produto.precoCusto,
      unidadeComercial: produto.unidadeComercial,
      canalVenda: produto.canalVenda,
      linhaComercialId: produto.linhaComercialId,
      tabelaPrecoId: produto.tabelaPrecoId,
      origem: produto.precoOrigem || 'platform:produtos',
      precoFallback: produto.precoFallback
    };
  }

  /**
   * @param {string|number} produtoId
   * @returns {Promise<Object>}
   */
  async consultarEstoqueDisponivel(produtoId) {
    const produto = await this.buscarPorId(produtoId);
    if (!produto) throw new Error('Produto não encontrado');

    return {
      produtoId,
      quantidadeDisponivel: produto.estoqueAtual,
      saldoFiscal: produto.saldoFiscal,
      saldoNaoFiscal: produto.saldoNaoFiscal,
      origem: 'platform:produtos'
    };
  }
}

module.exports = ProdutoPlatformGateway;
