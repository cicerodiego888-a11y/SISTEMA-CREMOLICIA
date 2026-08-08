/**
 * Fluxo único oficial de crédito comercial (STAB-02).
 *
 * Cada operação gera exatamente:
 * 1 cálculo (CreditoComercialService)
 * 1 sincronização de cache (perfil.saldo_aberto)
 * 1 evento de domínio CREDITO_COMERCIAL_RECALCULADO
 * 1 auditoria CREDITO_COMERCIAL_RECALCULADO
 *
 * @module motores/motor-comercial/services/sincronizarCreditoComercial
 */

const CreditoComercialService = require('./CreditoComercialService');
const { EVENTOS_DOMINIO } = require('../events/comercialEventosTipos');
const { enfileirarEvento } = require('../usecases/consignacao/consignacaoUseCaseHelpers');
const { carregarMovimentacoesComerciaisPerfil } = require('./projections/ledgerCacheDerivation');

/**
 * @param {import('../infrastructure/transactions/UnitOfWork')} uow
 * @param {Array} eventos
 * @param {Object} consignacao
 * @param {Object} options
 * @param {string} options.origem
 * @param {string} [options.correlationId]
 * @param {string|number|null} [options.usuarioId]
 * @returns {Promise<Object>} métricas oficiais
 */
async function sincronizarCreditoComercial(uow, eventos, consignacao, options = {}) {
  const perfilComercialId = consignacao?.perfilComercialId;
  if (perfilComercialId == null) {
    throw new Error('sincronizarCreditoComercial: perfilComercialId obrigatório');
  }

  const origem = options.origem || 'SISTEMA';
  const correlationId = options.correlationId || null;
  const usuarioId = options.usuarioId ?? null;

  const movimentacoes = await carregarMovimentacoesComerciaisPerfil(uow, perfilComercialId);
  const perfil = await uow.perfilComercial.buscarPorId(perfilComercialId);
  const metricas = CreditoComercialService.calcular({
    limiteComercial: Number(perfil?.limiteComercial ?? 0),
    movimentacoes,
    perdaAssumidaCliente: Number(options.perdaAssumidaCliente || 0)
  });

  // 1 sync de cache — única escrita de saldo_aberto
  await uow.perfilComercial.atualizar(perfilComercialId, {
    saldoAberto: metricas.saldoDevedor
  });

  const auditoria = CreditoComercialService.montarAuditoriaRecalculo(metricas, {
    clienteId: consignacao.clienteId ?? perfil?.clienteId ?? null,
    perfilComercialId,
    origem,
    consignacaoId: consignacao.id ?? null
  });

  // 1 evento de domínio
  if (Array.isArray(eventos)) {
    enfileirarEvento(
      eventos,
      EVENTOS_DOMINIO.CREDITO_COMERCIAL_RECALCULADO,
      perfilComercialId,
      { ...auditoria, correlationId },
      correlationId
    );
  }

  // 1 auditoria persistida
  try {
    const { gravarAuditoria } = require('../../../services/auditoria');
    await gravarAuditoria({
      usuario_id: usuarioId,
      modulo: 'motor-comercial',
      acao: 'CREDITO_COMERCIAL_RECALCULADO',
      referencia_tipo: 'perfil_comercial',
      referencia_id: perfilComercialId,
      detalhes: auditoria
    });
  } catch (_err) {
    /* auditoria não bloqueia operação */
  }

  return {
    ...metricas,
    saldoAberto: metricas.saldoDevedor,
    limiteDisponivel: metricas.creditoDisponivel
  };
}

module.exports = {
  sincronizarCreditoComercial
};
