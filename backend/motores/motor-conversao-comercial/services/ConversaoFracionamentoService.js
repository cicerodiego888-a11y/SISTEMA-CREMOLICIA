/**
 * MCC-01 — Conversão por Fracionamento
 * Ex.: 1 UN = 0.5 KG (fração da base) ou bobina → metro
 * Mesma matemática do agrupamento: quantidade = fator em relação à base.
 * Tipagem distinta para auditoria e evolução futura.
 */

const { TipoConversao } = require('../domain/enums');

class ConversaoFracionamentoService {
  paraBase(quantidadeComercial, unidade) {
    const q = Number(quantidadeComercial);
    const fator = Number(unidade?.quantidade ?? 1);
    if (!Number.isFinite(q) || !Number.isFinite(fator) || fator <= 0) {
      const err = new Error('Fator de fracionamento inválido.');
      err.status = 400;
      throw err;
    }
    return {
      quantidadeConvertida: q * fator,
      tipo: TipoConversao.FRACIONAMENTO,
      fator,
      descricao: `${q} ${unidade.codigo} × ${fator} = ${q * fator} ${unidade.unidadeBase}`
    };
  }

  deBase(quantidadeBase, unidade) {
    const q = Number(quantidadeBase);
    const fator = Number(unidade?.quantidade ?? 1);
    if (!Number.isFinite(q) || !Number.isFinite(fator) || fator <= 0) {
      const err = new Error('Fator de fracionamento inválido.');
      err.status = 400;
      throw err;
    }
    return {
      quantidadeConvertida: q / fator,
      tipo: TipoConversao.FRACIONAMENTO,
      fator,
      descricao: `${q} ${unidade.unidadeBase} ÷ ${fator} = ${q / fator} ${unidade.codigo}`
    };
  }
}

module.exports = ConversaoFracionamentoService;
