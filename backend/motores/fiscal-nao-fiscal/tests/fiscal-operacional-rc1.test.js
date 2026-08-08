/**
 * Motor Fiscal × Não Fiscal RC1 — Testes de formalização.
 *
 * Critério: mesmos totais da versão anterior (calcularTotaisDistribuidos),
 * com FiscalOperacionalResult (efetivo = máximo = mínimo; margem = 0).
 */

'use strict';

const assert = require('assert');
const {
  calcularTotaisDistribuidos,
  separarItensDistribuidos
} = require('../../../services/fiscalNaoFiscalService');
const FiscalOperacionalResult = require('../FiscalOperacionalResult');
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

function assertParidadeLegado(itens, rotulo) {
  const legado = calcularTotaisDistribuidos(itens);
  const resultado = FiscalOperacionalService.montarFromItens(itens, { log: false });

  assert.ok(resultado instanceof FiscalOperacionalResult, `${rotulo}: tipo`);
  assert.strictEqual(resultado.valorFiscalEfetivo, legado.totalFiscal, `${rotulo}: efetivo`);
  assert.strictEqual(resultado.valorFiscalMaximo, legado.totalFiscal, `${rotulo}: máximo`);
  assert.ok(resultado.valorFiscalMinimo <= resultado.valorFiscalMaximo, `${rotulo}: min≤max`);
  assert.strictEqual(resultado.valorNaoFiscal, legado.totalNaoFiscal, `${rotulo}: não fiscal`);
  assert.strictEqual(
    resultado.margemFiscalDisponivel,
    Number((resultado.valorFiscalMaximo - resultado.valorFiscalMinimo).toFixed(2)),
    `${rotulo}: margem`
  );
  assert.strictEqual(
    resultado.possuiMargemFiscal,
    resultado.margemFiscalDisponivel > 0.009,
    `${rotulo}: possuiMargem`
  );
  assert.strictEqual(resultado.valorFiscal, resultado.valorFiscalEfetivo, `${rotulo}: getter valorFiscal`);
  assert.strictEqual(resultado.totalFiscal, legado.totalFiscal, `${rotulo}: getter totalFiscal`);
  assert.strictEqual(resultado.totalNaoFiscal, legado.totalNaoFiscal, `${rotulo}: getter totalNaoFiscal`);
  assert.strictEqual(resultado.versao, 'RC3');
}

const CENARIOS = [
  {
    nome: 'PDV — somente fiscal',
    origem: 'PDV',
    itens: [
      { valor_fiscal: 100, valor_nao_fiscal: 0 },
      { valor_fiscal: 50.5, valor_nao_fiscal: 0 }
    ]
  },
  {
    nome: 'PDV — somente não fiscal',
    origem: 'PDV',
    itens: [{ valor_fiscal: 0, valor_nao_fiscal: 80 }]
  },
  {
    nome: 'PDV — venda mista',
    origem: 'PDV',
    itens: [
      { valor_fiscal: 71.2, valor_nao_fiscal: 0 },
      { valor_fiscal: 0, valor_nao_fiscal: 35.6 }
    ]
  },
  {
    nome: 'COMERCIAL — venda comercial',
    origem: 'COMERCIAL',
    itens: [{ valor_fiscal: 120, valor_nao_fiscal: 30 }]
  },
  {
    nome: 'CONSIGNACAO — prestação',
    origem: 'CONSIGNACAO',
    itens: [
      { valor_fiscal: 40, valor_nao_fiscal: 20 },
      { valor_fiscal: 0, valor_nao_fiscal: 40 }
    ]
  },
  {
    nome: 'PEDIDO — pedido faturado',
    origem: 'PEDIDO',
    itens: [{ valor_fiscal: 200, valor_nao_fiscal: 0 }]
  },
  {
    nome: 'ORCAMENTO — orçamento convertido',
    origem: 'ORCAMENTO',
    itens: [{ valor_fiscal: 15, valor_nao_fiscal: 15 }]
  },
  {
    nome: 'API — origem API',
    origem: 'API',
    itens: [
      { valor_fiscal: 90.1, valor_nao_fiscal: 9.9 }
    ]
  }
];

console.log('=== FISCAL OPERACIONAL RC1 — testes ===\n');

test('Contrato — efetivo = máximo; margem derivada do intervalo', () => {
  const r = FiscalOperacionalService.montarFromTotais(
    { valorFiscal: 71.2, valorNaoFiscal: 35.6 },
    { log: false }
  );
  assert.strictEqual(r.valorFiscalEfetivo, r.valorFiscalMaximo);
  assert.strictEqual(r.valorFiscalMinimo, r.valorFiscalMaximo); // sem itens → margem 0
  assert.strictEqual(r.margemFiscalDisponivel, 0);
  assert.strictEqual(r.possuiMargemFiscal, false);
});

test('separarItensDistribuidos retorna FiscalOperacionalResult compatível', () => {
  const itens = [
    { valor_fiscal: 10, valor_nao_fiscal: 5 },
    { valor_fiscal: 2.5, valor_nao_fiscal: 0 }
  ];
  const legado = calcularTotaisDistribuidos(itens);
  const r = separarItensDistribuidos(itens);
  assert.ok(r instanceof FiscalOperacionalResult);
  const { totalFiscal, totalNaoFiscal } = r;
  assert.strictEqual(totalFiscal, legado.totalFiscal);
  assert.strictEqual(totalNaoFiscal, legado.totalNaoFiscal);
});

test('calcular() a partir de totais', () => {
  const r = FiscalOperacionalService.calcular({
    valorFiscal: 40,
    valorNaoFiscal: 60,
    origem: 'API',
    log: false
  });
  assert.strictEqual(r.valorFiscalEfetivo, 40);
  assert.strictEqual(r.valorNaoFiscal, 60);
});

test('toJSON contém contrato oficial', () => {
  const r = FiscalOperacionalService.montarFromTotais(
    { valorFiscal: 10, valorNaoFiscal: 0 },
    { log: false }
  );
  const json = r.toJSON();
  [
    'valorFiscalMaximo',
    'valorFiscalMinimo',
    'valorFiscalEfetivo',
    'valorNaoFiscal',
    'margemFiscalDisponivel',
    'possuiMargemFiscal',
    'versao',
    'algoritmo',
    'tempoMs'
  ].forEach((campo) => {
    assert.ok(Object.prototype.hasOwnProperty.call(json, campo), `faltando ${campo}`);
  });
});

for (const cenario of CENARIOS) {
  test(cenario.nome, () => assertParidadeLegado(cenario.itens, cenario.nome));
}

console.log('\n=== FISCAL OPERACIONAL RC1 — todos os testes OK ===');
