/**
 * Distribuição DF-e — SEFAZ → SOAP → Download XML → Central de Entradas.
 *
 * Sprint 4: responsabilidade exclusiva de sincronizar documentos na inbox.
 * NÃO cria compras, NÃO altera estoque/financeiro, NÃO chama MIIP.
 *
 * @module services/fiscal/distribuicaoDFe
 */

const { getFiscalConfig } = require('./configService');
const { montarSoapDFe, enviarSoapDFe } = require('./soapClient');
const { inspecionarCertificadoPfx } = require('./certificateService');
const sefazGate = require('../../motores/central-entradas/services/CentralSefazOperationalGate');
const { TIPOS_CONSULTA } = sefazGate;
const CentralDfePersistenciaService = require('../../motores/central-entradas/services/CentralDfePersistenciaService');
const CentralDocumentosRepository = require('../../motores/central-entradas/repositories/CentralDocumentosRepository');
const CentralNsuRepository = require('../../motores/central-entradas/repositories/CentralNsuRepository');
const CentralNsuControleService = require('../../motores/central-entradas/services/CentralNsuControleService');
const {
  NSU_ZERADO,
  normalizarNsu,
  nsuMenorQue,
  extrairMetadadosRetorno,
  extrairDocumentosZip,
  extrairTodosNsus,
  retornoDistSucesso
} = require('./dfeRetornoParser');
const { emitirEvento } = require('../../motores/central-entradas/utils/centralEventosEmitter');
const { TIPOS_EVENTO, ORIGENS } = require('../../motores/central-entradas/config/centralEventosTipos');
const { criarErroSefaz } = require('./sefazErroOperacional');

const MAX_ITERACOES_SYNC = 50;

function getDfeUrl(ambiente) {
  return Number(ambiente) === 1
    ? 'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx'
    : 'https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx';
}

/**
 * @param {Object} config
 * @returns {string}
 */
function obterCodigoUf(config) {
  const codigo = config.fiscal_codigo_uf || config.codigoUf || config.codigo_uf || '23';
  return String(codigo).replace(/\D/g, '').padStart(2, '0');
}

/**
 * @param {Object} config
 * @throws {Error}
 */
function validarConfigFiscal(config) {
  if (!config.certificadoPath || !config.certificadoSenha) {
    throw new Error('Certificado não configurado');
  }

  if (!config.cnpj) {
    throw new Error('CNPJ do emitente não configurado');
  }
}

/**
 * @param {Object} params
 * @returns {string}
 */
function montarXmlDistNsu({ ambiente, codigoUf, cnpj, ultNsu }) {
  return `
<distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">
  <tpAmb>${ambiente}</tpAmb>
  <cUFAutor>${codigoUf}</cUFAutor>
  <CNPJ>${cnpj}</CNPJ>
  <distNSU>
    <ultNSU>${normalizarNsu(ultNsu)}</ultNSU>
  </distNSU>
</distDFeInt>`;
}

/**
 * @param {Object} params
 * @returns {string}
 */
function montarXmlConsChave({ ambiente, codigoUf, cnpj, chave }) {
  return `
<distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">
  <tpAmb>${ambiente}</tpAmb>
  <cUFAutor>${codigoUf}</cUFAutor>
  <CNPJ>${cnpj}</CNPJ>
  <consChNFe>
    <chNFe>${String(chave).replace(/\D/g, '')}</chNFe>
  </consChNFe>
</distDFeInt>`;
}

/**
 * @param {string} xmlConsulta
 * @param {Object} config
 * @param {number} ambiente
 * @returns {Promise<string>}
 */
async function enviarConsultaDfe(xmlConsulta, config, ambiente, contexto = {}) {
  const envelope = montarSoapDFe(xmlConsulta);
  const gate = contexto.gate || sefazGate;
  const enviar = contexto.enviarSoap || enviarSoapDFe;
  try {
    return await gate.executar(() => enviar(
      envelope,
      config.certificadoPath,
      config.certificadoSenha,
      getDfeUrl(ambiente)
    ), {
      cnpj: contexto.cnpj,
      origem: contexto.origem,
      tipoConsulta: contexto.tipoConsulta
    });
  } catch (error) {
    throw criarErroSefaz(error);
  }
}

