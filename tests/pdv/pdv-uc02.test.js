/**
 * PDV-UC-02 — Cutover PDV → UC-01 (Forma de Venda / label do modal)
 * Executar: npm run test:pdv-uc02
 */

const assert = require('assert');
const path = require('path');

const PdvUc = require(path.join(
  __dirname,
  '../../frontend/shared/js/pdvFormaVendaUc01.js'
));

let passou = 0;
let falhou = 0;

function test(nome, fn) {
  try {
    fn();
    passou += 1;
    console.log(`  OK  ${nome}`);
  } catch (error) {
    falhou += 1;
    console.error(`  FALHOU  ${nome}`);
    console.error(`         ${error.message}`);
  }
}

function produtoBase(overrides = {}) {
  return {
    id: 1,
    nome: 'Produto',
    unidade: 'UN',
    preco_venda: 10,
    ...overrides
  };
}

function aplicar(produto, items) {
  return PdvUc.aplicarUnidadesUc01NoProduto(produto, { items });
}

console.log('\nPDV-UC-02 — Resolução Forma de Venda / label modal\n');

test('parse oficial: resp.items', () => {
  const lista = PdvUc.extrairListaUc01({
    items: [{ id: 1, unidade_comercial: 'KG' }],
    unidades: [{ id: 99, unidade_comercial: 'L' }]
  });
  assert.strictEqual(lista.length, 1);
  assert.strictEqual(lista[0].unidade_comercial, 'KG');
});

test('parse compat: resp.unidades / resp.data / array', () => {
  assert.strictEqual(PdvUc.extrairListaUc01({ unidades: [{ id: 1 }] }).length, 1);
  assert.strictEqual(PdvUc.extrairListaUc01({ data: [{ id: 2 }] }).length, 1);
  assert.strictEqual(PdvUc.extrairListaUc01([{ id: 3 }]).length, 1);
});

test('mapper usa unidade_padrao (não padrao/principal legado)', () => {
  const m = PdvUc.mapearUc01ParaPdv({
    id: 10,
    unidade_comercial: 'KG',
    unidade_padrao: 1,
    prioridade: 2,
    permite_pdv: 1,
    canais_comercializacao: { pdv: 1 },
    ativo: 1,
    quantidade: 1,
    tipo: 'FISICA'
  }, produtoBase({ unidade: 'L' }));
  assert.strictEqual(m.unidade, 'KG');
  assert.strictEqual(m.unidade_padrao, 1);
  assert.strictEqual(m.principal, 1);
  assert.strictEqual(m.prioridade, 2);
});

test('Base L + UC KG PDV → modal Quantidade em KG', () => {
  const p = aplicar(produtoBase({ unidade: 'L' }), [
    {
      id: 1,
      unidade_comercial: 'L',
      tipo: 'PADRAO',
      quantidade: 1,
      unidade_padrao: 0,
      prioridade: 1,
      permite_pdv: 1,
      canais_comercializacao: { pdv: 1 },
      ativo: 1
    },
    {
      id: 2,
      unidade_comercial: 'KG',
      tipo: 'FISICA',
      quantidade: 1,
      unidade_padrao: 1,
      prioridade: 2,
      permite_pdv: 1,
      canais_comercializacao: { pdv: 1 },
      ativo: 1
    }
  ]);
  const uc = PdvUc.resolverFormaVendaPdv(p);
  assert.strictEqual(uc.unidade_comercial, 'KG');
  assert.strictEqual(PdvUc.labelModalQuantidade(p, uc), 'KG');
});

test('Base UN + UC Caixa PDV → modal Quantidade em CX', () => {
  const p = aplicar(produtoBase({ unidade: 'UN' }), [
    {
      id: 1,
      unidade_comercial: 'CX',
      descricao: 'Caixa',
      tipo: 'AGRUPAMENTO',
      quantidade: 12,
      unidade_padrao: 1,
      prioridade: 1,
      permite_pdv: 1,
      canais_comercializacao: { pdv: 1 },
      ativo: 1
    }
  ]);
  const uc = PdvUc.resolverFormaVendaPdv(p);
  assert.strictEqual(uc.unidade, 'CX');
  assert.strictEqual(PdvUc.labelModalQuantidade(p, uc), 'CX');
});

