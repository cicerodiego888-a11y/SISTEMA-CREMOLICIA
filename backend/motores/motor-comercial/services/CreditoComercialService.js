/**
 * CreditoComercialService — SSOT da regra oficial de crédito comercial CDS.
 *
 * Limite Comercial: valor fixo (só altera com usuário autorizado).
 * Crédito Disponível = Limite Comercial − Saldo Devedor Atual
 *
 * Saldo Devedor Atual =
 *   max(0, vendas − pagamentos)                         → Conta Corrente (AR)
 * + max(0, entregas − devoluções − vendas − perdas − cortesias) → estoque consignado
 *
 * Saldo Credor = max(0, pagamentos − vendas)
 * Crédito Disponível nunca ultrapassa o Limite Comercial.
 *
 * @module motores/motor-comercial/services/CreditoComercialService
 */

const { ordenarCronologicamente } = require('./projections/projectionHelpers');

const TIPOS = Object.freeze({
  ENTREGA: 'ENTREGA',
  DEVOLUCAO: 'DEVOLUCAO',
  VENDA: 'VENDA_PRESTACAO',
  PERDA: 'PERDA',
  CORTESIA: 'CORTESIA',
  PAGAMENTO: 'PAGAMENTO'
});

/**
 * Soma valores por tipo de movimentação comercial.
 * @param {Object[]} movimentacoes
 * @param {string} tipo
 * @returns {number}
 */
function somarTipo(movimentacoes, tipo) {
  return (movimentacoes || []).reduce((acc, mov) => {
    if (String(mov.tipoMovimentacao || '') !== tipo) return acc;
    return acc + Number(mov.valor ?? 0);
  }, 0);
}

/**
 * Calcula métricas oficiais a partir do ledger comercial.
 *
 * @param {Object} params
 * @param {number} params.limiteComercial
 * @param {Object[]} [params.movimentacoes]
 * @returns {{
 *   limiteComercial: number,
 *   saldoDevedor: number,
 *   saldoCredor: number,
 *   creditoDisponivel: number,
 *   saldoEmAbertoContaCorrente: number,
 *   estoqueConsignado: number,
 *   totalVendido: number,
 *   totalPago: number,
 *   totalEntregue: number
 * }}
 */
function calcular({ limiteComercial = 0, movimentacoes = [], perdaAssumidaCliente = 0 } = {}) {
  const ordenadas = ordenarCronologicamente(movimentacoes || []);
  const totalEntregue = somarTipo(ordenadas, TIPOS.ENTREGA);
  const totalDevolvido = somarTipo(ordenadas, TIPOS.DEVOLUCAO);
  const totalVendido = somarTipo(ordenadas, TIPOS.VENDA);
  const totalPerdido = somarTipo(ordenadas, TIPOS.PERDA);
  const totalCortesia = somarTipo(ordenadas, TIPOS.CORTESIA);
  const totalPago = somarTipo(ordenadas, TIPOS.PAGAMENTO);
  const perdaCliente = Number(perdaAssumidaCliente || 0);

  // RC4.2 — parcela da perda assumida pelo cliente entra na AR comercial
  const saldoEmAbertoContaCorrente = totalVendido + perdaCliente - totalPago;
  const saldoDevedorAr = Math.max(0, saldoEmAbertoContaCorrente);
  const saldoCredor = Math.max(0, -saldoEmAbertoContaCorrente);
  const estoqueConsignado = Math.max(
    0,
    totalEntregue - totalDevolvido - totalVendido - totalPerdido - totalCortesia
  );
  const saldoDevedor = saldoDevedorAr + estoqueConsignado;

  const limite = Number(limiteComercial) || 0;
  const creditoDisponivel = Math.max(0, limite - saldoDevedor);

  return {
    limiteComercial: limite,
    saldoDevedor,
    saldoCredor,
    creditoDisponivel,
    saldoEmAbertoContaCorrente,
    estoqueConsignado,
    totalVendido,
    totalPago,
    totalEntregue
  };
}

/**
 * Alias histórico: saldo aberto do perfil = Saldo Devedor oficial.
 * @param {Object[]} movimentacoes
 * @returns {number}
 */
function derivarSaldoDevedor(movimentacoes) {
  return calcular({ limiteComercial: 0, movimentacoes }).saldoDevedor;
}

/**
 * @param {number} creditoDisponivel
 * @param {number} valorEntrega
 * @returns {boolean}
 */
function podeEntregar(creditoDisponivel, valorEntrega) {
  const credito = Number(creditoDisponivel) || 0;
  const valor = Number(valorEntrega) || 0;
  if (valor <= 0) return true;
  return valor <= credito;
}

