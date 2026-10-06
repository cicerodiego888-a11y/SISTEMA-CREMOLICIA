/**
 * Identidade imutável da NF-e (modelo 55).
 * Chave = CNPJ + modelo + série + número + tpEmis + cNF + ambiente (via chave 44).
 */

'use strict';

const { onlyDigits, gerarChaveAcesso, gerarCodigoNumerico, nowDhEmi } = require('./utils');
const { calcularHashXml, extrairChaveDoXml } = require('./nfeXmlIdentityService');
const { classificarRetornoSefaz, ACOES } = require('./classificarRetornoSefaz');
const { ESTADOS } = require('./nfeDevolucaoEstados');
const { getFiscalSubDir } = require('./paths');
const fs = require('fs');
const path = require('path');

const CAMPOS_IDENTIDADE = ['chave_acesso', 'numero', 'serie', 'cnf', 'tp_emis'];

const ESTADOS_NUMERO_OCUPADO = new Set([
  ESTADOS.AUTORIZADA,
  ESTADOS.ENVIANDO,
  ESTADOS.LOTE_ENVIADO,
  ESTADOS.PROCESSANDO,
  ESTADOS.ASSINANDO,
  ESTADOS.VALIDANDO,
  ESTADOS.DENEGADA,
  ESTADOS.CONFLITO_IDENTIDADE,
  'assinada',
  'transmitindo',
  'validada_localmente',
  'preparando_xml'
]);

function pad(v, n) {
  return String(v == null ? '' : v).replace(/\D/g, '').padStart(n, '0').slice(-n);
}

function parseChaveNfe(chave) {
  const c = onlyDigits(chave);
  if (c.length !== 44) return null;
  return {
    uf: c.slice(0, 2),
    aamm: c.slice(2, 6),
    cnpj: c.slice(6, 20),
    modelo: c.slice(20, 22),
    serie: Number(c.slice(22, 25)),
    numero: Number(c.slice(25, 34)),
    tpEmis: c.slice(34, 35),
    cNF: c.slice(35, 43),
    cDV: c.slice(43, 44),
    chave: c
  };
}

function criarIdentidadeNfe({
  uf,
  aamm,
  cnpj,
  modelo = '55',
  serie,
  numero,
  tpEmis = '1',
  cNF,
  ambiente
} = {}) {
  const chave = gerarChaveAcesso({ uf, aamm, cnpj, modelo, serie, numero, tpEmis, cNF });
  return {
    cnpj: pad(onlyDigits(cnpj), 14),
    modelo: pad(modelo, 2),
    serie: Number(serie),
    numero: Number(numero),
    tpEmis: String(tpEmis || '1'),
    cNF: pad(cNF, 8),
    ambiente: Number(ambiente),
    chave
  };
}

function calcularChaveNfe(params) {
  return criarIdentidadeNfe(params).chave;
}

const CODIGOS_UF_IBGE = new Set([
  '11', '12', '13', '14', '15', '16', '17',
  '21', '22', '23', '24', '25', '26', '27', '28', '29',
  '31', '32', '33', '35',
  '41', '42', '43',
  '50', '51', '52', '53'
]);

function erroIdentidade(mensagem, code = 'NFE_IDENTIDADE_INVALIDA') {
  const err = new Error(mensagem);
  err.code = code;
  err.codigo = code;
  return err;
}

/** Parâmetros fixos da chave (CNPJ, modelo 55, série, ambiente, cUF), conferidos antes de reservar número. */
function validarParametrosIdentidadeNfe({ cnpj, serie, ambiente, uf } = {}) {
  const c = onlyDigits(cnpj);
  if (c.length !== 14 || /^0+$/.test(c)) {
    throw erroIdentidade('CNPJ do emitente inválido para a chave de acesso (exige 14 dígitos).');
  }
  const s = Number(serie);
  if (!Number.isInteger(s) || s < 0 || s > 999) {
    throw erroIdentidade('Série da NF-e inválida para a chave de acesso (0 a 999).');
  }
  const amb = Number(ambiente);
  if (amb !== 1 && amb !== 2) {
    throw erroIdentidade('Ambiente da NF-e inválido para a identidade (1 ou 2).');
  }
  const cUF = pad(uf, 2);
  if (!CODIGOS_UF_IBGE.has(cUF)) {
    throw erroIdentidade(`Código IBGE da UF do emitente inválido (${uf == null || uf === '' ? 'não informado' : uf}).`);
  }
  return { cnpj: c, modelo: '55', serie: s, ambiente: amb, uf: cUF };
}

