/**
 * RCM-9.2.2.1 — UX rápida PDV Mobile (terminal compacto + limpeza pesquisa)
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../../..');
const pdv = fs.readFileSync(path.join(ROOT, 'frontend/apps/mobile/js/pages/pdv.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'frontend/apps/mobile/css/mobile.css'), 'utf8');

console.log('\nRCM-9.2.2.1 — UX rápida PDV Mobile\n');

assert.ok(pdv.includes('clearPdvSearchAfterAdd'), 'limpa pesquisa após add');
assert.ok(pdv.includes('cds-term-chip'), 'chip compacto');
assert.ok(pdv.includes("st.code === 'CAIXA_ABERTO'"), 'compacta só quando OK');
assert.ok(pdv.includes('bindTerminalStatusUi'), 'toque no chip');
assert.ok(/SEM_CAIXA|cds-term-banner--warn|cds-term-banner--danger/.test(pdv), 'problemas com banner');
assert.ok(!/Motor Mobile|calcularAtacadoLocal/.test(pdv), 'sem motor paralelo');
assert.ok(css.includes('cds-term-chip'), 'css chip');
assert.ok(pdv.includes('recalcularCarrinhoViaResolver'), 'atacado/recalc preservado');
assert.ok(pdv.includes('quantidade_avaliada'), 'itens comerciais preservados');

// clear não mexe no cart key
assert.ok(
  /function clearPdvSearchAfterAdd[\s\S]*?#pdv-search[\s\S]*?#pdv-results[\s\S]*?refocusPdvSearch/.test(pdv),
  'clear só pesquisa/resultados/foco'
);
assert.ok(!/function clearPdvSearchAfterAdd[\s\S]{0,400}saveCart\(\[\]\)/.test(pdv), 'clear não zera carrinho');

console.log('OK 1 — Terminal compacto quando CAIXA_ABERTO');
console.log('OK 2 — Banner completo em problemas');
console.log('OK 3 — Limpa pesquisa + foco após add');
console.log('OK 4 — Carrinho/canal/resolver intactos');
console.log('\nRCM-9.2.2.1 PASSOU\n');
