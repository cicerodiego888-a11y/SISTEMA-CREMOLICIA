/**
 * RCM-8.1 — Regras de edição operacional na tela de Entrega.
 * Quantidade pode mudar. Preço e snapshot RCM-6.1 permanecem.
 */

const STATUS_BLOQUEADOS = new Set([
  'ENTREGUE',
  'CANCELADA',
  'ACERTADA',
  'QUITADA',
  'ENCERRADA'
]);

const MENSAGEM_EDICAO_BLOQUEADA = 'Esta consignação não pode mais ser editada.';

function podeEditarItensEntrega(status) {
  return String(status || '').toUpperCase() === 'RASCUNHO';
}

function edicaoBloqueadaPorStatus(status) {
  const st = String(status || '').toUpperCase();
  return STATUS_BLOQUEADOS.has(st);
}

function itemUnidadeSnapshot(item = {}) {
  const uc = item.unidadeComercial || item.unidade || 'UN';
  return String(uc).trim().toUpperCase() || 'UN';
}

function itemPrecoSnapshot(item = {}) {
  const p = Number(item.precoUnitario ?? item.preco ?? item.valorUnitario ?? 0);
  return Number.isFinite(p) ? p : 0;
}

function itemQuantidade(item = {}) {
  const q = Number(item.quantidadeEntregue ?? item.quantidade ?? 0);
  return Number.isFinite(q) ? q : 0;
}

function itemTotalSnapshot(item = {}) {
  if (item.precoTotal != null && Number.isFinite(Number(item.precoTotal))) {
    return Number(item.precoTotal);
  }
  if (item.subtotalEntregue != null && Number.isFinite(Number(item.subtotalEntregue))) {
    return Number(item.subtotalEntregue);
  }
  return itemQuantidade(item) * itemPrecoSnapshot(item);
}

function totalEntrega(itens = []) {
  return (itens || []).reduce((acc, item) => acc + itemTotalSnapshot(item), 0);
}

function impactoLimite({ limite = 0, valorEntrega = 0 } = {}) {
  const lim = Number(limite) || 0;
  const valor = Number(valorEntrega) || 0;
  return {
    valorEntrega: valor,
    saldoAposEntrega: lim - valor,
    excede: lim > 0 && valor > lim
  };
}

const CAMPOS_SNAPSHOT = [
  'linhaComercialId',
  'tabelaPrecoId',
  'canalVenda',
  'unidadeComercial',
  'precoOrigem',
  'precoFallback',
  'precoUnitario'
];

function extrairSnapshot(item = {}) {
  return {
    linhaComercialId: item.linhaComercialId ?? null,
    tabelaPrecoId: item.tabelaPrecoId ?? null,
    canalVenda: item.canalVenda ? String(item.canalVenda).toUpperCase() : null,
    unidadeComercial: itemUnidadeSnapshot(item),
    precoOrigem: item.precoOrigem ?? null,
    precoFallback: !!item.precoFallback,
    precoUnitario: itemPrecoSnapshot(item)
  };
}

function snapshotPreservado(antes, depois) {
  const a = extrairSnapshot(antes);
  const d = extrairSnapshot(depois);
  return CAMPOS_SNAPSHOT.every((campo) => String(a[campo]) === String(d[campo]));
}

const UNIDADES_INTEIRAS = new Set(['UN', 'UND', 'UNID', 'UNIDADE', 'PC', 'PÇ', 'PEC', 'PECA', 'CX', 'DZ']);
const UNIDADES_DECIMAIS = new Set([
  'KG', 'G', 'GR', 'GRAMA', 'GRAMAS',
  'L', 'LT', 'LITRO', 'LITROS', 'ML',
  'M', 'MT', 'M2', 'M3'
]);

function unidadePermiteFracao(unidade) {
  const u = itemUnidadeSnapshot({ unidadeComercial: unidade });
  if (UNIDADES_DECIMAIS.has(u)) return true;
  if (UNIDADES_INTEIRAS.has(u)) return false;
  return true;
}

