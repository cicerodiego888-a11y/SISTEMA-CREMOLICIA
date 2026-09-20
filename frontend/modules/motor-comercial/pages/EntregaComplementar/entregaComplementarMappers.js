/**
 * RCM-8.7 — Mappers / regras de UI da Entrega Complementar.
 *
 * @module frontend/modules/motor-comercial/pages/EntregaComplementar/entregaComplementarMappers
 */

const MENSAGEM_PRESTACAO_ENCERRADA =
  'Esta consignação já possui prestação encerrada. Para adicionar novos produtos, inicie uma nova consignação.';

const STATUS_TERMINAIS = Object.freeze([
  'QUITADA',
  'ENCERRADA',
  'CANCELADA',
  'ACERTADA',
  'FECHADA'
]);

/**
 * @param {Object|null} consignacao
 * @returns {{ elegivel: boolean, mensagem: string|null }}
 */
function podeAdicionarProdutoComplementar(consignacao) {
  if (!consignacao) {
    return { elegivel: false, mensagem: 'Consignação não encontrada' };
  }
  const status = String(consignacao.status || '').toUpperCase();
  const prestacao = consignacao.prestacaoContasAtiva || consignacao.prestacaoContas || {};
  const prestStatus = String(prestacao.status || '').toUpperCase();

  if (STATUS_TERMINAIS.includes(status) || ['FECHADA', 'ENCERRADA'].includes(prestStatus)) {
    return {
      elegivel: false,
      mensagem: status === 'CANCELADA'
        ? 'Esta consignação foi cancelada. Para realizar uma nova entrega, crie uma nova consignação.'
        : MENSAGEM_PRESTACAO_ENCERRADA
    };
  }
  if (status !== 'ENTREGUE') {
    return {
      elegivel: false,
      mensagem: 'Entrega complementar disponível apenas para consignações ENTREGUE.'
    };
  }
  return { elegivel: true, mensagem: null };
}

/**
 * @param {Object[]} itens
 * @returns {number}
 */
function totalItensComplementares(itens = []) {
  return (itens || []).reduce((sum, item) => {
    const q = Number(item.quantidade || 0);
    const p = Number(item.precoUnitario ?? item.preco ?? 0);
    return sum + (q * p);
  }, 0);
}

/**
 * Snapshot RCM-6.1 a partir da linha do Resolver.
 * @param {Object} row
 * @param {Object} [produto]
 */
function snapshotDoResolver(row = {}, produto = {}) {
  return {
    precoUnitario: Number(row.preco ?? row.preco_unitario ?? produto.preco ?? 0),
    unidadeComercial: String(
      row.unidade_comercial || row.unidadeComercial || produto.unidadeComercial || produto.unidade || 'UN'
    ).toUpperCase(),
    linhaComercialId: row.linha_comercial_id ?? row.linhaComercialId ?? produto.linhaComercialId ?? null,
    tabelaPrecoId: row.tabela_preco_id ?? row.tabelaPrecoId ?? null,
    canalVenda: 'CONSIGNADO',
    precoOrigem: row.preco_origem || row.precoOrigem || null,
    precoFallback: Boolean(row.preco_fallback ?? row.precoFallback)
  };
}

module.exports = {
  MENSAGEM_PRESTACAO_ENCERRADA,
  STATUS_TERMINAIS,
  podeAdicionarProdutoComplementar,
  totalItensComplementares,
  snapshotDoResolver
};
