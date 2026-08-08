/**
 * MCC-02 — Enums oficiais (estende MCC-01)
 */

const TipoConversao = Object.freeze({
  PADRAO: 'PADRAO',
  AGRUPAMENTO: 'AGRUPAMENTO',
  FRACIONAMENTO: 'FRACIONAMENTO',
  CONVERSAO_FISICA: 'CONVERSAO_FISICA',
  CONVERSAO_COMPOSTA: 'CONVERSAO_COMPOSTA'
});

const ContextoConversao = Object.freeze({
  COMPRA: 'COMPRA',
  VENDA: 'VENDA',
  PDV: 'PDV',
  COMERCIAL: 'COMERCIAL',
  NFCE: 'NFC-e',
  NFE: 'NF-e',
  ORCAMENTO: 'ORCAMENTO',
  AJUSTE_ESTOQUE: 'AJUSTE_ESTOQUE',
  OUTROS: 'OUTROS'
});

/** Origem oficial da Conversão Física do Lote */
const OrigemConversaoFisica = Object.freeze({
  MANUAL: 'MANUAL',
  FABRICANTE: 'FABRICANTE',
  CALCULADA: 'CALCULADA',
  IMPORTADA_XML: 'IMPORTADA_XML',
  IMPORTADA_PLANILHA: 'IMPORTADA_PLANILHA'
});

/** Motivo oficial de nova versão (MCC-02.1) */
const MotivoVersaoConversao = Object.freeze({
  CONFERENCIA_BALANCA: 'CONFERENCIA_BALANCA',
  CORRECAO_OPERACIONAL: 'CORRECAO_OPERACIONAL',
  AJUSTE_FABRICANTE: 'AJUSTE_FABRICANTE',
  ERRO_DIGITACAO: 'ERRO_DIGITACAO',
  OUTRO: 'OUTRO'
});

const MOTOR_NOME = 'MotorConversaoComercial';
const MOTOR_VERSAO = '1.5.0-est-mcc01';

module.exports = {
  TipoConversao,
  ContextoConversao,
  OrigemConversaoFisica,
  MotivoVersaoConversao,
  MOTOR_NOME,
  MOTOR_VERSAO
};
