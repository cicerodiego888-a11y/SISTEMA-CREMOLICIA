/**
 * UC-023 — RegistrarPagamentoPrestacaoUseCase
 *
 * @class RegistrarPagamentoPrestacaoUseCase
 */

const ConsignacaoWriteUseCase = require('./ConsignacaoWriteUseCase');
const { EVENTOS_DOMINIO } = require('../../events/comercialEventosTipos');
const {
  DocumentoInvalidoError,
  QuantidadeInvalidaError
} = require('../../domain/errors');
const { gerarCorrelationId, enfileirarEvento } = require('./consignacaoUseCaseHelpers');
const { registrarMovimentacaoComercial } = require('./consignacaoOperacaoHelpers');
const {
  obterGrupoPrestacaoParaPagamento,
  criarSnapshotPrestacao,
  resolverTotaisParaPagamento,
  validarPagamentoContraSaldo,
  determinarStatusAposPagamento
} = require('./prestacaoOperacaoHelpers');
const { sincronizarCacheConsignacao } = require('../../services/projections/ledgerCacheSync');
const { sincronizarCreditoComercial } = require('../../services/sincronizarCreditoComercial');
const CreditoComercialService = require('../../services/CreditoComercialService');

function logAuditoriaPagamento(bloco) {
  console.log('\n==========================');
  console.log('REGISTRAR PAGAMENTO');
  console.log('==========================');
  Object.entries(bloco).forEach(([chave, valor]) => {
    const texto = typeof valor === 'string' ? valor : JSON.stringify(valor, null, 2);
    console.log(`${chave}:`);
    console.log(texto);
    console.log('---');
  });
  console.log('==========================\n');
}

class RegistrarPagamentoPrestacaoUseCase extends ConsignacaoWriteUseCase {
  constructor(deps = {}) {
    super(deps);
  }

  async validar(entrada) {
    const id = Number(entrada?.consignacaoId);
    if (!Number.isFinite(id) || id <= 0) {
      throw new DocumentoInvalidoError('consignacaoId é obrigatório');
    }
    entrada.consignacaoId = id;

    const valor = Number(entrada?.valor);
    if (!Number.isFinite(valor) || valor <= 0) {
      throw new QuantidadeInvalidaError(entrada?.valor);
    }
    entrada.valor = valor;
  }

  async processar(entrada) {
    const valor = Number(entrada.valor);
    const correlationId = entrada.correlationId ?? gerarCorrelationId();
    const origem = entrada.origem ?? 'USUARIO';

    return this.executarEscrita(async (uow, eventos, outboxEnqueue) => {
      const consignacao = await uow.consignacao.buscarPorId(entrada.consignacaoId);
      const grupo = obterGrupoPrestacaoParaPagamento(consignacao);

      const {
        totais: totaisAtuais,
        escopo,
        reconciliacao,
        grupo: grupoResolvido
      } = await resolverTotaisParaPagamento(
        uow,
        consignacao,
        grupo
      );
      const grupoPagamento = grupoResolvido || grupo;

      let credito = null;
      try {
        const creditoSvc = new CreditoComercialService({
          perfilComercialRepository: uow.perfilComercial,
          consignacaoRepository: uow.consignacao,
          movimentacaoComercialRepository: uow.movimentacaoComercial
        });
        credito = await creditoSvc.calcularParaPerfil(uow, consignacao.perfilComercialId);
      } catch (_err) {
        credito = null;
      }

      const perfil = await uow.perfilComercial.buscarPorId(consignacao.perfilComercialId).catch(() => null);

      logAuditoriaPagamento({
        Consignação: {
          id: consignacao.id,
          status: consignacao.status,
          clienteId: consignacao.clienteId,
          perfilComercialId: consignacao.perfilComercialId
        },
        Prestação: grupoPagamento,
        'Payload recebido': entrada,
        DTO: {
          consignacaoId: entrada.consignacaoId,
          valor: entrada.valor,
          formaPagamento: entrada.formaPagamento ?? null,
          observacao: entrada.observacao ?? null,
          usuarioId: entrada.usuarioId ?? null,
          prestacaoId: grupoPagamento?.id ?? null
        },
        'Pagamento recebido': valor,
        'Valor devido': totaisAtuais.saldo,
        'Saldo atual': totaisAtuais.saldo,
        'Saldo devedor': Math.max(0, totaisAtuais.saldo),
        'Saldo credor': Math.max(0, -totaisAtuais.saldo),
        Cliente: consignacao.clienteId,
        'Perfil comercial': perfil,
        'Capacidade de crédito': credito,
        Escopo: escopo,
        Reconciliacao: reconciliacao,
        Totais: totaisAtuais
      });

      validarPagamentoContraSaldo(totaisAtuais, valor, {
        escopo,
        grupoPrestacaoContasId: grupoPagamento.id,
        consignacaoId: consignacao.id
      });

      const itens = await uow.consignacaoItem.listarPorConsignacao(consignacao.id);
      const totaisPosPagamento = {
        ...totaisAtuais,
        totalRecebido: totaisAtuais.totalRecebido + valor,
        saldo: totaisAtuais.saldo - valor
      };

      const snapshot = criarSnapshotPrestacao(
        consignacao,
        grupoPagamento,
        itens,
        totaisPosPagamento,
        {
          operacao: 'PAGAMENTO',
          valor,
          escopo,
          formaPagamento: entrada.formaPagamento ?? null
        }
      );

      const movimentacao = await registrarMovimentacaoComercial(uow, {
        consignacaoId: consignacao.id,
        tipoMovimentacao: 'PAGAMENTO',
        origem,
        correlationId,
        grupoPrestacaoContasId: grupoPagamento.id,
        snapshot,
        usuarioId: entrada.usuarioId ?? null,
        valor,
        motivo: entrada.motivo ?? 'Pagamento na prestação de contas'
      });

      const atualizacao = {};
      const novoStatus = determinarStatusAposPagamento(totaisPosPagamento, consignacao.status);
      if (novoStatus) {
        atualizacao.status = novoStatus;
      }

      if (Object.keys(atualizacao).length) {
        await uow.consignacao.atualizar(consignacao.id, atualizacao);
      }

      const consignacaoAtualizada = await sincronizarCacheConsignacao(uow, consignacao.id);

      // STAB-06: financeiro oficial na venda da plataforma (criarVenda).
      // Mantém ledger PAGAMENTO; não espelha receita no bridge financeiro.

      enfileirarEvento(eventos, EVENTOS_DOMINIO.PAGAMENTO_PRESTACAO_REGISTRADO, consignacao.id, {
        consignacao: consignacaoAtualizada,
        movimentacao,
        grupoPrestacaoContas: grupoPagamento,
        totais: totaisPosPagamento,
        escopo,
        correlationId
      }, correlationId);

      await sincronizarCreditoComercial(uow, eventos, consignacao, {
        origem: 'PAGAMENTO_PRESTACAO',
        correlationId,
        usuarioId: entrada.usuarioId ?? null
      });

      return {
        consignacao: consignacaoAtualizada,
        movimentacao,
        totais: totaisPosPagamento,
        escopo,
        correlationId
      };
    });
  }
}

module.exports = RegistrarPagamentoPrestacaoUseCase;
