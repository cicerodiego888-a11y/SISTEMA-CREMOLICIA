'use strict';

/**
 * RC4.31 — Testes obrigatórios: pagamento fiscal com desconto.
 */

const assert = require('assert');
const MidpService = require('../../../motores/midp/MidpService');
const OrquestradorPagamento = require('../../OrquestradorPagamento');
const {
  TOLERANCIA_MONETARIA,
  obterTotalFiscalFinal,
  aplicarDescontoProporcionalTotais,
  pagamentoFiscalSuficiente,
  montarFiscalOperacionalPagamento
} = require('../TotalFiscalFinal');

function test(name, fn) {
  const result = fn();
  if (result && typeof result.then === 'function') {
    return result.then(() => console.log(`OK ${name}`));
  }
  console.log(`OK ${name}`);
  return Promise.resolve();
}

async function processarPagamento({ totalFiscal, totalNaoFiscal = 0, pagamentos, forma = 'dinheiro' }) {
  const midpResult = MidpService.distribuir({
    valorFiscal: totalFiscal,
    valorNaoFiscal: totalNaoFiscal,
    pagamentos,
    formaPagamentoPadrao: forma,
    origem: 'RC4.31',
    midpAtivado: true,
    midpPolitica: 'LEGADO'
  });

  return OrquestradorPagamento.processarFluxoPagamentoVenda({
    totalFiscal,
    totalNaoFiscal,
    formaPagamento: forma,
    pagamentos,
    tefHabilitado: false,
    modoConfirmacaoFiscal: 'MANUAL',
    midpResult,
    origem: 'RC4.31'
  });
}

