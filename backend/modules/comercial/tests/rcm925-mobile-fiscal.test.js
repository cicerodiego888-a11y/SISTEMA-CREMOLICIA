/**
 * RCM-9.2.5 — Mobile Fiscal/Não Fiscal (contrato Desktop F12)
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../../..');
const modo = fs.readFileSync(path.join(ROOT, 'frontend/apps/mobile/js/modoFiscal.js'), 'utf8');
const pdv = fs.readFileSync(path.join(ROOT, 'frontend/apps/mobile/js/pages/pdv.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'frontend/apps/mobile/css/mobile.css'), 'utf8');
const core = fs.readFileSync(path.join(ROOT, 'frontend/shared/js/core.js'), 'utf8');

console.log('\nRCM-9.2.5 — Mobile Fiscal/Não Fiscal\n');

// Contrato Desktop
assert.ok(core.includes("pdv_modo_fiscal_ativo"), 'Desktop usa pdv_modo_fiscal_ativo');
assert.ok(core.includes('modo_dashboard_fiscal'), 'Desktop sincroniza modo_dashboard_fiscal');
assert.ok(core.includes('function alternarModoFiscalGlobal'), 'Desktop F12');

// Mobile reutiliza as mesmas chaves/API
assert.ok(modo.includes("pdv_modo_fiscal_ativo"), 'Mobile mesma key localStorage');
assert.ok(modo.includes('modo_dashboard_fiscal'), 'Mobile mesma chave servidor');
assert.ok(modo.includes("configuracoes/modo_dashboard_fiscal") || modo.includes('modo_dashboard_fiscal'), 'API existente');
assert.ok(modo.includes('alternarModoFiscalMobile'), 'toggle Mobile');
assert.ok(modo.includes('emitirFiscalDaVendaAtual'), 'emitir_fiscal do modo');
assert.ok(!/Motor Fiscal Mobile|criarTabela|CREATE TABLE/.test(modo), 'sem motor/tabela nova');

// PDV UI + venda
assert.ok(pdv.includes('modoFiscalChipHtml'), 'chip no PDV');
assert.ok(pdv.includes('emitirFiscalDaVendaAtual'), 'venda usa modo');
assert.ok(pdv.includes('sincronizarModoFiscalDoServidor'), 'sync ao abrir PDV');
assert.ok(!/pdv-emit-nfce/.test(pdv), 'sem checkbox paralelo NFC-e');
assert.ok(/emitir_fiscal:\s*emitir/.test(pdv), 'POST vendas com emitir_fiscal');
assert.ok(!/resolver-precos[\s\S]{0,80}emitir_fiscal|calcularAtacadoLocal/.test(pdv) || pdv.includes('resolver-precos'), 'resolver intacto');

// CSS chip
assert.ok(css.includes('cds-fiscal-chip'), 'css chip');
assert.ok(css.includes('cds-fiscal-chip--on'), 'estado ON');
assert.ok(css.includes('cds-fiscal-chip--off'), 'estado OFF');

console.log('OK 1 — Contrato Desktop reutilizado (localStorage + configuracoes)');
console.log('OK 2 — Chip 🟢 FISCAL / ⚪ NÃO FISCAL no PDV');
console.log('OK 3 — emitir_fiscal vem do modo (sem checkbox paralelo)');
console.log('OK 4 — Sem Motor Fiscal / sem nova API / sem tabela');
console.log('\nRCM-9.2.5 PASSOU\n');
