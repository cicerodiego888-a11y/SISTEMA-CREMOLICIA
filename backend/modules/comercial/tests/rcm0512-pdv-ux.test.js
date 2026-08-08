/**
 * RCM-05.12 — UX PDV (canal compacto + unitário readonly)
 * Sem alteração de regras de negócio — valida contrato visual/API do card.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const cardPath = path.join(
  __dirname,
  '../../../../frontend/shared/js/ComercialStatusCard.js'
);
const pdvJsPath = path.join(__dirname, '../../../../frontend/pdv/js/pdv.js');
const pdvHtmlPath = path.join(__dirname, '../../../../frontend/pdv/pages/pdv.html');
const pdvCssPath = path.join(__dirname, '../../../../frontend/css/pdv.css');

const ComercialStatusCard = require(cardPath);

function run() {
  // Estados de canal
  assert.strictEqual(ComercialStatusCard.normalizeState({ canal: 'varejo' }).canal, 'VAREJO');
  assert.strictEqual(ComercialStatusCard.normalizeState({ canal: 'ATACADO' }).canal, 'ATACADO');
  assert.strictEqual(ComercialStatusCard.normalizeState({ canal: 'EVENTO' }).canal, 'EVENTO');

  const prog = ComercialStatusCard.normalizeState({
    canal: 'VAREJO',
    quantidadeAtual: 12,
    quantidadeNecessaria: 30,
    atacado_habilitado: true
  });
  assert.strictEqual(prog.mostrar_progresso, true);
  assert.ok(prog.progresso > 0 && prog.progresso < 100);

  const completo = ComercialStatusCard.normalizeState({
    canal: 'VAREJO',
    quantidadeAtual: 30,
    quantidadeNecessaria: 30,
    atacado_habilitado: true
  });
  assert.strictEqual(completo.progresso, 100);

  // CSS compacto / barra 3px
  const css = ComercialStatusCard.DEFAULT_CSS || '';
  assert.ok(css.includes('cds-comercial-status-card--compact'), 'classe compact');
  assert.ok(/height:\s*3px/.test(css), 'barra 3px');
  assert.ok(css.includes('box-shadow: none'), 'sem sombra no compact');

  const srcCard = fs.readFileSync(cardPath, 'utf8');
  assert.ok(srcCard.includes("compact === true") || srcCard.includes("variant === 'compact'"));

  // PDV: monta compact + unitário readonly + seletor discreto
  const pdvJs = fs.readFileSync(pdvJsPath, 'utf8');
  assert.ok(pdvJs.includes('compact: true'), 'PDV monta canal compacto');
  assert.ok(pdvJs.includes('pdv-unitario-readonly'), 'unitário readonly');
  assert.ok(pdvJs.includes('solicitarAlteracaoPrecoUnitarioPdv'), 'alteração via autorização');
  assert.ok(!/class="form-control form-control-sm valor-item/.test(pdvJs), 'sem input valor-item');

  const pdvHtml = fs.readFileSync(pdvHtmlPath, 'utf8');
  assert.ok(pdvHtml.includes('pdv-canal-seletor'), 'seletor Auto|Evento');
  assert.ok(pdvHtml.includes('pdv-canal-link'), 'links discretos');

  const pdvCss = fs.readFileSync(pdvCssPath, 'utf8');
  assert.ok(pdvCss.includes('pdv-unitario-readonly'));
  assert.ok(pdvCss.includes('pdv-canal-link'));

  console.log('RCM-05.12 OK — UX PDV canal compacto + unitário readonly');
}

run();
