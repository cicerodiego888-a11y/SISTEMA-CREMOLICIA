/**
 * MIDP V1.0 — Certificação oficial (Sprint 3.8D.3.1)
 *
 * MODO: CERTIFICAÇÃO
 * NÃO altera algoritmos, regras fiscais ou funcionalidades.
 * Apenas valida Motor Fiscal × MIDP × Distribuidor × NFC-e × invariantes.
 */

'use strict';

const assert = require('assert');
const {
  fo,
  itemInteiro,
  itemFracionavel,
  executarCenario,
  assertInvariantes,
  arredondar2,
  EPS
} = require('./midpCertHelpers');

const resultados = [];
let aprovados = 0;
let reprovados = 0;

function test(name, fn) {
  try {
    fn();
    aprovados += 1;
    console.log(`OK ${name}`);
  } catch (error) {
    reprovados += 1;
    console.error(`FAIL ${name}`);
    console.error(error && error.message ? error.message : error);
    throw error;
  }
}

function registrar(r) {
  resultados.push({
    cenario: r.nome,
    status: 'APROVADO',
    valorFiscal: r.valorFiscal,
    valorNaoFiscal: r.valorNaoFiscal,
    qFiscal: r.qFiscal,
    qNaoFiscal: r.qNaoFiscal,
    pagFiscal: r.pagFiscalTotal,
    pagNaoFiscal: r.pagNaoFiscalTotal,
    xmlFecha: r.xmlFecha,
    complemento: r.complemento,
    economia: r.economia,
    tempoMs: r.tempoMs
  });
  assertInvariantes(r, assert);
}

console.log('====================================================');
console.log('MIDP V1.0 — CERTIFICAÇÃO OFICIAL');
console.log('====================================================\n');

// ─── CENÁRIO 1: Somente PIX · produto inteiro ─────────────────
test('C1 — Somente PIX · produto inteiro', () => {
  const itens = [itemInteiro({ qtd: 10, preco: 15 })];
  const r = executarCenario({
    nome: 'C1_SOMENTE_PIX_INTEIRO',
    itens,
    pagamentos: [{ forma_pagamento: 'pix', valor: 150 }],
    fiscalOperacional: fo({ max: 150, min: 0, nf: 0 })
  });
  assert.strictEqual(r.valorFiscal, 150);
  assert.strictEqual(r.qFiscal, 10);
  assert.ok(Math.abs(r.pixFiscal - 150) <= EPS);
  assert.ok(r.dinheiroFiscal <= EPS);
  assert.strictEqual(r.valorNaoFiscal, 0);
  registrar(r);
});

// ─── CENÁRIO 2: Somente Dinheiro · produto inteiro ────────────
test('C2 — Somente Dinheiro · produto inteiro', () => {
  const itens = [itemInteiro({ qtd: 10, preco: 15 })];
  const r = executarCenario({
    nome: 'C2_SOMENTE_DINHEIRO_INTEIRO',
    itens,
    pagamentos: [{ forma_pagamento: 'dinheiro', valor: 150 }],
    // Sem margem: dinheiro cobre 100% fiscal (comportamento obrigatório)
    fiscalOperacional: fo({ max: 150, min: 150, nf: 0 })
  });
  assert.strictEqual(r.valorFiscal, 150);
  assert.strictEqual(r.qFiscal, 10);
  assert.ok(Math.abs(r.dinheiroFiscal - 150) <= EPS);
  registrar(r);
});

// ─── CENÁRIO 3: PIX + Dinheiro · sem complemento ──────────────
test('C3 — PIX + Dinheiro · inteiro · sem complemento', () => {
  // PIX 90 = exatamente 6 × 15 → sem complemento
  const itens = [itemInteiro({ qtd: 10, preco: 15 })];
  const r = executarCenario({
    nome: 'C3_PIX_DINHEIRO_SEM_COMPLEMENTO',
    itens,
    pagamentos: [
      { forma_pagamento: 'pix', valor: 90 },
      { forma_pagamento: 'dinheiro', valor: 60 }
    ],
    fiscalOperacional: fo({ max: 150, min: 0, nf: 0 })
  });
  assert.strictEqual(r.decisao.quantidadeFiscal, 6);
  assert.strictEqual(r.valorFiscal, 90);
  assert.ok(Math.abs(r.pixFiscal - 90) <= EPS);
  assert.ok(r.dinheiroFiscal <= EPS, 'não deve usar complemento');
  assert.strictEqual(r.valorNaoFiscal, 60);
  assert.ok(Math.abs(r.dinheiroNaoFiscal - 60) <= EPS);
  registrar(r);
});

