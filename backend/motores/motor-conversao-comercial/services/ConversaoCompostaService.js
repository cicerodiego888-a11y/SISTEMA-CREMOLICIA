/**
 * MCC-02 — Conversão Composta (cadeia) com suporte a elo físico por lote
 * Ex.: Caixa → Litro → Kg
 */

const { TipoConversao } = require('../domain/enums');
const ConversaoAgrupamentoService = require('./ConversaoAgrupamentoService');
const ConversaoFracionamentoService = require('./ConversaoFracionamentoService');
const ConversaoFisicaService = require('./ConversaoFisicaService');
const UnidadeComercial = require('../domain/UnidadeComercial');
const ConversaoFisicaObrigatoriaError = require('../domain/ConversaoFisicaObrigatoriaError');

class ConversaoCompostaService {
  constructor(deps = {}) {
    this.agrupamento = deps.agrupamento || new ConversaoAgrupamentoService();
    this.fracionamento = deps.fracionamento || new ConversaoFracionamentoService();
    this.fisica = deps.fisica || new ConversaoFisicaService();
  }

  /**
   * @param {number} quantidadeInicial
   * @param {Array<object>} passos
   * @param {string} unidadeBaseFinal
   * @param {object} [opts]
   * @param {import('../domain/ConversaoFisicaLote')} [opts.conversaoLote]
   * @param {object} [opts.produto]
   */
  executarCadeia(quantidadeInicial, passos = [], unidadeBaseFinal = '', opts = {}) {
    if (!Array.isArray(passos) || passos.length === 0) {
      const err = new Error('Cadeia de conversão composta vazia.');
      err.status = 400;
      throw err;
    }

    let qty = Number(quantidadeInicial);
    const trilha = [];
    let conversaoLoteUsada = null;
    let fatorFisico = null;
    let origemFisica = null;
    let unidadeDestinoFinal = String(unidadeBaseFinal || '').toUpperCase();

    for (let i = 0; i < passos.length; i++) {
      const passo = passos[i];
      const tipo = String(passo.tipo || TipoConversao.AGRUPAMENTO).toUpperCase();
      const unidade = passo.unidade instanceof UnidadeComercial
        ? passo.unidade
        : new UnidadeComercial({
            codigo: passo.de || passo.unidade_comercial,
            tipo,
            quantidade: passo.quantidade != null ? passo.quantidade : passo.fator,
            unidadeBase: passo.para || passo.unidade_base || unidadeBaseFinal
          });

      // Só o elo explícito de física usa o lote — a flag do produto NÃO transforma
      // passos matemáticos (CX→L) em conversão física.
      const precisaFisica = tipo === TipoConversao.CONVERSAO_FISICA
        || String(unidade.tipo || '').toUpperCase() === TipoConversao.CONVERSAO_FISICA
        || Boolean(unidade.conversaoPorLote || unidade.conversao_por_lote);

      if (precisaFisica) {
        const lote = opts.conversaoLote
          || (passo.conversaoFisicaLote
            ? this.fisica.resolverConversaoLoteSync(
              { conversaoFisicaLote: passo.conversaoFisicaLote },
              opts.produto || {}
            )
            : null);

        if (!lote) {
          throw new ConversaoFisicaObrigatoriaError(undefined, {
            produtoId: opts.produto?.id ?? null,
            loteId: null
          });
        }

        const fisico = this.fisica.aplicarParaDestino(qty, lote);
        conversaoLoteUsada = fisico.loteUtilizado;
        fatorFisico = fisico.fator;
        origemFisica = fisico.origemConversao;
        unidadeDestinoFinal = fisico.unidadeDestino;

        trilha.push({
          ordem: i + 1,
          de: passo.de || lote.unidadeBase,
          para: passo.para || lote.unidadeDestino,
          tipo: TipoConversao.CONVERSAO_FISICA,
          quantidadeEntrada: qty,
          quantidadeSaida: fisico.quantidadeConvertida,
          fator: fisico.fator,
          loteId: lote.loteId,
          origem: lote.origem,
          status: 'OK'
        });
        qty = fisico.quantidadeConvertida;
        continue;
      }

      let resultado;
      if (tipo === TipoConversao.PADRAO || unidade.isPadrao) {
        resultado = {
          quantidadeConvertida: qty,
          tipo: TipoConversao.PADRAO,
          fator: 1,
          descricao: 'Identidade (PADRAO)'
        };
      } else if (tipo === TipoConversao.FRACIONAMENTO) {
        resultado = this.fracionamento.paraBase(qty, unidade);
      } else {
        resultado = this.agrupamento.paraBase(qty, unidade);
      }

      trilha.push({
        ordem: i + 1,
        de: passo.de || unidade.codigo,
        para: passo.para || unidade.unidadeBase,
        tipo: resultado.tipo,
        quantidadeEntrada: qty,
        quantidadeSaida: resultado.quantidadeConvertida,
        fator: resultado.fator,
        status: 'OK'
      });
      qty = resultado.quantidadeConvertida;
      unidadeDestinoFinal = String(passo.para || unidade.unidadeBase || unidadeDestinoFinal).toUpperCase();
    }

    return {
      quantidadeConvertida: qty,
      tipo: TipoConversao.CONVERSAO_COMPOSTA,
      cadeia: trilha,
      fisicaPendente: false,
      unidadeBase: String(unidadeBaseFinal || '').toUpperCase(),
      unidadeDestino: unidadeDestinoFinal,
      loteUtilizado: conversaoLoteUsada,
      fatorAplicado: fatorFisico,
      origemConversao: origemFisica,
      arquiteturaPreparada: true,
      implementacaoCompleta: true
    };
  }
}

module.exports = ConversaoCompostaService;
