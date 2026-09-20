/**
 * LIP — mapeadores e utilitários de apresentação
 *
 * @module frontend/shared/components/LIP/lipMappers
 */

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Destaca termo pesquisado no texto.
 * @param {string} text
 * @param {string} term
 * @returns {string} HTML seguro
 */
function highlightTerm(text, term) {
  const raw = String(text ?? '');
  if (!term || term.length < 2) return escapeHtml(raw);
  const parts = String(term).trim().split(/\s+/).filter((p) => p.length >= 2);
  if (!parts.length) return escapeHtml(raw);

  let html = escapeHtml(raw);
  parts.forEach((part) => {
    const re = new RegExp(`(${escapeRegex(part)})`, 'gi');
    html = html.replace(re, '<mark class="lip-highlight">$1</mark>');
  });
  return html;
}

/**
 * Normaliza produto da API para o LIP.
 * @param {Object} row
 * @returns {Object}
 */
function normalizeLipProduct(row = {}) {
  const precoPromo = Number(row.preco_promocional || 0);
  const temPromo = row.tem_promocao === 1 || row.tem_promocao === true;
  const precoBase = Number(row.preco_venda || row.preco || 0);
  const preco = temPromo && precoPromo > 0 ? precoPromo : precoBase;

  const ativoRaw = row.ativo;
  const ativo = ativoRaw === undefined || ativoRaw === null
    ? true
    : !(ativoRaw === 0 || ativoRaw === false || ativoRaw === '0');

  return {
    id: row.id,
    nome: row.nome || row.descricao || `Produto #${row.id}`,
    codigo: row.codigo || '',
    codigo_barras: row.codigo_barras || '',
    referencia: row.referencia || row.codigo || String(row.id),
    categoria: row.categoria || row.categoria_nome || '',
    subcategoria: row.subcategoria || '',
    marca: row.marca || row.fornecedor || '',
    fabricante: row.fabricante || row.fornecedor || '',
    estoque: Number(row.estoque ?? row.estoque_exibido ?? row.estoque_atual ?? 0),
    preco_venda: precoBase,
    preco,
    unidade: row.unidade || 'UN',
    ativo,
    match_exato: row.match_exato === 1 || row.match_exato === true,
    frequente: Boolean(row.frequente)
  };
}

/** Mantém apenas produtos ativos (desativado = ativo 0/false). */
function filterActiveLipProducts(products = []) {
  return (products || []).filter((p) => p && p.ativo !== false);
}

/**
 * Agrupa produtos por categoria e família (primeira palavra significativa do nome).
 * @param {Array} products
 * @returns {Array<{ label: string, subgroups: Array<{ label: string, items: Array }> }>}
 */
function groupLipProducts(products = []) {
  const byCategory = new Map();

  products.forEach((product) => {
    const cat = product.categoria || 'Outros';
    if (!byCategory.has(cat)) byCategory.set(cat, new Map());
    const catMap = byCategory.get(cat);

    const family = extractFamilyLabel(product.nome);
    if (!catMap.has(family)) catMap.set(family, []);
    catMap.get(family).push(product);
  });

  return Array.from(byCategory.entries()).map(([category, families]) => ({
    label: category,
    subgroups: Array.from(families.entries()).map(([family, items]) => ({
      label: family,
      items
    }))
  }));
}

function extractFamilyLabel(nome = '') {
  const words = String(nome).trim().split(/\s+/).filter(Boolean);
  if (words.length <= 2) return words[0] || 'Geral';
  return words.slice(0, 2).join(' ');
}

function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(Number(value) || 0);
}

module.exports = {
  escapeHtml,
  highlightTerm,
  normalizeLipProduct,
  filterActiveLipProducts,
  groupLipProducts,
  formatCurrency
};
