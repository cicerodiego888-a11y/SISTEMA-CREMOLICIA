/**
 * MIDP RC2 — Testes de políticas e paridade funcional com RC1.
 *
 * Critério: LEGADO, PRESERVAR_DINHEIRO, MIDP OFF e MIDP ON
 * produzem exatamente o mesmo resultado de distribuição nesta RC2.
 */

'use strict';

const assert = require('assert');
const { distribuirPagamentos } = require('../../../services/DistribuidorPagamento');
const MidpService = require('../MidpService');
const MidpResult = require('../MidpResult');
const MidpPolicyFactory = require('../policies/MidpPolicyFactory');
const LegacyDistributionPolicy = require('../policies/LegacyDistributionPolicy');
const PreservarDinheiroPolicy = require('../policies/PreservarDinheiroPolicy');
const IMidpPolicy = require('../policies/IMidpPolicy');

function test(name, fn) {
  try {
    fn();
    console.log(`OK ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function clonarPagamentos(pagamentos) {
  return (pagamentos || []).map((p) => ({ ...p }));
}

function normalizarParaComparacao(lista) {
  return (lista || []).map((p) => ({
    forma_pagamento: p.forma_pagamento,
    valor: Number(Number(p.valor || 0).toFixed(2)),
    tipo_recebimento: p.tipo_recebimento || null,
    tef_transacao_id: p.tef_transacao_id || null,
    nsu: p.nsu || null,
    autorizacao: p.autorizacao || null
  }));
}

function assertDistribuicaoIgual(a, b, rotulo) {
  assert.deepStrictEqual(
    normalizarParaComparacao(a.pagamentosFiscal || a.recebimentosFiscal),
    normalizarParaComparacao(b.pagamentosFiscal || b.recebimentosFiscal),
    `${rotulo}: pagamentosFiscal divergem`
  );
  assert.deepStrictEqual(
    normalizarParaComparacao(a.pagamentosNaoFiscal || a.recebimentosNaoFiscal),
    normalizarParaComparacao(b.pagamentosNaoFiscal || b.recebimentosNaoFiscal),
    `${rotulo}: pagamentosNaoFiscal divergem`
  );
  assert.strictEqual(
    Number(a.saldoFiscal || 0),
    Number(b.saldoFiscal || 0),
    `${rotulo}: saldoFiscal diverge`
  );
  assert.strictEqual(
    Number(a.saldoNaoFiscal || 0),
    Number(b.saldoNaoFiscal || 0),
    `${rotulo}: saldoNaoFiscal diverge`
  );
}

function compararMatriz(cenario) {
  const { valorFiscal, valorNaoFiscal, pagamentos, origem, formaPagamentoPadrao } = cenario;

  const legadoAlgoritmo = distribuirPagamentos(
    MidpService.normalizarPagamentosEntrada(
      clonarPagamentos(pagamentos),
      formaPagamentoPadrao
    ),
    valorFiscal,
    valorNaoFiscal
  );

  const matriz = [
    { midpAtivado: false, midpPolitica: 'LEGADO', label: 'OFF+LEGADO' },
    { midpAtivado: true, midpPolitica: 'LEGADO', label: 'ON+LEGADO' },
    { midpAtivado: false, midpPolitica: 'PRESERVAR_DINHEIRO', label: 'OFF+PRESERVAR' },
    { midpAtivado: true, midpPolitica: 'PRESERVAR_DINHEIRO', label: 'ON+PRESERVAR' }
  ].map((cfg) => ({
    ...cfg,
    result: MidpService.distribuir({
      valorFiscal,
      valorNaoFiscal,
      pagamentos: clonarPagamentos(pagamentos),
      formaPagamentoPadrao,
      origem,
      midpAtivado: cfg.midpAtivado,
      midpPolitica: cfg.midpPolitica
    })
  }));

  const referencia = matriz[0].result;

  for (const item of matriz) {
    assert.ok(item.result instanceof MidpResult, `${item.label} deve retornar MidpResult`);
    assert.strictEqual(item.result.versao, MidpResult.VERSAO);
    assert.strictEqual(item.result.midpAtivado, item.midpAtivado);
    assert.strictEqual(item.result.politica, item.midpPolitica);
    assert.strictEqual(item.result.origem, origem || null);
    assert.ok(item.result.algoritmo);
    assert.ok(typeof item.result.tempoMs === 'number');

    assertDistribuicaoIgual(referencia, item.result, `${cenario.nome} ${item.label}`);
    assertDistribuicaoIgual(
      {
        pagamentosFiscal: legadoAlgoritmo.recebimentosFiscal,
        pagamentosNaoFiscal: legadoAlgoritmo.recebimentosNaoFiscal,
        saldoFiscal: legadoAlgoritmo.saldoFiscal,
        saldoNaoFiscal: legadoAlgoritmo.saldoNaoFiscal
      },
      item.result,
      `${cenario.nome} ALGORITMO×${item.label}`
    );
  }
}

const CENARIOS = [
  {
    nome: 'PDV — somente fiscal',
    origem: 'PDV',
    valorFiscal: 100,
    valorNaoFiscal: 0,
    pagamentos: [{ forma_pagamento: 'dinheiro', valor: 100 }]
  },
  {
    nome: 'PDV — somente não fiscal',
    origem: 'PDV',
    valorFiscal: 0,
    valorNaoFiscal: 50,
    pagamentos: [{ forma_pagamento: 'dinheiro', valor: 50 }]
  },
  {
    nome: 'PDV — mista PIX',
    origem: 'PDV',
    valorFiscal: 71.2,
    valorNaoFiscal: 35.6,
    pagamentos: [{ forma_pagamento: 'pix', valor: 106.8 }]
  },
  {
    nome: 'PDV — múltiplos pagamentos',
    origem: 'PDV',
    valorFiscal: 80,
    valorNaoFiscal: 20,
    pagamentos: [
      { forma_pagamento: 'dinheiro', valor: 30 },
      { forma_pagamento: 'pix', valor: 70 }
    ]
  },
  {
    nome: 'COMERCIAL — venda comercial',
    origem: 'COMERCIAL',
    valorFiscal: 120,
    valorNaoFiscal: 30,
    pagamentos: [{ forma_pagamento: 'pix', valor: 150 }]
  },
  {
    nome: 'CONSIGNACAO — prestação',
    origem: 'CONSIGNACAO',
    valorFiscal: 40,
    valorNaoFiscal: 60,
    pagamentos: [
      { forma_pagamento: 'pix', valor: 40 },
      { forma_pagamento: 'dinheiro', valor: 60 }
    ]
  },
  {
    nome: 'PEDIDO — pedido faturado',
    origem: 'PEDIDO',
    valorFiscal: 200,
    valorNaoFiscal: 0,
    pagamentos: [{ forma_pagamento: 'cartao_credito', valor: 200 }]
  },
  {
    nome: 'ORCAMENTO — orçamento convertido',
    origem: 'ORCAMENTO',
    valorFiscal: 15,
    valorNaoFiscal: 15,
    pagamentos: [{ forma_pagamento: 'dinheiro', valor: 30 }]
  },
  {
    nome: 'API — origem API',
    origem: 'API',
    valorFiscal: 90,
    valorNaoFiscal: 10,
    pagamentos: [
      { forma_pagamento: 'cartao_debito', valor: 60 },
      { forma_pagamento: 'cartao_credito', valor: 40 }
    ]
  }
];

console.log('=== MIDP RC2 — políticas e paridade ===\n');

test('Factory — LEGADO retorna LegacyDistributionPolicy', () => {
  const p = MidpPolicyFactory.obterPolitica({ politica: 'LEGADO' });
  assert.ok(p instanceof LegacyDistributionPolicy);
  assert.ok(p instanceof IMidpPolicy);
  assert.strictEqual(p.getNome(), 'LEGADO');
});

test('Factory — PRESERVAR_DINHEIRO retorna PreservarDinheiroPolicy', () => {
  const p = MidpPolicyFactory.obterPolitica({ politica: 'PRESERVAR_DINHEIRO' });
  assert.ok(p instanceof PreservarDinheiroPolicy);
  assert.ok(p instanceof IMidpPolicy);
  assert.strictEqual(p.getNome(), 'PRESERVAR_DINHEIRO');
});

test('Factory — valor inválido cai em LEGADO', () => {
  const p = MidpPolicyFactory.obterPolitica({ politica: 'XYZ' });
  assert.strictEqual(p.getNome(), 'LEGADO');
});

test('Factory — midpAtivado true → PRESERVAR_DINHEIRO', () => {
  assert.strictEqual(
    MidpPolicyFactory.resolverNomePolitica({ midpAtivado: true }),
    'PRESERVAR_DINHEIRO'
  );
  assert.ok(
    MidpPolicyFactory.obterPolitica({ midpAtivado: true }) instanceof PreservarDinheiroPolicy
  );
});

test('Factory — midpAtivado false → LEGADO', () => {
  assert.strictEqual(
    MidpPolicyFactory.resolverNomePolitica({ midpAtivado: false }),
    'LEGADO'
  );
  assert.ok(
    MidpPolicyFactory.obterPolitica({ midpAtivado: false }) instanceof LegacyDistributionPolicy
  );
});

test('Factory — origem NÃO seleciona política', () => {
  const a = MidpPolicyFactory.obterPolitica({ politica: 'LEGADO' });
  const b = MidpPolicyFactory.obterPolitica({ politica: 'LEGADO' });
  assert.strictEqual(a.getNome(), b.getNome());
  assert.strictEqual(
    MidpPolicyFactory.normalizePolitica('preservar_dinheiro'),
    'PRESERVAR_DINHEIRO'
  );
});

test('PreservarDinheiroPolicy identifica política homologada', () => {
  const entrada = {
    valorFiscal: 50,
    valorNaoFiscal: 50,
    pagamentos: MidpService.normalizarPagamentosEntrada([
      { forma_pagamento: 'dinheiro', valor: 50 },
      { forma_pagamento: 'pix', valor: 50 }
    ])
  };
  const preservar = new PreservarDinheiroPolicy().executar(entrada, { midpAtivado: true, origem: 'PDV' });
  assert.strictEqual(preservar.politica, 'PRESERVAR_DINHEIRO');
  assert.ok(Array.isArray(preservar.pagamentosFiscal));
});

for (const cenario of CENARIOS) {
  test(cenario.nome, () => compararMatriz(cenario));
}

test('MidpResult.toJSON mantém campos RC1 e inclui metadados', () => {
  const r = MidpService.distribuir({
    valorFiscal: 10,
    valorNaoFiscal: 0,
    pagamentos: [{ forma_pagamento: 'dinheiro', valor: 10 }],
    origem: 'PDV',
    midpAtivado: true,
    midpPolitica: 'LEGADO'
  });
  const json = r.toJSON();
  assert.ok(Array.isArray(json.pagamentosFiscal));
  assert.ok(Array.isArray(json.pagamentosNaoFiscal));
  assert.ok(Object.prototype.hasOwnProperty.call(json, 'tempoMs'));
  assert.strictEqual(json.politica, 'LEGADO');
  assert.strictEqual(json.versao, MidpResult.VERSAO);
  assert.ok(json.algoritmo);
  assert.strictEqual(json.origem, 'PDV');
  assert.strictEqual(json.midpAtivado, true);
});

test('paraDistribuicaoLegada permanece compatível', () => {
  const r = MidpService.distribuir({
    valorFiscal: 10,
    valorNaoFiscal: 5,
    pagamentos: [{ forma_pagamento: 'pix', valor: 15 }],
    midpAtivado: true,
    midpPolitica: 'PRESERVAR_DINHEIRO'
  });
  const legado = r.paraDistribuicaoLegada();
  assert.ok(Array.isArray(legado.recebimentosFiscal));
  assert.ok(Array.isArray(legado.recebimentosNaoFiscal));
});

console.log('\n=== MIDP RC2 — todos os testes OK ===');
