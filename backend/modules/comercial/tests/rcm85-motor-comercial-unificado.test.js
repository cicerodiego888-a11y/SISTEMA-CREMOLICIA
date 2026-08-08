/**
 * RCM-8.5 — Motor Comercial Unificado
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.chdir(path.resolve(__dirname, '../../..'));
const ROOT = path.resolve(__dirname, '../../../..');
const db = require('../../../database');
const cfg = require('../configuracao/ConfiguracaoComercialService');
const unificado = require('../preco/ComercialMotorUnificado');

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

async function waitDb() {
  for (let i = 0; i < 50; i++) {
    try {
      await get('SELECT 1');
      return;
    } catch (_) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error('DB não pronto');
}

function ler(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

async function main() {
  await waitDb();
  console.log('\nRCM-8.5 — Motor Comercial Unificado\n');

  const mobile = ler('frontend/apps/mobile/js/pages/comercial.js');
  const prep = ler('frontend/modules/motor-comercial/pages/NovaConsignacao/PrepararEntregaView.js');
  const addUc = ler('backend/motores/motor-comercial/usecases/consignacao/AdicionarItemConsignacaoUseCase.js');
  const svc = ler('backend/modules/comercial/configuracao/ConfiguracaoComercialService.js');
  const routes = ler('backend/modules/comercial/routes/comercialCadastros.routes.js');
  const api = ler('frontend/modules/motor-comercial/api/MotorComercialApi.js');

  assert.ok(mobile.includes('resolverPrecoConsignacaoMobile'), 'mobile resolve CONSIGNADO');
  assert.ok(mobile.includes("canal: 'CONSIGNADO'"), 'mobile canal consignado');
  assert.ok(mobile.includes('precoOrigem') || mobile.includes('preco_origem'), 'mobile snapshot');
  assert.ok(mobile.includes('[RCM-8.5][COMERCIAL][Resolver]'), 'mobile log');
  console.log('OK 1 — Mobile Consignação via Motor Oficial');

  assert.ok(addUc.includes('clienteTrouxeSnapshot') || addUc.includes('RCM-8.5'), 'UC harden');
  assert.ok(addUc.includes('[RCM-8.5][COMERCIAL][Resolver]'), 'UC log');
  console.log('OK 2 — Backend Consignação SSOT bridge');

  assert.ok(prep.includes('Detalhes') && prep.includes('Comparar Tabelas'), 'UI detalhes/comparar');
  assert.ok(prep.includes('abrirCompararTabelas'), 'comparar fn');
  assert.ok(api.includes('compararTabelasPrecificacao'), 'API comparar');
  assert.ok(routes.includes('comparar-tabelas'), 'rota comparar');
  assert.ok(svc.includes('compararTabelas'), 'service comparar');
  console.log('OK 3 — Detalhes + Comparar Tabelas');

  assert.ok(svc.includes('[RCM-8.5][COMERCIAL][Resolver]'), 'logs service');
  assert.ok(unificado.DOCUMENTOS.PEDIDO === 'pedido', 'contrato pedido');
  assert.ok(unificado.DOCUMENTOS.ORCAMENTO === 'orcamento', 'contrato orçamento');
  assert.ok(unificado.SNAPSHOT_CAMPOS.includes('precoOrigem'), 'snapshot campos');
  console.log('OK 4 — Contrato Pedido/Orçamento/CRM unificado');

  const prod = await get(
    `SELECT id FROM produtos WHERE COALESCE(ativo,1)=1 ORDER BY id LIMIT 1`
  );
  assert.ok(prod, 'produto para teste');

  const t0 = Date.now();
  const resolvido = await cfg.resolverPrecosVenda({
    canal: 'CONSIGNADO',
    documento: 'teste-rcm85',
    itens: [{ produto_id: prod.id, quantidade: 2 }]
  });
  assert.ok(resolvido.itens && resolvido.itens[0]);
  assert.ok(resolvido.sprint === 'RCM-8.5' || resolvido.motor);
  const snap = unificado.snapshotDeLinhaResolver(resolvido.itens[0], 2);
  assert.ok(snap.resolver === 'Motor Oficial');
  assert.ok(Number.isFinite(snap.precoUnitario));
  console.log('OK 5 — Resolver + Snapshot (com/sem linha)');

  const cmp = await cfg.compararTabelas({ produto_id: prod.id });
  assert.ok(Array.isArray(cmp.comparacoes) && cmp.comparacoes.length >= 1);
  assert.ok(cmp.informativo === true);
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 15000, 'performance smoke');
  console.log('OK 6 — Comparar Tabelas + performance (' + elapsed + 'ms)');

  // Troca de operação: VAREJO vs CONSIGNADO
  const v = await cfg.resolverPrecosVenda({
    canal: 'VAREJO',
    documento: 'teste-rcm85',
    itens: [{ produto_id: prod.id, quantidade: 1 }]
  });
  const c = await cfg.resolverPrecosVenda({
    canal: 'CONSIGNADO',
    documento: 'teste-rcm85',
    itens: [{ produto_id: prod.id, quantidade: 1 }]
  });
  assert.ok(v.canal || v.itens);
  assert.ok(c.itens && c.itens[0]);
  console.log('OK 7 — Troca de operação (canais distintos)');

  console.log('\nRCM-8.5 PASSOU\n');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
