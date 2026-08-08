/**
 * RCM-7.4 — Adequação Visual da Consignação
 *
 * Executar:
 *   node backend/modules/comercial/tests/rcm74-adequacao-visual-consignacao.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

process.chdir(path.resolve(__dirname, '../../../..'));

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
const STYLES = path.resolve(
  __dirname,
  '../../../../frontend/modules/motor-comercial/pages/NovaConsignacao/styles.css'
);
const PDV = path.resolve(__dirname, '../../../../frontend/pdv/js/pdv.js');
const CARD = path.resolve(__dirname, '../../../../frontend/shared/js/ComercialStatusCard.js');

console.log('\nRCM-7.4 — Adequação Visual da Consignação\n');

test('Docs RCM74 existe', () => {
  assert.ok(fs.existsSync(
    path.resolve(__dirname, '../../../../docs/RCM74_ADEQUACAO_VISUAL_CONSIGNACAO.md')
  ));
});

test('Nova Consignação remove card de canal do PDV', () => {
  const src = fs.readFileSync(NOVA, 'utf8');
  assert.ok(!src.includes("require('../../../../shared/js/ComercialStatusCard')"));
  assert.ok(!src.includes('preparar-entrega-comercial-status'));
  assert.ok(!src.includes('mostrar_progresso'));
  assert.ok(src.includes('_renderOperacaoResumo'));
});

test('Nova Consignação possui resumo Tipo / Operação / Tabela', () => {
  const src = fs.readFileSync(NOVA, 'utf8');
  assert.ok(src.includes('_renderOperacaoResumo'));
  assert.ok(src.includes('Tipo Comercial'));
  assert.ok(src.includes('Tabela de Preços'));
  assert.ok(src.includes('cds-operacao-resumo'));
  assert.ok(src.includes("CANAL_OPERACAO_CONSIGNACAO = 'CONSIGNADO'"));
});

test('CSS do resumo sem barra de Atacado', () => {
  const css = fs.readFileSync(STYLES, 'utf8');
  assert.ok(css.includes('cds-operacao-resumo'));
  assert.ok(!css.includes('cds-comercial-status-card'));
  assert.ok(!/progresso.*atacado|atacado.*progress/i.test(css));
});

test('PDV mantém ComercialStatusCard', () => {
  const pdv = fs.readFileSync(PDV, 'utf8');
  assert.ok(pdv.includes('ComercialStatusCard') || pdv.includes('garantirComercialStatusCardPdv'));
  assert.ok(fs.existsSync(CARD));
});

test('Config service apenas expõe tabela_preco_nome (sem regra nova)', () => {
  const svc = fs.readFileSync(
    path.resolve(__dirname, '../configuracao/ConfiguracaoComercialService.js'),
    'utf8'
  );
  assert.ok(svc.includes('tabela_preco_nome: preco.tabela_preco_nome'));
});

console.log(`\nResultado: ${passou} ok, ${falhou} falha(s)\n`);
process.exit(falhou > 0 ? 1 : 0);
