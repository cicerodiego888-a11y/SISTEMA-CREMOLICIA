/**
 * MFE-04 — Caixa Operacional (piloto)
 * Executar: npm run test:mfe04
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

function motorCaixaOn(extra = {}) {
  Mfe.resetMotorParaTestes();
  return new Mfe.MotorFinanceiro({
    featureFlagOverrides: {
      FIN_EVENTS: true,
      FIN_LEDGER: true,
      FINANCEIRO_V2: true,
      FEATURE_MFE_CAIXA: true
    },
    ...extra
  });
}

function motorCaixaOff() {
  Mfe.resetMotorParaTestes();
  return new Mfe.MotorFinanceiro({
    featureFlagOverrides: {
      FIN_EVENTS: true,
      FIN_LEDGER: true,
      FEATURE_MFE_CAIXA: false
    }
  });
}

async function run() {
  console.log('\n=== Testes MFE-04 — Caixa Operacional ===\n');

  await test('Feature Flag FEATURE_MFE_CAIXA default OFF', () => {
    Mfe.resetMotorParaTestes();
    const motor = new Mfe.MotorFinanceiro();
    assert.strictEqual(motor.featureFlags.isEnabled(Mfe.FeatureFlag.FEATURE_MFE_CAIXA), false);
  });

  await test('Feature Flag OFF — publicarOperacaoCaixa é no-op', async () => {
    const motor = motorCaixaOff();
    const db = criarDbFake();
    const r = await motor.publicarOperacaoCaixa(db, {
      tipo: 'abertura',
      valor: 100,
      sessao_id: 1
    });
    assert.strictEqual(r.skipped, true);
    assert.ok(!db._tables.financial_events || db._tables.financial_events.length === 0
      || !db._tables.financial_events.some((e) => String(e.idempotency_key || '').includes('caixa')));
  });

  await test('Abertura de Caixa — CASH_OPENED → Ledger + CashHandler', async () => {
    const motor = motorCaixaOn();
    const db = criarDbFake();
    const r = await motor.publicarOperacaoCaixa(db, {
      tipo: 'abertura',
      valor: 200,
      sessao_id: 10,
      caixa_id: 1,
      terminal_id: 5,
      idempotencyKey: 't-abertura-1'
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.eventType, 'CASH_OPENED');
    assert.strictEqual(r.resultado.ledgerEntries.length, 1);
    assert.strictEqual(r.resultado.ledgerEntries[0].tipoLancamento, Mfe.TipoLancamentoOperacional.ABERTURA_CAIXA);
    const proj = motor.cashHandler.obterProjecao(r.resultado.event.id);
    assert.ok(proj);
    assert.strictEqual(proj.context, Mfe.FinancialContext.CAIXA);
    assert.strictEqual(proj.status, Mfe.FinancialStatus.COMPLETED);
  });

  await test('Fechamento de Caixa — CASH_CLOSED', async () => {
    const motor = motorCaixaOn();
    const db = criarDbFake();
    const r = await motor.publicarOperacaoCaixa(db, {
      tipo: 'fechamento',
      valor: 350,
      sessao_id: 11,
      idempotencyKey: 't-fecha-1'
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.resultado.ledgerEntries[0].tipoLancamento, Mfe.TipoLancamentoOperacional.FECHAMENTO_CAIXA);
  });

  await test('Suprimento — CASH_SUPPLY', async () => {
    const motor = motorCaixaOn();
    const db = criarDbFake();
    const r = await motor.publicarOperacaoCaixa(db, {
      tipo: 'suprimento',
      valor: 50,
      sessao_id: 12,
      idempotencyKey: 't-sup-1'
    });
    assert.strictEqual(r.resultado.ledgerEntries[0].tipoLancamento, Mfe.TipoLancamentoOperacional.SUPRIMENTO);
  });

  await test('Sangria — CASH_WITHDRAWAL', async () => {
    const motor = motorCaixaOn();
    const db = criarDbFake();
    const r = await motor.publicarOperacaoCaixa(db, {
      tipo: 'sangria',
      valor: 30,
      sessao_id: 13,
      idempotencyKey: 't-sang-1'
    });
    assert.strictEqual(r.resultado.ledgerEntries[0].tipoLancamento, Mfe.TipoLancamentoOperacional.SANGRIA);
  });

  await test('Ajuste — CASH_ADJUSTMENT', async () => {
    const motor = motorCaixaOn();
    const db = criarDbFake();
    const r = await motor.publicarOperacaoCaixa(db, {
      tipo: 'ajuste',
      valor: 5,
      sessao_id: 14,
      idempotencyKey: 't-aj-1'
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.resultado.ledgerEntries[0].tipoLancamento, Mfe.TipoLancamentoOperacional.AJUSTE);
  });

  await test('Idempotência — mesmo evento não duplica ledger', async () => {
    const motor = motorCaixaOn();
    const db = criarDbFake();
    const payload = {
      tipo: 'abertura',
      valor: 10,
      sessao_id: 99,
      idempotencyKey: 't-idemp-caixa'
    };
    const r1 = await motor.publicarOperacaoCaixa(db, payload);
    const r2 = await motor.publicarOperacaoCaixa(db, payload);
    assert.strictEqual(r1.ok, true);
    assert.ok(r2.resultado.ignored || r2.resultado.ok);
    const ledgerCount = (db._tables.financial_ledger || []).length;
    assert.strictEqual(ledgerCount, 1);
  });

  await test('Outbox — evento de caixa gera outbox', async () => {
    const motor = motorCaixaOn();
    const db = criarDbFake();
    await motor.publicarOperacaoCaixa(db, {
      tipo: 'suprimento',
      valor: 15,
      sessao_id: 20,
      idempotencyKey: 't-outbox-1'
    });
    assert.ok((db._tables.financial_outbox || []).length >= 1);
  });

  await test('Auditoria — CashHandler registra CASH_HANDLER', async () => {
    const motor = motorCaixaOn();
    const db = criarDbFake();
    await motor.publicarOperacaoCaixa(db, {
      tipo: 'sangria',
      valor: 8,
      sessao_id: 21,
      idempotencyKey: 't-audit-1'
    });
    const audits = db._tables.financial_audit || [];
    assert.ok(audits.some((a) => a.acao === 'CASH_HANDLER' || (a.detalhe && String(a.detalhe).includes('CASH'))));
  });

  await test('Dead Letter — tipo inválido', async () => {
    const motor = motorCaixaOn();
    const db = criarDbFake();
    let threw = false;
    try {
      await motor.processarEvento(db, {
        type: 'EVENTO_INEXISTENTE_XYZ',
        origem: Mfe.OrigemFinanceira.PDV,
        idempotencyKey: 't-dl-1',
        correlationId: 'c-dl',
        traceId: 't-dl'
      });
    } catch (e) {
      threw = true;
    }
    assert.ok(threw);
    assert.ok((db._tables.financial_dead_letter || []).length >= 1);
  });

  await test('CashHandler nunca cria ledger sem entries', async () => {
    const motor = motorCaixaOn();
    const db = criarDbFake();
    let threw = false;
    try {
      await motor.cashHandler.consumir(
        { type: 'CASH_OPENED', id: 1, idempotencyKey: 'x', correlationId: 'c' },
        { db, entries: [] }
      );
    } catch (e) {
      threw = true;
      assert.ok(/LedgerEntry/.test(e.message));
    }
    assert.ok(threw);
  });

  await test('Enums FinancialContext / FinancialStatus', () => {
    assert.ok(Mfe.isFinancialContextValido('CAIXA'));
    assert.ok(Mfe.isFinancialStatusValido('COMPLETED'));
    assert.strictEqual(Mfe.FinancialContext.CAIXA, 'CAIXA');
  });

  console.log(`\nResultado: ${passou} OK, ${falhou} falha(s)\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
