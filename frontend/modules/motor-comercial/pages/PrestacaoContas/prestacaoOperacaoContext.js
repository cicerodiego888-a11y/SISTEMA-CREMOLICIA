/**
 * RCM-8.6 — Contexto imutável da operação aberta na Prestação de Contas.
 *
 * Isola cliente/consignação/prestação e versiona cada ciclo de vida da tela
 * para que respostas/timers de outra operação nunca atualizem a UI atual.
 *
 * @module frontend/modules/motor-comercial/pages/PrestacaoContas/prestacaoOperacaoContext
 */

function _strOrNull(value) {
  if (value == null || value === '') return null;
  return String(value);
}

/**
 * @param {Object} dados
 * @param {string|number|null} [dados.clienteId]
 * @param {string|number|null} dados.consignacaoId
 * @param {string|number|null} [dados.prestacaoId]
 * @param {number} [dados.contextVersion=1]
 * @returns {{ clienteId: string|null, consignacaoId: string|null, prestacaoId: string|null, contextVersion: number }}
 */
function createOperacaoContext(dados = {}) {
  return Object.freeze({
    clienteId: _strOrNull(dados.clienteId),
    consignacaoId: _strOrNull(dados.consignacaoId),
    prestacaoId: _strOrNull(dados.prestacaoId),
    contextVersion: Number(dados.contextVersion) > 0 ? Number(dados.contextVersion) : 1
  });
}

/**
 * Snapshot leve anexado a cada requisição assíncrona.
 * @param {Object} contexto
 * @returns {Object}
 */
function captureContextToken(contexto) {
  if (!contexto) return null;
  return {
    clienteId: contexto.clienteId,
    consignacaoId: contexto.consignacaoId,
    prestacaoId: contexto.prestacaoId,
    contextVersion: contexto.contextVersion
  };
}

/**
 * True somente se o token ainda representa a operação aberta.
 * Preenchimento posterior de clienteId/prestacaoId (null → valor) na MESMA
 * consignação/versão NÃO invalida — evita spinner eterno no Continuar Atendimento.
 *
 * @param {Object|null} token
 * @param {Object|null} atual
 * @param {{ disposed?: boolean }} [opts]
 * @returns {boolean}
 */
function isContextCurrent(token, atual, opts = {}) {
  if (opts.disposed) return false;
  if (!token || !atual) return false;
  if (Number(token.contextVersion) !== Number(atual.contextVersion)) return false;
  if (String(token.consignacaoId || '') !== String(atual.consignacaoId || '')) return false;

  // Só rejeita divergência quando AMBOS os lados já conhecem o id
  if (token.clienteId != null && atual.clienteId != null) {
    if (String(token.clienteId) !== String(atual.clienteId)) return false;
  }
  if (token.prestacaoId != null && atual.prestacaoId != null) {
    if (String(token.prestacaoId) !== String(atual.prestacaoId)) return false;
  }
  return true;
}

/**
 * Incrementa a versão, invalidando tokens anteriores.
 * @param {Object} contexto
 * @param {Object} [patch]
 * @returns {Object}
 */
function bumpOperacaoContext(contexto, patch = {}) {
  const base = contexto || {};
  return createOperacaoContext({
    clienteId: patch.clienteId !== undefined ? patch.clienteId : base.clienteId,
    consignacaoId: patch.consignacaoId !== undefined ? patch.consignacaoId : base.consignacaoId,
    prestacaoId: patch.prestacaoId !== undefined ? patch.prestacaoId : base.prestacaoId,
    contextVersion: Number(base.contextVersion || 0) + 1
  });
}

/**
 * Atualiza ids sem invalidar (ex.: prestacaoId conhecido após abrir).
 * Mantém a mesma contextVersion.
 * @param {Object} contexto
 * @param {Object} patch
 * @returns {Object}
 */
function patchOperacaoContext(contexto, patch = {}) {
  const base = contexto || {};
  return createOperacaoContext({
    clienteId: patch.clienteId !== undefined ? patch.clienteId : base.clienteId,
    consignacaoId: patch.consignacaoId !== undefined ? patch.consignacaoId : base.consignacaoId,
    prestacaoId: patch.prestacaoId !== undefined ? patch.prestacaoId : base.prestacaoId,
    contextVersion: base.contextVersion || 1
  });
}

module.exports = {
  createOperacaoContext,
  captureContextToken,
  isContextCurrent,
  bumpOperacaoContext,
  patchOperacaoContext
};
