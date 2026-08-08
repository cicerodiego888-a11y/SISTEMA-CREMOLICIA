/**
 * MCC-02 — ConversaoComercialService
 * Interface oficial: Converter()
 *
 * Fluxo físico:
 *   Produto exige Conversão Física?
 *     → SIM + lote → fator do lote
 *     → SIM sem lote → ConversaoFisicaObrigatoriaError
 *     → NÃO → conversão matemática (PADRAO/AGRUPAMENTO/FRACIONAMENTO)
 */

const { TipoConversao } = require('../domain/enums');
const UnidadeComercial = require('../domain/UnidadeComercial');
const ResultadoConversao = require('../domain/Conversao');
const ConversaoFisicaObrigatoriaError = require('../domain/ConversaoFisicaObrigatoriaError');
const { validarEntradaConverter } = require('../validators/ConversaoValidator');
const ConversaoAgrupamentoService = require('./ConversaoAgrupamentoService');
const ConversaoFracionamentoService = require('./ConversaoFracionamentoService');
const ConversaoFisicaService = require('./ConversaoFisicaService');
const ConversaoCompostaService = require('./ConversaoCompostaService');
const ConversaoCache = require('./ConversaoCache');
const { resolverUnidadeComercialOficial } = require('./resolverUnidadeComercialOficial');

class ConversaoComercialService {
  constructor(deps = {}) {
    this.agrupamento = deps.agrupamento || new ConversaoAgrupamentoService();
    this.fracionamento = deps.fracionamento || new ConversaoFracionamentoService();
    this.fisica = deps.fisica || new ConversaoFisicaService();
    this.composta = deps.composta || new ConversaoCompostaService({
      agrupamento: this.agrupamento,
      fracionamento: this.fracionamento,
      fisica: this.fisica
    });
    this.cache = deps.cache || new ConversaoCache();
  }

