/**
 * EAN13Service — geração e validação de EAN-13 para produtos.codigo_barras.
 * Prefixo interno inicial: 789 (estrutura válida, sem atribuição GS1).
 */

const crypto = require('crypto');

const PREFIXO = '789';
const MSG_INVALIDO = 'Código de barras EAN-13 inválido.';
const MSG_DUPLICADO = 'Este código de barras já está cadastrado em outro produto.';

function stripSpaces(valor) {
  return String(valor == null ? '' : valor).replace(/\s+/g, '');
}

function calculateCheckDigit(dozeDigitos) {
  const d = String(dozeDigitos);
  if (!/^\d{12}$/.test(d)) {
    throw new Error('A base EAN-13 deve ter 12 dígitos numéricos.');
  }
  let impares = 0;
  let pares = 0;
  for (let i = 0; i < 12; i += 1) {
    const n = Number(d[i]);
    if ((i + 1) % 2 === 1) impares += n;
    else pares += n;
  }
  const soma = impares + pares * 3;
  return (10 - (soma % 10)) % 10;
}

function generate(prefixo = PREFIXO) {
  const prefixoLimpo = String(prefixo || PREFIXO).replace(/\D/g, '') || PREFIXO;
  const tamanhoResto = Math.max(0, 12 - prefixoLimpo.length);
  let resto = '';
  for (let i = 0; i < tamanhoResto; i += 1) {
    resto += String(crypto.randomInt(0, 10));
  }
  const doze = (prefixoLimpo + resto).slice(0, 12).padEnd(12, '0');
  return doze + String(calculateCheckDigit(doze));
}

function validate(codigo) {
  const limpo = stripSpaces(codigo);
  if (!/^\d{13}$/.test(limpo)) return false;
  const dv = calculateCheckDigit(limpo.slice(0, 12));
  return dv === Number(limpo[12]);
}

function exists(db, codigo, excludeId) {
  const limpo = stripSpaces(codigo);
  if (!limpo || !db) return Promise.resolve(false);

  return new Promise((resolve, reject) => {
    const params = [limpo];
    let sql = `
      SELECT id FROM produtos
       WHERE TRIM(COALESCE(codigo_barras, '')) = ?
    `;
    const idExcluir = Number(excludeId);
    if (Number.isFinite(idExcluir) && idExcluir > 0) {
      sql += ' AND id != ?';
      params.push(idExcluir);
    }
    sql += ' LIMIT 1';
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(Boolean(row && row.id));
    });
  });
}

async function generateUnique(db, opcoes = {}) {
  const prefixo = opcoes.prefixo || PREFIXO;
  const excludeId = opcoes.excludeId || null;
  const maxAttempts = Number(opcoes.maxAttempts) > 0 ? Number(opcoes.maxAttempts) : 80;
  const existsFn = typeof opcoes.exists === 'function'
    ? opcoes.exists
    : (code, ex) => exists(db, code, ex);

  for (let i = 0; i < maxAttempts; i += 1) {
    const codigo = generate(prefixo);
    const duplicado = await existsFn(codigo, excludeId);
    if (!duplicado) return codigo;
  }
  throw new Error('Não foi possível gerar um código de barras disponível.');
}

function erroValidacao(mensagem, statusCode) {
  const err = new Error(mensagem);
  err.statusCode = statusCode;
  return err;
}

async function validarParaPersistencia(valor, opcoes = {}) {
  const limpo = stripSpaces(valor);
  const atual = stripSpaces(opcoes.codigoAtual);

  if (!limpo) return '';

  const inalterado = Boolean(atual) && limpo === atual;
  if (inalterado && !validate(limpo)) {
    return String(opcoes.codigoAtual).trim();
  }

  if (!validate(limpo)) {
    throw erroValidacao(MSG_INVALIDO, 400);
  }

  if (typeof opcoes.exists === 'function') {
    const duplicado = await opcoes.exists(limpo, opcoes.produtoId || null);
    if (duplicado) throw erroValidacao(MSG_DUPLICADO, 409);
  }

  return limpo;
}

module.exports = {
  PREFIXO,
  MSG_INVALIDO,
  MSG_DUPLICADO,
  stripSpaces,
  calculateCheckDigit,
  generate,
  validate,
  exists,
  generateUnique,
  validarParaPersistencia
};
