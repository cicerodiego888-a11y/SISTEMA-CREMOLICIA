/**
 * MFE-01 — Fundação do Motor Financeiro
 * Executar: npm run test:mfe01
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

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
  console.log('\n=== Testes MFE-01 — Fundação Motor Financeiro ===\n');

  Mfe.resetMotorParaTestes();

  await test('Contratos públicos exportados', async () => {
    assert.ok(Mfe.IFinancialLedger);
    assert.ok(Mfe.IFinancialEventStore);
    assert.ok(Mfe.IFinancialPublisher);
    assert.ok(Mfe.IFinancialConsumer);
    assert.ok(Mfe.IFinancialAudit);
    assert.ok(Mfe.IFinancialEvent);
  });

  await test('Bootstrap / DI — motor CORE sem flags ligadas', async () => {
    const motor = Mfe.obterMotor({ forceNew: true });
    const info = motor.info();
    assert.strictEqual(info.motor, 'MotorFinanceiro');
    assert.strictEqual(info.flags.FINANCEIRO_V2, false);
    assert.strictEqual(info.flags.FIN_LEDGER, false);
    assert.strictEqual(info.flags.FIN_EVENTS, false);
    assert.ok(motor.ledger);
    assert.ok(motor.eventStore);
    assert.ok(motor.dispatcher);
    assert.ok(motor.audit);
    assert.ok(motor.featureFlags);
  });

  await test('Feature flags default OFF', async () => {
    const flags = new Mfe.FeatureFlagsService();
    assert.strictEqual(flags.isEnabled(Mfe.FeatureFlag.FINANCEIRO_V2), false);
    assert.strictEqual(flags.isEnabled(Mfe.FeatureFlag.FIN_LEDGER), false);
    assert.strictEqual(flags.isEnabled(Mfe.FeatureFlag.FIN_EVENTS), false);
  });

  await test('Ledger bloqueado fora do pipeline (MFE-02)', async () => {
    const motor = new Mfe.MotorFinanceiro({
      featureFlagOverrides: { FIN_LEDGER: true }
    });
    const db = criarDbFake();
    await assert.rejects(
      () => motor.ledger.append(db, {
        evento: 'VENDA_RECEBIDA',
        origem: 'PDV',
        tipo: Mfe.TipoLancamento.CREDITO,
        valor: 10,
        conta: 'CAIXA',
        correlationId: 'c1',
        idempotencyKey: 'k1'
      }),
      (e) => e instanceof Mfe.LedgerEntryDirectForbiddenError
    );
  });

  await test('Ledger append-only + persistência (via fromPipeline)', async () => {
    const motor = new Mfe.MotorFinanceiro({
      featureFlagOverrides: { FIN_LEDGER: true }
    });
    const db = criarDbFake();
    const entry = await motor.ledger.append(db, {
      evento: Mfe.FinancialEventTypes.VENDA_RECEBIDA,
      eventId: 1,
      origem: Mfe.OrigemFinanceira.PDV,
      tipoLancamento: Mfe.TipoLancamentoOperacional.RECEITA,
      natureza: Mfe.NaturezaLancamento.CREDITO,
      tipo: Mfe.TipoLancamento.CREDITO,
      valor: 150.5,
      conta: 'CAIXA',
      contaFinanceira: 'CAIXA',
      centroCusto: 'LOJA',
      operador: 7,
      correlationId: 'corr-1',
      causationId: 'cause-1',
      idempotencyKey: 'idem-ledger-1'
    }, { fromPipeline: true });
    assert.ok(entry.id);
    assert.strictEqual(entry.valor, 150.5);
    assert.strictEqual(db._tables.financial_ledger.length, 1);
    assert.ok(db._tables.financial_audit.some((a) => a.acao === 'LEDGER_CREATE'));
  });

  await test('Ledger rejeita UPDATE/DELETE', async () => {
    const motor = new Mfe.MotorFinanceiro({ featureFlagOverrides: { FIN_LEDGER: true } });
    await assert.rejects(() => motor.ledger.update(), (e) => e instanceof Mfe.LedgerImmutableError);
    await assert.rejects(() => motor.ledger.delete(), (e) => e instanceof Mfe.LedgerImmutableError);
  });

  await test('Event Store persiste + idempotência (store isolado)', async () => {
    const motor = new Mfe.MotorFinanceiro({
      featureFlagOverrides: { FIN_EVENTS: true }
    });
    const db = criarDbFake();

    const ev = await motor.eventStore.persistir(db, {
      type: Mfe.FinancialEventTypes.VENDA_RECEBIDA,
      origem: Mfe.OrigemFinanceira.PDV,
      payload: { valor: 10 },
      operadorId: 1,
      idempotencyKey: 'idem-evt-1',
      correlationId: 'corr-evt-1'
    });
    assert.ok(ev.id);
    assert.strictEqual(db._tables.financial_events.length, 1);
    assert.strictEqual(db._tables.financial_idempotency.length, 1);

    let conflict = null;
    try {
      await motor.eventStore.persistir(db, {
        type: Mfe.FinancialEventTypes.VENDA_RECEBIDA,
        origem: Mfe.OrigemFinanceira.PDV,
        idempotencyKey: 'idem-evt-1',
        correlationId: 'corr-evt-1'
      });
    } catch (e) {
      conflict = e;
    }
    assert.ok(conflict instanceof Mfe.IdempotencyConflictError);
  });

  await test('FinancialEvent / LedgerEntry validação', async () => {
    assert.throws(() => Mfe.FinancialEvent.criar({ type: '' }).assertValid());
    assert.throws(() => Mfe.FinancialLedgerEntry.criar({
      evento: 'X', origem: 'PDV', tipo: 'CREDITO', valor: 0, conta: 'C',
      correlationId: 'c', idempotencyKey: 'k'
    }).assertValid());
  });

  await test('Schema bootstrap exportado (SQL CREATE)', async () => {
    const calls = [];
    const db = {
      run(sql, params, cb) {
        calls.push(sql);
        const done = typeof params === 'function' ? params : cb;
        done && done(null);
      },
      all(sql, params, cb) {
        const done = typeof params === 'function' ? params : cb;
        done && done(null, []);
      }
    };
    await Mfe.bootstrapMotorFinanceiroSchema(db);
    const joined = calls.join('\n');
    assert.ok(joined.includes('financial_ledger'));
    assert.ok(joined.includes('financial_events'));
    assert.ok(joined.includes('financial_outbox'));
    assert.ok(joined.includes('financial_dead_letter'));
    assert.ok(joined.includes('financial_idempotency'));
    assert.ok(joined.includes('financial_audit'));
    assert.ok(joined.includes('event_id') || joined.includes('ADD COLUMN event_id'));
  });

  await test('Sem dependência circular / sem require de outros motores', async () => {
    const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
    assert.ok(!/motor-estoque|motor-conversao|motor-comercial|motores\/muc/.test(indexSrc));
    const appSrc = fs.readFileSync(
      path.join(__dirname, '..', 'application', 'MotorFinanceiro.js'),
      'utf8'
    );
    assert.ok(!/motor-estoque|motor-conversao|motor-comercial/.test(appSrc));
  });

  await test('bootstrapMotorFinanceiro retorna componentes oficiais', async () => {
    Mfe.resetMotorParaTestes();
    const db = criarDbFake();
    const boot = await Mfe.bootstrapMotorFinanceiro(db, { forceNew: true });
    assert.ok(boot.motor);
    assert.ok(boot.FinancialLedger);
    assert.ok(boot.FinancialEventDispatcher);
    assert.ok(boot.FinancialEventStore);
    assert.ok(boot.FinancialAudit);
    assert.ok(boot.FeatureFlags);
    assert.strictEqual(boot.meta.sprint, 'MFE-03');
  });

  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  if (falhou > 0) process.exit(1);
}

run();
