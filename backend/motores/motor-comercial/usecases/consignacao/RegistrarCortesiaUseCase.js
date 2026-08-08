/**
 * UC-022 — RegistrarCortesiaUseCase
 *
 * @class RegistrarCortesiaUseCase
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

class RegistrarCortesiaUseCase extends ConsignacaoWriteUseCase {
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

    return this.executarEscrita(async (uow, eventos) => {
      const consignacao = await uow.consignacao.buscarPorId(entrada.consignacaoId);
      const grupo = garantirPrestacaoAberta(consignacao);

      const item = await obterItemPrestacao(uow, consignacao, entrada);
      const saldo = calcularSaldoItem(item);
      if (quantidadeInformada > saldo) {
        throw new QuantidadeSuperiorAoSaldoError({
          consignacaoId: consignacao.id,
          itemId: item.id,
          saldo,
          quantidade: quantidadeInformada
        });
      }

      const mccQty = await resolverQuantidadeBaseMcc(uow, {
        produtoId: item.produtoId,
        quantidade: quantidadeInformada,
        unidadeOrigem: entrada.unidadeComercial || entrada.unidadeOrigem || item.unidadeComercial || item.unidade,
        consignacaoId: consignacao.id,
        operacao: 'CORTESIA',
        usuarioId: entrada.usuarioId
      });

      const quantidade = quantidadeInformada;
      const quantidadeBase = mccQty.quantidadeBase;
      const valorCortesia = quantidade * Number(item.precoUnitario ?? 0);
      const novaQtdCortesia = Number(item.quantidadeCortesia ?? 0) + quantidade;
      const itens = await uow.consignacaoItem.listarPorConsignacao(consignacao.id);
      const movimentacoesExistentes = await listarMovimentacoesPrestacao(uow, grupo.id, consignacao.id);
      const totaisAtuais = calcularTotaisPrestacao(movimentacoesExistentes, grupo.id);

      const snapshot = criarSnapshotPrestacao(
        consignacao,
        grupo,
        itens,
        { ...totaisAtuais, totalCortesia: totaisAtuais.totalCortesia + valorCortesia },
        { operacao: 'CORTESIA', itemId: item.id, quantidade, mcc: mccQty.auditoria }
      );

      const movimentacao = await registrarMovimentacaoComercial(uow, {
        consignacaoId: consignacao.id,
        consignacaoItemId: item.id,
        tipoMovimentacao: 'CORTESIA',
        origem,
        correlationId,
        grupoPrestacaoContasId: grupo.id,
        snapshot,
        usuarioId: entrada.usuarioId ?? null,
        valor: valorCortesia,
        quantidade: quantidadeBase,
        motivo: entrada.motivo ?? 'Cortesia registrada na prestação',
        detalhes: mccQty.auditoria ? { mcc: mccQty.auditoria } : null
      });

      const itemAtualizado = await uow.consignacaoItem.atualizar(item.id, {
        quantidadeCortesia: novaQtdCortesia
      });

      enfileirarEvento(eventos, EVENTOS_DOMINIO.CORTESIA_REGISTRADA, consignacao.id, {
        consignacao,
        item: itemAtualizado,
        movimentacao,
        grupoPrestacaoContas: grupo,
        correlationId
      }, correlationId);

      await sincronizarCreditoComercial(uow, eventos, consignacao, {
        origem: 'CORTESIA',
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

module.exports = RegistrarCortesiaUseCase;
