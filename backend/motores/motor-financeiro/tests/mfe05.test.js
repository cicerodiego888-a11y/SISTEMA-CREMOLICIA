/**
 * MFE-05 — Contas a Receber (piloto)
 * Executar: npm run test:mfe05
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

function motorArOn(extra = {}) {
  Mfe.resetMotorParaTestes();
  return new Mfe.MotorFinanceiro({
    featureFlagOverrides: {
      FIN_EVENTS: true,
      FIN_LEDGER: true,
      FINANCEIRO_V2: true,
      FEATURE_MFE_AR: true
    },
    ...extra
  });
}

function motorArOff() {
  Mfe.resetMotorParaTestes();
  return new Mfe.MotorFinanceiro({
    featureFlagOverrides: {
      FIN_EVENTS: true,
      FIN_LEDGER: true,
      FEATURE_MFE_AR: false
    }
  });
}

async function run() {
  console.log('\n=== Testes MFE-05 — Contas a Receber ===\n');

  await test('Feature Flag FEATURE_MFE_AR default OFF', () => {
    Mfe.resetMotorParaTestes();
    const motor = new Mfe.MotorFinanceiro();
    assert.strictEqual(motor.featureFlags.isEnabled(Mfe.FeatureFlag.FEATURE_MFE_AR), false);
  });

  await test('Feature Flag OFF — publicarOperacaoAr é no-op', async () => {
    const motor = motorArOff();
    const db = criarDbFake();
    const r = await motor.publicarOperacaoAr(db, { tipo: 'criar', valor: 100 });
    assert.strictEqual(r.skipped, true);
  });

  await test('Criar título — ACCOUNT_RECEIVABLE_CREATED', async () => {
    const motor = motorArOn();
    const db = criarDbFake();
    const r = await motor.publicarOperacaoAr(db, {
      tipo: 'criar',
      valor: 300,
      titulo_id: 1,
      venda_id: 10,
      cliente_id: 5,
      numero_parcela: 1,
      total_parcelas: 1,
      idempotencyKey: 'ar-criar-1'
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.eventType, 'ACCOUNT_RECEIVABLE_CREATED');
    assert.strictEqual(r.resultado.ledgerEntries[0].tipoLancamento, Mfe.TipoLancamentoOperacional.RECEITA);
    const tit = motor.receivableHandler.obterTitulo(r.resultado.event.id);
    assert.ok(tit);
    assert.strictEqual(tit.parcelas.length, 1);
  });

  await test('Cancelar título', async () => {
    const motor = motorArOn();
    const db = criarDbFake();
    const r = await motor.publicarOperacaoAr(db, {
      tipo: 'cancelar',
      valor: 50,
      titulo_id: 2,
      idempotencyKey: 'ar-canc-1'
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.resultado.ledgerEntries[0].tipoLancamento, Mfe.TipoLancamentoOperacional.ESTORNO);
  });

  await test('Baixar título — SETTLED', async () => {
    const motor = motorArOn();
    const db = criarDbFake();
    const r = await motor.publicarOperacaoAr(db, {
      tipo: 'baixar',
      valor: 80,
      valor_pago: 80,
      valor_restante: 0,
      titulo_id: 3,
      idempotencyKey: 'ar-baixa-1'
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.resultado.ledgerEntries[0].contaFinanceira, 'CAIXA');
  });

  await test('Baixa parcial', async () => {
    const motor = motorArOn();
    const db = criarDbFake();
    const r = await motor.publicarOperacaoAr(db, {
      tipo: 'parcial',
      valor: 40,
      valor_pago: 40,
      valor_restante: 60,
      titulo_id: 4,
      idempotencyKey: 'ar-parc-1'
    });
    assert.strictEqual(r.eventType, 'ACCOUNT_RECEIVABLE_PARTIAL');
  });

  await test('Parcelamento — infraestrutura FinancialInstallment', () => {
    const parcelas = Mfe.FinancialInstallment.gerarParcelas({
      valorTotal: 100,
      quantidade: 3,
      primeiroVencimento: '2026-08-01',
      tituloId: 99
    });
    assert.strictEqual(parcelas.length, 3);
    assert.strictEqual(parcelas[0].numero, 1);
    const soma = parcelas.reduce((a, p) => a + p.valor, 0);
    assert.ok(Math.abs(soma - 100) < 0.01);
    parcelas.forEach((p) => p.assertValid());
  });

  await test('Criar com total_parcelas gera projeção parcelada', async () => {
    const motor = motorArOn();
    const db = criarDbFake();
    const r = await motor.publicarOperacaoAr(db, {
      tipo: 'criar',
      valor: 150,
      total_parcelas: 3,
      data_vencimento: '2026-09-01',
      titulo_id: 7,
      idempotencyKey: 'ar-parcel-1'
    });
    const tit = motor.receivableHandler.obterTitulo(r.resultado.event.id);
    assert.strictEqual(tit.parcelas.length, 3);
  });

  await test('Idempotência', async () => {
    const motor = motorArOn();
    const db = criarDbFake();
    const payload = { tipo: 'criar', valor: 10, titulo_id: 8, idempotencyKey: 'ar-idemp' };
    await motor.publicarOperacaoAr(db, payload);
    await motor.publicarOperacaoAr(db, payload);
    assert.strictEqual((db._tables.financial_ledger || []).length, 1);
  });

  await test('Outbox', async () => {
    const motor = motorArOn();
    const db = criarDbFake();
    await motor.publicarOperacaoAr(db, {
      tipo: 'criar',
      valor: 12,
      idempotencyKey: 'ar-outbox'
    });
    assert.ok((db._tables.financial_outbox || []).length >= 1);
  });

  await test('Auditoria AR_HANDLER', async () => {
    const motor = motorArOn();
    const db = criarDbFake();
    await motor.publicarOperacaoAr(db, {
      tipo: 'baixar',
      valor: 9,
      idempotencyKey: 'ar-audit'
    });
    const audits = db._tables.financial_audit || [];
    assert.ok(audits.some((a) => a.acao === 'AR_HANDLER'));
  });

  await test('Dead Letter — tipo inválido', async () => {
    const motor = motorArOn();
    const db = criarDbFake();
    let threw = false;
    try {
      await motor.processarEvento(db, {
        type: 'AR_INEXISTENTE',
        origem: Mfe.OrigemFinanceira.ERP,
        idempotencyKey: 'ar-dl',
        correlationId: 'c',
        traceId: 't'
      });
    } catch (e) {
      threw = true;
    }
    assert.ok(threw);
    assert.ok((db._tables.financial_dead_letter || []).length >= 1);
  });

  await test('Handler nunca cria ledger sem entries', async () => {
    const motor = motorArOn();
    const db = criarDbFake();
    let threw = false;
    try {
      await motor.receivableHandler.consumir(
        { type: 'ACCOUNT_RECEIVABLE_CREATED', id: 1, idempotencyKey: 'x', correlationId: 'c' },
        { db, entries: [] }
      );
    } catch (e) {
      threw = true;
    }
    assert.ok(threw);
  });

  console.log(`\nResultado: ${passou} OK, ${falhou} falha(s)\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
