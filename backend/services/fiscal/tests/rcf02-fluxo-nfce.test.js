/**
 * RCF-02 — Auditoria fluxo NFC-e (venda_id / notaId)
 * Garante que emissão e DANFE não usam "última NFC-e" global.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../../..');
const emissorPath = path.join(root, 'services/fiscal/emissor.js');
const fiscalRoutes = path.join(root, 'rotas/fiscal.js');
const impressao = path.join(root, '../frontend/shared/js/fiscalImpressao.js');
const pdv = path.join(root, '../frontend/pdv/js/pdv.js');
const configSvc = path.join(root, 'services/fiscal/configService.js');

function run() {
  const emissor = fs.readFileSync(emissorPath, 'utf8');
  const routes = fs.readFileSync(fiscalRoutes, 'utf8');
  const printJs = fs.readFileSync(impressao, 'utf8');
  const pdvJs = fs.readFileSync(pdv, 'utf8');
  const cfg = fs.readFileSync(configSvc, 'utf8');

  // salvarNota não casa só por chave global no UPDATE
  assert.ok(emissor.includes('RCF-02'), 'logs RCF-02');
  assert.ok(emissor.includes('chave_acesso já vinculada a outra venda') || emissor.includes('já pertence à venda'), 'bloqueia chave de outra venda');
  assert.ok(emissor.includes('WHERE id = ?') && emissor.includes('AND venda_id = ?'), 'UPDATE amarra venda_id');
  assert.ok(emissor.includes('validarConsistenciaVendaXml'), 'validação venda×xml');

  // DANFE por venda autorizada + notaId
  assert.ok(routes.includes("status = 'autorizada'"), 'DANFE só autorizada');
  assert.ok(routes.includes('/danfe/nota/:notaId'), 'rota por notaId');
  assert.ok(routes.includes('X-CDS-Venda-Id'), 'header venda');

  // PDV passa notaId
  assert.ok(pdvJs.includes('notaId: response?.notaId') || pdvJs.includes('notaId:'), 'PDV passa notaId');
  assert.ok(printJs.includes('danfe/venda/') || printJs.includes('notaId'), 'impressão usa venda (+notaId)');
  assert.ok(printJs.includes('Abortando impressão') || printJs.includes('outra venda') || printJs.includes('não corresponde'), 'abort se diverge');

  // Numeração com lock
  assert.ok(cfg.includes('BEGIN IMMEDIATE'), 'lock numeração');

  // Sem busca global de última NFC-e no GET danfe (só filtrado por venda + autorizada)
  const danfeBlock = routes.slice(routes.indexOf("router.get('/danfe/venda"));
  assert.ok(danfeBlock.includes('venda_id'), 'filtra venda_id');
  assert.ok(!/WHERE\s+1=1[\s\S]*ORDER BY n\.id DESC/.test(danfeBlock.slice(0, 800)), 'sem última global');

  // Funções exportadas para teste
  const { validarConsistenciaVendaXml } = require(emissorPath);
  const ok = validarConsistenciaVendaXml(
    { total: 13.49, valor_fiscal: 13.49 },
    '<infNFe><total><ICMSTot><vNF>13.49</vNF></ICMSTot></total><det nItem="1"></det></infNFe>'
  );
  assert.strictEqual(ok.ok, true, 'totais iguais');

  const bad = validarConsistenciaVendaXml(
    { total: 13.49, valor_fiscal: 13.49 },
    '<infNFe><total><ICMSTot><vNF>99.00</vNF></ICMSTot></total><det nItem="1"></det></infNFe>'
  );
  assert.strictEqual(bad.ok, false, 'detecta divergência de total');

  console.log('RCF-02 OK — fluxo NFC-e amarrado a venda_id/notaId');
}

run();
