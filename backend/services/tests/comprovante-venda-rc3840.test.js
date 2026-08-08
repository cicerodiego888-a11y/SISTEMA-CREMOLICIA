/**
 * RC3.8D.4.0 — Comprovante comercial de venda (sem fiscal/MIDP).
 */

'use strict';

const assert = require('assert');
const {
  montarHtmlComprovanteVenda,
  consolidarPagamentos
} = require('../../services/comprovanteVendaService');

function test(name, fn) {
  try {
    fn();
    console.log(`OK ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

console.log('=== COMPROVANTE DE VENDA RC3.8D.4.0 ===\n');

test('Cenário Pitú 3×R$5 PIX+Dinheiro — HTML comercial completo', () => {
  const html = montarHtmlComprovanteVenda({
    nome_empresa: 'Esquinão da Economia',
    cupom: 2002,
    data_hora: '2026-07-30T01:14:00',
    total: 15,
    itens: [{
      produto_nome: 'Aguardente Pitú Tradicional',
      quantidade: 3,
      unidade: 'UN',
      tipo_venda: 'UNIDADE',
      preco_unitario: 5,
      subtotal: 15,
      // campos fiscais presentes no banco — NÃO devem aparecer no HTML
      quantidade_fiscal: 2,
      quantidade_nao_fiscal: 1,
      valor_fiscal: 10,
      valor_nao_fiscal: 5
    }],
    pagamentos: [
      { forma_pagamento: 'pix', valor: 10, tipo_recebimento: 'fiscal' },
      { forma_pagamento: 'dinheiro', valor: 5, tipo_recebimento: 'nao_fiscal' }
    ]
  });

  assert.ok(html.includes('COMPROVANTE DE VENDA'));
  assert.ok(html.includes('Esquinão da Economia'));
  assert.ok(html.includes('Cupom: 2002'));
  assert.ok(html.includes('Aguardente Pitú Tradicional'));
  assert.ok(html.includes('Qtd.: 3 UN'));
  assert.ok(html.includes('R$ 5,00'));
  assert.ok(html.includes('R$ 15,00') || html.includes('R$15,00'));
  assert.ok(html.includes('TOTAL DA COMPRA'));
  assert.ok(html.includes('PIX'));
  assert.ok(html.includes('Dinheiro'));
  assert.ok(html.includes('R$ 10,00'));
  assert.ok(html.includes('Obrigado pela preferência'));

  // Proibições — conceitos internos
  assert.ok(!html.includes('quantidade_fiscal'));
  assert.ok(!html.includes('valor_fiscal'));
  assert.ok(!html.includes('MIDP'));
  assert.ok(!html.includes('DANFE'));
  assert.ok(!html.includes('NFC-e'));
  assert.ok(!html.includes('não fiscal') && !html.includes('nao fiscal'));
  assert.ok(!html.includes('Qtd.: 2')); // não usar qtd fiscal
});

test('Consolida pagamentos sem expor tipo_recebimento', () => {
  const pags = consolidarPagamentos([
    { forma_pagamento: 'pix', valor: 10, tipo_recebimento: 'fiscal' },
    { forma_pagamento: 'pix', valor: 0, tipo_recebimento: 'nao_fiscal' },
    { forma_pagamento: 'dinheiro', valor: 5, tipo_recebimento: 'nao_fiscal' }
  ]);
  assert.strictEqual(pags.length, 2);
  assert.deepStrictEqual(
    pags.find((p) => p.forma === 'pix'),
    { forma: 'pix', valor: 10 }
  );
  assert.deepStrictEqual(
    pags.find((p) => p.forma === 'dinheiro'),
    { forma: 'dinheiro', valor: 5 }
  );
});

test('Usa quantidade comercial mesmo com split fiscal no item', () => {
  const html = montarHtmlComprovanteVenda({
    nome_empresa: 'Loja',
    cupom: 1,
    total: 15,
    itens: [{
      produto_nome: 'X',
      quantidade: 3,
      quantidade_fiscal: 2,
      preco_unitario: 5,
      subtotal: 15,
      unidade: 'UN',
      tipo_venda: 'UNIDADE'
    }],
    pagamentos: [{ forma_pagamento: 'dinheiro', valor: 15 }]
  });
  assert.ok(html.includes('Qtd.: 3 UN'));
  assert.ok(html.includes('TOTAL DA COMPRA'));
  assert.ok(html.includes('R$ 15,00'));
});

console.log('\n=== COMPROVANTE DE VENDA — todos os testes OK ===');
