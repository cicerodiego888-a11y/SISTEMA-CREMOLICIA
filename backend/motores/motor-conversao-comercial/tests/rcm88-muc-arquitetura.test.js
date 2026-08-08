/**
 * RCM-8.8 — Adequação MUC à arquitetura comercial (UC na tabela, base no produto)
 */
const assert = require('assert');
const path = require('path');

const muc = require(path.join(__dirname, '..', '..', 'muc'));
const mcc = require('..');
const {
  ConversaoNaoCadastradaError,
  resolverUnidadeComercialOficial,
  PdvConversaoOrchestrator,
  Converter
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
  console.log('RCM-8.8 — MUC / Unidade Comercial da Tabela\n');

  await test('Produto só com base: UC = base → identidade', async () => {
    const produto = { id: 1, unidade: 'KG', unidades_comercializacao: [] };
    const u = resolverUnidadeComercialOficial({
      produto,
      codigo: 'KG',
      unidadeBase: 'KG'
    });
    assert.strictEqual(u.codigo, 'KG');
    assert.strictEqual(u.quantidade, 1);
    const r = Converter({
      produto,
      quantidade: 2.5,
      unidadeOrigem: 'KG',
      unidadeBase: 'KG',
      contexto: 'PDV'
    });
    assert.strictEqual(r.quantidadeConvertida, 2.5);
  });

  await test('Tabela em LT com produto base L (alias) → conversão MUC', async () => {
    const produto = { id: 2, unidade: 'L', unidades_comercializacao: [] };
    const r = Converter({
      produto,
      quantidade: 3,
      unidadeOrigem: 'LT',
      unidadeBase: 'L',
      contexto: 'PDV'
    });
    assert.strictEqual(r.quantidadeConvertida, 3);
  });

  await test('Tabela em ML com produto base L → fraciona sem UC no produto', async () => {
    const produto = { id: 3, unidade: 'L' };
    const r = Converter({
      produto,
      quantidade: 500,
      unidadeOrigem: 'ML',
      unidadeBase: 'L',
      contexto: 'PDV'
    });
    assert.strictEqual(r.quantidadeConvertida, 0.5);
  });

  await test('Tabela em L com produto base ML → agrupa sem UC no produto', async () => {
    const produto = { id: 4, unidade: 'ML', unidades: [] };
    const r = Converter({
      produto,
      quantidade: 2,
      unidadeOrigem: 'L',
      unidadeBase: 'ML',
      contexto: 'COMERCIAL'
    });
    assert.strictEqual(r.quantidadeConvertida, 2000);
  });

  await test('LT → KG sem conversão → mensagem oficial', async () => {
    const produto = { id: 5, unidade: 'KG', unidades_comercializacao: [] };
    let err = null;
    try {
      Converter({
        produto,
        quantidade: 1,
        unidadeOrigem: 'LT',
        unidadeBase: 'KG',
        contexto: 'PDV'
      });
    } catch (e) {
      err = e;
    }
    assert.ok(err);
    assert.ok(err instanceof ConversaoNaoCadastradaError || err.codigo === 'MCC_CONVERSAO_NAO_CADASTRADA');
    assert.strictEqual(err.message, 'Conversão entre LT e KG não cadastrada.');
    assert.ok(!/não cadastrada para o produto/i.test(err.message));
    assert.ok(!/não encontrada para o produto/i.test(err.message));
  });

  await test('CX → UN sem fator → conversão não cadastrada (não "UC no produto")', async () => {
    const produto = { id: 6, unidade: 'UN' };
    let err = null;
    try {
      Converter({
        produto,
        quantidade: 1,
        unidadeOrigem: 'CX',
        unidadeBase: 'UN',
        contexto: 'PDV'
      });
    } catch (e) {
      err = e;
    }
    assert.ok(err);
    assert.strictEqual(err.message, 'Conversão entre CX e UN não cadastrada.');
  });

  await test('Fator opcional no catálogo MUC do produto ainda funciona', async () => {
    const produto = {
      id: 7,
      unidade: 'UN',
      unidades_comercializacao: [
        { unidade_comercial: 'CX', tipo: 'AGRUPAMENTO', quantidade: 12, unidade_base: 'UN' }
      ]
    };
    const r = Converter({
      produto,
      quantidade: 2,
      unidadeOrigem: 'CX',
      unidadeBase: 'UN',
      contexto: 'PDV'
    });
    assert.strictEqual(r.quantidadeConvertida, 24);
  });

  await test('PDV orchestrator: UC da tabela sem cadastro no produto (L→ML)', async () => {
    const orch = new PdvConversaoOrchestrator({ mcc: mcc.motor });
    const r = orch.processarItem({
      produto: { id: 8, unidade: 'ML' },
      quantidade: 1.5,
      unidadeOrigem: 'L'
    });
    assert.strictEqual(r.quantidadeConvertida, 1500);
  });

  await test('MUC resolverFatorConversao LT↔KG = null', async () => {
    assert.strictEqual(muc.resolverFatorConversao('LT', 'KG'), null);
    const ok = muc.resolverFatorConversao('L', 'ML');
    assert.ok(ok);
    assert.strictEqual(ok.fator, 1000);
  });

  console.log('\nRCM-8.8 OK');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
