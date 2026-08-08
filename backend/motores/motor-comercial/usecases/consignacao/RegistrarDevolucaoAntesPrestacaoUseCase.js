/**
 * UC-012 — RegistrarDevolucaoAntesPrestacaoUseCase
 *
 * @class RegistrarDevolucaoAntesPrestacaoUseCase
 */

const ConsignacaoWriteUseCase = require('./ConsignacaoWriteUseCase');
const { EVENTOS_DOMINIO } = require('../../events/comercialEventosTipos');
const {
  DocumentoInvalidoError,
  ProdutoNaoEncontradoNaConsignacaoError,
  QuantidadeInvalidaError,
  QuantidadeSuperiorAoSaldoError
} = require('../../domain/errors');
const { gerarCorrelationId, enfileirarEvento } = require('./consignacaoUseCaseHelpers');
const {
  obterConsignacaoEntregue,
  prestacaoEstaAberta,
  calcularSaldoItem,
  criarSnapshotConsignacao,
  registrarMovimentacaoComercial
} = require('./consignacaoOperacaoHelpers');
const { sincronizarCacheConsignacao } = require('../../services/projections/ledgerCacheSync');
const { sincronizarCreditoComercial } = require('../../services/sincronizarCreditoComercial');
const { resolverQuantidadeBaseMcc } = require('../../services/mccQuantidadeComercial');
const {
  OUTBOX_EVENT_TYPES,
  OUTBOX_BRIDGE_NAMES,
  enfileirarBridgeOutbox
} = require('../../integrations/outbox/outboxUseCaseHelpers');

class RegistrarDevolucaoAntesPrestacaoUseCase extends ConsignacaoWriteUseCase {
  constructor(deps = {}) {
    super(deps);
  }

  async validar(entrada) {
    if (!entrada?.consignacaoId) {
      throw new DocumentoInvalidoError('consignacaoId é obrigatório');
    }
    if (!entrada?.itemId && !entrada?.produtoId) {
      throw new DocumentoInvalidoError('itemId ou produtoId é obrigatório');
    }
    if (!Number.isFinite(Number(entrada.quantidade)) || Number(entrada.quantidade) <= 0) {
      throw new QuantidadeInvalidaError(entrada?.quantidade);
    }
  }

  async processar(entrada) {
    const quantidade = Number(entrada.quantidade);
    const correlationId = entrada.correlationId ?? gerarCorrelationId();
    const origem = entrada.origem ?? 'USUARIO';

    return this.executarEscrita(async (uow, eventos, outboxEnqueue) => {
      const consignacao = await uow.consignacao.buscarPorId(entrada.consignacaoId);
      obterConsignacaoEntregue(consignacao);

      // Grade unificada: permite devolução com prestação ABERTA.
      // Bloqueia apenas se o ciclo estiver FECHADO (precisa reabrir).
      const prestacao = consignacao.prestacaoContasAtiva;
      if (prestacao && String(prestacao.status || '').toUpperCase() === 'FECHADA') {
        throw new DocumentoInvalidoError(
          'Devolução indisponível com prestação fechada. Reabra a prestação para liquidar residual.'
        );
      }

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
        throw new ProdutoNaoEncontradoNaConsignacaoError(consignacao.id, entrada.produtoId ?? entrada.itemId);
      }

      const saldo = calcularSaldoItem(item);
      if (quantidade > saldo) {
        throw new QuantidadeSuperiorAoSaldoError({
          consignacaoId: consignacao.id,
          itemId: item.id,
          saldo,
          quantidade
        });
      }

      const mccQty = await resolverQuantidadeBaseMcc(uow, {
        produtoId: item.produtoId,
        quantidade,
        unidadeOrigem: entrada.unidadeComercial || entrada.unidadeOrigem || item.unidadeComercial || item.unidade,
        consignacaoId: consignacao.id,
        operacao: 'DEVOLUCAO',
        usuarioId: entrada.usuarioId
      });

      const valorDevolucao = quantidade * Number(item.precoUnitario ?? 0);
      const novaQtdDevolvida = Number(item.quantidadeDevolvida ?? 0) + quantidade;
      const grupoAbertoId = prestacaoEstaAberta(consignacao)
        ? consignacao.prestacaoContasAtiva.id
        : null;

      const movimentacao = await registrarMovimentacaoComercial(uow, {
        consignacaoId: consignacao.id,
        consignacaoItemId: item.id,
        tipoMovimentacao: 'DEVOLUCAO',
        origem,
        correlationId,
        grupoPrestacaoContasId: grupoAbertoId,
        snapshot: criarSnapshotConsignacao(consignacao, {
          operacao: 'DEVOLUCAO',
          itemId: item.id,
          mcc: mccQty.auditoria
        }),
        usuarioId: entrada.usuarioId ?? null,
        valor: valorDevolucao,
        quantidade: mccQty.quantidadeBase,
        motivo: entrada.motivo
          ?? (grupoAbertoId ? 'Devolução na prestação de contas' : 'Devolução antes da prestação'),
        detalhes: mccQty.auditoria ? { mcc: mccQty.auditoria } : null
      });

      const itemAtualizado = await uow.consignacaoItem.atualizar(item.id, {
        quantidadeDevolvida: novaQtdDevolvida
      });

      const consignacaoAtualizada = await sincronizarCacheConsignacao(uow, consignacao.id);

      await enfileirarBridgeOutbox(outboxEnqueue, {
        eventType: OUTBOX_EVENT_TYPES.ESTOQUE_ENTRADA_DEVOLUCAO,
        bridgeName: OUTBOX_BRIDGE_NAMES.ESTOQUE,
        payload: {
          consignacaoId: consignacao.id,
          item: itemAtualizado,
          quantidade,
          quantidadeBase: mccQty.quantidadeBase,
          unidadeOrigem: mccQty.unidadeOrigem,
          correlationId
        },
        correlationId,
        requestId: entrada.requestId ?? null
      });

      enfileirarEvento(eventos, EVENTOS_DOMINIO.CONSIGNACAO_DEVOLVIDA, consignacao.id, {
        consignacao: consignacaoAtualizada,
        item: itemAtualizado,
        movimentacao,
        quantidade,
        correlationId
      }, correlationId);

      await sincronizarCreditoComercial(uow, eventos, consignacao, {
        origem: 'DEVOLUCAO',
        correlationId,
        usuarioId: entrada.usuarioId ?? null
      });

      return {
        consignacao: consignacaoAtualizada,
        item: itemAtualizado,
        movimentacao,
        correlationId
      };
    });
  }
}

module.exports = RegistrarDevolucaoAntesPrestacaoUseCase;
