/**
 * ConsignacaoDTO — DTOs HTTP para Consignação.
 *
 * Sprint 2.5: API REST — DTOs de consignação.
 *
 * @module motores/motor-comercial/http/dto/ConsignacaoDTO
 */

const {
  mapStatusConsultaConsignacao,
  extrairCanalOperacao,
  extrairTabelaPrecoId
} = require('../../services/consultaConsignacaoReadOnly');
const { extrairCancelamento } = require('../../usecases/consignacao/cancelamentoConsignacaoHelpers');

class CriarConsignacaoRequest {
  /**
   * @param {Object} data
   * @param {string} data.clienteId
   * @param {string} data.perfilComercialId
   * @param {Object} [data.documento]
   * @param {string} [data.observacao]
   * @param {string} [data.dataAbertura]
   * @param {string} [data.dataEntregaPrevista]
   * @param {string} [data.usuarioId]
   * @param {string} [data.correlationId]
   */
  static fromJSON(data) {
    return {
      clienteId: data.clienteId,
      perfilComercialId: data.perfilComercialId,
      documento: data.documento || null,
      documentoExterno: data.documentoExterno || null,
      observacao: data.observacao || null,
      dataAbertura: data.dataAbertura || new Date().toISOString(),
      dataEntregaPrevista: data.dataEntregaPrevista || null,
      usuarioId: data.usuarioId || null,
      correlationId: data.correlationId || null
    };
  }

  /**
   * Valida os dados da requisição.
   * @param {Object} data
   * @returns {Object|null}
   */
  static validate(data) {
    const errors = [];

    if (!data.clienteId) {
      errors.push('clienteId é obrigatório');
    }
    if (!data.perfilComercialId) {
      errors.push('perfilComercialId é obrigatório');
    }

    return errors.length > 0 ? { errors } : null;
  }
}

class EditarConsignacaoRequest {
  /**
   * @param {Object} data
   * @param {string} [data.observacao]
   * @param {string} [data.dataEntregaPrevista]
   * @param {string} [data.usuarioId]
   */
  static fromJSON(data) {
    return {
      observacao: data.observacao,
      documentoExterno: data.documentoExterno,
      dataEntregaPrevista: data.dataEntregaPrevista,
      usuarioId: data.usuarioId || null
    };
  }
}

/**
 * RCM-8.8 — Cancelamento voluntário da preparação.
 */
class CancelarConsignacaoRequest {
  static MOTIVOS = Object.freeze([
    'CLIENTE_DESISTIU',
    'ERRO_PREPARACAO',
    'PRODUTO_INDISPONIVEL',
    'PEDIDO_DUPLICADO',
    'OUTRO'
  ]);

  /**
   * @param {Object} data
   * @returns {Object}
   */
  static fromJSON(data = {}) {
    return {
      motivo: data.motivo ? String(data.motivo).toUpperCase() : 'OUTRO',
      observacao: data.observacao || data.observacaoCancelamento || null,
      usuarioId: data.usuarioId || null
    };
  }

  /**
   * @param {Object} data
   * @returns {{ errors: string[] }|null}
   */
  static validate(data = {}) {
    const errors = [];
    if (data.motivo != null && data.motivo !== '') {
      const codigo = String(data.motivo).toUpperCase();
      if (!CancelarConsignacaoRequest.MOTIVOS.includes(codigo)) {
        errors.push(`motivo inválido. Use: ${CancelarConsignacaoRequest.MOTIVOS.join(', ')}`);
      }
    }
    return errors.length > 0 ? { errors } : null;
  }
}

