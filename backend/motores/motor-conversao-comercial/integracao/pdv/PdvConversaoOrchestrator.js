/**
 * PDV-01 — PdvConversaoOrchestrator
 *
 * Única camada autorizada a converter quantidade comercial → base no PDV.
 * Não cria ConversaoFisicaLote (isso é exclusivo da Entrada de Mercadorias).
 * Usa conversão física já existente no lote quando necessário.
 *
 * Fluxo: PDV → este orchestrator → MCC.Converter → quantidadeBase → MotorEstoque.sair
 */

const UnidadeNaoPermitidaError = require('../../domain/UnidadeNaoPermitidaError');
const ConversaoFisicaObrigatoriaError = require('../../domain/ConversaoFisicaObrigatoriaError');
const ConversaoFisicaLote = require('../../domain/ConversaoFisicaLote');
const { ContextoConversao, MOTOR_NOME } = require('../../domain/enums');
const ConversaoComercialService = require('../../services/ConversaoComercialService');
const ConversaoFisicaLoteRepository = require('../../repositories/ConversaoFisicaLoteRepository');
const { resolverUnidadeComercialOficial } = require('../../services/resolverUnidadeComercialOficial');

function flagOn(v) {
  return v === true || v === 1 || v === '1';
}

function parseCanais(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((c) => String(c).toLowerCase());
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map((c) => String(c).toLowerCase()) : [];
    } catch (_) {
      return [];
    }
  }
  return [];
}

class PdvConversaoOrchestrator {
  constructor(deps = {}) {
    this.mcc = deps.mcc || new ConversaoComercialService();
    this.repository = deps.repository || ConversaoFisicaLoteRepository;
  }

  /**
   * @param {object} entrada
   * @param {object} entrada.produto — com unidades_comercializacao
   * @param {number} entrada.quantidade — qtd comercial
   * @param {string} entrada.unidadeOrigem
   * @param {number|string} [entrada.loteId]
   * @param {object} [entrada.conversaoFisicaLote]
   * @param {string} [entrada.operacaoId]
   * @param {object} [entrada.db] — para carregar física do lote
   */
  processarItem(entrada = {}) {
    const produto = entrada.produto;
    if (!produto || typeof produto !== 'object') {
      const err = new Error('Informe o produto da venda.');
      err.status = 400;
      throw err;
    }

    const produtoId = produto.id ?? produto.produto_id;
    const unidadeBase = String(
      produto.unidade_base || produto.unidadeBase || produto.unidade || 'UN'
    ).trim().toUpperCase();

    let unidadeOrigem = String(
      entrada.unidadeOrigem || entrada.unidade || entrada.unidade_comercial || ''
    ).trim().toUpperCase();

    // Compatibilidade legado: sem UC → unidade base
    if (!unidadeOrigem) {
      unidadeOrigem = unidadeBase;
    }

    // RCM-8.8: Tabela define UC; produto só precisa da base. MUC converte.
    const unidadeComercial = this._resolverUnidadeComercial(produto, unidadeOrigem, unidadeBase);
    this._validarUnidadePermitidaPdv(produto, unidadeComercial, produtoId);

    const exigeFisica = flagOn(produto.utiliza_conversao_fisica ?? produto.utilizaConversaoFisica);
    let conversaoFisicaLote = entrada.conversaoFisicaLote || null;

    if (exigeFisica && !conversaoFisicaLote && entrada.loteId != null) {
      // Carregamento síncrono não disponível — caller Async deve pré-carregar
      throw new ConversaoFisicaObrigatoriaError(
        'Produto exige Conversão Física por Lote. Informe conversaoFisicaLote (versão ativa).',
        { produtoId, loteId: entrada.loteId }
      );
    }

    if (conversaoFisicaLote && !(conversaoFisicaLote instanceof ConversaoFisicaLote)
      && typeof conversaoFisicaLote === 'object') {
      conversaoFisicaLote = ConversaoFisicaLote.fromRow
        ? ConversaoFisicaLote.fromRow(conversaoFisicaLote)
        : conversaoFisicaLote;
    }

    const resultadoMcc = this.mcc.Converter({
      produto,
      quantidade: Number(entrada.quantidade),
      unidadeOrigem,
      contexto: ContextoConversao.PDV,
      unidadeBase,
      conversaoFisicaLote: conversaoFisicaLote || undefined,
      loteId: entrada.loteId ?? null,
      // Estoque permanece em unidade base; física só quando UC destino exige
      aplicarFisica: Boolean(conversaoFisicaLote) && flagOn(entrada.aplicarFisica),
      somenteUnidadeBase: !flagOn(entrada.aplicarFisica),
      operacaoId: entrada.operacaoId || null,
      unidadeOrigemObj: unidadeComercial
        ? {
            unidade_comercial: unidadeComercial.codigo,
            tipo: unidadeComercial.tipo,
            quantidade: unidadeComercial.quantidade,
            unidade_base: unidadeBase
          }
        : undefined
    });

    return {
      ok: true,
      produtoId,
      quantidadeInformada: Number(entrada.quantidade),
      unidadeOrigem,
      quantidadeConvertida: resultadoMcc.quantidadeConvertida,
      unidadeBase: resultadoMcc.unidadeBase,
      unidadeDestino: resultadoMcc.unidadeDestino,
      fatorAplicado: resultadoMcc.fatorAplicado,
      tipoConversao: resultadoMcc.tipoConversao || resultadoMcc.tipo,
      loteId: entrada.loteId ?? null,
      conversaoFisicaLote: conversaoFisicaLote
        ? (conversaoFisicaLote.toJSON ? conversaoFisicaLote.toJSON() : conversaoFisicaLote)
        : null,
      resultadoMcc: resultadoMcc.toJSON ? resultadoMcc.toJSON() : resultadoMcc,
      auditoria: {
        motor: MOTOR_NOME,
        sprint: 'PDV-01',
        contexto: ContextoConversao.PDV,
        produtoId,
        unidadeOrigem,
        quantidadeComercial: Number(entrada.quantidade),
        quantidadeBase: resultadoMcc.quantidadeConvertida,
        fatorAplicado: resultadoMcc.fatorAplicado,
        tipoConversao: resultadoMcc.tipoConversao || resultadoMcc.tipo,
        loteId: entrada.loteId ?? null,
        timestamp: new Date().toISOString()
      }
    };
  }