// ─── CENÁRIO 4: PIX + Dinheiro · com complemento mínimo ───────
test('C4 — PIX + Dinheiro · inteiro · complemento mínimo (lâmpadas)', () => {
  const itens = [itemInteiro({ qtd: 10, preco: 15 })];
  const r = executarCenario({
    nome: 'C4_COMPLEMENTO_MINIMO_LAMPADAS',
    itens,
    pagamentos: [
      { forma_pagamento: 'pix', valor: 80 },
      { forma_pagamento: 'dinheiro', valor: 70 }
    ],
    fiscalOperacional: fo({ max: 150, min: 0, nf: 0 })
  });
  assert.strictEqual(r.decisao.quantidadeFiscal, 6);
  assert.strictEqual(r.valorFiscal, 90);
  assert.ok(Math.abs(r.pixFiscal - 80) <= EPS);
  assert.ok(Math.abs(r.dinheiroFiscal - 10) <= EPS);
  assert.strictEqual(r.decisao.quantidadeNaoFiscal, 4);
  assert.strictEqual(r.valorNaoFiscal, 60);
  assert.ok(Math.abs(r.dinheiroNaoFiscal - 60) <= EPS);
  assert.strictEqual(r.economia, 60);
  registrar(r);
});

// ─── CENÁRIO 5: Fracionável · sem complemento ─────────────────
test('C5 — Fracionável · sem complemento (carne kg)', () => {
  const itens = [itemFracionavel({ qtd: 5, preco: 30, unidade: 'KG' })];
  const r = executarCenario({
    nome: 'C5_FRACIONAVEL_KG',
    itens,
    pagamentos: [
      { forma_pagamento: 'pix', valor: 80 },
      { forma_pagamento: 'dinheiro', valor: 70 }
    ],
    fiscalOperacional: fo({ max: 150, min: 0, nf: 0 })
  });
  assert.ok(Math.abs(r.decisao.quantidadeFiscal - (80 / 30)) < 0.001);
  assert.ok(Math.abs(r.valorFiscal - 80) <= EPS);
  assert.ok(Math.abs(r.pixFiscal - 80) <= EPS);
  assert.ok(r.dinheiroFiscal <= EPS);
  assert.ok(Math.abs(r.decisao.quantidadeNaoFiscal - (5 - 80 / 30)) < 0.001);
  assert.ok(Math.abs(r.valorNaoFiscal - 70) <= EPS);
  assert.ok(Math.abs(r.dinheiroNaoFiscal - 70) <= EPS);
  registrar(r);
});

// ─── CENÁRIO 6: Venda mista ───────────────────────────────────
test('C6 — Venda mista · inteiro + fracionável', () => {
  const itens = [
    itemFracionavel({ qtd: 5, preco: 20, unidade: 'KG' }),
    itemInteiro({ qtd: 8, preco: 10 })
  ];
  const r = executarCenario({
    nome: 'C6_MISTA',
    itens,
    pagamentos: [
      { forma_pagamento: 'pix', valor: 100 },
      { forma_pagamento: 'dinheiro', valor: 80 }
    ],
    fiscalOperacional: fo({ max: 180, min: 0, nf: 0 })
  });
  const adjInt = r.itensFinais[1];
  assert.ok(
    Math.abs(adjInt.quantidade_fiscal - Math.round(adjInt.quantidade_fiscal)) < 1e-9,
    'inteiro não pode ter fração'
  );
  assert.ok(r.valorFiscal <= 180 + EPS);
  assert.ok(r.economia >= -EPS);
  registrar(r);
});

// ─── CENÁRIO 7: Diversas unidades ─────────────────────────────
test('C7 — Diversas unidades UN KG M L CX FD', () => {
  const casos = [
    { item: itemInteiro({ qtd: 4, preco: 25, unidade: 'UN' }), pag: 100, max: 100 },
    { item: itemFracionavel({ qtd: 2.5, preco: 40, unidade: 'KG' }), pag: 100, max: 100 },
    { item: itemFracionavel({ qtd: 3, preco: 10, unidade: 'M' }), pag: 30, max: 30 },
    { item: itemFracionavel({ qtd: 1.5, preco: 20, unidade: 'L' }), pag: 30, max: 30 },
    { item: itemInteiro({ qtd: 2, preco: 50, unidade: 'CX' }), pag: 100, max: 100 },
    { item: itemInteiro({ qtd: 1, preco: 80, unidade: 'FD' }), pag: 80, max: 80 }
  ];
  for (const c of casos) {
    const r = executarCenario({
      nome: `C7_UNIDADE_${c.item.unidade}`,
      itens: [c.item],
      pagamentos: [{ forma_pagamento: 'pix', valor: c.pag }],
      fiscalOperacional: fo({ max: c.max, min: 0, nf: 0 })
    });
    if (!c.item.produto_fracionado) {
      assert.ok(
        Math.abs(r.qFiscal - Math.round(r.qFiscal)) < 1e-9,
        `${c.item.unidade}: quantidade fiscal deve ser inteira`
      );
    }
    registrar(r);
  }
});

