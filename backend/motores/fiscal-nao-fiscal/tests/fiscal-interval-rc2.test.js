/**
 * Fiscal Interval Calculator RC2/RC3 — Paridade de efetivo e orquestração.
 *
 * RC3: margem pode ser > 0 com itens mistos; efetivo operacional permanece = máximo.
 */

'use strict';

const assert = require('assert');
const {
  calcularTotaisDistribuidos
} = require('../../../services/fiscalNaoFiscalService');
const FiscalIntervalCalculator = require('../FiscalIntervalCalculator');
const FiscalIntervalResult = require('../FiscalIntervalResult');
const FiscalOperacionalService = require('../FiscalOperacionalService');
const FiscalOperacionalResult = require('../FiscalOperacionalResult');

function test(name, fn) {
  try {
    fn();
    console.log(`OK ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function assertEfetivoInalterado(itens, rotulo) {
  const legado = calcularTotaisDistribuidos(itens);
  const intervalo = FiscalIntervalCalculator.calcular({ itens }, { log: false });
  const operacional = FiscalOperacionalService.montarFromItens(itens, { log: false });

  assert.ok(intervalo instanceof FiscalIntervalResult, `${rotulo}: tipo intervalo`);
  assert.ok(operacional instanceof FiscalOperacionalResult, `${rotulo}: tipo operacional`);
  assert.strictEqual(intervalo.valorFiscalMaximo, legado.totalFiscal, `${rotulo}: máximo`);
  assert.ok(intervalo.valorFiscalMinimo <= intervalo.valorFiscalMaximo, `${rotulo}: min≤max`);
  assert.strictEqual(
    intervalo.margemFiscalDisponivel,
    Number((intervalo.valorFiscalMaximo - intervalo.valorFiscalMinimo).toFixed(2)),
    `${rotulo}: margem`
  );
  assert.strictEqual(operacional.valorFiscalEfetivo, legado.totalFiscal, `${rotulo}: efetivo`);
  assert.strictEqual(operacional.valorFiscalEfetivo, operacional.valorFiscalMaximo);
  assert.strictEqual(operacional.valorNaoFiscal, legado.totalNaoFiscal);
  assert.strictEqual(operacional.totalFiscal, legado.totalFiscal);
}

console.log('=== FISCAL INTERVAL (RC3) — testes ===\n');

test('Totais sem itens — margem zero', () => {
  const r = FiscalIntervalCalculator.calcular(
    { valorFiscal: 71.2, valorNaoFiscal: 35.6 },
    { log: false }
  );
  assert.strictEqual(r.valorFiscalMaximo, 71.2);
  assert.strictEqual(r.valorFiscalMinimo, 71.2);
  assert.strictEqual(r.margemFiscalDisponivel, 0);
  assert.strictEqual(r.possuiMargemFiscal, false);
});

test('Distribuição sem itens — margem zero', () => {
  const r = FiscalIntervalCalculator.calcular(
    { distribuicao: { totalFiscal: 40, totalNaoFiscal: 60 } },
    { log: false }
  );
  assert.strictEqual(r.valorFiscalMaximo, 40);
  assert.strictEqual(r.valorFiscalMinimo, 40);
});

test('Operacional efetivo = máximo', () => {
  const r = FiscalOperacionalService.montarFromTotais(
    { valorFiscal: 100, valorNaoFiscal: 20 },
    { log: false }
  );
  assert.strictEqual(r.valorFiscalEfetivo, r.valorFiscalMaximo);
  assert.strictEqual(r.versao, 'RC3');
});

const CENARIOS = [
  { nome: 'PDV — somente fiscal', itens: [{ valor_fiscal: 100, valor_nao_fiscal: 0 }, { valor_fiscal: 50.5, valor_nao_fiscal: 0 }] },
  { nome: 'PDV — somente não fiscal', itens: [{ valor_fiscal: 0, valor_nao_fiscal: 80 }] },
  { nome: 'PDV — venda mista', itens: [{ valor_fiscal: 71.2, valor_nao_fiscal: 0 }, { valor_fiscal: 0, valor_nao_fiscal: 35.6 }] },
  { nome: 'COMERCIAL — venda comercial', itens: [{ valor_fiscal: 120, valor_nao_fiscal: 30 }] },
  { nome: 'CONSIGNACAO — prestação', itens: [{ valor_fiscal: 40, valor_nao_fiscal: 20 }, { valor_fiscal: 0, valor_nao_fiscal: 40 }] },
  { nome: 'PEDIDO — pedido faturado', itens: [{ valor_fiscal: 200, valor_nao_fiscal: 0 }] },
  { nome: 'ORCAMENTO — orçamento convertido', itens: [{ valor_fiscal: 15, valor_nao_fiscal: 15 }] },
  { nome: 'API — origem API', itens: [{ valor_fiscal: 90.1, valor_nao_fiscal: 9.9 }] }
];

for (const cenario of CENARIOS) {
  test(cenario.nome, () => assertEfetivoInalterado(cenario.itens, cenario.nome));
}

console.log('\n=== FISCAL INTERVAL (RC3) — todos os testes OK ===');
