/**
 * MCC-02 — Testes Conversão Física por Lote
 * Executar: npm run test:mcc02
 */

const assert = require('assert');
const path = require('path');
const mcc = require(path.join(__dirname, '..'));

let passou = 0;
let falhou = 0;

function test(nome, fn) {
  try {
    fn();
    passou += 1;
    console.log(`  OK  ${nome}`);
  } catch (error) {
    falhou += 1;
    console.error(`  FALHOU  ${nome}`);
    console.error(`         ${error.message}`);
  }
}

function lote(props) {
  return mcc.ConversaoFisicaLote.criar(props);
}

console.log('=== TESTES — MCC-02 Conversão Física por Lote ===\n');

test('Mesmo produto, dois lotes, fatores diferentes — motor escolhe o lote informado', () => {
  const produto = {
    id: 100,
    nome: 'Sorvete Flocos',
    unidade_base: 'L',
    utiliza_conversao_fisica: 1,
    unidade_conversao_fisica: 'KG'
  };

  const loteA = lote({
    produtoId: 100,
    loteId: 1,
    loteCodigo: 'L20260717',
    unidadeBase: 'L',
    unidadeDestino: 'KG',
    quantidadeBase: 5,
    quantidadeDestino: 3.375,
    origem: mcc.OrigemConversaoFisica.MANUAL
  });
  assert.ok(Math.abs(loteA.fator - 0.675) < 1e-9);

  const loteB = lote({
    produtoId: 100,
    loteId: 2,
    loteCodigo: 'L20260802',
    unidadeBase: 'L',
    unidadeDestino: 'KG',
    quantidadeBase: 5,
    quantidadeDestino: 3.42,
    origem: mcc.OrigemConversaoFisica.FABRICANTE
  });
  assert.ok(Math.abs(loteB.fator - 0.684) < 1e-9);

  const rA = mcc.Converter({
    produto,
    quantidade: 10,
    unidadeOrigem: 'L',
    contexto: 'VENDA',
    conversaoFisicaLote: loteA
  });
  const rB = mcc.Converter({
    produto,
    quantidade: 10,
    unidadeOrigem: 'L',
    contexto: 'VENDA',
    conversaoFisicaLote: loteB
  });

  assert.ok(Math.abs(rA.quantidadeConvertida - 6.75) < 1e-9);
  assert.ok(Math.abs(rB.quantidadeConvertida - 6.84) < 1e-9);
  assert.strictEqual(rA.unidadeDestino, 'KG');
  assert.strictEqual(rA.loteUtilizado.loteId, 1);
  assert.strictEqual(rB.loteUtilizado.loteId, 2);
  assert.strictEqual(rA.tipoConversao, mcc.TipoConversao.CONVERSAO_FISICA);
  assert.notStrictEqual(rA.fatorAplicado, rB.fatorAplicado);
});

test('Produto sem Conversão Física — conversão matemática continua', () => {
  const produto = {
    id: 200,
    unidade_base: 'L',
    utiliza_conversao_fisica: 0,
    unidades_comercializacao: [
      { unidade_comercial: 'CX', tipo: 'AGRUPAMENTO', quantidade: 5, unidade_base: 'L' }
    ]
  };
  const r = mcc.Converter({
    produto,
    quantidade: 4,
    unidadeOrigem: 'CX',
    contexto: 'COMPRA'
  });
  assert.strictEqual(r.quantidadeConvertida, 20);
  assert.strictEqual(r.unidadeDestino, 'L');
  assert.strictEqual(r.tipoConversao, mcc.TipoConversao.AGRUPAMENTO);
  assert.strictEqual(r.loteUtilizado, null);
});

test('Produto exige Conversão Física sem lote — erro oficial', () => {
  let err = null;
  try {
    mcc.Converter({
      produto: {
        id: 300,
        unidade_base: 'L',
        utiliza_conversao_fisica: true,
        unidade_conversao_fisica: 'KG'
      },
      quantidade: 5,
      unidadeOrigem: 'L',
      contexto: 'PDV'
    });
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof mcc.ConversaoFisicaObrigatoriaError);
  assert.match(err.message, /Informe o peso do lote/);
  assert.strictEqual(err.codigo, 'MCC_CONVERSAO_FISICA_OBRIGATORIA');
  assert.strictEqual(err.status, 422);
});