class AdicionarItemRequest {
  /**
   * @param {Object} data
   * @param {string} data.produtoId
   * @param {number} data.quantidade
   * @param {number} [data.precoUnitario]
   * @param {string} [data.usuarioId]
   * @param {string} [data.unidadeComercial]
   * @param {number} [data.linhaComercialId]
   * @param {number} [data.tabelaPrecoId]
   * @param {string} [data.canalVenda]
   * @param {string} [data.precoOrigem]
   * @param {boolean|number} [data.precoFallback]
   */
  static fromJSON(data) {
    return {
      produtoId: data.produtoId,
      quantidade: data.quantidade,
      precoUnitario: data.precoUnitario || 0,
      usuarioId: data.usuarioId || null,
      // RCM-6.1 — snapshot de precificação
      unidadeComercial: data.unidadeComercial || data.unidade_comercial || null,
      linhaComercialId: data.linhaComercialId ?? data.linha_comercial_id ?? null,
      tabelaPrecoId: data.tabelaPrecoId ?? data.tabela_preco_id ?? null,
      canalVenda: data.canalVenda || data.canal_venda || data.canal || null,
      precoOrigem: data.precoOrigem || data.preco_origem || null,
      precoFallback: data.precoFallback ?? data.preco_fallback ?? null
    };
  }

  /**
   * Valida os dados da requisição.
   * @param {Object} data
   * @returns {Object|null}
   */
  static validate(data) {
    const errors = [];

    if (!data.produtoId) {
      errors.push('produtoId é obrigatório');
    }
    if (data.quantidade === undefined || data.quantidade === null) {
      errors.push('quantidade é obrigatória');
    }
    if (typeof data.quantidade !== 'number' || data.quantidade <= 0) {
      errors.push('quantidade deve ser um número positivo');
    }

    return errors.length > 0 ? { errors } : null;
  }
}

class AlterarQuantidadeItemRequest {
  /**
   * @param {Object} data
   * @param {number} data.novaQuantidade
   * @param {string} [data.usuarioId]
   */
  static fromJSON(data) {
    return {
      novaQuantidade: data.novaQuantidade,
      usuarioId: data.usuarioId || null
    };
  }

  /**
   * Valida os dados da requisição.
   * @param {Object} data
   * @returns {Object|null}
   */
  static validate(data) {
    const errors = [];

    if (data.novaQuantidade === undefined || data.novaQuantidade === null) {
      errors.push('novaQuantidade é obrigatória');
    }
    if (typeof data.novaQuantidade !== 'number' || data.novaQuantidade < 0) {
      errors.push('novaQuantidade deve ser um número não negativo');
    }

    return errors.length > 0 ? { errors } : null;
  }
}

class RegistrarEntregaRequest {
  /**
   * @param {Object} data
   * @param {string} [data.observacao]
   * @param {string} [data.usuarioId]
   * @param {Object} [data.liberacaoGerencial]
   * @param {string} [data.supervisorToken]
   */
  static fromJSON(data) {
    const liberacao = data.liberacaoGerencial || null;
    return {
      observacao: data.observacao || null,
      usuarioId: data.usuarioId || null,
      liberacaoGerencial: liberacao
        ? {
            ...liberacao,
            autorizado: liberacao.autorizado === true || liberacao.autorizado === 'true',
            supervisorToken: liberacao.supervisorToken || data.supervisorToken || null
          }
        : (data.supervisorToken
          ? { autorizado: true, supervisorToken: data.supervisorToken }
          : null)
    };
  }
}

/**
 * RCM-8.7 — Entrega Complementar (itens novos em consignação ENTREGUE).
 */
class RegistrarEntregaComplementarRequest {
  /**
   * @param {Object} data
   */
  static fromJSON(data = {}) {
    const liberacao = data.liberacaoGerencial || null;
    const itens = Array.isArray(data.itens) ? data.itens : [];
    return {
      observacao: data.observacao || data.motivo || null,
      motivo: data.motivo || data.observacao || null,
      usuarioId: data.usuarioId || null,
      correlationId: data.correlationId || null,
      liberacaoGerencial: liberacao
        ? {
            ...liberacao,
            autorizado: liberacao.autorizado === true || liberacao.autorizado === 'true',
            supervisorToken: liberacao.supervisorToken || data.supervisorToken || null
          }
        : (data.supervisorToken
          ? { autorizado: true, supervisorToken: data.supervisorToken }
          : null),
      itens: itens.map((item) => ({
        produtoId: item.produtoId != null ? Number(item.produtoId) : null,
        quantidade: item.quantidade != null ? Number(item.quantidade) : null,
        precoUnitario: item.precoUnitario != null ? Number(item.precoUnitario) : undefined,
        unidadeComercial: item.unidadeComercial || item.unidade_comercial || null,
        linhaComercialId: item.linhaComercialId ?? item.linha_comercial_id ?? null,
        tabelaPrecoId: item.tabelaPrecoId ?? item.tabela_preco_id ?? null,
        canalVenda: item.canalVenda || item.canal_venda || item.canal || 'CONSIGNADO',
        precoOrigem: item.precoOrigem || item.preco_origem || null,
        precoFallback: item.precoFallback ?? item.preco_fallback ?? null
      }))
    };
  }

