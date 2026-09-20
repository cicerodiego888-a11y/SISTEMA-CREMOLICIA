/**
 * ResumoPrestacaoProjectionService — Reconstrói resumo da prestação pelo Ledger.
 *
 * RCM-8.11 — escopo = grupoPrestacaoContasId (ciclo do cliente).
 *
 * @class ResumoPrestacaoProjectionService
 */

const BaseProjectionService = require('./BaseProjectionService');
const ResumoPrestacaoDTO = require('../../dto/ResumoPrestacaoDTO');
const { DocumentoInvalidoError, ConsignacaoNaoEncontradaError } = require('../../domain/errors');
const { calcularTotaisPrestacao } = require('./projectionHelpers');

class ResumoPrestacaoProjectionService extends BaseProjectionService {
  constructor(deps = {}) {
    super(deps);
    this._consignacaoItemRepository = deps.consignacaoItemRepository ?? null;
  }

  async validar(contexto) {
    if (contexto.consignacaoId == null) {
      throw new DocumentoInvalidoError('consignacaoId é obrigatório para Resumo da Prestação');
    }
    if (!this._movimentacaoComercialRepository) {
      throw new DocumentoInvalidoError('IMovimentacaoComercialRepository não configurado');
    }
  }

  async consultar(contexto) {
    const consignacao = this._consignacaoRepository
      ? await this._consignacaoRepository.buscarPorId(contexto.consignacaoId)
      : null;

    const grupoId = contexto.grupoPrestacaoContasId
      ?? consignacao?.prestacaoContasAtiva?.id
      ?? null;

    // RCM-8.11 — movimentos do ciclo; se sem grupo, fallback consignação
    const filtros = grupoId
      ? { grupoPrestacaoContasId: grupoId }
      : { consignacaoId: contexto.consignacaoId };

    const movimentacoes = await this._movimentacaoComercialRepository.listar(filtros);
    return { movimentacoes, consignacao, grupoId };
  }

  async projetar({ movimentacoes, consignacao, grupoId }, contexto) {
    if (!consignacao) {
      throw new ConsignacaoNaoEncontradaError(contexto.consignacaoId);
    }

    const gid = grupoId
      ?? contexto.grupoPrestacaoContasId
      ?? consignacao.prestacaoContasAtiva?.id
      ?? null;

    const totais = calcularTotaisPrestacao(movimentacoes, gid);
    const grupo = consignacao.prestacaoContasAtiva;

    const {
      listarConsignacoesDoGrupoPrestacao,
      listarItensDasConsignacoesDoGrupo
    } = require('../../usecases/consignacao/prestacaoCicloClienteHelpers');

    const uowLike = {
      consignacao: this._consignacaoRepository,
      consignacaoItem: this._consignacaoItemRepository
    };

    let consignacoesDoGrupo = [consignacao];
    let itens = [];

    if (gid && this._consignacaoRepository?.listar) {
      consignacoesDoGrupo = await listarConsignacoesDoGrupoPrestacao(uowLike, gid);
      if (!consignacoesDoGrupo.length) consignacoesDoGrupo = [consignacao];
    }

    if (gid && this._consignacaoItemRepository?.listarPorConsignacao) {
      itens = await listarItensDasConsignacoesDoGrupo(uowLike, gid);
    } else if (this._consignacaoItemRepository?.listarPorConsignacao) {
      itens = await this._consignacaoItemRepository.listarPorConsignacao(consignacao.id);
      itens = (itens || []).map((i) => ({ ...i, consignacaoId: consignacao.id }));
    }

    const dto = ResumoPrestacaoDTO.create({
      consignacaoId: consignacao.id,
      grupoPrestacaoContasId: gid,
      documento: grupo?.documento ?? consignacao.documento,
      grupoPrestacaoContas: grupo,
      totalVendido: totais.totalVendido,
      totalDevolvido: totais.totalDevolvido,
      totalPerdido: totais.totalPerdido,
      totalCortesia: totais.totalCortesia,
      totalPago: totais.totalRecebido,
      saldo: totais.saldo
    });

    return {
      dados: {
        ...dto.toJSON(),
        quantidadeConsignacoes: consignacoesDoGrupo.length,
        consignacoes: consignacoesDoGrupo.map((c) => ({
          id: c.id,
          documento: c.documento,
          status: c.status
        })),
        itens,
        consolidado: consignacoesDoGrupo.length > 1,
        origemAbertura: consignacoesDoGrupo[0]
          ? {
            consignacaoId: consignacoesDoGrupo.slice().sort((a, b) => Number(a.id) - Number(b.id))[0].id,
            documento: consignacoesDoGrupo.slice().sort((a, b) => Number(a.id) - Number(b.id))[0].documento
          }
          : null
      },
      totais
    };
  }
}

module.exports = ResumoPrestacaoProjectionService;
