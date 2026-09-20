/**
 * Derivação de campos cache a partir do Ledger Comercial.
 *
 * Sprint P-1 + P0 Crédito Comercial: Ledger como única fonte oficial.
 * Saldo aberto do perfil = Saldo Devedor oficial (CreditoComercialService).
 *
 * @module motores/motor-comercial/services/projections/ledgerCacheDerivation
 */

const { ordenarCronologicamente } = require('./projectionHelpers');
const CreditoComercialService = require('../CreditoComercialService');

/** @deprecated tipos legados — consumo/liberação agora derivados pela fórmula oficial */
const TIPOS_CONSUMO_LIMITE = Object.freeze(['ENTREGA']);
const TIPOS_LIBERACAO_LIMITE = Object.freeze(['DEVOLUCAO', 'VENDA_PRESTACAO', 'PAGAMENTO']);

/**
 * Saldo Devedor Atual (oficial CDS).
 * @param {Object[]} movimentacoes
 * @returns {number}
 */
function derivarSaldoAbertoPerfil(movimentacoes) {
  return CreditoComercialService.derivarSaldoDevedor(movimentacoes);
}

/**
 * Reproduz a lógica incremental dos Use Cases para campos cache da consignação.
 *
 * @param {Object[]} movimentacoes
 * @returns {{ valorTotalEntregue: number, valorTotalAcertado: number, valorTotalPago: number, saldoAberto: number }}
 */
function derivarCamposCacheConsignacao(movimentacoes) {
  let valorTotalEntregue = 0;
  let valorTotalAcertado = 0;
  let valorTotalPago = 0;
  let saldoAberto = 0;

  const ordenadas = ordenarCronologicamente(movimentacoes);
  for (let i = 0; i < ordenadas.length; i += 1) {
    const mov = ordenadas[i];
    const valor = Number(mov.valor ?? 0);

    switch (mov.tipoMovimentacao) {
      case 'ENTREGA':
        valorTotalEntregue += valor;
        saldoAberto = valorTotalEntregue;
        break;
      case 'DEVOLUCAO':
        saldoAberto = Math.max(0, saldoAberto - valor);
        break;
      case 'VENDA_PRESTACAO':
        valorTotalAcertado += valor;
        saldoAberto += valor;
        break;
      case 'PAGAMENTO':
        valorTotalPago += valor;
        saldoAberto = Math.max(0, saldoAberto - valor);
        break;
      case 'FECHAMENTO_PRESTACAO': {
        const { calcularTotaisPrestacao } = require('../../usecases/consignacao/prestacaoOperacaoHelpers');
        const totais = calcularTotaisPrestacao(
          ordenadas.slice(0, i + 1),
          mov.grupoPrestacaoContasId ?? null
        );
        valorTotalAcertado = totais.totalVendido;
        saldoAberto = totais.saldo;
        break;
      }
      default:
        break;
    }
  }

  return {
    valorTotalEntregue,
    valorTotalAcertado,
    valorTotalPago,
    saldoAberto
  };
}

/**
 * @param {import('../../infrastructure/transactions/UnitOfWork')} uow
 * @param {number|string} perfilComercialId
 * @returns {Promise<Object[]>}
 */
async function carregarMovimentacoesComerciaisPerfil(uow, perfilComercialId) {
  const movRepo = uow.movimentacaoComercial;
  if (typeof movRepo.listarPorPerfilComercialId === 'function') {
    return movRepo.listarPorPerfilComercialId(perfilComercialId);
  }

  // Fallback N+1 (mocks / repositórios legados sem agregação)
  const consignacoes = await uow.consignacao.listar({ perfilComercialId });
  const movimentacoes = [];
  for (const consignacao of consignacoes) {
    const movs = await uow.movimentacaoComercial.listar({ consignacaoId: consignacao.id });
    movimentacoes.push(...movs);
  }
  return movimentacoes;
}

/**
 * @param {import('../../infrastructure/transactions/UnitOfWork')} uow
 * @param {number|string} consignacaoId
 * @returns {Promise<Object[]>}
 */
async function carregarMovimentacoesConsignacao(uow, consignacaoId) {
  return uow.movimentacaoComercial.listar({ consignacaoId });
}

module.exports = {
  TIPOS_CONSUMO_LIMITE,
  TIPOS_LIBERACAO_LIMITE,
  derivarSaldoAbertoPerfil,
  derivarCamposCacheConsignacao,
  carregarMovimentacoesComerciaisPerfil,
  carregarMovimentacoesConsignacao
};