  /**
   * @param {Object} data
   * @returns {{ errors: string[] }|null}
   */
  static validate(data = {}) {
    const errors = [];
    if (!Array.isArray(data.itens) || !data.itens.length) {
      errors.push('itens é obrigatório');
    } else {
      data.itens.forEach((item, idx) => {
        if (!item.produtoId) errors.push(`itens[${idx}].produtoId é obrigatório`);
        if (!(Number(item.quantidade) > 0)) {
          errors.push(`itens[${idx}].quantidade deve ser positiva`);
        }
      });
    }
    return errors.length ? { errors } : null;
  }
}

class RegistrarEmissaoTermoEntregaRequest {
  /**
   * @param {Object} data
   * @param {string} [data.acao]
   * @param {string} [data.usuarioId]
   */
  static fromJSON(data) {
    return {
      acao: data.acao || 'impressao',
      usuarioId: data.usuarioId || null
    };
  }
}

class AbrirPrestacaoRequest {
  /**
   * @param {Object} data
   * @param {string|number} consignacaoId
   */
  static fromJSON(data = {}, consignacaoId = null) {
    return {
      consignacaoId: Number(consignacaoId ?? data.consignacaoId),
      usuarioId: data.usuarioId || null,
      motivo: data.motivo || null
    };
  }

  /**
   * @param {Object} data
   * @returns {{ errors: Array<{ field: string, message: string }> }|null}
   */
  static validate(data = {}) {
    const errors = [];
    const id = Number(data.consignacaoId);
    if (!Number.isFinite(id) || id <= 0) {
      errors.push({ field: 'consignacaoId', message: 'consignacaoId é obrigatório e deve ser numérico' });
    }
    return errors.length ? { errors } : null;
  }
}

function normalizarNumeroPositivo(valor) {
  if (valor === undefined || valor === null || valor === '') return null;
  const numero = Number(String(valor).replace(',', '.'));
  if (!Number.isFinite(numero)) return null;
  return numero;
}

class RegistrarDevolucaoRequest {
  /**
   * @param {Object} data
   * @param {number|string} [data.itemId]
   * @param {number|string} [data.produtoId]
   * @param {number} data.quantidade
   * @param {string} [data.observacao]
   * @param {string} [data.usuarioId]
   */
  static fromJSON(data = {}) {
    const itemId = normalizarNumeroPositivo(data.itemId);
    const produtoId = normalizarNumeroPositivo(data.produtoId);
    const quantidade = normalizarNumeroPositivo(data.quantidade);
    return {
      itemId: itemId != null ? itemId : null,
      produtoId: produtoId != null ? produtoId : null,
      quantidade,
      observacao: data.observacao || null,
      usuarioId: data.usuarioId || null
    };
  }

  /**
   * @param {Object} data
   * @returns {Object|null}
   */
  static validate(data = {}) {
    const errors = [];
    if (data.itemId == null && data.produtoId == null) {
      errors.push('itemId ou produtoId é obrigatório');
    }
    if (data.quantidade === undefined || data.quantidade === null) {
      errors.push('quantidade é obrigatória');
    } else if (typeof data.quantidade !== 'number' || data.quantidade <= 0) {
      errors.push('quantidade deve ser um número positivo');
    }
    return errors.length > 0 ? { errors } : null;
  }
}

