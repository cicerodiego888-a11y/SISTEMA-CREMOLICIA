/**
 * RCM-9.2.2.2 — Sticky do carrinho PDV Mobile (layout full-width, sem quebra vertical)
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../../..');
const pdv = fs.readFileSync(path.join(ROOT, 'frontend/apps/mobile/js/pages/pdv.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'frontend/apps/mobile/css/mobile.css'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'frontend/apps/mobile/index.html'), 'utf8');

console.log('\nRCM-9.2.2.2 — Sticky layout PDV Mobile\n');

// Markup: Finalizar full-width class + label com canal/itens
assert.ok(pdv.includes('cds-pdv-sticky__pay'), 'botão Finalizar com classe full-width');
assert.ok(/TOTAL\$\{canal/.test(pdv), 'label TOTAL · canal');
assert.ok(pdv.includes('itens'), 'label com quantidade de itens');
assert.ok(pdv.includes('pdv-resumo-toggle'), 'toggle Expandir');
assert.ok(!/Motor Mobile|calcularAtacadoLocal/.test(pdv), 'sem motor paralelo');

// CSS anti-quebra vertical
assert.ok(/\.cds-pdv-sticky\s*\{[\s\S]*?width:\s*100%/.test(css), 'sticky width 100%');
assert.ok(/\.cds-pdv-sticky\s*\{[\s\S]*?max-width:\s*100%/.test(css), 'sticky max-width 100%');
assert.ok(/\.cds-pdv-sticky\s*\{[\s\S]*?box-sizing:\s*border-box/.test(css), 'sticky box-sizing');
assert.ok(/\.cds-pdv-sticky__bar\s*\{[\s\S]*?flex-direction:\s*column/.test(css), 'bar em coluna');
const labelBlock = (css.match(/\.cds-pdv-sticky__total-label\s*\{[^}]*\}/) || [])[0] || '';
assert.ok(/white-space:\s*nowrap/.test(labelBlock), 'label nowrap');
assert.ok(/text-overflow:\s*ellipsis/.test(labelBlock), 'label ellipsis');
assert.ok(!/word-break:\s*break-word/.test(labelBlock), 'sem word-break no label');
assert.ok(!/max-width:\s*5[028]vw/.test(labelBlock), 'sem max-width vw estreito');
assert.ok(/word-break:\s*normal/.test(labelBlock), 'word-break normal no label');
assert.ok(/\.cds-pdv-sticky__pay[\s\S]{0,120}?width:\s*100%/.test(css), 'Finalizar width 100%');
assert.ok(/\.cds-pdv-sticky__toggle\s*\{[^}]*text-align:\s*center/.test(css), 'Expandir centralizado');
assert.ok(/#pdv-cart\s*\{[^}]*padding-bottom:\s*calc\(148px/.test(css), 'padding carrinho acima do sticky');
const expandedBlock = (css.match(/\.cds-pdv-sticky\.is-expanded\s+\.cds-pdv-sticky__details\s*\{[^}]*\}/) || [])[0] || '';
assert.ok(/overflow-x:\s*hidden/.test(expandedBlock), 'expandido sem scroll X');

// Cache bust
assert.ok(html.includes('mobile.css?v=2.5.3-rcm9222'), 'cache CSS rcm9222');

console.log('OK 1 — Sticky full-width + box-sizing');
console.log('OK 2 — Label nowrap/ellipsis (sem quebra vertical)');
console.log('OK 3 — Barra em coluna · Finalizar 100%');
console.log('OK 4 — Padding do carrinho + Expandir central');
console.log('OK 5 — Sem motor / regras comerciais no escopo');
console.log('\nRCM-9.2.2.2 PASSOU\n');
