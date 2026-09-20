/**
 * UC-026 — ConsultarPrestacaoUseCase
 *
 * RCM-8.11 — escopo oficial = grupoPrestacaoContasId (ciclo do cliente).
 *
 * @class ConsultarPrestacaoUseCase
 */

const ConsignacaoReadUseCase = require('./ConsignacaoReadUseCase');
const { DocumentoInvalidoError, PrestacaoNaoAbertaError } = require('../../domain/errors');
const { calcularTotaisPrestacao } = require('./prestacaoOperacaoHelpers');
const { prestacaoEstaAberta } = require('./consignacaoOperacaoHelpers');
const {
  listarConsignacoesDoGrupoPrestacao,
  listarItensDasConsignacoesDoGrupo,
  reconciliarConsignacaoComGrupoAbertoCliente
} = require('./prestacaoCicloClienteHelpers');

class ConsultarPrestacaoUseCase extends ConsignacaoReadUseCase {
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
    let consignacao = await this._obterConsignacaoOuFalhar(entrada.consignacaoId);

    // RCM-8.11 — tentar reconciliar legado elegível (ponteiro only)
    if (!prestacaoEstaAberta(consignacao) && this._consignacaoRepository) {
      const uowLike = {
        consignacao: this._consignacaoRepository,
        consignacaoItem: this._consignacaoItemRepository
      };
      const rec = await reconciliarConsignacaoComGrupoAbertoCliente(uowLike, consignacao);
      if (rec.reconciliada) consignacao = rec.consignacao;
    }

    const prestacao = consignacao.prestacaoContasAtiva;

    if (!prestacao || (!prestacaoEstaAberta(consignacao) && prestacao.status !== 'FECHADA')) {
      throw new PrestacaoNaoAbertaError(consignacao.id);
    }

    const grupoId = prestacao.id;
    const movimentacoes = await this._movimentacaoComercialRepository.listar({
      grupoPrestacaoContasId: grupoId
    });

    const totais = calcularTotaisPrestacao(movimentacoes, grupoId);

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

    return {
      consignacaoId: consignacao.id,
      clienteId: consignacao.clienteId,
      status: consignacao.status,
      prestacaoStatus: prestacao.status,
      documento: prestacao.documento ?? consignacao.documento,
      grupoPrestacaoContas: prestacao,
      consignacoes: consignacoesDoGrupo.map((c) => ({
        id: c.id,
        documento: c.documento,
        status: c.status,
        valorTotalEntregue: c.valorTotalEntregue,
        saldoAberto: c.saldoAberto
      })),
      quantidadeConsignacoes: consignacoesDoGrupo.length,
      itens,
      movimentacoes,
      totais,
      consolidado: consignacoesDoGrupo.length > 1
    };
  }
}

module.exports = ConsultarPrestacaoUseCase;