/**
 * @param {Object} config
 * @param {string} cnpj
 * @param {Object} [deps]
 * @returns {Object}
 * @throws {Error} CERTIFICATE_* antes de qualquer TLS/SOAP
 */
function validarCertificadoEmitente(config, cnpj, deps = {}) {
  if (deps.pularInspecaoCertificado) {
    return { encontrado: true, valido: true, cnpj, caminho: config.certificadoPath, notAfter: null };
  }

  let inspecao;
  try {
    inspecao = (deps.inspecionarCertificado || inspecionarCertificadoPfx)(
      config.certificadoPath,
      config.certificadoSenha
    );
  } catch (error) {
    throw criarErroSefaz(error);
  }

  if (inspecao.cnpj && inspecao.cnpj !== cnpj) {
    const erro = new Error(`CNPJ do certificado (${inspecao.cnpj}) diverge do emitente configurado (${cnpj}).`);
    erro.codigo = 'CERTIFICATE_CONFIGURATION_ERROR';
    console.warn('[CE][SEFAZ] CERTIFICATE_CONFIGURATION_ERROR — consulta não enviada', {
      cnpjCertificado: inspecao.cnpj,
      cnpjEmitente: cnpj
    });
    throw criarErroSefaz(erro);
  }

  return inspecao;
}

/**
 * @param {Object} retorno
 * @returns {Error}
 */
function criarErroConsumoIndevido(retorno, janela) {
  const erro = criarErroSefaz({
    message: retorno.xMotivo || 'Rejeicao: Consumo Indevido',
    operacional: true,
    codigo: 'SEFAZ_REJEICAO'
  });
  erro.cStat = '656';
  erro.xMotivo = retorno.xMotivo || null;
  erro.ultNsu = retorno.ultNSU || null;
  erro.maxNsu = retorno.maxNSU || null;
  erro.janelaSefaz = janela || null;
  return erro;
}

/**
 * @param {string} xmlRetorno
 * @param {CentralDfePersistenciaService} persistencia
 * @param {string} origem
 * @returns {Promise<{ notasNovas: number, notasDuplicadas: number, ignorados: number }>}
 */
async function persistirDocumentosRetorno(xmlRetorno, persistencia, origem) {
  const documentos = extrairDocumentosZip(xmlRetorno);
  let notasNovas = 0;
  let notasDuplicadas = 0;
  let ignorados = 0;
  let xmlCompleto = 0;
  let xmlAguardando = 0;
  let recuperados = 0;

  for (const doc of documentos) {
    const resultado = await persistencia.persistirDocumentoDfe({
      xml: doc.xml,
      nsu: doc.nsu,
      origem
    });

    if (resultado.novo) notasNovas += 1;
    else if (resultado.duplicado) notasDuplicadas += 1;
    else if (resultado.ignorado) ignorados += 1;
    if (resultado.recuperado) recuperados += 1;
    if (resultado.aguardandoXml) xmlAguardando += 1;
    else if (resultado.novo || resultado.recuperado) xmlCompleto += 1;

    const chave = resultado.documento?.chave || null;
    console.log('[CE][XML]', {
      nsu: doc.nsu,
      chave,
      novo: Boolean(resultado.novo),
      duplicado: Boolean(resultado.duplicado),
      recuperado: Boolean(resultado.recuperado),
      aguardandoXml: Boolean(resultado.aguardandoXml),
      status: resultado.documento?.status || resultado.motivo || null
    });
  }

  return {
    notasNovas,
    notasDuplicadas,
    ignorados,
    xmlCompleto,
    xmlAguardando,
    recuperados,
    quantidade: documentos.length
  };
}

/**
 * @param {Object} [deps]
 * @returns {Promise<Object>}
 */
