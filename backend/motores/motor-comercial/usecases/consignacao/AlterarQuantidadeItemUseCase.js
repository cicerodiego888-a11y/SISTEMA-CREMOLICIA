/**
 * UC-006 — AlterarQuantidadeItemUseCase
 *
 * @class AlterarQuantidadeItemUseCase
 */

const ConsignacaoWriteUseCase = require('./ConsignacaoWriteUseCase');
const { EVENTOS_DOMINIO } = require('../../events/comercialEventosTipos');
const {
  DocumentoInvalidoError,
  ProdutoNaoEncontradoNaConsignacaoError,
  QuantidadeInvalidaError
} = require('../../domain/errors');
const {
  gerarCorrelationId,
  enfileirarEvento,
  obterConsignacaoEmRascunho
} = require('./consignacaoUseCaseHelpers');
const { validarQuantidadePorUnidade } = require('../../services/quantidadeUnidadeComercial');

class AlterarQuantidadeItemUseCase extends ConsignacaoWriteUseCase {
  async validar(entrada) {
    if (!entrada?.consignacaoId) {
      throw new DocumentoInvalidoError('consignacaoId é obrigatório');
    }
    if (!entrada?.itemId && !entrada?.produtoId) {
      throw new DocumentoInvalidoError('itemId ou produtoId é obrigatório');
    }
    if (!Number.isFinite(Number(entrada.novaQuantidade)) || Number(entrada.novaQuantidade) <= 0) {
      throw new QuantidadeInvalidaError(entrada?.novaQuantidade);
    }
  }

  async processar(entrada) {
    const novaQuantidade = Number(entrada.novaQuantidade);
    const correlationId = entrada.correlationId ?? gerarCorrelationId();

    return this.executarEscrita(async (uow, eventos) => {
      const consignacao = await uow.consignacao.buscarPorId(entrada.consignacaoId);
      obterConsignacaoEmRascunho(consignacao);

      let item = null;
      if (entrada.itemId) {
        item = await uow.consignacaoItem.buscarPorId(entrada.itemId);
      } else {
        const itens = await uow.consignacaoItem.listarPorConsignacao(consignacao.id, {
          produtoId: entrada.produtoId
        });
        item = itens[0] ?? null;
      }

      if (!item || item.consignacaoId !== consignacao.id) {
        throw new ProdutoNaoEncontradoNaConsignacaoError(
          consignacao.id,
          entrada.produtoId ?? entrada.itemId
        );
      }

      const quantidadeCheck = validarQuantidadePorUnidade(
        novaQuantidade,
        item.unidadeComercial || item.unidade
      );
      if (!quantidadeCheck.ok) {
        throw new QuantidadeInvalidaError(novaQuantidade);
      }

      const quantidadeAnterior = item.quantidadeEntregue;
      const precoUnitario = Number(item.precoUnitario ?? 0);
      const itemAtualizado = await uow.consignacaoItem.atualizar(item.id, {
        quantidadeEntregue: quantidadeCheck.quantidade,
        subtotalEntregue: quantidadeCheck.quantidade * precoUnitario
      });

      enfileirarEvento(eventos, EVENTOS_DOMINIO.QUANTIDADE_ITEM_ALTERADA, consignacao.id, {
        consignacaoId: consignacao.id,
        item: itemAtualizado,
        quantidadeAnterior,
        quantidadeNova: novaQuantidade,
        correlationId
      }, correlationId);

      return {
        item: itemAtualizado,
        quantidadeAnterior,
        quantidadeNova: novaQuantidade,
        correlationId
      };
    });
  }
}

module.exports = AlterarQuantidadeItemUseCase;
