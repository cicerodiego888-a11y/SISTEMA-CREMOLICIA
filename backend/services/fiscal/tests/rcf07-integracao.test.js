/**
 * RCF-07.1 — Integração simulada PDV → NFC-e → DANFE (paridade de itens)
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

function itemEntraNaNfce(item) {
  return Number(item.quantidade_fiscal || 0) > 0 && Number(item.valor_fiscal || 0) > 0;
}

function pipelineCompleto(carrinho, decisaoMidp) {
  const itensCarrinho = carrinho.map((c) => ({ ...c }));

  // MIDP
  const aposMidp = aplicarDecisaoMidpNosItens(itensCarrinho, decisaoMidp);
  assert.notStrictEqual(aposMidp, itensCarrinho);
  assert.strictEqual(aposMidp.length, itensCarrinho.length, 'MIDP não remove itens');

  // Persistência (clear+repush seguro)
  const bucket = itensCarrinho.map((c) => ({ ...c }));
  const finais = aplicarDecisaoMidpNosItens(bucket, decisaoMidp);
  bucket.length = 0;
  finais.forEach((it) => bucket.push(it));
  const itensPersistidos = bucket.map((i) => ({ ...i }));

  // Emissor
  assertVendaComItens(77, itensPersistidos, itensPersistidos.length);
  const itensEmissor = itensPersistidos.filter(itemEntraNaNfce);

  // XML
  const total = itensEmissor.reduce((s, i) => s + Number(i.valor_fiscal || 0), 0);
  const dets = itensEmissor.map((_, i) => `<det nItem="${i + 1}"><prod><cProd>${itensEmissor[i].produto_id}</cProd></prod></det>`).join('');
  const xml = `<infNFe><total><ICMSTot><vNF>${total.toFixed(2)}</vNF></ICMSTot></total>${dets}</infNFe>`;
  const check = validarConsistenciaVendaXml({ total, valor_fiscal: total }, xml, {
    itensFiscais: itensEmissor
  });
  assert.ok(check.ok, check.divergencias.join('; '));

  const produtosXml = [...xml.matchAll(/<cProd>(\d+)<\/cProd>/g)].map((m) => Number(m[1]));

  // DANFE amarrado
  const danfe = {
    venda_id: 77,
    html: `DANFE itens:${produtosXml.join(',')}`
  };
  assert.strictEqual(danfe.venda_id, 77);

  return {
    qCarrinho: itensCarrinho.length,
    qMidp: aposMidp.length,
    qPersistidos: itensPersistidos.length,
    qEmissor: itensEmissor.length,
    qXml: check.nItemsXml,
    produtosCarrinho: itensCarrinho.map((i) => i.produto_id),
    produtosXml,
    danfe
  };
}

function run() {
  const carrinho = [
    { produto_id: 1, quantidade: 1, quantidade_fiscal: 1, valor_fiscal: 10, valor_nao_fiscal: 0, subtotal: 10 },
    { produto_id: 2, quantidade: 2, quantidade_fiscal: 2, valor_fiscal: 20, valor_nao_fiscal: 0, subtotal: 20 },
    { produto_id: 3, quantidade: 1, quantidade_fiscal: 1, valor_fiscal: 5, valor_nao_fiscal: 0, subtotal: 5 }
  ];

  const r = pipelineCompleto(carrinho, null);
  assert.strictEqual(r.qCarrinho, r.qMidp);
  assert.strictEqual(r.qMidp, r.qPersistidos);
  assert.strictEqual(r.qPersistidos, r.qEmissor);
  assert.strictEqual(r.qEmissor, r.qXml);
  assert.deepStrictEqual(r.produtosXml, r.produtosCarrinho);
  assert.ok(r.danfe.html.includes('1,2,3'));

  // Redistribuição fiscal×não fiscal — nenhum item some
  const decisao = {
    itensAjuste: [
      { quantidade_fiscal: 0.5, quantidade_nao_fiscal: 0.5, valor_fiscal: 5, valor_nao_fiscal: 5 },
      { quantidade_fiscal: 1, quantidade_nao_fiscal: 1, valor_fiscal: 10, valor_nao_fiscal: 10 },
      { quantidade_fiscal: 1, quantidade_nao_fiscal: 0, valor_fiscal: 5, valor_nao_fiscal: 0 }
    ]
  };
  const r2 = pipelineCompleto(carrinho, decisao);
  assert.strictEqual(r2.qCarrinho, 3);
  assert.strictEqual(r2.qPersistidos, 3);
  assert.strictEqual(r2.qEmissor, 3, 'itens fiscais parciais ainda entram na NFC-e');
  assert.strictEqual(r2.qXml, 3);

  console.log('RCF-07.1 OK — integração: carrinho=persistidos=emissor=XML=DANFE');
}

run();