  /**
   * Interface oficial MCC (síncrona — conversaoFisicaLote em memória).
   * Para resolução async via DB use ConverterAsync().
   */
  Converter(entrada = {}) {
    const validacao = validarEntradaConverter(entrada);
    if (!validacao.ok) {
      const err = new Error(validacao.erros.join(' '));
      err.status = 400;
      err.erros = validacao.erros;
      throw err;
    }

    const d = validacao.dados;
    const produtoObj = typeof d.produto === 'object' ? d.produto : {};
    const produtoId = typeof d.produto === 'object'
      ? (d.produto.id ?? d.produto.produto_id ?? null)
      : d.produto;

    const loteId = d.loteId;
    const cacheKey = {
      produtoId,
      loteId,
      quantidade: d.quantidade,
      unidadeOrigem: d.unidadeOrigem,
      contexto: d.contexto,
      unidadeBase: d.unidadeBase
    };

    if (d.operacaoId) {
      const hit = this.cache.get(d.operacaoId, cacheKey);
      if (hit) {
        return new ResultadoConversao({ ...hit.toJSON(), cacheHit: true });
      }
    }

    const produtoExigeFisica = this.fisica.produtoExigeFisica(produtoObj);
    const cadeiaExigeFisica = Boolean(
      d.cadeia && d.cadeia.some((p) => String(p.tipo || '').toUpperCase() === TipoConversao.CONVERSAO_FISICA)
    );
    const exigeFisica = produtoExigeFisica || cadeiaExigeFisica;
    /** MCI-01: entrada grava fator no lote, mas quantidade de estoque permanece na base */
    const aplicarFisica = Boolean(d.aplicarFisica) && exigeFisica;

    let conversaoLote = null;
    if (exigeFisica && aplicarFisica) {
      conversaoLote = this.fisica.resolverConversaoLoteSync(
        {
          conversaoFisicaLote: d.conversaoFisicaLote,
          loteId: d.loteId,
          lote: d.lote
        },
        produtoObj
      );
    } else if (exigeFisica && d.conversaoFisicaLote) {
      conversaoLote = this.fisica.resolverConversaoLoteSync(
        { conversaoFisicaLote: d.conversaoFisicaLote },
        produtoObj
      );
    } else if (exigeFisica && !d.conversaoFisicaLote && aplicarFisica) {
      conversaoLote = this.fisica.resolverConversaoLoteSync(
        { loteId: d.loteId, lote: d.lote },
        produtoObj
      );
    }

    // Cadeia composta explícita
    if (d.cadeia && d.cadeia.length) {
      const composta = this.composta.executarCadeia(d.quantidade, d.cadeia, d.unidadeBase, {
        conversaoLote: aplicarFisica ? conversaoLote : null,
        produto: aplicarFisica ? produtoObj : { ...produtoObj, utiliza_conversao_fisica: 0 }
      });
      const resultado = this._montarResultadoComposta(d, composta, produtoId);
      if (d.operacaoId) this.cache.set(d.operacaoId, cacheKey, resultado);
      return resultado;
    }

    const unidade = this._resolverUnidade(d);
    const tipoResolvido = this._resolverTipo(unidade);

    // 1) Conversão matemática UC → base (quando origem ≠ base)
    let qtdNaBase = d.quantidade;
    let fatorMatematico = 1;
    let tipoMat = TipoConversao.PADRAO;
    const passos = [];

    if (tipoResolvido === TipoConversao.PADRAO || unidade.isPadrao || d.unidadeOrigem === d.unidadeBase) {
      tipoMat = TipoConversao.PADRAO;
      fatorMatematico = 1;
      passos.push({
        de: unidade.codigo,
        para: d.unidadeBase,
        fator: 1,
        tipo: TipoConversao.PADRAO,
        descricao: 'Identidade'
      });
    } else if (tipoResolvido === TipoConversao.FRACIONAMENTO) {
      const parcial = this.fracionamento.paraBase(d.quantidade, unidade);
      qtdNaBase = parcial.quantidadeConvertida;
      fatorMatematico = parcial.fator;
      tipoMat = parcial.tipo;
      passos.push({
        de: unidade.codigo,
        para: d.unidadeBase,
        fator: parcial.fator,
        tipo: parcial.tipo,
        descricao: parcial.descricao
      });
    } else if (tipoResolvido !== TipoConversao.CONVERSAO_FISICA) {
      const parcial = this.agrupamento.paraBase(d.quantidade, unidade);
      qtdNaBase = parcial.quantidadeConvertida;
      fatorMatematico = parcial.fator;
      tipoMat = parcial.tipo;
      passos.push({
        de: unidade.codigo,
        para: d.unidadeBase,
        fator: parcial.fator,
        tipo: parcial.tipo,
        descricao: parcial.descricao
      });
    }

    // 2) Conversão física base → destino (lote) — só quando aplicarFisica
    if (aplicarFisica && conversaoLote) {
      const fisico = this.fisica.aplicarParaDestino(qtdNaBase, conversaoLote);
      passos.push({
        de: conversaoLote.unidadeBase,
        para: conversaoLote.unidadeDestino,
        fator: fisico.fator,
        tipo: TipoConversao.CONVERSAO_FISICA,
        descricao: fisico.descricao,
        loteId: conversaoLote.loteId,
        origem: conversaoLote.origem
      });

      const temMatematicaReal = tipoMat !== TipoConversao.PADRAO
        && d.unidadeOrigem !== d.unidadeBase;
      const tipoFinal = temMatematicaReal
        ? TipoConversao.CONVERSAO_COMPOSTA
        : TipoConversao.CONVERSAO_FISICA;

      const auditoria = ResultadoConversao.criarAuditoria({
        produtoId,
        loteId: conversaoLote.loteId,
        loteCodigo: conversaoLote.loteCodigo,
        origem: d.unidadeOrigem,
        destino: conversaoLote.unidadeDestino,
        quantidadeEntrada: d.quantidade,
        quantidadeConvertida: fisico.quantidadeConvertida,
        tipo: tipoFinal,
        origemFisica: conversaoLote.origem,
        fator: fisico.fator,
        contexto: d.contexto,
        passos
      });

      const resultado = new ResultadoConversao({
        quantidadeOriginal: d.quantidade,
        unidadeOrigem: d.unidadeOrigem,
        quantidadeConvertida: fisico.quantidadeConvertida,
        unidadeDestino: conversaoLote.unidadeDestino,
        unidadeBase: d.unidadeBase,
        tipoConversao: tipoFinal,
        fatorAplicado: fisico.fator,
        loteUtilizado: fisico.loteUtilizado,
        origemConversao: conversaoLote.origem,
        contexto: d.contexto,
        precisao: d.precisao || { aplicado: false },
        auditoria,
        cadeia: passos
      });

      if (d.operacaoId) this.cache.set(d.operacaoId, cacheKey, resultado);
      return resultado;
    }

    // Sem física aplicada: resultado matemático (estoque na unidade base)
    const auditoria = ResultadoConversao.criarAuditoria({
      produtoId,
      loteId: conversaoLote?.loteId ?? null,
      loteCodigo: conversaoLote?.loteCodigo ?? null,
      origem: unidade.descricao || unidade.codigo,
      destino: d.unidadeBase,
      quantidadeEntrada: d.quantidade,
      quantidadeConvertida: qtdNaBase,
      tipo: tipoMat,
      origemFisica: conversaoLote?.origem ?? null,
      fator: conversaoLote?.fator ?? fatorMatematico,
      contexto: d.contexto,
      passos
    });

    const resultado = new ResultadoConversao({
      quantidadeOriginal: d.quantidade,
      unidadeOrigem: d.unidadeOrigem,
      quantidadeConvertida: qtdNaBase,
      unidadeDestino: d.unidadeBase,
      unidadeBase: d.unidadeBase,
      tipoConversao: tipoMat,
      fatorAplicado: conversaoLote?.fator ?? fatorMatematico,
      loteUtilizado: conversaoLote
        ? {
            loteId: conversaoLote.loteId,
            loteCodigo: conversaoLote.loteCodigo,
            origem: conversaoLote.origem,
            fator: conversaoLote.fator
          }
        : null,
      origemConversao: conversaoLote?.origem || unidade.codigo,
      contexto: d.contexto,
      precisao: d.precisao || { aplicado: false },
      auditoria,
      cadeia: passos
    });

    if (d.operacaoId) this.cache.set(d.operacaoId, cacheKey, resultado);
    return resultado;
  }

