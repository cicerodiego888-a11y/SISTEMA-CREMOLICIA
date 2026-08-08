/**
 * RCM-8.5 — Contrato unificado de precificação comercial.
 *
 * Pedido / Orçamento / CRM / Representantes / Consignação / PDV
 * DEVEM usar exclusivamente:
 *   ConfiguracaoComercialService.resolverPrecosVenda
 *   → ComercialPrecoResolver
 *
 * Snapshot imutável após geração do documento (mesmo shape RCM-6.1).
 * Comparar Tabelas: ConfiguracaoComercialService.compararTabelas (informativo).
 */

const SNAPSHOT_CAMPOS = Object.freeze([
  'produtoId',
  'linhaComercialId',
  'tabelaPrecoId',
  'unidadeComercial',
  'precoUnitario',
  'precoOrigem',
  'precoFallback',
  'quantidade',
  'valorTotal',
  'canalVenda',
  'resolver'
]);

const DOCUMENTOS = Object.freeze({
  PDV: 'pdv',
  CONSIGNACAO: 'consignacao',
  PEDIDO: 'pedido',
  ORCAMENTO: 'orcamento',
  CRM: 'crm',
  REPRESENTANTE: 'representante',
  PREVENDA: 'prevenda'
});

/**
 * Payload canônico para POST /configuracao-comercial/resolver-precos
 */
function montarPayloadResolver({ itens, canal, clienteId, documento, tabelaPrecoId } = {}) {
  const payload = {
    itens: (itens || []).map((item) => ({
      produto_id: item.produto_id ?? item.produtoId ?? item.id,
      quantidade: Number(item.quantidade ?? 1),
      categoria_id: item.categoria_id ?? item.categoriaId ?? null,
      linha_comercial_id: item.linha_comercial_id ?? item.linhaComercialId ?? null
    })),
    documento: documento || DOCUMENTOS.CONSIGNACAO
  };
  if (canal) payload.canal = String(canal).toUpperCase();
  if (clienteId) payload.cliente_id = Number(clienteId);
  if (tabelaPrecoId) payload.tabela_preco_id = Number(tabelaPrecoId);
  return payload;
}

/**
 * Converte linha do Resolver em snapshot imutável do documento.
 */
function snapshotDeLinhaResolver(row, quantidade = 1) {
  const preco = Number(row?.preco_venda ?? 0);
  const qtd = Number(quantidade || 1);
  return {
    produtoId: row?.produto_id != null ? Number(row.produto_id) : null,
    linhaComercialId: row?.linha_comercial_id != null ? Number(row.linha_comercial_id) : null,
    tabelaPrecoId: row?.tabela_preco_id != null ? Number(row.tabela_preco_id) : null,
    tabelaPrecoNome: row?.tabela_preco_nome || null,
    unidadeComercial: String(row?.unidade_comercial || row?.unidadeComercial || 'UN').toUpperCase(),
    precoUnitario: preco,
    precoOrigem: row?.preco_origem || null,
    precoFallback: !!row?.preco_fallback,
    quantidade: qtd,
    valorTotal: Number((preco * qtd).toFixed(2)),
    canalVenda: row?.canal || null,
    resolver: 'Motor Oficial'
  };
}

module.exports = {
  SNAPSHOT_CAMPOS,
  DOCUMENTOS,
  montarPayloadResolver,
  snapshotDeLinhaResolver
};