test('Conversão composta Caixa → Litro → Kg com lote', () => {
  const produto = {
    id: 400,
    unidade_base: 'L',
    utiliza_conversao_fisica: 1,
    unidade_conversao_fisica: 'KG',
    unidades_comercializacao: [
      { unidade_comercial: 'CX', tipo: 'AGRUPAMENTO', quantidade: 5, unidade_base: 'L' }
    ]
  };
  const conversao = lote({
    produtoId: 400,
    loteId: 77,
    loteCodigo: 'L20260717',
    unidadeBase: 'L',
    unidadeDestino: 'KG',
    quantidadeBase: 5,
    quantidadeDestino: 3.375,
    origem: mcc.OrigemConversaoFisica.CALCULADA
  });

  // 2 CX × 5 L = 10 L × 0.675 = 6.75 KG
  const r = mcc.Converter({
    produto,
    quantidade: 2,
    unidadeOrigem: 'CX',
    contexto: 'COMERCIAL',
    conversaoFisicaLote: conversao,
    cadeia: [
      { de: 'CX', para: 'L', tipo: 'AGRUPAMENTO', quantidade: 5 },
      { de: 'L', para: 'KG', tipo: 'CONVERSAO_FISICA' }
    ]
  });

  assert.ok(Math.abs(r.quantidadeConvertida - 6.75) < 1e-9);
  assert.strictEqual(r.unidadeDestino, 'KG');
  assert.strictEqual(r.tipoConversao, mcc.TipoConversao.CONVERSAO_COMPOSTA);
  assert.strictEqual(r.loteUtilizado.loteId, 77);
  assert.strictEqual(r.cadeia.length, 2);
  assert.strictEqual(r.cadeia[1].tipo, mcc.TipoConversao.CONVERSAO_FISICA);
});

test('Converter implícito CX → L → Kg (flag produto + lote, sem cadeia)', () => {
  const produto = {
    id: 401,
    unidade_base: 'L',
    utiliza_conversao_fisica: 1,
    unidade_conversao_fisica: 'KG',
    unidades_comercializacao: [
      { unidade_comercial: 'CX', tipo: 'AGRUPAMENTO', quantidade: 5, unidade_base: 'L' }
    ]
  };
  const conversao = lote({
    produtoId: 401,
    loteId: 88,
    unidadeBase: 'L',
    unidadeDestino: 'KG',
    quantidadeBase: 5,
    quantidadeDestino: 3.375,
    origem: 'MANUAL'
  });
  const r = mcc.Converter({
    produto,
    quantidade: 2,
    unidadeOrigem: 'CX',
    contexto: 'VENDA',
    conversaoFisicaLote: conversao
  });
  assert.ok(Math.abs(r.quantidadeConvertida - 6.75) < 1e-9);
  assert.strictEqual(r.tipoConversao, mcc.TipoConversao.CONVERSAO_COMPOSTA);
});

test('Cache: lotes independentes não compartilham fator', () => {
  const servico = new mcc.ConversaoComercialService();
  const produto = {
    id: 500,
    unidade_base: 'L',
    utiliza_conversao_fisica: 1,
    unidade_conversao_fisica: 'KG'
  };
  const a = lote({
    produtoId: 500, loteId: 1, unidadeBase: 'L', unidadeDestino: 'KG',
    quantidadeBase: 5, quantidadeDestino: 3.375, origem: 'MANUAL'
  });
  const b = lote({
    produtoId: 500, loteId: 2, unidadeBase: 'L', unidadeDestino: 'KG',
    quantidadeBase: 5, quantidadeDestino: 3.42, origem: 'MANUAL'
  });

  const r1 = servico.Converter({
    produto, quantidade: 10, unidadeOrigem: 'L', contexto: 'VENDA',
    conversaoFisicaLote: a, operacaoId: 'op-cache', loteId: 1
  });
  const r1b = servico.Converter({
    produto, quantidade: 10, unidadeOrigem: 'L', contexto: 'VENDA',
    conversaoFisicaLote: a, operacaoId: 'op-cache', loteId: 1
  });
  const r2 = servico.Converter({
    produto, quantidade: 10, unidadeOrigem: 'L', contexto: 'VENDA',
    conversaoFisicaLote: b, operacaoId: 'op-cache', loteId: 2
  });

  assert.strictEqual(r1.cacheHit, false);
  assert.strictEqual(r1b.cacheHit, true);
  assert.strictEqual(r2.cacheHit, false);
  assert.ok(Math.abs(r1.quantidadeConvertida - 6.75) < 1e-9);
  assert.ok(Math.abs(r2.quantidadeConvertida - 6.84) < 1e-9);
  assert.strictEqual(servico.cache.tamanho('op-cache'), 2);
});

