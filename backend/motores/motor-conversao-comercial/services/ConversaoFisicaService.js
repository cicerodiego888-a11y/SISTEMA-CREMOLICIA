/**
 * MCC-02 — Conversão Física por Lote
 *
 * Produto apenas declara que exige conversão física.
 * O fator vem SEMPRE do ConversaoFisicaLote — nunca do cadastro do produto.
 */

const { TipoConversao } = require('../domain/enums');
const ConversaoFisicaLote = require('../domain/ConversaoFisicaLote');
const ConversaoFisicaObrigatoriaError = require('../domain/ConversaoFisicaObrigatoriaError');
const repository = require('../repositories/ConversaoFisicaLoteRepository');

class ConversaoFisicaService {
  constructor(deps = {}) {
    this.repository = deps.repository || repository;
  }

  status() {
    return {
      preparado: true,
      implementado: true,
      tipo: TipoConversao.CONVERSAO_FISICA,
      mensagem: 'Conversão Física por Lote (MCC-02) ativa. Fator pertence ao lote.'
    };
  }

  /**
   * Produto exige conversão física? (flag apenas — sem fator)
   */
  produtoExigeFisica(produto = {}) {
    if (!produto || typeof produto !== 'object') return false;
    const flag = produto.utiliza_conversao_fisica ?? produto.utilizaConversaoFisica;
    return flag === true || flag === 1 || flag === '1';
  }

  exigeFisica(unidade, produto = {}) {
    if (this.produtoExigeFisica(produto)) return true;
    if (!unidade) return false;
    if (unidade.conversaoPorLote || unidade.conversao_por_lote) return true;
    if (unidade.tipo === TipoConversao.CONVERSAO_FISICA) return true;
    return false;
  }

  /**
   * Resolve ConversaoFisicaLote a partir da entrada do Converter.
   * Aceita objeto em memória, ou busca por lote_id no banco (se db informado).
   *
   * @returns {ConversaoFisicaLote}
   * @throws {ConversaoFisicaObrigatoriaError}
   */
  async resolverConversaoLote(entrada = {}, produto = {}) {
    const produtoId = typeof produto === 'object'
      ? (produto.id ?? produto.produto_id ?? null)
      : produto;

    const direto = entrada.conversaoFisicaLote
      || entrada.conversaoFisica
      || entrada.conversao_fisica_lote
      || null;

    if (direto) {
      const entidade = direto instanceof ConversaoFisicaLote
        ? direto
        : ConversaoFisicaLote.fromRow(direto);
      const v = entidade.validar();
      if (!v.ok) {
        throw new ConversaoFisicaObrigatoriaError(
          'Produto exige Conversão Física por Lote. Informe o peso do lote antes de movimentar o estoque.',
          { produtoId, loteId: entidade.loteId }
        );
      }
      if (entidade.ativa === false) {
        const err = new Error('Conversão física inativa. O MCC utiliza apenas a versão ativa.');
        err.status = 409;
        err.codigo = 'MCC_CONVERSAO_INATIVA';
        throw err;
      }
      return entidade;
    }

    const loteId = entrada.loteId ?? entrada.lote_id
      ?? (typeof entrada.lote === 'object' ? entrada.lote.id : entrada.lote)
      ?? null;

    if (loteId == null || loteId === '') {
      throw new ConversaoFisicaObrigatoriaError(undefined, { produtoId, loteId: null });
    }

    if (entrada.db && this.repository) {
      const row = await this.repository.buscarAtivaPorLoteId(entrada.db, Number(loteId));
      if (!row) {
        throw new ConversaoFisicaObrigatoriaError(undefined, {
          produtoId,
          loteId: Number(loteId)
        });
      }
      return row;
    }

    throw new ConversaoFisicaObrigatoriaError(undefined, {
      produtoId,
      loteId: Number(loteId)
    });
  }

