/**
 * Helpers compartilhados dos Projection Services.
 *
 * Sprint 2.4.4: projeções derivadas exclusivamente do Ledger.
 *
 * @module motores/motor-comercial/services/projections/projectionHelpers
 */

const { obterTipoMovimentacao } = require('../../config/comercialTiposMovimentacao');
const { calcularTotaisPrestacao } = require('../../usecases/consignacao/prestacaoOperacaoHelpers');
const { prestacaoEstaAberta } = require('../../usecases/consignacao/consignacaoOperacaoHelpers');

const TIMELINE_LABELS = Object.freeze({
  ENTREGA: 'Entrega',
  DEVOLUCAO: 'Devolução',
  ABERTURA_PRESTACAO: 'Prestação aberta',
  VENDA_PRESTACAO: 'Venda',
  PERDA: 'Perda',
  CORTESIA: 'Cortesia',
  PAGAMENTO: 'Pagamento',
  FECHAMENTO_PRESTACAO: 'Fechamento da prestação',
  REABERTURA_PRESTACAO: 'Reabertura da prestação',
  ENCERRAMENTO: 'Encerramento',
  CANCELAMENTO: 'Cancelamento',
  TRANSFERENCIA_SAIDA: 'Transferência (saída)',
  TRANSFERENCIA_ENTRADA: 'Transferência (entrada)',
  AJUSTE_VALOR: 'Ajuste de valor',
  ESTORNO: 'Estorno'
});

const TIPOS_FINANCEIROS = Object.freeze({
  VENDA: 'VENDA_PRESTACAO',
  PERDA: 'PERDA',
  CORTESIA: 'CORTESIA',
  PAGAMENTO: 'PAGAMENTO',
  DEVOLUCAO: 'DEVOLUCAO',
  ENTREGA: 'ENTREGA'
});

/**
 * @param {Object[]} movimentacoes
 * @param {string} flag
 * @returns {Object[]}
 */
function filtrarPorFlag(movimentacoes, flag) {
  return movimentacoes.filter((m) => {
    const meta = obterTipoMovimentacao(m.tipoMovimentacao);
    return meta?.[flag] === true;
  });
}

/**
 * @param {Object[]} movimentacoes
 * @param {ProjectionContext} contexto
 * @returns {Object[]}
 */
function aplicarFiltrosLocais(movimentacoes, contexto) {
  return movimentacoes.filter((m) => {
    if (contexto.usuarioId != null && m.usuarioId !== contexto.usuarioId) return false;
    if (contexto.origem && m.origem !== contexto.origem) return false;
    if (contexto.grupoPrestacaoContasId && m.grupoPrestacaoContasId !== contexto.grupoPrestacaoContasId) {
      return false;
    }
    return true;
  });
}

/**
 * @param {Object[]} movimentacoes
 * @param {string} [ordenacao]
 * @returns {Object[]}
 */
function ordenarCronologicamente(movimentacoes, ordenacao = 'ASC') {
  const sorted = [...movimentacoes].sort((a, b) => {
    const da = new Date(a.dataMovimentacao).getTime();
    const db = new Date(b.dataMovimentacao).getTime();
    if (da !== db) return da - db;
    return Number(a.id) - Number(b.id);
  });
  return ordenacao === 'DESC' ? sorted.reverse() : sorted;
}

/**
 * @param {Object[]} movimentacoes
 * @param {number|null} limite
 * @param {number} offset
 * @returns {{ itens: Object[], paginacao: Object }}
 */
function paginar(movimentacoes, limite = null, offset = 0) {
  const total = movimentacoes.length;
  const inicio = Number(offset) || 0;
  const fim = limite != null ? inicio + Number(limite) : total;
  return {
    itens: movimentacoes.slice(inicio, fim),
    paginacao: {
      total,
      limite: limite ?? total,
      offset: inicio,
      possuiMais: fim < total
    }
  };
}

/**
 * @param {Object[]} movimentacoes
 * @param {string} tipo
 * @returns {number}
 */
function somarPorTipo(movimentacoes, tipo) {
  return movimentacoes
    .filter((m) => m.tipoMovimentacao === tipo)
    .reduce((sum, m) => sum + Number(m.valor ?? 0), 0);
}

/**
 * @param {Object[]} movimentacoes
 * @param {string} [dataCorte]
 * @returns {number}
 */
function calcularSaldoContaCorrente(movimentacoes, dataCorte = null) {
  const filtradas = dataCorte
    ? movimentacoes.filter((m) => new Date(m.dataMovimentacao) < new Date(dataCorte))
    : movimentacoes;

  const vendas = somarPorTipo(filtradas, TIPOS_FINANCEIROS.VENDA);
  const pagamentos = somarPorTipo(filtradas, TIPOS_FINANCEIROS.PAGAMENTO);
  return vendas - pagamentos;
}

/**
 * @param {Object[]} movimentacoes
 * @returns {Object}
 */
