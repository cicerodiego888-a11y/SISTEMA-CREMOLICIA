/**
 * UC-011 — RegistrarEntregaConsignacaoUseCase
 *
 * @class RegistrarEntregaConsignacaoUseCase
 */

const ConsignacaoWriteUseCase = require('./ConsignacaoWriteUseCase');
const { EVENTOS_DOMINIO } = require('../../events/comercialEventosTipos');
const { DocumentoInvalidoError } = require('../../domain/errors');
const { gerarCorrelationId, enfileirarEvento, STATUS_ENTREGUE } = require('./consignacaoUseCaseHelpers');
const {
  executarValidacaoEntrega,
  calcularValorTotalItens,
  criarSnapshotConsignacao,
  registrarMovimentacaoComercial,
  consumirLimitePerfil
} = require('./consignacaoOperacaoHelpers');
const { sincronizarCacheConsignacao } = require('../../services/projections/ledgerCacheSync');
const { sincronizarCreditoComercial } = require('../../services/sincronizarCreditoComercial');
const {
  OUTBOX_EVENT_TYPES,
  OUTBOX_BRIDGE_NAMES,
  enfileirarBridgeOutbox
} = require('../../integrations/outbox/outboxUseCaseHelpers');

class RegistrarEntregaConsignacaoUseCase extends ConsignacaoWriteUseCase {
  constructor(deps = {}) {
    super(deps);
    this._clienteBridge = deps.clienteBridge ?? null;
    this._perfilComercialRepository = deps.perfilComercialRepository ?? null;
    this._consignacaoRepository = deps.consignacaoRepository ?? null;
    this._consignacaoItemRepository = deps.consignacaoItemRepository ?? null;
    this._movimentacaoComercialRepository = deps.movimentacaoComercialRepository ?? null;
  }

  async validar(entrada) {
    if (!entrada?.consignacaoId) {
      throw new DocumentoInvalidoError('consignacaoId é obrigatório');
    }
  }

