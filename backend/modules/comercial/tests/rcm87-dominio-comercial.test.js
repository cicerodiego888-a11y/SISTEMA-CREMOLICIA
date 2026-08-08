/**
 * RCM-8.7 — Consolidação do Domínio Comercial (smoke estrutural)
 * node backend/modules/comercial/tests/rcm87-dominio-comercial.test.js
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
const linhasJs = read('../../../../frontend/erp/js/linhas-comerciais.js');
const linhasHtml = read('../../../../frontend/erp/pages/linhas-comerciais.html');
const indexHtml = read('../../../../frontend/erp/index.html');
const ra6 = read('../../../../frontend/erp/js/tabelas-preco-ra6.js');
const diag = read('../../../../frontend/erp/js/diagnostico-comercial.js');
const central = read('../tabelas-preco/CentralPrecificacaoService.js');
const repoLinhas = read('../linhas-comerciais/LinhasComerciaisRepository.js');

test('Cadastro — Card Comercial com termos oficiais', () => {
  assert.ok(produtos.includes('Linha de Precificação'));
  assert.ok(produtos.includes('Preço de Segurança (Fallback)'));
  assert.ok(produtos.includes('Produto com Precificação Própria'));
  assert.ok(produtos.includes('Participa do Atacado'));
  assert.ok(produtos.includes('Grupo Comercial'));
  assert.ok(produtos.includes('btnAnalisarProdutoRcm87'));
  assert.ok(produtos.includes('function inicializarLinhaComercialProduto'));
  assert.ok(produtos.includes('painelLinhaInteligenteRcm87'));
  assert.ok(!produtos.includes('Margem e Atacado (legado)'));
  assert.ok(!produtos.includes('Lucro Estimado'));
});

test('Linhas — tela rica RCM-8.7', () => {
  assert.ok(linhasHtml.includes('Produtos vinculados'));
  assert.ok(linhasHtml.includes('Tabelas com preço'));
  assert.ok(linhasHtml.includes('Última alteração'));
  assert.ok(linhasJs.includes('detalharLinhaComercial'));
  assert.ok(linhasJs.includes('produtos_vinculados'));
  assert.ok(repoLinhas.includes('produtos_vinculados'));
});

test('Central — pesquisa mostra Linha do produto', () => {
  assert.ok(ra6.includes('Este Produto pertence à Linha') || ra6.includes('Produto com Precificação Própria'));
});

test('Diagnóstico — consistência geral + Analisar', () => {
  assert.ok(diag.includes('loadCoberturaGeralDominio'));
  assert.ok(diag.includes('abrirAnaliseProdutoRcm87'));
  assert.ok(central.includes('produtos_usando_preco_seguranca'));
  assert.ok(central.includes('operacoes_sem_tabela'));
  assert.ok(central.includes('origem_label'));
});

test('Sidebar — Central de Precificação', () => {
  assert.ok(indexHtml.includes('Central de Precificação'));
  assert.ok(!indexHtml.includes('>Tabelas de Preços</span>'));
});

console.log('\nRCM-8.7 smoke finalizado.');
