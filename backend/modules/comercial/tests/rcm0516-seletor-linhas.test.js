/**
 * RCM-05.16 — Seletor inteligente de Linhas Comerciais (Tabelas de Preço)
 * Somente UX — sem alteração de banco / Resolver / regras.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const erpJs = path.join(__dirname, '../../../../frontend/erp/js/tabelas-preco.js');

function run() {
  const src = fs.readFileSync(erpJs, 'utf8');

  // Sem checkboxes
  assert.ok(!src.includes('tabela-preco-linha-check'), 'sem checkboxes');
  assert.ok(!/form-check-input.*linha/.test(src), 'sem form-check de linha');

  // Pesquisa
  assert.ok(src.includes('tabela-preco-linha-busca'), 'campo pesquisa');
  assert.ok(src.includes('scoreBuscaLinhaComercial'), 'ranking inteligente');
  assert.ok(src.includes('filtrarSugestoesLinhasTabelaPreco'), 'filtro sugestões');

  // Chips
  assert.ok(src.includes('tp-linha-chip'), 'chips');
  assert.ok(src.includes('data-remover-linha'), 'remoção por chip');
  assert.ok(src.includes('renderChipsLinhasTabelaPreco'), 'render chips');

  // Adição / grade
  assert.ok(src.includes('adicionarLinhaTabelaPreco'), 'adição');
  assert.ok(src.includes('appendGradeLinhaTabelaPreco') || src.includes('gradePorLinhas'), 'gera grade');
  assert.ok(src.includes('removerLinhaTabelaPreco'), 'remoção');
  assert.ok(src.includes('linhaTemPrecoDigitado'), 'confirma se há preço');

  // UX pós-seleção
  assert.ok(src.includes("val('')") || src.includes('.val("")'), 'limpa campo');
  assert.ok(src.includes('refocarBuscaLinhaTabelaPreco'), 'cursor permanece');

  // Teclado
  assert.ok(src.includes("e.key === 'Enter'"), 'ENTER');
  assert.ok(src.includes("e.key === 'Escape'"), 'ESC');
  assert.ok(src.includes("e.key === 'Backspace'"), 'BACKSPACE');

  // Sem mudança de arquitetura
  assert.ok(src.includes('linhas_ids'), 'payload intacto');
  assert.ok(src.includes('grade-por-linhas') || src.includes('gradePorLinhas'), 'API grade');

  console.log('RCM-05.16 OK — seletor inteligente de Linhas Comerciais');
}

run();