function validarQuantidadeEdicao(quantidade, unidade) {
  const qtd = Number(String(quantidade).replace(',', '.'));
  if (!Number.isFinite(qtd) || qtd <= 0) {
    return { ok: false, motivo: 'Quantidade deve ser maior que zero' };
  }
  if (!unidadePermiteFracao(unidade) && !Number.isInteger(qtd)) {
    return { ok: false, motivo: 'Esta unidade exige quantidade inteira' };
  }
  return { ok: true, quantidade: qtd };
}

function aplicarTrocaProduto(itemAtual = {}, produtoNovo = {}, quantidade) {
  const qtd = Number(quantidade);
  const preco = itemPrecoSnapshot(produtoNovo);
  const unidade = itemUnidadeSnapshot(produtoNovo);
  return aplicarQuantidadeLocal({
    ...itemAtual,
    produtoId: produtoNovo.produtoId ?? produtoNovo.id,
    produtoNome: produtoNovo.produtoNome || produtoNovo.produto || produtoNovo.nome,
    produto: produtoNovo.produtoNome || produtoNovo.produto || produtoNovo.nome,
    precoUnitario: preco,
    preco,
    unidadeComercial: unidade,
    unidade,
    linhaComercialId: produtoNovo.linhaComercialId ?? null,
    tabelaPrecoId: produtoNovo.tabelaPrecoId ?? null,
    canalVenda: produtoNovo.canalVenda || 'CONSIGNADO',
    precoOrigem: produtoNovo.precoOrigem ?? null,
    precoFallback: !!produtoNovo.precoFallback
  }, qtd);
}

function produtoJaExisteNaConsignacao(itens = [], produtoId, itemIdIgnorar = null) {
  return (itens || []).some((item) => {
    const mesmoProduto = Number(item.produtoId) === Number(produtoId);
    if (!mesmoProduto) return false;
    if (itemIdIgnorar == null) return true;
    return String(item.id || item.itemId) !== String(itemIdIgnorar);
  });
}

function aplicarQuantidadeLocal(item, novaQuantidade) {
  const preco = itemPrecoSnapshot(item);
  const qtd = Number(novaQuantidade);
  return {
    ...item,
    quantidade: qtd,
    quantidadeEntregue: qtd,
    precoUnitario: preco,
    preco,
    subtotalEntregue: qtd * preco,
    precoTotal: qtd * preco,
    unidadeComercial: itemUnidadeSnapshot(item),
    linhaComercialId: item.linhaComercialId,
    tabelaPrecoId: item.tabelaPrecoId,
    canalVenda: item.canalVenda,
    precoOrigem: item.precoOrigem,
    precoFallback: item.precoFallback
  };
}

function montarConfirmacaoEntrega({ clienteNome, quantidadeItens, valorTotal, formatCurrency }) {
  const fmt = formatCurrency || ((v) => String(v));
  return {
    title: 'Confirmar entrega?',
    cancelLabel: 'Voltar e revisar',
    confirmLabel: 'Confirmar entrega',
    message: [
      `Cliente: ${clienteNome || '—'}`,
      `Quantidade de itens: ${quantidadeItens ?? 0}`,
      `Valor total: ${fmt(valorTotal || 0)}`,
      '',
      'Após confirmar, os itens serão registrados como entregues e não poderão mais ser editados.'
    ].join('\n')
  };
}

module.exports = {
  podeEditarItensEntrega,
  edicaoBloqueadaPorStatus,
  itemUnidadeSnapshot,
  itemPrecoSnapshot,
  itemQuantidade,
  itemTotalSnapshot,
  totalEntrega,
  impactoLimite,
  extrairSnapshot,
  snapshotPreservado,
  unidadePermiteFracao,
  validarQuantidadeEdicao,
  aplicarQuantidadeLocal,
  aplicarTrocaProduto,
  produtoJaExisteNaConsignacao,
  montarConfirmacaoEntrega,
  MENSAGEM_EDICAO_BLOQUEADA,
  CAMPOS_SNAPSHOT
};
