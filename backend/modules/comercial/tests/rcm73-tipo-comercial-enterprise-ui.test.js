/**
 * RCM-7.3 — Tipo Comercial Enterprise (UI preparada)
 *
 * Executar:
 *   node backend/modules/comercial/tests/rcm73-tipo-comercial-enterprise-ui.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

process.chdir(path.resolve(__dirname, '../../../..'));

const db = require('../../../database');
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

const htmlPath = path.resolve(__dirname, '../../../../frontend/erp/pages/tipos-comerciais.html');
const jsPath = path.resolve(__dirname, '../../../../frontend/erp/js/tipos-comerciais.js');
const clientesPath = path.resolve(__dirname, '../../../../frontend/erp/js/clientes.js');
const resolverPath = path.resolve(__dirname, '../preco/ComercialPrecoResolver.js');

console.log('\nRCM-7.3 — Tipo Comercial Enterprise UI\n');

test('Docs RCM73 existe', () => {
  assert.ok(fs.existsSync(
    path.resolve(__dirname, '../../../../docs/RCM73_TIPO_COMERCIAL_ENTERPRISE.md')
  ));
});

test('Abas oficiais presentes (1–6)', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.ok(html.includes('1 · Geral'));
  assert.ok(html.includes('2 · Canais'));
  assert.ok(html.includes('3 · Crédito'));
  assert.ok(html.includes('4 · Condições'));
  assert.ok(html.includes('5 · Descontos'));
  assert.ok(html.includes('6 · Regras'));
  assert.ok(html.includes('pane-tipo-geral'));
  assert.ok(html.includes('pane-tipo-canais'));
  assert.ok(html.includes('pane-tipo-credito'));
  assert.ok(html.includes('pane-tipo-condicoes'));
  assert.ok(html.includes('pane-tipo-descontos'));
  assert.ok(html.includes('pane-tipo-regras'));
});

test('Geral sem Canal Padrão (Canal na aba Canais)', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const geral = html.split('id="pane-tipo-geral"')[1].split('id="pane-tipo-canais"')[0];
  assert.ok(geral.includes('tipo-comercial-codigo'));
  assert.ok(geral.includes('tipo-comercial-descricao'));
  assert.ok(geral.includes('tipo-comercial-ativo'));
  assert.ok(geral.includes('tipo-comercial-observacoes'));
  assert.ok(!geral.includes('tipo-comercial-canal'));
});

test('Aba Canais com padrão + permitidos', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const canais = html.split('id="pane-tipo-canais"')[1].split('id="pane-tipo-credito"')[0];
  assert.ok(canais.includes('tipo-comercial-canal'));
  assert.ok(canais.includes('tipo-comercial-canais-grid'));
});

test('Abas preparadas desabilitadas (fieldset disabled)', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.ok((html.match(/fieldset disabled/g) || []).length >= 4);
  assert.ok(html.includes('tipo-prep-limite-credito'));
  assert.ok(html.includes('tipo-prep-condicao-pagamento'));
  assert.ok(html.includes('tipo-prep-desconto-maximo'));
  assert.ok(html.includes('tipo-prep-permitir-consignacao'));
});

test('Payload de save só campos RCM-7.2', () => {
  const js = fs.readFileSync(jsPath, 'utf8');
  assert.ok(js.includes('function montarPayloadTipoComercial'));
  const fn = js.split('function montarPayloadTipoComercial')[1].split('function salvarTipoComercial')[0];
  assert.ok(fn.includes('codigo'));
  assert.ok(fn.includes('descricao'));
  assert.ok(fn.includes('canal_padrao'));
  assert.ok(fn.includes('canais_permitidos'));
  assert.ok(fn.includes('observacoes'));
  assert.ok(fn.includes('ativo'));
  assert.ok(!fn.includes('limite'));
  assert.ok(!fn.includes('desconto'));
  assert.ok(!fn.includes('tipo-prep'));
  assert.ok(js.includes('Campos preparados (RCM-7.3) NÃO entram')
    || js.includes('nunca enviados no payload'));
});

test('Cliente permanece só com Tipo Comercial', () => {
  const src = fs.readFileSync(clientesPath, 'utf8');
  assert.ok(src.includes('tipo_comercial_id'));
  assert.ok(!/tabela_preco_id/.test(src));
  assert.ok(!/linha_comercial_id/.test(src));
});

test('Resolver Oficial sem tipo_comercial_canais', () => {
  const src = fs.readFileSync(resolverPath, 'utf8');
  assert.ok(!src.includes('tipo_comercial_canais'));
  assert.ok(!src.includes('tipo-prep'));
});

(async () => {
  await waitDb();
  await new Promise((r) => setTimeout(r, 800));

  await testAsync('Compat RCM-7.2 — CRUD canal padrão / permitidos', async () => {
    const t = await tiposService.buscarPorCodigo('ATACADISTA');
    assert.ok(t);
    assert.strictEqual(t.canal_padrao, 'ATACADO');
    assert.ok(t.canais_permitidos_codigos.includes('ATACADO'));

    const upd = await tiposService.atualizar(t.id, {
      descricao: t.descricao,
      canais_permitidos: t.canais_permitidos_codigos
    });
    assert.ok(upd.canais_permitidos_codigos.includes('ATACADO'));
  });

  await testAsync('Compat — exclusão protegida CONSUMIDOR_FINAL', async () => {
    const t = await tiposService.buscarPorCodigo('CONSUMIDOR_FINAL');
    let threw = false;
    try {
      await tiposService.excluir(t.id);
    } catch (e) {
      threw = true;
    }
    assert.ok(threw);
  });

  await testAsync('Resolver operação inalterado (canal padrão)', async () => {
    const r = await tiposService.resolverCanalOperacao({
      tipo_comercial_codigo: 'CONSUMIDOR_FINAL'
    });
    assert.strictEqual(r.canal, 'VAREJO');
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falha(s)\n`);
  if (falhou > 0) process.exit(1);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
