/**
 * ResultHttpMapper — Converte resultados de UseCase em respostas HTTP (versão corporativa).
 *
 * Sprint 2.5.5: Hardening da API — mapeamento de resultados.
 *
 * @module backend/shared/http/mappers/ResultHttpMapper
 */

const StandardResponse = require('../responses/StandardResponse');
const DomainErrorMapper = require('./DomainErrorMapper');

class ResultHttpMapper {
  /**
   * @param {Object} result
   * @returns {boolean}
   */
  static _isFailure(result) {
    if (typeof result.isFail === 'function') return result.isFail();
    if (result.sucesso === false || result.success === false) return true;
    return false;
  }

  /**
   * @param {Object} result
   * @returns {Error|Object|null}
   */
  static _extractError(result) {
    return result.erro || result.error || null;
  }

  /**
   * @param {Object} result
   * @returns {*}
   */
  static _extractData(result) {
    if (typeof result.isOk === 'function' && result.isOk()) {
      return result.dados ?? null;
    }
    if (result.sucesso === true) {
      return result.dados ?? null;
    }
    return result.data ?? result.dados ?? result;
  }

  /**
   * Converte um resultado de UseCase em resposta HTTP.
   * @param {Object} result - Resultado do UseCase
   * @returns {Object}
   */
  static map(result) {
    if (!result) {
      return StandardResponse.internalError('Resultado não fornecido');
    }

    if (this._isFailure(result)) {
      const erro = this._extractError(result);
      if (erro) {
        return DomainErrorMapper.map(erro instanceof Error ? erro : new Error(String(erro)));
      }
      return StandardResponse.error('ERROR', 'Operação falhou');
    }

    return StandardResponse.success(
      this._extractData(result),
      result.metadata || null,
      result.statusCode || 200
    );
  }

  /**
   * Converte resultado de criação (retorna 201).
   * @param {Object} result - Resultado do UseCase
   * @returns {Object}
   */
  static mapCreated(result) {
    const response = this.map(result);
    // Falhas mantêm o status do DomainErrorMapper — nunca forçar 201 em erro
    if (!this._isFailure(result) && response.success !== false) {
      response._statusCode = 201;
    }
    return response;
  }

  /**
   * Converte resultado sem conteúdo (retorna 204).
   * @returns {Object}
   */
  static mapNoContent() {
    return StandardResponse.success(null, null, 204);
  }

  /**
   * Converte resultado de lista com paginação.
   * @param {Object} result - Resultado do UseCase
   * @returns {Object}
   */
  static mapPaginated(result) {
    if (!result) {
      return StandardResponse.internalError('Resultado não fornecido');
    }

    if (this._isFailure(result)) {
      return this.map(result);
    }

    const dados = this._extractData(result);
    const items = Array.isArray(dados) ? dados : (dados?.items || []);

    return StandardResponse.success(
      items,
      {
        total: result.total || dados?.total || items.length,
        pagina: result.pagina || dados?.pagina || 1,
        tamanhoPagina: result.tamanhoPagina || dados?.tamanhoPagina || 10,
        totalPaginas: result.totalPaginas || dados?.totalPaginas || 1
      },
      200
    );
  }
}

module.exports = ResultHttpMapper;
