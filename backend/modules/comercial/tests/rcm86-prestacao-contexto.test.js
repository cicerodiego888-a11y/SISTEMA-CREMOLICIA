/**
 * RCM-8.6 — Estabilidade de contexto da Prestação de Contas (runner node)
 *
 * Espelha os cenários do suite Jest em
 * frontend/modules/motor-comercial/tests/pages/rcm86-prestacao-contexto.test.js
 *
 * Executar:
 *   node backend/modules/comercial/tests/rcm86-prestacao-contexto.test.js
 */

const assert = require('assert');
const path = require('path');

process.chdir(path.resolve(__dirname, '../../../..'));

const {
  createOperacaoContext,
  captureContextToken,
  isContextCurrent,
  bumpOperacaoContext,
  patchOperacaoContext
} = require('../../../../frontend/modules/motor-comercial/pages/PrestacaoContas/prestacaoOperacaoContext');
const {
  buildFinanceiroFromResumo,
  labelSituacaoFinanceira,
  SITUACAO
} = require('../../../../frontend/modules/motor-comercial/pages/PrestacaoContas/prestacaoFinanceiroSnapshot');
const {
  labelSituacaoFinanceiraOficial
} = require('../../../../frontend/modules/motor-comercial/pages/PrestacaoContas/prestacaoOperacionalConsolidacao');
const FecharConsignacaoView = require('../../../../frontend/modules/motor-comercial/pages/PrestacaoContas/FecharConsignacaoView');

let passou = 0;
let falhou = 0;

function test(nome, fn) {
  try {
    fn();
    passou += 1;
    console.log(`  OK  ${nome}`);
  } catch (err) {
    falhou += 1;
    console.error(`  FALHOU  ${nome}\n         ${err.message}`);
  }
}

async function testAsync(nome, fn) {
  try {
    await fn();
    passou += 1;
    console.log(`  OK  ${nome}`);
  } catch (err) {
    falhou += 1;
    console.error(`  FALHOU  ${nome}\n         ${err.message}`);
  }
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log('\nRCM-8.6 — Contexto Prestação de Contas\n');

  test('1. contexto cliente correto', () => {
    const ctx = createOperacaoContext({ clienteId: 10, consignacaoId: 101 });
    assert.strictEqual(ctx.clienteId, '10');
  });

  test('2. contexto consignação correto', () => {
    const ctx = createOperacaoContext({ clienteId: 7, consignacaoId: 55 });
    assert.strictEqual(ctx.consignacaoId, '55');
  });

  test('3. contexto prestação correto', () => {
    const ctx = createOperacaoContext({
      clienteId: 1,
      consignacaoId: 2,
      prestacaoId: 'P-9'
    });
    const patched = patchOperacaoContext(ctx, { prestacaoId: 'P-88' });
    assert.strictEqual(patched.prestacaoId, 'P-88');
    assert.strictEqual(patched.contextVersion, ctx.contextVersion);
  });

  test('4/5. tokens Milton↔Max não se confundem', () => {
    const milton = createOperacaoContext({
      clienteId: 'MILTON',
      consignacaoId: 'M1',
      prestacaoId: 'PM'
    });
    const max = createOperacaoContext({
      clienteId: 'MAX',
      consignacaoId: 'X1',
      prestacaoId: 'PX',
      contextVersion: 2
    });
    assert.strictEqual(isContextCurrent(captureContextToken(milton), max), false);
    assert.strictEqual(isContextCurrent(captureContextToken(max), max), true);
  });

  test('6. troca rápida — bump invalida anteriores', () => {
    let ctx = createOperacaoContext({ clienteId: 'MILTON', consignacaoId: 'A' });
    const t1 = captureContextToken(ctx);
    ctx = bumpOperacaoContext(ctx, { clienteId: 'CICERO', consignacaoId: 'B' });
    const t2 = captureContextToken(ctx);
    ctx = bumpOperacaoContext(ctx, { clienteId: 'MAX', consignacaoId: 'C' });
    assert.strictEqual(isContextCurrent(t1, ctx), false);
    assert.strictEqual(isContextCurrent(t2, ctx), false);
    assert.strictEqual(isContextCurrent(captureContextToken(ctx), ctx), true);
    assert.strictEqual(ctx.consignacaoId, 'C');
  });

  await testAsync('7. resposta atrasada ignorada', async () => {
    const atual = createOperacaoContext({
      clienteId: 'MAX',
      consignacaoId: 'X1',
      contextVersion: 2
    });
    const tokenMilton = captureContextToken(createOperacaoContext({
      clienteId: 'MILTON',
      consignacaoId: 'M1',
      contextVersion: 1
    }));

    let applied = null;
    const applyIfCurrent = (token, payload) => {
      if (!isContextCurrent(token, atual)) return;
      applied = payload;
    };

    applyIfCurrent(captureContextToken(atual), { cliente: 'MAX' });
    assert.strictEqual(applied.cliente, 'MAX');

    await delay(5);
    applyIfCurrent(tokenMilton, { cliente: 'MILTON' });
    assert.strictEqual(applied.cliente, 'MAX');
  });

  test('8/9. disposed invalida timer/polling', () => {
    const atual = createOperacaoContext({
      clienteId: '1',
      consignacaoId: '1',
      contextVersion: 3
    });
    const token = captureContextToken(atual);
    assert.strictEqual(isContextCurrent(token, atual, { disposed: true }), false);
    const bumped = bumpOperacaoContext(atual);
    assert.strictEqual(isContextCurrent(token, bumped), false);
  });

  test('10. desmontagem = bump de versão', () => {
    const before = createOperacaoContext({ consignacaoId: '9', contextVersion: 4 });
    const after = bumpOperacaoContext(before);
    assert.ok(after.contextVersion > before.contextVersion);
  });

  await testAsync('11. erro antigo não aplica em contexto novo', async () => {
    const atual = createOperacaoContext({
      clienteId: 'MAX',
      consignacaoId: 'NEW',
      contextVersion: 2
    });
    const tokenOld = captureContextToken(createOperacaoContext({
      clienteId: 'MILTON',
      consignacaoId: 'OLD',
      contextVersion: 1
    }));
    let errorUi = null;
    const applyError = (token, err) => {
      if (!isContextCurrent(token, atual)) return;
      errorUi = err;
    };
    applyError(tokenOld, new Error('falha MILTON'));
    assert.strictEqual(errorUi, null);
  });

  test('12. Sem venda não aparece como Quitada', () => {
    const fin = buildFinanceiroFromResumo({ valorVendido: 0, valorRecebido: 0 });
    assert.strictEqual(fin.situacaoFinanceira, SITUACAO.SEM_VENDA);
    assert.strictEqual(labelSituacaoFinanceira(fin.situacaoFinanceira), 'Sem Venda');
    assert.strictEqual(labelSituacaoFinanceiraOficial(fin.situacaoFinanceira), 'Sem Venda');
    assert.notStrictEqual(labelSituacaoFinanceira(fin.situacaoFinanceira), 'Quitada');

    const html = FecharConsignacaoView._htmlCardFinanceiro(fin, 'Sem Venda');
    assert.match(html, /Sem Venda/);
    assert.doesNotMatch(html, /Valor da Venda/);
    assert.doesNotMatch(html, /Quitada/);
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falha(s)\n`);
  if (falhou > 0) process.exit(1);
  console.log('RCM-8.6 PASSOU\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
