/**
 * UC-003 — CancelarConsignacaoRascunhoUseCase (RCM-8.8)
 *
 * Cancelamento voluntário da preparação (RASCUNHO → CANCELADA).
 * NÃO exclui, NÃO entrega, NÃO movimenta estoque/Ledger/crédito/fiscal.
 *
 * @class CancelarConsignacaoRascunhoUseCase
 */

const ConsignacaoWriteUseCase = require('./ConsignacaoWriteUseCase');
const { EVENTOS_DOMINIO } = require('../../events/comercialEventosTipos');
const {
  DocumentoInvalidoError,
  DomainError,
  OperacaoNaoAutorizadaError
} = require('../../domain/errors');
const {
  STATUS_RASCUNHO,
  STATUS_CANCELADA,
  gerarCorrelationId,
  enfileirarEvento
} = require('./consignacaoUseCaseHelpers');
const {
  avaliarElegibilidadeCancelamento,
  motivoCancelamentoValido,
  montarObservacaoCancelamento,
  extrairCancelamento,
  MOTIVOS_CANCELAMENTO,
  MENSAGEM_JA_CANCELADA
} = require('./cancelamentoConsignacaoHelpers');

const PERMISSAO_CANCELAR_CONSIGNACAO = 'COMERCIAL_CONSIGNACAO';

class CancelarConsignacaoRascunhoUseCase extends ConsignacaoWriteUseCase {
  constructor(deps = {}) {
    super(deps);
    this._usuarioBridge = deps.usuarioBridge ?? null;
  }

  async validar(entrada) {
    if (!entrada?.consignacaoId) {
      throw new DocumentoInvalidoError('consignacaoId é obrigatório');
    }
    if (entrada.motivo != null && entrada.motivo !== '' && !motivoCancelamentoValido(entrada.motivo)) {
      throw new DocumentoInvalidoError(
        `motivo inválido. Use: ${Object.keys(MOTIVOS_CANCELAMENTO).join(', ')}`
      );
    }
  }

  async autorizar(entrada) {
    if (!this._usuarioBridge || typeof this._usuarioBridge.possuiPermissao !== 'function') {
      return;
    }
    // Sem usuarioId: mantém compatibilidade com DELETE legado / testes sem auth.
    if (entrada.usuarioId == null || entrada.usuarioId === '') return;

    const permitido = await this._usuarioBridge.possuiPermissao(
      entrada.usuarioId,
      PERMISSAO_CANCELAR_CONSIGNACAO
    );
    if (permitido === false) {
      throw new OperacaoNaoAutorizadaError(
        PERMISSAO_CANCELAR_CONSIGNACAO,
        'Usuário sem permissão para cancelar consignação'
      );
    }
  }

  async processar(entrada) {
    const correlationId = entrada.correlationId ?? gerarCorrelationId();
    const motivo = String(entrada.motivo || 'OUTRO').toUpperCase();
    const observacaoLivre = entrada.observacao || entrada.observacaoCancelamento || null;
    const usuarioId = entrada.usuarioId ?? null;
    const agora = entrada.dataCancelamento || new Date().toISOString();

    return this.executarEscrita(async (uow, eventos) => {
      const atual = await uow.consignacao.buscarPorId(entrada.consignacaoId);
      const eleg = avaliarElegibilidadeCancelamento(atual);

      // Idempotência: já CANCELADA → sucesso controlado, sem segundo evento
      if (eleg.idempotente) {
        return {
          consignacao: atual,
          correlationId,
          idempotente: true,
          cancelamento: extrairCancelamento(atual),
          mensagem: MENSAGEM_JA_CANCELADA
        };
      }

      if (!eleg.elegivel) {
        throw new DomainError(eleg.mensagem, {
          codigo: eleg.codigo || 'CONSIGNACAO_NAO_ESTA_EM_RASCUNHO',
          detalhes: { consignacaoId: atual?.id, statusAtual: atual?.status }
        });
      }

      // Segurança: se já houver ENTREGA no ledger, não é preparação pura
      if (typeof uow.movimentacaoComercial?.listar === 'function') {
        const movs = await uow.movimentacaoComercial.listar({ consignacaoId: atual.id });
        const temEntrega = (movs || []).some((m) => {
          const tipo = String(m.tipoMovimentacao || m.tipo || '').toUpperCase();
          return tipo === 'ENTREGA';
        });
        if (temEntrega) {
          throw new DomainError(
            'Consignação já possui entrega registrada e não pode ser cancelada como preparação.',
            {
              codigo: 'CONSIGNACAO_JA_ENTREGUE',
              detalhes: { consignacaoId: atual.id }
            }
          );
        }
      }

      const observacao = montarObservacaoCancelamento(
        motivo,
        observacaoLivre,
        atual.observacao
      );

      const patch = {
        status: STATUS_CANCELADA,
        observacao,
        dataEncerramento: agora,
        usuarioEncerramentoId: usuarioId,
        documento: {
          ...atual.documento,
          situacao: 'CANCELADO'
        }
      };

      // Concorrência: UPDATE condicional (status ainda RASCUNHO)
      let consignacao = null;
      if (typeof uow.consignacao.atualizarSeStatus === 'function') {
        consignacao = await uow.consignacao.atualizarSeStatus(atual.id, STATUS_RASCUNHO, patch);
        if (!consignacao) {
          const pos = await uow.consignacao.buscarPorId(atual.id);
          const posEleg = avaliarElegibilidadeCancelamento(pos);
          if (posEleg.idempotente) {
            return {
              consignacao: pos,
              correlationId,
              idempotente: true,
              cancelamento: extrairCancelamento(pos),
              mensagem: MENSAGEM_JA_CANCELADA
            };
          }
          throw new DomainError(posEleg.mensagem || 'Falha ao cancelar consignação', {
            codigo: posEleg.codigo || 'CONSIGNACAO_NAO_ESTA_EM_RASCUNHO',
            detalhes: { consignacaoId: atual.id, statusAtual: pos?.status }
          });
        }
      } else {
        consignacao = await uow.consignacao.atualizar(atual.id, patch);
      }

      // ZERO efeitos: sem outbox estoque, sem ledger, sem crédito
      enfileirarEvento(eventos, EVENTOS_DOMINIO.CONSIGNACAO_CANCELADA, consignacao.id, {
        consignacao,
        motivo,
        motivoLabel: MOTIVOS_CANCELAMENTO[motivo] || motivo,
        observacao: observacaoLivre,
        usuarioId,
        dataCancelamento: agora,
        correlationId,
        efeitos: {
          estoque: false,
          ledger: false,
          credito: false,
          fiscal: false,
          prestacao: false,
          entrega: false
        }
      }, correlationId);

      return {
        consignacao,
        correlationId,
        idempotente: false,
        cancelamento: extrairCancelamento(consignacao),
        mensagem: 'Consignação cancelada com sucesso.'
      };
    });
  }
}

module.exports = CancelarConsignacaoRascunhoUseCase;
module.exports.PERMISSAO_CANCELAR_CONSIGNACAO = PERMISSAO_CANCELAR_CONSIGNACAO;
