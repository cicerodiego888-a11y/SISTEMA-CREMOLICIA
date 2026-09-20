/**
 * API Helpers — utilitários de resposta HTTP do Motor Comercial.
 *
 * Sprint O-2: Fluxo Operacional da Consignação.
 *
 * @module frontend/modules/motor-comercial/api/helpers
 */

/**
 * Extrai mensagem de erro de resposta da API.
 * @param {Object} body
 * @returns {string}
 */
function extractErrorMessage(body) {
  if (!body) return 'Erro na requisição';
  if (typeof body === 'string') return body;
  if (body.error?.message) {
    const code = body.error?.code ? `[${body.error.code}] ` : '';
    const field = body.error?.details?.fields?.[0]?.field;
    const fieldHint = field ? ` (${field})` : '';
    return `${code}${body.error.message}${fieldHint}`;
  }
  if (body.message) return body.message;
  if (Array.isArray(body.error?.details?.fields)) {
    return body.error.details.fields.map((f) => f.message).join(', ');
  }
  if (Array.isArray(body.error?.details)) return body.error.details.join(', ');
  if (Array.isArray(body.errors)) return body.errors.join(', ');
  return 'Erro na requisição';
}

/**
 * Desembrulha campo data da StandardResponse.
 * @param {Object} response
 * @returns {*}
 */
function unwrapData(response) {
  if (!response) return response;
  if (response.success === false) {
    throw new Error(extractErrorMessage(response));
  }
  if (response.data !== undefined) return response.data;
  return response;
}

/**
 * Extrai entidade principal de respostas de Use Case (perfil, consignação).
 * @param {Object} response
 * @returns {*}
 */
function unwrapUseCaseData(response) {
  const data = unwrapData(response);
  if (!data || typeof data !== 'object') return data;
  if (data.perfil) return data.perfil;
  if (data.consignacao) return data.consignacao;
  if (data.dados?.perfil) return data.dados.perfil;
  if (data.dados?.consignacao) return data.dados.consignacao;
  if (data.dados && typeof data.dados === 'object' && !Array.isArray(data.dados)) return data.dados;
  return data;
}

/**
 * Desembrulha lista com metadata.total.
 * @param {Object} response
 * @returns {{ items: Array, total: number, metadata: Object|null }}
 */
function unwrapList(response) {
  const raw = unwrapData(response);
  if (Array.isArray(raw)) {
    return {
      items: raw,
      total: response?.metadata?.total ?? raw.length,
      page: response?.metadata?.page,
      pageSize: response?.metadata?.pageSize,
      hasMore: response?.metadata?.hasMore,
      metadata: response?.metadata || null
    };
  }
  return {
    items: raw?.items || raw?.movimentacoes || raw?.registros || raw?.eventos || [],
    total: raw?.total ?? response?.metadata?.total ?? 0,
    page: raw?.page ?? response?.metadata?.page,
    pageSize: raw?.pageSize ?? response?.metadata?.pageSize,
    hasMore: raw?.hasMore ?? response?.metadata?.hasMore,
    metadata: response?.metadata || raw?.metadata || null
  };
}

/**
 * Obtém ID do usuário logado no ERP.
 * @returns {string|null}
 */
function getUsuarioId() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    return user?.id || user?.usuario_id || user?.usuarioId || null;
  } catch (_error) {
    return null;
  }
}

/**
 * Normaliza eventos de timeline.
 * @param {*} data
 * @returns {Array}
 */
function normalizeTimeline(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  return data.eventos || data.items || [];
}

/**
 * Normaliza movimentações de histórico.
 * @param {*} data
 * @returns {Array}
 */
function normalizeHistorico(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  return data.movimentacoes || data.registros || data.items || [];
}

/**
 * Normaliza resumo de prestação para o formato esperado pelas telas.
 * @param {*} data
 * @returns {Object}
 */
