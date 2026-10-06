/**
 * Pasta de dados (DB_DIR) da CDS Cremolícia.
 *
 * Padrão: C:\ProgramData\MercantilFiscal\dados. A variável DB_DIR substitui o
 * padrão (testes e bancos de homologação isolados).
 */

'use strict';

const path = require('path');

function programData(env = process.env) {
  return env.PROGRAMDATA || 'C:\\ProgramData';
}

function dirPadraoCremolicia(env = process.env) {
  return path.join(programData(env), 'MercantilFiscal', 'dados');
}

function normalizarDir(dir) {
  return path.resolve(String(dir || '')).replace(/[\\/]+$/, '').toLowerCase();
}

function mesmoDiretorio(a, b) {
  return normalizarDir(a) === normalizarDir(b);
}

function resolverDbDir(env = process.env) {
  const informado = String(env.DB_DIR || '').trim();
  return informado || dirPadraoCremolicia(env);
}

module.exports = {
  dirPadraoCremolicia,
  mesmoDiretorio,
  resolverDbDir
};
