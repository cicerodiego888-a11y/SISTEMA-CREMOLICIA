/**
 * IProdutoBridge — Contrato de integração com Produtos.
 *
 * @abstract
 * @class IProdutoBridge
 */

class IProdutoBridge {
  constructor() {
    if (new.target === IProdutoBridge) {
      throw new Error('IProdutoBridge é abstrata e não pode ser instanciada diretamente');
    }
  }

  /** @abstract @returns {Promise<Object|null>} */
  async buscarPorId(_produtoId, _opts = {}) {
    throw new Error(`${this.constructor.name} deve implementar buscarPorId()`);
  }

  /** @abstract @returns {Promise<boolean>} */
  async estaAtivo(_produtoId) {
    throw new Error(`${this.constructor.name} deve implementar estaAtivo()`);
  }
}

module.exports = IProdutoBridge;