// ─── CENÁRIO 8: Diversos meios ────────────────────────────────
test('C8 — Diversos meios PIX Débito Crédito Voucher Dinheiro', () => {
  const itens = [itemInteiro({ qtd: 10, preco: 20 })];
  const r = executarCenario({
    nome: 'C8_DIVERSOS_MEIOS',
    itens,
    pagamentos: [
      { forma_pagamento: 'pix', valor: 40 },
      { forma_pagamento: 'cartao_debito', valor: 30 },
      { forma_pagamento: 'cartao_credito', valor: 20 },
      { forma_pagamento: 'voucher', valor: 10 },
      { forma_pagamento: 'dinheiro', valor: 100 }
    ],
    fiscalOperacional: fo({ max: 200, min: 0, nf: 0 })
  });
  // eletrônico = 100 → exatamente 5 un × 20
  assert.strictEqual(r.valorFiscal, 100);
  assert.ok(r.dinheiroFiscal <= EPS);
  assert.strictEqual(r.valorNaoFiscal, 100);
  registrar(r);
});

// ─── CENÁRIO 9: Eletrônico = mínimo fiscal ────────────────────
test('C9 — Valor eletrônico igual ao mínimo fiscal', () => {
  const itens = [itemInteiro({ qtd: 10, preco: 10 })];
  const r = executarCenario({
    nome: 'C9_ELETRONICO_IGUAL_MINIMO',
    itens,
    pagamentos: [
      { forma_pagamento: 'pix', valor: 80 },
      { forma_pagamento: 'dinheiro', valor: 20 }
    ],
    fiscalOperacional: fo({ max: 100, min: 80, nf: 0 })
  });
  assert.strictEqual(r.valorFiscal, 80);
  assert.ok(Math.abs(r.pixFiscal - 80) <= EPS);
  assert.ok(r.dinheiroFiscal <= EPS);
  assert.strictEqual(r.economia, 20);
  registrar(r);
});

// ─── CENÁRIO 10: Eletrônico = máximo fiscal ───────────────────
test('C10 — Valor eletrônico igual ao máximo fiscal', () => {
  const itens = [itemInteiro({ qtd: 10, preco: 10 })];
  const r = executarCenario({
    nome: 'C10_ELETRONICO_IGUAL_MAXIMO',
    itens,
    pagamentos: [
      { forma_pagamento: 'pix', valor: 100 },
      { forma_pagamento: 'dinheiro', valor: 50 }
    ],
    fiscalOperacional: fo({ max: 100, min: 50, nf: 0 })
  });
  assert.strictEqual(r.valorFiscal, 100);
  assert.strictEqual(r.economia, 0);
  assert.ok(r.dinheiroFiscal <= EPS);
  registrar(r);
});

// ─── CENÁRIO 11: Complemento R$0,01 ───────────────────────────
test('C11 — Complemento R$0,01 (arredondamento)', () => {
  // 29,99 / 10 = 2,999 → ceil 3 → R$30,00 → complemento 0,01
  const itens = [itemInteiro({ qtd: 5, preco: 10 })];
  const r = executarCenario({
    nome: 'C11_COMPLEMENTO_001',
    itens,
    pagamentos: [
      { forma_pagamento: 'pix', valor: 29.99 },
      { forma_pagamento: 'dinheiro', valor: 20.01 }
    ],
    fiscalOperacional: fo({ max: 50, min: 0, nf: 0 })
  });
  assert.strictEqual(r.decisao.quantidadeFiscal, 3);
  assert.strictEqual(r.valorFiscal, 30);
  assert.ok(Math.abs(r.complemento - 0.01) <= EPS);
  assert.ok(Math.abs(r.pixFiscal - 29.99) <= EPS);
  assert.ok(Math.abs(r.dinheiroFiscal - 0.01) <= EPS);
  registrar(r);
});