class TransferenciaRequest {
  /**
   * @param {Object} data
   * @param {string} data.consignacaoDestinoId
   * @param {Array<string>} data.itemIds
   * @param {string} [data.observacao]
   * @param {string} [data.usuarioId]
   */
  static fromJSON(data) {
    return {
      consignacaoDestinoId: data.consignacaoDestinoId,
      itemIds: data.itemIds || [],
      observacao: data.observacao || null,
      usuarioId: data.usuarioId || null
    };
  }

  /**
   * Valida os dados da requisição.
   * @param {Object} data
   * @returns {Object|null}
   */
  static validate(data) {
    const errors = [];

    if (!data.consignacaoDestinoId) {
      errors.push('consignacaoDestinoId é obrigatório');
    }
    if (!data.itemIds || !Array.isArray(data.itemIds) || data.itemIds.length === 0) {
      errors.push('itemIds é obrigatório e deve conter pelo menos um item');
    }

    return errors.length > 0 ? { errors } : null;
  }
}

class RegistrarVendaRequest {
  /**
   * @param {Object} data
   * @param {string} data.produtoId
   * @param {number} data.quantidade
   * @param {number} data.precoVenda
   * @param {string} [data.observacao]
   * @param {string} [data.usuarioId]
   */
  static fromJSON(data) {
    return {
      itemId: data.itemId ?? null,
      produtoId: data.produtoId,
      quantidade: data.quantidade,
      precoVenda: data.precoVenda,
      observacao: data.observacao || null,
      usuarioId: data.usuarioId || null
    };
  }

  /**
   * Valida os dados da requisição.
   * @param {Object} data
   * @returns {Object|null}
   */
  static validate(data) {
    const errors = [];

    if (!data.produtoId && !data.itemId) {
      errors.push('itemId ou produtoId é obrigatório');
    }
    if (data.quantidade === undefined || data.quantidade === null) {
      errors.push('quantidade é obrigatória');
    }
    if (typeof data.quantidade !== 'number' || data.quantidade <= 0) {
      errors.push('quantidade deve ser um número positivo');
    }
    if (data.precoVenda === undefined || data.precoVenda === null) {
      errors.push('precoVenda é obrigatório');
    }
    if (typeof data.precoVenda !== 'number' || data.precoVenda < 0) {
      errors.push('precoVenda deve ser um número não negativo');
    }

    return errors.length > 0 ? { errors } : null;
  }
}

class RegistrarPerdaRequest {
  /**
   * @param {Object} data
   * @param {string} data.produtoId
   * @param {number} data.quantidade
   * @param {string} [data.motivo]
   * @param {string} [data.observacao]
   * @param {string} [data.usuarioId]
   */
  static fromJSON(data) {
    return {
      itemId: data.itemId ?? null,
      produtoId: data.produtoId,
      quantidade: data.quantidade,
      motivo: data.motivo || null,
      observacao: data.observacao || null,
      usuarioId: data.usuarioId || null
    };
  }

  /**
   * Valida os dados da requisição.
   * @param {Object} data
   * @returns {Object|null}
   */
  static validate(data) {
    const errors = [];

    if (!data.produtoId && !data.itemId) {
      errors.push('itemId ou produtoId é obrigatório');
    }
    if (data.quantidade === undefined || data.quantidade === null) {
      errors.push('quantidade é obrigatória');
    }
    if (typeof data.quantidade !== 'number' || data.quantidade <= 0) {
      errors.push('quantidade deve ser um número positivo');
    }

    return errors.length > 0 ? { errors } : null;
  }
}

class RegistrarCortesiaRequest {
  /**
   * @param {Object} data
   * @param {string} data.produtoId
   * @param {number} data.quantidade
   * @param {string} [data.motivo]
   * @param {string} [data.observacao]
   * @param {string} [data.usuarioId]
   */
  static fromJSON(data) {
    return {
      itemId: data.itemId ?? null,
      produtoId: data.produtoId,
      quantidade: data.quantidade,
      motivo: data.motivo || null,
      observacao: data.observacao || null,
      usuarioId: data.usuarioId || null
    };
  }