async function sincronizarDistribuicaoDFe(deps = {}) {
  const config = deps.config || await getFiscalConfig();
  validarConfigFiscal(config);

  const ambiente = Number(config.fiscal_ambiente || config.ambiente || 2);
  const cnpj = String(config.cnpj).replace(/\D/g, '');
  const codigoUf = obterCodigoUf(config);
  const urlDfe = getDfeUrl(ambiente);
  const gate = deps.sefazGate || sefazGate;
  const origem = deps.origem || ORIGENS.SISTEMA;

  const inspecao = validarCertificadoEmitente(config, cnpj, deps);

  try {
    await gate.exigirJanelaLivre(cnpj, { origem, tipoConsulta: TIPOS_CONSULTA.DIST_NSU });
  } catch (error) {
    throw criarErroSefaz(error);
  }

  console.log('[CE][SEFAZ]', {
    origem,
    ambiente,
    uf: codigoUf,
    cnpj,
    endpoint: urlDfe,
    certificado: inspecao.caminho,
    validadeAte: inspecao.notAfter ? inspecao.notAfter.toISOString() : null
  });

  const nsuRepository = deps.nsuRepository ?? new CentralNsuRepository();
  const persistencia = deps.persistenciaService ?? new CentralDfePersistenciaService();
  const nsuControle = deps.nsuControleService ?? new CentralNsuControleService({ nsuRepository });

  let controleNsu = await nsuRepository.obterOuCriar(cnpj, ambiente);
  let ultNsuAtual = normalizarNsu(controleNsu.ultNsu);
  let maxNsuAtual = normalizarNsu(controleNsu.maxNsu || NSU_ZERADO);

  let notasNovasTotal = 0;
  let notasDuplicadasTotal = 0;
  let ignoradosTotal = 0;
  let xmlCompletoTotal = 0;
  let xmlAguardandoTotal = 0;
  let iteracoes = 0;
  let ultimoRetorno = null;
  let janelaSefaz = null;
  const lacunasAcumuladas = [];

  await emitirEvento({
    tipo: TIPOS_EVENTO.DESCOBERTA,
    origem: ORIGENS.SISTEMA,
    descricao: 'Consulta DistDFe iniciada',
    resultado: 'iniciada',
    sucesso: true,
    detalhe: { ultNsu: ultNsuAtual }
  }).catch(() => {});

  while (iteracoes < (deps.maxIteracoes ?? MAX_ITERACOES_SYNC)) {
    iteracoes += 1;

    const xmlConsulta = montarXmlDistNsu({
      ambiente,
      codigoUf,
      cnpj,
      ultNsu: ultNsuAtual
    });

    console.log('[CE][DISTDFE] consulta', { iteracao: iteracoes, ultNsu: ultNsuAtual, maxNsu: maxNsuAtual });
    console.log('[CE][NSU] enviado', ultNsuAtual);

    let xmlRetorno;
    try {
      xmlRetorno = deps.enviarConsultaDfe
        ? await deps.enviarConsultaDfe(xmlConsulta, config, ambiente)
        : await enviarConsultaDfe(xmlConsulta, config, ambiente, {
          cnpj,
          origem,
          tipoConsulta: TIPOS_CONSULTA.DIST_NSU,
          gate,
          enviarSoap: deps.enviarSoap
        });
    } catch (error) {
      throw criarErroSefaz(error);
    }
    ultimoRetorno = extrairMetadadosRetorno(xmlRetorno);
    console.log('[CE][SEFAZ] retorno', {
      cStat: ultimoRetorno.cStat,
      xMotivo: ultimoRetorno.xMotivo,
      ultNSU: ultimoRetorno.ultNSU,
      maxNSU: ultimoRetorno.maxNSU
    });

    if (ultimoRetorno.cStat === '656') {
      const janela = await gate.registrarConsumoIndevido(cnpj);
      console.warn('[CE][NSU] 656 — NSU não alterado', { ultNsu: ultNsuAtual });
      throw criarErroConsumoIndevido(ultimoRetorno, janela);
    }

    if (!retornoDistSucesso(ultimoRetorno.cStat)) {
      throw criarErroSefaz({
        message: ultimoRetorno.xMotivo
          || `SEFAZ retornou cStat ${ultimoRetorno.cStat || 'desconhecido'}`,
        operacional: true,
        codigo: 'SEFAZ_REJEICAO'
      });
    }

    const persistidos = await persistirDocumentosRetorno(xmlRetorno, persistencia, 'dfe');
    console.log('[CE][XML] persistidos', persistidos);
    notasNovasTotal += persistidos.notasNovas;
    notasDuplicadasTotal += persistidos.notasDuplicadas;
    ignoradosTotal += persistidos.ignorados;
    xmlCompletoTotal += persistidos.xmlCompleto || 0;
    xmlAguardandoTotal += persistidos.xmlAguardando || 0;

    const nsuAnterior = ultNsuAtual;
    const nsuRetornado = normalizarNsu(ultimoRetorno.ultNSU);
    const maxRetornado = normalizarNsu(ultimoRetorno.maxNSU);

    if (nsuMenorQue(nsuRetornado, nsuAnterior)) {
      console.warn('[CE][NSU] regressao ignorada', { nsuRetornado, nsuAnterior });
      ultNsuAtual = nsuAnterior;
    } else {
      ultNsuAtual = nsuRetornado;
    }

    if (nsuMenorQue(maxRetornado, maxNsuAtual)) {
      console.warn('[CE][NSU] maxNSU regressivo ignorado', { maxRetornado, maxNsuAtual });
    } else {
      maxNsuAtual = maxRetornado;
    }

    const lacunas = await nsuControle.registrarConsultaEDetectarLacunas({
      nsuAnterior,
      nsuAtual: ultNsuAtual,
      nsusVistos: extrairTodosNsus(xmlRetorno),
      origem: ORIGENS.SISTEMA
    });
    if (lacunas.lacunas?.length) {
      lacunasAcumuladas.push(...lacunas.lacunas);
    }

    controleNsu = await nsuRepository.atualizarSincronizacao(controleNsu.id, {
      ultNsu: ultNsuAtual,
      maxNsu: maxNsuAtual
    });
    console.log('[CE][NSU] persistido', { ultNsu: ultNsuAtual, maxNsu: maxNsuAtual });

    if (!nsuMenorQue(ultNsuAtual, maxNsuAtual)) {
      janelaSefaz = await gate.registrarNsuAlcancado(cnpj);
      break;
    }
  }

  return {
    sucesso: true,
    notasNovas: notasNovasTotal,
    notasDuplicadas: notasDuplicadasTotal,
    ignorados: ignoradosTotal,
    xmlCompleto: xmlCompletoTotal,
    xmlAguardando: xmlAguardandoTotal,
    ultNsu: ultNsuAtual,
    maxNsu: maxNsuAtual,
    iteracoes,
    cStat: ultimoRetorno?.cStat || '138',
    xMotivo: ultimoRetorno?.xMotivo || null,
    mensagem: notasNovasTotal > 0
      ? `${notasNovasTotal} nova(s) nota(s) sincronizada(s)`
      : 'Sincronização concluída — nenhuma nota nova',
    ultimaSincronizacao: controleNsu.dataSincronizacao || controleNsu.updatedAt,
    lacunasNsu: lacunasAcumuladas.slice(0, 50),
    proximaConsultaApos: janelaSefaz?.desbloqueioEm || null
  };
}

