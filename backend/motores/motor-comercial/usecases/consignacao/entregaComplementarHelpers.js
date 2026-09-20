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
 * Agrupa movimentações ENTREGA por correlationId (evento de entrega).
 * @param {Object[]} movimentacoes
 * @param {Object[]} [itens]
 * @returns {Array<{
 *   tipo: 'ORIGINAL'|'COMPLEMENTAR',
 *   sequencia: number,
 *   label: string,
 *   correlationId: string|null,
 *   dataHora: string|null,
 *   valorTotal: number,
 *   itens: Object[],
 *   usuarioId: string|null
 * }>}
 */
function montarHistoricoEntregas(movimentacoes = [], itens = []) {
  const itensById = new Map(
    (itens || []).map((item) => [String(item.id), item])
  );

  const entregas = (movimentacoes || []).filter((mov) => {
    const tipo = String(mov.tipoMovimentacao || mov.tipo || '').toUpperCase();
    return tipo === 'ENTREGA';
  });

  const grupos = new Map();
  for (const mov of entregas) {
    const key = String(mov.correlationId || mov.id || `mov-${grupos.size}`);
    if (!grupos.has(key)) grupos.set(key, []);
    grupos.get(key).push(mov);
  }

  const ordenados = [...grupos.entries()].sort((a, b) => {
    const ta = _ts(a[1][0]);
    const tb = _ts(b[1][0]);
    return ta - tb;
  });

  let seqComplementar = 0;
  return ordenados.map((entry, index) => {
    const [correlationId, movs] = entry;
    const snapOp = String(
      movs[0]?.snapshot?.contexto?.operacao
      || movs[0]?.snapshot?.operacao
      || ''
    ).toUpperCase();
    const isComplementar = snapOp === OPERACAO_ENTREGA_COMPLEMENTAR
      || (index > 0 && snapOp !== OPERACAO_ENTREGA_ORIGINAL);

    if (isComplementar) seqComplementar += 1;
    const sequencia = isComplementar ? seqComplementar : 0;
    const label = isComplementar
      ? `Entrega Complementar ${String(sequencia).padStart(2, '0')}`
      : 'Entrega Original';

    const itensEvento = movs.map((mov) => {
      const itemId = mov.consignacaoItemId || mov.snapshot?.item?.id;
      const item = itemId != null ? itensById.get(String(itemId)) : null;
      return {
        itemId: itemId ?? null,
        produtoId: item?.produtoId
          ?? mov.snapshot?.item?.produtoId
          ?? mov.produtoId
          ?? null,
        produtoNome: item?.produtoNome || item?.produto || null,
        quantidade: Number(mov.quantidade ?? item?.quantidadeEntregue ?? 0),
        precoUnitario: Number(item?.precoUnitario ?? mov.snapshot?.item?.precoUnitario ?? 0),
        valor: Number(mov.valor ?? 0),
        unidadeComercial: item?.unidadeComercial || null,
        linhaComercialId: item?.linhaComercialId ?? null,
        tabelaPrecoId: item?.tabelaPrecoId ?? null,
        canalVenda: item?.canalVenda || null,
        precoOrigem: item?.precoOrigem || null,
        precoFallback: item?.precoFallback ?? null
      };
    });

    const valorTotal = itensEvento.reduce((s, i) => s + Number(i.valor || 0), 0);
    const dataHora = movs[0]?.createdAt
      || movs[0]?.dataHora
      || movs[0]?.snapshot?.capturadoEm
      || null;

    return {
      tipo: isComplementar ? 'COMPLEMENTAR' : 'ORIGINAL',
      sequencia,
      label,
      correlationId: correlationId === 'sem-correlation' ? null : correlationId,
      dataHora,
      valorTotal,
      itens: itensEvento,
      usuarioId: movs[0]?.usuarioId || null
    };
  });
}

function _ts(mov) {
  const raw = mov?.createdAt || mov?.dataHora || mov?.snapshot?.capturadoEm;
  const t = raw ? new Date(raw).getTime() : 0;
  return Number.isFinite(t) ? t : 0;
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
