/**
 * UC-RC4.2 — DefinirRateioPerdaUseCase
 * Define quem assume financeiramente as perdas da prestação.
 */

const ConsignacaoWriteUseCase = require('./ConsignacaoWriteUseCase');
const { DocumentoInvalidoError } = require('../../domain/errors');
const {
  calcularRateio,
  validarRateio,
  buildResumoFinanceiroRateio,
  TIPOS_RATEIO
} = require('../../domain/RateioPerda');
const { garantirPrestacaoAberta, calcularTotaisPrestacao, listarMovimentacoesPrestacao } = require('./prestacaoOperacaoHelpers');
const { gerarCorrelationId } = require('./consignacaoUseCaseHelpers');
const { sincronizarCreditoComercial } = require('../../services/sincronizarCreditoComercial');

class DefinirRateioPerdaUseCase extends ConsignacaoWriteUseCase {
  constructor(deps = {}) {
    super(deps);
    this._rateioRepository = deps.rateioPerdaRepository || null;
  }

  async validar(entrada) {
    if (!entrada?.consignacaoId) {
      throw new DocumentoInvalidoError('consignacaoId é obrigatório');
    }
    if (!this._rateioRepository) {
      throw new DocumentoInvalidoError('rateioPerdaRepository não configurado');
    }
  }

  async processar(entrada) {
    const correlationId = entrada.correlationId ?? gerarCorrelationId();

    return this.executarEscrita(async (uow, eventos) => {
      const consignacao = await uow.consignacao.buscarPorId(entrada.consignacaoId);
      if (!consignacao) {
        throw new DocumentoInvalidoError('Consignação não encontrada');
      }
      const grupo = garantirPrestacaoAberta(consignacao);

      const movimentacoes = await listarMovimentacoesPrestacao(uow, grupo.id, consignacao.id);
      const totais = calcularTotaisPrestacao(movimentacoes, grupo.id);
      const valorTotalPerdas = Number(totais.totalPerdido || 0);

      const calculado = calcularRateio(
        entrada.tipoRateio || TIPOS_RATEIO.CLIENTE,
        valorTotalPerdas,
        {
          valorCliente: entrada.valorCliente,
          valorEmpresa: entrada.valorEmpresa,
          campoEditado: entrada.campoEditado || null
        }
      );

      const rateio = {
        ...calculado,
        motivoPerda: entrada.motivoPerda
          ? String(entrada.motivoPerda).toUpperCase()
          : null,
        observacaoPerda: entrada.observacaoPerda
          ? String(entrada.observacaoPerda).trim()
          : null
      };

      const validacao = validarRateio(rateio);
      if (!validacao.ok) {
        throw new DocumentoInvalidoError(validacao.erro);
      }

      const salvo = await this._rateioRepository.upsert({
        consignacaoId: consignacao.id,
        grupoPrestacaoContasId: grupo.id,
        ...rateio,
        usuarioId: entrada.usuarioId ?? null
      });

      await this._rateioRepository.registrarAuditoria({
        rateioId: salvo.id,
        consignacaoId: consignacao.id,
        grupoPrestacaoContasId: grupo.id,
        usuarioId: entrada.usuarioId ?? null,
        ...rateio,
        acao: 'DEFINIR'
      });

      await sincronizarCreditoComercial(uow, eventos, consignacao, {
        origem: 'RATEIO_PERDA',
        correlationId,
        usuarioId: entrada.usuarioId ?? null,
        perdaAssumidaCliente: rateio.valorCliente
      });

      const resumoFinanceiro = buildResumoFinanceiroRateio({
        valorVenda: totais.totalVendido,
        valorRecebido: totais.totalRecebido,
        valorPerdas: valorTotalPerdas,
        valorCliente: rateio.valorCliente,
        valorEmpresa: rateio.valorEmpresa
      });

      return {
        rateio: salvo,
        resumoFinanceiro,
        totais,
        correlationId
      };
    });
  }
}

module.exports = DefinirRateioPerdaUseCase;