  /**
   * Valida os dados da requisição.
   * @param {Object} data
   * @returns {Object|null}
   */
  static validate(data) {
    const errors = [];

    if (!data.produtoId && !data.itemId) {
      errors.push('itemId ou produtoId é obrigatório');
    }
    if (data.quantidade === undefined || data.quantidade === null) {
      errors.push('quantidade é obrigatória');
    }
    if (typeof data.quantidade !== 'number' || data.quantidade <= 0) {
      errors.push('quantidade deve ser um número positivo');
    }

    return errors.length > 0 ? { errors } : null;
  }
}

class RegistrarPagamentoRequest {
  /**
   * @param {Object} data
   * @param {number} data.valor
   * @param {string} [data.formaPagamento]
   * @param {string} [data.observacao]
   * @param {string} [data.usuarioId]
   */
  static fromJSON(data = {}) {
    const valor = normalizarNumeroPositivo(data.valor);
    return {
      valor,
      formaPagamento: data.formaPagamento || null,
      observacao: data.observacao || null,
      usuarioId: data.usuarioId || null
    };
  }

  /**
   * Valida os dados da requisição.
   * @param {Object} data
   * @returns {{ errors: Array<{ field: string, message: string }> }|null}
   */
  static validate(data = {}) {
    const errors = [];
    const valor = normalizarNumeroPositivo(data.valor);

    if (valor === null) {
      errors.push({ field: 'valor', message: "Campo 'valor' é obrigatório." });
    } else if (valor <= 0) {
      errors.push({ field: 'valor', message: "Campo 'valor' deve ser um número positivo." });
    }

    return errors.length ? { errors } : null;
  }
}

class ConsignacaoResponse {
  /**
   * Converte entidade de domínio para DTO de resposta.
   * @param {Object} consignacao
   * @param {Object} [extras]
   * @returns {Object}
   */
  static toJSON(consignacao, extras = {}) {
    if (!consignacao) return null;

    const itens = extras.itens || consignacao.itens || [];
    const statusConsulta = mapStatusConsultaConsignacao(consignacao);
    const quantidadeItens = consignacao.quantidadeItens != null
      ? Number(consignacao.quantidadeItens)
      : (Array.isArray(itens) ? itens.length : 0);

    return {
      id: consignacao.id,
      clienteId: consignacao.clienteId,
      clienteNome: consignacao.clienteNome
        ?? consignacao.cliente_nome
        ?? null,
      clienteDocumento: consignacao.clienteDocumento
        ?? consignacao.cliente_documento
        ?? null,
      clienteFantasia: consignacao.clienteFantasia
        ?? consignacao.cliente_fantasia
        ?? null,
      clienteTelefone: consignacao.clienteTelefone
        ?? consignacao.cliente_telefone
        ?? null,
      perfilComercialId: consignacao.perfilComercialId,
      status: consignacao.status,
      statusLabel: statusConsulta.label,
      statusConsulta,
      documento: consignacao.documento,
      documentoExterno: consignacao.documentoExterno ?? null,
      observacao: consignacao.observacao,
      usuarioAberturaId: consignacao.usuarioAberturaId,
      usuarioEncerramentoId: consignacao.usuarioEncerramentoId ?? null,
      dataAbertura: consignacao.dataAbertura,
      dataEntrega: consignacao.dataEntrega,
      dataEntregaPrevista: consignacao.dataEntregaPrevista,
      dataFechamento: consignacao.dataFechamento ?? consignacao.dataEncerramento ?? null,
      dataEncerramento: consignacao.dataEncerramento ?? consignacao.dataFechamento ?? null,
      // Cache financeiro (ledger) — necessário para Central E5 / saldo a receber
      valorTotalEntregue: Number(consignacao.valorTotalEntregue ?? 0),
      valorTotal: Number(consignacao.valorTotalEntregue ?? consignacao.valorTotal ?? 0),
      valorTotalAcertado: Number(consignacao.valorTotalAcertado ?? 0),
      valorTotalPago: Number(consignacao.valorTotalPago ?? 0),
      saldoAberto: Number(consignacao.saldoAberto ?? consignacao.saldo ?? 0),
      quantidadeItens,
      canalOperacao: extrairCanalOperacao(consignacao, itens),
      tabelaPrecoId: extrairTabelaPrecoId(consignacao, itens),
      prestacaoContasAtiva: consignacao.prestacaoContasAtiva ?? null,
      cancelamento: extrairCancelamento(consignacao),
      createdAt: consignacao.createdAt,
      updatedAt: consignacao.updatedAt
    };
  }
}

