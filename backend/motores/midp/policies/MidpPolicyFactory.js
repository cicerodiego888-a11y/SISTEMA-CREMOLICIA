/**
 * MidpPolicyFactory — Único ponto de seleção de política MIDP (3.8D.3.2).
 *
 * Seleção oficial: apenas midp_ativado (ligado/desligado).
 * - midp_ativado = true  → PRESERVAR_DINHEIRO (algoritmo homologado)
 * - midp_ativado = false → LEGADO (fluxo anterior)
 *
 * midp_politica permanece legível só por compatibilidade com bancos antigos;
 * não seleciona mais a política em runtime.
 *
 * Proibido: if (politica == ...) espalhados pelo sistema.
 * Override `politica` permanece apenas para testes.
 *
 * @module motores/midp/policies/MidpPolicyFactory
 */

const configService = require('../../../services/configuracaoService');
const LegacyDistributionPolicy = require('./LegacyDistributionPolicy');
const PreservarDinheiroPolicy = require('./PreservarDinheiroPolicy');

const POLITICA_LEGADO = 'LEGADO';
const POLITICA_PRESERVAR_DINHEIRO = 'PRESERVAR_DINHEIRO';

const POLITICAS_PERMITIDAS = Object.freeze([
  POLITICA_LEGADO,
  POLITICA_PRESERVAR_DINHEIRO
]);

/** @type {Record<string, function(): import('./IMidpPolicy')>} */
const REGISTRO = Object.freeze({
  [POLITICA_LEGADO]: () => new LegacyDistributionPolicy(),
  [POLITICA_PRESERVAR_DINHEIRO]: () => new PreservarDinheiroPolicy()
});

/**
 * @param {unknown} valor
 * @returns {'LEGADO'|'PRESERVAR_DINHEIRO'}
 */
function normalizePolitica(valor) {
  const nome = String(valor || POLITICA_LEGADO).toUpperCase().trim();
  if (nome === POLITICA_PRESERVAR_DINHEIRO) {
    return POLITICA_PRESERVAR_DINHEIRO;
  }
  return POLITICA_LEGADO;
}

/**
 * @param {object} [opcoes]
 * @returns {boolean}
 */
function resolverMidpAtivado(opcoes = {}) {
  if (typeof opcoes.midpAtivado === 'boolean') {
    return opcoes.midpAtivado;
  }
  if (typeof configService.isMidpAtivado === 'function') {
    return configService.isMidpAtivado() === true;
  }
  const cfg = configService.readConfig();
  return cfg.midp_ativado === true;
}

/**
 * Resolve o nome da política: midp_ativado (produção) ou override de testes.
 *
 * @param {object} [opcoes]
 * @param {string} [opcoes.politica] — override (testes)
 * @param {boolean} [opcoes.midpAtivado]
 * @returns {'LEGADO'|'PRESERVAR_DINHEIRO'}
 */
function resolverNomePolitica(opcoes = {}) {
  if (opcoes.politica !== undefined && opcoes.politica !== null) {
    return normalizePolitica(opcoes.politica);
  }

  return resolverMidpAtivado(opcoes)
    ? POLITICA_PRESERVAR_DINHEIRO
    : POLITICA_LEGADO;
}

/**
 * Obtém a instância da política oficial ativa.
 *
 * @param {object} [opcoes]
 * @param {string} [opcoes.politica] — override para testes
 * @param {boolean} [opcoes.midpAtivado]
 * @returns {import('./IMidpPolicy')}
 */
function obterPolitica(opcoes = {}) {
  const nome = resolverNomePolitica(opcoes);
  const criar = REGISTRO[nome] || REGISTRO[POLITICA_LEGADO];
  return criar();
}

module.exports = {
  obterPolitica,
  resolverNomePolitica,
  normalizePolitica,
  POLITICAS_PERMITIDAS,
  POLITICA_LEGADO,
  POLITICA_PRESERVAR_DINHEIRO
};
