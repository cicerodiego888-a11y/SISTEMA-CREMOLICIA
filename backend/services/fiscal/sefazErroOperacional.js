/**
 * Classificação de erros operacionais da SEFAZ DistDFe.
 *
 * Distingue falha operacional de bug interno. Nunca devolve HTML cru.
 *
 * @module services/fiscal/sefazErroOperacional
 */

const CODIGOS = Object.freeze({
  INTERNO: 'ERRO_INTERNO',
  CONFIGURACAO: 'ERRO_CONFIGURACAO',
  CERTIFICADO: 'ERRO_CERTIFICADO',
  CERTIFICATE_NOT_FOUND: 'CERTIFICATE_NOT_FOUND',
  CERTIFICATE_INVALID: 'CERTIFICATE_INVALID',
  CERTIFICATE_EXPIRED: 'CERTIFICATE_EXPIRED',
  CERTIFICATE_CONFIGURATION_ERROR: 'CERTIFICATE_CONFIGURATION_ERROR',
  TLS_ERROR: 'TLS_ERROR',
  TIMEOUT: 'TIMEOUT',
  SEFAZ_INDISPONIVEL: 'SEFAZ_INDISPONIVEL',
  SEFAZ_ENDPOINT: 'SEFAZ_ENDPOINT',
  SEFAZ_REJEICAO: 'SEFAZ_REJEICAO',
  SEFAZ_SOAP: 'ERRO_SOAP',
  GATE: 'SEFAZ_GATE'
});

function textoErro(error) {
  if (!error) return '';
  if (typeof error === 'string') return error;
  const data = error.response?.data;
  if (typeof data === 'string' && data.length && data.length < 400 && !/<html/i.test(data)) {
    return data;
  }
  return error.message || String(error);
}

function sanitizarMensagem(texto) {
  const bruto = String(texto || '').replace(/\s+/g, ' ').trim();
  if (!bruto) return 'Falha operacional na comunicação com a SEFAZ.';
  if (/<!DOCTYPE html/i.test(bruto) || /<html/i.test(bruto)) {
    return 'SEFAZ retornou HTML em vez do serviço DistDFe (endpoint inválido ou indisponível).';
  }
  return bruto.slice(0, 400);
}

/**
 * @param {*} error
 * @returns {{ codigo: string, mensagem: string, operacional: boolean }}
 */
