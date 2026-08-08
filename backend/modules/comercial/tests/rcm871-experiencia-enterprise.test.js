/**
 * RCM-8.7.1 — Experiência Enterprise do Domínio Comercial
 * node backend/modules/comercial/tests/rcm871-experiencia-enterprise.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

function read(rel) {
  return fs.readFileSync(path.resolve(__dirname, rel), 'utf8');
}

function test(nome, fn) {
  try {
    fn();
    console.log('OK ', nome);
  } catch (err) {
    console.error('FAIL', nome, err.message);
    process.exitCode = 1;
  }
}

const produtos = read('../../../../frontend/erp/js/produtos.js');
const linhas = read('../../../../frontend/erp/js/linhas-comerciais.js');
const tabelas = read('../../../../frontend/erp/js/tabelas-preco.js');
const central = read('../tabelas-preco/CentralPrecificacaoService.js');

test('Produto — painéis e botões 8.7.1', () => {
  assert.ok(produtos.includes('painelOndeVendidoRcm871'));
  assert.ok(produtos.includes('painelResumoComercialRcm871'));
  assert.ok(produtos.includes('btnVerificarCoberturaRcm871'));
  assert.ok(produtos.includes('btnSimularPrecoRcm871'));
  assert.ok(produtos.includes('btnCopiarConfigComercialRcm871'));
  assert.ok(produtos.includes('btnSugerirLinhaRcm871'));
  assert.ok(produtos.includes('indicadorComercialRcm871'));
  assert.ok(produtos.includes('Abrir Central de Precificação'));
  assert.ok(produtos.includes('Esta Linha influencia'));
});

test('API — painel produto com operações + simular cliente', () => {
  assert.ok(central.includes('usando_fallback'));
  assert.ok(central.includes('dependencias'));
  assert.ok(central.includes('cliente_id'));
  assert.ok(central.includes('status_visual'));
});

test('Linhas — dashboard rico', () => {
  assert.ok(linhas.includes('Dashboard'));
  assert.ok(linhas.includes('btnDashAbrirCentral'));
  assert.ok(linhas.includes('cds_abrir_linha_id'));
});

test('Central — filtro por Linha/Operação', () => {
  assert.ok(tabelas.includes('cds_central_filtro_linha_id'));
  assert.ok(tabelas.includes('btn-limpar-filtro-central'));
});

console.log('\nRCM-8.7.1 smoke finalizado.');
