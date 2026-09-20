/**
 * UC-027 — ConsultarResumoPrestacaoUseCase
 *
 * RCM-8.11 — resumo do ciclo (grupo), não só da consignação da URL.
 *
 * @class ConsultarResumoPrestacaoUseCase
 */

const ConsignacaoReadUseCase = require('./ConsignacaoReadUseCase');
const { DocumentoInvalidoError, PrestacaoNaoAbertaError } = require('../../domain/errors');
const { calcularTotaisPrestacao } = require('./prestacaoOperacaoHelpers');
const {
  listarConsignacoesDoGrupoPrestacao,
  listarItensDasConsignacoesDoGrupo
} = require('./prestacaoCicloClienteHelpers');

class ConsultarResumoPrestacaoUseCase extends ConsignacaoReadUseCase {
  constructor(deps = {}) {
    super(deps);
    this._movimentacaoComercialRepository = deps.movimentacaoComercialRepository ?? null;
    this._consignacaoItemRepository = deps.consignacaoItemRepository ?? null;
  }

  async validar(entrada) {
    if (!entrada?.consignacaoId) {
      throw new DocumentoInvalidoError('consignacaoId é obrigatório');
    }
    if (!this._movimentacaoComercialRepository) {
      throw new DocumentoInvalidoError('IMovimentacaoComercialRepository não configurado');
    }
  }

  async processar(entrada) {
    const consignacao = await this._obterConsignacaoOuFalhar(entrada.consignacaoId);
    const prestacao = consignacao.prestacaoContasAtiva;

    if (!prestacao) {
      throw new PrestacaoNaoAbertaError(consignacao.id);
    }

    const grupoId = entrada.grupoPrestacaoContasId ?? prestacao.id;
    const movimentacoes = await this._movimentacaoComercialRepository.listar({
      grupoPrestacaoContasId: grupoId
    });

    const resumo = calcularTotaisPrestacao(movimentacoes, grupoId);

    const uowLike = {
      consignacao: this._consignacaoRepository,
      consignacaoItem: this._consignacaoItemRepository
    };
    const consignacoesDoGrupo = this._consignacaoRepository
      ? await listarConsignacoesDoGrupoPrestacao(uowLike, grupoId)
      : [consignacao];

    let itens = [];
    if (this._consignacaoItemRepository) {
      itens = await listarItensDasConsignacoesDoGrupo(uowLike, grupoId);
    }

    const saldoItens = itens.reduce((sum, item) => {
      const entregue = Number(item.quantidadeEntregue || 0);
      const devolvido = Number(item.quantidadeDevolvida || 0);
      const vendido = Number(item.quantidadeVendida || 0);
      const perdido = Number(item.quantidadePerdida || 0);
      const cortesia = Number(item.quantidadeCortesia || 0);
      return sum + (entregue - devolvido - vendido - perdido - cortesia);
    }, 0);

    return {
      consignacaoId: consignacao.id,
      clienteId: consignacao.clienteId,
      grupoPrestacaoContasId: grupoId,
      statusConsignacao: consignacao.status,
      prestacaoStatus: prestacao.id === grupoId ? prestacao.status : null,
      quantidadeConsignacoes: consignacoesDoGrupo.length,
      consignacoes: consignacoesDoGrupo.map((c) => ({
        id: c.id,
        documento: c.documento,
        status: c.status
      })),
      itens,
      resumo: {
        totalVendido: resumo.totalVendido,
        totalDevolvido: resumo.totalDevolvido,
        totalPerdido: resumo.totalPerdido,
        totalCortesia: resumo.totalCortesia,
        totalRecebido: resumo.totalRecebido,
        saldo: resumo.saldo,
        saldoItens
      },
      derivadoDoLedger: true,
      quantidadeMovimentacoes: resumo.quantidadeMovimentacoes,
      consolidado: consignacoesDoGrupo.length > 1
    };
  }
}

module.exports = ConsultarResumoPrestacaoUseCase;
