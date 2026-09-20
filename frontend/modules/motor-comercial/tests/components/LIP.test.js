/**
 * LIP — testes Sprint S-6.2
 */

const {
  highlightTerm,
  normalizeLipProduct,
  filterActiveLipProducts,
  groupLipProducts
} = require('../../../../shared/components/LIP/lipMappers');
const { readRecent, saveRecent } = require('../../../../shared/components/LIP/lipHistory');

describe('LIP lipMappers', () => {
  test('highlightTerm destaca trecho pesquisado', () => {
    const html = highlightTerm('Lampada Retro PS160', 'PS160');
    expect(html).toContain('<mark class="lip-highlight">PS160</mark>');
  });

  test('normalizeLipProduct padroniza preço', () => {
    const p = normalizeLipProduct({ id: 1, nome: 'Teste', preco_venda: 10, preco_promocional: 8, tem_promocao: 1 });
    expect(p.preco).toBe(8);
    expect(p.nome).toBe('Teste');
  });

  test('filterActiveLipProducts remove desativados', () => {
    const list = filterActiveLipProducts([
      normalizeLipProduct({ id: 1, nome: 'Ativo', ativo: 1 }),
      normalizeLipProduct({ id: 2, nome: 'Inativo', ativo: 0 }),
      normalizeLipProduct({ id: 3, nome: 'Sem flag' })
    ]);
    expect(list.map((p) => p.id)).toEqual([1, 3]);
  });

  test('groupLipProducts agrupa por categoria', () => {
    const groups = groupLipProducts([
      { id: 1, nome: 'Lampada A', categoria: 'Iluminação' },
      { id: 2, nome: 'Lampada B', categoria: 'Iluminação' }
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Iluminação');
    expect(groups[0].subgroups[0].items).toHaveLength(2);
  });
});

describe('LIP lipHistory', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('saveRecent e readRecent', () => {
    saveRecent({ id: 5, nome: 'Produto X', preco: 12 });
    const list = readRecent();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(5);
  });
});
