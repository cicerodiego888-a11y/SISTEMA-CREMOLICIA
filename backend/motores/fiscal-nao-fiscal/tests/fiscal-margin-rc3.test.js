/**
 * Fiscal Margin Calculator RC3 — Testes de margem fiscal.
 *
 * Critério: efetivo = máximo (inalterado); mínimo pode ser menor; margem = máx − mín.
 */

'use strict';

const assert = require('assert');
const {
  calcularTotaisDistribuidos
} = require('../../../services/fiscalNaoFiscalService');
const FiscalMarginCalculator = require('../FiscalMarginCalculator');
const FiscalIntervalCalculator = require('../FiscalIntervalCalculator');
const FiscalOperacionalService = require('../FiscalOperacionalService');

function test(name, fn) {
  try {
    fn();
    console.log(`OK ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

console.log('=== FISCAL MARGIN RC3 — testes ===\n');

test('Somente fiscal — margem zero', () => {
  const itens = [
    { valor_fiscal: 100, valor_nao_fiscal: 0 },
    { valor_fiscal: 50.5, valor_nao_fiscal: 0 }
  ];
  const legado = calcularTotaisDistribuidos(itens);
  const m = FiscalMarginCalculator.calcular({ itens }, { log: false });
  assert.strictEqual(m.valorFiscalMaximo, legado.totalFiscal);
  assert.strictEqual(m.valorFiscalMinimo, legado.totalFiscal);
  assert.strictEqual(m.margemFiscalDisponivel, 0);
  assert.strictEqual(m.possuiMargemFiscal, false);
});

test('Somente não fiscal — margem zero', () => {
  const itens = [{ valor_fiscal: 0, valor_nao_fiscal: 80 }];
  const m = FiscalMarginCalculator.calcular({ itens }, { log: false });
  assert.strictEqual(m.valorFiscalMaximo, 0);
  assert.strictEqual(m.valorFiscalMinimo, 0);
  assert.strictEqual(m.margemFiscalDisponivel, 0);
  assert.strictEqual(m.possuiMargemFiscal, false);
});

test('Item misto — margem positiva (piso flexível)', () => {
  const itens = [{ valor_fiscal: 71.2, valor_nao_fiscal: 35.6 }];
  const m = FiscalMarginCalculator.calcular({ itens }, { log: false });
  assert.strictEqual(m.valorFiscalMaximo, 71.2);
  assert.strictEqual(m.valorFiscalMinimo, 0);
  assert.strictEqual(m.margemFiscalDisponivel, 71.2);
  assert.strictEqual(m.possuiMargemFiscal, true);
});

test('Mista com item puro fiscal + misto — mínimo trava o puro', () => {
  const itens = [
    { valor_fiscal: 70, valor_nao_fiscal: 0 },
    { valor_fiscal: 30, valor_nao_fiscal: 20 }
  ];
  const m = FiscalMarginCalculator.calcular({ itens }, { log: false });
  assert.strictEqual(m.valorFiscalMaximo, 100);
  assert.strictEqual(m.valorFiscalMinimo, 70);
  assert.strictEqual(m.margemFiscalDisponivel, 30);
  assert.strictEqual(m.possuiMargemFiscal, true);
});

test('Totais sem itens — margem zero (sem flexibilidade)', () => {
  const m = FiscalMarginCalculator.calcular(
    { valorFiscal: 90, valorNaoFiscal: 10 },
    { log: false }
  );
  assert.strictEqual(m.valorFiscalMaximo, 90);
  assert.strictEqual(m.valorFiscalMinimo, 90);
  assert.strictEqual(m.margemFiscalDisponivel, 0);
});

test('Piso via estoque (prioriza não fiscal)', () => {
  const itens = [{
    quantidade: 10,
    preco_unitario: 5,
    valor_fiscal: 40,
    valor_nao_fiscal: 10,
    saldo_fiscal: 8,
    saldo_nao_fiscal: 10
  }];
  // prioriza NF: naoFiscal=min(10,10)=10, fiscal=0 → piso 0
  const m = FiscalMarginCalculator.calcular({ itens }, { log: false });
  assert.strictEqual(m.valorFiscalMaximo, 40);
  assert.strictEqual(m.valorFiscalMinimo, 0);
  assert.ok(m.margemFiscalDisponivel > 0);
});

test('Piso via estoque com fiscal obrigatório', () => {
  const itens = [{
    quantidade: 10,
    preco_unitario: 10,
    valor_fiscal: 100,
    valor_nao_fiscal: 0,
    saldo_fiscal: 10,
    saldo_nao_fiscal: 0
  }];
  // prioriza NF: naoFiscal=0, fiscal=10 → piso 100
  const m = FiscalMarginCalculator.calcular({ itens }, { log: false });
  assert.strictEqual(m.valorFiscalMaximo, 100);
  assert.strictEqual(m.valorFiscalMinimo, 100);
  assert.strictEqual(m.margemFiscalDisponivel, 0);
});

const ORIGENS = [
  { nome: 'PDV', itens: [{ valor_fiscal: 50, valor_nao_fiscal: 50 }] },
  { nome: 'COMERCIAL', itens: [{ valor_fiscal: 120, valor_nao_fiscal: 30 }] },
  { nome: 'CONSIGNACAO', itens: [{ valor_fiscal: 40, valor_nao_fiscal: 0 }, { valor_fiscal: 0, valor_nao_fiscal: 40 }] },
  { nome: 'PEDIDO', itens: [{ valor_fiscal: 200, valor_nao_fiscal: 0 }] },
  { nome: 'ORCAMENTO', itens: [{ valor_fiscal: 15, valor_nao_fiscal: 15 }] },
  { nome: 'API', itens: [{ valor_fiscal: 90.1, valor_nao_fiscal: 9.9 }] }
];

for (const cenario of ORIGENS) {
  test(`${cenario.nome} — efetivo = máximo (compatibilidade)`, () => {
    const legado = calcularTotaisDistribuidos(cenario.itens);
    const op = FiscalOperacionalService.montarFromItens(cenario.itens, { log: false });
    const intervalo = FiscalIntervalCalculator.calcular({ itens: cenario.itens }, { log: false });

    assert.strictEqual(op.valorFiscalEfetivo, legado.totalFiscal);
    assert.strictEqual(op.valorFiscalEfetivo, op.valorFiscalMaximo);
    assert.strictEqual(op.valorFiscalMaximo, intervalo.valorFiscalMaximo);
    assert.strictEqual(op.valorFiscalMinimo, intervalo.valorFiscalMinimo);
    assert.strictEqual(op.valorNaoFiscal, legado.totalNaoFiscal);
    assert.strictEqual(op.totalFiscal, legado.totalFiscal);
    assert.ok(op.valorFiscalMinimo <= op.valorFiscalMaximo);
    assert.strictEqual(
      op.margemFiscalDisponivel,
      Number((op.valorFiscalMaximo - op.valorFiscalMinimo).toFixed(2))
    );
  });
}

test('IntervalCalculator orquestra MarginCalculator', () => {
  const itens = [{ valor_fiscal: 40, valor_nao_fiscal: 60 }];
  const margem = FiscalMarginCalculator.calcular({ itens }, { log: false });
  const intervalo = FiscalIntervalCalculator.calcular({ itens }, { log: false });
  assert.strictEqual(intervalo.valorFiscalMaximo, margem.valorFiscalMaximo);
  assert.strictEqual(intervalo.valorFiscalMinimo, margem.valorFiscalMinimo);
  assert.strictEqual(intervalo.margemFiscalDisponivel, margem.margemFiscalDisponivel);
  assert.strictEqual(intervalo.versao, 'RC3');
});

console.log('\n=== FISCAL MARGIN RC3 — todos os testes OK ===');
