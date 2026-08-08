/**
 * EST-MCC-01 — EstoqueAdjustmentOrchestrator
 *
 * Única camada autorizada a converter quantidade comercial → base no Ajuste de Estoque.
 * Não cria ConversaoFisicaLote (exclusivo da Entrada de Mercadorias).
 * Usa conversão física ativa do produto/lote quando a unidade escolhida é a física.
 *
 * Fluxo: Ajuste UI → este orchestrator → MCC → quantidadeBase → MotorEstoque.ajustar
 */

const ConversaoFisicaObrigatoriaError = require('../../domain/ConversaoFisicaObrigatoriaError');
const ConversaoFisicaLote = require('../../domain/ConversaoFisicaLote');
const { ContextoConversao, TipoConversao, MOTOR_NOME } = require('../../domain/enums');
const ConversaoComercialService = require('../../services/ConversaoComercialService');
const ConversaoFisicaService = require('../../services/ConversaoFisicaService');
const ConversaoFisicaLoteRepository = require('../../repositories/ConversaoFisicaLoteRepository');
const { resolverUnidadeComercialOficial } = require('../../services/resolverUnidadeComercialOficial');

function flagOn(v) {
  return v === true || v === 1 || v === '1';
}

class EstoqueAdjustmentOrchestrator {
  constructor(deps = {}) {
    this.mcc = deps.mcc || new ConversaoComercialService();
    this.fisica = deps.fisica || this.mcc.fisica || new ConversaoFisicaService();
    this.repository = deps.repository || ConversaoFisicaLoteRepository;
  }

