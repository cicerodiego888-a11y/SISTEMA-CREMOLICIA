/**
 * Classificação do XML na Central de Entradas.
 *
 * Distingue resumo DF-e (resNFe) de NF-e completa (procNFe/infNFe).
 * Não é parser oficial — apenas classificação operacional do pipeline.
 *
 * @module motores/central-entradas/core/xmlDocumento
 */

const CLASSE_XML = Object.freeze({
  AUSENTE: 'AUSENTE',
  RESUMO: 'RESUMO',
  COMPLETO: 'COMPLETO',
  INVALIDO: 'INVALIDO'
});

/**
 * @param {string|null|undefined} xml
 * @returns {boolean}
 */
function xmlPossuiNfeCompleta(xml) {
  const texto = String(xml || '');
  if (!texto.trim()) return false;
  return /<infNFe[\s>]/i.test(texto) || /<nfeProc[\s>]/i.test(texto);
}

/**
 * @param {string|null|undefined} xml
 * @returns {boolean}
 */
function xmlEhResumoDfe(xml) {
  const texto = String(xml || '');
  if (!texto.trim()) return false;
  if (xmlPossuiNfeCompleta(texto)) return false;
  return /<resNFe[\s>]/i.test(texto) || /<chNFe>/i.test(texto);
}

/**
 * @param {string|null|undefined} xml
 * @returns {string}
 */
function classificarXml(xml) {
  const texto = String(xml || '').trim();
  if (!texto) return CLASSE_XML.AUSENTE;
  if (xmlPossuiNfeCompleta(texto)) return CLASSE_XML.COMPLETO;
  if (xmlEhResumoDfe(texto)) return CLASSE_XML.RESUMO;
  return CLASSE_XML.INVALIDO;
}

module.exports = {
  CLASSE_XML,
  xmlPossuiNfeCompleta,
  xmlEhResumoDfe,
  classificarXml
};
