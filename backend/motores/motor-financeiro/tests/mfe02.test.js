/**
 * MFE-02 — Pipeline Oficial de Eventos Financeiros
 * Executar: npm run test:mfe02
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

function motorPipeline(extra = {}) {
  return new Mfe.MotorFinanceiro({
    featureFlagOverrides: {
      FIN_EVENTS: true,
      FIN_LEDGER: true,
      FINANCEIRO_V2: true,
      ...(extra.flags || {})
    },
    maxRetries: extra.maxRetries,
    registrarHandlers: extra.registrarHandlers
  });
}

async function run() {
  console.log('\n=== Testes MFE-02 — Pipeline de Eventos ===\n');

  await test('Evento válido → store + dispatcher + ledger + outbox', async () => {
    const motor = motorPipeline();
    const db = criarDbFake();
    const result = await motor.processarEvento(db, {
      type: Mfe.FinancialEventTypes.VENDA_RECEBIDA,
      origem: Mfe.OrigemFinanceira.PDV,
      operadorId: 9,
      idempotencyKey: 'pipe-ok-1',
      correlationId: 'corr-ok-1',
      payload: { valor: 99.9 }
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.skipped, false);
    assert.ok(result.event.id);
    assert.strictEqual(result.ledgerEntries.length, 1);
    assert.strictEqual(db._tables.financial_ledger.length, 1);
    assert.ok(db._tables.financial_outbox.length >= 1);
    assert.strictEqual(db._tables.financial_events[0].status, 'PROCESSED');
    assert.ok(db._tables.financial_audit.some((a) => a.acao === 'PIPELINE_SUCCESS'));
  });

  await test('Evento duplicado → idempotência (não reprocessa)', async () => {
    const motor = motorPipeline();
    const db = criarDbFake();
    const payload = {
      type: Mfe.FinancialEventTypes.PIX_RECEBIDO,
      origem: Mfe.OrigemFinanceira.PIX,
      idempotencyKey: 'dup-1',
      correlationId: 'corr-dup',
      payload: { valor: 10 }
    };
    const a = await motor.processarEvento(db, payload);
    const b = await motor.processarEvento(db, payload);
    assert.strictEqual(a.ok, true);
    assert.strictEqual(b.skipped, true);
    assert.strictEqual(b.reason, 'IDEMPOTENCY');
    assert.strictEqual(db._tables.financial_ledger.length, 1);
    assert.ok(db._tables.financial_audit.some((x) => x.acao === 'IDEMPOTENCY_IGNORED'));
  });

  await test('Evento inválido → dead letter', async () => {
    const motor = motorPipeline();
    const db = criarDbFake();
    let err = null;
    try {
      await motor.processarEvento(db, {
        type: '',
        origem: Mfe.OrigemFinanceira.PDV,
        idempotencyKey: 'inv-1',
        correlationId: 'c'
      });
    } catch (e) {
      err = e;
    }
    assert.ok(err instanceof Mfe.FinancialValidationError);
    assert.strictEqual(db._tables.financial_dead_letter.length, 1);
    assert.strictEqual(db._tables.financial_ledger.length, 0);
  });

  await test('Evento sem handler → dead letter', async () => {
    const motor = motorPipeline({ registrarHandlers: false });
    const db = criarDbFake();
    const result = await motor.processarEvento(db, {
      type: Mfe.FinancialEventTypes.VENDA_RECEBIDA,
      origem: Mfe.OrigemFinanceira.PDV,
      idempotencyKey: 'noh-1',
      correlationId: 'corr-noh',
      payload: { valor: 1 }
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.deadLetter, true);
    assert.strictEqual(db._tables.financial_dead_letter.length, 1);
    assert.strictEqual(db._tables.financial_events[0].status, 'DEAD_LETTER');
  });

  await test('Retry + dead letter após esgotar tentativas', async () => {
    const motor = motorPipeline({ maxRetries: 1 });
    const db = criarDbFake();
    let calls = 0;
    motor.dispatcher.registrarHandler(Mfe.FinancialEventTypes.AJUSTE_FINANCEIRO, {
      eventType: Mfe.FinancialEventTypes.AJUSTE_FINANCEIRO,
      nome: 'FlakyHandler',
      async handle() {
        calls += 1;
        throw new Error('falha simulada');
      },
      proporLancamentos: () => []
    });

    const result = await motor.processarEvento(db, {
      type: Mfe.FinancialEventTypes.AJUSTE_FINANCEIRO,
      origem: Mfe.OrigemFinanceira.MFE,
      idempotencyKey: 'retry-1',
      correlationId: 'corr-retry',
      payload: { valor: 1 }
    });
    assert.strictEqual(result.deadLetter, true);
    assert.strictEqual(calls, 2);
    assert.ok(db._tables.financial_audit.some((a) => a.acao === 'DISPATCH_RETRY'));
    assert.strictEqual(db._tables.financial_dead_letter.length, 1);
  });

  await test('Dispatcher + Outbox presentes no fluxo feliz', async () => {
    const motor = motorPipeline();
    const db = criarDbFake();
    const result = await motor.publisher.publicar(db, {
      type: Mfe.FinancialEventTypes.CAIXA_FECHADO,
      origem: Mfe.OrigemFinanceira.PDV,
      idempotencyKey: 'out-1',
      correlationId: 'corr-out',
      operadorId: 1,
      payload: { valor: 0 }
    });
    assert.strictEqual(result.ok, true);
    assert.ok(result.outbox.id);
    assert.ok(result.dispatch.handler);
    assert.ok(db._tables.financial_outbox.some((o) => o.status === 'PENDING'));
  });

  await test('Ledger só via pipeline', async () => {
    const motor = motorPipeline();
    const db = criarDbFake();
    await assert.rejects(
      () => motor.ledger.append(db, {
        evento: 'X',
        eventId: 1,
        origem: 'PDV',
        tipoLancamento: Mfe.TipoLancamentoOperacional.OUTROS,
        natureza: Mfe.NaturezaLancamento.CREDITO,
        valor: 1,
        contaFinanceira: 'C',
        correlationId: 'c',
        idempotencyKey: 'k'
      }),
      (e) => e instanceof Mfe.LedgerEntryDirectForbiddenError
    );
  });

  await test('Catálogo oficial expandido (MFE-02)', async () => {
    assert.ok(Mfe.FinancialEventTypes.CAIXA_SANGRIA);
    assert.ok(Mfe.FinancialEventTypes.ESTORNO_FINANCEIRO);
    assert.ok(Mfe.isEventoCatalogado('VENDA_RECEBIDA'));
    assert.strictEqual(Mfe.isEventoCatalogado('FOO'), false);
  });

  await test('Handlers oficiais registrados (vazios)', async () => {
    const motor = motorPipeline();
    assert.ok(motor.handlers.length >= 18);
    assert.ok(motor.dispatcher.obterHandler(Mfe.FinancialEventTypes.PIX_RECEBIDO));
    assert.ok(Mfe.handlers.VendaRecebidaHandler);
    assert.ok(Mfe.handlers.PixRecebidoHandler);
  });

  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  if (falhou > 0) process.exit(1);
}

run();
