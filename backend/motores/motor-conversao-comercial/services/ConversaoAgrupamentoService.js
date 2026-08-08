/**
 * MCC-01 — Conversão por Agrupamento
 * Ex.: 1 CX = 12 UN → 5 CX = 60 UN
 * quantidade UC-01 = quantas unidades base cabem em 1 unidade comercial.
 */

const { TipoConversao } = require('../domain/enums');

class ConversaoAgrupamentoService {
  /**
   * Comercial → Base
   * @param {number} quantidadeComercial
   * @param {import('../domain/UnidadeComercial')} unidade
   */
  paraBase(quantidadeComercial, unidade) {
    const q = Number(quantidadeComercial);
    const fator = Number(unidade?.quantidade ?? 1);
    if (!Number.isFinite(q) || !Number.isFinite(fator) || fator <= 0) {
      const err = new Error('Fator de agrupamento inválido.');
      err.status = 400;
      throw err;
    }
    return {
      quantidadeConvertida: q * fator,
      tipo: TipoConversao.AGRUPAMENTO,
      fator,
      descricao: `${q} ${unidade.codigo} × ${fator} = ${q * fator} ${unidade.unidadeBase}`
    };
  }

  /**
   * Base → Comercial
   */
  deBase(quantidadeBase, unidade) {
    const q = Number(quantidadeBase);
    const fator = Number(unidade?.quantidade ?? 1);
    if (!Number.isFinite(q) || !Number.isFinite(fator) || fator <= 0) {
      const err = new Error('Fator de agrupamento inválido.');
      err.status = 400;
      throw err;
    }
    return {
      quantidadeConvertida: q / fator,
      tipo: TipoConversao.AGRUPAMENTO,
      fator,
      descricao: `${q} ${unidade.unidadeBase} ÷ ${fator} = ${q / fator} ${unidade.codigo}`
    };
  }
}

module.exports = ConversaoAgrupamentoService;
