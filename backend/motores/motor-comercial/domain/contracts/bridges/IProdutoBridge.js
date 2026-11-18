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

  /** Motivo que impede nova operação com o produto; null quando liberado. @returns {Promise<string|null>} */
  async motivoBloqueioComercial(_produtoId) {
    return null;
  }
}

module.exports = IProdutoBridge;