  async processarItemAsync(entrada = {}) {
    let conversaoFisicaLote = entrada.conversaoFisicaLote || null;
    const produto = entrada.produto || {};
    const exigeFisica = flagOn(produto.utiliza_conversao_fisica ?? produto.utilizaConversaoFisica);
    const loteId = entrada.loteId ?? entrada.lote_id ?? null;

    if (exigeFisica && !conversaoFisicaLote && loteId != null && entrada.db) {
      conversaoFisicaLote = await this.repository.buscarAtivaPorLoteId(entrada.db, loteId);
    }

    // Sem lote explícito: tenta primeira conversão ativa do produto (apresentação/venda física)
    if (exigeFisica && !conversaoFisicaLote && entrada.db && produto.id != null) {
      const lista = await this.repository.listarPorProduto(entrada.db, produto.id);
      const ativa = (lista || []).find((c) => c.ativa !== false && c.ativa !== 0);
      if (ativa) {
        conversaoFisicaLote = ativa;
        entrada = { ...entrada, loteId: ativa.loteId ?? ativa.lote_id ?? loteId };
      }
    }

    return this.processarItem({
      ...entrada,
      conversaoFisicaLote,
      aplicarFisica: false
    });
  }

  _resolverUnidadeComercial(produto, codigo, unidadeBase) {
    return resolverUnidadeComercialOficial({ produto, codigo, unidadeBase });
  }

  _validarUnidadePermitidaPdv(produto, unidade, produtoId) {
    const lista = produto.unidades_comercializacao || produto.unidades || [];
    if (!lista.length) return; // RCM-8.8: sem catálogo no produto → UC da tabela é válida

    const row = lista.find((u) => {
      const c = String(u.unidade_comercial || u.codigo || '').toUpperCase();
      return c === unidade.codigo;
    });
    // Sem linha no produto: conversão MUC já validada; canal não restringe
    if (!row) return;

    if (row.permite_pdv === 0 || row.permite_pdv === false) {
      throw new UnidadeNaoPermitidaError(
        `Unidade "${unidade.codigo}" não permitida no PDV.`,
        { unidade: unidade.codigo, produtoId }
      );
    }
    const canais = parseCanais(row.canais_comercializacao);
    if (canais.length && !canais.includes('pdv')) {
      throw new UnidadeNaoPermitidaError(
        `Unidade "${unidade.codigo}" sem canal PDV.`,
        { unidade: unidade.codigo, produtoId }
      );
    }
  }
}

module.exports = PdvConversaoOrchestrator;
