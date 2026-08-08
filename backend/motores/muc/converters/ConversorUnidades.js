/**
 * Conversões oficiais do Motor de Unidades Comerciais (MUC).
 * Estoque e custo sempre em unidade base; vendas/compras usam fator_conversao.
 *
 * RCM-8.8 / RCM-8.9: conversões canônicas universais (mesma dimensão).
 * Conversões específicas do produto vivem em produto_conversoes.
 */

function arredondar(valor, casas = 6) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** casas;
  return Math.round(n * f) / f;
}

/** Aliases → código canônico MUC */
const ALIASES = Object.freeze({
  LT: 'L',
  LITRO: 'L',
  LITROS: 'L',
  L: 'L',
  ML: 'ML',
  MILILITRO: 'ML',
  MILILITROS: 'ML',
  KG: 'KG',
  KILO: 'KG',
  KILOGRAMA: 'KG',
  KILOGRAMAS: 'KG',
  G: 'G',
  GR: 'G',
  GRAMA: 'G',
  GRAMAS: 'G',
  UN: 'UN',
  UND: 'UN',
  UNIDADE: 'UN',
  UNIDADES: 'UN',
  PC: 'UN',
  PCS: 'UN',
  M: 'M',
  MT: 'M',
  METRO: 'M',
  METROS: 'M',
  CM: 'CM',
  M2: 'M2',
  'M²': 'M2',
  METRO2: 'M2',
  METROS2: 'M2',
  CM2: 'CM2',
  'CM²': 'CM2',
  M3: 'M3',
  'M³': 'M3',
  METRO3: 'M3',
  CM3: 'CM3',
  'CM³': 'CM3'
});

/**
 * Fator em relação à unidade canônica da dimensão.
 * MASS → G · VOL → ML · LEN → CM · AREA → CM2 · VOL3 → CM3 · CNT → UN
 */
const CANON = Object.freeze({
  G: { dim: 'MASS', toCanon: 1 },
  KG: { dim: 'MASS', toCanon: 1000 },
  ML: { dim: 'VOL', toCanon: 1 },
  L: { dim: 'VOL', toCanon: 1000 },
  CM: { dim: 'LEN', toCanon: 1 },
  M: { dim: 'LEN', toCanon: 100 },
  CM2: { dim: 'AREA', toCanon: 1 },
  M2: { dim: 'AREA', toCanon: 10000 },
  CM3: { dim: 'VOL3', toCanon: 1 },
  M3: { dim: 'VOL3', toCanon: 1000000 },
  UN: { dim: 'CNT', toCanon: 1 }
});

function normalizarCodigoUnidade(valor) {
  const raw = String(valor || '').trim().toUpperCase();
  if (!raw) return '';
  // m2 / m3 vindos do cadastro legado
  if (raw === 'M2' || raw === 'M²') return 'M2';
  if (raw === 'M3' || raw === 'M³') return 'M3';
  return ALIASES[raw] || raw;
}

/**
 * Resolve fator: 1 unidadeOrigem = fator × unidadeDestino.
 * Retorna null quando não há conversão canônica conhecida.
 * @returns {{ fator: number, tipo: 'PADRAO'|'AGRUPAMENTO'|'FRACIONAMENTO', origem: string, destino: string }|null}
 */
function resolverFatorConversao(unidadeOrigem, unidadeDestino) {
  const origem = normalizarCodigoUnidade(unidadeOrigem);
  const destino = normalizarCodigoUnidade(unidadeDestino);
  if (!origem || !destino) return null;
  if (origem === destino) {
    return { fator: 1, tipo: 'PADRAO', origem, destino };
  }
  const co = CANON[origem];
  const cd = CANON[destino];
  if (!co || !cd || co.dim !== cd.dim) return null;
  const fator = co.toCanon / cd.toCanon;
  if (!Number.isFinite(fator) || fator <= 0) return null;
  let tipo = 'AGRUPAMENTO';
  if (fator < 1) tipo = 'FRACIONAMENTO';
  return { fator, tipo, origem, destino };
}

function paraBase(quantidadeComercial, fatorConversao) {
  return arredondar(Number(quantidadeComercial || 0) * Number(fatorConversao || 0), 6);
}

function deBase(quantidadeBase, fatorConversao) {
  const fator = Number(fatorConversao || 0);
  if (fator <= 0) return 0;
  return arredondar(Number(quantidadeBase || 0) / fator, 6);
}

function resolverBaixaEstoque({ quantidadeComercial, fatorConversao }) {
  const quantidadeBase = paraBase(quantidadeComercial, fatorConversao);
  return {
    quantidade_comercial: arredondar(quantidadeComercial, 6),
    quantidade_base: quantidadeBase,
    fator_conversao: Number(fatorConversao || 0)
  };
}

function resolverEntradaEstoque({ quantidadeComercial, fatorConversao }) {
  return resolverBaixaEstoque({ quantidadeComercial, fatorConversao });
}

module.exports = {
  arredondar,
  paraBase,
  deBase,
  resolverBaixaEstoque,
  resolverEntradaEstoque,
  normalizarCodigoUnidade,
  resolverFatorConversao,
  ALIASES,
  CANON
};
