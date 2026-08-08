/**
 * RCM-04.B — Testes de paridade Desktop × Mobile / diagnóstico / DTO / badges.
 */

const assert = require('assert');
const path = require('path');

function ok(cond, msg) {
  assert.ok(cond, msg);
  console.log('  OK', msg);
}

async function testDiagnosticoService() {
  console.log('\n[1] SistemaDiagnostico');
  const svc = require('../../../services/sistemaDiagnostico');
  const d = await svc.montarDiagnostico({
    headers: { host: '127.0.0.1:3002' },
    secure: false
  });
  ok(!!d.instanceId, 'instanceId presente');
  ok(!!d.dbPath, 'dbPath presente');
  ok(!!d.databaseHash, 'databaseHash presente');
  ok(String(d.databaseHash).length >= 32, 'databaseHash parece SHA-256');
  ok(String(d.apiUrl).includes('/api'), 'apiUrl contém /api');
  ok(!!d.ambiente, 'ambiente presente');
  ok(!!d.versaoSistema, 'versaoSistema presente');
  ok(d.versaoBanco != null, 'versaoBanco presente');
  ok(!!d.hostname, 'hostname presente');
  ok(typeof d.uptime === 'number', 'uptime numérico');
  ok(!!d.startedAt, 'startedAt presente');
  ok(!!d.processId, 'processId presente');
  ok(!!d.timestampServidor, 'timestampServidor presente');

  const d2 = await svc.montarDiagnostico({ headers: { host: '127.0.0.1:3002' } });
  ok(d.instanceId === d2.instanceId, 'instanceId estável entre chamadas');
  ok(d.databaseHash === d2.databaseHash, 'databaseHash estável entre chamadas');
}

function testOrigemLog() {
  console.log('\n[2] Origem Desktop/Mobile');
  const { detectarOrigemCliente, extrairConsignacaoId } = require('../../../services/comercialOperacaoLog');
  ok(detectarOrigemCliente({ headers: { 'x-cds-client': 'mobile' } }) === 'Mobile', 'header mobile');
  ok(detectarOrigemCliente({ headers: { 'x-cds-client': 'desktop' } }) === 'Desktop', 'header desktop');
  ok(detectarOrigemCliente({ headers: {} }) === 'Desktop', 'default Desktop');
  ok(extrairConsignacaoId({ consignacao: { id: 42 } }) === 42, 'extrai id de consignacao');
  ok(extrairConsignacaoId({ id: 7 }, null) === 7, 'extrai id raiz');
}

function testDtoCampos() {
  console.log('\n[3] DTO ConsignacaoResponse');
  const { ConsignacaoResponse } = require('../http/dto');
  const json = ConsignacaoResponse.toJSON({
    id: 10,
    clienteId: 5,
    clienteNome: 'João Silva',
    clienteDocumento: '12345678901',
    clienteFantasia: 'Mercado JS',
    clienteTelefone: '85999990000',
    status: 'RASCUNHO',
    valorTotalEntregue: 0,
    saldoAberto: 0
  });
  ok(json.clienteId === 5, 'clienteId no DTO');
  ok(json.clienteNome === 'João Silva', 'clienteNome no DTO');
  ok(json.clienteDocumento === '12345678901', 'clienteDocumento no DTO');
  ok(json.clienteFantasia === 'Mercado JS', 'clienteFantasia no DTO');
  ok(json.clienteTelefone === '85999990000', 'clienteTelefone no DTO');
}

function testMapperRow() {
  console.log('\n[4] Mapper JOIN clientes');
  const { mapConsignacaoFromRow } = require('../utils/comercialMapper');
  const mapped = mapConsignacaoFromRow({
    id: 1,
    cliente_id: 9,
    status: 'RASCUNHO',
    cliente_nome: 'Mercado Central',
    cliente_documento: '11222333000181',
    cliente_telefone: '8533334444',
    cliente_fantasia: null,
    observacao: 'Entrega manhã',
    valor_total_entregue: 0,
    saldo_aberto: 0
  });
  ok(mapped.clienteNome === 'Mercado Central', 'map clienteNome');
  ok(mapped.clienteDocumento === '11222333000181', 'map clienteDocumento');
  ok(mapped.clienteTelefone === '8533334444', 'map clienteTelefone');
  ok(mapped.clienteId === 9, 'map clienteId');
  ok(mapped.observacao === 'Entrega manhã', 'map observacao');
}

function testBadgesRascunho() {
  console.log('\n[5] RASCUNHO sem R$ 0,00 + badges');
  const badgesPath = path.resolve(
    __dirname,
    '../../../../frontend/modules/motor-comercial/pages/Consignacoes/badges.js'
  );
  const {
    enrichConsignacaoOperationalFlags,
    resolveOperationalStatus,
    STATUS_BADGES
  } = require(badgesPath);

  const item = enrichConsignacaoOperationalFlags({
    id: 1,
    status: 'RASCUNHO',
    clienteId: 1
  }, {});
  ok(item.valor === null, 'valor null em RASCUNHO');
  ok(item.saldo === null, 'saldo null em RASCUNHO');
  ok(item.aguardandoEntrega === true, 'aguardandoEntrega');
  ok(item.valorLabel === 'Aguardando Entrega', 'valorLabel Aguardando Entrega');
  ok(resolveOperationalStatus(item) === 'RASCUNHO', 'badge RASCUNHO');

  const prep = enrichConsignacaoOperationalFlags({
    id: 2,
    status: 'RASCUNHO',
    quantidadeItens: 3
  }, {});
  ok(resolveOperationalStatus(prep) === 'PREPARACAO', 'badge PREPARAÇÃO com itens');

  const pend = enrichConsignacaoOperationalFlags({
    id: 3,
    status: 'ENTREGUE'
  }, { 3: { saldoAtual: 50, valorConsignado: 100 } });
  ok(resolveOperationalStatus(pend) === 'PRESTACAO_PENDENTE', 'badge PRESTAÇÃO PENDENTE');

  const fin = resolveOperationalStatus({ status: 'ACERTADA' });
  ok(fin === 'FINALIZADA', 'ACERTADA → FINALIZADA');
  ok(STATUS_BADGES.CANCELADA.text === 'CANCELADA', 'badge CANCELADA');
  ok(STATUS_BADGES.ENTREGUE.text === 'ENTREGUE', 'badge ENTREGUE');
}

function testMapViewRascunho() {
  console.log('\n[6] mapConsignacaoView RASCUNHO');
  const helpersPath = path.resolve(
    __dirname,
    '../../../../frontend/modules/motor-comercial/api/helpers.js'
  );
  const { mapConsignacaoView } = require(helpersPath);
  const view = mapConsignacaoView({
    id: 3,
    status: 'RASCUNHO',
    clienteId: 2,
    clienteNome: 'Ana',
    clienteDocumento: '999',
    clienteTelefone: '8599999',
    observacao: 'teste'
  });
  ok(view.clienteNome === 'Ana', 'view clienteNome');
  ok(view.clienteDocumento === '999', 'view clienteDocumento');
  ok(view.clienteTelefone === '8599999', 'view clienteTelefone');
  ok(view.valor === null, 'view valor null');
  ok(view.aguardandoEntrega === true, 'view aguardandoEntrega');
}

async function main() {
  console.log('=== RCM-04.B Tests ===');
  await testDiagnosticoService();
  testOrigemLog();
  testDtoCampos();
  testMapperRow();
  testBadgesRascunho();
  testMapViewRascunho();
  console.log('\nTodos os testes RCM-04.B passaram.\n');
}

main().catch((err) => {
  console.error('\nFALHA:', err);
  process.exit(1);
});
