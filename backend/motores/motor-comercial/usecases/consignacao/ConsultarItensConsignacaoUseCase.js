/**
 * UC-009 — ConsultarItensConsignacaoUseCase
 *
 * @class ConsultarItensConsignacaoUseCase
 */

const ConsignacaoReadUseCase = require('./ConsignacaoReadUseCase');
const { DocumentoInvalidoError } = require('../../domain/errors');

class ConsultarItensConsignacaoUseCase extends ConsignacaoReadUseCase {
  async validar(entrada) {
    if (!entrada?.consignacaoId) {
      throw new DocumentoInvalidoError('consignacaoId é obrigatório');
    }
  }

  async processar(entrada) {
    await this._obterConsignacaoOuFalhar(entrada.consignacaoId, entrada.clienteId);

    const itens = await this._consignacaoItemRepository.listarPorConsignacao(
      entrada.consignacaoId,
      {
        produtoId: entrada.produtoId,
        limite: entrada.limite,
        offset: entrada.offset
      }
    );

    return {
      consignacaoId: entrada.consignacaoId,
      itens,
      total: itens.length
    };
  }
}

module.exports = ConsultarItensConsignacaoUseCase;