// ─── CENÁRIO 12: Complementos 0,02 / 0,05 / 0,10 ───────────────
test('C12 — Complementos R$0,02 R$0,05 R$0,10', () => {
  const casos = [
    { pix: 29.98, comp: 0.02, nome: '002' },
    { pix: 29.95, comp: 0.05, nome: '005' },
    { pix: 29.9, comp: 0.1, nome: '010' }
  ];
  for (const c of casos) {
    const r = executarCenario({
      nome: `C12_COMPLEMENTO_${c.nome}`,
      itens: [itemInteiro({ qtd: 5, preco: 10 })],
      pagamentos: [
        { forma_pagamento: 'pix', valor: c.pix },
        { forma_pagamento: 'dinheiro', valor: arredondar2(20 + c.comp) }
      ],
      fiscalOperacional: fo({ max: 50, min: 0, nf: 0 })
    });
    assert.strictEqual(r.decisao.quantidadeFiscal, 3, c.nome);
    assert.strictEqual(r.valorFiscal, 30, c.nome);
    assert.ok(Math.abs(r.complemento - c.comp) <= EPS, `${c.nome}: complemento=${r.complemento}`);
    registrar(r);
  }
});

// ─── CENÁRIO 13: Apenas fiscal ────────────────────────────────
test('C13 — Venda apenas fiscal', () => {
  const itens = [itemInteiro({ qtd: 5, preco: 20, qFiscal: 5, qNao: 0 })];
  const r = executarCenario({
    nome: 'C13_APENAS_FISCAL',
    itens,
    pagamentos: [{ forma_pagamento: 'pix', valor: 100 }],
    fiscalOperacional: fo({ max: 100, min: 100, nf: 0 })
  });
  assert.strictEqual(r.valorFiscal, 100);
  assert.strictEqual(r.valorNaoFiscal, 0);
  assert.strictEqual(r.pagNaoFiscalTotal, 0);
  registrar(r);
});

// ─── CENÁRIO 14: Apenas não fiscal ────────────────────────────
test('C14 — Venda apenas não fiscal', () => {
  const itens = [itemInteiro({ qtd: 5, preco: 20, qFiscal: 0, qNao: 5 })];
  itens[0].valor_fiscal = 0;
  itens[0].valor_nao_fiscal = 100;
  const r = executarCenario({
    nome: 'C14_APENAS_NAO_FISCAL',
    itens,
    pagamentos: [{ forma_pagamento: 'dinheiro', valor: 100 }],
    fiscalOperacional: fo({ max: 0, min: 0, nf: 100 })
  });
  assert.strictEqual(r.valorFiscal, 0);
  assert.strictEqual(r.valorNaoFiscal, 100);
  assert.strictEqual(r.pagFiscalTotal, 0);
  assert.ok(r.xmlFecha);
  registrar(r);
});

// ─── CENÁRIO 15: Híbrida ──────────────────────────────────────
test('C15 — Venda híbrida', () => {
  const itens = [itemInteiro({ qtd: 10, preco: 10, qFiscal: 6, qNao: 4 })];
  // max fiscal 60, já tem NF 40 no estoque; margem permite reduzir fiscal
  const r = executarCenario({
    nome: 'C15_HIBRIDA',
    itens,
    pagamentos: [
      { forma_pagamento: 'pix', valor: 50 },
      { forma_pagamento: 'dinheiro', valor: 50 }
    ],
    fiscalOperacional: fo({ max: 60, min: 0, nf: 40 })
  });
  // PIX 50 = exatamente 5 × 10
  assert.strictEqual(r.valorFiscal, 50);
  assert.ok(r.dinheiroFiscal <= EPS);
  assert.strictEqual(r.valorNaoFiscal, 50); // 40 + economia 10
  registrar(r);
});

// ─── Resumo ───────────────────────────────────────────────────
console.log('\n====================================================');
console.log(`APROVADOS: ${aprovados}`);
console.log(`REPROVADOS: ${reprovados}`);
console.log(`TOTAL CENÁRIOS (assertions): ${aprovados + reprovados}`);
console.log('====================================================');

if (reprovados > 0) {
  process.exitCode = 1;
  console.log('\nCONCLUSÃO: REPROVADO — MIDP V1.0 NÃO homologado.');
} else {
  console.log('\nCONCLUSÃO: APROVADO — MIDP V1.0 homologável (cenários funcionais).');
}

module.exports = { resultados, aprovados, reprovados };
