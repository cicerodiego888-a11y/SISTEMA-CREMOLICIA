/**
 * MFE-03 — Ledger Financeiro Operacional
 * Executar: npm run test:mfe03
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

function motorOk(extra = {}) {
  return new Mfe.MotorFinanceiro({
    featureFlagOverrides: {
      FIN_EVENTS: true,
      FIN_LEDGER: true,
      FINANCEIRO_V2: true
    },
    ...extra
  });
}

async function run() {
  console.log('\n=== Testes MFE-03 — Ledger Operacional ===\n');

  await test('Receita — VENDA_RECEBIDA gera LedgerEntry RECEITA/CREDITO', async () => {
    const motor = motorOk();
    const db = criarDbFake();
    const r = await motor.processarEvento(db, {
      type: Mfe.FinancialEventTypes.VENDA_RECEBIDA,
      origem: Mfe.OrigemFinanceira.PDV,
      idempotencyKey: 'rec-1',
      correlationId: 'corr-rec',
      operadorId: 1,
      payload: { valor: 150 }
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.ledgerEntries.length, 1);
    const e = r.ledgerEntries[0];
    assert.strictEqual(e.tipoLancamento, Mfe.TipoLancamentoOperacional.RECEITA);
    assert.strictEqual(e.natureza, Mfe.NaturezaLancamento.CREDITO);
    assert.strictEqual(e.valor, 150);
    assert.strictEqual(e.eventId, r.event.id);
    assert.ok(db._tables.financial_outbox.some((o) => o.event_type === 'LEDGER_ENTRY_CREATED'));
  });

  await test('Despesa — TITULO_AP_CRIADO gera DESPESA/DEBITO', async () => {
    const motor = motorOk();
    const db = criarDbFake();
    const r = await motor.processarEvento(db, {
      type: Mfe.FinancialEventTypes.TITULO_AP_CRIADO,
      origem: Mfe.OrigemFinanceira.COMPRA,
      idempotencyKey: 'desp-1',
      correlationId: 'corr-desp',
      payload: { valor: 80 }
    });
    assert.strictEqual(r.ledgerEntries[0].tipoLancamento, Mfe.TipoLancamentoOperacional.DESPESA);
    assert.strictEqual(r.ledgerEntries[0].natureza, Mfe.NaturezaLancamento.DEBITO);
  });

  await test('Estorno — VENDA_CANCELADA', async () => {
    const motor = motorOk();
    const db = criarDbFake();
    const r = await motor.processarEvento(db, {
      type: Mfe.FinancialEventTypes.VENDA_CANCELADA,
      origem: Mfe.OrigemFinanceira.PDV,
      idempotencyKey: 'est-1',
      correlationId: 'corr-est',
      payload: { valor: 50 }
    });
    assert.strictEqual(r.ledgerEntries[0].tipoLancamento, Mfe.TipoLancamentoOperacional.ESTORNO);
  });

  await test('Ajuste — AJUSTE_FINANCEIRO', async () => {
    const motor = motorOk();
    const db = criarDbFake();
    const r = await motor.processarEvento(db, {
      type: Mfe.FinancialEventTypes.AJUSTE_FINANCEIRO,
      origem: Mfe.OrigemFinanceira.MFE,
      idempotencyKey: 'aj-1',
      correlationId: 'corr-aj',
      payload: { valor: 12.5 }
    });
    assert.strictEqual(r.ledgerEntries[0].tipoLancamento, Mfe.TipoLancamentoOperacional.AJUSTE);
  });

  await test('Evento duplicado não duplica ledger', async () => {
    const motor = motorOk();
    const db = criarDbFake();
    const payload = {
      type: Mfe.FinancialEventTypes.PIX_RECEBIDO,
      origem: Mfe.OrigemFinanceira.PIX,
      idempotencyKey: 'dup-led-1',
      correlationId: 'corr-dup-led',
      payload: { valor: 20 }
    };
    await motor.processarEvento(db, payload);
    const b = await motor.processarEvento(db, payload);
    assert.strictEqual(b.skipped, true);
    assert.strictEqual(db._tables.financial_ledger.length, 1);
  });

  await test('Tentativa de UPDATE/DELETE no ledger', async () => {
    const motor = motorOk();
    await assert.rejects(() => motor.ledgerService.update(), (e) => e instanceof Mfe.LedgerImmutableError);
    await assert.rejects(() => motor.ledgerService.delete(), (e) => e instanceof Mfe.LedgerImmutableError);
  });

  await test('Proibido criarLancamento fora do pipeline', async () => {
    const motor = motorOk();
    const db = criarDbFake();
    await assert.rejects(
      () => motor.criarLancamento(db, {
        evento: 'X',
        eventId: 1,
        origem: 'PDV',
        tipoLancamento: Mfe.TipoLancamentoOperacional.RECEITA,
        natureza: Mfe.NaturezaLancamento.CREDITO,
        valor: 1,
        contaFinanceira: 'CAIXA',
        correlationId: 'c',
        idempotencyKey: 'k'
      }),
      (e) => e instanceof Mfe.LedgerEntryDirectForbiddenError
    );
  });

  await test('Auditoria LEDGER_CREATE', async () => {
    const motor = motorOk();
    const db = criarDbFake();
    await motor.processarEvento(db, {
      type: Mfe.FinancialEventTypes.TEF_APROVADO,
      origem: Mfe.OrigemFinanceira.TEF,
      idempotencyKey: 'aud-1',
      correlationId: 'corr-aud',
      payload: { valor: 33 }
    });
    assert.ok(db._tables.financial_audit.some((a) => a.acao === 'LEDGER_CREATE'));
  });

  await test('Outbox por LedgerEntry', async () => {
    const motor = motorOk();
    const db = criarDbFake();
    await motor.processarEvento(db, {
      type: Mfe.FinancialEventTypes.CAIXA_SUPRIMENTO,
      origem: Mfe.OrigemFinanceira.PDV,
      idempotencyKey: 'ob-1',
      correlationId: 'corr-ob',
      payload: { valor: 100 }
    });
    const ledgerOut = db._tables.financial_outbox.filter((o) => o.event_type === 'LEDGER_ENTRY_CREATED');
    assert.ok(ledgerOut.length >= 1);
  });

  await test('Histórico / por evento / por correlation / saldo lógico', async () => {
    const motor = motorOk();
    const db = criarDbFake();
    const r = await motor.processarEvento(db, {
      type: Mfe.FinancialEventTypes.VENDA_RECEBIDA,
      origem: Mfe.OrigemFinanceira.PDV,
      idempotencyKey: 'hist-1',
      correlationId: 'corr-hist',
      payload: { valor: 40 }
    });
    await motor.processarEvento(db, {
      type: Mfe.FinancialEventTypes.VENDA_CANCELADA,
      origem: Mfe.OrigemFinanceira.PDV,
      idempotencyKey: 'hist-2',
      correlationId: 'corr-hist',
      payload: { valor: 10 }
    });

    const hist = await motor.consultarHistorico(db, { correlationId: 'corr-hist' });
    assert.ok(hist.length >= 2);

    const porEvento = await motor.consultarPorEvento(db, r.event.id);
    assert.strictEqual(porEvento.length, 1);

    const porCorr = await motor.consultarPorCorrelationId(db, 'corr-hist');
    assert.ok(porCorr.length >= 2);

    const saldo = await motor.consultarSaldoLogico(db, { contaFinanceira: 'CAIXA' });
    assert.strictEqual(saldo.saldo, 30); // +40 -10
  });

  await test('FinancialLedgerService exportado', async () => {
    assert.ok(Mfe.FinancialLedgerService);
    assert.ok(Mfe.TipoLancamentoOperacional.RECEITA);
    assert.ok(Mfe.NaturezaLancamento.DEBITO);
  });

  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  if (falhou > 0) process.exit(1);
}

run();
