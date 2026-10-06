/**
 * WebServices NF-e modelo 55 — endpoints, envelopes SOAP 1.2 e envio.
 *
 * Envelopes de consulta protocolo / status serviço / recepção de evento
 * portados de consultaProtocoloLegado / statusServicoLegado / cancelamentoLegado
 * (CDS Sistemas Atual). Transporte: soapClient.enviarSoapSefaz (cliente SOAP único).
 *
 * Endpoints padrão: SVRS. O Ceará (cUF 23) é autorizado pela SVRS na NF-e 55
 * (retornos reais de 24/09/2026 com verAplic SVRS2609240852DR). Podem ser
 * sobrescritos por configuração (fiscal_ws_nfe_*_{producao|homologacao}) — UFs
 * com autorizador próprio devem configurar as URLs oficiais da SEFAZ autorizadora.
 * resolverWebserviceNfe é o único resolvedor de URL da NF-e (emissor e diagnóstico).
 */

'use strict';

const { enviarSoapSefaz } = require('./soapClient');
const { ambienteNfePermitido, erroAmbienteNfe } = require('./nfeAmbienteGuard');

function bloqueioAmbiente(ambiente, operacao) {
  if (ambienteNfePermitido(ambiente)) return null;
  const err = erroAmbienteNfe(ambiente, operacao);
  return {
    success: false,
    code: err.code,
    message: err.message,
    error: err.message,
    body: '',
    statusCode: null,
    url: null,
    source: 'nfeAmbienteGuard'
  };
}

function bloqueioWebservice(ws) {
  return {
    success: false,
    code: ws.codigo,
    message: ws.mensagem,
    error: ws.mensagem,
    body: '',
    statusCode: null,
    url: null,
    source: 'nfeWebServices'
  };
}

const NS = Object.freeze({
  AUTORIZACAO: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4',
  CONSULTA: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4',
  STATUS: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4',
  EVENTO: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4'
});

const ACTIONS = Object.freeze({
  CONSULTA: `${NS.CONSULTA}/nfeConsultaNF`,
  STATUS: `${NS.STATUS}/nfeStatusServicoNF`,
  EVENTO: `${NS.EVENTO}/nfeRecepcaoEvento`
});

const URLS_SVRS_NFE = Object.freeze({
  1: Object.freeze({
    autorizacao: 'https://nfe.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
    consultaProtocolo: 'https://nfe.svrs.rs.gov.br/ws/NfeConsulta/NFeConsultaProtocolo4.asmx',
    status: 'https://nfe.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
    evento: 'https://nfe.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx'
  }),
  2: Object.freeze({
    autorizacao: 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
    consultaProtocolo: 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeConsulta/NFeConsultaProtocolo4.asmx',
    status: 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
    evento: 'https://nfe-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx'
  })
});

const SERVICOS = Object.freeze(['autorizacao', 'consultaProtocolo', 'status', 'evento']);

/** Chave de configuração (sem o sufixo _homologacao/_producao) de cada serviço. */
const CHAVES_WS_NFE = Object.freeze({
  autorizacao: 'fiscal_ws_nfe_autorizacao',
  consultaProtocolo: 'fiscal_ws_nfe_consulta',
  status: 'fiscal_ws_nfe_status',
  evento: 'fiscal_ws_nfe_evento'
});

/** cUF cuja NF-e 55 é autorizada pela SVRS (sem URL configurada, usa URLS_SVRS_NFE). */
const UFS_AUTORIZADOR_SVRS_NFE = Object.freeze([
  '11', '12', '14', '15', '16', '17', '22', '23', '24', '25', '27', '28', '32', '33', '42', '53'
]);

function normalizarAmbiente(ambiente) {
  return Number(ambiente) === 1 ? 1 : 2;
}

function sufixoAmbiente(ambiente) {
  return normalizarAmbiente(ambiente) === 1 ? 'producao' : 'homologacao';
}

/** urlsNfe ({ autorizacao, consultaProtocolo, status, evento }) das chaves fiscal_ws_nfe_* do ambiente. */
function urlsNfeDaConfiguracao(cfg, ambiente) {
  const sufixo = sufixoAmbiente(ambiente);
  const urls = {};
  SERVICOS.forEach((servico) => {
    urls[servico] = String((cfg && cfg[`${CHAVES_WS_NFE[servico]}_${sufixo}`]) || '').trim();
  });
  return urls;
}

function hostDe(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (_) {
    return '';
  }
}

const HOSTS_SVRS_NFE = Object.freeze({
  1: hostDe(URLS_SVRS_NFE[1].autorizacao),
  2: hostDe(URLS_SVRS_NFE[2].autorizacao)
});

function erroWebservice(codigo, mensagem) {
  return { ok: false, codigo, mensagem };
}

