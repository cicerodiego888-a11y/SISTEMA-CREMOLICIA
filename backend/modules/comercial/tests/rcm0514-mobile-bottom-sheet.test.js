/**
 * RCM-05.14 — PDV Mobile V2: Bottom Sheet de adição de produtos
 * Valida contrato UX (sem regras de negócio / Resolver).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const mobileRoot = path.join(__dirname, '../../../../frontend/apps/mobile');
const sheetPath = path.join(mobileRoot, 'js/pdv-add-sheet.js');
const pdvPath = path.join(mobileRoot, 'js/pages/pdv.js');
const formsPath = path.join(mobileRoot, 'js/forms.js');
const cssPath = path.join(mobileRoot, 'css/mobile.css');

function run() {
  const sheet = fs.readFileSync(sheetPath, 'utf8');
  const pdv = fs.readFileSync(pdvPath, 'utf8');
  const forms = fs.readFileSync(formsPath, 'utf8');
  const css = fs.readFileSync(cssPath, 'utf8');

  // Componente único
  assert.ok(sheet.includes('export function openPdvAddProdutoSheet'), 'export openPdvAddProdutoSheet');
  assert.ok(pdv.includes("from '../pdv-add-sheet.js'"), 'pdv importa sheet');

  // Formas comerciais
  assert.ok(sheet.includes("forma === 'PESO'") || sheet.includes("f === 'PESO'"), 'peso');
  assert.ok(sheet.includes("forma === 'VOLUME'") || sheet.includes("f === 'VOLUME'"), 'volume');
  assert.ok(sheet.includes('CASQUINHA') && sheet.includes('Montar Casquinha'), 'casquinha');
  assert.ok(sheet.includes('kit') || sheet.includes('KIT'), 'kit');
  assert.ok(sheet.includes('Quantidade') || sheet.includes('quantidade'), 'unidade/qtd');

  // Botões + − e campo numérico
  assert.ok(sheet.includes('qtyControlHtml'), 'controle +/-');
  assert.ok(sheet.includes('pdv-add-qtd'), 'campo numérico');
  assert.ok(sheet.includes('bindQtyControls'), 'bind +/-');
  assert.ok(sheet.includes('inputmode') || forms.includes("inputmode=\"decimal\""), 'teclado numérico');

  // Sem botão + na lista; toque no produto
  assert.ok(pdv.includes('cds-list-card--pdv-pick'), 'card toque');
  assert.ok(!/icon\('plus'\)/.test(pdv.split('pdv-results')[1]?.slice(0, 2500) || ''), 'sem ícone + na lista');
  assert.ok(pdv.includes('openPdvAddProdutoSheet'), 'abre bottom sheet');

  // Pesquisa permanece + refoco
  assert.ok(pdv.includes('refocusPdvSearch'), 'refoco pesquisa');
  assert.ok(pdv.includes('preventScroll'), 'foco sem scroll jump');
  assert.ok(!/searchEl\.value\s*=\s*['"]/.test(pdv), 'não limpa pesquisa');

  // Animação / painel
  assert.ok(css.includes('cds-sheet__panel--pdv-add'), 'painel PDV');
  assert.ok(/min-height:\s*55dvh/.test(css) || /70dvh/.test(css), 'altura ~60-70%');
  assert.ok(forms.includes('closeMs') && forms.includes('panelClass'), 'sheet reutilizável com opts');
  assert.ok(sheet.includes('closeMs: 150'), 'fechamento 150ms');
  assert.ok(/0\.18s/.test(css), 'abertura ~180ms');

  // Acessibilidade 48px
  assert.ok(css.includes('min-width: 48px') && css.includes('min-height: 48px'), 'touch 48px');

  // Sem duplicar Resolver no sheet (só UI)
  assert.ok(!sheet.includes('resolver-precos'), 'sheet sem Resolver');
  assert.ok(pdv.includes('configuracao-comercial/resolver-precos'), 'pdv chama Resolver');

  console.log('RCM-05.14 OK — Bottom Sheet PDV Mobile V2');
}

run();
