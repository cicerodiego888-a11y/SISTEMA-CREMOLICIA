/**
 * UC-RC4.2 — ConsultarRateioPerdaUseCase (leitura)
 */

const {
  calcularRateio,
  buildResumoFinanceiroRateio,
  TIPOS_RATEIO,
  MOTIVOS_PERDA,
  MOTIVO_LABEL
} = require('../../domain/RateioPerda');
const { DocumentoInvalidoError } = require('../../domain/errors');

class ConsultarRateioPerdaUseCase {
  constructor(deps = {}) {
    this._consignacaoRepository = deps.consignacaoRepository;
    this._movimentacaoRepository = deps.movimentacaoComercialRepository;
    this._rateioRepository = deps.rateioPerdaRepository;
  }

  async executar(entrada = {}) {
    const consignacaoId = Number(entrada.consignacaoId);
    if (!Number.isFinite(consignacaoId) || consignacaoId <= 0) {
      throw new DocumentoInvalidoError('consignacaoId é obrigatório');
    }

    const consignacao = await this._consignacaoRepository.buscarPorId(consignacaoId);
    if (!consignacao) {
      throw new DocumentoInvalidoError('Consignação não encontrada');
    }

    const grupo = consignacao.prestacaoContasAtiva;
    const grupoId = grupo?.id || null;

    const { calcularTotaisPrestacao } = require('./prestacaoOperacaoHelpers');
    const movs = await this._movimentacaoRepository.listar({ consignacaoId });
    const totais = calcularTotaisPrestacao(movs, grupoId);
    const valorTotalPerdas = Number(totais.totalPerdido || 0);

    let rateio = grupoId
      ? await this._rateioRepository.buscarPorGrupo(grupoId)
      : await this._rateioRepository.buscarPorConsignacao(consignacaoId);

    if (!rateio && valorTotalPerdas > 0) {
      // Default compatível com UI: Cliente assume 100% (sugerido, ainda não persistido)
      const sugestao = calcularRateio(TIPOS_RATEIO.CLIENTE, valorTotalPerdas);
      rateio = {
        ...sugestao,
        motivoPerda: null,
        observacaoPerda: null,
        persistido: false
      };
    } else if (rateio) {
      // Recalcula percentuais com total atual de perdas (qtd pode ter mudado)
      const recalc = calcularRateio(rateio.tipoRateio, valorTotalPerdas, {
        valorCliente: rateio.tipoRateio === TIPOS_RATEIO.COMPARTILHADA
          ? rateio.valorCliente
          : undefined,
        valorEmpresa: rateio.tipoRateio === TIPOS_RATEIO.COMPARTILHADA
          ? rateio.valorEmpresa
          : undefined
      });
      if (rateio.tipoRateio !== TIPOS_RATEIO.COMPARTILHADA) {
        rateio = { ...rateio, ...recalc, persistido: true };
      } else {
        // Mantém valores salvos se totais batem; se total mudou, rebalanceia mantendo proporção
        const totSalvo = Number(rateio.valorTotalPerdas || 0);
        if (Math.abs(totSalvo - valorTotalPerdas) > 0.01 && totSalvo > 0.01) {
          const ratio = rateio.valorCliente / totSalvo;
          rateio = {
            ...rateio,
            ...calcularRateio(TIPOS_RATEIO.COMPARTILHADA, valorTotalPerdas, {
              valorCliente: valorTotalPerdas * ratio,
              campoEditado: 'cliente'
            }),
            persistido: true
          };
        } else {
          rateio = { ...rateio, valorTotalPerdas, persistido: true };
        }
      }
    } else {
      rateio = {
        ...calcularRateio(TIPOS_RATEIO.EMPRESA, 0),
        motivoPerda: null,
        observacaoPerda: null,
        persistido: false
      };
    }

    const resumoFinanceiro = buildResumoFinanceiroRateio({
      valorVenda: totais.totalVendido,
      valorRecebido: totais.totalRecebido,
      valorPerdas: valorTotalPerdas,
      valorCliente: rateio.valorCliente,
      valorEmpresa: rateio.valorEmpresa
    });

    const auditoria = await this._rateioRepository.listarAuditoria(consignacaoId, { limite: 20 });

    return {
      rateio,
      resumoFinanceiro,
      totais: {
        totalVendido: totais.totalVendido,
        totalRecebido: totais.totalRecebido,
        totalPerdido: valorTotalPerdas
      },
      motivos: MOTIVOS_PERDA.map((m) => ({ codigo: m, label: MOTIVO_LABEL[m] || m })),
      auditoria
    };
  }
}

module.exports = ConsultarRateioPerdaUseCase;
