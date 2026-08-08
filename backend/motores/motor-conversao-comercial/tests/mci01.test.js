/**
 * MCI-01 — Integração MCC × Entrada de Mercadorias
 * Executar: npm run test:mci01
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

function produtoSorvete(extras = {}) {
  return {
    id: 1,
    nome: 'Sorvete Flocos',
    unidade: 'L',
    unidade_base: 'L',
    utiliza_conversao_fisica: 1,
    unidade_conversao_fisica: 'KG',
    unidades_comercializacao: [
      {
        unidade_comercial: 'CX',
        descricao: 'Caixa 5L',
        tipo: 'AGRUPAMENTO',
        quantidade: 5,
        unidade_base: 'L',
        permite_compra: 1,
        canais_comercializacao: ['compra', 'venda_erp']
      }
    ],
    ...extras
  };
}

const orch = new mcc.CompraConversaoOrchestrator();

console.log('=== TESTES — MCI-01 Entrada de Mercadorias × MCC ===\n');

test('CalcularConversaoFisica: volume + peso → fator (sem UI)', () => {
  const r = mcc.CalcularConversaoFisica({ volume: 5, peso: 3.375 });
  assert.ok(Math.abs(r.fator - 0.675) < 1e-9);
  assert.strictEqual(r.quantidadeBase, 5);
  assert.strictEqual(r.quantidadeDestino, 3.375);
});

test('Compra por embalagem: 20 CX · 5 L · 3,375 Kg → 100 L + fator lote', () => {
  const r = orch.processarItem({
    produto: produtoSorvete(),
    quantidade: 20,
    unidadeOrigem: 'CX',
    modo: mcc.ModoEntradaConversao.PESO_POR_EMBALAGEM,
    pesoEmbalagem: 3.375,
    compra: { id: 10, fornecedorId: 5, fornecedorNome: 'Laticínios X' },
    lote: { id: 101, codigo: 'L20260717' }
  });

  assert.strictEqual(r.quantidadeConvertida, 100);
  assert.strictEqual(r.unidadeBase, 'L');
  assert.strictEqual(r.estoqueBasePendente, true);
  assert.ok(r.conversaoFisicaLote);
  assert.ok(Math.abs(r.conversaoFisicaLote.fator - 0.675) < 1e-9);
  assert.strictEqual(r.conversaoFisicaLote.quantidade_base, 5);
  assert.strictEqual(r.conversaoFisicaLote.quantidade_destino, 3.375);
  assert.strictEqual(r.lote.codigo, 'L20260717');
  assert.strictEqual(r.auditoria.compraId, 10);
  assert.strictEqual(r.auditoria.fornecedorId, 5);
  assert.strictEqual(r.auditoria.persistido, false);
});

test('Compra por peso total: 100 L · 67,5 Kg → 100 L + fator 0,675', () => {
  const r = orch.processarItem({
    produto: produtoSorvete(),
    quantidade: 100,
    unidadeOrigem: 'L',
    modo: mcc.ModoEntradaConversao.PESO_TOTAL,
    volumeTotal: 100,
    pesoTotal: 67.5,
    compra: { id: 11 },
    lote: { id: 102, codigo: 'L20260718' }
  });

  assert.strictEqual(r.quantidadeConvertida, 100);
  assert.strictEqual(r.unidadeBase, 'L');
  assert.ok(Math.abs(r.conversaoFisicaLote.fator - 0.675) < 1e-9);
  assert.strictEqual(r.modo, mcc.ModoEntradaConversao.PESO_TOTAL);
});

test('Produto sem conversão física — só matemática', () => {
  const produto = {
    id: 2,
    unidade_base: 'UN',
    utiliza_conversao_fisica: 0,
    unidades_comercializacao: [
      {
        unidade_comercial: 'PCT',
        tipo: 'AGRUPAMENTO',
        quantidade: 12,
        unidade_base: 'UN',
        permite_compra: 1
      }
    ]
  };
  const r = orch.processarItem({
    produto,
    quantidade: 3,
    unidadeOrigem: 'PCT',
    compra: { id: 20 }
  });
  assert.strictEqual(r.quantidadeConvertida, 36);
  assert.strictEqual(r.conversaoFisicaLote, null);
  assert.strictEqual(r.unidadeBase, 'UN');
});

test('Produto com conversão obrigatória sem peso → ConversaoFisicaObrigatoriaError', () => {
  let err = null;
  try {
    orch.processarItem({
      produto: produtoSorvete(),
      quantidade: 10,
      unidadeOrigem: 'CX'
      // sem peso
    });
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof mcc.ConversaoFisicaObrigatoriaError);
});

test('Dois lotes — dois fatores distintos', () => {
  const p = produtoSorvete();
  const a = orch.processarItem({
    produto: p,
    quantidade: 10,
    unidadeOrigem: 'CX',
    pesoEmbalagem: 3.375,
    lote: { id: 1, codigo: 'L-A' }
  });
  const b = orch.processarItem({
    produto: p,
    quantidade: 10,
    unidadeOrigem: 'CX',
    pesoEmbalagem: 3.42,
    lote: { id: 2, codigo: 'L-B' }
  });
  assert.strictEqual(a.quantidadeConvertida, 50);
  assert.strictEqual(b.quantidadeConvertida, 50);
  assert.ok(Math.abs(a.conversaoFisicaLote.fator - 0.675) < 1e-9);
  assert.ok(Math.abs(b.conversaoFisicaLote.fator - 0.684) < 1e-9);
  assert.notStrictEqual(a.conversaoFisicaLote.fator, b.conversaoFisicaLote.fator);
});

test('Peso inválido → PesoInvalidoError', () => {
  let err = null;
  try {
    orch.processarItem({
      produto: produtoSorvete(),
      quantidade: 5,
      unidadeOrigem: 'CX',
      pesoEmbalagem: 0
    });
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof mcc.PesoInvalidoError);
  assert.strictEqual(err.codigo, 'MCI_PESO_INVALIDO');
});

test('Volume inválido no CalcularConversaoFisica → VolumeInvalidoError', () => {
  let err = null;
  try {
    mcc.CalcularConversaoFisica({ volume: -1, peso: 10 });
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof mcc.VolumeInvalidoError);
});

test('Unidade não permitida para compra → UnidadeNaoPermitidaError', () => {
  let err = null;
  try {
    orch.processarItem({
      produto: produtoSorvete({
        unidades_comercializacao: [
          {
            unidade_comercial: 'CX',
            tipo: 'AGRUPAMENTO',
            quantidade: 5,
            unidade_base: 'L',
            permite_compra: 0
          }
        ]
      }),
      quantidade: 2,
      unidadeOrigem: 'CX',
      pesoEmbalagem: 3.375
    });
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof mcc.UnidadeNaoPermitidaError);
});

test('Unidade inexistente → UnidadeNaoPermitidaError', () => {
  let err = null;
  try {
    orch.processarItem({
      produto: produtoSorvete(),
      quantidade: 1,
      unidadeOrigem: 'SC',
      pesoEmbalagem: 1
    });
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof mcc.UnidadeNaoPermitidaError);
});

test('Auditoria completa em memória', () => {
  const r = orch.processarItem({
    produto: produtoSorvete(),
    quantidade: 20,
    unidadeOrigem: 'CX',
    pesoEmbalagem: 3.375,
    compra: { id: 99, fornecedorId: 7, fornecedorNome: 'Fornecedor Y' },
    lote: { id: 55, codigo: 'L20260717' },
    origem: mcc.OrigemConversaoFisica.MANUAL
  });
  assert.strictEqual(r.auditoria.produtoId, 1);
  assert.strictEqual(r.auditoria.compraId, 99);
  assert.strictEqual(r.auditoria.loteCodigo, 'L20260717');
  assert.strictEqual(r.auditoria.pesoInformado, 3.375);
  assert.strictEqual(r.auditoria.volumeInformado, 5);
  assert.ok(Math.abs(r.auditoria.fatorCalculado - 0.675) < 1e-9);
  assert.ok(r.auditoria.timestamp);
  assert.strictEqual(r.auditoria.persistido, false);
});

test('Compra por peso total derivando volume das caixas', () => {
  // 20 CX × 5 L = 100 L; peso total 67.5
  const r = orch.processarItem({
    produto: produtoSorvete(),
    quantidade: 20,
    unidadeOrigem: 'CX',
    modo: mcc.ModoEntradaConversao.PESO_TOTAL,
    pesoTotal: 67.5
    // volumeTotal omitido — deriva
  });
  assert.strictEqual(r.quantidadeConvertida, 100);
  assert.ok(Math.abs(r.conversaoFisicaLote.fator - 0.675) < 1e-9);
});

console.log(`\n=== Resultado: ${passou} OK, ${falhou} FALHOU ===`);
process.exit(falhou > 0 ? 1 : 0);
