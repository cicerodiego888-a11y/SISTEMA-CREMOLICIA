/**
 * MCC-01 — Testes do Motor de Conversão Comercial
 * Executar: npm run test:mcc
 *         node backend/motores/motor-conversao-comercial/tests/mcc01.test.js
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

function produtoComUnidades(unidadeBase, unidades) {
  return {
    id: 1,
    nome: 'Produto Teste',
    unidade: unidadeBase,
    unidade_base: unidadeBase,
    unidades_comercializacao: unidades
  };
}

console.log('=== TESTES — MCC-01 Motor de Conversão Comercial ===\n');

test('Caixa → Litro (AGRUPAMENTO): 20 CX × 5 L = 100 L', () => {
  const produto = produtoComUnidades('L', [
    {
      unidade_comercial: 'CX',
      descricao: 'Caixa 5L',
      tipo: 'AGRUPAMENTO',
      quantidade: 5,
      unidade_base: 'L'
    }
  ]);
  const r = mcc.Converter({
    produto,
    quantidade: 20,
    unidadeOrigem: 'CX',
    contexto: mcc.ContextoConversao.COMPRA
  });
  assert.strictEqual(r.quantidadeConvertida, 100);
  assert.strictEqual(r.unidadeBase, 'L');
  assert.strictEqual(r.tipo, mcc.TipoConversao.AGRUPAMENTO);
  assert.strictEqual(r.origemConversao, 'CX');
  assert.ok(r.auditoria);
  assert.strictEqual(r.auditoria.origem, 'Caixa 5L');
  assert.strictEqual(r.auditoria.destino, 'L');
  assert.strictEqual(r.auditoria.quantidadeEntrada, 20);
  assert.strictEqual(r.auditoria.quantidadeConvertida, 100);
  assert.strictEqual(r.auditoria.tipo, 'AGRUPAMENTO');
  assert.strictEqual(r.auditoria.motor, 'MotorConversaoComercial');
  assert.strictEqual(r.auditoria.persistido, false);
  assert.strictEqual(r.precisao.preparado, true);
  assert.strictEqual(r.precisao.aplicado, false);
});

test('Pacote → Unidade (AGRUPAMENTO): 3 PCT × 12 UN = 36 UN', () => {
  const produto = produtoComUnidades('UN', [
    {
      unidade_comercial: 'PCT',
      descricao: 'Pacote',
      tipo: 'AGRUPAMENTO',
      quantidade: 12,
      unidade_base: 'UN'
    }
  ]);
  const r = mcc.Converter({
    produto,
    quantidade: 3,
    unidadeOrigem: 'PCT',
    contexto: 'VENDA'
  });
  assert.strictEqual(r.quantidadeConvertida, 36);
  assert.strictEqual(r.unidadeBase, 'UN');
  assert.strictEqual(r.tipo, mcc.TipoConversao.AGRUPAMENTO);
});

test('Bobina → Metro (FRACIONAMENTO): 2 BB × 50 M = 100 M', () => {
  const produto = produtoComUnidades('M', [
    {
      unidade_comercial: 'BB',
      descricao: 'Bobina',
      tipo: 'FRACIONAMENTO',
      quantidade: 50,
      unidade_base: 'M'
    }
  ]);
  const r = mcc.Converter({
    produto,
    quantidade: 2,
    unidadeOrigem: 'BB',
    contexto: mcc.ContextoConversao.PDV
  });
  assert.strictEqual(r.quantidadeConvertida, 100);
  assert.strictEqual(r.unidadeBase, 'M');
  assert.strictEqual(r.tipo, mcc.TipoConversao.FRACIONAMENTO);
});

test('PADRAO: unidade origem = base → identidade', () => {
  const produto = produtoComUnidades('UN', [
    {
      unidade_comercial: 'UN',
      tipo: 'PADRAO',
      quantidade: 1,
      unidade_base: 'UN'
    }
  ]);
  const r = mcc.Converter({
    produto,
    quantidade: 7,
    unidadeOrigem: 'UN',
    contexto: 'OUTROS'
  });
  assert.strictEqual(r.quantidadeConvertida, 7);
  assert.strictEqual(r.tipo, mcc.TipoConversao.PADRAO);
});

test('Conversão composta (arquitetura): CX → L → (sem física) finaliza se só agrupamentos', () => {
  const r = mcc.Converter({
    produto: { id: 9, unidade_base: 'L' },
    quantidade: 2,
    unidadeOrigem: 'CX',
    contexto: 'COMERCIAL',
    unidadeBase: 'L',
    cadeia: [
      { de: 'CX', para: 'L', tipo: 'AGRUPAMENTO', quantidade: 5 },
      { de: 'L', para: 'L', tipo: 'PADRAO', quantidade: 1 }
    ]
  });
  assert.strictEqual(r.quantidadeConvertida, 10);
  assert.strictEqual(r.tipo, mcc.TipoConversao.CONVERSAO_COMPOSTA);
  assert.strictEqual(r.cadeia.length, 2);
});

test('Conversão composta com elo físico sem lote: ConversaoFisicaObrigatoriaError', () => {
  let err = null;
  try {
    mcc.Converter({
      produto: { id: 10, unidade_base: 'L', utiliza_conversao_fisica: true },
      quantidade: 2,
      unidadeOrigem: 'CX',
      contexto: 'COMPRA',
      unidadeBase: 'L',
      cadeia: [
        { de: 'CX', para: 'L', tipo: 'AGRUPAMENTO', quantidade: 5 },
        { de: 'L', para: 'KG', tipo: 'CONVERSAO_FISICA' }
      ]
    });
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof mcc.ConversaoFisicaObrigatoriaError);
  assert.strictEqual(err.codigo, 'MCC_CONVERSAO_FISICA_OBRIGATORIA');
  assert.strictEqual(err.status, 422);
});

test('CONVERSAO_FISICA sem lote: ConversaoFisicaObrigatoriaError', () => {
  let err = null;
  try {
    mcc.Converter({
      produto: {
        id: 11,
        unidade_base: 'L',
        utiliza_conversao_fisica: true,
        unidade_conversao_fisica: 'KG'
      },
      quantidade: 10,
      unidadeOrigem: 'L',
      contexto: 'COMPRA'
    });
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof mcc.ConversaoFisicaObrigatoriaError);
  assert.strictEqual(err.status, 422);
});

test('Cache interno: mesma operação não recalcula', () => {
  const servico = new mcc.ConversaoComercialService();
  const produto = produtoComUnidades('L', [
    { unidade_comercial: 'CX', tipo: 'AGRUPAMENTO', quantidade: 5, unidade_base: 'L' }
  ]);
  const entrada = {
    produto,
    quantidade: 4,
    unidadeOrigem: 'CX',
    contexto: 'VENDA',
    operacaoId: 'op-mcc-1'
  };
  const r1 = servico.Converter(entrada);
  const r2 = servico.Converter(entrada);
  assert.strictEqual(r1.quantidadeConvertida, 20);
  assert.strictEqual(r1.cacheHit, false);
  assert.strictEqual(r2.cacheHit, true);
  assert.strictEqual(r2.quantidadeConvertida, 20);
  assert.strictEqual(servico.cache.tamanho('op-mcc-1'), 1);
});

test('Validação: quantidade negativa rejeitada', () => {
  let ok = false;
  try {
    mcc.Converter({
      produto: { unidade_base: 'UN' },
      quantidade: -1,
      unidadeOrigem: 'UN',
      contexto: 'OUTROS'
    });
  } catch (e) {
    ok = e.status === 400;
  }
  assert.ok(ok);
});

test('Contextos oficiais normalizados (NFC-e / NF-e)', () => {
  assert.strictEqual(mcc.normalizarContexto('nfce'), mcc.ContextoConversao.NFCE);
  assert.strictEqual(mcc.normalizarContexto('NFE'), mcc.ContextoConversao.NFE);
  assert.strictEqual(mcc.normalizarContexto('PDV'), mcc.ContextoConversao.PDV);
});

test('Enums oficiais exportados', () => {
  assert.ok(mcc.TipoConversao.AGRUPAMENTO);
  assert.ok(mcc.TipoConversao.CONVERSAO_COMPOSTA);
  assert.ok(mcc.ContextoConversao.ORCAMENTO);
  assert.strictEqual(mcc.MOTOR_NOME, 'MotorConversaoComercial');
});

console.log(`\n=== Resultado: ${passou} OK, ${falhou} FALHOU ===`);
process.exit(falhou > 0 ? 1 : 0);
