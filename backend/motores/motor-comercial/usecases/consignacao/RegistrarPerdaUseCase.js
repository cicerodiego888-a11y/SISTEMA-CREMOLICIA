/**
 * UC-021 — RegistrarPerdaUseCase
 *
 * @class RegistrarPerdaUseCase
 */

const ConsignacaoWriteUseCase = require('./ConsignacaoWriteUseCase');
const { EVENTOS_DOMINIO } = require('../../events/comercialEventosTipos');
const {
  DocumentoInvalidoError,
  QuantidadeInvalidaError,
  QuantidadeSuperiorAoSaldoError
} = require('../../domain/errors');
const { gerarCorrelationId, enfileirarEvento } = require('./consignacaoUseCaseHelpers');
const {
  calcularSaldoItem,
  registrarMovimentacaoComercial
} = require('./consignacaoOperacaoHelpers');
const {
  garantirPrestacaoAberta,
  obterItemPrestacao,
  criarSnapshotPrestacao,
  calcularTotaisPrestacao,
  listarMovimentacoesPrestacao
} = require('./prestacaoOperacaoHelpers');
const { sincronizarCreditoComercial } = require('../../services/sincronizarCreditoComercial');
const { resolverQuantidadeBaseMcc } = require('../../services/mccQuantidadeComercial');
const {
  OUTBOX_EVENT_TYPES,
  OUTBOX_BRIDGE_NAMES,
  enfileirarBridgeOutbox
} = require('../../integrations/outbox/outboxUseCaseHelpers');

class RegistrarPerdaUseCase extends ConsignacaoWriteUseCase {
  constructor(deps = {}) {
    super(deps);
  }

  async validar(entrada) {
    if (!entrada?.consignacaoId) {
      throw new DocumentoInvalidoError('consignacaoId é obrigatório');
    }
    if (!entrada?.itemId && entrada?.produtoId == null) {
      throw new DocumentoInvalidoError('itemId ou produtoId é obrigatório');
    }
    if (!Number.isFinite(Number(entrada.quantidade)) || Number(entrada.quantidade) <= 0) {
      throw new QuantidadeInvalidaError(entrada?.quantidade);
    }
  }

  async processar(entrada) {
    const quantidadeInformada = Number(entrada.quantidade);
    const correlationId = entrada.correlationId ?? gerarCorrelationId();
    const origem = entrada.origem ?? 'USUARIO';

    return this.executarEscrita(async (uow, eventos, outboxEnqueue) => {
      const consignacao = await uow.consignacao.buscarPorId(entrada.consignacaoId);
      const grupo = garantirPrestacaoAberta(consignacao);

      const item = await obterItemPrestacao(uow, consignacao, entrada);
      const saldo = calcularSaldoItem(item);

      const mccQty = await resolverQuantidadeBaseMcc(uow, {
        produtoId: item.produtoId,
        quantidade: quantidadeInformada,
        unidadeOrigem: entrada.unidadeComercial || entrada.unidadeOrigem || item.unidadeComercial || item.unidade,
        consignacaoId: consignacao.id,
        operacao: 'PERDA',
        usuarioId: entrada.usuarioId
      });
      // Saldo do item está na mesma unidade da entrega (legado = base). Compara qtd informada.
      if (quantidadeInformada > saldo) {
        throw new QuantidadeSuperiorAoSaldoError({
          consignacaoId: consignacao.id,
          itemId: item.id,
          saldo,
          quantidade: quantidadeInformada
        });
      }

      const quantidade = quantidadeInformada;
      const quantidadeBase = mccQty.quantidadeBase;
      const valorPerda = quantidade * Number(item.precoUnitario ?? 0);
      const novaQtdPerdida = Number(item.quantidadePerdida ?? 0) + quantidade;
      const itens = await uow.consignacaoItem.listarPorConsignacao(consignacao.id);
      const movimentacoesExistentes = await listarMovimentacoesPrestacao(uow, grupo.id, consignacao.id);
      const totaisAtuais = calcularTotaisPrestacao(movimentacoesExistentes, grupo.id);

      const snapshot = criarSnapshotPrestacao(
        consignacao,
        grupo,
        itens,
        { ...totaisAtuais, totalPerdido: totaisAtuais.totalPerdido + valorPerda },
        { operacao: 'PERDA', itemId: item.id, quantidade, mcc: mccQty.auditoria }
      );

      const movimentacao = await registrarMovimentacaoComercial(uow, {
        consignacaoId: consignacao.id,
        consignacaoItemId: item.id,
        tipoMovimentacao: 'PERDA',
        origem,
        correlationId,
        grupoPrestacaoContasId: grupo.id,
        snapshot,
        usuarioId: entrada.usuarioId ?? null,
        valor: valorPerda,
        quantidade: quantidadeBase,
        motivo: entrada.motivo ?? 'Perda registrada na prestação',
        detalhes: mccQty.auditoria ? { mcc: mccQty.auditoria } : null
      });

      const itemAtualizado = await uow.consignacaoItem.atualizar(item.id, {
        quantidadePerdida: novaQtdPerdida
      });

      await enfileirarBridgeOutbox(outboxEnqueue, {
        eventType: OUTBOX_EVENT_TYPES.FINANCEIRO_REGISTRAR_PERDA,
        bridgeName: OUTBOX_BRIDGE_NAMES.FINANCEIRO,
        payload: {
          consignacaoId: consignacao.id,
          grupoPrestacaoContasId: grupo.id,
          item: itemAtualizado,
          valor: valorPerda,
          quantidade,
          quantidadeBase,
          correlationId
        },
        correlationId,
        requestId: entrada.requestId ?? null
      });

      await enfileirarBridgeOutbox(outboxEnqueue, {
        eventType: OUTBOX_EVENT_TYPES.ESTOQUE_REGISTRAR_PERDA,
        bridgeName: OUTBOX_BRIDGE_NAMES.ESTOQUE,
        payload: {
          consignacaoId: consignacao.id,
          produtoId: item.produtoId,
          item: itemAtualizado,
          quantidade,
          quantidadeBase,
          unidadeOrigem: mccQty.unidadeOrigem,
          correlationId,
          usuarioId: entrada.usuarioId ?? null
        },
        correlationId,
        requestId: entrada.requestId ?? null
      });

      enfileirarEvento(eventos, EVENTOS_DOMINIO.PERDA_REGISTRADA, consignacao.id, {
        consignacao,
        item: itemAtualizado,
        movimentacao,
        grupoPrestacaoContas: grupo,
        correlationId
      }, correlationId);

      await sincronizarCreditoComercial(uow, eventos, consignacao, {
        origem: 'PERDA',
        correlationId,
        usuarioId: entrada.usuarioId ?? null
      });

      return {
        consignacao,
        item: itemAtualizado,
        movimentacao,
        correlationId,
        mcc: mccQty.auditoria
      };
    });
  }
}

module.exports = RegistrarPerdaUseCase;
