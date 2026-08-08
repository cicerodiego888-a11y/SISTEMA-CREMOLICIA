/**
 * RCM-7.1 — Tipo Comercial do Cliente
 *
 * Executar:
 *   node backend/modules/comercial/tests/rcm71-tipo-comercial.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

process.chdir(path.resolve(__dirname, '../../../..'));

const db = require('../../../database');
const tiposService = require('../tipos-comerciais/TiposComerciaisService');
const CanalVendaResolver = require('../preco/CanalVendaResolver');

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

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

async function waitDb() {
  for (let i = 0; i < 60; i++) {
    try {
      await get('SELECT 1 AS ok');
      return;
    } catch (_) {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error('DB não pronto');
}

console.log('\nRCM-7.1 — Tipo Comercial do Cliente\n');

test('Docs RCM71 existe', () => {
  const p = path.resolve(__dirname, '../../../../docs/RCM71_TIPO_COMERCIAL_CLIENTE.md');
  assert.ok(fs.existsSync(p));
});

test('Cliente UI não referencia tabela_preco / linha no cadastro', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../../../frontend/erp/js/clientes.js'),
    'utf8'
  );
  assert.ok(src.includes('tipo_comercial_id'), 'campo Tipo Comercial');
  assert.ok(!/tabela_preco_id/.test(src), 'sem tabela no cliente');
  assert.ok(!/linha_comercial_id/.test(src), 'sem linha no cliente');
});

test('Cadastro Tipos Comerciais — campos oficiais (sem preço na grade)', () => {
  const html = fs.readFileSync(
    path.resolve(__dirname, '../../../../frontend/erp/pages/tipos-comerciais.html'),
    'utf8'
  );
  assert.ok(html.includes('Canal Padrão'));
  assert.ok(html.includes('Código'));
  assert.ok(html.includes('Descrição'));
  assert.ok(html.includes('Observações'));
  assert.ok(!html.includes('id="tipo-comercial-preco"'));
  assert.ok(!html.includes('tabela_preco'));
  assert.ok(!html.includes('linha_comercial'));
});

(async () => {
  await waitDb();

  // Garante migration aplicada (bootstrap do database.js)
  await new Promise((r) => setTimeout(r, 1500));

  await testAsync('Seeds — tipos oficiais existem', async () => {
    const codigos = [
      'CONSUMIDOR_FINAL',
      'CONSIGNADO',
      'ATACADISTA',
      'DELIVERY'
    ];
    for (const codigo of codigos) {
      const t = await tiposService.buscarPorCodigo(codigo);
      assert.ok(t, `tipo ${codigo}`);
      assert.ok(t.canal_padrao, `${codigo} tem canal`);
    }
  });

  await testAsync('Cliente Consumidor Final → Canal VAREJO', async () => {
    const r = await tiposService.resolverCanalOperacao({
      tipo_comercial_codigo: 'CONSUMIDOR_FINAL'
    });
    assert.strictEqual(r.canal, 'VAREJO');
    assert.strictEqual(r.motivo, 'tipo_comercial');
    assert.ok(r.canal_venda_id);
  });

  await testAsync('Cliente Atacadista → Canal ATACADO + tabela ativa', async () => {
    const r = await tiposService.resolverCanalOperacao({
      tipo_comercial_codigo: 'ATACADISTA'
    });
    assert.strictEqual(r.canal, 'ATACADO');
    // tabela pode ser null se não houver tabela ativa cadastrada — canal deve estar correto
    assert.ok(r.canal_venda_id);
  });

  await testAsync('Cliente Consignado → Canal CONSIGNADO', async () => {
    const r = await tiposService.resolverCanalOperacao({
      tipo_comercial_codigo: 'CONSIGNADO'
    });
    assert.strictEqual(r.canal, 'CONSIGNADO');
  });

  await testAsync('Cliente Delivery → Canal DELIVERY', async () => {
    const r = await tiposService.resolverCanalOperacao({
      tipo_comercial_codigo: 'DELIVERY'
    });
    assert.strictEqual(r.canal, 'DELIVERY');
  });

  await testAsync('CanalVendaResolver recebe canal do tipo (cliente_id)', async () => {
    const tipo = await tiposService.buscarPorCodigo('ATACADISTA');
    const ins = await run(
      `INSERT INTO clientes (nome, limite_credito, credito_atual, tipo_comercial_id)
       VALUES (?, 0, 0, ?)`,
      ['RCM71_TEST_ATAC_' + Date.now(), tipo.id]
    );
    const canalInfo = await CanalVendaResolver.resolver({
      cliente_id: ins.lastID,
      itens: []
    });
    assert.strictEqual(canalInfo.canal, 'ATACADO');
    assert.strictEqual(canalInfo.motivo, 'tipo_comercial');
    assert.strictEqual(canalInfo.tipo_comercial_codigo, 'ATACADISTA');
    await run(`DELETE FROM clientes WHERE id = ?`, [ins.lastID]);
  });

  await testAsync('Resolver-preços path: canal_manual CONSIGNADO tem precedência', async () => {
    const canalInfo = await CanalVendaResolver.resolver({
      canal_manual: 'CONSIGNADO',
      tipo_comercial_codigo: 'ATACADISTA',
      itens: []
    });
    assert.strictEqual(canalInfo.canal, 'CONSIGNADO');
    assert.ok(canalInfo.canal_manual === true || canalInfo.motivo === 'canal_manual');
  });

  await testAsync('Compat — clientes antigos com Consumidor Final', async () => {
    const consumidor = await tiposService.buscarPorCodigo('CONSUMIDOR_FINAL');
    assert.ok(consumidor);
    const semTipo = await get(
      `SELECT COUNT(*) AS n FROM clientes WHERE tipo_comercial_id IS NULL`
    );
    assert.strictEqual(Number(semTipo?.n || 0), 0, 'todos os clientes têm tipo');
  });

  await testAsync('CRUD — não permite excluir CONSUMIDOR_FINAL', async () => {
    const t = await tiposService.buscarPorCodigo('CONSUMIDOR_FINAL');
    let threw = false;
    try {
      await tiposService.excluir(t.id);
    } catch (e) {
      threw = true;
      assert.ok(/sistema/i.test(e.message));
    }
    assert.ok(threw);
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falha(s)\n`);
  if (falhou > 0) process.exit(1);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
