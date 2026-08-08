/**
 * ProdutoBridge — Integração real com plataforma CDS (Sprint O-13).
 *
 * @module motores/motor-comercial/bridges/ProdutoBridge
 */

const Result = require('../infrastructure/result/Result');

class ProdutoBridge {
  constructor(dependencies) {
    this._logger = dependencies.logger;
    this._platform = dependencies.platform ?? null;
  }

  async validarProduto(produtoId, context) {
    const startTime = Date.now();
    try {
      if (!this._platform) throw new Error('ProdutoPlatformGateway não configurado');
      const ativo = await this._platform.estaAtivo(produtoId);
      if (!ativo) throw new Error('Produto não encontrado ou inativo');
      return Result.ok({ id: produtoId, ativo });
    } catch (error) {
      this._logger.error('ProdutoBridge.validarProduto - Erro', { produtoId, correlationId: context?.correlationId, error: error.message, duration: Date.now() - startTime });
      return Result.fail(error);
    }
  }

  async consultarProduto(produtoId, context, opts = {}) {
    const startTime = Date.now();
    try {
      if (!this._platform) throw new Error('ProdutoPlatformGateway não configurado');
      const produto = await this._platform.buscarPorId(produtoId, opts);
      if (!produto) throw new Error('Produto não encontrado');
      return Result.ok(produto);
    } catch (error) {
      this._logger.error('ProdutoBridge.consultarProduto - Erro', { produtoId, correlationId: context?.correlationId, error: error.message, duration: Date.now() - startTime });
      return Result.fail(error);
    }
  }

  async consultarUnidade(produtoId, context, opts = {}) {
    try {
      const produto = await this._platform.buscarPorId(produtoId, opts);
      if (!produto) throw new Error('Produto não encontrado');
      return Result.ok({
        produtoId,
        unidade: produto.unidadeComercial || produto.unidade,
        unidadeComercial: produto.unidadeComercial || produto.unidade,
        descricao: produto.unidadeComercial || produto.unidade
      });
    } catch (error) {
      return Result.fail(error);
    }
  }

  async consultarPreco(produtoId, tabelaPreco, context, opts = {}) {
    try {
      const preco = await this._platform.consultarPreco(produtoId, tabelaPreco, opts);
      return Result.ok(preco);
    } catch (error) {
      return Result.fail(error);
    }
  }

  async consultarGTIN(produtoId, context) {
    try {
      const produto = await this._platform.buscarPorId(produtoId);
      if (!produto) throw new Error('Produto não encontrado');
      return Result.ok({ produtoId, gtin: produto.codigoBarras, gtinTipo: 'EAN13' });
    } catch (error) {
      return Result.fail(error);
    }
  }

  async consultarEstoqueDisponivel(produtoId, filialId, context) {
    try {
      const estoque = await this._platform.consultarEstoqueDisponivel(produtoId);
      return Result.ok({ ...estoque, filialId: filialId ?? null });
    } catch (error) {
      return Result.fail(error);
    }
  }
}

module.exports = ProdutoBridge;