/** NT 2019.001: cNF não pode repetir o nNF. */
function gerarCnfNfe(numero, gerador = gerarCodigoNumerico) {
  const nNF = pad(numero, 8);
  for (let i = 0; i < 20; i += 1) {
    const cNF = pad(gerador(), 8);
    if (cNF !== nNF) return cNF;
  }
  throw erroIdentidade('Não foi possível gerar cNF diferente do número da NF-e.');
}

/**
 * Identidade oficial de uma emissão NF-e venda: definida uma única vez, depois da
 * reserva do número e antes do XML. A mesma chave segue para XML, nfe_notas,
 * auditoria, retorno e DANFE.
 */
function prepararIdentidadeEmissaoNfe({
  cnpj,
  serie,
  numero,
  ambiente,
  uf,
  dhEmi,
  cNF,
  tpEmis = '1'
} = {}) {
  const p = validarParametrosIdentidadeNfe({ cnpj, serie, ambiente, uf });
  const n = Number(numero);
  if (!Number.isInteger(n) || n < 1 || n > 999999999) {
    throw erroIdentidade('Número da NF-e inválido para a chave de acesso (1 a 999999999).');
  }
  const dh = String(dhEmi || nowDhEmi());
  const data = /^(\d{4})-(\d{2})-\d{2}T/.exec(dh);
  if (!data) throw erroIdentidade('Data de emissão (dhEmi) inválida para a chave de acesso.');
  const codigo = cNF != null ? pad(cNF, 8) : gerarCnfNfe(n);
  if (codigo === pad(n, 8)) throw erroIdentidade('cNF não pode ser igual ao número da NF-e.');
  const identidade = criarIdentidadeNfe({
    uf: p.uf,
    aamm: data[1].slice(2) + data[2],
    cnpj: p.cnpj,
    modelo: p.modelo,
    serie: p.serie,
    numero: n,
    tpEmis,
    cNF: codigo,
    ambiente: p.ambiente
  });
  return Object.freeze({
    ...identidade,
    uf: p.uf,
    aamm: data[1].slice(2) + data[2],
    dhEmi: dh,
    cDV: identidade.chave.slice(-1)
  });
}

function chaveNfeComDvValido(chave) {
  const p = parseChaveNfe(chave);
  if (!p) return false;
  const recalculada = gerarChaveAcesso({
    uf: p.uf,
    aamm: p.aamm,
    cnpj: p.cnpj,
    modelo: p.modelo,
    serie: p.serie,
    numero: p.numero,
    tpEmis: p.tpEmis,
    cNF: p.cNF
  });
  return recalculada === p.chave;
}

function tagXml(xml, nome) {
  const m = String(xml || '').match(new RegExp(`<${nome}>([^<]*)</${nome}>`));
  return m ? m[1].trim() : null;
}

