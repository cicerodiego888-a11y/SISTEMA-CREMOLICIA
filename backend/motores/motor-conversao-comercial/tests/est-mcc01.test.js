/**
 * EST-MCC-01 — Ajuste de Estoque × MCC
 * Executar: npm run test:est-mcc01
 */

const assert = require('assert');
const path = require('path');
const mcc = require(path.join(__dirname, '..'));
const EstoqueAdjustmentOrchestrator = mcc.EstoqueAdjustmentOrchestrator;
const EstoqueAdjustmentOperacionalService = mcc.EstoqueAdjustmentOperacionalService;
const ConversaoFisicaLote = mcc.ConversaoFisicaLote;
const { OrigemConversaoFisica } = mcc;

let passou = 0;
let falhou = 0;

function test(nome, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passou += 1;
      console.log(`  OK  ${nome}`);
    })
    .catch((error) => {
      falhou += 1;
      console.error(`  FALHOU  ${nome}`);
      console.error(`         ${error.message}`);
    });
}

function produtoLegado() {
  return {
    id: 10,
    nome: 'Arroz',
    unidade: 'UN',
    unidade_base: 'UN',
    utiliza_conversao_fisica: 0,
    unidades_comercializacao: []
  };
}

function produtoCaixa() {
  return {
    id: 11,
    nome: 'Refrigerante',
    unidade: 'UN',
    unidade_base: 'UN',
    utiliza_conversao_fisica: 0,
    unidades_comercializacao: [
      {
        unidade_comercial: 'CX',
        descricao: 'Caixa 12',
        tipo: 'AGRUPAMENTO',
        quantidade: 12,
        unidade_base: 'UN'
      },
      {
        unidade_comercial: 'UN',
        descricao: 'Unidade',
        tipo: 'PADRAO',
        quantidade: 1,
        unidade_base: 'UN'
      }
    ]
  };
}

function produtoSorvete() {
  return {
    id: 12,
    nome: 'Sorvete Flocos',
    unidade: 'L',
    unidade_base: 'L',
    utiliza_conversao_fisica: 1,
    unidade_conversao_fisica: 'KG',
    unidades_comercializacao: [
      {
        unidade_comercial: 'L',
        descricao: 'Litro',
        tipo: 'PADRAO',
        quantidade: 1,
        unidade_base: 'L'
      }
    ]
  };
}

function loteFisicaSorvete() {
  return ConversaoFisicaLote.criar({
    produtoId: 12,
    loteId: 99,
    loteCodigo: 'L-TEST',
    unidadeBase: 'L',
    unidadeDestino: 'KG',
    quantidadeBase: 10,
    quantidadeDestino: 6.75,
    origem: OrigemConversaoFisica.MANUAL
  });
}

async function run() {
  console.log('\n=== Testes EST-MCC-01 — Ajuste de Estoque × MCC ===\n');

  await test('Legado: ajuste em UN = identidade na base', async () => {
    const orch = new EstoqueAdjustmentOrchestrator({ mcc: mcc.motor });
    const r = orch.processarItem({
      produto: produtoLegado(),
      quantidade: 5,
      unidadeOrigem: 'UN'
    });
    assert.strictEqual(r.quantidadeConvertida, 5);
    assert.strictEqual(r.unidadeBase, 'UN');
    assert.strictEqual(r.auditoria.sprint, 'EST-MCC-01');
  });

  await test('UC: 2 CX → 24 UN na base', async () => {
    const orch = new EstoqueAdjustmentOrchestrator({ mcc: mcc.motor });
    const r = orch.processarItem({
      produto: produtoCaixa(),
      quantidade: 2,
      unidadeOrigem: 'CX'
    });
    assert.strictEqual(r.quantidadeConvertida, 24);
  });

  await test('UC negativa: -1 CX → -12 UN', async () => {
    const orch = new EstoqueAdjustmentOrchestrator({ mcc: mcc.motor });
    const r = orch.processarItem({
      produto: produtoCaixa(),
      quantidade: -1,
      unidadeOrigem: 'CX'
    });
    assert.strictEqual(r.quantidadeConvertida, -12);
  });

  await test('Física: 6.75 KG → 10 L (fator do lote via MCC)', async () => {
    const orch = new EstoqueAdjustmentOrchestrator({ mcc: mcc.motor });
    const r = orch.processarItem({
      produto: produtoSorvete(),
      quantidade: 6.75,
      unidadeOrigem: 'KG',
      conversaoFisicaLote: loteFisicaSorvete()
    });
    assert.ok(Math.abs(r.quantidadeConvertida - 10) < 0.001);
    assert.strictEqual(r.unidadeBase, 'L');
    assert.strictEqual(r.tipoConversao, 'CONVERSAO_FISICA');
  });

  await test('Física sem lote ativo: rejeita ajuste em KG', async () => {
    const orch = new EstoqueAdjustmentOrchestrator({ mcc: mcc.motor });
    let err = null;
    try {
      orch.processarItem({
        produto: produtoSorvete(),
        quantidade: 1,
        unidadeOrigem: 'KG'
      });
    } catch (e) {
      err = e;
    }
    assert.ok(err);
    assert.ok(err.codigo === 'MCC_CONVERSAO_FISICA_OBRIGATORIA' || /Conversão Física/i.test(err.message));
  });

  await test('Sorvete ajuste em L (base) sem lote: ok', async () => {
    const orch = new EstoqueAdjustmentOrchestrator({ mcc: mcc.motor });
    const r = orch.processarItem({
      produto: produtoSorvete(),
      quantidade: 3,
      unidadeOrigem: 'L'
    });
    assert.strictEqual(r.quantidadeConvertida, 3);
  });

  await test('listarUnidadesAjuste: base + UC + física', async () => {
    const svc = new EstoqueAdjustmentOperacionalService({ mcc: mcc.motor });
    const unidades = svc.listarUnidadesAjuste(produtoSorvete());
    const codigos = unidades.map((u) => u.unidade_comercial);
    assert.ok(codigos.includes('L'));
    assert.ok(codigos.includes('KG'));
  });

  await test('listarUnidadesAjuste: refrigerante CX + UN', async () => {
    const svc = new EstoqueAdjustmentOperacionalService({ mcc: mcc.motor });
    const unidades = svc.listarUnidadesAjuste(produtoCaixa());
    const codigos = unidades.map((u) => u.unidade_comercial);
    assert.ok(codigos.includes('CX'));
    assert.ok(codigos.includes('UN'));
  });

  await test('Exports oficiais EST-MCC-01', async () => {
    assert.ok(mcc.EstoqueAdjustmentOrchestrator);
    assert.ok(mcc.EstoqueAdjustmentOperacionalService);
    assert.ok(mcc.estoqueAdjustmentOperacional);
    assert.strictEqual(mcc.ContextoConversao.AJUSTE_ESTOQUE, 'AJUSTE_ESTOQUE');
  });

  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  if (falhou > 0) process.exit(1);
}

run();
