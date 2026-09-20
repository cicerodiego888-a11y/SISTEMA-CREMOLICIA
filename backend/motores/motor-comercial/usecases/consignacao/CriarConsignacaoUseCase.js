/**
 * UC-001 — CriarConsignacaoUseCase
 *
 * RCM-8.12 — cria apenas RASCUNHO. O vínculo ao ciclo de Prestação ABERTA do cliente
 * ocorre na ENTREGA (RegistrarEntregaConsignacaoUseCase → resolverCicloPrestacaoParaEntrega).
 * Não criar/vincular prestacaoContasAtiva aqui.
 *
 * @class CriarConsignacaoUseCase
 */

const ConsignacaoWriteUseCase = require('./ConsignacaoWriteUseCase');
const { EVENTOS_DOMINIO } = require('../../events/comercialEventosTipos');
const {
  ClienteNaoEncontradoError,
  DocumentoInvalidoError
} = require('../../domain/errors');
const {
  STATUS_RASCUNHO,
  gerarCorrelationId,
  enfileirarEvento,
  validarDocumentoUnico,
  validarPerfilConsignado
} = require('./consignacaoUseCaseHelpers');
const { gerarDocumentoConsignacaoOficial } = require('../../services/DocumentoConsignacaoSequenciador');

class CriarConsignacaoUseCase extends ConsignacaoWriteUseCase {
  constructor(deps = {}) {
    super(deps);
    this._clienteBridge = deps.clienteBridge ?? null;
    this._perfilComercialRepository = deps.perfilComercialRepository ?? null;
  }

  async validar(entrada) {
    if (!entrada?.clienteId) {
      throw new DocumentoInvalidoError('clienteId é obrigatório');
    }
    if (!entrada?.perfilComercialId) {
      throw new DocumentoInvalidoError('perfilComercialId é obrigatório');
    }
    if (!this._clienteBridge) {
      throw new DocumentoInvalidoError('IClienteBridge não configurado');
    }
    if (!this._perfilComercialRepository) {
      throw new DocumentoInvalidoError('IPerfilComercialRepository não configurado para validação');
    }
  }

  async processar(entrada) {
    const cliente = await this._clienteBridge.buscarPorId(entrada.clienteId);
    if (!cliente) {
      throw new ClienteNaoEncontradoError(entrada.clienteId);
    }

    const ativo = await this._clienteBridge.estaAtivo(entrada.clienteId);
    if (!ativo) {
      throw new ClienteNaoEncontradoError(entrada.clienteId);
    }

    const perfil = await this._perfilComercialRepository.buscarPorId(entrada.perfilComercialId);
    validarPerfilConsignado(perfil, entrada.clienteId);

    const correlationId = entrada.correlationId ?? gerarCorrelationId();
    let documento = entrada.documento ?? { situacao: 'RASCUNHO' };

    return this.executarEscrita(async (uow, eventos) => {
      if (!documento.serie || documento.sequencial == null) {
        documento = await gerarDocumentoConsignacaoOficial(uow.consignacao);
      }

      await validarDocumentoUnico(uow.consignacao, documento);

      const consignacao = await uow.consignacao.inserir({
        clienteId: entrada.clienteId,
        perfilComercialId: entrada.perfilComercialId,
        status: STATUS_RASCUNHO,
        documento,
        documentoExterno: entrada.documentoExterno ?? null,
        observacao: entrada.observacao ?? null,
        usuarioAberturaId: entrada.usuarioId ?? null,
        dataAbertura: entrada.dataAbertura ?? new Date().toISOString(),
        dataEntrega: entrada.dataEntregaPrevista ?? null
      });

      enfileirarEvento(eventos, EVENTOS_DOMINIO.CONSIGNACAO_CRIADA, consignacao.id, {
        consignacao,
        correlationId
      }, correlationId);

      return { consignacao, correlationId };
    });
  }
}

module.exports = CriarConsignacaoUseCase;
