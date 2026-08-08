/**
 * RCM-7.5 — Consolidação da UX da Consignação
 *
 * Executar:
 *   node backend/modules/comercial/tests/rcm75-ux-consignacao.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

process.chdir(path.resolve(__dirname, '../../../..'));

const mappers = require('../../../../frontend/modules/motor-comercial/pages/NovaConsignacao/prepararEntregaMappers');

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

const NOVA = path.resolve(
  __dirname,
  '../../../../frontend/modules/motor-comercial/pages/NovaConsignacao/index.js'
);
const VIEW = path.resolve(
  __dirname,
  '../../../../frontend/modules/motor-comercial/pages/NovaConsignacao/PrepararEntregaView.js'
);
const STYLES = path.resolve(
  __dirname,
  '../../../../frontend/modules/motor-comercial/pages/NovaConsignacao/styles.css'
);
const MAPPERS = path.resolve(
  __dirname,
  '../../../../frontend/modules/motor-comercial/pages/NovaConsignacao/prepararEntregaMappers.js'
);

console.log('\nRCM-7.5 — Consolidação UX Consignação\n');

test('Docs RCM75 existe', () => {
  assert.ok(fs.existsSync(
    path.resolve(__dirname, '../../../../docs/RCM75_CONSOLIDACAO_UX_CONSIGNACAO.md')
  ));
});

test('Resumo Financeiro único (sem credit-strip)', () => {
  const src = fs.readFileSync(NOVA, 'utf8');
  assert.ok(src.includes('preparar-entrega-resumo-financeiro'));
  assert.ok(src.includes('_refreshResumoFinanceiroUnico'));
  assert.ok(src.includes('renderResumoFinanceiro'));
  assert.ok(!src.includes('preparar-entrega-credit-strip'));
  assert.ok(!src.includes('Crédito disponível:'));
});

test('Card Operação com Status Precificação Congelada', () => {
  const src = fs.readFileSync(NOVA, 'utf8');
  assert.ok(src.includes('Operação'));
  assert.ok(src.includes('Consignação'));
  assert.ok(src.includes('Tipo Comercial'));
  assert.ok(src.includes('Tabela de Preços'));
  assert.ok(src.includes('Precificação Congelada'));
  assert.ok(!src.includes('Canal da Venda'));
});

test('Grade e Conferência com snapshot', () => {
  const view = fs.readFileSync(VIEW, 'utf8');
  assert.ok(view.includes('_htmlSnapshotItem'));
  assert.ok(view.includes('Linha de Precificação'));
  assert.ok(view.includes('Tabela de Preços'));
  assert.ok(view.includes('Utilizando Preço de Segurança'));
  assert.ok(view.includes('conferencia-itens--snapshot'));
  assert.ok(view.includes('renderResumoFinanceiro'));
  assert.ok(!view.includes('renderPainelLateral'));
  assert.ok(!view.includes('_renderResumoCompactoGrade'));
});

test('Sem nomenclatura proibida', () => {
  const nova = fs.readFileSync(NOVA, 'utf8');
  const view = fs.readFileSync(VIEW, 'utf8');
  const map = fs.readFileSync(MAPPERS, 'utf8');
  const joined = `${nova}\n${view}\n${map}`;
  assert.ok(!joined.includes('Lista de Preços'));
  assert.ok(!joined.includes('Política Comercial'));
  assert.ok(!joined.includes('Canal da Venda'));
});

test('Cliente / Conferência sem Limite e Saldo duplicados', () => {
  const map = fs.readFileSync(MAPPERS, 'utf8');
  assert.ok(!/label:\s*'Saldo Atual'/.test(map));
  assert.ok(!/label:\s*'Limite'/.test(map));
  assert.ok(!/label:\s*'Limite Disponível'/.test(map));
  assert.ok(!/label:\s*'Saldo após a Entrega'/.test(map));
  assert.ok(map.includes("label: 'Valor desta Entrega'"));
});

test('Barra do cliente sem Limite/Saldo', () => {
  const view = fs.readFileSync(VIEW, 'utf8');
  assert.ok(!view.includes('Limite: ${formatCurrency'));
  assert.ok(!view.includes('Saldo: ${formatCurrency'));
});

test('formatOrigemPreco — Tabela / Preço de Segurança', () => {
  assert.strictEqual(mappers.formatOrigemPreco('tabela_preco', false), 'Tabela');
  assert.strictEqual(mappers.formatOrigemPreco('tabela_preco_linha', false), 'Tabela');
  assert.strictEqual(mappers.formatOrigemPreco('tabela_preco', true), 'Preço de Segurança');
  assert.strictEqual(mappers.formatOrigemPreco('linha_comercial', false), 'Linha de Precificação');
});

test('CSS do resumo financeiro e snapshot', () => {
  const css = fs.readFileSync(STYLES, 'utf8');
  assert.ok(css.includes('cds-resumo-financeiro'));
  assert.ok(css.includes('cds-item-snapshot'));
  assert.ok(css.includes('cds-preparar-entrega__preco-seguranca'));
});

test('Sem ComercialStatusCard / herança PDV de canal', () => {
  const src = fs.readFileSync(NOVA, 'utf8');
  assert.ok(!src.includes("require('../../../../shared/js/ComercialStatusCard')"));
  assert.ok(src.includes("CANAL_OPERACAO_CONSIGNACAO = 'CONSIGNADO'"));
});

test('Snapshot ainda persistido (RCM-6.1 sem regressão)', () => {
  const src = fs.readFileSync(NOVA, 'utf8');
  assert.ok(src.includes('linhaComercialId'));
  assert.ok(src.includes('tabelaPrecoId'));
  assert.ok(src.includes('precoOrigem'));
  assert.ok(src.includes('precoFallback'));
  assert.ok(src.includes('unidadeComercial'));
  assert.ok(src.includes('canalVenda: CANAL_OPERACAO_CONSIGNACAO'));
});

console.log(`\nResultado: ${passou} ok, ${falhou} falha(s)\n`);
process.exit(falhou > 0 ? 1 : 0);