/** Valida a URL configurada para o ambiente (https, NF-e e não do outro ambiente). */
function validarUrlConfigurada(url, amb, chave) {
  let u;
  try {
    u = new URL(url);
  } catch (_) {
    return erroWebservice('WS_NFE_INVALIDO', `URL inválida em ${chave}.`);
  }
  if (u.protocol !== 'https:') return erroWebservice('WS_NFE_INVALIDO', `URL de ${chave} deve usar https.`);
  const host = u.hostname.toLowerCase();
  if (/^nfce[.-]/.test(host)) {
    return erroWebservice('WS_NFE_URL_NFCE', `${chave} aponta para o webservice da NFC-e (${host}), não da NF-e.`);
  }
  const outro = amb === 1 ? 2 : 1;
  const urlsOutroAmbiente = Object.values(URLS_SVRS_NFE[outro]).map((x) => x.toLowerCase());
  if (host === HOSTS_SVRS_NFE[outro] || urlsOutroAmbiente.includes(url.toLowerCase())) {
    return amb === 2
      ? erroWebservice('WS_NFE_PRODUCAO_EM_HOMOLOGACAO', `${chave} aponta para o webservice de PRODUÇÃO.`)
      : erroWebservice('WS_NFE_HOMOLOGACAO_EM_PRODUCAO', `${chave} aponta para o webservice de HOMOLOGAÇÃO.`);
  }
  return { ok: true };
}

/**
 * Resolvedor único do webservice NF-e 55 (emissor, consultas, eventos e diagnóstico).
 * URL configurada (fiscal_ws_nfe_<serviço>_<ambiente>) válida → ela; inválida → erro, sem fallback;
 * ausente → SVRS oficial se a UF é autorizada pela SVRS; senão erro.
 * O override só vale quando config.ambiente é o mesmo ambiente pedido.
 * @param {'autorizacao'|'consultaProtocolo'|'status'|'evento'} servico
 * @param {number|string} ambiente
 * @param {object} [config] { ambiente, codigoUf, urlsNfe } (getFiscalConfigNfe)
 * @returns {{ ok: boolean, servico, ambiente: 1|2, url: string|null, origem: 'configuracao'|'padrao_svrs'|null, chave: string, codigo?: string, mensagem: string }}
 */
function resolverWebserviceNfe(servico, ambiente, config = null) {
  if (!SERVICOS.includes(servico)) {
    throw new Error(`Serviço NF-e desconhecido: ${servico}`);
  }
  const amb = normalizarAmbiente(ambiente);
  const chave = `${CHAVES_WS_NFE[servico]}_${sufixoAmbiente(amb)}`;
  const base = { servico, ambiente: amb, chave };
  const ambienteConfig = config && config.ambiente != null ? normalizarAmbiente(config.ambiente) : null;
  const override = ambienteConfig === amb ? String(config?.urlsNfe?.[servico] || '').trim() : '';
  if (override) {
    const v = validarUrlConfigurada(override, amb, chave);
    if (!v.ok) return { ...base, ...v, url: null, origem: 'configuracao' };
    return { ...base, ok: true, url: override, origem: 'configuracao', mensagem: `Configurado em ${chave}.` };
  }
  const cUF = normalizarCUF(config && config.codigoUf);
  if (!UFS_AUTORIZADOR_SVRS_NFE.includes(cUF)) {
    return {
      ...base,
      ...erroWebservice('WS_NFE_NAO_CONFIGURADO', `UF ${cUF} não é autorizada pela SVRS: configure ${chave}.`),
      url: null,
      origem: null
    };
  }
  return { ...base, ok: true, url: URLS_SVRS_NFE[amb][servico], origem: 'padrao_svrs', mensagem: `SVRS (autorizador oficial da UF ${cUF}).` };
}

/** URL do resolvedor único; lança erro (code WS_NFE_*) quando a configuração é inválida. */
function resolverUrlNfe(servico, ambiente, config = null) {
  const r = resolverWebserviceNfe(servico, ambiente, config);
  if (!r.ok) {
    const err = new Error(r.mensagem);
    err.code = r.codigo;
    err.codigo = r.codigo;
    throw err;
  }
  return r.url;
}

