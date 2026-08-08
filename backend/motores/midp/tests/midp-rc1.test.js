/**
 * MIDP RC1 — Testes de paridade OFF/ON e cenários de distribuição.
 *
 * Critério: MIDP OFF e MIDP ON produzem exatamente o mesmo resultado
 * (mesmo algoritmo legado encapsulado).
 */

'use strict';

const assert = require('assert');
const { distribuirPagamentos } = require('../../../services/DistribuidorPagamento');
const MidpService = require('../MidpService');
const MidpResult = require('../MidpResult');

function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result
        .then(() => {
          console.log(`OK ${name}`);
        })
        .catch((error) => {
          console.error(`FAIL ${name}`);
          throw error;
        });
    }
    console.log(`OK ${name}`);
    return Promise.resolve();
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

function compararOffOnLegado(cenario) {
  const { valorFiscal, valorNaoFiscal, pagamentos, origem, formaPagamentoPadrao } = cenario;

  const legado = distribuirPagamentos(
    MidpService.normalizarPagamentosEntrada(
      clonarPagamentos(pagamentos),
      formaPagamentoPadrao
    ),
    valorFiscal,
    valorNaoFiscal
  );

  const off = MidpService.distribuir({
    valorFiscal,
    valorNaoFiscal,
    pagamentos: clonarPagamentos(pagamentos),
    formaPagamentoPadrao,
    origem,
    midpAtivado: false
  });

  const on = MidpService.distribuir({
    valorFiscal,
    valorNaoFiscal,
    pagamentos: clonarPagamentos(pagamentos),
    formaPagamentoPadrao,
    origem,
    midpAtivado: true
  });

  assert.ok(off instanceof MidpResult, 'OFF deve retornar MidpResult');
  assert.ok(on instanceof MidpResult, 'ON deve retornar MidpResult');
  assert.strictEqual(off.midpAtivado, false);
  assert.strictEqual(on.midpAtivado, true);
  assert.strictEqual(off.versao, MidpResult.VERSAO);
  assert.strictEqual(on.versao, MidpResult.VERSAO);
  assert.ok(typeof off.tempoMs === 'number');
  assert.ok(typeof on.tempoMs === 'number');

  assertDistribuicaoIgual(off, on, `${cenario.nome} OFF×ON`);
  assertDistribuicaoIgual(
    {
      pagamentosFiscal: legado.recebimentosFiscal,
      pagamentosNaoFiscal: legado.recebimentosNaoFiscal,
      saldoFiscal: legado.saldoFiscal,
      saldoNaoFiscal: legado.saldoNaoFiscal
    },
    off,
    `${cenario.nome} LEGADO×OFF`
  );
  assertDistribuicaoIgual(
    {
      pagamentosFiscal: legado.recebimentosFiscal,
      pagamentosNaoFiscal: legado.recebimentosNaoFiscal,
      saldoFiscal: legado.saldoFiscal,
      saldoNaoFiscal: legado.saldoNaoFiscal
    },
    on,
    `${cenario.nome} LEGADO×ON`
  );

  const json = on.toJSON();
  assert.ok(Array.isArray(json.pagamentosFiscal));
  assert.ok(Array.isArray(json.pagamentosNaoFiscal));
  assert.ok(Object.prototype.hasOwnProperty.call(json, 'tempoMs'));
}

