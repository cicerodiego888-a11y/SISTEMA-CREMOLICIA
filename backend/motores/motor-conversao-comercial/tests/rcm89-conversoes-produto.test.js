/**
 * RCM-8.9 — Conversões canônicas + conversões permanentes do produto
 */
const assert = require('assert');
const path = require('path');

const muc = require(path.join(__dirname, '..', '..', 'muc'));
const mcc = require('..');
const {
  ConversaoNaoCadastradaError,
  resolverUnidadeComercialOficial,
  Converter,
  PdvConversaoOrchestrator
} = mcc;

async function test(nome, fn) {
  try {
    await fn();
    console.log(`  OK  ${nome}`);
  } catch (e) {
    console.error(`  FAIL ${nome}`);
    throw e;
  }
}

async function run() {
  console.log('RCM-8.9 — Conversões do Produto / Canônicas MUC\n');

  await test('Canônicas: M2 ↔ CM2 e M3 ↔ CM3', async () => {
    const a = muc.resolverFatorConversao('M2', 'CM2');
    assert.ok(a);
    assert.strictEqual(a.fator, 10000);
    const b = muc.resolverFatorConversao('M3', 'CM3');
    assert.ok(b);
    assert.strictEqual(b.fator, 1000000);
  });

  await test('Canônicas: L↔ML sem cadastro no produto', async () => {
    const r = Converter({
      produto: { id: 1, unidade: 'L', conversoes: [] },
      quantidade: 500,
      unidadeOrigem: 'ML',
      unidadeBase: 'L',
      contexto: 'PDV'
    });
    assert.strictEqual(r.quantidadeConvertida, 0.5);
  });

  await test('Produto LT→KG 0,58: tabela em KG baixa estoque em LT', async () => {
    const produto = {
      id: 10,
      unidade: 'L',
      conversoes: [
        { origem: 'LT', destino: 'KG', fator: 0.58, tipo: 'FIXA', ativo: 1 }
      ]
    };
    const u = resolverUnidadeComercialOficial({
      produto,
      codigo: 'KG',
      unidadeBase: 'L'
    });
    assert.ok(Math.abs(u.quantidade - (1 / 0.58)) < 1e-9);

    const r = Converter({
      produto,
      quantidade: 0.58,
      unidadeOrigem: 'KG',
      unidadeBase: 'L',
      contexto: 'PDV'
    });
    assert.ok(Math.abs(r.quantidadeConvertida - 1) < 1e-6);
  });

  await test('Produto prioriza conversão específica antes da canônica', async () => {
    // Sem produto: 1 L = 1000 ML. Com produto customizado LT→ML 900.
    const produto = {
      id: 11,
      unidade: 'L',
      conversoes: [
        { origem: 'LT', destino: 'ML', fator: 900, tipo: 'FIXA', ativo: 1 }
      ]
    };
    const r = Converter({
      produto,
      quantidade: 900,
      unidadeOrigem: 'ML',
      unidadeBase: 'L',
      contexto: 'PDV'
    });
    assert.ok(Math.abs(r.quantidadeConvertida - 1) < 1e-6);
  });

  await test('Sem conversão produto nem canônica → erro oficial', async () => {
    let err = null;
    try {
      Converter({
        produto: { id: 12, unidade: 'UN', conversoes: [] },
        quantidade: 1,
        unidadeOrigem: 'KG',
        unidadeBase: 'UN',
        contexto: 'PDV'
      });
    } catch (e) {
      err = e;
    }
    assert.ok(err instanceof ConversaoNaoCadastradaError || err.codigo === 'MCC_CONVERSAO_NAO_CADASTRADA');
    assert.match(err.message, /Conversão entre KG e UN não cadastrada/);
  });

  await test('PDV orchestrator usa conversoes do produto', async () => {
    const orch = new PdvConversaoOrchestrator({ mcc: mcc.motor });
    const r = orch.processarItem({
      produto: {
        id: 13,
        unidade: 'L',
        conversoes: [{ origem: 'L', destino: 'KG', fator: 0.58, tipo: 'FIXA', ativo: 1 }]
      },
      quantidade: 1.16,
      unidadeOrigem: 'KG'
    });
    assert.ok(Math.abs(r.quantidadeConvertida - 2) < 1e-6);
  });

  await test('resolverFatorNasConversoes inverso', async () => {
    const f = muc.resolverFatorNasConversoes(
      [{ origem: 'PEÇA', destino: 'KG', fator: 2.45, ativo: 1 }],
      'KG',
      'PEÇA'
    );
    assert.ok(f);
    assert.ok(Math.abs(f.fator - (1 / 2.45)) < 1e-9);
    assert.strictEqual(f.sentido, 'inverso');
  });

  console.log('\nRCM-8.9 OK');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
