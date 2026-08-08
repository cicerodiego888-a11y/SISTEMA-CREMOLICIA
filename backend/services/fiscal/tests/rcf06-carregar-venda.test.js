/**
 * RCF-06 — Carregamento da venda para emissão fiscal
 * - Zero itens → aborta (nunca reutiliza outra NFC-e)
 * - DANFE só da mesma venda
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../../..');
const emissorPath = path.join(root, 'services/fiscal/emissor.js');
const fiscalRoutes = path.join(root, 'rotas/fiscal.js');
const impressao = path.join(root, '../frontend/shared/js/fiscalImpressao.js');
const vendaPag = path.join(root, 'services/vendas/VendaPagamentoService.js');

function run() {
  const emissor = fs.readFileSync(emissorPath, 'utf8');
  const routes = fs.readFileSync(fiscalRoutes, 'utf8');
  const printJs = fs.readFileSync(impressao, 'utf8');
  const vendaJs = fs.readFileSync(vendaPag, 'utf8');

  assert.ok(emissor.includes('assertVendaComItens'), 'assertVendaComItens exportado/definido');
  assert.ok(emissor.includes('RCF-06'), 'logs RCF-06');
  assert.ok(emissor.includes('LEFT JOIN produtos'), 'LEFT JOIN evita ocultar itens');
  assert.ok(emissor.includes('totalItensPersistidos') || emissor.includes('COUNT(*)'), 'conta itens persistidos');
  assert.ok(/throw new Error\(\s*[`'"]RCF-06: DANFE pertence a outra venda/.test(emissor)
    || emissor.includes('RCF-06: DANFE pertence a outra venda'), 'proteção nota×venda no reuse');

  assert.ok(routes.includes('RCF-06: DANFE pertence a outra venda'), 'rota DANFE bloqueia outra venda');
  assert.ok(routes.includes('venda_sem_itens'), 'status venda_sem_itens');

  // Impressão sempre por /danfe/venda/:id (nunca só notaId sem amarração)
  assert.ok(printJs.includes('danfe/venda/${vendaId}') || printJs.includes('/fiscal/danfe/venda/'), 'DANFE por venda');
  assert.ok(!/danfe\/nota\/\$\{notaId\}/.test(printJs), 'não usa /danfe/nota isolado');
  assert.ok(printJs.includes('DANFE pertence a outra venda'), 'abort impressão divergente');

  // Persistência: não commit de venda vazia
  assert.ok(vendaJs.includes('distribuicaoItens vazio — ROLLBACK')
    || vendaJs.includes('Venda sem itens. Persistência abortada'), 'bloqueia venda sem itens');

  const { assertVendaComItens } = require(emissorPath);

  assert.throws(
    () => assertVendaComItens(34, [], 0),
    /RCF-06/,
    'abort com zero itens'
  );

  assert.doesNotThrow(
    () => assertVendaComItens(34, [{ id: 1 }], 1),
    'aceita com itens'
  );

  console.log('RCF-06 OK — carregamento venda / DANFE amarrados; zero itens aborta');
}

run();
