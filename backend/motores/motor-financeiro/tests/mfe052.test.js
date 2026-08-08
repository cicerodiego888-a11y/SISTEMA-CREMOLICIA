/**
 * MFE-05.2 — FinancialGateway (Facade oficial)
 * Executar: npm run test:mfe052
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

function motorFull(extra = {}) {
  Mfe.resetMotorParaTestes();
  return new Mfe.MotorFinanceiro({
    featureFlagOverrides: {
      FIN_EVENTS: true,
      FIN_LEDGER: true,
      FINANCEIRO_V2: true,
      FEATURE_MFE_CAIXA: true,
      FEATURE_MFE_AR: true,
      FEATURE_MFE_PDV_AR: true,
      FEATURE_MFE_COMERCIAL_AR: true,
      ...extra
    }
  });
}

async function run() {
  console.log('\n=== Testes MFE-05.2 — FinancialGateway ===\n');

  await test('FinancialGateway existe no motor', () => {
    const motor = motorFull();
    assert.ok(motor.gateway);
    assert.strictEqual(motor.gateway.nome, 'FinancialGateway');
    assert.ok(typeof motor.gateway.publicar === 'function');
    assert.ok(typeof motor.publicar === 'function');
  });

  await test('Publicar venda — contexto PDV automático', async () => {
    const motor = motorFull();
    const db = criarDbFake();
    const r = await motor.gateway.publicarVenda(db, {
      eventType: 'SALE_COMPLETED',
      valor: 100,
      venda_id: 1,
      cliente_id: 2,
      idempotencyKey: 'gw-venda-1'
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.gateway, 'FinancialGateway');
    assert.strictEqual(r.context, Mfe.FinancialContext.PDV);
    assert.strictEqual(r.eventType, 'SALE_COMPLETED');
  });

  await test('Publicar pagamento', async () => {
    const motor = motorFull();
    const db = criarDbFake();
    const r = await motor.gateway.publicarPagamento(db, {
      valor: 50,
      idempotencyKey: 'gw-pag-1'
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.eventType, 'PAYMENT_RECEIVED');
  });

  await test('Publicar caixa — contexto CAIXA', async () => {
    const motor = motorFull();
    const db = criarDbFake();
    const r = await motor.gateway.publicarCaixa(db, {
      eventType: 'CASH_OPENED',
      valor: 0,
      sessao_id: 9,
      idempotencyKey: 'gw-caixa-1'
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.context, Mfe.FinancialContext.CAIXA);
  });

  await test('Publicar crédito comercial — contexto COMERCIAL', async () => {
    const motor = motorFull();
    const db = criarDbFake();
    const r = await motor.gateway.publicarCreditoComercial(db, {
      eventType: 'COMMERCIAL_CREDIT_GENERATED',
      valor: 75,
      consignacao_id: 3,
      idempotencyKey: 'gw-cred-1'
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.context, Mfe.FinancialContext.COMERCIAL);
  });

  await test('Publicar conta receber', async () => {
    const motor = motorFull();
    const db = criarDbFake();
    const r = await motor.gateway.publicarContaReceber(db, {
      valor: 200,
      titulo_id: 1,
      idempotencyKey: 'gw-ar-1'
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.eventType, 'ACCOUNT_RECEIVABLE_CREATED');
    assert.strictEqual(r.context, Mfe.FinancialContext.FINANCEIRO);
  });

  await test('Publicar conta pagar', async () => {
    const motor = motorFull();
    const db = criarDbFake();
    const r = await motor.gateway.publicarContaPagar(db, {
      valor: 300,
      idempotencyKey: 'gw-ap-1'
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.eventType, 'ACCOUNT_PAYABLE_CREATED');
  });

  await test('Contexto automático — ignora context manual do módulo', async () => {
    const motor = motorFull();
    const db = criarDbFake();
    const r = await motor.gateway.publicar(db, {
      eventType: 'CASH_SUPPLY',
      canal: 'CAIXA',
      context: Mfe.FinancialContext.FISCAL,
      valor: 10,
      idempotencyKey: 'gw-ctx-1'
    });
    assert.strictEqual(r.context, Mfe.FinancialContext.CAIXA);
  });

  await test('Compatibilidade bridges — PdvArBridge usa Gateway', async () => {
    const motor = motorFull();
    const db = criarDbFake();
    const r = await motor.publicarPdvAr(db, {
      tipo: 'venda_completa',
      valor: 80,
      venda_id: 5,
      cliente_id: 1,
      persistirTitulo: true,
      idempotencyKey: 'gw-bridge-pdv-1'
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.gateway, 'FinancialGateway');
    assert.strictEqual(r.bridge, 'PdvArBridge');
  });

  await test('Compatibilidade bridges — ComercialArBridge usa Gateway', async () => {
    const motor = motorFull();
    const db = criarDbFake();
    const r = await motor.publicarComercialAr(db, {
      tipo: 'credito_gerado',
      valor: 40,
      consignacao_id: 2,
      persistirTitulo: false,
      idempotencyKey: 'gw-bridge-com-1'
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.gateway, 'FinancialGateway');
    assert.strictEqual(r.bridge, 'ComercialArBridge');
  });

  await test('Idempotência via Gateway', async () => {
    const motor = motorFull();
    const db = criarDbFake();
    const op = {
      eventType: 'SALE_COMPLETED',
      valor: 11,
      idempotencyKey: 'gw-idemp-1'
    };
    const a = await motor.gateway.publicarVenda(db, op);
    const b = await motor.gateway.publicarVenda(db, op);
    assert.strictEqual(a.ok, true);
    assert.ok(b.resultado.skipped === true || b.resultado.reason === 'IDEMPOTENCY');
  });

  await test('Auditoria GATEWAY_PUBLISH', async () => {
    const motor = motorFull();
    const db = criarDbFake();
    await motor.gateway.publicarVenda(db, {
      valor: 5,
      idempotencyKey: 'gw-audit-1'
    });
    const hit = db._tables.financial_audit.some((a) => a.acao === 'GATEWAY_PUBLISH');
    assert.ok(hit, 'deve registrar GATEWAY_PUBLISH');
  });

  await test('Outbox via Gateway', async () => {
    const motor = motorFull();
    const db = criarDbFake();
    await motor.gateway.publicarContaReceber(db, {
      valor: 15,
      idempotencyKey: 'gw-outbox-1'
    });
    assert.ok(db._tables.financial_outbox.length >= 1);
  });

  await test('Dead Letter — tipo inválido via Gateway → Pipeline', async () => {
    const motor = motorFull();
    const db = criarDbFake();
    let threw = false;
    try {
      await motor.gateway.publicar(db, {
        eventType: 'TIPO_FANTASMA_XYZ',
        valor: 1,
        origem: 'PDV',
        idempotencyKey: 'gw-dl-1',
        correlationId: 'corr-dl'
      });
    } catch (e) {
      threw = true;
    }
    assert.strictEqual(threw, true);
    assert.ok(db._tables.financial_dead_letter.length >= 1);
  });

  console.log(`\n=== Resultado: ${passou} OK, ${falhou} falhou ===\n`);
  if (falhou > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
