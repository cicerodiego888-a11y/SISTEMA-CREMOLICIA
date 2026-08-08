/**
 * RCF-07.1 — Persistência simulada: carrinho → MIDP → itens → pagamento → emissor
 * (sem SEFAZ; valida contrato de contagem e isolamento)
 */

const assert = require('assert');
const path = require('path');

const root = path.join(__dirname, '../../..');
const {
  aplicarDecisaoMidpNosItens
} = require(path.join(root, 'services/vendas/VendaPagamentoService'));
const {
  assertVendaComItens,
  validarConsistenciaVendaXml
} = require(path.join(root, 'services/fiscal/emissor'));

function montarCarrinho(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    produto_id: 100 + i,
    quantidade: 1,
    quantidade_fiscal: 1,
    quantidade_nao_fiscal: 0,
    preco_unitario: 10,
    valor_fiscal: 10,
    valor_nao_fiscal: 0,
    subtotal: 10
  }));
}

/** Simula o padrão clear+repush da persistência. */
function persistirAposMidp(carrinho, decisao) {
  const distribuicaoItens = carrinho.map((c) => ({ ...c }));
  const itensFinais = aplicarDecisaoMidpNosItens(distribuicaoItens, decisao);
  assert.notStrictEqual(itensFinais, distribuicaoItens);

  const recebidos = distribuicaoItens.length;
  distribuicaoItens.length = 0;
  itensFinais.forEach((it) => distribuicaoItens.push(it));

  const venda = {
    id: 9001,
    total: distribuicaoItens.reduce((s, i) => s + Number(i.subtotal || 0), 0),
    valor_fiscal: distribuicaoItens.reduce((s, i) => s + Number(i.valor_fiscal || 0), 0),
    pagamentos: [{ forma_pagamento: 'dinheiro', valor: 0 }]
  };
  venda.pagamentos[0].valor = venda.total;

  const store = {
    vendas: [venda],
    vendas_itens: distribuicaoItens.map((it) => ({ ...it, venda_id: venda.id })),
    pagamentos: [...venda.pagamentos],
    nfce_notas: []
  };

  return { store, recebidos, persistidos: store.vendas_itens.length };
}

function run() {
  // 5 itens, MIDP sem ajuste
  const carrinho = montarCarrinho(5);
  const { store, recebidos, persistidos } = persistirAposMidp(carrinho, null);

  assert.strictEqual(recebidos, 5);
  assert.strictEqual(persistidos, 5);
  assert.strictEqual(store.vendas.length, 1, 'venda criada');
  assert.strictEqual(store.vendas_itens.length, 5, 'itens persistidos = carrinho');
  assert.strictEqual(store.pagamentos.length, 1, 'pagamento registrado');

  // Emissor: carregar itens e assert
  assertVendaComItens(store.vendas[0].id, store.vendas_itens, store.vendas_itens.length);

  const idsCarrinho = carrinho.map((c) => c.produto_id).join(',');
  const idsPersist = store.vendas_itens.map((c) => c.produto_id).join(',');
  assert.strictEqual(idsPersist, idsCarrinho, 'mesmos produtos do carrinho');

  // NFC-e "emitida" (mock) amarrada à venda
  store.nfce_notas.push({
    id: 1,
    venda_id: store.vendas[0].id,
    status: 'autorizada',
    numero: 2009,
    danfe_html: `<html>${store.vendas_itens.map((i) => i.produto_id).join(',')}</html>`
  });
  assert.strictEqual(store.nfce_notas[0].venda_id, store.vendas[0].id);
  assert.ok(store.nfce_notas[0].danfe_html.includes('100'));

  // XML com N det = N itens fiscais
  const dets = store.vendas_itens.map((_, i) => `<det nItem="${i + 1}"></det>`).join('');
  const xml = `<infNFe><total><ICMSTot><vNF>${Number(store.vendas[0].valor_fiscal).toFixed(2)}</vNF></ICMSTot></total>${dets}</infNFe>`;
  const check = validarConsistenciaVendaXml(store.vendas[0], xml, {
    itensFiscais: store.vendas_itens
  });
  assert.strictEqual(check.ok, true, check.divergencias.join('; '));
  assert.strictEqual(check.nItemsXml, 5);

  console.log('RCF-07.1 OK — persistência: carrinho=itens=pagamento=XML');
}

run();
