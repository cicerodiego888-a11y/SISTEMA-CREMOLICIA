/**
 * STAB-06 — PrestacaoVendaAdapter + Integridade Comercial
 */

const assert = require('assert');
const {
  calcularIntegridadeComercial,
  buildResumoFinalPrestacao,
  montarPayloadCriarVenda,
  POLITICA_ESTOQUE_JA_BAIXADO,
  ORIGEM_CONSIGNACAO
} = require('../../backend/services/vendas/adapters/PrestacaoVendaAdapter');

let passou = 0;
let falhou = 0;

async function test(nome, fn) {
  try {
    await fn();
    passou += 1;
    console.log(`  ✓ ${nome}`);
  } catch (err) {
    falhou += 1;
    console.error(`  ✗ ${nome}`);
    console.error(`    ${err.message}`);
  }
}

async function run() {
  console.log('\n=== STAB-06 PrestacaoVendaAdapter ===\n');

  await test('Cenário 1 — Venda 50 / Recebido 50 / Saldo 0', () => {
    const i = calcularIntegridadeComercial(50, 50);
    assert.strictEqual(i.valorVenda, 50);
    assert.strictEqual(i.valorRecebido, 50);
    assert.strictEqual(i.saldoEmAberto, 0);
    assert.strictEqual(i.situacaoFinanceira, 'QUITADA');
    assert.strictEqual(i.integro, true);

    const payload = montarPayloadCriarVenda({
      consignacaoId: 1,
      grupoPrestacaoId: 9,
      clienteId: 10,
      itensVendidos: [{ produtoId: 100, quantidade: 1, precoUnitario: 50 }],
      totalVendido: 50,
      totalRecebido: 50,
      emitirFiscal: true
    });
    assert.strictEqual(payload.origem, ORIGEM_CONSIGNACAO);
    assert.strictEqual(payload.origem_pdv, 'CONSIGNACAO');
    assert.strictEqual(payload.politicaEstoque, POLITICA_ESTOQUE_JA_BAIXADO);
    assert.strictEqual(payload.metadata.politicaEstoque, POLITICA_ESTOQUE_JA_BAIXADO);
    assert.strictEqual(payload.total, 50);
    assert.strictEqual(payload.emitir_fiscal, true);
    assert.strictEqual(payload.itens[0].quantidade_fiscal, 1);
    assert.strictEqual(payload.pagamentos.length, 1);
    assert.strictEqual(payload.pagamentos[0].valor, 50);
    assert.strictEqual(payload.pagamentos[0].tipo_recebimento, 'fiscal');
    assert.notStrictEqual(payload.forma_pagamento, 'prazo');
  });

  await test('Cenário 2 — Venda 50 / Recebido 40 / Saldo 10', () => {
    const i = calcularIntegridadeComercial(50, 40);
    assert.strictEqual(i.saldoEmAberto, 10);
    assert.strictEqual(i.situacaoFinanceira, 'PARCIALMENTE_RECEBIDA');
    assert.strictEqual(i.integro, true);
    assert.strictEqual(i.valorVenda, i.valorRecebido + i.saldoEmAberto);

    const payload = montarPayloadCriarVenda({
      consignacaoId: 2,
      clienteId: 10,
      itensVendidos: [{ produtoId: 100, quantidade: 1, precoUnitario: 50 }],
      totalVendido: 50,
      totalRecebido: 40,
      emitirFiscal: true
    });
    assert.strictEqual(payload.forma_pagamento, 'misto');
    assert.strictEqual(payload.pagamentos.length, 2);
    assert.strictEqual(payload.metadata.saldoEmAberto, 10);
    assert.strictEqual(payload.metadata.valorRecebido, 40);
    const totalPag = payload.pagamentos.reduce((s, p) => s + p.valor, 0);
    assert.ok(Math.abs(totalPag - 50) < 0.01);
  });

  await test('Cenário 3 — sem NFC-e (emitirFiscal false)', () => {
    const resumo = buildResumoFinalPrestacao({
      totalVendido: 50,
      totalRecebido: 50,
      emitirFiscal: false,
      temItensFiscais: false
    });
    assert.strictEqual(resumo.emitiraNfce, false);

    const payload = montarPayloadCriarVenda({
      consignacaoId: 3,
      clienteId: 10,
      itensVendidos: [{ produtoId: 200, quantidade: 2, precoUnitario: 25 }],
      totalVendido: 50,
      totalRecebido: 50,
      emitirFiscal: false
    });
    assert.strictEqual(payload.emitir_fiscal, false);
  });

  await test('Cenário 4 — misto fiscal/não fiscal no item', () => {
    const payload = montarPayloadCriarVenda({
      consignacaoId: 4,
      clienteId: 10,
      itensVendidos: [{
        produtoId: 300,
        quantidade: 10,
        precoUnitario: 5,
        quantidadeFiscal: 6,
        quantidadeNaoFiscal: 4
      }],
      totalVendido: 50,
      totalRecebido: 50,
      emitirFiscal: true
    });
    assert.strictEqual(payload.itens[0].quantidade_fiscal, 6);
    assert.strictEqual(payload.itens[0].quantidade_nao_fiscal, 4);
    assert.strictEqual(payload.emitir_fiscal, true);
  });

  await test('Resumo final labels', () => {
    const r = buildResumoFinalPrestacao({ totalVendido: 50, totalRecebido: 40 });
    assert.ok(r.avisos.some((a) => /NFC-e/.test(a)));
    assert.ok(r.avisos.some((a) => /saldo financeiro/.test(a)));
    assert.strictEqual(r.situacaoFinanceiraLabel, 'Parcialmente Recebida');
  });

  console.log(`\n--- Resultado: ${passou} passou, ${falhou} falhou ---\n`);
  if (falhou > 0) process.exit(1);
}

run();
