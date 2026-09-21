/**
 * RCM-8.7 — Helpers de Entrega Complementar (sem reabrir consignação).
 *
 * @module motores/motor-comercial/usecases/consignacao/entregaComplementarHelpers
 */

const { STATUS_ENTREGUE } = require('./consignacaoUseCaseHelpers');

const MENSAGEM_PRESTACAO_ENCERRADA =
  'Esta consignação já possui prestação encerrada. Para adicionar novos produtos, inicie uma nova consignação.';

const STATUS_TERMINAIS = Object.freeze([
  'QUITADA',
  'ENCERRADA',
  'CANCELADA',
  'ACERTADA',
  'FECHADA'
]);

const OPERACAO_ENTREGA_ORIGINAL = 'ENTREGA';
const OPERACAO_ENTREGA_COMPLEMENTAR = 'ENTREGA_COMPLEMENTAR';

/**
 * @param {Object|null} consignacao
 * @returns {{ elegivel: boolean, codigo: string|null, mensagem: string|null }}
 */
function avaliarElegibilidadeEntregaComplementar(consignacao) {
  if (!consignacao) {
    return {
      elegivel: false,
      codigo: 'CONSIGNACAO_NAO_ENCONTRADA',
      mensagem: 'Consignação não encontrada'
    };
  }

  const status = String(consignacao.status || '').toUpperCase();
  const prestacao = consignacao.prestacaoContasAtiva
    || consignacao.prestacaoContas
    || {};
  const prestStatus = String(prestacao.status || '').toUpperCase();

  if (STATUS_TERMINAIS.includes(status) || ['FECHADA', 'ENCERRADA'].includes(prestStatus)) {
    return {
      elegivel: false,
      codigo: 'ENTREGA_COMPLEMENTAR_BLOQUEADA',
      mensagem: MENSAGEM_PRESTACAO_ENCERRADA
    };
  }

  if (status !== STATUS_ENTREGUE) {
    return {
      elegivel: false,
      codigo: 'CONSIGNACAO_NAO_ENTREGUE',
      mensagem: `Entrega complementar só é permitida em consignação ENTREGUE (atual: ${status || '—'})`
    };
  }

  return { elegivel: true, codigo: null, mensagem: null };
}

/**
 * Agrupa movimentações ENTREGA / ALTERAÇÃO por correlationId (evento de entrega).
 * RCM-8.13 — numeração 001/002/003 + comprovante completo por evento.
 * @param {Object[]} movimentacoes
 * @param {Object[]} [itens]
 * @returns {Array<Object>}
 */
function montarHistoricoEntregas(movimentacoes = [], itens = []) {
  const {
    montarHistoricoEntregasAtualizado
  } = require('./atualizacaoEntregaHelpers');
  return montarHistoricoEntregasAtualizado(movimentacoes, itens);
}

/**
 * Resolve snapshot RCM-6.1 a partir do bridge + payload do cliente.
 * @param {Object} produto
 * @param {Object} linha
 * @returns {Object}
 */
function montarSnapshotPrecificacaoItem(produto = {}, linha = {}) {
  const CANAL = 'CONSIGNADO';
  const clienteTrouxeSnapshot = !!(
    linha.precoOrigem
    || linha.preco_origem
    || linha.tabelaPrecoId
    || linha.tabela_preco_id
  );

  const precoBridge = Number(produto.precoVenda ?? produto.preco ?? 0);
  const precoCliente = linha.precoUnitario != null && linha.precoUnitario !== ''
    ? Number(linha.precoUnitario)
    : null;

  const precoUnitario = clienteTrouxeSnapshot && Number.isFinite(precoCliente) && precoCliente >= 0
    ? precoCliente
    : (Number.isFinite(precoBridge) && precoBridge >= 0 ? precoBridge : (precoCliente || 0));

  const unidadeComercial = String(
    linha.unidadeComercial
    || linha.unidade_comercial
    || produto.unidadeComercial
    || produto.unidade
    || 'UN'
  ).trim().toUpperCase() || 'UN';

  const linhaComercialId = linha.linhaComercialId
    ?? linha.linha_comercial_id
    ?? produto.linhaComercialId
    ?? null;

  const tabelaPrecoId = linha.tabelaPrecoId
    ?? linha.tabela_preco_id
    ?? produto.tabelaPrecoId
    ?? null;

  const canalVenda = String(
    linha.canalVenda || linha.canal_venda || linha.canal || produto.canalVenda || CANAL
  ).trim().toUpperCase() || CANAL;

  const precoOrigem = linha.precoOrigem
    ?? linha.preco_origem
    ?? produto.precoOrigem
    ?? null;

  const precoFallbackRaw = linha.precoFallback ?? linha.preco_fallback ?? produto.precoFallback;
  const precoFallback = precoFallbackRaw === true
    || precoFallbackRaw === 1
    || String(precoFallbackRaw).toLowerCase() === 'true';

  return {
    precoUnitario,
    unidadeComercial,
    linhaComercialId: linhaComercialId != null && Number(linhaComercialId) > 0
      ? Number(linhaComercialId)
      : null,
    tabelaPrecoId: tabelaPrecoId != null && Number(tabelaPrecoId) > 0
      ? Number(tabelaPrecoId)
      : null,
    canalVenda,
    precoOrigem,
    precoFallback
  };
}

module.exports = {
  MENSAGEM_PRESTACAO_ENCERRADA,
  STATUS_TERMINAIS,
  OPERACAO_ENTREGA_ORIGINAL,
  OPERACAO_ENTREGA_COMPLEMENTAR,
  avaliarElegibilidadeEntregaComplementar,
  montarHistoricoEntregas,
  montarSnapshotPrecificacaoItem
};