  async processar(entrada) {
    const liberacaoGerencial = entrada.liberacaoGerencial || null;
    const { liberacaoGerencialValida } = require('../../services/autorizacaoGerencialService');
    const liberacaoOk = liberacaoGerencialValida(liberacaoGerencial);

    if (liberacaoGerencial && !liberacaoOk) {
      const { DomainError } = require('../../domain/errors');
      throw new DomainError('Autorização gerencial inválida ou expirada', {
        codigo: 'AUTORIZACAO_GERENCIAL_INVALIDA'
      });
    }

    if (liberacaoOk && liberacaoGerencial.supervisorToken) {
      try {
        const { verificarSupervisorToken } = require('../../../../rotas/auth');
        await verificarSupervisorToken(liberacaoGerencial.supervisorToken);
      } catch (error) {
        const { DomainError } = require('../../domain/errors');
        throw new DomainError(error.message || 'Token de autorização gerencial inválido', {
          codigo: 'AUTORIZACAO_GERENCIAL_INVALIDA'
        });
      }
    }

    const validacao = await executarValidacaoEntrega({
      consignacaoRepository: this._consignacaoRepository,
      consignacaoItemRepository: this._consignacaoItemRepository,
      clienteBridge: this._clienteBridge,
      perfilComercialRepository: this._perfilComercialRepository,
      movimentacaoComercialRepository: this._movimentacaoComercialRepository
    }, entrada.consignacaoId, { liberacaoGerencial });

    if (!validacao.valido) {
      const primeiro = validacao.erros[0];
      const { DomainError } = require('../../domain/errors');
      throw new DomainError(primeiro?.mensagem ?? 'Validação de entrega falhou', {
        codigo: primeiro?.codigo ?? 'VALIDACAO_ENTREGA_FALHOU',
        detalhes: { erros: validacao.erros }
      });
    }

    const correlationId = entrada.correlationId ?? gerarCorrelationId();
    const origem = entrada.origem ?? 'USUARIO';

    return this.executarEscrita(async (uow, eventos, outboxEnqueue) => {
      const consignacao = validacao.consignacao;
      const itens = validacao.itens;
      const valorTotal = calcularValorTotalItens(itens);

      await consumirLimitePerfil(uow, consignacao.perfilComercialId, valorTotal, {
        permitirExcessoAutorizado: liberacaoOk
      });

      // RCM-8.12 — autoridade: resolver + vincular ciclo ANTES de qualquer ENTREGA no Ledger
      const {
        resolverCicloPrestacaoParaEntrega
      } = require('./prestacaoCicloClienteHelpers');

      const resolucao = await resolverCicloPrestacaoParaEntrega(uow, consignacao);
      const grupoCiclo = resolucao.grupo;
      const consignacaoCiclo = resolucao.consignacao || consignacao;

      const movimentacoes = [];
      for (const item of itens) {
        const valorItem = Number(item.quantidadeEntregue) * Number(item.precoUnitario);
        const mov = await registrarMovimentacaoComercial(uow, {
          consignacaoId: consignacaoCiclo.id,
          consignacaoItemId: item.id,
          tipoMovimentacao: 'ENTREGA',
          origem,
          correlationId,
          grupoPrestacaoContasId: grupoCiclo?.id ?? null,
          snapshot: {
            ...criarSnapshotConsignacao(consignacaoCiclo, { operacao: 'ENTREGA' }),
            documento: consignacaoCiclo.documento,
            item: { id: item.id, produtoId: item.produtoId, quantidade: item.quantidadeEntregue },
            liberacaoGerencial: liberacaoOk ? {
              autorizado: true,
              autorizadoPor: liberacaoGerencial.autorizadoPor || null,
              auditoriaId: liberacaoGerencial.auditoriaId || null,
              motivo: liberacaoGerencial.motivo || null,
              valorExcedido: liberacaoGerencial.valorExcedido ?? null
            } : null
          },
          usuarioId: entrada.usuarioId ?? null,
          valor: valorItem,
          quantidade: item.quantidadeEntregue,
          motivo: entrada.motivo ?? entrada.observacao ?? 'Entrega de consignação',
          detalhes: liberacaoOk ? { liberacaoGerencial } : null
        });
        movimentacoes.push(mov);
      }

      const patchEntrega = {
        status: STATUS_ENTREGUE,
        dataEntrega: entrada.dataEntrega ?? new Date().toISOString(),
        documento: {
          ...consignacaoCiclo.documento,
          situacao: 'ATIVO',
          dataEmissao: consignacaoCiclo.documento?.dataEmissao ?? new Date().toISOString()
        }
      };
      // Reforça ponteiro do ciclo (idempotente se já vinculado em resolverCiclo…)
      if (grupoCiclo) {
        patchEntrega.prestacaoContasAtiva = {
          ...grupoCiclo,
          status: 'ABERTA',
          dataFechamento: null
        };
      }

      const consignacaoAtualizada = await uow.consignacao.atualizar(
        consignacaoCiclo.id,
        patchEntrega
      );

      await sincronizarCacheConsignacao(uow, consignacaoCiclo.id);
      const consignacaoComCache = await uow.consignacao.buscarPorId(consignacaoCiclo.id);

      await enfileirarBridgeOutbox(outboxEnqueue, {
        eventType: OUTBOX_EVENT_TYPES.ESTOQUE_BAIXAR_PRODUTO,
        bridgeName: OUTBOX_BRIDGE_NAMES.ESTOQUE,
        payload: {
          consignacaoId: consignacaoCiclo.id,
          itens,
          correlationId
        },
        correlationId,
        requestId: entrada.requestId ?? null
      });

      enfileirarEvento(eventos, EVENTOS_DOMINIO.CONSIGNACAO_ENTREGUE, consignacaoCiclo.id, {
        consignacao: consignacaoComCache ?? consignacaoAtualizada,
        movimentacoes,
        valorTotal,
        correlationId,
        grupoPrestacaoContasId: grupoCiclo?.id ?? null,
        incorporadaAoCicloCliente: resolucao.vinculadaAoCiclo || resolucao.origem === 'cliente',
        liberacaoGerencial: liberacaoOk ? liberacaoGerencial : null
      }, correlationId);

      await sincronizarCreditoComercial(uow, eventos, consignacaoCiclo, {
        origem: 'ENTREGA',
        correlationId,
        usuarioId: entrada.usuarioId ?? null
      });

      return {
        consignacao: consignacaoComCache ?? consignacaoAtualizada,
        movimentacoes,
        valorTotal,
        correlationId,
        grupoPrestacaoContasId: grupoCiclo?.id ?? null,
        incorporadaAoCicloCliente: Boolean(
          resolucao.vinculadaAoCiclo || (grupoCiclo && resolucao.origem === 'cliente')
        ),
        cicloOrigem: resolucao.origem
      };
    });
  }
}

module.exports = RegistrarEntregaConsignacaoUseCase;
