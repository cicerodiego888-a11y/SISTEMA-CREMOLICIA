/**
 * RCM-7.2.1 — Canal da Operação na Nova Consignação
 *
 * Executar:
 *   node backend/modules/comercial/tests/rcm721-canal-operacao-consignacao.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

process.chdir(path.resolve(__dirname, '../../../..'));

const db = require('../../../database');
const CanalVendaResolver = require('../preco/CanalVendaResolver');
const configuracaoService = require('../configuracao/ConfiguracaoComercialService');
const tiposService = require('../tipos-comerciais/TiposComerciaisService');

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

const NOVA_SRC = path.resolve(
  __dirname,
  '../../../../frontend/modules/motor-comercial/pages/NovaConsignacao/index.js'
);

console.log('\nRCM-7.2.1 — Canal da Operação (Consignação)\n');

test('Docs RCM721 existe', () => {
  assert.ok(fs.existsSync(
    path.resolve(__dirname, '../../../../docs/RCM721_CANAL_OPERACAO_CONSIGNACAO.md')
  ));
});

test('Nova Consignação — canal_manual CONSIGNADO (sem card PDV)', () => {
  const src = fs.readFileSync(NOVA_SRC, 'utf8');
  assert.ok(src.includes("CANAL_OPERACAO_CONSIGNACAO = 'CONSIGNADO'"));
  assert.ok(src.includes('canalVenda: CANAL_OPERACAO_CONSIGNACAO'));
  assert.ok(src.includes('_renderOperacaoResumo'));
  assert.ok(!src.includes("require('../../../../shared/js/ComercialStatusCard')"));
  // Não pode fallbackar o card para VAREJO
  assert.ok(!src.includes("res.canal || this.data.canalVenda || 'VAREJO'"));
  assert.ok(!src.includes("canal: this.data.canalVenda || 'VAREJO'"));
  // Resolver da consignação não envia cliente_id (evita Tipo Comercial)
  const callMatch = src.match(
    /resolverPrecosVenda\(this\.data\.itens,\s*\{([^}]*)\}\)/
  );
  assert.ok(callMatch, 'chama resolverPrecosVenda com opts');
  assert.ok(/canal:\s*CANAL_OPERACAO_CONSIGNACAO/.test(callMatch[1]));
  assert.ok(!/cliente_id/.test(callMatch[1]), 'não envia cliente_id no resolve de consignação');
});

test('CanalVendaResolver documenta ordem 1/2/3', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../preco/CanalVendaResolver.js'),
    'utf8'
  );
  assert.ok(src.includes('1) canal_manual'));
  assert.ok(src.includes('2) Tipo Comercial'));
  assert.ok(src.includes('3) Fallback'));
});

(async () => {
  await waitDb();
  await new Promise((r) => setTimeout(r, 800));

  const tipos = [
    'CONSUMIDOR_FINAL',
    'ATACADISTA',
    'DELIVERY',
    'REVENDEDOR'
  ];

  for (const codigo of tipos) {
    await testAsync(`canal_manual CONSIGNADO vence Tipo ${codigo}`, async () => {
      const tipo = await tiposService.buscarPorCodigo(codigo);
      if (!tipo) {
        // DELIVERY pode ser canal, não tipo — tenta CLIENTE_ESPECIAL / skip soft
        if (codigo === 'DELIVERY') {
          const especial = await tiposService.buscarPorCodigo('CLIENTE_ESPECIAL');
          assert.ok(especial, 'CLIENTE_ESPECIAL (proxy Delivery) existe');
          const canalInfo = await CanalVendaResolver.resolver({
            canal_manual: 'CONSIGNADO',
            tipo_comercial_codigo: 'CLIENTE_ESPECIAL',
            itens: []
          });
          assert.strictEqual(canalInfo.canal, 'CONSIGNADO');
          assert.ok(canalInfo.canal_manual === true || canalInfo.motivo === 'canal_manual');
          return;
        }
        throw new Error(`Tipo ${codigo} não encontrado`);
      }
      const canalInfo = await CanalVendaResolver.resolver({
        canal_manual: 'CONSIGNADO',
        tipo_comercial_codigo: codigo,
        itens: []
      });
      assert.strictEqual(canalInfo.canal, 'CONSIGNADO');
      assert.ok(canalInfo.canal_manual === true || canalInfo.motivo === 'canal_manual');
    });
  }

  await testAsync('resolver-precos com canal CONSIGNADO (sem cliente_id)', async () => {
    const produto = await get(
      `SELECT id FROM produtos WHERE ativo = 1 OR ativo IS NULL ORDER BY id LIMIT 1`
    );
    if (!produto) {
      console.log('  SKIP  sem produto para resolver preços');
      return;
    }
    const lote = await configuracaoService.resolverPrecosVenda({
      canal: 'CONSIGNADO',
      itens: [{ produto_id: produto.id, quantidade: 1 }]
    });
    assert.strictEqual(String(lote.canal).toUpperCase(), 'CONSIGNADO');
    assert.ok(lote.canal_manual === true || lote.motivo === 'canal_manual');
    const item = (lote.itens || [])[0];
    assert.ok(item);
    assert.strictEqual(String(item.canal || lote.canal).toUpperCase(), 'CONSIGNADO');
  });

  await testAsync('canal_manual vence cliente_id do Tipo', async () => {
    const atacadista = await tiposService.buscarPorCodigo('ATACADISTA');
    assert.ok(atacadista);
    const cliente = await get(
      `SELECT id FROM clientes WHERE tipo_comercial_id = ? LIMIT 1`,
      [atacadista.id]
    );
    const opts = {
      canal_manual: 'CONSIGNADO',
      itens: []
    };
    if (cliente) opts.cliente_id = cliente.id;
    else opts.tipo_comercial_codigo = 'ATACADISTA';

    const canalInfo = await CanalVendaResolver.resolver(opts);
    assert.strictEqual(canalInfo.canal, 'CONSIGNADO');
    assert.notStrictEqual(canalInfo.canal, 'ATACADO');
    assert.notStrictEqual(canalInfo.canal, 'VAREJO');
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falha(s)\n`);
  process.exit(falhou > 0 ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