test('Auditoria completa em memória (sem persistência)', () => {
  const conversao = lote({
    produtoId: 600,
    loteId: 9,
    loteCodigo: 'L20260717',
    unidadeBase: 'L',
    unidadeDestino: 'KG',
    quantidadeBase: 5,
    quantidadeDestino: 3.375,
    origem: mcc.OrigemConversaoFisica.IMPORTADA_XML
  });
  const r = mcc.Converter({
    produto: {
      id: 600,
      unidade_base: 'L',
      utiliza_conversao_fisica: 1,
      unidade_conversao_fisica: 'KG'
    },
    quantidade: 5,
    unidadeOrigem: 'L',
    contexto: 'COMPRA',
    conversaoFisicaLote: conversao
  });

  assert.strictEqual(r.quantidadeOriginal, 5);
  assert.strictEqual(r.unidadeOrigem, 'L');
  assert.ok(Math.abs(r.quantidadeConvertida - 3.375) < 1e-9);
  assert.strictEqual(r.unidadeDestino, 'KG');
  assert.strictEqual(r.fatorAplicado, conversao.fator);
  assert.ok(r.loteUtilizado);
  assert.strictEqual(r.origemConversao, 'IMPORTADA_XML');
  assert.ok(r.precisao.preparado);
  assert.ok(r.auditoria);
  assert.strictEqual(r.auditoria.produtoId, 600);
  assert.strictEqual(r.auditoria.loteId, 9);
  assert.strictEqual(r.auditoria.lote, 'L20260717');
  assert.strictEqual(r.auditoria.persistido, false);
  assert.ok(r.auditoria.timestamp);
  assert.strictEqual(r.auditoria.fator, conversao.fator);
});

test('Enums OrigemConversaoFisica oficiais', () => {
  assert.strictEqual(mcc.OrigemConversaoFisica.MANUAL, 'MANUAL');
  assert.strictEqual(mcc.OrigemConversaoFisica.FABRICANTE, 'FABRICANTE');
  assert.strictEqual(mcc.OrigemConversaoFisica.CALCULADA, 'CALCULADA');
  assert.strictEqual(mcc.OrigemConversaoFisica.IMPORTADA_XML, 'IMPORTADA_XML');
  assert.strictEqual(mcc.OrigemConversaoFisica.IMPORTADA_PLANILHA, 'IMPORTADA_PLANILHA');
});

test('Produto NÃO armazena fator — fator só no ConversaoFisicaLote', () => {
  const conversao = lote({
    produtoId: 700,
    loteId: 1,
    unidadeBase: 'L',
    unidadeDestino: 'KG',
    quantidadeBase: 5,
    quantidadeDestino: 3.375,
    origem: 'MANUAL'
  });
  const produto = {
    id: 700,
    unidade_base: 'L',
    utiliza_conversao_fisica: 1,
    unidade_conversao_fisica: 'KG'
    // propositalmente sem fator / densidade
  };
  assert.strictEqual(produto.fator, undefined);
  assert.strictEqual(produto.fator_litro_kg, undefined);
  const r = mcc.Converter({
    produto,
    quantidade: 1,
    unidadeOrigem: 'L',
    contexto: 'OUTROS',
    conversaoFisicaLote: conversao
  });
  assert.ok(Math.abs(r.fatorAplicado - 0.675) < 1e-9);
});

console.log(`\n=== Resultado: ${passou} OK, ${falhou} FALHOU ===`);
process.exit(falhou > 0 ? 1 : 0);