const CENARIOS = [
  {
    nome: 'PDV — somente fiscal — dinheiro',
    origem: 'PDV',
    valorFiscal: 100,
    valorNaoFiscal: 0,
    pagamentos: [{ forma_pagamento: 'dinheiro', valor: 100 }]
  },
  {
    nome: 'PDV — somente não fiscal — dinheiro',
    origem: 'PDV',
    valorFiscal: 0,
    valorNaoFiscal: 50,
    pagamentos: [{ forma_pagamento: 'dinheiro', valor: 50 }]
  },
  {
    nome: 'PDV — venda mista — pix',
    origem: 'PDV',
    valorFiscal: 71.2,
    valorNaoFiscal: 35.6,
    pagamentos: [{ forma_pagamento: 'pix', valor: 106.8 }]
  },
  {
    nome: 'PDV — múltiplos pagamentos — pix + dinheiro',
    origem: 'PDV',
    valorFiscal: 80,
    valorNaoFiscal: 20,
    pagamentos: [
      { forma_pagamento: 'dinheiro', valor: 30 },
      { forma_pagamento: 'pix', valor: 70 }
    ]
  },
  {
    nome: 'PDV — cartão débito + crédito',
    origem: 'PDV',
    valorFiscal: 90,
    valorNaoFiscal: 10,
    pagamentos: [
      { forma_pagamento: 'cartao_credito', valor: 40 },
      { forma_pagamento: 'cartao_debito', valor: 60 }
    ]
  },
  {
    nome: 'PDV — TEF (nsu/autorizacao preservados no rateio)',
    origem: 'PDV',
    valorFiscal: 50,
    valorNaoFiscal: 50,
    pagamentos: [{
      forma_pagamento: 'cartao_debito',
      valor: 100,
      tef_transacao_id: 99,
      nsu: 'NSU123',
      autorizacao: 'AUT456'
    }]
  },
  {
    nome: 'COMERCIAL — venda comercial mista',
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
    nome: 'PEDIDO — pedido faturado somente fiscal',
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
    nome: 'Prioridade — pix antes de dinheiro no fiscal',
    origem: 'PDV',
    valorFiscal: 50,
    valorNaoFiscal: 50,
    pagamentos: [
      { forma_pagamento: 'dinheiro', valor: 50 },
      { forma_pagamento: 'pix', valor: 50 }
    ]
  }
];

console.log('=== MIDP RC1 — testes de paridade ===\n');

for (const cenario of CENARIOS) {
  test(cenario.nome, () => compararOffOnLegado(cenario));
}

test('Contrato toJSON preserva campos RC1', () => {
  const r = MidpService.distribuir({
    valorFiscal: 10,
    valorNaoFiscal: 0,
    pagamentos: [{ forma_pagamento: 'dinheiro', valor: 10 }],
    midpAtivado: true
  });
  const json = r.toJSON();
  assert.ok(Array.isArray(json.pagamentosFiscal));
  assert.ok(Array.isArray(json.pagamentosNaoFiscal));
  assert.ok(Object.prototype.hasOwnProperty.call(json, 'tempoMs'));
});

test('paraDistribuicaoLegada compatível com Orquestrador', () => {
  const r = MidpService.distribuir({
    valorFiscal: 10,
    valorNaoFiscal: 5,
    pagamentos: [{ forma_pagamento: 'pix', valor: 15 }],
    midpAtivado: true
  });
  const legado = r.paraDistribuicaoLegada();
  assert.ok(Array.isArray(legado.recebimentosFiscal));
  assert.ok(Array.isArray(legado.recebimentosNaoFiscal));
  assert.strictEqual(typeof legado.saldoFiscal, 'number');
  assert.strictEqual(typeof legado.saldoNaoFiscal, 'number');
});

test('Orquestrador consome MidpResult sem DistribuidorPagamento direto', async () => {
  const OrquestradorPagamento = require('../../../services/OrquestradorPagamento');
  const midpResult = MidpService.distribuir({
    valorFiscal: 71.2,
    valorNaoFiscal: 35.6,
    pagamentos: [{ forma_pagamento: 'pix', valor: 106.8 }],
    origem: 'PDV',
    midpAtivado: true,
    midpPolitica: 'LEGADO'
  });

  const resultado = await OrquestradorPagamento.processarFluxoPagamentoVenda({
    totalFiscal: 71.2,
    totalNaoFiscal: 35.6,
    formaPagamento: 'pix',
    pagamentos: [{ forma_pagamento: 'pix', valor: 106.8 }],
    tefHabilitado: false,
    modoConfirmacaoFiscal: 'MANUAL',
    midpResult,
    origem: 'PDV'
  });

  assert.strictEqual(resultado.sucesso, true);
  // PIX cobre fiscal + não fiscal via MIDP → quitada (sem saldo NF pendente)
  assert.strictEqual(resultado.statusPagamento, 'quitada');
  assert.strictEqual(resultado.distribuicao.recebimentosFiscal.length, 1);
  assert.strictEqual(resultado.midp, midpResult);
}).then(() => {
  console.log('\n=== MIDP RC1 — todos os testes OK ===');
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
