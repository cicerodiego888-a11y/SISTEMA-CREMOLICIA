/**
 * RCM-7.2 — Tipos Comerciais Enterprise (Canais Permitidos)
 *
 * Executar:
 *   node backend/modules/comercial/tests/rcm72-tipos-comerciais-enterprise.test.js
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

console.log('\nRCM-7.2 — Tipos Comerciais Enterprise\n');

test('Docs RCM72 existe', () => {
  assert.ok(fs.existsSync(
    path.resolve(__dirname, '../../../../docs/RCM72_TIPOS_COMERCIAIS_ENTERPRISE.md')
  ));
});

test('UI possui aba Canais Permitidos', () => {
  const html = fs.readFileSync(
    path.resolve(__dirname, '../../../../frontend/erp/pages/tipos-comerciais.html'),
    'utf8'
  );
  assert.ok(html.includes('Canais Permitidos'));
  assert.ok(html.includes('tipo-comercial-canais-grid'));
});

test('Cliente permanece sem tabela/linha', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../../../frontend/erp/js/clientes.js'),
    'utf8'
  );
  assert.ok(src.includes('tipo_comercial_id'));
  assert.ok(!/tabela_preco_id/.test(src));
  assert.ok(!/linha_comercial_id/.test(src));
});

test('PDV bloqueia canal não autorizado', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../../../frontend/pdv/js/pdv.js'),
    'utf8'
  );
  assert.ok(src.includes('canalAutorizadoPeloTipoPdv'));
  assert.ok(src.includes('canaisPermitidosClientePdv'));
});

test('Consignação — aviso de canal Tipo é opt-in (não bloqueia seleção)', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../../../frontend/modules/motor-comercial/pages/NovaConsignacao/index.js'),
    'utf8'
  );
  assert.ok(src.includes('_validarCanalConsignadoTipoComercial'));
  assert.ok(src.includes('CDS_AVISO_CONSIGNACAO_CANAL'));
  // Default: aviso desligado (só liga com '1') — canal_manual vence
  assert.ok(src.includes("=== '1'"));
  assert.ok(!src.includes("!== '0'"));
});

(async () => {
  await waitDb();
  await new Promise((r) => setTimeout(r, 1500));

  await testAsync('Tabela N:N existe', async () => {
    const row = await get(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='tipo_comercial_canais'`
    );
    assert.ok(row);
  });

  await testAsync('Consumidor Final — só VAREJO', async () => {
    const t = await tiposService.buscarPorCodigo('CONSUMIDOR_FINAL');
    assert.strictEqual(t.canal_padrao, 'VAREJO');
    assert.ok(t.canais_permitidos_codigos.includes('VAREJO'));
    assert.strictEqual(t.canais_permitidos_codigos.length, 1);
  });

  await testAsync('Atacadista — ATACADO + EVENTO', async () => {
    const t = await tiposService.buscarPorCodigo('ATACADISTA');
    assert.strictEqual(t.canal_padrao, 'ATACADO');
    assert.ok(t.canais_permitidos_codigos.includes('ATACADO'));
    assert.ok(t.canais_permitidos_codigos.includes('EVENTO'));
  });

  await testAsync('Revendedor — ATACADO + CONSIGNADO + EVENTO', async () => {
    const t = await tiposService.buscarPorCodigo('REVENDEDOR');
    assert.ok(t.canais_permitidos_codigos.includes('ATACADO'));
    assert.ok(t.canais_permitidos_codigos.includes('CONSIGNADO'));
    assert.ok(t.canais_permitidos_codigos.includes('EVENTO'));
  });

  await testAsync('Distribuidor — ATACADO + CONSIGNADO + DELIVERY', async () => {
    const t = await tiposService.buscarPorCodigo('DISTRIBUIDOR');
    assert.ok(t.canais_permitidos_codigos.includes('DELIVERY'));
    assert.ok(t.canais_permitidos_codigos.includes('CONSIGNADO'));
  });

  await testAsync('Cliente Especial — VAREJO + DELIVERY + EVENTO', async () => {
    const t = await tiposService.buscarPorCodigo('CLIENTE_ESPECIAL');
    assert.strictEqual(t.canal_padrao, 'VAREJO');
    assert.ok(t.canais_permitidos_codigos.includes('DELIVERY'));
    assert.ok(t.canais_permitidos_codigos.includes('EVENTO'));
  });

  await testAsync('Consignado — canal padrão CONSIGNADO permitido', async () => {
    const t = await tiposService.buscarPorCodigo('CONSIGNADO');
    assert.strictEqual(t.canal_padrao, 'CONSIGNADO');
    assert.ok(await tiposService.canalPermitido(t.id, 'CONSIGNADO'));
  });

  await testAsync('Resolver operação usa canal padrão', async () => {
    const r = await tiposService.resolverCanalOperacao({
      tipo_comercial_codigo: 'REVENDEDOR'
    });
    assert.strictEqual(r.canal, 'ATACADO');
    assert.ok(r.canais_permitidos_codigos.includes('EVENTO'));
  });

  await testAsync('Resolver operação aceita canal permitido (EVENTO)', async () => {
    const r = await tiposService.resolverCanalOperacao({
      tipo_comercial_codigo: 'ATACADISTA',
      canal: 'EVENTO'
    });
    assert.strictEqual(r.canal, 'EVENTO');
  });

  await testAsync('Resolver rejeita canal não autorizado', async () => {
    let threw = false;
    try {
      await tiposService.resolverCanalOperacao({
        tipo_comercial_codigo: 'CONSUMIDOR_FINAL',
        canal: 'ATACADO'
      });
    } catch (e) {
      threw = true;
      assert.ok(/não permitido/i.test(e.message));
    }
    assert.ok(threw);
  });

  await testAsync('CanalVendaResolver propaga canais_permitidos', async () => {
    const info = await CanalVendaResolver.resolver({
      tipo_comercial_codigo: 'REVENDEDOR',
      itens: []
    });
    assert.strictEqual(info.canal, 'ATACADO');
    assert.ok(Array.isArray(info.canais_permitidos_codigos));
    assert.ok(info.canais_permitidos_codigos.includes('CONSIGNADO'));
  });

  await testAsync('Compat — canal padrão sempre incluso ao atualizar', async () => {
    const t = await tiposService.buscarPorCodigo('ATACADISTA');
    const upd = await tiposService.atualizar(t.id, {
      canais_permitidos: ['EVENTO']
    });
    assert.ok(upd.canais_permitidos_codigos.includes('ATACADO'), 'padrão incluso');
    assert.ok(upd.canais_permitidos_codigos.includes('EVENTO'));
  });

  await testAsync('Resolver Oficial não foi alterado (assinatura)', async () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../preco/ComercialPrecoResolver.js'),
      'utf8'
    );
    assert.ok(src.includes('async function resolver') || src.includes('resolver('));
    assert.ok(!src.includes('tipo_comercial_canais'), 'Resolver não consulta N:N');
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falha(s)\n`);
  if (falhou > 0) process.exit(1);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
