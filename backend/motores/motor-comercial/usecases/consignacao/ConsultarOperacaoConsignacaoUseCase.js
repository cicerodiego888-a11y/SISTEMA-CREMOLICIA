/**
 * UC-015 — ConsultarOperacaoConsignacaoUseCase
 *
 * @class ConsultarOperacaoConsignacaoUseCase
 */

const ConsignacaoReadUseCase = require('./ConsignacaoReadUseCase');
const { DocumentoInvalidoError } = require('../../domain/errors');
const { derivarCamposCacheConsignacao } = require('../../services/projections/ledgerCacheDerivation');

class ConsultarOperacaoConsignacaoUseCase extends ConsignacaoReadUseCase {
  constructor(deps = {}) {
    super(deps);
    this._movimentacaoComercialRepository = deps.movimentacaoComercialRepository ?? null;
  }

  async validar(entrada) {
    if (!entrada?.consignacaoId) {
      throw new DocumentoInvalidoError('consignacaoId é obrigatório');
    }
  }

  async processar(entrada) {
    const consignacao = await this._obterConsignacaoOuFalhar(entrada.consignacaoId, entrada.clienteId);

    let ultimaMovimentacao = null;
    let cacheDerivado = null;
    if (this._movimentacaoComercialRepository) {
      const movimentacoes = await this._movimentacaoComercialRepository.listar({
        consignacaoId: consignacao.id
      });
      ultimaMovimentacao = movimentacoes.length
        ? movimentacoes[movimentacoes.length - 1]
        : null;
      if (movimentacoes.length) {
        cacheDerivado = derivarCamposCacheConsignacao(movimentacoes);
      }
    }

    return {
      consignacaoId: consignacao.id,
      status: consignacao.status,
      documento: consignacao.documento,
      dataAbertura: consignacao.dataAbertura,
      dataEntrega: consignacao.dataEntrega,
      dataEncerramento: consignacao.dataEncerramento,
      valorTotalEntregue: cacheDerivado?.valorTotalEntregue ?? consignacao.valorTotalEntregue,
      saldoAberto: cacheDerivado?.saldoAberto ?? consignacao.saldoAberto,
      ultimaMovimentacao
    };
  }
}

module.exports = ConsultarOperacaoConsignacaoUseCase;
