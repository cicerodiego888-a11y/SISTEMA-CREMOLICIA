/**
 * MotorComercialApi — API Client alinhado às rotas oficiais do backend.
 *
 * Sprint O-2: Fluxo Operacional da Consignação.
 *
 * @module frontend/modules/motor-comercial/api/MotorComercialApi
 */

const ApiClient = require('./client');
const { extractErrorMessage } = require('./helpers');
const { unwrapData, unwrapList, unwrapUseCaseData, getUsuarioId } = require('./helpers');

class MotorComercialApi {
  constructor(options = {}) {
    this.client = new ApiClient(options);
  }

  _withUsuario(data = {}) {
    return {
      ...data,
      usuarioId: data.usuarioId ?? getUsuarioId()
    };
  }

  _normalizePrestacaoWritePayload(data = {}, { requirePreco = false } = {}) {
    const payload = { ...data };
    if (payload.produtoId != null) payload.produtoId = Number(payload.produtoId);
    if (payload.itemId != null) payload.itemId = Number(payload.itemId);
    if (payload.quantidade != null) payload.quantidade = Number(payload.quantidade);
    if (requirePreco || payload.precoVenda != null) {
      payload.precoVenda = Number(payload.precoVenda ?? 0);
    }
    return payload;
  }

  // ============================================================================
  // PERFIS COMERCIAIS  (/perfil-comercial)
  // ============================================================================

  async listarPerfis(filters = {}) {
    const params = { ...filters };
    if (params.clienteId != null) params.clienteId = Number(params.clienteId);
    const response = await this.client.get('/perfil-comercial', { params });
    return unwrapList(response);
  }

  async obterPerfil(id) {
    const response = await this.client.get(`/perfil-comercial/${id}`);
    return unwrapData(response);
  }

  async criarPerfil(data) {
    const response = await this.client.post('/perfil-comercial', this._withUsuario(data));
    return unwrapUseCaseData(response);
  }

  async atualizarPerfil(id, data) {
    const response = await this.client.put(`/perfil-comercial/${id}`, this._withUsuario(data));
    return unwrapUseCaseData(response);
  }

  async alterarLimite(id, data = {}) {
    const response = await this.client.patch(`/perfil-comercial/${id}/limite`, this._withUsuario({
      novoLimite: data.novoLimite ?? data.limiteComercial,
      motivo: data.motivo
    }));
    return unwrapUseCaseData(response);
  }

  async bloquearPerfil(id, data = {}) {
    const response = await this.client.patch(`/perfil-comercial/${id}/bloquear`, this._withUsuario(data));
    return unwrapData(response);
  }

  async desbloquearPerfil(id, data = {}) {
    const response = await this.client.patch(`/perfil-comercial/${id}/desbloquear`, this._withUsuario(data));
    return unwrapData(response);
  }

  async obterHistoricoPerfil(id, params = {}) {
    const response = await this.client.get(`/perfil-comercial/${id}/historico`, { params });
    return unwrapData(response);
  }

  async obterScorePerfil(id) {
    const response = await this.client.get(`/perfil-comercial/${id}/score`);
    return unwrapData(response);
  }

  async obterLimitePerfil(id) {
    const response = await this.client.get(`/perfil-comercial/${id}/limite`);
    return unwrapData(response);
  }

  // ============================================================================
  // CONSIGNAÇÕES  (/consignacoes)
  // ============================================================================

  async listarConsignacoes(filters = {}) {
    const response = await this.client.get('/consignacoes', { params: filters });
    return unwrapList(response);
  }

  /**
   * RCM-8.5 — histórico paginado do cliente. Nunca solicita a lista inteira.
   */
  async listarHistoricoConsignacoesCliente(clienteId, { page = 1, pageSize = 20 } = {}) {
    return this.listarConsignacoes({
      clienteId,
      cliente_id: clienteId,
      page,
      pageSize,
      limite: pageSize
    });
  }

  async obterConsignacao(id, params = {}) {
    const response = await this.client.get(`/consignacoes/${id}`, { params });
    return unwrapData(response);
  }