/**
 * Compatibilidade legada — delega à sincronização oficial.
 *
 * @deprecated RC1 — Use POST /api/central-entradas/sincronizar
 * @returns {Promise<Object>}
 */
async function distribuirDocumentosRecebidos() {
  const resultado = await sincronizarDistribuicaoDFe();
  return {
    sucesso: resultado.sucesso,
    notasNovas: resultado.notasNovas,
    mensagem: resultado.mensagem,
    ultNsu: resultado.ultNsu,
    maxNsu: resultado.maxNsu
  };
}

/**
 * @param {string} chave
 * @param {Object} [deps]
 * @returns {Promise<Object>}
 */
async function consultarNotaPorChave(chave, deps = {}) {
  const config = deps.config || await getFiscalConfig();
  validarConfigFiscal(config);

  const chaveLimpa = String(chave || '').replace(/\D/g, '');
  if (chaveLimpa.length !== 44) {
    throw new Error('Chave deve conter 44 dígitos');
  }

  const ambiente = Number(config.fiscal_ambiente || config.ambiente || 2);
  const cnpj = String(config.cnpj).replace(/\D/g, '');
  const codigoUf = obterCodigoUf(config);
  const persistencia = deps.persistenciaService ?? new CentralDfePersistenciaService();

  const xmlConsulta = montarXmlConsChave({
    ambiente,
    codigoUf,
    cnpj,
    chave: chaveLimpa
  });

  const gate = deps.sefazGate || sefazGate;
  validarCertificadoEmitente(config, cnpj, deps);

  const xmlRetorno = await enviarConsultaDfe(xmlConsulta, config, ambiente, {
    cnpj,
    origem: deps.origem || ORIGENS.API,
    tipoConsulta: TIPOS_CONSULTA.CONS_CHAVE,
    gate,
    enviarSoap: deps.enviarSoap
  });
  const metadados = extrairMetadadosRetorno(xmlRetorno);

  if (metadados.cStat === '656') {
    const janela = await gate.registrarConsumoIndevido(cnpj);
    throw criarErroConsumoIndevido(metadados, janela);
  }

  if (!retornoDistSucesso(metadados.cStat) && metadados.cStat !== '138') {
    throw new Error(metadados.xMotivo || `SEFAZ retornou cStat ${metadados.cStat}`);
  }

  const persistidos = await persistirDocumentosRetorno(xmlRetorno, persistencia, 'consulta_chave');

  await emitirEvento({
    tipo: TIPOS_EVENTO.CONSULTA,
    origem: ORIGENS.API,
    descricao: `Consulta por chave ${chaveLimpa}`,
    resultado: metadados.cStat,
    sucesso: true,
    detalhe: { chave: chaveLimpa, cStat: metadados.cStat }
  }).catch(() => {});

  return {
    sucesso: true,
    chave: chaveLimpa,
    cStat: metadados.cStat,
    mensagem: metadados.xMotivo,
    notasNovas: persistidos.notasNovas,
    notasDuplicadas: persistidos.notasDuplicadas,
    ignorados: persistidos.ignorados
  };
}