/** O XML montado precisa carregar exatamente a identidade oficial (Id, ide e CNPJ do emitente). */
function conferirIdentidadeXmlNfe(xml, identidade) {
  const divergencias = [];
  const chaveXml = extrairChaveDoXml(xml);
  if (chaveXml !== identidade.chave) divergencias.push(`Id=${chaveXml || 'ausente'}`);
  if (!chaveNfeComDvValido(identidade.chave)) divergencias.push('cDV inválido');
  const ide = String(xml || '').match(/<ide>[\s\S]*?<\/ide>/);
  const ideXml = ide ? ide[0] : '';
  const esperado = {
    cUF: identidade.uf,
    cNF: identidade.cNF,
    mod: identidade.modelo,
    serie: String(identidade.serie),
    nNF: String(identidade.numero),
    dhEmi: identidade.dhEmi,
    tpEmis: identidade.tpEmis,
    cDV: identidade.cDV,
    tpAmb: String(identidade.ambiente)
  };
  for (const [campo, valor] of Object.entries(esperado)) {
    const noXml = tagXml(ideXml, campo);
    if (noXml !== valor) divergencias.push(`${campo}=${noXml == null ? 'ausente' : noXml}`);
  }
  const emit = String(xml || '').match(/<emit>[\s\S]*?<\/emit>/);
  const cnpjEmit = emit ? tagXml(emit[0], 'CNPJ') : null;
  if (cnpjEmit !== identidade.cnpj) divergencias.push(`emit/CNPJ=${cnpjEmit || 'ausente'}`);
  if (divergencias.length) {
    const err = erroIdentidade(
      `XML da NF-e diverge da identidade oficial (${divergencias.join(', ')}).`,
      'IDENTIDADE_XML_DIVERGENTE'
    );
    err.detalhes = { chave: identidade.chave, divergencias };
    throw err;
  }
  return true;
}

function validarIdentidadePersistida(nota = {}, identidadeNova = {}) {
  const congelada = Boolean(nota.xml_assinado || nota.xml_enviado || nota.identidade_congelada);
  if (!congelada) return true;
  const chaveAntiga = onlyDigits(nota.chave_acesso);
  const chaveNova = onlyDigits(identidadeNova.chave || identidadeNova.chave_acesso);
  if (chaveNova && chaveAntiga && chaveNova !== chaveAntiga) {
    const err = new Error(
      'Identidade fiscal imutável: documento já assinado/transmitido não pode trocar chave, número ou cNF.'
    );
    err.code = 'IDENTIDADE_IMUTAVEL';
    throw err;
  }
  if (identidadeNova.numero != null && Number(nota.numero) !== Number(identidadeNova.numero)) {
    const err = new Error('Identidade fiscal imutável: o número (nNF) não pode ser alterado após assinatura.');
    err.code = 'IDENTIDADE_IMUTAVEL';
    throw err;
  }
  return true;
}

function filtrarCamposIdentidadeSeCongelado(nota, fields = {}) {
  if (!nota || !(nota.xml_assinado || nota.xml_enviado || nota.identidade_congelada)) {
    return { ...fields };
  }
  const out = { ...fields };
  for (const c of CAMPOS_IDENTIDADE) {
    delete out[c];
  }
  return out;
}