  /**
   * @param {object} entrada
   * @param {object} entrada.produto
   * @param {number} entrada.quantidade — qtd na unidade escolhida (pode ser negativa; usa abs na conversão)
   * @param {string} entrada.unidadeOrigem
   * @param {object} [entrada.conversaoFisicaLote]
   * @param {number} [entrada.loteId]
   * @param {string} [entrada.operacaoId]
   */
  processarItem(entrada = {}) {
    const produto = entrada.produto;
    if (!produto || typeof produto !== 'object') {
      const err = new Error('Informe o produto do ajuste.');
      err.status = 400;
      throw err;
    }

    const produtoId = produto.id ?? produto.produto_id;
    const unidadeBase = String(
      produto.unidade_base || produto.unidadeBase || produto.unidade || 'UN'
    ).trim().toUpperCase();
    const unidadeFisica = String(
      produto.unidade_conversao_fisica || produto.unidadeConversaoFisica || 'KG'
    ).trim().toUpperCase();

    let unidadeOrigem = String(
      entrada.unidadeOrigem || entrada.unidade || entrada.unidade_comercial || ''
    ).trim().toUpperCase();

    if (!unidadeOrigem) {
      unidadeOrigem = unidadeBase;
    }

    const quantidadeRaw = Number(entrada.quantidade);
    if (!Number.isFinite(quantidadeRaw) || quantidadeRaw === 0) {
      const err = new Error('Informe uma quantidade diferente de zero.');
      err.status = 400;
      throw err;
    }
    const sinal = quantidadeRaw < 0 ? -1 : 1;
    const quantidadeAbs = Math.abs(quantidadeRaw);

    const exigeFisica = flagOn(produto.utiliza_conversao_fisica ?? produto.utilizaConversaoFisica);
    const origemEhFisica = exigeFisica && unidadeOrigem === unidadeFisica && unidadeOrigem !== unidadeBase;

    let conversaoFisicaLote = entrada.conversaoFisicaLote || null;
    if (conversaoFisicaLote && !(conversaoFisicaLote instanceof ConversaoFisicaLote)
      && typeof conversaoFisicaLote === 'object') {
      conversaoFisicaLote = ConversaoFisicaLote.fromRow
        ? ConversaoFisicaLote.fromRow(conversaoFisicaLote)
        : conversaoFisicaLote;
    }

    // Ajuste na unidade física (ex.: KG) → base via fator do lote (MCC)
    if (origemEhFisica) {
      if (!conversaoFisicaLote) {
        throw new ConversaoFisicaObrigatoriaError(
          'Produto exige Conversão Física por Lote. Não há conversão ativa para ajustar em '
            + `${unidadeFisica}. Ajuste em ${unidadeBase} ou registre a física na Entrada.`,
          { produtoId, loteId: entrada.loteId ?? null }
        );
      }
      const fisico = this.fisica.aplicarParaBase(quantidadeAbs, conversaoFisicaLote);
      const quantidadeBase = Number((fisico.quantidadeConvertida * sinal).toFixed(6));

      return this._resultado({
        produtoId,
        quantidadeInformada: quantidadeRaw,
        unidadeOrigem,
        quantidadeConvertida: quantidadeBase,
        unidadeBase,
        fatorAplicado: fisico.fator,
        tipoConversao: TipoConversao.CONVERSAO_FISICA,
        loteId: conversaoFisicaLote.loteId ?? entrada.loteId ?? null,
        conversaoFisicaLote,
        resultadoMcc: {
          quantidadeOriginal: quantidadeAbs,
          unidadeOrigem,
          quantidadeConvertida: fisico.quantidadeConvertida,
          unidadeDestino: unidadeBase,
          unidadeBase,
          tipoConversao: TipoConversao.CONVERSAO_FISICA,
          fatorAplicado: fisico.fator,
          contexto: ContextoConversao.AJUSTE_ESTOQUE
        }
      });
    }

    let unidadeComercial = this._resolverUnidadeComercial(produto, unidadeOrigem, unidadeBase);

    const resultadoMcc = this.mcc.Converter({
      produto,
      quantidade: quantidadeAbs,
      unidadeOrigem,
      contexto: ContextoConversao.AJUSTE_ESTOQUE,
      unidadeBase,
      conversaoFisicaLote: conversaoFisicaLote || undefined,
      loteId: entrada.loteId ?? null,
      aplicarFisica: false,
      somenteUnidadeBase: true,
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

    const quantidadeBase = Number((resultadoMcc.quantidadeConvertida * sinal).toFixed(6));

    return this._resultado({
      produtoId,
      quantidadeInformada: quantidadeRaw,
      unidadeOrigem,
      quantidadeConvertida: quantidadeBase,
      unidadeBase: resultadoMcc.unidadeBase,
      fatorAplicado: resultadoMcc.fatorAplicado,
      tipoConversao: resultadoMcc.tipoConversao || resultadoMcc.tipo,
      loteId: entrada.loteId ?? null,
      conversaoFisicaLote,
      resultadoMcc: resultadoMcc.toJSON ? resultadoMcc.toJSON() : resultadoMcc
    });
  }

  async processarItemAsync(entrada = {}) {
    let conversaoFisicaLote = entrada.conversaoFisicaLote || null;
    const produto = entrada.produto || {};
    const exigeFisica = flagOn(produto.utiliza_conversao_fisica ?? produto.utilizaConversaoFisica);
    const unidadeBase = String(
      produto.unidade_base || produto.unidadeBase || produto.unidade || 'UN'
    ).trim().toUpperCase();
    const unidadeFisica = String(
      produto.unidade_conversao_fisica || produto.unidadeConversaoFisica || 'KG'
    ).trim().toUpperCase();
    const unidadeOrigem = String(
      entrada.unidadeOrigem || entrada.unidade || entrada.unidade_comercial || unidadeBase
    ).trim().toUpperCase();
    const origemEhFisica = exigeFisica && unidadeOrigem === unidadeFisica && unidadeOrigem !== unidadeBase;
    const loteId = entrada.loteId ?? entrada.lote_id ?? null;

    if (exigeFisica && !conversaoFisicaLote && loteId != null && entrada.db) {
      conversaoFisicaLote = await this.repository.buscarAtivaPorLoteId(entrada.db, loteId);
    }

    if (exigeFisica && !conversaoFisicaLote && entrada.db && (produto.id != null || origemEhFisica)) {
      const lista = await this.repository.listarPorProduto(entrada.db, produto.id);
      const ativa = (lista || []).find((c) => c.ativa !== false && c.ativa !== 0);
      if (ativa) {
        conversaoFisicaLote = ativa;
        entrada = { ...entrada, loteId: ativa.loteId ?? ativa.lote_id ?? loteId };
      }
    }

    return this.processarItem({
      ...entrada,
      conversaoFisicaLote
    });
  }

  _resultado(props) {
    return {
      ok: true,
      produtoId: props.produtoId,
      quantidadeInformada: props.quantidadeInformada,
      unidadeOrigem: props.unidadeOrigem,
      quantidadeConvertida: props.quantidadeConvertida,
      unidadeBase: props.unidadeBase,
      unidadeDestino: props.unidadeBase,
      fatorAplicado: props.fatorAplicado,
      tipoConversao: props.tipoConversao,
      loteId: props.loteId,
      conversaoFisicaLote: props.conversaoFisicaLote
        ? (props.conversaoFisicaLote.toJSON
          ? props.conversaoFisicaLote.toJSON()
          : props.conversaoFisicaLote)
        : null,
      resultadoMcc: props.resultadoMcc,
      auditoria: {
        motor: MOTOR_NOME,
        sprint: 'EST-MCC-01',
        contexto: ContextoConversao.AJUSTE_ESTOQUE,
        produtoId: props.produtoId,
        unidadeOrigem: props.unidadeOrigem,
        quantidadeComercial: props.quantidadeInformada,
        quantidadeBase: props.quantidadeConvertida,
        fatorAplicado: props.fatorAplicado,
        tipoConversao: props.tipoConversao,
        loteId: props.loteId,
        timestamp: new Date().toISOString()
      }
    };
  }

  _resolverUnidadeComercial(produto, codigo, unidadeBase) {
    return resolverUnidadeComercialOficial({ produto, codigo, unidadeBase });
  }
}

module.exports = EstoqueAdjustmentOrchestrator;