/**
 * Lista documentos da Central (compatibilidade legada /api/dfe/consultar-notas).
 *
 * @deprecated RC1 — Use GET /api/central-entradas/documentos
 * @returns {Promise<Object>}
 */
async function consultarNotasRecebidas() {
  const repository = new CentralDocumentosRepository();
  const documentos = await repository.listar({ limite: 200, ordenarPor: 'created_at', ordenarDirecao: 'DESC' });

  return {
    sucesso: true,
    mensagem: 'Notas da Central Inteligente de Entradas',
    notas: documentos.map((doc) => ({
      id: doc.id,
      chave: doc.chave,
      numero: doc.numero,
      serie: doc.serie,
      fornecedor: doc.fornecedor,
      cnpj_fornecedor: doc.cnpjFornecedor,
      data_emissao: doc.dataEmissao,
      valor_total: doc.valorTotal,
      status: doc.status,
      origem: doc.origem,
      nsu: doc.nsu,
      created_at: doc.createdAt
    }))
  };
}

module.exports = {
  sincronizarDistribuicaoDFe,
  distribuirDocumentosRecebidos,
  consultarNotaPorChave,
  consultarNotasRecebidas,
  getDfeUrl,
  montarXmlDistNsu,
  montarXmlConsChave,
  extrairMetadadosRetorno,
  extrairDocumentosZip,
  persistirDocumentosRetorno
};