function classificarErroSefaz(error) {
  const bruto = textoErro(error);
  const httpStatus = error?.response?.status || error?.httpStatus || null;
  const code = error?.code || error?.codigo || '';

  if (typeof error?.operacional === 'boolean' && Object.values(CODIGOS).includes(error?.codigo)) {
    return {
      codigo: error.codigo,
      mensagem: sanitizarMensagem(bruto),
      operacional: error.operacional
    };
  }

  if (code === 'SEFAZ_GATE_BLOQUEADO' || error?.statusCode === 429) {
    return {
      codigo: CODIGOS.GATE,
      mensagem: sanitizarMensagem(bruto || 'Consulta SEFAZ bloqueada pelo Gate operacional.'),
      operacional: true
    };
  }

  if (
    code === CODIGOS.CERTIFICATE_NOT_FOUND
    || /não encontrado em:|Certificado não encontrado/i.test(bruto)
  ) {
    return {
      codigo: CODIGOS.CERTIFICATE_NOT_FOUND,
      mensagem: sanitizarMensagem(bruto),
      operacional: true
    };
  }

  if (code === CODIGOS.CERTIFICATE_EXPIRED || /certificado expirado/i.test(bruto)) {
    return {
      codigo: CODIGOS.CERTIFICATE_EXPIRED,
      mensagem: sanitizarMensagem(bruto),
      operacional: true
    };
  }

  if (code === CODIGOS.CERTIFICATE_CONFIGURATION_ERROR || /Caminho do certificado não configurado/i.test(bruto)) {
    return {
      codigo: CODIGOS.CERTIFICATE_CONFIGURATION_ERROR,
      mensagem: sanitizarMensagem(bruto),
      operacional: true
    };
  }

  if (
    code === CODIGOS.CERTIFICATE_INVALID
    || /PFX|chave privada|certificado folha|pkcs12|mac verify|invalid password/i.test(bruto)
  ) {
    return {
      codigo: CODIGOS.CERTIFICATE_INVALID,
      mensagem: sanitizarMensagem(bruto),
      operacional: true
    };
  }

  if (
    code === CODIGOS.TLS_ERROR
    || /UNABLE_TO_VERIFY|ERR_SSL|EPROTO|unable to get local issuer|client certificate/i.test(code + bruto)
  ) {
    return {
      codigo: CODIGOS.TLS_ERROR,
      mensagem: sanitizarMensagem(bruto || 'Falha TLS/mTLS na conexão DistDFe.'),
      operacional: true
    };
  }

  if (/certificado/i.test(bruto) || code === 'CERTIFICADO' || code === CODIGOS.CERTIFICADO) {
    return {
      codigo: CODIGOS.CERTIFICADO,
      mensagem: sanitizarMensagem(bruto),
      operacional: true
    };
  }

  if (/CNPJ do emitente não configurado|não configurado/i.test(bruto) && !/certificado/i.test(bruto)) {
    return {
      codigo: CODIGOS.CONFIGURACAO,
      mensagem: sanitizarMensagem(bruto),
      operacional: true
    };
  }

  if (code === 'ECONNABORTED' || /timeout/i.test(bruto)) {
    return {
      codigo: CODIGOS.TIMEOUT,
      mensagem: 'A SEFAZ não respondeu no tempo limite da consulta DistDFe.',
      operacional: true
    };
  }

  if (httpStatus === 404 || /status code 404/i.test(bruto) || /resource cannot be found/i.test(bruto)) {
    return {
      codigo: CODIGOS.SEFAZ_ENDPOINT,
      mensagem: 'Endpoint DistDFe da SEFAZ não encontrado. Verifique a URL do Ambiente Nacional (www1).',
      operacional: true
    };
  }

  if (httpStatus >= 500) {
    return {
      codigo: CODIGOS.SEFAZ_INDISPONIVEL,
      mensagem: 'SEFAZ indisponível no momento (falha HTTP no DistDFe).',
      operacional: true
    };
  }

  if (/cStat/i.test(bruto) || /rejeic/i.test(bruto) || /SEFAZ retornou/i.test(bruto)) {
    return {
      codigo: CODIGOS.SEFAZ_REJEICAO,
      mensagem: sanitizarMensagem(bruto),
      operacional: true
    };
  }

  if (httpStatus || /ECONNRESET|ENOTFOUND|EAI_AGAIN|certificate/i.test(code + bruto)) {
    return {
      codigo: CODIGOS.SEFAZ_SOAP,
      mensagem: sanitizarMensagem(bruto),
      operacional: true
    };
  }

  if (error?.operacional) {
    return {
      codigo: error.codigo || CODIGOS.SEFAZ_SOAP,
      mensagem: sanitizarMensagem(bruto),
      operacional: true
    };
  }

  return {
    codigo: CODIGOS.INTERNO,
    mensagem: sanitizarMensagem(bruto || 'Erro interno na sincronização DistDFe.'),
    operacional: false
  };
}

function criarErroSefaz(error) {
  const classificado = classificarErroSefaz(error);
  const err = new Error(classificado.mensagem);
  err.codigo = classificado.codigo;
  err.operacional = classificado.operacional;
  err.httpStatus = error?.response?.status || error?.httpStatus || null;
  if (error?.cStat) err.cStat = error.cStat;
  if (error?.xMotivo) err.xMotivo = error.xMotivo;
  if (error?.ultNsu) err.ultNsu = error.ultNsu;
  if (error?.maxNsu) err.maxNsu = error.maxNsu;
  if (error?.janelaSefaz) err.janelaSefaz = error.janelaSefaz;
  return err;
}

module.exports = {
  CODIGOS,
  classificarErroSefaz,
  criarErroSefaz,
  sanitizarMensagem
};
