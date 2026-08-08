/**
 * PDV-01 — Migração PDV → MCC → MotorEstoque
 * Executar: npm run test:pdv01
 */

const assert = require('assert');
const path = require('path');
const mcc = require(path.join(__dirname, '..'));
const PdvConversaoOrchestrator = mcc.PdvConversaoOrchestrator;
const PdvVendaOperacionalService = mcc.PdvVendaOperacionalService;

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

function produtoComum() {
  return {
    id: 1,
    nome: 'Água',
    unidade: 'UN',
    unidade_base: 'UN',
    utiliza_conversao_fisica: 0,
    unidades_comercializacao: []
  };
}

function produtoCaixa() {
  return {
    id: 2,
    nome: 'Caneta CX12',
    unidade: 'UN',
    unidade_base: 'UN',
    utiliza_conversao_fisica: 0,
    unidades_comercializacao: [
      {
        unidade_comercial: 'CX',
        descricao: 'Caixa 12 UN',
        tipo: 'AGRUPAMENTO',
        quantidade: 12,
        unidade_base: 'UN',
        permite_pdv: 1,
        canais_comercializacao: ['pdv', 'nfce']
      },
      {
        unidade_comercial: 'UN',
        descricao: 'Unidade',
        tipo: 'PADRAO',
        quantidade: 1,
        unidade_base: 'UN',
        permite_pdv: 1,
        canais_comercializacao: ['pdv']
      }
    ]
  };
}

function produtoSorvete() {
  return {
    id: 3,
    nome: 'Sorvete',
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
        unidade_base: 'L',
        permite_pdv: 1,
        canais_comercializacao: ['pdv']
      },
      {
        unidade_comercial: 'P200',
        descricao: 'Pote 200 ml',
        tipo: 'FRACIONAMENTO',
        quantidade: 0.2,
        unidade_base: 'L',
        permite_pdv: 1,
        canais_comercializacao: ['pdv']
      },
      {
        unidade_comercial: 'P500',
        descricao: 'Pote 500 ml',
        tipo: 'FRACIONAMENTO',
        quantidade: 0.5,
        unidade_base: 'L',
        permite_pdv: 1,
        canais_comercializacao: ['pdv']
      },
      {
        unidade_comercial: 'CX',
        descricao: 'Caixa 5 Litros',
        tipo: 'AGRUPAMENTO',
        quantidade: 5,
        unidade_base: 'L',
        permite_pdv: 0,
        canais_comercializacao: ['compra']
      }
    ]
  };
}

async function run() {
  console.log('\n=== Testes PDV-01 — MCC × MotorEstoque ===\n');

  await test('Produto comum (legado sem UC): identidade na base', async () => {
    const orch = new PdvConversaoOrchestrator({ mcc: mcc.motor });
    const r = orch.processarItem({
      produto: produtoComum(),
      quantidade: 3,
      unidadeOrigem: 'UN'
    });
    assert.strictEqual(r.quantidadeConvertida, 3);
    assert.strictEqual(r.unidadeBase, 'UN');
  });

  await test('Produto por caixa: 2 CX → 24 UN', async () => {
    const orch = new PdvConversaoOrchestrator({ mcc: mcc.motor });
    const r = orch.processarItem({
      produto: produtoCaixa(),
      quantidade: 2,
      unidadeOrigem: 'CX'
    });
    assert.strictEqual(r.quantidadeConvertida, 24);
    assert.strictEqual(r.unidadeOrigem, 'CX');
  });

  await test('Sorvete: venda em L (base)', async () => {
    const orch = new PdvConversaoOrchestrator({ mcc: mcc.motor });
    const r = orch.processarItem({
      produto: produtoSorvete(),
      quantidade: 1.5,
      unidadeOrigem: 'L'
    });
    assert.strictEqual(r.quantidadeConvertida, 1.5);
  });

  await test('Sorvete: venda em pote 200 ml → 0.2 L', async () => {
    const orch = new PdvConversaoOrchestrator({ mcc: mcc.motor });
    const r = orch.processarItem({
      produto: produtoSorvete(),
      quantidade: 1,
      unidadeOrigem: 'P200'
    });
    assert.strictEqual(r.quantidadeConvertida, 0.2);
  });

  await test('Sorvete: venda em pote 500 ml × 2 → 1 L', async () => {
    const orch = new PdvConversaoOrchestrator({ mcc: mcc.motor });
    const r = orch.processarItem({
      produto: produtoSorvete(),
      quantidade: 2,
      unidadeOrigem: 'P500'
    });
    assert.strictEqual(r.quantidadeConvertida, 1);
  });

  await test('Unidade sem canal PDV rejeitada (caixa 5L)', async () => {
    const orch = new PdvConversaoOrchestrator({ mcc: mcc.motor });
    let err = null;
    try {
      orch.processarItem({
        produto: produtoSorvete(),
        quantidade: 1,
        unidadeOrigem: 'CX'
      });
    } catch (e) {
      err = e;
    }
    assert.ok(err);
    assert.ok(err.codigo === 'MCC_UNIDADE_NAO_PERMITIDA' || /não permitida|sem canal/i.test(err.message));
  });

  await test('filtrarUnidadesPdv remove caixa sem canal PDV', async () => {
    const svc = new PdvVendaOperacionalService({ mcc: mcc.motor });
    const filtradas = svc.filtrarUnidadesPdv(produtoSorvete());
    const codigos = filtradas.map((u) => u.unidade_comercial);
    assert.ok(codigos.includes('L'));
    assert.ok(codigos.includes('P200'));
    assert.ok(codigos.includes('P500'));
    assert.ok(!codigos.includes('CX'));
  });

  await test('Auditoria contém produto, UC, qtd comercial e base', async () => {
    const orch = new PdvConversaoOrchestrator({ mcc: mcc.motor });
    const r = orch.processarItem({
      produto: produtoCaixa(),
      quantidade: 1,
      unidadeOrigem: 'CX'
    });
    assert.strictEqual(r.auditoria.quantidadeComercial, 1);
    assert.strictEqual(r.auditoria.quantidadeBase, 12);
    assert.strictEqual(r.auditoria.unidadeOrigem, 'CX');
    assert.strictEqual(r.auditoria.sprint, 'PDV-01');
  });

  await test('Compatibilidade: sem unidadeOrigem usa base', async () => {
    const orch = new PdvConversaoOrchestrator({ mcc: mcc.motor });
    const r = orch.processarItem({
      produto: produtoComum(),
      quantidade: 5
    });
    assert.strictEqual(r.quantidadeConvertida, 5);
    assert.strictEqual(r.unidadeOrigem, 'UN');
  });

  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  if (falhou > 0) process.exit(1);
}

run();