test('Base MT + UC Rolo PDV → modal Quantidade em ROLO', () => {
  const p = aplicar(produtoBase({ unidade: 'MT' }), [
    {
      id: 1,
      unidade_comercial: 'ROLO',
      tipo: 'AGRUPAMENTO',
      quantidade: 50,
      unidade_padrao: 1,
      prioridade: 1,
      permite_pdv: 1,
      canais_comercializacao: { pdv: 1 },
      ativo: 1
    }
  ]);
  const uc = PdvUc.resolverFormaVendaPdv(p);
  assert.strictEqual(PdvUc.labelModalQuantidade(p, uc), 'ROLO');
});

test('Produto sem UC → fallback Unidade Base UN', () => {
  const p = aplicar(produtoBase({ unidade: 'UN' }), []);
  const uc = PdvUc.resolverFormaVendaPdv(p);
  assert.strictEqual(uc, null);
  assert.strictEqual(PdvUc.labelModalQuantidade(p, uc), 'UN');
});

test('Duas UCs: unidade_padrao vence', () => {
  const p = aplicar(produtoBase({ unidade: 'L' }), [
    {
      id: 1,
      unidade_comercial: 'L',
      tipo: 'PADRAO',
      quantidade: 1,
      unidade_padrao: 0,
      prioridade: 1,
      permite_pdv: 1,
      canais_comercializacao: { pdv: 1 },
      ativo: 1
    },
    {
      id: 2,
      unidade_comercial: 'KG',
      tipo: 'FISICA',
      quantidade: 1,
      unidade_padrao: 1,
      prioridade: 99,
      permite_pdv: 1,
      canais_comercializacao: { pdv: 1 },
      ativo: 1
    }
  ]);
  assert.strictEqual(PdvUc.resolverFormaVendaPdv(p).unidade_comercial, 'KG');
});

test('Duas UCs sem padrão: menor prioridade', () => {
  const p = aplicar(produtoBase({ unidade: 'UN' }), [
    {
      id: 1,
      unidade_comercial: 'PCT',
      tipo: 'AGRUPAMENTO',
      quantidade: 6,
      unidade_padrao: 0,
      prioridade: 5,
      permite_pdv: 1,
      canais_comercializacao: { pdv: 1 },
      ativo: 1
    },
    {
      id: 2,
      unidade_comercial: 'CX',
      tipo: 'AGRUPAMENTO',
      quantidade: 12,
      unidade_padrao: 0,
      prioridade: 1,
      permite_pdv: 1,
      canais_comercializacao: { pdv: 1 },
      ativo: 1
    }
  ]);
  assert.strictEqual(PdvUc.resolverFormaVendaPdv(p).unidade_comercial, 'CX');
});

test('Heurística antiga removida: UC única PADRAO quantidade=1 ainda resolve', () => {
  const p = aplicar(produtoBase({ unidade: 'L' }), [
    {
      id: 1,
      unidade_comercial: 'KG',
      tipo: 'PADRAO',
      quantidade: 1,
      unidade_padrao: 1,
      prioridade: 1,
      permite_pdv: 1,
      canais_comercializacao: { pdv: 1 },
      ativo: 1
    }
  ]);
  const uc = PdvUc.resolverFormaVendaPdv(p);
  assert.ok(uc);
  assert.strictEqual(PdvUc.labelModalQuantidade(p, uc), 'KG');
});

test('Canal: UC só ERP não entra no PDV', () => {
  const p = aplicar(produtoBase({ unidade: 'L' }), [
    {
      id: 1,
      unidade_comercial: 'KG',
      tipo: 'FISICA',
      quantidade: 1,
      unidade_padrao: 1,
      prioridade: 1,
      permite_pdv: 0,
      canais_comercializacao: { pdv: 0, venda_erp: 1 },
      ativo: 1
    }
  ]);
  assert.strictEqual(PdvUc.resolverFormaVendaPdv(p), null);
  assert.strictEqual(PdvUc.labelModalQuantidade(p, null), 'L');
});

test('canais objeto { pdv: 1 } permitido', () => {
  assert.strictEqual(
    PdvUc.unidadePermitidaNoPdv({
      ativo: 1,
      permite_pdv: 1,
      canais_comercializacao: { pdv: 1, compra: 0 }
    }),
    true
  );
});

console.log(`\nResultado: ${passou} OK, ${falhou} falha(s)\n`);
process.exit(falhou > 0 ? 1 : 0);
