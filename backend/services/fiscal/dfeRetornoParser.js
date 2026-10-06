/**
 * dfeRetornoParser — Parse puro do retorno SOAP da Distribuição DF-e.
 *
 * @module services/fiscal/dfeRetornoParser
 */

const zlib = require('zlib');

const NSU_ZERADO = '000000000000000';

/**
 * @param {string} nsu
 * @returns {string}
 */
function normalizarNsu(nsu) {
  const digitos = String(nsu || '').replace(/\D/g, '');
  if (!digitos) return NSU_ZERADO;
  return digitos.padStart(15, '0');
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function nsuMenorQue(a, b) {
  return normalizarNsu(a) < normalizarNsu(b);
}

/**
 * @param {string} xmlRetorno
 * @returns {{ cStat: string, xMotivo: string, ultNSU: string, maxNSU: string }}
 */
function extrairMetadadosRetorno(xmlRetorno) {
  const texto = String(xmlRetorno || '');

  return {
    cStat: texto.match(/<cStat>(\d+)<\/cStat>/)?.[1] || '',
    xMotivo: texto.match(/<xMotivo>(.*?)<\/xMotivo>/)?.[1] || '',
    ultNSU: normalizarNsu(texto.match(/<ultNSU>(\d+)<\/ultNSU>/)?.[1]),
    maxNSU: normalizarNsu(texto.match(/<maxNSU>(\d+)<\/maxNSU>/)?.[1])
  };
}

/**
 * @param {string} schema
 * @param {string} xml
 * @returns {boolean}
 */
function isDocumentoNotaFiscal(schema, xml) {
  const schemaLower = String(schema || '').toLowerCase();
  if (schemaLower.includes('procnfe') || schemaLower.includes('resnfe')) {
    return true;
  }

  return /<infNFe[\s>]/i.test(xml) || /<nfeProc/i.test(xml);
}

/**
 * @param {string} xmlRetorno
 * @returns {Array<{ nsu: string, schema: string, xml: string, compactado: string }>}
 */
function extrairDocumentosZip(xmlRetorno) {
  const documentos = [];
  const regex = /<docZip([^>]*)>([\s\S]*?)<\/docZip>/gi;
  let match;

  while ((match = regex.exec(String(xmlRetorno || ''))) !== null) {
    const atributos = match[1] || '';
    const compactado = (match[2] || '').trim();
    const nsu = normalizarNsu(atributos.match(/NSU="(\d+)"/i)?.[1]);
    const schema = atributos.match(/schema="([^"]+)"/i)?.[1] || '';

    if (!compactado) continue;

    let xml = '';
    try {
      xml = zlib.gunzipSync(Buffer.from(compactado, 'base64')).toString('utf8');
    } catch {
      continue;
    }

    if (!isDocumentoNotaFiscal(schema, xml)) {
      continue;
    }

    documentos.push({ nsu, schema, xml, compactado, xmlCompleto: /<infNFe[\s>]/i.test(xml) || /<nfeProc[\s>]/i.test(xml) });
  }

  return documentos;
}

/**
 * Lista todos os NSUs do lote, inclusive os que não são NF-e ou falharam no unzip.
 *
 * @param {string} xmlRetorno
 * @returns {string[]}
 */
function extrairTodosNsus(xmlRetorno) {
  const nsus = [];
  const regex = /<docZip([^>]*)>/gi;
  let match;

  while ((match = regex.exec(String(xmlRetorno || ''))) !== null) {
    const nsu = normalizarNsu((match[1] || '').match(/NSU="(\d+)"/i)?.[1]);
    if (nsu && nsu !== NSU_ZERADO) nsus.push(nsu);
  }

  return nsus;
}

/**
 * @param {string} cStat
 * @returns {boolean}
 */
function retornoDistSucesso(cStat) {
  return ['137', '138', '656'].includes(String(cStat));
}

module.exports = {
  NSU_ZERADO,
  normalizarNsu,
  nsuMenorQue,
  extrairMetadadosRetorno,
  extrairDocumentosZip,
  extrairTodosNsus,
  isDocumentoNotaFiscal,
  retornoDistSucesso
};
