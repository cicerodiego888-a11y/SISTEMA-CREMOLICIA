/**
 * UC-008 — ListarConsignacoesUseCase
 *
 * @class ListarConsignacoesUseCase
 */

const ConsignacaoReadUseCase = require('./ConsignacaoReadUseCase');
const {
  normalizarStatusIn,
  resolverPaginacaoHistorico,
  montarMetaPaginacao
} = require('../../services/historicoConsignacaoPaginacao');

class ListarConsignacoesUseCase extends ConsignacaoReadUseCase {
  async processar(entrada = {}) {
    const paginacao = resolverPaginacaoHistorico(entrada);
    const filtros = {
      clienteId: entrada.clienteId,
      status: entrada.status,
      statusIn: normalizarStatusIn(entrada.statusIn),
      documentoNumero: entrada.documentoNumero,
      busca: entrada.busca || entrada.q
    };
    if (paginacao.paginado) {
      filtros.limite = paginacao.limite;
      filtros.offset = paginacao.offset;
    }

    let consignacoes = await this._consignacaoRepository.listar(filtros);

    if (entrada.dataInicio || entrada.dataFim) {
      consignacoes = consignacoes.filter((c) => {
        if (!c.dataAbertura) return false;
        const data = new Date(c.dataAbertura).getTime();
        if (entrada.dataInicio && data < new Date(entrada.dataInicio).getTime()) return false;
        if (entrada.dataFim && data > new Date(entrada.dataFim).getTime()) return false;
        return true;
      });
    }

    let total = consignacoes.length;
    if (paginacao.paginado && typeof this._consignacaoRepository.contar === 'function') {
      total = await this._consignacaoRepository.contar({
        clienteId: filtros.clienteId,
        status: filtros.status,
        statusIn: filtros.statusIn,
        documentoNumero: filtros.documentoNumero,
        busca: filtros.busca
      });
    } else if (paginacao.paginado) {
      total = consignacoes.length;
      consignacoes = consignacoes.slice(paginacao.offset, paginacao.offset + paginacao.limite);
    }

    const meta = paginacao.paginado
      ? montarMetaPaginacao({
        total,
        page: paginacao.page,
        pageSize: paginacao.pageSize
      })
      : { total, page: 1, pageSize: consignacoes.length, hasMore: false };

    return {
      consignacoes,
      total: meta.total,
      page: meta.page,
      pageSize: meta.pageSize,
      hasMore: meta.hasMore,
      filtros: entrada
    };
  }
}

module.exports = ListarConsignacoesUseCase;
