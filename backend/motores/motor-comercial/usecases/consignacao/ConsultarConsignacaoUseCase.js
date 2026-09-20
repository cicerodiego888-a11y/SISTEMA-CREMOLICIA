/**
 * UC-007 — ConsultarConsignacaoUseCase
 *
 * @class ConsultarConsignacaoUseCase
 */

const ConsignacaoReadUseCase = require('./ConsignacaoReadUseCase');
const { DocumentoInvalidoError } = require('../../domain/errors');

class ConsultarConsignacaoUseCase extends ConsignacaoReadUseCase {
  async validar(entrada) {
    if (!entrada?.consignacaoId) {
      throw new DocumentoInvalidoError('consignacaoId é obrigatório');
    }
  }

  async processar(entrada) {
    return this._obterConsignacaoOuFalhar(entrada.consignacaoId, entrada.clienteId);
  }
}

module.exports = ConsultarConsignacaoUseCase;
