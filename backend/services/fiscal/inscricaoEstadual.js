/**
 * Inscrição Estadual do cliente/destinatário — regra única (CLIENTES-02).
 *
 * Persistência: vazio → NULL; "isento" (qualquer caixa/espaços) → "ISENTO"; demais valores
 * apenas sem espaços nas extremidades (sem validação estadual de dígito verificador).
 * NF-e: indIEDest derivado da IE — contribuinte 1 (com <IE>), ISENTO 2 e sem IE 9 (sem <IE>).
 */

'use strict';

const IE_TAMANHO_MAXIMO = 20;
const IE_ISENTO = 'ISENTO';
const IND_IE_DEST = Object.freeze({ CONTRIBUINTE: 1, ISENTO: 2, NAO_CONTRIBUINTE: 9 });

function normalizarInscricaoEstadual(valor) {
  const texto = String(valor ?? '').trim();
  if (!texto) return null;
  return texto.toUpperCase() === IE_ISENTO ? IE_ISENTO : texto;
}

/** Valor a persistir em clientes.inscricao_estadual; recusa (sem truncar) o que não cabe na coluna. */
function validarInscricaoEstadual(valor) {
  const ie = normalizarInscricaoEstadual(valor);
  if (ie && ie.length > IE_TAMANHO_MAXIMO) {
    return {
      valido: false,
      ie,
      mensagem: `Inscrição Estadual deve ter no máximo ${IE_TAMANHO_MAXIMO} caracteres.`
    };
  }
  return { valido: true, ie, mensagem: null };
}

/**
 * IE do destinatário para o grupo <dest>. `ieXml` só existe para contribuinte e segue o
 * leiaute (somente dígitos, 2 a 14); `ieXmlValida` indica se o valor cabe no leiaute.
 * Pontuação usual (. - / espaço) é descartada; letras tornam a IE inválida para o XML.
 */
function interpretarInscricaoEstadual(valor) {
  const ie = normalizarInscricaoEstadual(valor);
  if (!ie) return { ie: null, indIEDest: IND_IE_DEST.NAO_CONTRIBUINTE, ieXml: null, ieXmlValida: true };
  if (ie === IE_ISENTO) return { ie, indIEDest: IND_IE_DEST.ISENTO, ieXml: null, ieXmlValida: true };
  const ieXml = ie.replace(/\D/g, '');
  const ieXmlValida = /^[\d.\-/\s]+$/.test(ie) && /^\d{2,14}$/.test(ieXml);
  return { ie, indIEDest: IND_IE_DEST.CONTRIBUINTE, ieXml, ieXmlValida };
}

const MSG_DEST_IE_INVALIDA =
  'Inscrição Estadual do destinatário inválida para NF-e: informe de 2 a 14 dígitos, ISENTO ou deixe em branco.';

/**
 * IE usada na emissão: a informada no formulário da NF-e (`dest_inscricao_estadual`, mesmo
 * vazia) prevalece sobre a do cadastro (`venda.cliente_inscricao_estadual`).
 */
function resolverInscricaoEstadualDestinatario(venda, dadosNfe) {
  const informadaNaEmissao = dadosNfe
    && Object.prototype.hasOwnProperty.call(dadosNfe, 'dest_inscricao_estadual')
    && dadosNfe.dest_inscricao_estadual !== undefined;
  return interpretarInscricaoEstadual(
    informadaNaEmissao ? dadosNfe.dest_inscricao_estadual : venda?.cliente_inscricao_estadual
  );
}

function assertInscricaoEstadualDestinatarioNfe(venda, dadosNfe) {
  const resultado = resolverInscricaoEstadualDestinatario(venda, dadosNfe);
  if (!resultado.ieXmlValida) {
    throw Object.assign(new Error(MSG_DEST_IE_INVALIDA), { code: 'DEST_IE_INVALIDA' });
  }
  return resultado;
}

module.exports = {
  IE_TAMANHO_MAXIMO,
  IE_ISENTO,
  IND_IE_DEST,
  MSG_DEST_IE_INVALIDA,
  normalizarInscricaoEstadual,
  validarInscricaoEstadual,
  interpretarInscricaoEstadual,
  resolverInscricaoEstadualDestinatario,
  assertInscricaoEstadualDestinatarioNfe
};
