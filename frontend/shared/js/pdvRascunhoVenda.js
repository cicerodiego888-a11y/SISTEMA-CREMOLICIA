/**
 * RCM-8.14 — Persistência de rascunho de venda do PDV (sessionStorage).
 *
 * NÃO cria venda, fiscal, estoque, Ledger ou financeiro.
 * Somente preserva o estado comercial em andamento na sessão.
 *
 * @module frontend/shared/js/pdvRascunhoVenda
 */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.PdvRascunhoVenda = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function () {
  const VERSION = 1;
  const PREFIX = 'cds_pdv_rascunho_v1';

  const CAMPOS_CLIENTE_PERMITIDOS = Object.freeze([
    'id', 'nome', 'cpf_cnpj', 'telefone', 'email'
  ]);

  const CAMPOS_ITEM_BLOQUEADOS = Object.freeze([
    'tef', 'tef_transacao_id', 'nsu', 'autorizacao', 'cvv', 'cartao',
    'token', 'senha', 'pan', 'numero_cartao'
  ]);

  function obterStorage() {
    try {
      if (typeof sessionStorage === 'undefined' || !sessionStorage) return null;
      const probe = `__cds_pdv_rascunho_probe_${Date.now()}`;
      sessionStorage.setItem(probe, '1');
      sessionStorage.removeItem(probe);
      return sessionStorage;
    } catch (_e) {
      return null;
    }
  }

  function sanitizarCliente(cliente) {
    if (!cliente || typeof cliente !== 'object') return null;
    const out = {};
    CAMPOS_CLIENTE_PERMITIDOS.forEach((k) => {
      if (cliente[k] != null && cliente[k] !== '') out[k] = cliente[k];
    });
    if (out.id == null && !out.nome) return null;
    return out;
  }

  function sanitizarItemCarrinho(item) {
    if (!item || typeof item !== 'object') return null;
    const out = {};
    Object.keys(item).forEach((k) => {
      if (CAMPOS_ITEM_BLOQUEADOS.includes(k)) return;
      const v = item[k];
      if (typeof v === 'function') return;
      out[k] = v;
    });
    if (out.id == null && out.produto_id == null) return null;
    return out;
  }

  function sanitizarVendaPrazoInfo(info) {
    if (!info || typeof info !== 'object') return null;
    return {
      data_vencimento: info.data_vencimento || info.dataVencimento || null,
      parcelas: info.parcelas != null ? Number(info.parcelas) : null,
      observacao: info.observacao != null ? String(info.observacao) : null
    };
  }

  /**
   * @param {{ terminal?: string|null, usuarioId?: string|number|null }} [ctx]
   * @returns {string}
   */
  function obterChave(ctx = {}) {
    const terminal = String(ctx.terminal || ctx.hostname || 'sem-terminal')
      .trim()
      .toLowerCase()
      .replace(/[^\w.-]+/g, '_')
      .slice(0, 80) || 'sem-terminal';
    const usuario = ctx.usuarioId != null && String(ctx.usuarioId).trim() !== ''
      ? String(ctx.usuarioId).trim()
      : 'anon';
    return `${PREFIX}:${terminal}:${usuario}`;
  }

  /**
   * Monta payload serializável a partir do estado do PDV.
   * @param {Object} estado
   * @returns {Object|null}
   */
  function montarPayload(estado = {}) {
    const carrinho = Array.isArray(estado.carrinho)
      ? estado.carrinho.map(sanitizarItemCarrinho).filter(Boolean)
      : [];

    return {
      version: VERSION,
      savedAt: new Date().toISOString(),
      carrinho,
      clienteSelecionado: sanitizarCliente(estado.clienteSelecionado),
      formaPagamentoSelecionada: estado.formaPagamentoSelecionada
        ? String(estado.formaPagamentoSelecionada)
        : null,
      vendaPrazoInfo: sanitizarVendaPrazoInfo(estado.vendaPrazoInfo),
      canalVendaPdv: estado.canalVendaPdv
        ? String(estado.canalVendaPdv).toUpperCase()
        : 'VAREJO',
      canalManualForcadoPdv: estado.canalManualForcadoPdv
        ? String(estado.canalManualForcadoPdv).toUpperCase()
        : null,
      pdvEmitirFiscalNaVenda: estado.pdvEmitirFiscalNaVenda === true
        ? true
        : (estado.pdvEmitirFiscalNaVenda === false ? false : null),
      desconto: Number(estado.desconto) || 0,
      acrescimo: Number(estado.acrescimo) || 0
    };
  }

  function isPayloadValido(data) {
    if (!data || typeof data !== 'object') return false;
    if (Number(data.version) !== VERSION) return false;
    if (!Array.isArray(data.carrinho)) return false;
    return true;
  }

  function possuiConteudoComercial(payload) {
    if (!payload) return false;
    if (Array.isArray(payload.carrinho) && payload.carrinho.length > 0) return true;
    if (payload.clienteSelecionado && payload.clienteSelecionado.id != null) return true;
    if (Number(payload.desconto) > 0 || Number(payload.acrescimo) > 0) return true;
    return false;
  }

  /**
   * @param {Object} estado
   * @param {{ terminal?: string, usuarioId?: string|number }} [ctx]
   * @param {{ permitirRemoverSeVazio?: boolean }} [opts]
   *   RCM-8.14.2 — `permitirRemoverSeVazio: false` evita removeItem durante bootstrap.
   *   Ação explícita (limpar/cancelar/finalizar) usa limparRascunhoVendaPdv().
   * @returns {boolean}
   */
  function salvarRascunhoVendaPdv(estado, ctx, opts) {
    const storage = obterStorage();
    if (!storage) return false;
    const permitirRemoverSeVazio = !opts || opts.permitirRemoverSeVazio !== false;
    try {
      const payload = montarPayload(estado);
      const chave = obterChave(ctx);
      if (!possuiConteudoComercial(payload)) {
        if (!permitirRemoverSeVazio) return false;
        storage.removeItem(chave);
        return true;
      }
      storage.setItem(chave, JSON.stringify(payload));
      return true;
    } catch (_e) {
      return false;
    }
  }

  /**
   * @param {{ terminal?: string, usuarioId?: string|number }} [ctx]
   * @returns {Object|null}
   */
  function restaurarRascunhoVendaPdv(ctx) {
    const storage = obterStorage();
    if (!storage) return null;
    try {
      const raw = storage.getItem(obterChave(ctx));
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!isPayloadValido(data)) return null;
      if (!possuiConteudoComercial(data)) return null;
      return data;
    } catch (_e) {
      return null;
    }
  }

  /**
   * @param {{ terminal?: string, usuarioId?: string|number }} [ctx]
   * @returns {boolean}
   */
  function limparRascunhoVendaPdv(ctx) {
    const storage = obterStorage();
    if (!storage) return false;
    try {
      storage.removeItem(obterChave(ctx));
      return true;
    } catch (_e) {
      return false;
    }
  }

  /**
   * @param {{ terminal?: string, usuarioId?: string|number }} [ctx]
   * @returns {boolean}
   */
  function possuiRascunhoVendaPdv(ctx) {
    return restaurarRascunhoVendaPdv(ctx) != null;
  }

  function calcularTotalRascunho(payload) {
    if (!payload || !Array.isArray(payload.carrinho)) return 0;
    const subtotal = payload.carrinho.reduce(
      (acc, item) => acc + Number(item.subtotal != null
        ? item.subtotal
        : (Number(item.quantidade || 0) * Number(item.preco_unitario || item.preco || 0))),
      0
    );
    return Math.max(0, subtotal - (Number(payload.desconto) || 0) + (Number(payload.acrescimo) || 0));
  }

  function resumoRascunho(payload) {
    const qtdItens = Array.isArray(payload?.carrinho) ? payload.carrinho.length : 0;
    const total = calcularTotalRascunho(payload);
    const clienteNome = payload?.clienteSelecionado?.nome || null;
    return { quantidadeItens: qtdItens, total, clienteNome };
  }

  return {
    VERSION,
    PREFIX,
    obterChave,
    montarPayload,
    isPayloadValido,
    possuiConteudoComercial,
    salvarRascunhoVendaPdv,
    restaurarRascunhoVendaPdv,
    limparRascunhoVendaPdv,
    possuiRascunhoVendaPdv,
    calcularTotalRascunho,
    resumoRascunho,
    sanitizarCliente,
    sanitizarItemCarrinho
  };
}));