/**
 * Payload de auditoria CREDITO_COMERCIAL_RECALCULADO.
 * @param {Object} metricas
 * @param {Object} [meta]
 * @returns {Object}
 */
function montarAuditoriaRecalculo(metricas, meta = {}) {
  return {
    acao: 'CREDITO_COMERCIAL_RECALCULADO',
    clienteId: meta.clienteId ?? null,
    perfilComercialId: meta.perfilComercialId ?? null,
    limiteComercial: metricas.limiteComercial,
    saldoDevedor: metricas.saldoDevedor,
    saldoCredor: metricas.saldoCredor,
    creditoDisponivel: metricas.creditoDisponivel,
    origem: meta.origem || 'SISTEMA',
    consignacaoId: meta.consignacaoId ?? null,
    dataHora: meta.dataHora || new Date().toISOString()
  };
}

class CreditoComercialService {
  /**
   * @param {Object} [deps]
   * @param {Object} [deps.perfilComercialRepository]
   * @param {Object} [deps.consignacaoRepository]
   * @param {Object} [deps.movimentacaoComercialRepository]
   * @param {Function} [deps.gravarAuditoria]
   */
  constructor(deps = {}) {
    this._perfilRepo = deps.perfilComercialRepository ?? null;
    this._consignacaoRepo = deps.consignacaoRepository ?? null;
    this._movRepo = deps.movimentacaoComercialRepository ?? null;
    this._gravarAuditoria = deps.gravarAuditoria ?? null;
  }

  calcular(params) {
    return calcular(params);
  }

  /**
   * @param {import('../infrastructure/transactions/UnitOfWork')|null} uow
   * @param {number|string} perfilComercialId
   * @param {Object} [options]
   * @returns {Promise<Object>}
   */
  async calcularParaPerfil(uow, perfilComercialId, options = {}) {
    const perfilRepo = uow?.perfilComercial ?? this._perfilRepo;
    const consignacaoRepo = uow?.consignacao ?? this._consignacaoRepo;
    const movRepo = uow?.movimentacaoComercial ?? this._movRepo;

    if (!perfilRepo || !movRepo) {
      throw new Error('CreditoComercialService: repositórios não configurados');
    }

    const perfil = await perfilRepo.buscarPorId(perfilComercialId);
    if (!perfil) {
      throw new Error(`Perfil comercial ${perfilComercialId} não encontrado`);
    }

    const { carregarMovimentacoesComerciaisPerfil } = require('./projections/ledgerCacheDerivation');
    const uowLike = uow || {
      perfilComercial: perfilRepo,
      consignacao: consignacaoRepo,
      movimentacaoComercial: movRepo
    };
    const movimentacoes = await carregarMovimentacoesComerciaisPerfil(uowLike, perfilComercialId);

    const metricas = calcular({
      limiteComercial: Number(perfil.limiteComercial ?? 0),
      movimentacoes
    });

    if (options.auditar) {
      await this._auditar(metricas, {
        clienteId: perfil.clienteId,
        perfilComercialId: perfil.id,
        origem: options.origem || 'SISTEMA',
        consignacaoId: options.consignacaoId ?? null,
        usuarioId: options.usuarioId ?? null
      });
    }

    return {
      perfilComercialId: perfil.id,
      clienteId: perfil.clienteId,
      ...metricas,
      saldoAberto: metricas.saldoDevedor,
      limiteDisponivel: metricas.creditoDisponivel
    };
  }

  async _auditar(metricas, meta) {
    const payload = montarAuditoriaRecalculo(metricas, meta);
    if (typeof this._gravarAuditoria === 'function') {
      try {
        await this._gravarAuditoria({
          usuario_id: meta.usuarioId ?? null,
          modulo: 'motor-comercial',
          acao: 'CREDITO_COMERCIAL_RECALCULADO',
          referencia_tipo: 'perfil_comercial',
          referencia_id: meta.perfilComercialId,
          detalhes: payload
        });
      } catch (_error) {
        /* auditoria não deve interromper o fluxo operacional */
      }
      return;
    }

    // Fallback: evento de domínio enfileirável pelo caller
    return payload;
  }
}

CreditoComercialService.calcular = calcular;
CreditoComercialService.derivarSaldoDevedor = derivarSaldoDevedor;
CreditoComercialService.podeEntregar = podeEntregar;
CreditoComercialService.montarAuditoriaRecalculo = montarAuditoriaRecalculo;
CreditoComercialService.TIPOS = TIPOS;

module.exports = CreditoComercialService;
