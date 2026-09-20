/**
 * DomainErrorMapper — Converte erros de domínio em respostas HTTP.
 *
 * Sprint 2.5: API REST — mapeamento de erros.
 *
 * @module motores/motor-comercial/http/mappers/DomainErrorMapper
 */

const HttpResponse = require('../responses/HttpResponse');

class DomainErrorMapper {
  /**
   * Mapeia erros de domínio para respostas HTTP.
   * @param {Error} error - Erro a ser mapeado
   * @returns {Object}
   */
  static map(error) {
    // Se já for um DomainError
    if (error.name && error.codigo) {
      return HttpResponse.domainError(error);
    }

    // Erros de validação comuns
    if (error.message.includes('é obrigatório') || 
        error.message.includes('obrigatório')) {
      return HttpResponse.validationError(error.message);
    }

    // Erros de não encontrado
    if (error.message.includes('não encontrado') || 
        error.message.includes('not found')) {
      return HttpResponse.notFound(error.message);
    }

    // Erros de duplicidade
    if (error.message.includes('duplicado') || 
        error.message.includes('já existe')) {
      return HttpResponse.conflict(error.message);
    }

    // Erro genérico
    return HttpResponse.internalError(error.message);
  }

  /**
   * Mapeia códigos de erro específicos para status HTTP.
   * @param {string} errorCode - Código do erro
   * @returns {number}
   */
  static mapToStatusCode(errorCode) {
    const statusCodeMap = {
      'VALIDATION_ERROR': 400,
      'NOT_FOUND': 404,
      'CONFLICT': 409,
      'UNAUTHORIZED': 401,
      'FORBIDDEN': 403,
      'PERFIL_NAO_ENCONTRADO': 404,
      'CONSIGNACAO_NAO_ENCONTRADA': 404,
      'CLIENTE_NAO_ENCONTRADO': 404,
      'PERFIL_DUPLICADO': 409,
      'DOCUMENTO_DUPLICADO': 409,
      'PERFIL_BLOQUEADO': 403,
      'CLIENTE_BLOQUEADO': 403,
      'LIMITE_COMERCIAL_INSUFICIENTE': 400,
      'PERFIL_SEM_LIMITE_DISPONIVEL': 400,
      'MOVIMENTACAO_INVALIDA': 400,
      'QUANTIDADE_INVALIDA': 400,
      'QUANTIDADE_SUPERIOR_AO_SALDO': 400,
      'PAGAMENTO_MAIOR_QUE_SALDO': 400,
      'PRESTACAO_JA_FECHADA': 400,
      'PRESTACAO_NAO_ABERTA': 400,
      'PRESTACAO_JA_ABERTA': 400,
      'CONSIGNACAO_NAO_ENTREGUE': 400,
      'ENTREGA_JA_REALIZADA': 400,
      'ENTREGA_COMPLEMENTAR_BLOQUEADA': 409,
      'CONSIGNACAO_NAO_ESTA_EM_RASCUNHO': 400,
      'CONSIGNACAO_JA_CANCELADA': 409,
      'CONSIGNACAO_JA_ENTREGUE': 409,
      'OPERACAO_NAO_AUTORIZADA': 403,
      'TRANSFERENCIA_INVALIDA': 400,
      'REABERTURA_NAO_AUTORIZADA': 403
    };

    return statusCodeMap[errorCode] || 400;
  }
}

module.exports = DomainErrorMapper;
