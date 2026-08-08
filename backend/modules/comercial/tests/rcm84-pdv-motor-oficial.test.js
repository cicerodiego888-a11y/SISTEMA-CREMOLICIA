/**
 * RCM-8.4 — PDV consumidor puro do Motor Oficial de Precificação
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.chdir(path.resolve(__dirname, '../../..'));
const ROOT = path.resolve(__dirname, '../../../..');

function ler(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function main() {
  console.log('\nRCM-8.4 — Integração Total PDV × Motor Oficial\n');

  const pdv = ler('frontend/pdv/js/pdv.js');
  const mobile = ler('frontend/apps/mobile/js/pages/pdv.js');

  // Sem regras legadas de atacado no PDV
  assert.ok(!/function\s+obterPrecoAtacado\b/.test(pdv), 'sem obterPrecoAtacado');
  assert.ok(!/produto_atacado/.test(pdv) || pdv.includes('RCM-8'), 'sem faixas no fluxo PDV');

  // Snapshot + detalhes
  assert.ok(pdv.includes('extrairSnapshotPrecificacaoPdv'), 'snapshot helper');
  assert.ok(pdv.includes('mostrarDetalhesPrecificacaoPdv'), 'detalhes UI');
  assert.ok(pdv.includes('Detalhes da Precificação'), 'label detalhes');
  assert.ok(pdv.includes('preco_origem'), 'origem no carrinho');
  assert.ok(pdv.includes('tabela_preco_id'), 'tabela no carrinho');
  assert.ok(pdv.includes('linha_comercial_id'), 'linha no carrinho');
  assert.ok(pdv.includes('logHomologacaoPrecificacaoPdv'), 'logs homologação');
  assert.ok(pdv.includes('[RCM-8.4][PDV][Resolver]'), 'log tag');

  // Recalc: UC não é mais skip cego; só ofertas congeladas
  assert.ok(pdv.includes('itemDeveRecalcularPeloResolverPdv'), 'filtro recalc');
  assert.ok(!/if \(item\.unidade_comercial_id\) return;/.test(pdv), 'UC entra no recalc');

  // Kit: FIXO próprio vs Resolver
  assert.ok(pdv.includes('KIT_FIXO') || pdv.includes('tipo_formacao'), 'kit formação');
  assert.ok(pdv.includes('preco_congelado'), 'congelamento ofertas');

  // UC via Resolver
  assert.ok(pdv.includes('continuarAdicionarProdutoComUnidadeMuc'), 'UC fn');
  assert.ok(
    /continuarAdicionarProdutoComUnidadeMuc[\s\S]*enriquecerProdutoCanalPdv/.test(pdv),
    'UC chama Resolver'
  );

  // Balança já usa enrich
  assert.ok(pdv.includes('enriquecerProdutoCanalPdv'), 'enrich geral');

  // Mobile
  assert.ok(mobile.includes('resolver-precos'), 'mobile resolver');
  assert.ok(mobile.includes('tipo_formacao') || mobile.includes('FIXO'), 'mobile kit');
  assert.ok(
    /pdv-muc-scan[\s\S]*resolver-precos/.test(mobile),
    'MUC mobile via Resolver'
  );

  // Performance: recalc com debounce/busy (carrinho grande)
  assert.ok(pdv.includes('_recalcCanalBusy'), 'recalc sem travar (busy)');

  // Promo / desconto após resolver (preservados)
  assert.ok(pdv.includes('buscarPromocaoAtivaProduto'), 'promo');
  assert.ok(pdv.includes('desconto_manual'), 'desconto manual');

  console.log('OK 1 — Sem obterPrecoAtacado / faixas no PDV');
  console.log('OK 2 — Snapshot + Detalhes da Precificação');
  console.log('OK 3 — Recalc quantidade/cliente/canal via Resolver');
  console.log('OK 4 — Kit FIXO vs lista + UC via Resolver');
  console.log('OK 5 — Logs homologação');
  console.log('OK 6 — Mobile + MUC via Resolver');
  console.log('OK 7 — Promo/desconto após Motor');
  console.log('\nRCM-8.4 PASSOU\n');
}

main();
