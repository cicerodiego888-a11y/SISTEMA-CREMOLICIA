/**
 * MFE-06 — Contas a Pagar / Compras (piloto)
 * Executar: npm run test:mfe06
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

function motorApOn(extra = {}) {
  Mfe.resetMotorParaTestes();
  return new Mfe.MotorFinanceiro({
    featureFlagOverrides: {
      FIN_EVENTS: true,
      FIN_LEDGER: true,
      FINANCEIRO_V2: true,
      FEATURE_MFE_AP: true,
      ...extra
    }
  });
}

function motorApOff() {
  Mfe.resetMotorParaTestes();
  return new Mfe.MotorFinanceiro({
    featureFlagOverrides: {
      FIN_EVENTS: true,
      FIN_LEDGER: true,
      FEATURE_MFE_AP: false
    }
  });
}

async function run() {
  console.log('\n=== Testes MFE-06 — Contas a Pagar (Compras) ===\n');

  await test('Feature Flag FEATURE_MFE_AP default OFF', () => {
    Mfe.resetMotorParaTestes();
    const motor = new Mfe.MotorFinanceiro();
    assert.strictEqual(motor.featureFlags.isEnabled(Mfe.FeatureFlag.FEATURE_MFE_AP), false);
  });

  await test('Feature Flag OFF — PurchasePayableBridge é no-op', async () => {
    const motor = motorApOff();
    const db = criarDbFake();
    const r = await motor.publicarCompraAp(db, { tipo: 'compra_confirmada', valor: 100, compra_id: 1 });
    assert.strictEqual(r.skipped, true);
    assert.strictEqual(r.reason, 'FEATURE_MFE_AP_OFF');
  });

  await test('Feature Flag ON — Compra confirmada PURCHASE_CONFIRMED', async () => {
    const motor = motorApOn();
    const db = criarDbFake();
    const r = await motor.publicarCompraAp(db, {
      tipo: 'compra_confirmada',
      compra_id: 10,
      valor: 500,
      fornecedor: 'Fornecedor X',
      total_parcelas: 1,
      persistirTitulo: true,
      idempotencyKey: 'mfe06-compra-1'
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.eventType, 'PURCHASE_CONFIRMED');
    assert.strictEqual(r.gateway, 'FinancialGateway');
    assert.strictEqual(r.bridge, 'PurchasePayableBridge');
    assert.ok(r.resultado.ledgerEntries[0].tipoLancamento === Mfe.TipoLancamentoOperacional.DESPESA);
    const tit = motor.payableHandler.obterTitulo(r.resultado.event.id);
    assert.ok(tit);
    assert.strictEqual(tit.compraId, 10);
  });

  await test('Cancelamento — PURCHASE_CANCELLED', async () => {
    const motor = motorApOn();
    const db = criarDbFake();
    const r = await motor.publicarCompraAp(db, {
      tipo: 'compra_cancelada',
      compra_id: 11,
      valor: 0,
      persistirTitulo: false,
      idempotencyKey: 'mfe06-canc-1'
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.eventType, 'PURCHASE_CANCELLED');
    const tit = motor.payableHandler.obterTitulo(r.resultado.event.id);
    assert.ok(tit);
    assert.strictEqual(tit.status, Mfe.FinancialStatus.CANCELLED);
  });

  await test('Criação AP — ACCOUNT_PAYABLE_CREATED', async () => {
    const motor = motorApOn();
    const db = criarDbFake();
    const r = await motor.publicarCompraAp(db, {
      tipo: 'criar',
      valor: 200,
      titulo_id: 1,
      compra_id: 12,
      idempotencyKey: 'mfe06-ap-criar'
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.eventType, 'ACCOUNT_PAYABLE_CREATED');
  });

  await test('Liquidação — ACCOUNT_PAYABLE_SETTLED', async () => {
    const motor = motorApOn();
    const db = criarDbFake();
    const r = await motor.publicarCompraAp(db, {
      tipo: 'baixar',
      valor: 80,
      titulo_id: 2,
      idempotencyKey: 'mfe06-ap-settled'
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.eventType, 'ACCOUNT_PAYABLE_SETTLED');
  });

  await test('Pagamento parcial — ACCOUNT_PAYABLE_PARTIAL', async () => {
    const motor = motorApOn();
    const db = criarDbFake();
    const r = await motor.publicarCompraAp(db, {
      tipo: 'parcial',
      valor: 30,
      titulo_id: 3,
      idempotencyKey: 'mfe06-ap-partial'
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.eventType, 'ACCOUNT_PAYABLE_PARTIAL');
  });

  await test('Parcelamento — infraestrutura FinancialInstallment', async () => {
    const motor = motorApOn();
    const db = criarDbFake();
    const r = await motor.publicarCompraAp(db, {
      tipo: 'compra_confirmada',
      compra_id: 20,
      valor: 300,
      total_parcelas: 3,
      data_vencimento: '2026-08-01',
      parcelas: [
        { numero: 1, totalParcelas: 3, valor: 100, saldo: 100, vencimento: '2026-08-01' },
        { numero: 2, totalParcelas: 3, valor: 100, saldo: 100, vencimento: '2026-09-01' },
        { numero: 3, totalParcelas: 3, valor: 100, saldo: 100, vencimento: '2026-10-01' }
      ],
      persistirTitulo: true,
      idempotencyKey: 'mfe06-parcelas'
    });
    assert.strictEqual(r.ok, true);
    const tit = motor.payableHandler.obterTitulo(r.resultado.event.id);
    assert.strictEqual(tit.parcelas.length, 3);
    assert.ok(db._tables.financeiro.length >= 3);
  });

  await test('FinancialGateway.publicarCompra / publicarContaPagar', async () => {
    const motor = motorApOn();
    const db = criarDbFake();
    const c = await motor.gateway.publicarCompra(db, {
      eventType: 'PURCHASE_CONFIRMED',
      valor: 55,
      compra_id: 30,
      idempotencyKey: 'mfe06-gw-compra'
    });
    assert.strictEqual(c.ok, true);
    assert.strictEqual(c.gateway, 'FinancialGateway');

    const ap = await motor.gateway.publicarContaPagar(db, {
      valor: 40,
      idempotencyKey: 'mfe06-gw-ap'
    });
    assert.strictEqual(ap.ok, true);
    assert.strictEqual(ap.eventType, 'ACCOUNT_PAYABLE_CREATED');
  });

  await test('Auditoria AP_HANDLER', async () => {
    const motor = motorApOn();
    const db = criarDbFake();
    await motor.publicarCompraAp(db, {
      tipo: 'criar',
      valor: 10,
      idempotencyKey: 'mfe06-audit'
    });
    assert.ok(db._tables.financial_audit.some((a) => a.acao === 'AP_HANDLER'));
  });

  await test('Outbox', async () => {
    const motor = motorApOn();
    const db = criarDbFake();
    await motor.publicarCompraAp(db, {
      tipo: 'compra_confirmada',
      valor: 12,
      compra_id: 40,
      idempotencyKey: 'mfe06-outbox'
    });
    assert.ok(db._tables.financial_outbox.length >= 1);
  });

  await test('Dead Letter — tipo inválido', async () => {
    const motor = motorApOn();
    const db = criarDbFake();
    let threw = false;
    try {
      await motor.gateway.publicar(db, {
        eventType: 'TIPO_AP_INVALIDO_XYZ',
        valor: 1,
        origem: 'COMPRA',
        idempotencyKey: 'mfe06-dl'
      });
    } catch (_) {
      threw = true;
    }
    assert.strictEqual(threw, true);
    assert.ok(db._tables.financial_dead_letter.length >= 1);
  });

  await test('Idempotência', async () => {
    const motor = motorApOn();
    const db = criarDbFake();
    const op = {
      tipo: 'compra_confirmada',
      compra_id: 50,
      valor: 90,
      persistirTitulo: true,
      idempotencyKey: 'mfe06-idemp'
    };
    const a = await motor.publicarCompraAp(db, op);
    const b = await motor.publicarCompraAp(db, op);
    assert.strictEqual(a.ok, true);
    assert.ok(b.resultado.skipped === true || b.resultado.reason === 'IDEMPOTENCY');
  });

  await test('isEventoAp cobre catálogo AP + bridge', () => {
    assert.ok(Mfe.isEventoAp('PURCHASE_CONFIRMED'));
    assert.ok(Mfe.isEventoAp('PURCHASE_CANCELLED'));
    assert.ok(Mfe.isEventoAp('ACCOUNT_PAYABLE_CREATED'));
    assert.ok(Mfe.isEventoAp('ACCOUNT_PAYABLE_SETTLED'));
    assert.ok(Mfe.isEventoAp('ACCOUNT_PAYABLE_PARTIAL'));
    assert.ok(Mfe.isEventoAp('ACCOUNT_PAYABLE_UPDATED'));
    assert.ok(Mfe.isEventoAp('ACCOUNT_PAYABLE_OVERDUE'));
    assert.ok(Mfe.isEventoAp('ACCOUNT_PAYABLE_RENEGOTIATED'));
  });

  console.log(`\n=== Resultado: ${passou} OK, ${falhou} falhou ===\n`);
  if (falhou > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
