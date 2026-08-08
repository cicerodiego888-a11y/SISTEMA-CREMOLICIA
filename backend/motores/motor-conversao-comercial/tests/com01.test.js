/**
 * COM-01 — Motor Comercial × MCC × MotorEstoque
 * Executar: npm run test:com01
 */

const assert = require('assert');
const path = require('path');
const mcc = require(path.join(__dirname, '..'));
const ComercialConversaoOrchestrator = mcc.ComercialConversaoOrchestrator;
const ComercialOperacionalService = mcc.ComercialOperacionalService;

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
    nome: 'Caneta',
    unidade: 'UN',
    unidade_base: 'UN',
    utiliza_conversao_fisica: 0,
    unidades_comercializacao: [
      {
        unidade_comercial: 'CX',
        tipo: 'AGRUPAMENTO',
        quantidade: 12,
        unidade_base: 'UN',
        permite_venda: 1,
        canais_comercializacao: ['comercial', 'venda_erp']
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
    unidades_comercializacao: [
      {
        unidade_comercial: 'L',
        tipo: 'PADRAO',
        quantidade: 1,
        unidade_base: 'L',
        permite_venda: 1,
        canais_comercializacao: ['comercial']
      },
      {
        unidade_comercial: 'P200',
        tipo: 'FRACIONAMENTO',
        quantidade: 0.2,
        unidade_base: 'L',
        permite_venda: 1,
        canais_comercializacao: ['comercial', 'venda_varejo']
      }
    ]
  };
}

async function run() {
  console.log('\n=== Testes COM-01 — Motor Comercial × MCC ===\n');

  await test('Produto comum (legado): identidade', async () => {
    const orch = new ComercialConversaoOrchestrator({ mcc: mcc.motor });
    const r = orch.processarItem({
      produto: produtoComum(),
      quantidade: 5,
      unidadeOrigem: 'UN',
      operacao: 'ENTREGA'
    });
    assert.strictEqual(r.quantidadeConvertida, 5);
    assert.strictEqual(r.auditoria.sprint, 'COM-01');
  });

  await test('Entrega por caixa: 2 CX → 24 UN', async () => {
    const orch = new ComercialConversaoOrchestrator({ mcc: mcc.motor });
    const r = orch.processarItem({
      produto: produtoCaixa(),
      quantidade: 2,
      unidadeOrigem: 'CX',
      operacao: 'ENTREGA'
    });
    assert.strictEqual(r.quantidadeConvertida, 24);
  });

  await test('Sorvete fracionado: pote 200ml → 0.2 L', async () => {
    const orch = new ComercialConversaoOrchestrator({ mcc: mcc.motor });
    const r = orch.processarItem({
      produto: produtoSorvete(),
      quantidade: 3,
      unidadeOrigem: 'P200',
      operacao: 'VENDA_PRESTACAO'
    });
    assert.ok(Math.abs(r.quantidadeConvertida - 0.6) < 1e-9);
  });

  await test('Contexto COMERCIAL na auditoria', async () => {
    const orch = new ComercialConversaoOrchestrator({ mcc: mcc.motor });
    const r = orch.processarItem({
      produto: produtoComum(),
      quantidade: 1,
      consignacaoId: 99,
      operacao: 'DEVOLUCAO'
    });
    assert.strictEqual(r.auditoria.contexto, mcc.ContextoConversao.COMERCIAL);
    assert.strictEqual(r.auditoria.consignacaoId, 99);
  });

  await test('Unidade sem canal comercial rejeitada', async () => {
    const orch = new ComercialConversaoOrchestrator({ mcc: mcc.motor });
    let err = null;
    try {
      orch.processarItem({
        produto: {
          ...produtoCaixa(),
          unidades_comercializacao: [{
            unidade_comercial: 'CX',
            tipo: 'AGRUPAMENTO',
            quantidade: 12,
            unidade_base: 'UN',
            permite_venda: 1,
            canais_comercializacao: ['pdv']
          }]
        },
        quantidade: 1,
        unidadeOrigem: 'CX'
      });
    } catch (e) {
      err = e;
    }
    assert.ok(err);
  });

  await test('Exports MCC incluem ComercialOperacionalService', async () => {
    assert.ok(mcc.ComercialOperacionalService);
    assert.ok(mcc.comercialOperacional);
    assert.ok(mcc.ComercialConversaoOrchestrator);
  });

  await test('Compatibilidade: sem unidadeOrigem usa base', async () => {
    const orch = new ComercialConversaoOrchestrator({ mcc: mcc.motor });
    const r = orch.processarItem({
      produto: produtoComum(),
      quantidade: 7
    });
    assert.strictEqual(r.quantidadeConvertida, 7);
    assert.strictEqual(r.unidadeOrigem, 'UN');
  });

  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  if (falhou > 0) process.exit(1);
}

run();
