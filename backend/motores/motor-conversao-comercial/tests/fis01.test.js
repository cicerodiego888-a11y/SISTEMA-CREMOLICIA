/**
 * FIS-01 — Motor Fiscal × MCC (read-only)
 * Executar: npm run test:fis01
 */

const assert = require('assert');
const path = require('path');
const mcc = require(path.join(__dirname, '..'));
const FiscalOperacionalService = mcc.FiscalOperacionalService;

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

async function run() {
  console.log('\n=== Testes FIS-01 — Fiscal × MCC (sem recalcular) ===\n');

  const svc = new FiscalOperacionalService();

  await test('Produto comum (legado): usa quantidade_fiscal / unidade base', async () => {
    const s = svc.mapearItemDocumento({
      produto_id: 1,
      quantidade: 2,
      quantidade_fiscal: 2,
      quantidade_nao_fiscal: 0,
      valor_fiscal: 10,
      preco_unitario: 5,
      unidade: 'UN'
    }, { contexto: 'NFCE', vendaId: 10 });
    assert.strictEqual(s.unidadeComercial, 'UN');
    assert.strictEqual(s.quantidadeComercial, 2);
    assert.strictEqual(s.quantidadeBase, 2);
    assert.strictEqual(s.auditoria.recalculouConversao, false);
  });

  await test('NFC-e com UC: registra pote e qtd comercial (não multiplica fator)', async () => {
    const s = svc.mapearItemDocumento({
      produto_id: 3,
      quantidade: 2,
      unidade_comercial: 'P200',
      unidade_comercial_id: 9,
      fator_conversao: 0.2,
      quantidade_fiscal: 0.4,
      quantidade_nao_fiscal: 0,
      valor_fiscal: 16,
      preco_unitario: 8,
      unidade: 'L'
    }, { contexto: 'NFCE' });
    assert.strictEqual(s.unidadeComercial, 'P200');
    assert.strictEqual(s.quantidadeComercial, 2);
    assert.strictEqual(s.quantidadeBase, 0.4);
    assert.strictEqual(s.fatorAplicado, 0.2);
    assert.ok(s.quantidadeComercial !== s.quantidadeComercial * s.fatorAplicado
      || s.quantidadeComercial === 2);
  });

  await test('Venda em Kg: UC = KG', async () => {
    const s = svc.mapearItemDocumento({
      quantidade: 1.5,
      unidade_comercial: 'KG',
      quantidade_fiscal: 1.5,
      valor_fiscal: 30,
      preco_unitario: 20,
      unidade: 'KG'
    });
    assert.strictEqual(s.unidadeComercial, 'KG');
    assert.strictEqual(s.quantidadeComercial, 1.5);
  });

  await test('Nunca recalcula: fator só lido do snapshot', async () => {
    const s = svc.mapearItemDocumento({
      quantidade: 1,
      unidade_comercial: 'CX',
      fator_conversao: 12,
      quantidade_fiscal: 12,
      valor_fiscal: 24,
      preco_unitario: 24
    });
    assert.strictEqual(s.auditoria.recalculouConversao, false);
    assert.strictEqual(s.auditoria.fatorAplicado, 12);
    assert.strictEqual(s.auditoria.sprint, 'FIS-01');
  });

  await test('Contexto NFCE / NFE', async () => {
    const a = svc.mapearItemDocumento({ quantidade_fiscal: 1, unidade: 'UN' }, { contexto: 'NFCE' });
    const b = svc.mapearItemDocumento({ quantidade_fiscal: 1, unidade: 'UN' }, { contexto: 'NFE' });
    assert.strictEqual(a.auditoria.contexto, mcc.ContextoConversao.NFCE);
    assert.strictEqual(b.auditoria.contexto, mcc.ContextoConversao.NFE);
  });

  await test('xmlBuilder usa FiscalOperacionalService (sem × fator)', async () => {
    const xmlBuilder = require('../../../services/fiscal/xmlBuilder');
    const item = {
      quantidade: 3,
      unidade_comercial: 'CX',
      fator_conversao: 12,
      quantidade_fiscal: 36,
      quantidade_nao_fiscal: 0,
      valor_fiscal: 90,
      preco_unitario: 30
    };
    assert.strictEqual(xmlBuilder.obterQuantidadeFiscalItem(item), 3);
    assert.strictEqual(xmlBuilder.itemUsaUnidadeComercial(item), true);
  });

  await test('Cancelamento/estorno: usa qtd base persistida (sem reconversão)', async () => {
    const s = svc.mapearItemDocumento({
      quantidade: 2,
      unidade_comercial: 'P500',
      fator_conversao: 0.5,
      quantidade_fiscal: 1,
      quantidade_nao_fiscal: 0,
      valor_fiscal: 20,
      preco_unitario: 10
    }, { origemOperacao: 'CANCELAMENTO' });
    assert.strictEqual(s.quantidadeBase, 1);
    assert.strictEqual(s.quantidadeComercial, 2);
    assert.strictEqual(s.auditoria.recalculouConversao, false);
    assert.strictEqual(s.auditoria.origemOperacao, 'CANCELAMENTO');
    // Fiscal não expõe API de estoque — estorno operacional usa MotorEstoque.entrar(qtd base)
    assert.strictEqual(typeof svc.entrar, 'undefined');
    assert.strictEqual(typeof svc.sair, 'undefined');
  });

  await test('NF-e / sorvete pote: snapshot UC no documento', async () => {
    const s = svc.mapearItemDocumento({
      produto_id: 77,
      quantidade: 4,
      unidade_comercial: 'P200',
      unidade_comercial_id: 3,
      fator_conversao: 0.2,
      quantidade_fiscal: 0.8,
      valor_fiscal: 32,
      preco_unitario: 8,
      unidade: 'L'
    }, { contexto: 'NFE', origemOperacao: 'VENDA' });
    assert.strictEqual(s.unidadeComercial, 'P200');
    assert.strictEqual(s.quantidadeComercial, 4);
    assert.strictEqual(s.quantidadeBase, 0.8);
    assert.strictEqual(s.auditoria.contexto, mcc.ContextoConversao.NFE);
  });

  await test('Export MCC fiscalOperacional', async () => {
    assert.ok(mcc.FiscalOperacionalService);
    assert.ok(mcc.fiscalOperacional);
  });

  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  if (falhou > 0) process.exit(1);
}

run();