function envelopeSoap12(namespace, cUF, versaoDados, corpo) {
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
      `xmlns:xsd="http://www.w3.org/2001/XMLSchema" ` +
      `xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
      `<soap12:Header>` +
        `<nfeCabecMsg xmlns="${namespace}">` +
          `<cUF>${cUF}</cUF>` +
          `<versaoDados>${versaoDados}</versaoDados>` +
        `</nfeCabecMsg>` +
      `</soap12:Header>` +
      `<soap12:Body>` +
        `<nfeDadosMsg xmlns="${namespace}">` +
          `${corpo}` +
        `</nfeDadosMsg>` +
      `</soap12:Body>` +
    `</soap12:Envelope>`
  );
}

function normalizarCUF(cUF) {
  return String(cUF || '23').replace(/\D/g, '').padStart(2, '0');
}

function montarEnvelopeConsultaProtocolo({ tpAmb = 2, chave, cUF = '23', versao = '4.00' }) {
  const chaveLimpa = String(chave || '').replace(/\D/g, '').padStart(44, '0').slice(0, 44);
  const cons =
    `<consSitNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="${versao}">` +
      `<tpAmb>${tpAmb}</tpAmb>` +
      `<xServ>CONSULTAR</xServ>` +
      `<chNFe>${chaveLimpa}</chNFe>` +
    `</consSitNFe>`;
  return envelopeSoap12(NS.CONSULTA, normalizarCUF(cUF), versao, cons);
}

function montarEnvelopeStatusServico({ tpAmb = 2, cUF = '23', versao = '4.00' }) {
  const uf = normalizarCUF(cUF);
  const cons =
    `<consStatServ xmlns="http://www.portalfiscal.inf.br/nfe" versao="${versao}">` +
      `<tpAmb>${tpAmb}</tpAmb>` +
      `<cUF>${uf}</cUF>` +
      `<xServ>STATUS</xServ>` +
    `</consStatServ>`;
  return envelopeSoap12(NS.STATUS, uf, versao, cons);
}

function montarEnvelopeEvento({ envEventoXml, cUF = '23', versao = '1.00' }) {
  const corpo = String(envEventoXml || '').replace(/^\s*<\?xml[^>]*\?>\s*/i, '').trim();
  return envelopeSoap12(NS.EVENTO, normalizarCUF(cUF), versao, corpo);
}

function tag(xml, nome) {
  const m = String(xml || '').match(new RegExp(`<(?:\\w+:)?${nome}[^>]*>([^<]*)</(?:\\w+:)?${nome}>`, 'i'));
  return m ? m[1].trim() : null;
}

function anexarResumo(resultado) {
  if (!resultado.success) return resultado;
  return {
    ...resultado,
    cStat: tag(resultado.body, 'cStat'),
    xMotivo: tag(resultado.body, 'xMotivo')
  };
}

async function consultarProtocoloNfe({
  chave,
  ambiente,
  cUF,
  certificadoPath,
  certificadoSenha,
  config = null,
  timeoutMs = 30000,
  httpClient = null,
  httpsAgent = null
}) {
  const bloqueio = bloqueioAmbiente(ambiente, 'consulta_protocolo');
  if (bloqueio) return bloqueio;
  const amb = normalizarAmbiente(ambiente);
  const ws = resolverWebserviceNfe('consultaProtocolo', amb, config);
  if (!ws.ok) return bloqueioWebservice(ws);
  const { url } = ws;
  const envelope = montarEnvelopeConsultaProtocolo({ tpAmb: amb, chave, cUF });
  const out = await enviarSoapSefaz({
    url,
    envelope,
    soapAction: ACTIONS.CONSULTA,
    certificadoPath,
    certificadoSenha,
    timeoutMs,
    httpClient,
    httpsAgent
  });
  return { ...anexarResumo(out), url, source: 'soapClient', error: out.success ? null : out.message };
}

async function consultarStatusServicoNfe({
  ambiente,
  cUF,
  certificadoPath,
  certificadoSenha,
  config = null,
  timeoutMs = 30000,
  httpClient = null,
  httpsAgent = null
}) {
  const bloqueio = bloqueioAmbiente(ambiente, 'status_servico');
  if (bloqueio) return bloqueio;
  const amb = normalizarAmbiente(ambiente);
  const ws = resolverWebserviceNfe('status', amb, config);
  if (!ws.ok) return bloqueioWebservice(ws);
  const { url } = ws;
  const envelope = montarEnvelopeStatusServico({ tpAmb: amb, cUF });
  const out = await enviarSoapSefaz({
    url,
    envelope,
    soapAction: ACTIONS.STATUS,
    certificadoPath,
    certificadoSenha,
    timeoutMs,
    httpClient,
    httpsAgent
  });
  return { ...anexarResumo(out), url, source: 'soapClient', error: out.success ? null : out.message };
}

async function enviarEventoNfe({
  envelope,
  ambiente,
  certificadoPath,
  certificadoSenha,
  config = null,
  url = null,
  timeoutMs = 30000,
  httpClient = null,
  httpsAgent = null
}) {
  const bloqueio = bloqueioAmbiente(ambiente, 'evento');
  if (bloqueio) return bloqueio;
  let destino = url;
  if (!destino) {
    const ws = resolverWebserviceNfe('evento', normalizarAmbiente(ambiente), config);
    if (!ws.ok) return bloqueioWebservice(ws);
    destino = ws.url;
  }
  const out = await enviarSoapSefaz({
    url: destino,
    envelope,
    soapAction: ACTIONS.EVENTO,
    certificadoPath,
    certificadoSenha,
    timeoutMs,
    httpClient,
    httpsAgent,
    debugNome: 'nfe-evento-soap-enviado.xml'
  });
  return { ...anexarResumo(out), url: destino, source: 'soapClient', error: out.success ? null : out.message };
}

module.exports = {
  NS,
  ACTIONS,
  URLS_SVRS_NFE,
  CHAVES_WS_NFE,
  UFS_AUTORIZADOR_SVRS_NFE,
  urlsNfeDaConfiguracao,
  resolverWebserviceNfe,
  resolverUrlNfe,
  montarEnvelopeConsultaProtocolo,
  montarEnvelopeStatusServico,
  montarEnvelopeEvento,
  consultarProtocoloNfe,
  consultarStatusServicoNfe,
  enviarEventoNfe
};
