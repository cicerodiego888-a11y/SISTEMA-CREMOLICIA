/**
 * MFE-03 — Modelo Financeiro Unificado (domínio / SSOT)
 * Executar: npm run test:mfe03modelo
 */

const assert = require('assert');
const path = require('path');
const Mfe = require(path.join(__dirname, '..'));
const { criarDbFake } = require('./helpers/mfeDbFake');

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
  console.log('\n=== Testes MFE-03 — Modelo Financeiro Unificado ===\n');

  await test('FinancialOperation cria com trilha de auditoria', () => {
    const op = Mfe.FinancialOperation.criar({
      type: Mfe.FinancialOperationType.VENDA,
      origem: Mfe.OrigemFinanceira.PDV,
      valor: 100,
      meio: Mfe.MeioFinanceiro.DINHEIRO
    });
    op.assertValid();
    assert.ok(op.operationId);
    assert.ok(op.correlationId);
    assert.ok(op.traceId);
    assert.ok(op.idempotencyKey);
  });

  await test('FinancialEntry valida campos mínimos', () => {
    const entry = Mfe.FinancialEntry.criar({
      operationId: 'op-1',
      entryType: Mfe.TipoLancamentoOperacional.RECEITA,
      conta: 'CAIXA',
      valor: 50,
      origem: Mfe.OrigemFinanceira.PDV,
      correlationId: 'c1',
      traceId: 't1',
      idempotencyKey: 'i1',
      eventId: 10
    });
    entry.assertValid();
    const props = entry.paraLedgerEntryProps();
    assert.strictEqual(props.tipoLancamento, 'RECEITA');
    assert.strictEqual(props.contaFinanceira, 'CAIXA');
    assert.strictEqual(props.detalhes.operationId, 'op-1');
  });

  await test('FinancialDocument tipos oficiais', () => {
    const doc = Mfe.FinancialDocument.criar({
      type: Mfe.FinancialDocumentType.NFCE,
      numero: '123'
    });
    doc.assertValid();
    assert.strictEqual(doc.type, 'NFCE');
  });

  await test('FinancialAllocation infraestrutura sem regras', () => {
    const a = Mfe.FinancialAllocation.criar({
      operationId: 'op-1',
      centroCusto: 'CC-01',
      percentual: 50
    });
    a.assertValid();
    assert.strictEqual(a.percentual, 50);
  });

  await test('Catálogo oficial EN catalogado', () => {
    assert.ok(Mfe.isEventoCatalogado('SALE_COMPLETED'));
    assert.ok(Mfe.isEventoOficial('SALE_COMPLETED'));
    assert.ok(Mfe.isEventoCatalogado('VENDA_RECEBIDA'));
    assert.strictEqual(
      Mfe.resolverTipoEventoParaPipeline('SALE_COMPLETED'),
      'VENDA_RECEBIDA'
    );
  });

  await test('Enums Origem / Meio / OperationType', () => {
    assert.ok(Mfe.isOrigemFinanceiraValida('ERP'));
    assert.ok(Mfe.isOrigemFinanceiraValida('ESTOQUE'));
    assert.ok(Mfe.isMeioFinanceiroValido('PIX'));
    assert.ok(Mfe.isFinancialOperationTypeValido('RECEBIMENTO'));
  });

  await test('Alias EN passa no pipeline sem alterar consumidores', async () => {
    const motor = new Mfe.MotorFinanceiro({
      featureFlagOverrides: {
        FIN_EVENTS: true,
        FIN_LEDGER: true,
        FINANCEIRO_V2: true
      }
    });
    const db = criarDbFake();
    const r = await motor.processarEvento(db, {
      type: 'SALE_COMPLETED',
      origem: Mfe.OrigemFinanceira.PDV,
      idempotencyKey: 'sale-en-1',
      correlationId: 'corr-en',
      traceId: 'trace-en',
      payload: { valor: 99 }
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.ledgerEntries.length, 1);
    assert.strictEqual(r.ledgerEntries[0].tipoLancamento, Mfe.TipoLancamentoOperacional.RECEITA);
  });

  await test('FinancialEvent exige traceId', () => {
    const ev = Mfe.FinancialEvent.criar({
      type: 'VENDA_RECEBIDA',
      origem: 'PDV'
    });
    assert.ok(ev.traceId);
    ev.assertValid();
  });

  console.log(`\nResultado: ${passou} OK, ${falhou} falha(s)\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
