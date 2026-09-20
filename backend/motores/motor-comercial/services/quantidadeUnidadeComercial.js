/**
 * Validação operacional de quantidade pela unidade comercial congelada.
 * Não consulta Resolver nem altera preço.
 */

const UNIDADES_INTEIRAS = new Set(['UN', 'UND', 'UNID', 'UNIDADE', 'PC', 'PÇ', 'PEC', 'PECA', 'CX', 'DZ']);
const UNIDADES_DECIMAIS = new Set([
  'KG', 'G', 'GR', 'GRAMA', 'GRAMAS',
  'L', 'LT', 'LITRO', 'LITROS', 'ML',
  'M', 'MT', 'M2', 'M3'
]);

function normalizarUnidade(unidade) {
  return String(unidade || 'UN').trim().toUpperCase();
}

function unidadePermiteFracao(unidade) {
  const u = normalizarUnidade(unidade);
  if (UNIDADES_DECIMAIS.has(u)) return true;
  if (UNIDADES_INTEIRAS.has(u)) return false;
  return !UNIDADES_INTEIRAS.has(u);
}

function validarQuantidadePorUnidade(quantidade, unidade) {
  const qtd = Number(quantidade);
  if (!Number.isFinite(qtd) || qtd <= 0) {
    return { ok: false, motivo: 'quantidade deve ser maior que zero' };
  }
  if (!unidadePermiteFracao(unidade) && !Number.isInteger(qtd)) {
    return { ok: false, motivo: `unidade ${normalizarUnidade(unidade)} exige quantidade inteira` };
  }
  return { ok: true, quantidade: qtd };
}

module.exports = {
  normalizarUnidade,
  unidadePermiteFracao,
  validarQuantidadePorUnidade
};