  async ConverterAsync(entrada = {}) {
    if (entrada.db && (entrada.loteId || entrada.lote_id) && !entrada.conversaoFisicaLote) {
      const produtoObj = typeof entrada.produto === 'object' ? entrada.produto : {};
      if (this.fisica.produtoExigeFisica(produtoObj)
        || (Array.isArray(entrada.cadeia)
          && entrada.cadeia.some((p) => String(p.tipo || '').toUpperCase() === TipoConversao.CONVERSAO_FISICA))) {
        const lote = await this.fisica.resolverConversaoLote(entrada, produtoObj);
        return this.Converter({ ...entrada, conversaoFisicaLote: lote });
      }
    }
    return this.Converter(entrada);
  }

  converter(entrada) {
    return this.Converter(entrada);
  }

  limparCache(operacaoId) {
    this.cache.limpar(operacaoId);
  }

  _resolverTipo(unidade) {
    const t = String(unidade.tipo || '').toUpperCase();
    if (t === TipoConversao.FRACIONAMENTO) return TipoConversao.FRACIONAMENTO;
    if (t === TipoConversao.PADRAO) return TipoConversao.PADRAO;
    if (t === TipoConversao.CONVERSAO_FISICA) return TipoConversao.CONVERSAO_FISICA;
    if (t === TipoConversao.CONVERSAO_COMPOSTA) return TipoConversao.CONVERSAO_COMPOSTA;
    return TipoConversao.AGRUPAMENTO;
  }

  _resolverUnidade(d) {
    if (d.unidadeOrigemObj) {
      return UnidadeComercial.fromUc01Row(
        {
          ...d.unidadeOrigemObj,
          unidade_comercial: d.unidadeOrigemObj.unidade_comercial || d.unidadeOrigemObj.codigo || d.unidadeOrigem,
          unidade_base: d.unidadeBase
        },
        d.unidadeBase
      );
    }

    // RCM-8.8: não exige UC pré-cadastrada no produto; MUC resolve ou erro de conversão
    const produto = typeof d.produto === 'object' && d.produto
      ? {
          ...d.produto,
          unidades_comercializacao: d.unidades || d.produto.unidades_comercializacao || d.produto.unidades
        }
      : { unidades_comercializacao: d.unidades || [] };

    return resolverUnidadeComercialOficial({
      produto,
      codigo: d.unidadeOrigem,
      unidadeBase: d.unidadeBase
    });
  }

  _montarResultadoComposta(d, composta, produtoId) {
    if (composta.fisicaPendente) {
      throw new ConversaoFisicaObrigatoriaError(undefined, {
        produtoId,
        loteId: null
      });
    }

    const auditoria = ResultadoConversao.criarAuditoria({
      produtoId,
      loteId: composta.loteUtilizado?.loteId ?? null,
      loteCodigo: composta.loteUtilizado?.loteCodigo ?? null,
      origem: composta.cadeia[0]?.de || d.unidadeOrigem,
      destino: composta.unidadeDestino || d.unidadeBase,
      quantidadeEntrada: d.quantidade,
      quantidadeConvertida: composta.quantidadeConvertida,
      tipo: TipoConversao.CONVERSAO_COMPOSTA,
      origemFisica: composta.origemConversao,
      fator: composta.fatorAplicado,
      contexto: d.contexto,
      passos: composta.cadeia
    });

    return new ResultadoConversao({
      quantidadeOriginal: d.quantidade,
      unidadeOrigem: d.unidadeOrigem,
      quantidadeConvertida: composta.quantidadeConvertida,
      unidadeDestino: composta.unidadeDestino || d.unidadeBase,
      unidadeBase: d.unidadeBase,
      tipoConversao: TipoConversao.CONVERSAO_COMPOSTA,
      fatorAplicado: composta.fatorAplicado != null ? composta.fatorAplicado : null,
      loteUtilizado: composta.loteUtilizado,
      origemConversao: composta.origemConversao || d.unidadeOrigem,
      contexto: d.contexto,
      precisao: d.precisao || { aplicado: false },
      auditoria,
      cadeia: composta.cadeia
    });
  }
}

module.exports = ConversaoComercialService;
