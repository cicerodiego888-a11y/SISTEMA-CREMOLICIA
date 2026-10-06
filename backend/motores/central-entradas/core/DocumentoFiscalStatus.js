/**
 * DocumentoFiscalStatus — Enum de estados do documento fiscal na Central de Entradas.
 *
 * Sprint 1: definição de estados e metadados para UI/monitoramento.
 *
 * @module motores/central-entradas/core/DocumentoFiscalStatus
 */

const DocumentoFiscalStatus = Object.freeze({
  RECEBIDA: 'RECEBIDA',
  AGUARDANDO_XML: 'AGUARDANDO_XML',
  XML_RECUPERANDO: 'XML_RECUPERANDO',
  ERRO_RECUPERACAO: 'ERRO_RECUPERACAO',
  SINCRONIZADA: 'SINCRONIZADA',
  EM_PROCESSAMENTO: 'EM_PROCESSAMENTO',
  AGUARDANDO_REVISAO: 'AGUARDANDO_REVISAO',
  REVISADA: 'REVISADA',
  PRONTA_PARA_COMPRA: 'PRONTA_PARA_COMPRA',
  EM_COMPRA: 'EM_COMPRA',
  GRAVADA: 'GRAVADA',
  DESCARTADA: 'DESCARTADA',
  ERRO: 'ERRO',
  DUPLICADA: 'DUPLICADA'
});

const TODOS = Object.freeze(Object.values(DocumentoFiscalStatus));

const ESTADOS_TERMINAIS = Object.freeze([
  DocumentoFiscalStatus.GRAVADA,
  DocumentoFiscalStatus.DESCARTADA,
  DocumentoFiscalStatus.DUPLICADA
]);

const LABELS_UI = Object.freeze({
  [DocumentoFiscalStatus.RECEBIDA]: 'Recebida',
  [DocumentoFiscalStatus.AGUARDANDO_XML]: 'Aguardando XML',
  [DocumentoFiscalStatus.XML_RECUPERANDO]: 'Recuperando XML',
  [DocumentoFiscalStatus.ERRO_RECUPERACAO]: 'Erro de recuperação',
  [DocumentoFiscalStatus.SINCRONIZADA]: 'Nova',
  [DocumentoFiscalStatus.EM_PROCESSAMENTO]: 'Processando',
  [DocumentoFiscalStatus.AGUARDANDO_REVISAO]: 'Revisar produtos',
  [DocumentoFiscalStatus.REVISADA]: 'Revisada',
  [DocumentoFiscalStatus.PRONTA_PARA_COMPRA]: 'Pronta',
  [DocumentoFiscalStatus.EM_COMPRA]: 'Em compra',
  [DocumentoFiscalStatus.GRAVADA]: 'Gravada',
  [DocumentoFiscalStatus.DESCARTADA]: 'Descartada',
  [DocumentoFiscalStatus.ERRO]: 'Erro',
  [DocumentoFiscalStatus.DUPLICADA]: 'Duplicada'
});

/**
 * @param {string} status
 * @returns {boolean}
 */
function isValido(status) {
  return TODOS.includes(status);
}

/**
 * @param {string} status
 * @returns {boolean}
 */
function isTerminal(status) {
  return ESTADOS_TERMINAIS.includes(status);
}

/**
 * @param {string} status
 * @returns {string}
 */
function obterLabel(status) {
  return LABELS_UI[status] || status;
}

module.exports = {
  DocumentoFiscalStatus,
  TODOS,
  ESTADOS_TERMINAIS,
  LABELS_UI,
  isValido,
  isTerminal,
  obterLabel
};
