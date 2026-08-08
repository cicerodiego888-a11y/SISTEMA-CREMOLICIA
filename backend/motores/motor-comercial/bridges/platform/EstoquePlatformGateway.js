/**
 * EstoquePlatformGateway — COM-01: MCC → quantidadeBase → MotorEstoque
 *
 * @module motores/motor-comercial/bridges/platform/EstoquePlatformGateway
 */

const { dbGet } = require('./dbHelpers');
const mcc = require('../../../motor-conversao-comercial');

class EstoquePlatformGateway {
  /**
   * @param {Object} deps
   * @param {Object} deps.db
   * @param {Object} [deps.comercialOperacional]
   */
  constructor(deps = {}) {
    this._db = deps.db;
    this._comercial = deps.comercialOperacional
      || mcc.comercialOperacional
      || new mcc.ComercialOperacionalService({ mcc: mcc.motor });
  }

  /**
   * Saída física da consignação (ENTREGA).
   * @param {Object} dados
   */
  async registrarSaida(dados) {
    const {
      produtoId,
      quantidade,
      unidadeOrigem,
      unidadeComercial,
      loteId,
      consignacaoId,
      correlationId,
      usuarioId
    } = dados;

    const qtd = Number(quantidade);
    if (!produtoId || qtd <= 0) {
      throw new Error('produtoId e quantidade são obrigatórios para saída de estoque');
    }

    const resultado = await this._comercial.baixarEstoqueEntrega(this._db, {
      produtoId,
      quantidade: qtd,
      unidadeOrigem: unidadeOrigem || unidadeComercial || null,
      loteId: loteId || null,
      consignacaoId,
      usuarioId
    });

    return {
      produtoId,
      quantidade: resultado.quantidadeBase,
      quantidadeComercial: qtd,
      quantidadeBase: resultado.quantidadeBase,
      tipo: 'SAIDA',
      motivo: 'CONSIGNACAO',
      consignacaoId,
      correlationId,
      loteId: resultado.loteId ?? null,
      mcc: resultado.mcc,
      origem: 'COM-01:MotorEstoque.sair'
    };
  }

  /**
   * Entrada física por devolução.
   * @param {Object} dados
   */
  async registrarEntrada(dados) {
    const {
      produtoId,
      quantidade,
      unidadeOrigem,
      unidadeComercial,
      loteId,
      consignacaoId,
      correlationId,
      usuarioId
    } = dados;

    const qtd = Number(quantidade);
    if (!produtoId || qtd <= 0) {
      throw new Error('produtoId e quantidade são obrigatórios para entrada de estoque');
    }

    const resultado = await this._comercial.entrarEstoqueDevolucao(this._db, {
      produtoId,
      quantidade: qtd,
      unidadeOrigem: unidadeOrigem || unidadeComercial || null,
      loteId: loteId || null,
      consignacaoId,
      usuarioId
    });

    return {
      produtoId,
      quantidade: resultado.quantidadeBase,
      quantidadeComercial: qtd,
      quantidadeBase: resultado.quantidadeBase,
      tipo: 'ENTRADA',
      motivo: 'DEVOLUCAO',
      consignacaoId,
      correlationId,
      mcc: resultado.mcc,
      origem: 'COM-01:MotorEstoque.entrar'
    };
  }

  /**
   * Perda: MCC + política JA_BAIXADO_ENTREGA (estoque já saiu na entrega).
   * @param {Object} dados
   */
  async registrarPerda(dados) {
    const qtd = Number(dados.quantidade);
    if (!dados.produtoId || qtd <= 0) {
      throw new Error('produtoId e quantidade são obrigatórios para perda');
    }
    return this._comercial.registrarPerda(this._db, {
      produtoId: dados.produtoId,
      quantidade: qtd,
      unidadeOrigem: dados.unidadeOrigem || dados.unidadeComercial || null,
      consignacaoId: dados.consignacaoId,
      usuarioId: dados.usuarioId,
      forcarAjusteFisico: Boolean(dados.forcarAjusteFisico)
    });
  }

  async registrarTransferencia(dados) {
    return {
      consignacaoOrigemId: dados.consignacaoOrigemId,
      consignacaoDestinoId: dados.consignacaoDestinoId,
      itens: dados.itens ?? [],
      tipo: 'TRANSFERENCIA',
      correlationId: dados.correlationId,
      origem: 'platform:consignacao-transferencia',
      observacao: 'Sem movimentação de estoque físico — transferência contábil entre consignações'
    };
  }

  async consultarSaldo(produtoId) {
    const row = await dbGet(this._db, `
      SELECT id, estoque_atual, saldo_fiscal, saldo_nao_fiscal
      FROM produtos WHERE id = ?
    `, [produtoId]);

    if (!row) throw new Error('Produto não encontrado');

    return {
      produtoId,
      quantidadeDisponivel: Number(row.estoque_atual ?? 0),
      saldoFiscal: Number(row.saldo_fiscal ?? 0),
      saldoNaoFiscal: Number(row.saldo_nao_fiscal ?? 0),
      origem: 'platform:produtos'
    };
  }
}

module.exports = EstoquePlatformGateway;