async function run() {
  await test('unidade — obterTotalFiscalFinal produtos - desconto', () => {
    assert.strictEqual(
      obterTotalFiscalFinal({ valorProdutosFiscal: 100, descontoFiscal: 10 }),
      90
    );
    assert.strictEqual(
      obterTotalFiscalFinal({ valorProdutosFiscal: 100, descontoFiscal: 0 }),
      100
    );
    assert.strictEqual(TOLERANCIA_MONETARIA, 0.01);
  });

  await test('unidade — pagamentoFiscalSuficiente com tolerância 0,01', () => {
    assert.strictEqual(pagamentoFiscalSuficiente(90, 90), true);
    assert.strictEqual(pagamentoFiscalSuficiente(89.99, 90), true);
    assert.strictEqual(pagamentoFiscalSuficiente(89.98, 90), false);
    assert.strictEqual(pagamentoFiscalSuficiente(89, 90), false);
  });

  await test('unidade — aplicarDescontoProporcionalTotais (paridade PDV)', () => {
    const r = aplicarDescontoProporcionalTotais({
      valorFiscal: 100,
      valorNaoFiscal: 0,
      desconto: 10
    });
    assert.strictEqual(r.valorFiscal, 90);
    assert.strictEqual(r.valorNaoFiscal, 0);
    assert.strictEqual(r.descontoFiscal, 10);
  });

  await test('unidade — montarFiscalOperacionalPagamento usa líquido', () => {
    const snap = montarFiscalOperacionalPagamento(
      { totalFiscal: 100, valorFiscalEfetivo: 100, valorFiscalMaximo: 100 },
      { valorFiscal: 90, valorNaoFiscal: 0 }
    );
    assert.strictEqual(snap.totalFiscal, 90);
    assert.strictEqual(snap.valorFiscalEfetivo, 90);
    assert.strictEqual(snap.valorFiscalMaximo, 90);
  });

  // --- Testes obrigatórios da sprint ---

  await test('Teste 1 — 100 sem desconto, paga 100 → OK', async () => {
    const liquido = aplicarDescontoProporcionalTotais({
      valorFiscal: 100,
      valorNaoFiscal: 0,
      desconto: 0
    });
    const r = await processarPagamento({
      totalFiscal: liquido.valorFiscal,
      pagamentos: [{ forma_pagamento: 'dinheiro', valor: 100 }]
    });
    assert.strictEqual(r.sucesso, true, r.erro);
  });

  await test('Teste 2 — 100 com desconto 10, paga 90 → OK', async () => {
    const liquido = aplicarDescontoProporcionalTotais({
      valorFiscal: 100,
      valorNaoFiscal: 0,
      desconto: 10
    });
    assert.strictEqual(liquido.valorFiscal, 90);
    const r = await processarPagamento({
      totalFiscal: liquido.valorFiscal,
      pagamentos: [{ forma_pagamento: 'pix', valor: 90 }]
    });
    assert.strictEqual(r.sucesso, true, r.erro);
  });

  await test('Teste 3 — 100 com desconto 10, paga 89 → insuficiente', async () => {
    const liquido = aplicarDescontoProporcionalTotais({
      valorFiscal: 100,
      valorNaoFiscal: 0,
      desconto: 10
    });
    const r = await processarPagamento({
      totalFiscal: liquido.valorFiscal,
      pagamentos: [{ forma_pagamento: 'pix', valor: 89 }]
    });
    assert.strictEqual(r.sucesso, false);
    assert.strictEqual(r.erro, 'Pagamento fiscal insuficiente.');
  });

  await test('Teste 4 — desconto por item (fiscal já 95), paga 95 → OK', async () => {
    const liquido = aplicarDescontoProporcionalTotais({
      valorFiscal: 95,
      valorNaoFiscal: 0,
      desconto: 0
    });
    assert.strictEqual(liquido.valorFiscal, 95);
    const r = await processarPagamento({
      totalFiscal: liquido.valorFiscal,
      pagamentos: [{ forma_pagamento: 'dinheiro', valor: 95 }]
    });
    assert.strictEqual(r.sucesso, true, r.erro);
  });

  await test('Teste 5 — desconto 10, Dinheiro 40 + PIX 50 → OK', async () => {
    const liquido = aplicarDescontoProporcionalTotais({
      valorFiscal: 100,
      valorNaoFiscal: 0,
      desconto: 10
    });
    const r = await processarPagamento({
      totalFiscal: liquido.valorFiscal,
      pagamentos: [
        { forma_pagamento: 'dinheiro', valor: 40 },
        { forma_pagamento: 'pix', valor: 50 }
      ],
      forma: 'misto'
    });
    assert.strictEqual(r.sucesso, true, r.erro);
  });

  await test('Teste 6 — desconto 10, paga 100 (troco 10 no PDV) → OK', async () => {
    const liquido = aplicarDescontoProporcionalTotais({
      valorFiscal: 100,
      valorNaoFiscal: 0,
      desconto: 10
    });
    const r = await processarPagamento({
      totalFiscal: liquido.valorFiscal,
      pagamentos: [{ forma_pagamento: 'dinheiro', valor: 100 }]
    });
    assert.strictEqual(r.sucesso, true, r.erro);
    const pagoFiscal = (r.distribuicao.recebimentosFiscal || [])
      .reduce((s, p) => s + Number(p.valor || 0), 0);
    assert.ok(Math.abs(pagoFiscal - 90) <= 0.01);
  });

  await test('Regressão PRESERVAR_DINHEIRO — itens brutos + desconto líquido → OK', async () => {
    const { montarFiscalOperacionalPagamento } = require('../TotalFiscalFinal');
    const itens = [{
      produto_id: 1,
      quantidade: 1,
      preco_unitario: 100,
      valor_fiscal: 100,
      valor_nao_fiscal: 0,
      quantidade_fiscal: 1,
      quantidade_nao_fiscal: 0
    }];
    const liquido = aplicarDescontoProporcionalTotais({
      valorFiscal: 100,
      valorNaoFiscal: 0,
      desconto: 10
    });
    const fo = montarFiscalOperacionalPagamento(
      { valorFiscalMaximo: 100, valorFiscalEfetivo: 100, valorNaoFiscal: 0 },
      liquido
    );

    // Simula o bug antigo: MIDP com itens brutos
    const midpComItens = MidpService.distribuir({
      valorFiscal: liquido.valorFiscal,
      valorNaoFiscal: 0,
      pagamentos: [{ forma_pagamento: 'dinheiro', valor: 90 }],
      fiscalOperacional: fo,
      itens,
      origem: 'RC4.31',
      midpAtivado: true
    });
    assert.ok(Number(midpComItens.saldoFiscal || 0) > 0.01, 'pré-condição: MIDP com itens deixa saldo');

    // Orquestrador deve redistribuir e aceitar
    const r = await OrquestradorPagamento.processarFluxoPagamentoVenda({
      totalFiscal: liquido.valorFiscal,
      totalNaoFiscal: 0,
      formaPagamento: 'dinheiro',
      pagamentos: [{ forma_pagamento: 'dinheiro', valor: 90 }],
      tefHabilitado: false,
      modoConfirmacaoFiscal: 'MANUAL',
      midpResult: midpComItens,
      origem: 'RC4.31'
    });
    assert.strictEqual(r.sucesso, true, r.erro);
    assert.ok(Number(r.distribuicao.saldoFiscal || 0) <= 0.01);
  });

  console.log('\n=== RC4.31 — todos os testes OK ===');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