  /**
   * Lista itens oficiais da consignação (GET /consignacoes/:id/itens).
   * Fonte de verdade para recovery quando o cabeçalho não trouxer itens.
   */
  async listarItensConsignacao(id, params = {}) {
    const response = await this.client.get(`/consignacoes/${id}/itens`, { params });
    const data = unwrapData(response);
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.itens)) return data.itens;
    return [];
  }

  async obterProximoDocumentoConsignacao() {
    const response = await this.client.get('/consignacoes/proximo-documento');
    const data = unwrapData(response);
    return data?.documento || data;
  }

  async criarConsignacao(data) {
    const payload = {
      ...data,
      clienteId: data.clienteId != null ? Number(data.clienteId) : data.clienteId,
      perfilComercialId: data.perfilComercialId != null ? Number(data.perfilComercialId) : data.perfilComercialId
    };
    const response = await this.client.post('/consignacoes', this._withUsuario(payload));
    return unwrapUseCaseData(response);
  }

  async atualizarConsignacao(id, data) {
    const response = await this.client.put(`/consignacoes/${id}`, this._withUsuario(data));
    return unwrapData(response);
  }

  async cancelarConsignacao(id, data = {}) {
    const payload = this._withUsuario(data);
    try {
      const response = await this.client.post(`/consignacoes/${id}/cancelar`, payload);
      return unwrapData(response);
    } catch (error) {
      // Compatibilidade: ambiente ainda sem rota POST /cancelar
      const status = Number(error?.status || error?.statusCode || 0);
      if (status === 404 || status === 405) {
        const response = await this.client.delete(`/consignacoes/${id}`, payload);
        return unwrapData(response);
      }
      throw error;
    }
  }

  async adicionarItem(id, data) {
    const response = await this.client.post(`/consignacoes/${id}/itens`, this._withUsuario(data));
    return unwrapData(response);
  }

  async alterarItem(id, itemId, data) {
    const response = await this.client.put(`/consignacoes/${id}/itens/${itemId}`, this._withUsuario(data));
    return unwrapData(response);
  }

  /**
   * Persiste observação do item (STAB-06.6.1) — não altera quantidades/ledger.
   */
  async atualizarObservacaoItem(id, itemId, data = {}) {
    const response = await this.client.patch(
      `/consignacoes/${id}/itens/${itemId}/observacao`,
      this._withUsuario({ observacao: data.observacao ?? '' })
    );
    return unwrapData(response);
  }

  async removerItem(id, itemId, data = {}) {
    const response = await this.client.delete(`/consignacoes/${id}/itens/${itemId}`, this._withUsuario(data));
    return unwrapData(response);
  }

  async entregarConsignacao(id, data = {}) {
    const response = await this.client.post(
      `/consignacoes/${id}/entrega`,
      this._withUsuario(data),
      { timeout: 120000 }
    );
    return unwrapData(response);
  }

  /**
   * RCM-8.7 — Entrega Complementar (somente itens novos).
   */
  async registrarEntregaComplementar(id, data = {}) {
    const response = await this.client.post(
      `/consignacoes/${id}/entrega-complementar`,
      this._withUsuario(data),
      { timeout: 120000 }
    );
    return unwrapUseCaseData(response);
  }

  /**
   * RCM-8.13 — Alteração Pós-Entrega (delta; novo comprovante completo).
   */
  async registrarAlteracaoPosEntrega(id, data = {}) {
    const response = await this.client.post(
      `/consignacoes/${id}/alteracao-pos-entrega`,
      this._withUsuario(data),
      { timeout: 120000 }
    );
    return unwrapUseCaseData(response);
  }

  /**
   * RCM-8.7/8.13 — Histórico de entregas / atualizações (somente leitura).
   */
  async consultarEntregasConsignacao(id, params = {}) {
    const response = await this.client.get(`/consignacoes/${id}/entregas`, {
      params: { ...params, _t: Date.now() }
    });
    return unwrapData(response);
  }

  /**
   * RCM-8.13 — Reimpressão de comprovante histórico (sem efeitos).
   */
  async obterComprovanteEntregaHistorico(id, correlationId) {
    const response = await this.client.get(
      `/consignacoes/${id}/entregas/${encodeURIComponent(correlationId)}/comprovante`,
      { params: { _t: Date.now() } }
    );
    return unwrapData(response);
  }

  async obterComprovanteEntrega(id, params = {}) {
    const response = await this.client.get(`/consignacoes/${id}/comprovante`, {
      params: { ...params, _t: Date.now() },
      timeout: 60000
    });
    return unwrapData(response);
  }

  async obterComprovantePrestacao(id, params = {}) {
    const response = await this.client.get(`/consignacoes/${id}/comprovante`, {
      params: { ...params, tipo: 'PRESTACAO', _t: Date.now() }
    });
    return unwrapData(response);
  }

  async registrarAcaoComprovante(id, data = {}) {
    const response = await this.client.post(`/consignacoes/${id}/comprovante/acoes`, this._withUsuario(data));
    return unwrapData(response);
  }

  async registrarAutorizacaoGerencial(data = {}) {
    const response = await this.client.post('/autorizacoes/gerenciais', this._withUsuario(data));
    return unwrapData(response);
  }

  async registrarEmissaoTermoEntrega(id, data = {}) {
    const response = await this.client.post(`/consignacoes/${id}/termo-entrega`, this._withUsuario(data));
    return unwrapData(response);
  }

  async registrarDevolucao(id, data = {}) {
    const payload = this._normalizePrestacaoWritePayload({
      ...data,
      itemId: data.itemId,
      produtoId: data.produtoId,
      quantidade: data.quantidade,
      observacao: data.observacao || null
    });
    const response = await this.client.post(`/consignacoes/${id}/devolucao`, this._withUsuario(payload));
    return unwrapData(response);
  }

  async transferirItens(id, data) {
    const response = await this.client.post(`/consignacoes/${id}/transferencia`, this._withUsuario(data));
    return unwrapData(response);
  }

  // ============================================================================
  // PRESTAÇÃO  (/consignacoes/:id/prestacao/*)
  // ============================================================================

  async abrirPrestacao(id, data = {}) {
    const response = await this.client.post(`/consignacoes/${id}/prestacao/abrir`, this._withUsuario(data));
    return unwrapData(response);
  }

  async fecharPrestacao(id, data = {}) {
    const response = await this.client.post(`/consignacoes/${id}/prestacao/fechar`, this._withUsuario(data));
    return unwrapData(response);
  }

  /**
   * STAB-06 — Resumo final (Integridade Comercial), sem persistir.
   */
  async obterResumoFinalPrestacao(id, params = {}) {
    const qs = params.emitirFiscal === false ? '?emitirFiscal=false' : '';
    const response = await this.client.get(`/consignacoes/${id}/prestacao/resumo-final${qs}`);
    return unwrapData(response);
  }

  /**
   * STAB-06 — cria venda oficial e/ou encerra (STAB-06.3: preferir emitir-nfce separado).
   */
  async finalizarVendaOficial(id, data = {}) {
    const response = await this.client.post(
      `/consignacoes/${id}/prestacao/finalizar-venda-oficial`,
      this._withUsuario(data)
    );
    return unwrapData(response);
  }

  /**
   * STAB-06.3 — emitir NFC-e (reutiliza venda oficial; não encerra).
   */
  async emitirNfcePrestacao(id, data = {}) {
    const response = await this.client.post(
      `/consignacoes/${id}/prestacao/emitir-nfce`,
      this._withUsuario(data),
      { timeout: 180000 }
    );
    return unwrapData(response);
  }

  async reabrirPrestacao(id, data = {}) {
    const response = await this.client.post(`/consignacoes/${id}/prestacao/reabrir`, this._withUsuario(data));
    return unwrapData(response);
  }

  async registrarVenda(id, data) {
    const payload = this._normalizePrestacaoWritePayload(data, { requirePreco: true });
    const response = await this.client.post(`/consignacoes/${id}/prestacao/venda`, this._withUsuario(payload));
    return unwrapData(response);
  }

  async registrarPerda(id, data) {
    const payload = this._normalizePrestacaoWritePayload(data);
    const response = await this.client.post(`/consignacoes/${id}/prestacao/perda`, this._withUsuario(payload));
    return unwrapData(response);
  }

  /** RC4.2 — Rateio inteligente de perdas */
  async obterRateioPerda(id) {
    const response = await this.client.get(`/consignacoes/${id}/prestacao/rateio-perda`);
    return unwrapData(response);
  }

  async definirRateioPerda(id, data = {}) {
    const response = await this.client.put(
      `/consignacoes/${id}/prestacao/rateio-perda`,
      this._withUsuario(data)
    );
    return unwrapData(response);
  }

  async obterIndicadoresRateioPerdas(params = {}) {
    const response = await this.client.get('/projections/rateio-perdas/indicadores', { params });
    return unwrapData(response);
  }

  async registrarCortesia(id, data) {
    const payload = this._normalizePrestacaoWritePayload(data);
    const response = await this.client.post(`/consignacoes/${id}/prestacao/cortesia`, this._withUsuario(payload));
    return unwrapData(response);
  }

  async registrarPagamento(id, data = {}, options = {}) {
    const payload = {
      ...data,
      valor: Number(String(data.valor ?? '').replace(',', '.')),
      formaPagamento: data.formaPagamento || 'DINHEIRO',
      observacao: data.observacao || null
    };
    const headers = options.headers || data.headers || {};
    delete payload.headers;
    const response = await this.client.post(
      `/consignacoes/${id}/prestacao/pagamento`,
      this._withUsuario(payload),
      { headers }
    );
    return unwrapData(response);
  }

  /**
   * Canal + preços da venda (RCM-04.5 / RA-6 / RCM-8.5) — compartilhado com PDV/Pedidos/Orçamentos.
   * @param {Array} itens
   * @param {Object} [opts] — { canal, tabela_preco_id, documento }
   */
  async resolverPrecosVenda(itens = [], opts = {}) {
    const payload = {
      itens: (itens || []).map((item) => ({
        produto_id: item.produto_id ?? item.produtoId ?? item.id,
        quantidade: Number(item.quantidade ?? 0),
        categoria_id: item.categoria_id ?? item.categoriaId ?? null,
        linha_comercial_id: item.linha_comercial_id ?? item.linhaComercialId ?? null
      })),
      documento: opts.documento || 'comercial'
    };
    if (opts.canal) payload.canal = String(opts.canal).toUpperCase();
    if (opts.tabela_preco_id) payload.tabela_preco_id = Number(opts.tabela_preco_id);
    if (opts.cliente_id || opts.clienteId) {
      payload.cliente_id = Number(opts.cliente_id ?? opts.clienteId);
    }
    const base = String(this.client.baseURL || 'http://localhost:3000/api/comercial').replace(/\/comercial\/?$/, '');
    const headers = { 'Content-Type': 'application/json' };
    if (typeof localStorage !== 'undefined') {
      const token = localStorage.getItem('token');
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    const response = await fetch(`${base}/configuracao-comercial/resolver-precos`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      throw new Error(errBody.erro || errBody.message || `HTTP ${response.status}`);
    }
    return response.json();
  }

  /**
   * RCM-8.5 — Comparar Tabelas (informativo).
   */
  async compararTabelasPrecificacao({ produtoId, canais } = {}) {
    const base = String(this.client.baseURL || 'http://localhost:3000/api/comercial').replace(/\/comercial\/?$/, '');
    const headers = { 'Content-Type': 'application/json' };
    if (typeof localStorage !== 'undefined') {
      const token = localStorage.getItem('token');
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    const response = await fetch(`${base}/configuracao-comercial/comparar-tabelas`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        produto_id: Number(produtoId),
        canais: canais || undefined
      })
    });
    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      throw new Error(errBody.erro || errBody.message || `HTTP ${response.status}`);
    }
    return response.json();
  }

  /**
   * RCM-7.2 — valida se o Tipo Comercial do cliente permite um canal.
   * @param {Object} opts — { cliente_id, canal }
   */
  async validarCanalTipoComercial(opts = {}) {
    const base = String(this.client.baseURL || 'http://localhost:3000/api/comercial').replace(/\/comercial\/?$/, '');
    const headers = { 'Content-Type': 'application/json' };
    if (typeof localStorage !== 'undefined') {
      const token = localStorage.getItem('token');
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    const response = await fetch(`${base}/tipos-comerciais/validar-canal`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        cliente_id: opts.cliente_id ?? opts.clienteId ?? null,
        canal: opts.canal || 'CONSIGNADO'
      })
    });
    if (!response.ok) {
      let body = null;
      try { body = await response.json(); } catch (_e) { /* ignore */ }
      throw new Error(extractErrorMessage(body) || `HTTP ${response.status}`);
    }
    return response.json();
  }

  /**
   * Alias de compatibilidade — lista prestações via consignações filtradas.
   * @param {Object} filters
   * @returns {Promise<Array>}
   */
  async listarPrestacoes(filters = {}) {
    const { items } = await this.listarConsignacoes({
      ...filters,
      status: filters.status || 'ENTREGUE'
    });
    return items;
  }
}

module.exports = MotorComercialApi;
