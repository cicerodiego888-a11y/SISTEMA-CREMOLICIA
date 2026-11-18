'use strict';

/**
 * Contexto fiscal confiável da entrada: reconstruído no backend a partir do XML original persistido
 * em central_entradas_documentos, localizado pelo id interno. Nada fiscal enviado pelo navegador é usado.
 * Somente leitura: não grava nem reprocessa o documento.
 */

const NFeParserService = require('../../shared/nfe/NFeParserService');

const somenteDigitos = (v) => String(v ?? '').replace(/\D/g, '');

const consultarUm = (db, sql, params) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
});

function falha(motivo) {
  return { ok: false, motivo };
}

/**
 * @param {Object} db
 * @param {Object} params
 * @param {number|string} params.centralDocumentoId  id interno do documento da Central
 * @param {string} [params.chaveAcessoInformada]     chave da compra, usada só para conferir o vínculo
 */
async function carregarContextoFiscalConfiavel(db, { centralDocumentoId, chaveAcessoInformada } = {}) {
  const id = Number(centralDocumentoId);
  if (!Number.isInteger(id) || id <= 0) {
    return falha('A compra não está vinculada a um documento da Central de Entradas; não há XML original para confirmar UF, CFOP, CST/CSOSN, origem e destinatário.');
  }

  const documento = await consultarUm(
    db,
    'SELECT id, chave, xml FROM central_entradas_documentos WHERE id = ?',
    [id]
  );
  if (!documento) return falha('Documento da Central de Entradas não encontrado; o XML original não pôde ser recuperado.');
  if (!String(documento.xml || '').trim()) return falha('O XML original do documento não está disponível; os dados fiscais não puderam ser confirmados.');

  let parse;
  try {
    parse = await NFeParserService.parse(documento.xml);
  } catch (err) {
    return falha(`O XML original do documento não pôde ser lido (${err.message}); os dados fiscais não puderam ser confirmados.`);
  }

  const chaveDocumento = somenteDigitos(documento.chave);
  const chaveXml = somenteDigitos(parse.chave_acesso);
  if (chaveDocumento.length !== 44 || chaveXml !== chaveDocumento) {
    return falha('A chave de acesso do XML armazenado não confere com a do documento; vínculo inconsistente.');
  }
  const chaveCompra = somenteDigitos(chaveAcessoInformada);
  if (chaveCompra && chaveCompra !== chaveDocumento) {
    return falha('A chave de acesso informada na compra não confere com o documento da Central de Entradas.');
  }

  return {
    ok: true,
    centralDocumentoId: id,
    documento: {
      emitente_uf: parse.fornecedor_uf,
      emitente_crt: parse.fornecedor_crt,
      destinatario_uf: parse.destinatario_uf,
      destinatario_cnpj: parse.destinatario_cnpj
    },
    itensXml: Array.isArray(parse.itens) ? parse.itens : []
  };
}

/**
 * Localiza o item do XML correspondente ao item da compra: por número do item (nItem) e, na ausência dele,
 * por código do fornecedor único. Se ambos existirem, devem ser consistentes.
 */
function localizarItemXml(itensXml, itemCompra) {
  const numero = Number(itemCompra?.numero_item_xml);
  const codigo = String(itemCompra?.codigo_fornecedor ?? '').trim();

  if (Number.isInteger(numero) && numero > 0) {
    const encontrado = itensXml.find((x) => Number(x.numero_item_xml) === numero);
    if (!encontrado) return { erro: `Item ${numero} não existe no XML original.` };
    if (codigo && String(encontrado.codigo_fornecedor ?? '').trim() !== codigo) {
      return { erro: `O código do fornecedor do item ${numero} não confere com o XML original.` };
    }
    return { itemXml: encontrado };
  }

  if (!codigo) return { erro: 'Item sem número de item nem código do fornecedor para localizar o XML original.' };
  const candidatos = itensXml.filter((x) => String(x.codigo_fornecedor ?? '').trim() === codigo);
  if (candidatos.length !== 1) {
    return { erro: `Não foi possível identificar com segurança o item do XML (código do fornecedor ${codigo}).` };
  }
  return { itemXml: candidatos[0] };
}

module.exports = { carregarContextoFiscalConfiavel, localizarItemXml };
