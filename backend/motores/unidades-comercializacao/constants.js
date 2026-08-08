/**
 * UC-01 / UC-01.1 — Constantes oficiais das Unidades de Comercialização
 */

const TIPOS_UNIDADE_COMERCIAL = Object.freeze({
  PADRAO: 'PADRAO',
  AGRUPAMENTO: 'AGRUPAMENTO',
  FRACIONAMENTO: 'FRACIONAMENTO',
  CONVERSAO_FISICA: 'CONVERSAO_FISICA'
});

const TIPOS_LISTA = Object.freeze(Object.values(TIPOS_UNIDADE_COMERCIAL));

const TIPOS_META = Object.freeze({
  PADRAO: {
    label: 'Padrão (Base)',
    icone: '⭐',
    tooltip: 'Unidade Base do produto (SSOT de estoque). Quantidade = 1.'
  },
  AGRUPAMENTO: {
    label: 'Agrupamento',
    icone: '📦',
    tooltip: 'Agrupa várias unidades base (ex.: Caixa = 12 Unidades ou Caixa 5 Litros).'
  },
  FRACIONAMENTO: {
    label: 'Fracionamento',
    icone: '✂️',
    tooltip: 'Fraciona a unidade base (ex.: Bobina → Metro, Pote 200 ml → 0,200 L).'
  },
  CONVERSAO_FISICA: {
    label: 'Medida Física',
    icone: '⚖️',
    tooltip: 'Indica venda/compra por medida física (ex.: Litro ↔ Kg). O peso é informado na Entrada da Mercadoria — nunca no cadastro.'
  }
});

/** Canais oficiais de comercialização (UC-01.1) */
const CANAIS_COMERCIALIZACAO = Object.freeze({
  compra: 'compra',
  venda_erp: 'venda_erp',
  venda_atacado: 'venda_atacado',
  venda_varejo: 'venda_varejo',
  pdv: 'pdv',
  nfce: 'nfce',
  nfe: 'nfe',
  comercial: 'comercial',
  orcamento: 'orcamento'
});

const CANAIS_LISTA = Object.freeze(Object.keys(CANAIS_COMERCIALIZACAO));

const CANAIS_LABELS = Object.freeze({
  compra: 'Compra',
  venda_erp: 'Venda ERP',
  venda_atacado: 'Venda Atacado',
  venda_varejo: 'Venda Varejo',
  pdv: 'PDV',
  nfce: 'NFC-e',
  nfe: 'NF-e',
  comercial: 'Comercial',
  orcamento: 'Orçamento'
});

const CANAIS_DEFAULT = Object.freeze({
  compra: 1,
  venda_erp: 1,
  venda_atacado: 1,
  venda_varejo: 1,
  pdv: 1,
  nfce: 1,
  nfe: 1,
  comercial: 1,
  orcamento: 1
});

const UNIDADES_BASE_SUGERIDAS = Object.freeze([
  'UN', 'KG', 'G', 'L', 'LT', 'ML', 'MT', 'M', 'M2', 'M3', 'CX', 'PC', 'PCT'
]);

module.exports = {
  TIPOS_UNIDADE_COMERCIAL,
  TIPOS_LISTA,
  TIPOS_META,
  CANAIS_COMERCIALIZACAO,
  CANAIS_LISTA,
  CANAIS_LABELS,
  CANAIS_DEFAULT,
  UNIDADES_BASE_SUGERIDAS
};
