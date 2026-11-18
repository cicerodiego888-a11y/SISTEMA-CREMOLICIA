/**
 * nfeXmlMapper — Mapeamento infNFe (xml2js) → NfeParseadaDTO.
 *
 * Sem lógica de negócio, persistência ou integrações externas.
 *
 * @module shared/nfe/mappers/nfeXmlMapper
 */

const moment = require('moment');
const NfeParseadaDTO = require('../contracts/NfeParseadaDTO');
const NfeItemParseadoDTO = require('../contracts/NfeItemParseadoDTO');

/**
 * @param {*} valor
 * @returns {number}
 */
function parseNumero(valor) {
  return parseFloat(valor || 0);
}

/** Primeiro grupo de ICMS informado pelo emitente (ICMS00, ICMSSN102...). */
function extrairIcmsOriginal(det) {
  const icms = det?.imposto?.ICMS;
  if (!icms || typeof icms !== 'object') return {};
  const grupo = Object.values(icms).find((valor) => valor && typeof valor === 'object') || {};
  return {
    orig: grupo.orig != null ? String(grupo.orig) : '',
    cst_csosn: grupo.CSOSN != null ? String(grupo.CSOSN) : (grupo.CST != null ? String(grupo.CST) : '')
  };
}

/**
 * @param {Object} infNFe
 * @returns {NfeParseadaDTO}
 */
function mapearInfNFe(infNFe) {
  const ide = infNFe.ide;
  const emit = infNFe.emit;
  const det = Array.isArray(infNFe.det) ? infNFe.det : [infNFe.det].filter(Boolean);
  const total = infNFe.total?.ICMSTot;
  const infAdic = infNFe.infAdic;

  const chaveAcesso = infNFe.$?.Id?.replace('NFe', '') || '';

  const itens = det.map((d, indice) => {
    const prod = d.prod;
    const precoUnitario = parseNumero(prod?.vUnCom);
    const icmsOriginal = extrairIcmsOriginal(d);

    return NfeItemParseadoDTO.create({
      produto_nome: prod?.xProd || '',
      numero_item_xml: Number(d.$?.nItem) || indice + 1,
      cfop_xml: prod?.CFOP != null ? String(prod.CFOP) : '',
      cst_csosn_xml: icmsOriginal.cst_csosn || '',
      orig_xml: icmsOriginal.orig || '',
      codigo_fornecedor: prod?.cProd || '',
      codigo_barras: prod?.cEAN || prod?.cEANTrib || '',
      ncm: prod?.NCM || '',
      unidade: prod?.uCom || 'UN',
      quantidade: parseNumero(prod?.qCom),
      preco_unitario: precoUnitario,
      subtotal: parseNumero(prod?.vProd),
      margem_lucro: 30,
      preco_venda_sugerido: precoUnitario * 1.3
    });
  });

  return NfeParseadaDTO.create({
    chave_acesso: chaveAcesso,
    numero_nf: ide?.nNF || '',
    serie_nf: ide?.serie || '',
    modelo_nf: ide?.mod || '55',
    data_emissao: ide?.dhEmi ? moment(ide.dhEmi).format('YYYY-MM-DD') : '',
    data_entrada: ide?.dhSaiEnt ? moment(ide.dhSaiEnt).format('YYYY-MM-DD') : '',
    fornecedor: emit?.xNome || '',
    fornecedor_cnpj: emit?.CNPJ || '',
    fornecedor_crt: emit?.CRT != null ? String(emit.CRT) : '',
    destinatario_cnpj: infNFe.dest?.CNPJ || infNFe.dest?.CPF || '',
    destinatario_uf: infNFe.dest?.enderDest?.UF || '',
    fornecedor_rua: emit?.enderEmit?.xLgr || '',
    fornecedor_numero: emit?.enderEmit?.nro || '',
    fornecedor_bairro: emit?.enderEmit?.xBairro || '',
    fornecedor_cidade: emit?.enderEmit?.xMun || '',
    fornecedor_uf: emit?.enderEmit?.UF || '',
    fornecedor_cep: emit?.enderEmit?.CEP || '',
    fornecedor_endereco: [
      emit?.enderEmit?.xLgr,
      emit?.enderEmit?.nro,
      emit?.enderEmit?.xBairro,
      emit?.enderEmit?.xMun,
      emit?.enderEmit?.UF,
      emit?.enderEmit?.CEP
    ].filter(Boolean).join(', '),
    valor_produtos: parseNumero(total?.vProd),
    valor_desconto: parseNumero(total?.vDesc),
    valor_frete: parseNumero(total?.vFrete),
    valor_outras_despesas: parseNumero(total?.vOutro),
    valor_total_nota: parseNumero(total?.vNF),
    observacao: infAdic?.infCpl || '',
    itens
  });
}

module.exports = {
  mapearInfNFe
};
