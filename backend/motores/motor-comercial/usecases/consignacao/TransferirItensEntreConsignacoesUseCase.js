/**
 * UC-013 — TransferirItensEntreConsignacoesUseCase
 *
 * @class TransferirItensEntreConsignacoesUseCase
 */

const ConsignacaoWriteUseCase = require('./ConsignacaoWriteUseCase');
const { EVENTOS_DOMINIO } = require('../../events/comercialEventosTipos');
const {
  DocumentoInvalidoError,
  TransferenciaInvalidaError,
  ProdutoNaoEncontradoNaConsignacaoError,
  QuantidadeInvalidaError,
  QuantidadeSuperiorAoSaldoError
} = require('../../domain/errors');
const { gerarCorrelationId, enfileirarEvento } = require('./consignacaoUseCaseHelpers');
const {
  obterConsignacaoEntregue,
  garantirSemPrestacaoAberta,
  calcularSaldoItem,
  criarSnapshotConsignacao,
  registrarMovimentacaoComercial
} = require('./consignacaoOperacaoHelpers');
const {
  OUTBOX_EVENT_TYPES,
  OUTBOX_BRIDGE_NAMES,
  enfileirarBridgeOutbox
} = require('../../integrations/outbox/outboxUseCaseHelpers');

class TransferirItensEntreConsignacoesUseCase extends ConsignacaoWriteUseCase {
  constructor(deps = {}) {
    super(deps);
  }

  async validar(entrada) {
    if (!entrada?.consignacaoOrigemId || !entrada?.consignacaoDestinoId) {
      throw new DocumentoInvalidoError('consignacaoOrigemId e consignacaoDestinoId são obrigatórios');
    }
    if (!Array.isArray(entrada.itens) || !entrada.itens.length) {
      throw new TransferenciaInvalidaError('Lista de itens para transferência é obrigatória');
    }
  }