function dbAll(sql, params = []) {
  const db = require('../../database');
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

async function buscarDocumentoPorChave(chave, { documentos } = {}) {
  const limpa = onlyDigits(chave);
  if (limpa.length !== 44) return [];
  if (Array.isArray(documentos)) {
    return documentos.filter((d) => onlyDigits(d.chave_acesso || d.chave) === limpa);
  }
  const [compra, venda, nfe] = await Promise.all([
    dbAll(
      `SELECT id, compra_id AS origem_id, 'DEVOLUCAO_COMPRA' AS tipo, numero, serie, chave_acesso, status, ambiente,
              xml_enviado, xml_assinado, xml_hash, xml_assinado_hash, cstat_retorno, protocolo
       FROM nfe_devolucoes_compra WHERE REPLACE(chave_acesso, ' ', '') = ?`,
      [limpa]
    ).catch(() => []),
    dbAll(
      `SELECT id, venda_id AS origem_id, 'DEVOLUCAO_VENDA' AS tipo, numero, serie, chave_acesso, status, ambiente,
              xml_enviado, xml_assinado, xml_hash, xml_assinado_hash, cstat_retorno, protocolo
       FROM nfe_devolucoes_venda WHERE REPLACE(chave_acesso, ' ', '') = ?`,
      [limpa]
    ).catch(() => []),
    dbAll(
      `SELECT id, venda_id AS origem_id, 'NFE_VENDA' AS tipo, numero, serie, chave_acesso, status, ambiente,
              xml_enviado, NULL AS xml_assinado, NULL AS xml_hash, NULL AS xml_assinado_hash, NULL AS cstat_retorno, protocolo
       FROM nfe_notas WHERE REPLACE(chave_acesso, ' ', '') = ?`,
      [limpa]
    ).catch(() => [])
  ]);
  return [...compra, ...venda, ...nfe];
}

async function buscarDocumentoPorNumeroSerie({ numero, serie, ambiente, documentos } = {}) {
  const n = Number(numero);
  const s = Number(serie);
  const amb = ambiente != null ? Number(ambiente) : null;
  if (Array.isArray(documentos)) {
    return documentos.filter((d) =>
      Number(d.numero) === n
      && Number(d.serie) === s
      && (amb == null || Number(d.ambiente) === amb)
    );
  }
  const whereAmb = amb != null ? 'AND CAST(ambiente AS INTEGER) = ?' : '';
  const params = amb != null ? [n, s, amb] : [n, s];
  const [compra, venda, nfe] = await Promise.all([
    dbAll(
      `SELECT id, compra_id AS origem_id, 'DEVOLUCAO_COMPRA' AS tipo, numero, serie, chave_acesso, status, ambiente,
              xml_enviado, xml_assinado, xml_hash
       FROM nfe_devolucoes_compra WHERE CAST(numero AS INTEGER) = ? AND CAST(serie AS INTEGER) = ? ${whereAmb}`,
      params
    ).catch(() => []),
    dbAll(
      `SELECT id, venda_id AS origem_id, 'DEVOLUCAO_VENDA' AS tipo, numero, serie, chave_acesso, status, ambiente,
              xml_enviado, xml_assinado, xml_hash
       FROM nfe_devolucoes_venda WHERE CAST(numero AS INTEGER) = ? AND CAST(serie AS INTEGER) = ? ${whereAmb}`,
      params
    ).catch(() => []),
    dbAll(
      `SELECT id, venda_id AS origem_id, 'NFE_VENDA' AS tipo, numero, serie, chave_acesso, status, ambiente,
              xml_enviado, NULL AS xml_assinado, NULL AS xml_hash
       FROM nfe_notas WHERE CAST(numero AS INTEGER) = ? AND CAST(serie AS INTEGER) = ? ${whereAmb}`,
      params
    ).catch(() => [])
  ]);
  return [...compra, ...venda, ...nfe];
}

function validarDisponibilidadeNumero({ numero, serie, ambiente, documentos = [], ignorarId } = {}) {
  const ocupados = documentos.filter((d) => {
    if (ignorarId != null && Number(d.id) === Number(ignorarId)) return false;
    if (Number(d.numero) !== Number(numero) || Number(d.serie) !== Number(serie)) return false;
    if (ambiente != null && d.ambiente != null && Number(d.ambiente) !== Number(ambiente)) return false;
    if (d.xml_assinado || d.xml_enviado) return true;
    return ESTADOS_NUMERO_OCUPADO.has(String(d.status || '').toLowerCase());
  });
  if (ocupados.length) {
    const err = new Error(
      `Número fiscal ${numero}/${serie} já está em uso por outro documento (${ocupados[0].tipo} id ${ocupados[0].id}).`
    );
    err.code = 'NUMERO_FISCAL_EM_USO';
    err.documentos = ocupados;
    throw err;
  }
  return true;
}

function validarConflitoDeChave({ chave, xml, documentos = [] }) {
  const limpa = onlyDigits(chave);
  const hashAtual = xml ? calcularHashXml(xml) : null;
  const relacionados = documentos.filter((d) => onlyDigits(d.chave_acesso || d.chave) === limpa);
  for (const doc of relacionados) {
    const xmlRef = doc.xml_assinado || doc.xml_enviado;
    const hashRef = doc.xml_assinado_hash || doc.xml_hash;
    if (xmlRef || hashRef) {
      const antigo = hashRef || calcularHashXml(xmlRef);
      if (hashAtual && antigo && hashAtual !== antigo) {
        const err = new Error(
          'Conflito fiscal: esta chave de acesso já está associada a um documento com conteúdo diferente. Uma nova NF-e deve receber nova identidade fiscal.'
        );
        err.code = 'CHAVE_XML_CONFLITO';
        err.documento = doc;
        throw err;
      }
    }
  }
  return { ok: true, existeDocumentoComMesmaChave: relacionados.length > 0, relacionados };
}

function identidadeDoBuilt(built, { cnpj, ambiente, cNF } = {}) {
  const parsed = parseChaveNfe(built.chave);
  return {
    cnpj: parsed ? parsed.cnpj : onlyDigits(cnpj),
    modelo: parsed ? parsed.modelo : '55',
    serie: built.serie,
    numero: parsed ? parsed.numero : null,
    tpEmis: parsed ? parsed.tpEmis : '1',
    cNF: cNF || (parsed ? parsed.cNF : null),
    ambiente,
    chave: built.chave
  };
}

/**
 * Diagnóstico da rejeição 539. Não transmite. Não altera identidade.
 */
async function diagnosticarDuplicidadeNfe({
  compraId,
  vendaId,
  nota = {},
  parsed = {},
  xmlAtual,
  documentosRelacionados,
  consultaSefaz
} = {}) {
  const chaveAtual = onlyDigits(nota.chave_acesso || parsed.chNFe);
  const chaveMotivo = require('./nfeNumeracaoNfeService').extrairChaveConflito539(
    parsed.xMotivo,
    parsed.raw || nota.xml_retorno
  );
  const chaveSefaz = onlyDigits(chaveMotivo || parsed.chNFe);
  const xml = xmlAtual || nota.xml_assinado || nota.xml_enviado || '';
  const xmlHashAtual = xml ? calcularHashXml(xml) : null;
  const docs = Array.isArray(documentosRelacionados)
    ? documentosRelacionados
    : await buscarDocumentoPorNumeroSerie({
      numero: nota.numero,
      serie: nota.serie,
      ambiente: nota.ambiente
    });
  const mesmaChave = docs.filter((d) => onlyDigits(d.chave_acesso) === chaveAtual);
  const mesmoNumeroOutraChave = docs.filter((d) =>
    Number(d.numero) === Number(nota.numero)
    && Number(d.serie) === Number(nota.serie)
    && onlyDigits(d.chave_acesso) !== chaveAtual
    && onlyDigits(d.chave_acesso).length === 44
  );
  let xmlHashAnterior = null;
  if (mesmaChave[0]) {
    const ref = mesmaChave[0].xml_assinado || mesmaChave[0].xml_enviado;
    xmlHashAnterior = mesmaChave[0].xml_hash || (ref ? calcularHashXml(ref) : null);
  }

  let consulta = null;
  if (typeof consultaSefaz === 'function' && chaveAtual.length === 44) {
    consulta = await consultaSefaz(chaveAtual);
  }

  const cStatConsulta = soCstat(consulta);
  let ocupacao539 = null;
  if (String(parsed.cStat || '') === '539' || /duplicidade de nf-e, com diferen/i.test(String(parsed.xMotivo || ''))) {
    ocupacao539 = await require('./nfeNumeracaoNfeService').aplicarOcupacaoPorRejeicao539({
      parsed,
      nota,
      ambiente: nota.ambiente
    });
  }

  let decisao = 'BLOQUEAR_REENVIO_EXIGE_NOVA_IDENTIDADE';
  let estadoFinal = ESTADOS.CONFLITO_IDENTIDADE;
  if (cStatConsulta === '100' || cStatConsulta === '150') {
    decisao = 'SINCRONIZAR_DOCUMENTO_AUTORIZADO';
    estadoFinal = ESTADOS.AUTORIZADA;
  } else if (chaveSefaz && chaveAtual && chaveSefaz !== chaveAtual) {
    decisao = 'NUMERO_JA_UTILIZADO_NA_SEFAZ_EXIGE_NOVA_IDENTIDADE';
    estadoFinal = ESTADOS.CONFLITO_IDENTIDADE;
  } else if (!consulta || consulta.indeterminado) {
    decisao = 'PENDENTE_DIAGNOSTICO_SEM_CONFIRMACAO_SEFAZ';
    estadoFinal = ESTADOS.REJEITADA;
  } else if (mesmoNumeroOutraChave.length) {
    decisao = 'CONFLITO_LOCAL_MESMO_NUMERO_CHAVE_DIFERENTE';
    estadoFinal = ESTADOS.CONFLITO_IDENTIDADE;
  }

  const diagnostico = {
    timestamp: new Date().toISOString(),
    compraId: compraId != null ? compraId : (nota.compra_id || null),
    vendaId: vendaId != null ? vendaId : (nota.venda_id || null),
    nfeDevolucaoId: nota.id || null,
    numero: nota.numero || null,
    serie: nota.serie || null,
    tpAmb: nota.ambiente || null,
    chaveAtual,
    chaveEncontradaNaSefaz: chaveSefaz || (consulta && consulta.chNFe) || null,
    statusLocal: nota.status || null,
    cStat: parsed.cStat || '539',
    motivo: parsed.xMotivo || 'Rejeição: Duplicidade de NF-e, com diferença na Chave de Acesso',
    xmlHashAtual,
    xmlHashAnterior,
    existeDocumentoComMesmaChave: mesmaChave.length > 0,
    existeDocumentoComMesmoNumero: docs.some((d) => Number(d.numero) === Number(nota.numero)),
    documentosRelacionados: docs.map((d) => ({
      id: d.id,
      tipo: d.tipo,
      numero: d.numero,
      serie: d.serie,
      chave: d.chave_acesso,
      status: d.status
    })),
    consultaSefaz: consulta || null,
    ocupacao539,
    proximoNumeroMinimo: ocupacao539 && ocupacao539.proximoMinimo,
    decisao,
    estadoFinal
  };

  const prefix = compraId || nota.compra_id || (vendaId ? `venda-${vendaId}` : 'nfe');
  try {
    const pasta = getFiscalSubDir('debug/nfe-devolucao');
    fs.writeFileSync(
      path.join(pasta, `${prefix}-diagnostico-539.json`),
      JSON.stringify(diagnostico, null, 2),
      'utf8'
    );
  } catch (_) { /* debug */ }

  return diagnostico;
}

function soCstat(consulta) {
  if (!consulta) return null;
  return String(consulta.cStat || consulta.cstat || '').replace(/\D/g, '') || null;
}

function salvarDebugIdentidade(prefixo, nome, dados) {
  try {
    const pasta = getFiscalSubDir('debug/nfe-devolucao');
    fs.writeFileSync(path.join(pasta, `${prefixo}-${nome}`), JSON.stringify(dados, null, 2), 'utf8');
  } catch (_) { /* debug */ }
}

module.exports = {
  parseChaveNfe,
  criarIdentidadeNfe,
  calcularChaveNfe,
  validarParametrosIdentidadeNfe,
  gerarCnfNfe,
  prepararIdentidadeEmissaoNfe,
  chaveNfeComDvValido,
  conferirIdentidadeXmlNfe,
  validarIdentidadePersistida,
  filtrarCamposIdentidadeSeCongelado,
  buscarDocumentoPorChave,
  buscarDocumentoPorNumeroSerie,
  validarDisponibilidadeNumero,
  validarConflitoDeChave,
  identidadeDoBuilt,
  diagnosticarDuplicidadeNfe,
  salvarDebugIdentidade,
  CAMPOS_IDENTIDADE,
  ESTADOS_NUMERO_OCUPADO,
  ACOES,
  classificarRetornoSefaz,
  extrairChaveDoXml
};
