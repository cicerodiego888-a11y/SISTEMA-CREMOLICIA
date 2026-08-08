/**
 * RCF-07 — Regressão: MIDP wipe de distribuicaoItens (mesma referência)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../../..');
const vendaPagPath = path.join(root, 'services/vendas/VendaPagamentoService.js');
const emissorPath = path.join(root, 'services/fiscal/emissor.js');

function simularBugAntigo(distribuicaoItens, decisao) {
  // comportamento pré-correção: retorna a MESMA referência quando sem ajuste
  function aplicarDecisaoMidpNosItensBug(itens, dec) {
    if (!dec || !Array.isArray(dec.itensAjuste) || dec.itensAjuste.length === 0) {
      return itens;
    }
    return itens.map((item, index) => {
      const adj = dec.itensAjuste[index];
      if (!adj) return item;
      return { ...item, ...adj };
    });
  }
  const itensFinais = aplicarDecisaoMidpNosItensBug(distribuicaoItens, decisao);
  distribuicaoItens.length = 0;
  itensFinais.forEach((it) => distribuicaoItens.push(it));
  return distribuicaoItens;
}

function run() {
  const src = fs.readFileSync(vendaPagPath, 'utf8');
  const emissor = fs.readFileSync(emissorPath, 'utf8');

  assert.ok(src.includes('RCF-07'), 'código marca RCF-07');
  assert.ok(src.includes('sempre retorna array NOVO') || src.includes('base.map((item) => ({ ...item }))'), 'cópia defensiva');
  assert.ok(src.includes('function(itemErr)'), 'callback clássico this.lastID');
  assert.ok(emissor.includes('[RCF-07] Pipeline fiscal'), 'log pipeline');

  // Reproduz a regressão do padrão length=0 + mesma ref
  const bugados = [{ produto_id: 1, quantidade: 2 }];
  simularBugAntigo(bugados, null);
  assert.strictEqual(bugados.length, 0, 'bug antigo zera itens sem ajuste MIDP');

  // Correção atual
  const { aplicarDecisaoMidpNosItens } = require(vendaPagPath);
  const ok = [{ produto_id: 1, quantidade: 2, valor_fiscal: 10 }];
  const finais = aplicarDecisaoMidpNosItens(ok, null);
  assert.notStrictEqual(finais, ok, 'não retorna mesma referência');
  ok.length = 0;
  finais.forEach((it) => ok.push(it));
  assert.strictEqual(ok.length, 1, 'itens sobrevivem ao clear+repush');
  assert.strictEqual(ok[0].produto_id, 1);

  // Com ajuste MIDP também preserva
  const comAdj = [{ produto_id: 2, quantidade_fiscal: 1, valor_fiscal: 5 }];
  const adj = aplicarDecisaoMidpNosItens(comAdj, {
    itensAjuste: [{ quantidade_fiscal: 0.5, quantidade_nao_fiscal: 0.5, valor_fiscal: 2.5, valor_nao_fiscal: 2.5 }]
  });
  assert.strictEqual(adj[0].quantidade_fiscal, 0.5);
  assert.notStrictEqual(adj, comAdj);

  console.log('RCF-07 OK — MIDP não zera itens; this.lastID com function callback');
}

run();
