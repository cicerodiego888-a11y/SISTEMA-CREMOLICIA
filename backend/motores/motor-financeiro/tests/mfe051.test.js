/**
 * MFE-05.1 — Bridge PDV + Comercial → Contas a Receber
 * Executar: npm run test:mfe051
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

function motorPdvOn(extra = {}) {
  Mfe.resetMotorParaTestes();
  return new Mfe.MotorFinanceiro({
    featureFlagOverrides: {
      FIN_EVENTS: true,
      FIN_LEDGER: true,
      FINANCEIRO_V2: true,
      FEATURE_MFE_PDV_AR: true,
      FEATURE_MFE_AR: false,
      FEATURE_MFE_COMERCIAL_AR: false,
      ...extra
    }
  });
}

function motorComercialOn(extra = {}) {
  Mfe.resetMotorParaTestes();
  return new Mfe.MotorFinanceiro({
    featureFlagOverrides: {
      FIN_EVENTS: true,
      FIN_LEDGER: true,
      FINANCEIRO_V2: true,
      FEATURE_MFE_COMERCIAL_AR: true,
      FEATURE_MFE_AR: false,
      FEATURE_MFE_PDV_AR: false,
      ...extra
    }
  });
}

function motorBridgeOff() {
  Mfe.resetMotorParaTestes();
  return new Mfe.MotorFinanceiro({
    featureFlagOverrides: {
      FIN_EVENTS: true,
      FIN_LEDGER: true,
      FEATURE_MFE_PDV_AR: false,
      FEATURE_MFE_COMERCIAL_AR: false,
      FEATURE_MFE_AR: false
    }
  });
}

async function run() {
  console.log('\n=== Testes MFE-05.1 — Bridge PDV + Comercial → AR ===\n');

  await test('Feature Flags PDV_AR e COMERCIAL_AR default OFF', () => {
    Mfe.resetMotorParaTestes();
    const motor = new Mfe.MotorFinanceiro();
    assert.strictEqual(motor.featureFlags.isEnabled(Mfe.FeatureFlag.FEATURE_MFE_PDV_AR), false);
    assert.strictEqual(motor.featureFlags.isEnabled(Mfe.FeatureFlag.FEATURE_MFE_COMERCIAL_AR), false);
  });

  await test('Feature Flag OFF — PdvArBridge é no-op (legado)', async () => {
    const motor = motorBridgeOff();
    const db = criarDbFake();
    const r = await motor.publicarPdvAr(db, { tipo: 'venda_completa', valor: 100, venda_id: 1 });
    assert.strictEqual(r.skipped, true);
    assert.strictEqual(r.reason, 'FEATURE_MFE_PDV_AR_OFF');
  });

  await test('Feature Flag OFF — ComercialArBridge é no-op (legado)', async () => {
    const motor = motorBridgeOff();
    const db = criarDbFake();
    const r = await motor.publicarComercialAr(db, { tipo: 'credito_gerado', valor: 50 });
    assert.strictEqual(r.skipped, true);
    assert.strictEqual(r.reason, 'FEATURE_MFE_COMERCIAL_AR_OFF');
  });

  await test('Venda PDV — SALE_COMPLETED → título via handler', async () => {
    const motor = motorPdvOn();
    const db = criarDbFake();
    const r = await motor.publicarPdvAr(db, {
      tipo: 'venda_completa',
      valor: 200,
      venda_id: 10,
      cliente_id: 5,
      total_parcelas: 2,
      data_vencimento: '2026-08-01',
      parcelas: [
        { numero: 1, totalParcelas: 2, valor: 100, saldo: 100, vencimento: '2026-08-01' },
        { numero: 2, totalParcelas: 2, valor: 100, saldo: 100, vencimento: '2026-09-01' }
      ],
      persistirTitulo: true,
      idempotencyKey: 'mfe051-pdv-sale-1'
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.eventType, 'SALE_COMPLETED');
    assert.strictEqual(r.context, Mfe.FinancialContext.PDV);
    assert.ok(r.resultado.ledgerEntries.length >= 1);
    const tit = motor.receivableHandler.obterTitulo(r.resultado.event.id);
    assert.ok(tit);
    assert.strictEqual(tit.parcelas.length, 2);
    assert.strictEqual(db._tables.contas_receber.length, 2);
  });

  await test('Venda Comercial — COMMERCIAL_CREDIT_GENERATED', async () => {
    const motor = motorComercialOn();
    const db = criarDbFake();
    const r = await motor.publicarComercialAr(db, {
      tipo: 'credito_gerado',
      valor: 150,
      consignacao_id: 7,
      cliente_id: 3,
      persistirTitulo: false,
      idempotencyKey: 'mfe051-com-credit-1'
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.eventType, 'COMMERCIAL_CREDIT_GENERATED');
    assert.strictEqual(r.context, Mfe.FinancialContext.COMERCIAL);
    const tit = motor.receivableHandler.obterTitulo(r.resultado.event.id);
    assert.ok(tit);
  });

  await test('Crédito Comercial usado + PAYMENT_RECEIVED', async () => {
    const motor = motorComercialOn();
    const db = criarDbFake();
    const used = await motor.publicarComercialAr(db, {
      tipo: 'credito_usado',
      valor: 40,
      consignacao_id: 8,
      idempotencyKey: 'mfe051-com-used-1'
    });
    assert.strictEqual(used.ok, true);
    assert.strictEqual(used.eventType, 'COMMERCIAL_CREDIT_USED');

    const pay = await motor.publicarComercialAr(db, {
      tipo: 'pagamento_recebido',
      valor: 40,
      consignacao_id: 8,
      idempotencyKey: 'mfe051-com-pay-1'
    });
    assert.strictEqual(pay.ok, true);
    assert.strictEqual(pay.eventType, 'PAYMENT_RECEIVED');
  });

  await test('Cancelamento — SALE_CANCELLED', async () => {
    const motor = motorPdvOn();
    const db = criarDbFake();
    const r = await motor.publicarPdvAr(db, {
      tipo: 'venda_cancelada',
      valor: 0,
      venda_id: 99,
      persistirTitulo: false,
      idempotencyKey: 'mfe051-pdv-cancel-1'
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.eventType, 'SALE_CANCELLED');
    assert.strictEqual(
      r.resultado.ledgerEntries[0].tipoLancamento,
      Mfe.TipoLancamentoOperacional.ESTORNO
    );
    const tit = motor.receivableHandler.obterTitulo(r.resultado.event.id);
    assert.ok(tit);
    assert.strictEqual(tit.status, Mfe.FinancialStatus.CANCELLED);
  });

  await test('Auditoria — operationId / correlationId / traceId / eventId / handler / origem', async () => {
    const motor = motorPdvOn();
    const db = criarDbFake();
    const r = await motor.publicarPdvAr(db, {
      tipo: 'venda_completa',
      valor: 80,
      venda_id: 11,
      cliente_id: 2,
      correlationId: 'corr-mfe051',
      traceId: 'trace-mfe051',
      operationId: 'op-mfe051',
      idempotencyKey: 'mfe051-audit-1'
    });
    assert.strictEqual(r.ok, true);
    const tit = motor.receivableHandler.obterTitulo(r.resultado.event.id);
    assert.strictEqual(tit.correlationId, 'corr-mfe051');
    assert.strictEqual(tit.traceId, 'trace-mfe051');
    assert.ok(tit.operationId);
    assert.ok(tit.eventId);
    assert.ok(db._tables.financial_audit.some((a) => a.acao === 'AR_HANDLER' || String(a.detalhe_json || '').includes('AR_HANDLER') || a.acao));
    const auditAr = db._tables.financial_audit.find((a) => {
      try {
        const d = typeof a.detalhe_json === 'string' ? JSON.parse(a.detalhe_json) : a.detalhe_json;
        return d && (d.handler === 'FinancialReceivableHandler' || a.acao === 'AR_HANDLER');
      } catch (_) {
        return a.acao === 'AR_HANDLER';
      }
    });
    assert.ok(auditAr, 'deve registrar auditoria do handler');
  });

  await test('Outbox — evento publicado', async () => {
    const motor = motorPdvOn();
    const db = criarDbFake();
    await motor.publicarPdvAr(db, {
      tipo: 'venda_completa',
      valor: 60,
      venda_id: 12,
      cliente_id: 1,
      idempotencyKey: 'mfe051-outbox-1'
    });
    assert.ok(db._tables.financial_outbox.length >= 1);
    const tipos = db._tables.financial_outbox.map((o) => o.event_type);
    assert.ok(
      tipos.includes('SALE_COMPLETED') || tipos.includes('LEDGER_ENTRY_CREATED'),
      `outbox deve conter evento oficial; got ${tipos.join(',')}`
    );
  });

  await test('Dead Letter — evento inválido', async () => {
    const motor = motorPdvOn();
    const db = criarDbFake();
    let threw = false;
    try {
      await motor.processarEvento(db, {
        type: 'TIPO_INEXISTENTE_XYZ',
        origem: 'PDV',
        idempotencyKey: 'mfe051-dl-1',
        correlationId: 'corr-dl',
        payload: { valor: 10 }
      });
    } catch (e) {
      threw = true;
    }
    assert.strictEqual(threw, true);
    assert.ok(db._tables.financial_dead_letter.length >= 1);
  });

  await test('Idempotência — mesmo idempotencyKey não duplica', async () => {
    const motor = motorPdvOn();
    const db = criarDbFake();
    const op = {
      tipo: 'venda_completa',
      valor: 90,
      venda_id: 13,
      cliente_id: 4,
      persistirTitulo: true,
      idempotencyKey: 'mfe051-idemp-1'
    };
    const r1 = await motor.publicarPdvAr(db, op);
    const r2 = await motor.publicarPdvAr(db, op);
    assert.strictEqual(r1.ok, true);
    assert.strictEqual(r2.resultado.skipped || r2.ok, true);
    assert.ok(r2.resultado.reason === 'IDEMPOTENCY' || r2.resultado.skipped === true);
    assert.strictEqual(db._tables.contas_receber.length, 1);
  });

  await test('isEventoAr cobre bridge events', () => {
    assert.ok(Mfe.isEventoAr('SALE_COMPLETED'));
    assert.ok(Mfe.isEventoAr('SALE_CANCELLED'));
    assert.ok(Mfe.isEventoAr('COMMERCIAL_CREDIT_GENERATED'));
    assert.ok(Mfe.isEventoAr('COMMERCIAL_CREDIT_USED'));
    assert.ok(Mfe.isEventoAr('PAYMENT_RECEIVED'));
  });

  await test('Adapter publicarEventoPdvArMfe respeita flag', async () => {
    Mfe.resetMotorParaTestes();
    const motorOff = new Mfe.MotorFinanceiro({
      featureFlagOverrides: { FEATURE_MFE_PDV_AR: false }
    });
    // bootstrap singleton — forçar via reset + overrides no próximo obterMotor
    Mfe.resetMotorParaTestes();
    const db = criarDbFake();
    const r = await Mfe.publicarEventoPdvArMfe(db, { tipo: 'venda_completa', valor: 1 });
    assert.strictEqual(r.skipped, true);
  });

  console.log(`\n=== Resultado: ${passou} OK, ${falhou} falhou ===\n`);
  if (falhou > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
