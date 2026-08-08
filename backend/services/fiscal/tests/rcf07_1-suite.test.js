/**
 * RCF-07.1 — Runner da suíte permanente de regressão fiscal + amostragem comercial
 */
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '../../..');
const fiscalTests = [
  'services/fiscal/tests/rcf02-fluxo-nfce.test.js',
  'services/fiscal/tests/rcf06-carregar-venda.test.js',
  'services/fiscal/tests/rcf07-regressao-midp-itens.test.js',
  'services/fiscal/tests/rcf07-array-reference.test.js',
  'services/fiscal/tests/rcf07-persistencia.test.js',
  'services/fiscal/tests/rcf07-integracao.test.js',
  'services/fiscal/tests/rcf07-midp-regressao.test.js',
  'services/fiscal/tests/rcf08-fiscal-nao-fiscal.test.js',
  'services/fiscal/tests/rcf09-comprovante-remontado.test.js',
  'services/fiscal/tests/rcf10-comprovante-comercial.test.js',
  'services/fiscal/tests/rcf10-regressao.test.js',
  'services/fiscal/tests/rcf10_1-layout-cupom.test.js',
  'services/fiscal/tests/rcf10_1-end-to-end.test.js'
];

const comercialSample = [
  // Amostra alinhada às UIs/regras atuais (evitar legados pré Linha Comercial / pré seletor chips)
  'modules/comercial/tests/rcm054-montador-casquinha.test.js',
  'modules/comercial/tests/rcm059-kits-combos.test.js',
  'modules/comercial/tests/rcm0516-seletor-linhas.test.js'
];

function runOne(rel) {
  const file = path.join(root, rel);
  console.log(`\n>>> ${rel}`);
  const r = spawnSync(process.execPath, [file], {
    cwd: path.join(root, '..'),
    encoding: 'utf8',
    timeout: 120000
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) {
    console.error(`FAIL ${rel} exit=${r.status}`);
    process.exit(r.status || 1);
  }
}

console.log('=== RCF-07.1 SUÍTE ===');
[...fiscalTests, ...comercialSample].forEach(runOne);
console.log('\n=== RCF-07.1 TODAS APROVADAS ===');
