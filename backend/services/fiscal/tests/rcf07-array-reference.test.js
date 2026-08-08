/**
 * RCF-07.1 — Teste unitário: referência de array em aplicarDecisaoMidpNosItens
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../../..');
const {
  aplicarDecisaoMidpNosItens
} = require(path.join(root, 'services/vendas/VendaPagamentoService'));

function run() {
  // --- isolamento de referência ---
  const itens = [{ id: 1 }, { id: 2 }];
  const resultado = aplicarDecisaoMidpNosItens(itens);

  assert.notStrictEqual(resultado, itens, 'não compartilha referência');
  assert.strictEqual(itens.length, 2, 'original intacto (length)');
  assert.strictEqual(resultado.length, 2, 'resultado preserva length');

  resultado.push({ id: 99 });
  assert.strictEqual(itens.length, 2, 'mutação no retorno não afeta original');
  assert.strictEqual(resultado.length, 3);

  itens.pop();
  assert.strictEqual(itens.length, 1);
  assert.strictEqual(resultado.length, 3, 'mutação no original não afeta retorno');

  // shallow copy: campos mutáveis do item — garantir cópia do objeto
  const origem = [{ id: 10, quantidade_fiscal: 1, valor_fiscal: 5 }];
  const copia = aplicarDecisaoMidpNosItens(origem, null);
  assert.notStrictEqual(copia[0], origem[0], 'objetos dos itens também são novos');
  copia[0].quantidade_fiscal = 999;
  assert.strictEqual(origem[0].quantidade_fiscal, 1, 'campo do original preservado');

  // --- auditoria estática: clear+repush só após cópia ---
  const src = fs.readFileSync(
    path.join(root, 'services/vendas/VendaPagamentoService.js'),
    'utf8'
  );
  assert.ok(src.includes('base.map((item) => ({ ...item }))'), 'cópia defensiva no código');
  assert.ok(src.includes('[RCF-07.1]'), 'logs RCF-07.1');

  // Varredura: outros length=0 no backend fiscal/comercial críticos
  const arquivosCriticos = [
    'services/fiscal/emissor.js',
    'modules/comercial/kits/KitVendaService.js',
    'modules/comercial/preco/ComercialPrecoResolver.js'
  ];
  for (const rel of arquivosCriticos) {
    const full = path.join(root, rel);
    if (!fs.existsSync(full)) continue;
    const code = fs.readFileSync(full, 'utf8');
    const clears = (code.match(/\.length\s*=\s*0/g) || []).length;
    assert.strictEqual(
      clears,
      0,
      `${rel} não deve zerar arrays no fluxo crítico (encontrado ${clears})`
    );
  }

  console.log('RCF-07.1 OK — array-reference: isolamento + auditoria estática');
}

run();