class ItemConsignacaoResponse {
  /**
   * Converte item de consignação para DTO de resposta (STAB-06.6.1).
   * Transporta identificação comercial + quantidades + status operacional.
   * @param {Object} item
   * @returns {Object}
   */
  static toJSON(item) {
    if (!item) return null;

    const quantidadeEntregue = Number(
      item.quantidadeEntregue != null
        ? item.quantidadeEntregue
        : (item.quantidade ?? 0)
    );
    const quantidade = Number(
      item.quantidade != null ? item.quantidade : quantidadeEntregue
    );
    const quantidadeVendida = Number(item.quantidadeVendida ?? 0);
    const quantidadeDevolvida = Number(item.quantidadeDevolvida ?? 0);
    const quantidadePerdida = Number(item.quantidadePerdida ?? item.quantidadePerda ?? 0);
    const quantidadeCortesia = Number(item.quantidadeCortesia ?? 0);
    const saldo = Number.isFinite(Number(item.saldo))
      ? Math.max(0, Number(item.saldo))
      : Math.max(
        0,
        quantidadeEntregue - quantidadeVendida - quantidadeDevolvida
          - quantidadePerdida - quantidadeCortesia
      );
    const valorUnitario = Number(item.valorUnitario ?? item.precoUnitario ?? item.preco ?? 0);
    const produtoNomeRaw = item.produtoNome ?? item.produto ?? null;
    const produtoNome = produtoNomeRaw != null && String(produtoNomeRaw).trim() !== ''
      ? String(produtoNomeRaw).trim()
      : null;
    const status = saldo > 0 ? 'PENDENTE' : 'LIQUIDADO';

    return {
      id: item.id,
      itemId: item.id,
      consignacaoId: item.consignacaoId,
      produtoId: item.produtoId,
      produtoNome,
      codigo: item.codigo ?? null,
      unidade: item.unidade ?? item.unidadeComercial ?? 'UN',
      unidadeComercial: item.unidadeComercial ?? item.unidade ?? 'UN',
      unidadeBaseProduto: item.unidadeBaseProduto ?? null,
      linhaComercialId: item.linhaComercialId ?? null,
      tabelaPrecoId: item.tabelaPrecoId ?? null,
      canalVenda: item.canalVenda ?? null,
      precoOrigem: item.precoOrigem ?? null,
      precoFallback: !!item.precoFallback,
      valorUnitario,
      precoUnitario: valorUnitario,
      preco: valorUnitario,
      quantidade: Number.isFinite(quantidade) ? quantidade : 0,
      quantidadeEntregue,
      quantidadeVendida,
      quantidadeDevolvida,
      quantidadePerdida,
      quantidadePerda: quantidadePerdida,
      quantidadeCortesia,
      saldo,
      status,
      statusLabel: status === 'LIQUIDADO' ? 'Liquidado' : 'Pendente',
      observacao: item.observacao ?? null,
      precoTotal: item.precoTotal != null
        ? Number(item.precoTotal)
        : (quantidadeEntregue * valorUnitario),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    };
  }
}

module.exports = {
  CriarConsignacaoRequest,
  EditarConsignacaoRequest,
  CancelarConsignacaoRequest,
  AdicionarItemRequest,
  AlterarQuantidadeItemRequest,
  RegistrarEntregaRequest,
  RegistrarEntregaComplementarRequest,
  RegistrarEmissaoTermoEntregaRequest,
  AbrirPrestacaoRequest,
  RegistrarDevolucaoRequest,
  TransferenciaRequest,
  RegistrarVendaRequest,
  RegistrarPerdaRequest,
  RegistrarCortesiaRequest,
  RegistrarPagamentoRequest,
  ConsignacaoResponse,
  ItemConsignacaoResponse
};
