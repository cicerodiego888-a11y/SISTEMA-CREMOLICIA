/**
 * RCF-07.1 — Regressão MIDP: sem ajuste / com redistribuição / nunca zera itens
 */

const assert = require('assert');
const path = require('path');

const root = path.join(__dirname, '../../..');
const {
  aplicarDecisaoMidpNosItens
} = require(path.join(root, 'services/vendas/VendaPagamentoService'));

function cincoItens() {
  return Array.from({ length: 5 }, (_, i) => ({
    produto_id: i + 1,
    quantidade: 2,
    quantidade_fiscal: 2,
    quantidade_nao_fiscal: 0,
    valor_fiscal: 20,
    valor_nao_fiscal: 0,
    preco_unitario: 10,
    subtotal: 20
  }));
}

function clearRepush(itens, decisao) {
  const bucket = itens.map((i) => ({ ...i }));
  const entrada = bucket.length;
  const finais = aplicarDecisaoMidpNosItens(bucket, decisao);
  assert.notStrictEqual(finais, bucket);
  bucket.length = 0;
  finais.forEach((it) => bucket.push(it));
  return { entrada, saida: finais.length, persistencia: bucket.length, itens: bucket };
}

function run() {
  // 1) MIDP não altera
  const s1 = clearRepush(cincoItens(), null);
  assert.strictEqual(s1.entrada, 5);
  assert.strictEqual(s1.saida, 5);
  assert.strictEqual(s1.persistencia, 5);

  // 2) MIDP "altera preços" (valores) — quantidade/produto preservados
  const base = cincoItens();
  const adjPreco = {
    itensAjuste: base.map((it) => ({
      quantidade_fiscal: it.quantidade_fiscal,
      quantidade_nao_fiscal: 0,
      valor_fiscal: 15,
      valor_nao_fiscal: 0
    }))
  };
  const s2 = clearRepush(base, adjPreco);
  assert.strictEqual(s2.persistencia, 5);
  s2.itens.forEach((it, i) => {
    assert.strictEqual(it.produto_id, i + 1, 'produto preservado');
    assert.strictEqual(it.quantidade_fiscal, 2, 'quantidade preservada');
    assert.strictEqual(it.valor_fiscal, 15, 'valor ajustado');
  });

  // 3) Redistribuição Fiscal × Não Fiscal — nenhum some
  const adjFx = {
    itensAjuste: base.map((it) => ({
      quantidade_fiscal: 1,
      quantidade_nao_fiscal: 1,
      valor_fiscal: 10,
      valor_nao_fiscal: 10
    }))
  };
  const s3 = clearRepush(cincoItens(), adjFx);
  assert.strictEqual(s3.entrada, 5);
  assert.strictEqual(s3.saida, 5);
  assert.strictEqual(s3.persistencia, 5);
  s3.itens.forEach((it) => {
    assert.strictEqual(Number(it.quantidade_fiscal) + Number(it.quantidade_nao_fiscal), 2);
  });

  // 4) Guard: se retorno vazio com entrada > 0 seria regressão
  const vazios = aplicarDecisaoMidpNosItens([], null);
  assert.strictEqual(vazios.length, 0);
  const cheios = aplicarDecisaoMidpNosItens(cincoItens(), { itensAjuste: [] });
  assert.strictEqual(cheios.length, 5);

  console.log('RCF-07.1 OK — MIDP regressão: 5→5 sem/com redistribuição');
}

run();
