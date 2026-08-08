/**
 * MFE-07 — Liquidação Financeira
 * Executar: npm run test:mfe07
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

function motorSettlementOn(extra = {}) {
  Mfe.resetMotorParaTestes();
  return new Mfe.MotorFinanceiro({
    featureFlagOverrides: {
      FIN_EVENTS: true,
      FIN_LEDGER: true,
      FINANCEIRO_V2: true,
      FEATURE_MFE_SETTLEMENT: true,
      ...extra
    }
  });
}

function motorSettlementOff() {
  Mfe.resetMotorParaTestes();
  return new Mfe.MotorFinanceiro({
    featureFlagOverrides: {
      FIN_EVENTS: true,
      FIN_LEDGER: true,
      FEATURE_MFE_SETTLEMENT: false
    }
  });
}

async function assertLiquidacao(motor, metodo, opts, meioEsperado, eventType) {
  const db = criarDbFake();
  const r = await motor.gateway[metodo](db, {
    valor: opts.valor ?? 100,
    titulo_id: opts.titulo_id ?? 1,
    idempotencyKey: opts.idempotencyKey
  });
  assert.strictEqual(r.ok, true, `${metodo} ok`);
  assert.strictEqual(r.eventType, eventType);
  assert.strictEqual(r.gateway, 'FinancialGateway');
  const st = motor.settlementHandler.obterSettlement(r.resultado.event.id);
  assert.ok(st, `${metodo} settlement`);
  assert.strictEqual(st.meioFinanceiro, meioEsperado);
  assert.strictEqual(st.status, Mfe.FinancialSettlement.Status.COMPLETED);
  return { r, st, db };
}

async function run() {
  console.log('\n=== Testes MFE-07 — Liquidação Financeira ===\n');

  await test('Feature Flag FEATURE_MFE_SETTLEMENT default OFF', () => {
    Mfe.resetMotorParaTestes();
    const motor = new Mfe.MotorFinanceiro();
    assert.strictEqual(motor.featureFlags.isEnabled(Mfe.FeatureFlag.FEATURE_MFE_SETTLEMENT), false);
  });

  await test('Feature Flag OFF — handler skip', async () => {
    const motor = motorSettlementOff();
    const db = criarDbFake();
    const r = await motor.gateway.publicarLiquidacao(db, {
      valor: 50,
      idempotencyKey: 'mfe07-off-1'
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(motor.settlementHandler.listarSettlements().length, 0);
  });

  await test('Liquidação PIX', async () => {
    const motor = motorSettlementOn();
    await assertLiquidacao(motor, 'publicarPix', { idempotencyKey: 'mfe07-pix' }, Mfe.MeioFinanceiro.PIX, 'PIX_SETTLED');
  });

  await test('Liquidação TEF', async () => {
    const motor = motorSettlementOn();
    await assertLiquidacao(motor, 'publicarTef', { idempotencyKey: 'mfe07-tef' }, Mfe.MeioFinanceiro.TEF, 'TEF_SETTLED');
  });

  await test('Liquidação Dinheiro', async () => {
    const motor = motorSettlementOn();
    await assertLiquidacao(motor, 'publicarDinheiro', { idempotencyKey: 'mfe07-cash' }, Mfe.MeioFinanceiro.DINHEIRO, 'CASH_SETTLED');
  });

  await test('Liquidação Cartão Crédito', async () => {
    const motor = motorSettlementOn();
    await assertLiquidacao(motor, 'publicarCartaoCredito', { idempotencyKey: 'mfe07-cc' }, Mfe.MeioFinanceiro.CARTAO_CREDITO, 'CARD_SETTLED');
  });

  await test('Liquidação Cartão Débito', async () => {
    const motor = motorSettlementOn();
    await assertLiquidacao(motor, 'publicarCartaoDebito', { idempotencyKey: 'mfe07-cd' }, Mfe.MeioFinanceiro.CARTAO_DEBITO, 'CARD_SETTLED');
  });

  await test('Liquidação Boleto', async () => {
    const motor = motorSettlementOn();
    await assertLiquidacao(motor, 'publicarBoleto', { idempotencyKey: 'mfe07-bol' }, Mfe.MeioFinanceiro.BOLETO, 'BOLETO_SETTLED');
  });

  await test('Liquidação Cheque', async () => {
    const motor = motorSettlementOn();
    await assertLiquidacao(motor, 'publicarCheque', { idempotencyKey: 'mfe07-chq' }, Mfe.MeioFinanceiro.CHEQUE, 'CHECK_SETTLED');
  });

  await test('Liquidação Transferência', async () => {
    const motor = motorSettlementOn();
    await assertLiquidacao(motor, 'publicarTransferencia', { idempotencyKey: 'mfe07-trf' }, Mfe.MeioFinanceiro.TRANSFERENCIA, 'BANK_TRANSFER_SETTLED');
  });

  await test('Estorno — PAYMENT_REVERSED', async () => {
    const motor = motorSettlementOn();
    const db = criarDbFake();
    const r = await motor.gateway.publicarLiquidacao(db, {
      eventType: 'PAYMENT_REVERSED',
      valor: 25,
      titulo_id: 9,
      idempotencyKey: 'mfe07-rev'
    });
    assert.strictEqual(r.ok, true);
    const st = motor.settlementHandler.obterSettlement(r.resultado.event.id);
    assert.strictEqual(st.status, Mfe.FinancialSettlement.Status.REVERSED);
    assert.strictEqual(r.resultado.ledgerEntries[0].tipoLancamento, Mfe.TipoLancamentoOperacional.ESTORNO);
  });

  await test('FinancialGateway.publicarLiquidacao genérico', async () => {
    const motor = motorSettlementOn();
    const db = criarDbFake();
    const r = await motor.publicarLiquidacao(db, {
      valor: 33,
      meioFinanceiro: Mfe.MeioFinanceiro.OUTRO,
      idempotencyKey: 'mfe07-gw'
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.eventType, 'PAYMENT_SETTLED');
  });

  await test('Auditoria SETTLEMENT_HANDLER', async () => {
    const motor = motorSettlementOn();
    const db = criarDbFake();
    await motor.gateway.publicarPix(db, { valor: 10, idempotencyKey: 'mfe07-aud' });
    assert.ok(db._tables.financial_audit.some((a) => a.acao === 'SETTLEMENT_HANDLER'));
  });

  await test('Outbox', async () => {
    const motor = motorSettlementOn();
    const db = criarDbFake();
    await motor.gateway.publicarDinheiro(db, { valor: 8, idempotencyKey: 'mfe07-ob' });
    assert.ok(db._tables.financial_outbox.length >= 1);
  });

  await test('Dead Letter — tipo inválido', async () => {
    const motor = motorSettlementOn();
    const db = criarDbFake();
    let threw = false;
    try {
      await motor.gateway.publicar(db, {
        eventType: 'SETTLEMENT_XYZ_INVALIDO',
        valor: 1,
        idempotencyKey: 'mfe07-dl'
      });
    } catch (_) {
      threw = true;
    }
    assert.strictEqual(threw, true);
    assert.ok(db._tables.financial_dead_letter.length >= 1);
  });

  await test('Idempotência', async () => {
    const motor = motorSettlementOn();
    const db = criarDbFake();
    const op = { valor: 40, idempotencyKey: 'mfe07-idemp' };
    const a = await motor.gateway.publicarPix(db, op);
    const b = await motor.gateway.publicarPix(db, op);
    assert.strictEqual(a.ok, true);
    assert.ok(b.resultado.skipped === true || b.resultado.reason === 'IDEMPOTENCY');
  });

  await test('Enum MeioFinanceiro consolidado', () => {
    assert.ok(Mfe.isMeioFinanceiroValido('DINHEIRO'));
    assert.ok(Mfe.isMeioFinanceiroValido('PIX'));
    assert.ok(Mfe.isMeioFinanceiroValido('TEF'));
    assert.ok(Mfe.isMeioFinanceiroValido('CARTAO_CREDITO'));
    assert.ok(Mfe.isMeioFinanceiroValido('CARTAO_DEBITO'));
    assert.ok(Mfe.isMeioFinanceiroValido('BOLETO'));
    assert.ok(Mfe.isMeioFinanceiroValido('CHEQUE'));
    assert.ok(Mfe.isMeioFinanceiroValido('TRANSFERENCIA'));
    assert.ok(Mfe.isMeioFinanceiroValido('CREDITO_COMERCIAL'));
    assert.ok(Mfe.isMeioFinanceiroValido('OUTRO'));
  });

  await test('isEventoSettlement cobre catálogo', () => {
    assert.ok(Mfe.isEventoSettlement('PAYMENT_SETTLED'));
    assert.ok(Mfe.isEventoSettlement('PIX_SETTLED'));
    assert.ok(Mfe.isEventoSettlement('PAYMENT_REVERSED'));
    assert.ok(Mfe.isEventoSettlement('PIX_LIQUIDADO'));
  });

  await test('FinancialSettlement.validar', () => {
    const s = Mfe.FinancialSettlement.criar({
      meioFinanceiro: Mfe.MeioFinanceiro.PIX,
      valor: 10,
      titleId: 1
    });
    assert.strictEqual(s.validar().ok, true);
  });

  console.log(`\n=== Resultado: ${passou} OK, ${falhou} falhou ===\n`);
  if (falhou > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