  /**
   * Versão síncrona: exige conversaoFisicaLote em memória (testes / MCC sem I/O).
   */
  resolverConversaoLoteSync(entrada = {}, produto = {}) {
    const produtoId = typeof produto === 'object'
      ? (produto.id ?? produto.produto_id ?? null)
      : produto;

    const direto = entrada.conversaoFisicaLote
      || entrada.conversaoFisica
      || entrada.conversao_fisica_lote
      || null;

    if (!direto) {
      const loteId = entrada.loteId ?? entrada.lote_id
        ?? (typeof entrada.lote === 'object' ? entrada.lote?.id : entrada.lote)
        ?? null;
      throw new ConversaoFisicaObrigatoriaError(undefined, {
        produtoId,
        loteId: loteId != null ? Number(loteId) : null
      });
    }

    const entidade = direto instanceof ConversaoFisicaLote
      ? direto
      : ConversaoFisicaLote.fromRow(direto);
    const v = entidade.validar();
    if (!v.ok) {
      throw new ConversaoFisicaObrigatoriaError(undefined, {
        produtoId,
        loteId: entidade.loteId
      });
    }
    if (entidade.ativa === false) {
      const err = new Error('Conversão física inativa. O MCC utiliza apenas a versão ativa.');
      err.status = 409;
      err.codigo = 'MCC_CONVERSAO_INATIVA';
      throw err;
    }
    return entidade;
  }

  /**
   * Aplica conversão física: quantidade na unidade base → unidade destino do lote.
   */
  aplicarParaDestino(quantidadeNaBase, conversaoLote) {
    const q = Number(quantidadeNaBase);
    if (!Number.isFinite(q)) {
      const err = new Error('Quantidade inválida para conversão física.');
      err.status = 400;
      throw err;
    }
    if (conversaoLote.ativa === false) {
      const err = new Error('Não é permitido usar conversão física inativa. Utilize a versão ativa.');
      err.status = 409;
      err.codigo = 'MCC_CONVERSAO_INATIVA';
      throw err;
    }
    const convertida = conversaoLote.converterParaDestino(q);
    return {
      quantidadeConvertida: convertida,
      tipo: TipoConversao.CONVERSAO_FISICA,
      fator: conversaoLote.fator,
      unidadeOrigem: conversaoLote.unidadeBase,
      unidadeDestino: conversaoLote.unidadeDestino,
      loteUtilizado: {
        loteId: conversaoLote.loteId,
        loteCodigo: conversaoLote.loteCodigo,
        origem: conversaoLote.origem,
        fator: conversaoLote.fator,
        versao: conversaoLote.versao != null ? conversaoLote.versao : 1,
        conversaoId: conversaoLote.id
      },
      origemConversao: conversaoLote.origem,
      descricao: `${q} ${conversaoLote.unidadeBase} × ${conversaoLote.fator} = ${convertida} ${conversaoLote.unidadeDestino}`
    };
  }

  aplicarParaBase(quantidadeNoDestino, conversaoLote) {
    const q = Number(quantidadeNoDestino);
    if (!Number.isFinite(q)) {
      const err = new Error('Quantidade inválida para conversão física.');
      err.status = 400;
      throw err;
    }
    const convertida = conversaoLote.converterParaBase(q);
    return {
      quantidadeConvertida: convertida,
      tipo: TipoConversao.CONVERSAO_FISICA,
      fator: conversaoLote.fator,
      unidadeOrigem: conversaoLote.unidadeDestino,
      unidadeDestino: conversaoLote.unidadeBase,
      loteUtilizado: {
        loteId: conversaoLote.loteId,
        loteCodigo: conversaoLote.loteCodigo,
        origem: conversaoLote.origem,
        fator: conversaoLote.fator
      },
      origemConversao: conversaoLote.origem,
      descricao: `${q} ${conversaoLote.unidadeDestino} ÷ ${conversaoLote.fator} = ${convertida} ${conversaoLote.unidadeBase}`
    };
  }

  /** @deprecated MCC-01 stub — usa resolver + aplicar */
  paraBase(quantidade, conversaoLote) {
    if (!conversaoLote) {
      throw new ConversaoFisicaObrigatoriaError();
    }
    return this.aplicarParaBase(quantidade, conversaoLote);
  }

  deBase(quantidade, conversaoLote) {
    if (!conversaoLote) {
      throw new ConversaoFisicaObrigatoriaError();
    }
    return this.aplicarParaDestino(quantidade, conversaoLote);
  }
}

module.exports = ConversaoFisicaService;
