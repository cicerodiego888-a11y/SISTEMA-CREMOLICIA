/**
 * COM-01 — ComercialConversaoOrchestrator
 *
 * Única camada autorizada a converter quantidade comercial → base no Motor Comercial.
 * Não cria ConversaoFisicaLote (exclusivo da Entrada de Mercadorias).
 *
 * Fluxo: Consignação → este orchestrator → MCC.Converter → quantidadeBase → MotorEstoque
 */

const UnidadeNaoPermitidaError = require('../../domain/UnidadeNaoPermitidaError');
const ConversaoFisicaObrigatoriaError = require('../../domain/ConversaoFisicaObrigatoriaError');
const ConversaoFisicaLote = require('../../domain/ConversaoFisicaLote');
const { ContextoConversao, MOTOR_NOME } = require('../../domain/enums');
const ConversaoComercialService = require('../../services/ConversaoComercialService');
const ConversaoFisicaLoteRepository = require('../../repositories/ConversaoFisicaLoteRepository');
const { resolverUnidadeComercialOficial } = require('../../services/resolverUnidadeComercialOficial');

const CANAIS_COMERCIAIS = new Set([
  'comercial',
  'venda_erp',
  'venda_atacado',
  'venda_varejo',
  'consignacao',
  'orcamento'
]);

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

class ComercialConversaoOrchestrator {
  constructor(deps = {}) {
    this.mcc = deps.mcc || new ConversaoComercialService();
    this.repository = deps.repository || ConversaoFisicaLoteRepository;
  }

  processarItem(entrada = {}) {
    const produto = entrada.produto;
    if (!produto || typeof produto !== 'object') {
      const err = new Error('Informe o produto da consignação.');
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

    if (!unidadeOrigem) {
      unidadeOrigem = unidadeBase;
    }

    // RCM-8.8: UC vem da tabela/operação; MUC converte para a base
    const unidadeComercial = this._resolverUnidadeComercial(produto, unidadeOrigem, unidadeBase);
    this._validarUnidadePermitidaComercial(produto, unidadeComercial, produtoId);

    const exigeFisica = flagOn(produto.utiliza_conversao_fisica ?? produto.utilizaConversaoFisica);
    let conversaoFisicaLote = entrada.conversaoFisicaLote || null;

    if (exigeFisica && !conversaoFisicaLote && entrada.loteId != null) {
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
      contexto: ContextoConversao.COMERCIAL,
      unidadeBase,
      conversaoFisicaLote: conversaoFisicaLote || undefined,
      loteId: entrada.loteId ?? null,
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
        sprint: 'COM-01',
        contexto: ContextoConversao.COMERCIAL,
        produtoId,
        unidadeOrigem,
        quantidadeComercial: Number(entrada.quantidade),
        quantidadeBase: resultadoMcc.quantidadeConvertida,
        fatorAplicado: resultadoMcc.fatorAplicado,
        tipoConversao: resultadoMcc.tipoConversao || resultadoMcc.tipo,
        loteId: entrada.loteId ?? null,
        operacao: entrada.operacao || null,
        consignacaoId: entrada.consignacaoId ?? null,
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

  _validarUnidadePermitidaComercial(produto, unidade, produtoId) {
    const lista = produto.unidades_comercializacao || produto.unidades || [];
    if (!lista.length) return;

    const row = lista.find((u) => {
      const c = String(u.unidade_comercial || u.codigo || '').toUpperCase();
      return c === unidade.codigo;
    });
    // RCM-8.8: sem cadastro no produto → não bloqueia (conversão MUC já validada)
    if (!row) return;

    if (row.permite_venda === 0 || row.permite_venda === false) {
      throw new UnidadeNaoPermitidaError(
        `Unidade "${unidade.codigo}" não permitida para venda/consignação.`,
        { unidade: unidade.codigo, produtoId }
      );
    }
    const canais = parseCanais(row.canais_comercializacao);
    if (canais.length) {
      const ok = canais.some((c) => CANAIS_COMERCIAIS.has(c));
      if (!ok) {
        throw new UnidadeNaoPermitidaError(
          `Unidade "${unidade.codigo}" sem canal comercial.`,
          { unidade: unidade.codigo, produtoId }
        );
      }
    }
  }
}

module.exports = ComercialConversaoOrchestrator;