  async processar(entrada) {
    const correlationId = entrada.correlationId ?? gerarCorrelationId();
    const origem = entrada.origem ?? 'USUARIO';

    return this.executarEscrita(async (uow, eventos, outboxEnqueue) => {
      const origemCons = await uow.consignacao.buscarPorId(entrada.consignacaoOrigemId);
      const destinoCons = await uow.consignacao.buscarPorId(entrada.consignacaoDestinoId);

      obterConsignacaoEntregue(origemCons);
      obterConsignacaoEntregue(destinoCons);
      garantirSemPrestacaoAberta(origemCons);
      garantirSemPrestacaoAberta(destinoCons);

      if (origemCons.clienteId !== destinoCons.clienteId) {
        throw new TransferenciaInvalidaError('Consignações devem pertencer ao mesmo cliente');
      }
      if (origemCons.perfilComercialId !== destinoCons.perfilComercialId) {
        throw new TransferenciaInvalidaError('Consignações devem pertencer ao mesmo perfil comercial');
      }
      if (origemCons.id === destinoCons.id) {
        throw new TransferenciaInvalidaError('Origem e destino não podem ser a mesma consignação');
      }

      const transferencias = [];

      for (const linha of entrada.itens) {
        const quantidade = Number(linha.quantidade);
        if (!Number.isFinite(quantidade) || quantidade <= 0) {
          throw new QuantidadeInvalidaError(linha.quantidade);
        }

        const itensOrigem = await uow.consignacaoItem.listarPorConsignacao(origemCons.id, {
          produtoId: linha.produtoId
        });
        const itemOrigem = linha.itemId
          ? await uow.consignacaoItem.buscarPorId(linha.itemId)
          : itensOrigem[0];

        if (!itemOrigem || itemOrigem.consignacaoId !== origemCons.id) {
          throw new ProdutoNaoEncontradoNaConsignacaoError(origemCons.id, linha.produtoId);
        }

        const saldo = calcularSaldoItem(itemOrigem);
        if (quantidade > saldo) {
          throw new QuantidadeSuperiorAoSaldoError({
            consignacaoId: origemCons.id,
            produtoId: linha.produtoId,
            saldo,
            quantidade
          });
        }

        const valor = quantidade * Number(itemOrigem.precoUnitario ?? 0);

        const movSaida = await registrarMovimentacaoComercial(uow, {
          consignacaoId: origemCons.id,
          consignacaoItemId: itemOrigem.id,
          tipoMovimentacao: 'TRANSFERENCIA_SAIDA',
          origem,
          correlationId,
          snapshot: criarSnapshotConsignacao(origemCons, {
            operacao: 'TRANSFERENCIA_SAIDA',
            destinoConsignacaoId: destinoCons.id
          }),
          usuarioId: entrada.usuarioId ?? null,
          valor,
          quantidade,
          detalhes: { consignacaoDestinoId: destinoCons.id, produtoId: linha.produtoId }
        });

        const itensDestino = await uow.consignacaoItem.listarPorConsignacao(destinoCons.id, {
          produtoId: linha.produtoId
        });
        let itemDestino = itensDestino[0];

        if (itemDestino) {
          itemDestino = await uow.consignacaoItem.atualizar(itemDestino.id, {
            quantidadeEntregue: Number(itemDestino.quantidadeEntregue) + quantidade,
            subtotalEntregue: (Number(itemDestino.quantidadeEntregue) + quantidade)
              * Number(itemDestino.precoUnitario)
          });
        } else {
          itemDestino = await uow.consignacaoItem.inserir({
            consignacaoId: destinoCons.id,
            produtoId: linha.produtoId,
            quantidadeEntregue: quantidade,
            precoUnitario: itemOrigem.precoUnitario,
            subtotalEntregue: valor,
            // RCM-6.1 — preserva snapshot de precificação na transferência
            linhaComercialId: itemOrigem.linhaComercialId ?? null,
            tabelaPrecoId: itemOrigem.tabelaPrecoId ?? null,
            canalVenda: itemOrigem.canalVenda ?? null,
            unidadeComercial: itemOrigem.unidadeComercial ?? null,
            precoOrigem: itemOrigem.precoOrigem ?? null,
            precoFallback: itemOrigem.precoFallback ?? false
          });
        }

        const movEntrada = await registrarMovimentacaoComercial(uow, {
          consignacaoId: destinoCons.id,
          consignacaoItemId: itemDestino.id,
          tipoMovimentacao: 'TRANSFERENCIA_ENTRADA',
          origem,
          correlationId,
          snapshot: criarSnapshotConsignacao(destinoCons, {
            operacao: 'TRANSFERENCIA_ENTRADA',
            origemConsignacaoId: origemCons.id
          }),
          usuarioId: entrada.usuarioId ?? null,
          valor,
          quantidade,
          detalhes: { consignacaoOrigemId: origemCons.id, produtoId: linha.produtoId }
        });

        await uow.consignacaoItem.atualizar(itemOrigem.id, {
          quantidadeEntregue: Number(itemOrigem.quantidadeEntregue) - quantidade,
          subtotalEntregue: (Number(itemOrigem.quantidadeEntregue) - quantidade)
            * Number(itemOrigem.precoUnitario ?? 0)
        });

        transferencias.push({
          produtoId: linha.produtoId,
          quantidade,
          movSaida,
          movEntrada,
          itemDestino
        });
      }

      await enfileirarBridgeOutbox(outboxEnqueue, {
        eventType: OUTBOX_EVENT_TYPES.ESTOQUE_TRANSFERENCIA,
        bridgeName: OUTBOX_BRIDGE_NAMES.ESTOQUE,
        payload: {
          consignacaoOrigemId: origemCons.id,
          consignacaoDestinoId: destinoCons.id,
          itens: entrada.itens,
          correlationId
        },
        correlationId,
        requestId: entrada.requestId ?? null
      });

      enfileirarEvento(eventos, EVENTOS_DOMINIO.ITENS_TRANSFERIDOS_ENTRE_CONSIGNACOES, origemCons.id, {
        consignacaoOrigemId: origemCons.id,
        consignacaoDestinoId: destinoCons.id,
        transferencias,
        correlationId
      }, correlationId);

      return {
        consignacaoOrigemId: origemCons.id,
        consignacaoDestinoId: destinoCons.id,
        transferencias,
        correlationId
      };
    });
  }
}

module.exports = TransferirItensEntreConsignacoesUseCase;
