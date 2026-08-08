/**
 * RCM-05.13 — UX PDV Mobile: resumo da venda retrátil
 * Sem alteração de regras de negócio — valida contrato visual/comportamental.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const mobileRoot = path.join(__dirname, '../../../../frontend/apps/mobile');
const pdvJsPath = path.join(mobileRoot, 'js/pages/pdv.js');
const cssPath = path.join(mobileRoot, 'css/mobile.css');

function run() {
  const pdvJs = fs.readFileSync(pdvJsPath, 'utf8');
  const css = fs.readFileSync(cssPath, 'utf8');

  // Inicia recolhido
  assert.ok(/let pdvResumoExpandido\s*=\s*false/.test(pdvJs), 'estado inicia recolhido');
  assert.ok(pdvJs.includes('pdvResumoExpandido = false'), 'reset ao abrir aba Vender');

  // Expandir / Recolher
  assert.ok(pdvJs.includes('pdv-resumo-toggle'), 'botão expandir/recolher');
  assert.ok(pdvJs.includes('▲ Expandir') && pdvJs.includes('▼ Recolher'), 'rótulos expandir/recolher');
  assert.ok(pdvJs.includes('is-expanded'), 'classe de expansão');

  // Recolhe após adicionar produto
  assert.ok(pdvJs.includes('recolherResumo: true'), 'recolhe após adicionar');
  assert.ok(/if\s*\(\s*opts\.recolherResumo\s*\)\s*pdvResumoExpandido\s*=\s*false/.test(pdvJs), 'flag recolherResumo');

  // Total + Finalizar sempre no sticky compacto
  assert.ok(pdvJs.includes('cds-pdv-sticky__total'), 'bloco TOTAL');
  assert.ok(pdvJs.includes('TOTAL'), 'label TOTAL');
  assert.ok(pdvJs.includes('id="pdv-pay"'), 'Finalizar acessível');
  assert.ok(pdvJs.includes('cds-pdv-sticky__bar'), 'barra inferior TOTAL+Finalizar');

  // Desc/Acr só no detalhe expandido
  assert.ok(pdvJs.includes('pdv-resumo-details'), 'detalhes no expandido');
  assert.ok(pdvJs.includes('id="pdv-desc"'), 'Desc/Acr no expandido');
  assert.ok(pdvJs.includes('Subtotal') && pdvJs.includes('Desconto') && pdvJs.includes('Acréscimo'), 'linhas financeiras no expandido');

  // Animação 200ms sem reload de negócio
  assert.ok(/transition:\s*max-height\s*200ms/.test(css), 'animação 200ms');
  assert.ok(css.includes('.cds-pdv-sticky__details'), 'detalhes animáveis');
  assert.ok(css.includes('min-height: 70px'), 'altura compacta ~70px');

  // Sticky / responsividade
  assert.ok(/position:\s*sticky/.test(css), 'barra sticky fixa no rodapé');
  assert.ok(css.includes('.cds-pdv-sticky__bar'), 'layout compacto flex');
  assert.ok(css.includes('.cds-pdv-sticky__toggle'), 'toggle responsivo');

  // paintCart não chama APIs (só UX)
  const paintStart = pdvJs.indexOf('function paintCart');
  const paintEnd = pdvJs.indexOf('\nasync function ', paintStart + 1);
  const paintBody = pdvJs.slice(paintStart, paintEnd > 0 ? paintEnd : paintStart + 5000);
  assert.ok(!/\bCDSApi\./.test(paintBody), 'paintCart sem CDSApi');
  assert.ok(!/\bfetch\s*\(/.test(paintBody), 'paintCart sem fetch');

  console.log('RCM-05.13 OK — resumo PDV Mobile retrátil');
}

run();
