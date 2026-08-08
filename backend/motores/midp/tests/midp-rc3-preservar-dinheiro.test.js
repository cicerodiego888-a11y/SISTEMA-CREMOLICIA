/**
 * MIDP RC3 FINAL — PRESERVAR_DINHEIRO (quantidade × meios eletrônicos).
 */

'use strict';

const assert = require('assert');
const { distribuirPagamentos } = require('../../../services/DistribuidorPagamento');
const MidpService = require('../MidpService');
const MidpDecisionResult = require('../MidpDecisionResult');
const PreservarDinheiroPolicy = require('../policies/PreservarDinheiroPolicy');
const {
  calcular,
  itemEhFracionavel,
  decidirQuantidadeItem
} = require('../policies/PreservarDinheiroCalculator');
const { decidirEfetivoProposto } = PreservarDinheiroPolicy;

function test(name, fn) {
  try {
    fn();
    console.log(`OK ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function clonar(pagamentos) {
  return (pagamentos || []).map((p) => ({ ...p }));
}

function normalizarLista(lista) {
  return (lista || []).map((p) => ({
    forma_pagamento: p.forma_pagamento,
    valor: Number(Number(p.valor || 0).toFixed(2)),
    tipo_recebimento: p.tipo_recebimento || null
  }));
}

function fo({ max, min, nf, margem }) {
  const margemCalc = margem != null ? margem : Number((max - min).toFixed(2));
  return {
    valorFiscalMaximo: max,
    valorFiscalMinimo: min,
    valorFiscalEfetivo: max,
    valorNaoFiscal: nf,
    margemFiscalDisponivel: margemCalc,
    possuiMargemFiscal: margemCalc > 0.009,
    totalFiscal: max,
    totalNaoFiscal: nf
  };
}

function intervaloDe(foObj) {
  return {
    valorFiscalMaximo: foObj.valorFiscalMaximo,
    valorFiscalMinimo: foObj.valorFiscalMinimo,
    margemFiscalDisponivel: foObj.margemFiscalDisponivel,
    possuiMargemFiscal: foObj.possuiMargemFiscal,
    valorNaoFiscal: foObj.valorNaoFiscal
  };
}

console.log('=== MIDP RC3 FINAL — PRESERVAR_DINHEIRO ===\n');

test('Decisão — sem margem → proposto = máximo', () => {
  const d = decidirEfetivoProposto(
    {
      valorFiscalMaximo: 100,
      valorFiscalMinimo: 100,
      margemFiscalDisponivel: 0,
      possuiMargemFiscal: false,
      valorNaoFiscal: 0
    },
    [{ forma_pagamento: 'pix', valor: 100 }]
  );
  assert.ok(d instanceof MidpDecisionResult);
  assert.strictEqual(d.valorFiscalEfetivo, 100);
  assert.strictEqual(d.valorFiscalEfetivoProposto, 100);
  assert.strictEqual(d.economiaDinheiro, 0);
});

test('Decisão — eletrônico no intervalo → efetivo = eletrônico', () => {
  const d = decidirEfetivoProposto(
    {
      valorFiscalMaximo: 100,
      valorFiscalMinimo: 82,
      margemFiscalDisponivel: 18,
      possuiMargemFiscal: true,
      valorNaoFiscal: 0
    },
    [{ forma_pagamento: 'pix', valor: 90 }]
  );
  assert.strictEqual(d.valorFiscalEfetivo, 90);
  assert.strictEqual(d.economiaDinheiro, 10);
  assert.strictEqual(d.valorNaoFiscal, 10);
  assert.strictEqual(d.valorFiscalPIX, 90);
  assert.strictEqual(d.valorFiscalDinheiro, 0);
});

test('Decisão — eletrônico abaixo do mínimo → efetivo = mínimo', () => {
  const d = decidirEfetivoProposto(
    {
      valorFiscalMaximo: 100,
      valorFiscalMinimo: 82,
      margemFiscalDisponivel: 18,
      possuiMargemFiscal: true,
      valorNaoFiscal: 0
    },
    [
      { forma_pagamento: 'pix', valor: 70 },
      { forma_pagamento: 'dinheiro', valor: 30 }
    ]
  );
  assert.strictEqual(d.valorFiscalEfetivo, 82);
  assert.strictEqual(d.economiaDinheiro, 18);
  assert.strictEqual(d.valorEletronico, 70);
  assert.strictEqual(d.valorDinheiro, 30);
});

test('Decisão — eletrônico acima do máximo → efetivo = máximo', () => {
  const d = decidirEfetivoProposto(
    {
      valorFiscalMaximo: 100,
      valorFiscalMinimo: 82,
      margemFiscalDisponivel: 18,
      possuiMargemFiscal: true,
      valorNaoFiscal: 20
    },
    [{ forma_pagamento: 'cartao_credito', valor: 150 }]
  );
  assert.strictEqual(d.valorFiscalEfetivo, 100);
  assert.strictEqual(d.economiaDinheiro, 0);
  assert.strictEqual(d.valorNaoFiscal, 20);
});

test('Meios eletrônicos — débito, crédito, voucher, transferência', () => {
  const d = decidirEfetivoProposto(
    {
      valorFiscalMaximo: 100,
      valorFiscalMinimo: 50,
      margemFiscalDisponivel: 50,
      possuiMargemFiscal: true,
      valorNaoFiscal: 0
    },
    [
      { forma_pagamento: 'cartao_debito', valor: 20 },
      { forma_pagamento: 'cartao_credito', valor: 20 },
      { forma_pagamento: 'voucher', valor: 10 },
      { forma_pagamento: 'transferencia', valor: 15 },
      { forma_pagamento: 'dinheiro', valor: 35 }
    ]
  );
  assert.strictEqual(d.valorEletronico, 65);
  assert.strictEqual(d.valorFiscalEfetivo, 65);
  assert.strictEqual(d.economiaDinheiro, 35);
});

test('Produto fracionável — PIX proporcional, dinheiro fiscal = 0', () => {
  const itens = [{
    quantidade: 5,
    preco_unitario: 30,
    quantidade_fiscal: 5,
    quantidade_nao_fiscal: 0,
    valor_fiscal: 150,
    valor_nao_fiscal: 0,
    produto_fracionado: 1,
    unidade: 'KG'
  }];
  const d = calcular(
    intervaloDe(fo({ max: 150, min: 0, nf: 0 })),
    [
      { forma_pagamento: 'pix', valor: 80 },
      { forma_pagamento: 'dinheiro', valor: 70 }
    ],
    itens
  );
  assert.ok(Math.abs(d.quantidadeFiscal - (80 / 30)) < 0.001);
  assert.ok(Math.abs(d.valorFiscalEfetivo - 80) < 0.02);
  assert.strictEqual(d.valorFiscalPIX, 80);
  assert.strictEqual(d.valorFiscalDinheiro, 0);
  assert.ok(Math.abs(d.economiaDinheiro - 70) < 0.02);
  assert.ok(Math.abs(d.quantidadeNaoFiscal - (5 - 80 / 30)) < 0.001);
});

test('Produto inteiro — completa próxima unidade com complemento mínimo em dinheiro', () => {
  const itens = [{
    quantidade: 10,
    preco_unitario: 15,
    quantidade_fiscal: 10,
    quantidade_nao_fiscal: 0,
    valor_fiscal: 150,
    valor_nao_fiscal: 0,
    produto_fracionado: 0,
    unidade: 'UN'
  }];
  const d = calcular(
    intervaloDe(fo({ max: 150, min: 0, nf: 0 })),
    [
      { forma_pagamento: 'pix', valor: 80 },
      { forma_pagamento: 'dinheiro', valor: 70 }
    ],
    itens
  );
  assert.strictEqual(d.quantidadeFiscal, 6);
  assert.strictEqual(d.valorFiscalEfetivo, 90);
  assert.strictEqual(d.valorFiscalPIX, 80);
  assert.strictEqual(d.valorFiscalDinheiro, 10);
  assert.strictEqual(d.economiaDinheiro, 60);
  assert.strictEqual(d.quantidadeNaoFiscal, 4);
  assert.strictEqual(d.valorNaoFiscal, 60);
  assert.ok(d.itensAjuste);
  assert.strictEqual(d.itensAjuste[0].quantidade_fiscal, 6);
  assert.strictEqual(d.itensAjuste[0].valor_fiscal, 90);
});

test('Produto inteiro — nunca emite fração', () => {
  const item = {
    preco: 15,
    qFiscalMax: 10,
    fracionavel: false
  };
  const d = decidirQuantidadeItem(item, 80, 70);
  assert.strictEqual(d.quantidadeFiscal, 6);
  assert.ok(Number.isInteger(d.quantidadeFiscal));
});

test('Nunca usa dinheiro quando eletrônico basta (fracionado)', () => {
  assert.strictEqual(itemEhFracionavel({ produto_fracionado: 1 }), true);
  const d = calcular(
    intervaloDe(fo({ max: 100, min: 0, nf: 0 })),
    [
      { forma_pagamento: 'pix', valor: 100 },
      { forma_pagamento: 'dinheiro', valor: 50 }
    ],
    [{
      quantidade: 10,
      preco_unitario: 10,
      quantidade_fiscal: 10,
      valor_fiscal: 100,
      valor_nao_fiscal: 0,
      produto_fracionado: 1
    }]
  );
  assert.strictEqual(d.valorFiscalEfetivo, 100);
  assert.strictEqual(d.valorFiscalDinheiro, 0);
  assert.strictEqual(d.economiaDinheiro, 0);
});

test('Cartão + Dinheiro — inteiro com complemento', () => {
  const d = MidpService.distribuir({
    fiscalOperacional: fo({ max: 150, min: 0, nf: 0 }),
    pagamentos: [
      { forma_pagamento: 'cartao_credito', valor: 80 },
      { forma_pagamento: 'dinheiro', valor: 70 }
    ],
    itens: [{
      quantidade: 10,
      preco_unitario: 15,
      quantidade_fiscal: 10,
      quantidade_nao_fiscal: 0,
      valor_fiscal: 150,
      valor_nao_fiscal: 0,
      produto_fracionado: 0
    }],
    midpPolitica: 'PRESERVAR_DINHEIRO',
    midpAtivado: true,
    origem: 'PDV'
  });
  assert.strictEqual(d.decisao.quantidadeFiscal, 6);
  assert.strictEqual(d.decisao.valorFiscalEfetivo, 90);
  const somaFiscal = d.pagamentosFiscal.reduce((a, p) => a + Number(p.valor), 0);
  assert.ok(Math.abs(somaFiscal - 90) < 0.02);
});

test('Voucher como eletrônico', () => {
  const d = calcular(
    intervaloDe(fo({ max: 100, min: 0, nf: 0 })),
    [{ forma_pagamento: 'voucher', valor: 60 }, { forma_pagamento: 'dinheiro', valor: 40 }],
    [{
      quantidade: 10,
      preco_unitario: 10,
      quantidade_fiscal: 10,
      valor_fiscal: 100,
      produto_fracionado: 0
    }]
  );
  assert.strictEqual(d.quantidadeFiscal, 6);
  assert.strictEqual(d.valorFiscalEfetivo, 60);
  assert.strictEqual(d.valorFiscalPIX, 60);
  assert.strictEqual(d.valorFiscalDinheiro, 0);
});

test('Venda mista — fracionável + inteiro', () => {
  const d = calcular(
    intervaloDe(fo({ max: 180, min: 0, nf: 0 })),
    [
      { forma_pagamento: 'pix', valor: 100 },
      { forma_pagamento: 'dinheiro', valor: 80 }
    ],
    [
      {
        quantidade: 5,
        preco_unitario: 20,
        quantidade_fiscal: 5,
        valor_fiscal: 100,
        produto_fracionado: 1,
        unidade: 'KG'
      },
      {
        quantidade: 8,
        preco_unitario: 10,
        quantidade_fiscal: 8,
        valor_fiscal: 80,
        produto_fracionado: 0
      }
    ]
  );
  // Fracionável consome até R$100 de PIX (5 kg)
  assert.ok(d.valorFiscalEfetivo <= 180);
  assert.ok(d.valorFiscalPIX <= 100 + 0.01);
  assert.ok(d.economiaDinheiro >= 0);
  // Inteiros sem fração
  const adjInt = d.itensAjuste[1];
  assert.ok(Number.isInteger(adjInt.quantidade_fiscal) || adjInt.quantidade_fiscal === Math.floor(adjInt.quantidade_fiscal));
});

test('Múltiplos produtos — soma quantidades fiscais', () => {
  const d = calcular(
    intervaloDe(fo({ max: 200, min: 0, nf: 0 })),
    [{ forma_pagamento: 'pix', valor: 50 }, { forma_pagamento: 'dinheiro', valor: 150 }],
    [
      {
        quantidade: 10,
        preco_unitario: 10,
        quantidade_fiscal: 10,
        valor_fiscal: 100,
        produto_fracionado: 0
      },
      {
        quantidade: 10,
        preco_unitario: 10,
        quantidade_fiscal: 10,
        valor_fiscal: 100,
        produto_fracionado: 0
      }
    ]
  );
  assert.ok(Number.isInteger(d.quantidadeFiscal) || Math.abs(d.quantidadeFiscal - Math.round(d.quantidadeFiscal)) < 1e-9);
  assert.ok(d.valorFiscalEfetivo <= 200);
});

test('LEGADO — idêntico ao DistribuidorPagamento (RC2)', () => {
  const pagamentos = [
    { forma_pagamento: 'dinheiro', valor: 30 },
    { forma_pagamento: 'pix', valor: 70 }
  ];
  const fiscal = fo({ max: 80, min: 50, nf: 20 });
  const legado = distribuirPagamentos(clonar(pagamentos), 80, 20);
  const midp = MidpService.distribuir({
    fiscalOperacional: fiscal,
    valorFiscal: 80,
    valorNaoFiscal: 20,
    pagamentos: clonar(pagamentos),
    midpPolitica: 'LEGADO',
    midpAtivado: true,
    origem: 'PDV'
  });
  assert.deepStrictEqual(
    normalizarLista(midp.pagamentosFiscal),
    normalizarLista(legado.recebimentosFiscal)
  );
  assert.deepStrictEqual(
    normalizarLista(midp.pagamentosNaoFiscal),
    normalizarLista(legado.recebimentosNaoFiscal)
  );
  assert.strictEqual(midp.politica, 'LEGADO');
});

test('PRESERVAR sem margem — igual ao LEGADO', () => {
  const pagamentos = [{ forma_pagamento: 'pix', valor: 100 }];
  const fiscal = fo({ max: 100, min: 100, nf: 0 });
  const legado = MidpService.distribuir({
    fiscalOperacional: fiscal,
    pagamentos: clonar(pagamentos),
    midpPolitica: 'LEGADO',
    midpAtivado: true
  });
  const preservar = MidpService.distribuir({
    fiscalOperacional: fiscal,
    pagamentos: clonar(pagamentos),
    midpPolitica: 'PRESERVAR_DINHEIRO',
    midpAtivado: true
  });
  assert.deepStrictEqual(
    normalizarLista(legado.pagamentosFiscal),
    normalizarLista(preservar.pagamentosFiscal)
  );
  assert.strictEqual(preservar.decisao.valorFiscalEfetivo, 100);
});

test('PRESERVAR com margem — nunca fora do intervalo', () => {
  const fiscal = fo({ max: 100, min: 82, nf: 0 });
  const casos = [
    [{ forma_pagamento: 'pix', valor: 90 }],
    [{ forma_pagamento: 'pix', valor: 70 }, { forma_pagamento: 'dinheiro', valor: 30 }],
    [{ forma_pagamento: 'cartao_debito', valor: 150 }]
  ];
  for (const pagamentos of casos) {
    const r = MidpService.distribuir({
      fiscalOperacional: fiscal,
      pagamentos: clonar(pagamentos),
      midpPolitica: 'PRESERVAR_DINHEIRO',
      midpAtivado: true,
      origem: 'API'
    });
    const p = r.decisao.valorFiscalEfetivo;
    assert.ok(p >= 82 - 0.001 && p <= 100 + 0.001, `fora do intervalo: ${p}`);
    assert.ok(r.decisao.economiaDinheiro >= -0.001);
  }
});

test('PRESERVAR reduz dinheiro fiscal quando há margem', () => {
  const fiscal = fo({ max: 100, min: 82, nf: 0 });
  const r = MidpService.distribuir({
    fiscalOperacional: fiscal,
    pagamentos: [
      { forma_pagamento: 'pix', valor: 90 },
      { forma_pagamento: 'dinheiro', valor: 10 }
    ],
    midpPolitica: 'PRESERVAR_DINHEIRO',
    midpAtivado: true,
    origem: 'PDV'
  });
  assert.strictEqual(r.decisao.valorFiscalEfetivo, 90);
  assert.strictEqual(r.decisao.economiaDinheiro, 10);
  const somaFiscal = r.pagamentosFiscal.reduce((a, p) => a + Number(p.valor), 0);
  assert.ok(Math.abs(somaFiscal - 90) < 0.02);
});

const ORIGENS = ['PDV', 'COMERCIAL', 'CONSIGNACAO', 'PEDIDO', 'ORCAMENTO', 'API'];
for (const origem of ORIGENS) {
  test(`Origem ${origem} — política PRESERVAR funcional`, () => {
    const r = MidpService.distribuir({
      fiscalOperacional: fo({ max: 100, min: 80, nf: 0 }),
      pagamentos: [{ forma_pagamento: 'pix', valor: 85 }, { forma_pagamento: 'dinheiro', valor: 15 }],
      midpPolitica: 'PRESERVAR_DINHEIRO',
      midpAtivado: true,
      origem
    });
    assert.strictEqual(r.origem, origem);
    assert.strictEqual(r.politica, 'PRESERVAR_DINHEIRO');
    assert.strictEqual(r.decisao.valorFiscalEfetivo, 85);
  });
}

test('MidpDecisionResult.toJSON contrato oficial FINAL', () => {
  const d = new MidpDecisionResult({
    valorFiscalEfetivo: 90,
    quantidadeFiscal: 6,
    valorFiscalPIX: 80,
    valorFiscalDinheiro: 10,
    valorNaoFiscal: 60,
    quantidadeNaoFiscal: 4,
    economiaDinheiro: 60,
    politica: 'PRESERVAR_DINHEIRO',
    algoritmo: 'PreservarDinheiroPolicy.RC3.FINAL',
    tempoMs: 1
  });
  const json = d.toJSON();
  [
    'valorFiscalEfetivo',
    'quantidadeFiscal',
    'valorFiscalPIX',
    'valorFiscalDinheiro',
    'valorNaoFiscal',
    'quantidadeNaoFiscal',
    'economiaDinheiro',
    'politica',
    'algoritmo',
    'versao',
    'tempoMs'
  ].forEach((k) => assert.ok(Object.prototype.hasOwnProperty.call(json, k), k));
  assert.strictEqual(json.versao, 'RC3');
  assert.strictEqual(d.valorFiscalEfetivoProposto, 90);
});

test('Algoritmo FINAL identificado na política', () => {
  const r = MidpService.distribuir({
    fiscalOperacional: fo({ max: 100, min: 50, nf: 0 }),
    pagamentos: [{ forma_pagamento: 'pix', valor: 80 }],
    midpPolitica: 'PRESERVAR_DINHEIRO',
    midpAtivado: true
  });
  assert.strictEqual(r.algoritmo, 'PreservarDinheiroPolicy.RC3.FINAL');
  assert.strictEqual(r.decisao.algoritmo, 'PreservarDinheiroPolicy.RC3.FINAL');
});

console.log('\n=== MIDP RC3 FINAL — todos os testes OK ===');