function calcularSaldosComerciais(movimentacoes) {
  const vendas = somarPorTipo(movimentacoes, TIPOS_FINANCEIROS.VENDA);
  const pagamentos = somarPorTipo(movimentacoes, TIPOS_FINANCEIROS.PAGAMENTO);
  const devolucoes = somarPorTipo(movimentacoes, TIPOS_FINANCEIROS.DEVOLUCAO);
  const perdas = somarPorTipo(movimentacoes, TIPOS_FINANCEIROS.PERDA);
  const cortesias = somarPorTipo(movimentacoes, TIPOS_FINANCEIROS.CORTESIA);
  const entregas = somarPorTipo(movimentacoes, TIPOS_FINANCEIROS.ENTREGA);

  return {
    saldoEmAberto: vendas - pagamentos,
    saldoVendido: vendas,
    saldoRecebido: pagamentos,
    saldoDevolvido: devolucoes,
    saldoPerdido: perdas,
    saldoCortesia: cortesias,
    saldoConsignado: entregas - devolucoes - vendas - perdas - cortesias
  };
}

/**
 * @param {Object[]} movimentacoes
 * @returns {Object}
 */
function calcularIndicadoresComerciais(movimentacoes) {
  const entregas = somarPorTipo(movimentacoes, TIPOS_FINANCEIROS.ENTREGA);
  const vendas = somarPorTipo(movimentacoes, TIPOS_FINANCEIROS.VENDA);
  const perdas = somarPorTipo(movimentacoes, TIPOS_FINANCEIROS.PERDA);
  const gruposPrestacao = new Set(
    movimentacoes
      .filter((m) => m.tipoMovimentacao === 'ABERTURA_PRESTACAO' && m.grupoPrestacaoContasId)
      .map((m) => m.grupoPrestacaoContasId)
  );
  const consignacoes = new Set(movimentacoes.map((m) => m.consignacaoId).filter(Boolean));

  const percentualPerda = entregas > 0 ? (perdas / entregas) * 100 : 0;
  const percentualConversao = entregas > 0 ? (vendas / entregas) * 100 : 0;
  const quantidadeVendas = movimentacoes.filter((m) => m.tipoMovimentacao === TIPOS_FINANCEIROS.VENDA).length;
  const ticketMedio = quantidadeVendas > 0 ? vendas / quantidadeVendas : 0;

  return {
    valorConsignado: entregas,
    valorVendido: vendas,
    valorPerdido: perdas,
    percentualPerda,
    percentualConversao,
    ticketMedio,
    quantidadePrestacoes: gruposPrestacao.size,
    quantidadeConsignacoes: consignacoes.size
  };
}

/**
 * @param {Object} movimentacao
 * @returns {Object}
 */
function mapearEventoTimeline(movimentacao) {
  return {
    id: movimentacao.id,
    tipo: movimentacao.tipoMovimentacao,
    rotulo: TIMELINE_LABELS[movimentacao.tipoMovimentacao] ?? movimentacao.tipoMovimentacao,
    data: movimentacao.dataMovimentacao,
    valor: movimentacao.valor,
    quantidade: movimentacao.quantidade,
    consignacaoId: movimentacao.consignacaoId,
    grupoPrestacaoContasId: movimentacao.grupoPrestacaoContasId,
    correlationId: movimentacao.correlationId,
    origem: movimentacao.origem
  };
}

/**
 * @param {import('../../domain/contracts/repositories/IMovimentacaoComercialRepository')} repo
 * @param {import('./ProjectionContext')} contexto
 * @returns {Promise<Object[]>}
 */
async function listarMovimentacoesComerciais(repo, contexto) {
  if (!repo) return [];
  const movimentacoes = await repo.listar(contexto.toFiltrosComercial());
  return aplicarFiltrosLocais(movimentacoes, contexto);
}

/**
 * @param {import('../../domain/contracts/repositories/IMovimentacaoPerfilRepository')} repo
 * @param {import('./ProjectionContext')} contexto
 * @returns {Promise<Object[]>}
 */
async function listarMovimentacoesPerfil(repo, contexto) {
  if (!repo) return [];
  return repo.listar(contexto.toFiltrosPerfil());
}

/**
 * @param {Object[]} consignacoes
 * @returns {Object[]}
 */
function filtrarConsignacoesAbertas(consignacoes) {
  return consignacoes.filter((c) => c.status === 'ENTREGUE');
}

/**
 * @param {Object[]} movimentacoes
 * @param {string} tipo
 * @returns {Object|null}
 */
function obterUltimaMovimentacaoPorTipo(movimentacoes, tipo) {
  const filtradas = movimentacoes.filter((m) => m.tipoMovimentacao === tipo);
  if (!filtradas.length) return null;
  return ordenarCronologicamente(filtradas, 'DESC')[0];
}

module.exports = {
  TIMELINE_LABELS,
  TIPOS_FINANCEIROS,
  filtrarPorFlag,
  aplicarFiltrosLocais,
  ordenarCronologicamente,
  paginar,
  somarPorTipo,
  calcularSaldoContaCorrente,
  calcularSaldosComerciais,
  calcularIndicadoresComerciais,
  calcularTotaisPrestacao,
  mapearEventoTimeline,
  listarMovimentacoesComerciais,
  listarMovimentacoesPerfil,
  filtrarConsignacoesAbertas,
  obterUltimaMovimentacaoPorTipo,
  prestacaoEstaAberta
};
