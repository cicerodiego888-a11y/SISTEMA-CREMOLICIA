/**
 * RCM-8.0 — Resolver Oficial (fluxo único)
 * Com Linha → Tabela×Linha | Sem Linha → Tabela×Produto | Senão → Preço Segurança
 */
const assert = require('assert');
const path = require('path');

const ComercialPrecoResolver = require('../preco/ComercialPrecoResolver');

console.log('\nRCM-8.0 — Arquitetura Oficial\n');

async function run() {
  // 1) Código-fonte: sem caminhos legados no resolver()
  const src = require('fs').readFileSync(
    path.join(__dirname, '../preco/ComercialPrecoResolver.js'),
    'utf8'
  );
  assert.ok(src.includes('RCM-8.0'), 'header RCM-8.0');
  assert.ok(src.includes('Sem Linha → Tabela × Produto'), 'caminho produto oficial');
  assert.ok(!src.includes('pularCompat'), 'sem pularCompat');
  assert.ok(!/origemLabel: 'Linha \(compat legado\)'/.test(src), 'sem compat linha');
  assert.ok(!/origemLabel: 'Tabela de Preço \(compat canal\)'/.test(src), 'sem compat tabela×canal');
  assert.ok(!src.includes("origemLabel: 'Tabela × Produto (compat)'"), 'produto não é mais compat');
  console.log('OK 1 — código do Resolver sem caminhos legados');

  // 2) Constantes exportadas
  assert.strictEqual(ComercialPrecoResolver.ORIGEM_TABELA_LINHA, 'tabela_preco_linha');
  assert.strictEqual(ComercialPrecoResolver.ORIGEM_TABELA_PRODUTO, 'tabela_preco_produto');
  assert.strictEqual(ComercialPrecoResolver.ORIGEM_LEGADO, 'produto.preco_venda');
  console.log('OK 2 — origens oficiais');

  // 3) PDV sem obterPrecoAtacado
  const pdv = require('fs').readFileSync(
    path.join(__dirname, '../../../../frontend/pdv/js/pdv.js'),
    'utf8'
  );
  assert.ok(!pdv.includes('function obterPrecoAtacado'), 'PDV sem obterPrecoAtacado');
  assert.ok(pdv.includes('enriquecerProdutoCanalPdv(produtoBalanca'), 'balança usa Resolver');
  assert.ok(pdv.includes('RCM-8.0'), 'PDV marca RCM-8.0');
  console.log('OK 3 — PDV sem faixas legado');

  // 4) RA6 grade produto
  const ra6 = require('fs').readFileSync(
    path.join(__dirname, '../../../../frontend/erp/js/tabelas-preco-ra6.js'),
    'utf8'
  );
  assert.ok(ra6.includes('ra6-btn-add-produto'), 'botão Adicionar Produto');
  assert.ok(ra6.includes('itens_produto'), 'payload itens_produto');
  assert.ok(ra6.includes("tipo: 'produto'"), 'tipo produto na grade');
  console.log('OK 4 — Tabela UI Linha|Produto');

  // 5) Service produto sem vincular tabela no produto
  const svc = require('fs').readFileSync(
    path.join(__dirname, '../tabelas-preco/TabelaPrecoProdutoService.js'),
    'utf8'
  );
  assert.ok(!svc.includes('vincularProdutosNaTabela'), 'não grava tabela no produto');
  assert.ok(!svc.includes('sincronizarCompatValoresCanal'), 'não espelha compat canal');
  console.log('OK 5 — Produto não recebe tabela_preco_id ao salvar itens');

  console.log('\nRCM-8.0 testes estruturais: PASSOU\n');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
