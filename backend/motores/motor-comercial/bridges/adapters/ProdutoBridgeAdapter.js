/**
 * ProdutoBridgeAdapter — Implementa IProdutoBridge via plataforma CDS.
 *
 * Sprint O-13
 *
 * @module motores/motor-comercial/bridges/adapters/ProdutoBridgeAdapter
 */

const IProdutoBridge = require('../../domain/contracts/bridges/IProdutoBridge');

class ProdutoBridgeAdapter extends IProdutoBridge {
  /**
   * @param {Object} deps
   * @param {import('../platform/ProdutoPlatformGateway')} deps.platform
   */
  constructor(deps = {}) {
    super();
    this._platform = deps.platform;
  }

  /** @inheritdoc */
  async buscarPorId(produtoId, opts = {}) {
    return this._platform.buscarPorId(produtoId, opts);
  }

  /** @inheritdoc */
  async estaAtivo(produtoId) {
    return this._platform.estaAtivo(produtoId);
  }
}

module.exports = ProdutoBridgeAdapter;