function normalizeResumoPrestacao(data) {
  if (!data) return {};
  return {
    ...data,
    valorConsignado: data.valorConsignado ?? data.valorTotal ?? 0,
    valorVendido: data.valorVendido ?? data.totalVendido ?? 0,
    valorDevolvido: data.valorDevolvido ?? data.totalDevolvido ?? 0,
    valorPerdido: data.valorPerdido ?? data.totalPerdido ?? 0,
    valorCortesia: data.valorCortesia ?? data.totalCortesia ?? 0,
    valorRecebido: data.valorRecebido ?? data.totalPago ?? data.valorPago ?? 0,
    saldoAtual: data.saldoAtual ?? data.saldo ?? 0,
    totalVendido: data.totalVendido ?? data.valorVendido ?? 0,
    totalPago: data.totalPago ?? data.valorRecebido ?? data.valorPago ?? 0,
    itens: data.itens || [],
    movimentacoes: data.movimentacoes || []
  };
}

/**
 * Normaliza documento da consignação para exibição.
 * @param {*} documento
 * @returns {string}
 */
function formatDocumento(documento, fallbackId) {
  if (!documento) {
    return fallbackId != null ? `Consignação #${fallbackId}` : '-';
  }
  if (typeof documento === 'string') return documento;
  if (documento.numero) return documento.numero;
  if (documento.serie && documento.sequencial != null) {
    return `${documento.serie}-${documento.sequencial}`;
  }
  return fallbackId != null ? `Consignação #${fallbackId}` : '-';
}

function resolveClienteLabel(consignacao, extras = {}) {
  if (extras.clienteNome) return extras.clienteNome;
  if (consignacao.clienteNome) return consignacao.clienteNome;
  const cliente = consignacao.cliente;
  if (!cliente) {
    return consignacao.clienteId != null ? String(consignacao.clienteId) : '—';
  }
  if (typeof cliente === 'string') return cliente;
  if (typeof cliente === 'number') return String(cliente);
  return cliente.nome || cliente.razaoSocial || cliente.nomeFantasia || String(consignacao.clienteId || '—');
}

/**
 * Enriquece consignação da API para exibição nas telas.
 * @param {Object} consignacao
 * @param {Object} [extras]
 * @returns {Object}
 */
function mapConsignacaoView(consignacao, extras = {}) {
  if (!consignacao) return null;
  const itens = extras.itens || consignacao.itens || [];
  const status = String(consignacao.status || '').toUpperCase();
  const isRascunho = status === 'RASCUNHO';
  const valorResolvido = extras.valor !== undefined
    ? extras.valor
    : (isRascunho
      ? null
      : (consignacao.valorTotalEntregue ?? consignacao.valor ?? 0));
  const saldoResolvido = extras.saldo !== undefined
    ? extras.saldo
    : (isRascunho
      ? null
      : (consignacao.saldoAberto ?? consignacao.saldo ?? 0));

  return {
    ...consignacao,
    documento: formatDocumento(consignacao.documento, consignacao.id),
    clienteId: consignacao.clienteId ?? null,
    clienteNome: resolveClienteLabel(consignacao, extras),
    clienteDocumento: consignacao.clienteDocumento
      ?? consignacao.cliente_documento
      ?? null,
    clienteFantasia: consignacao.clienteFantasia
      ?? consignacao.cliente_fantasia
      ?? null,
    clienteTelefone: consignacao.clienteTelefone
      ?? consignacao.cliente_telefone
      ?? null,
    cliente: resolveClienteLabel(consignacao, extras),
    consignado: extras.perfilNome || consignacao.consignado || consignacao.perfilComercialId,
    data: consignacao.dataAbertura || consignacao.data,
    valor: valorResolvido,
    saldo: saldoResolvido,
    aguardandoEntrega: isRascunho,
    quantidadeItens: consignacao.quantidadeItens != null
      ? Number(consignacao.quantidadeItens)
      : itens.length,
    prestacaoContasAtiva: consignacao.prestacaoContasAtiva ?? extras.prestacaoContasAtiva ?? null,
    ultimaMovimentacao: consignacao.updatedAt,
    usuario: consignacao.usuarioAberturaId,
    itens,
    perfilStatus: extras.perfilStatus || consignacao.perfilStatus,
    limite: extras.limite ?? consignacao.limite ?? 0
  };
}

module.exports = {
  extractErrorMessage,
  unwrapData,
  unwrapUseCaseData,
  unwrapList,
  getUsuarioId,
  normalizeTimeline,
  normalizeHistorico,
  normalizeResumoPrestacao,
  formatDocumento,
  mapConsignacaoView
};
