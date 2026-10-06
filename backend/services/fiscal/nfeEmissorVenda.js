/**
 * Emissor NF-e modelo 55 para venda (Sprint 3.2).
 * Sidecar pós-Núcleo — NÃO altera emissor NFC-e (emissor.js).
 * Reutiliza: certificado, assinatura, montarLote, enviarLote, getFiscalConfig.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../../database');
const { getFiscalConfigNfe } = require('./configService');
const { carregarCertificadoPfx, inspecionarCertificadoPfx } = require('./certificateService');
const { assinarNFe } = require('./signer');
const { montarLote, enviarLote } = require('./soapClient');
const { extrairChaveEProtocoloAutorizados, onlyDigits } = require('./utils');
const { resolverUrlNfe, resolverWebserviceNfe } = require('./nfeWebServices');
const { withLock } = require('./nfeEmissionLockService');
const { getFiscalSubDir } = require('./paths');
const { buildNfeXml, itemEntraNaNfe } = require('./xmlBuilderNfeVenda');
const { validarXmlFiscal } = require('./validarXmlFiscal');
const { gerarDanfeNfeHtml } = require('./danfeNfe');
const { parseRetornoAutorizacaoNfe } = require('./nfeRetornoAutorizacao');
const { iniciarAuditoriaXmlNfe } = require('./nfeXmlAuditoria');
const { traceNfe } = require('./nfeTrace');
const {
  ambienteNfePermitido,
  erroAmbienteNfe,
  resolverAmbienteNfe,
  CHAVE_AMBIENTE_NFE
} = require('./nfeAmbienteGuard');
const { resolverMunicipioDestinatario } = require('./municipioIbge');
const { assertInscricaoEstadualDestinatarioNfe } = require('./inscricaoEstadual');
const {
  validarParametrosIdentidadeNfe,
  prepararIdentidadeEmissaoNfe,
  conferirIdentidadeXmlNfe
} = require('./nfeIdentityService');
const configService = require('../configuracaoService');

const MSG_CHAVE_PRIVADA =
  'Não foi possível obter a chave privada do certificado digital.';
const MSG_CERT_PEM =
  'Não foi possível obter o certificado digital (PEM).';

function salvarDebug(nome, conteudo) {
  const pasta = getFiscalSubDir('debug/nfe-venda');
  fs.writeFileSync(path.join(pasta, nome), String(conteudo ?? ''), 'utf8');
}

/** Logs exclusivos do sidecar NF-e — não usados pela NFC-e. */
function logNfe(mensagem) {
  console.log(`[NFE] ${mensagem}`);
}

/**
 * RC3.15.5 — garante PEM de chave privada (string) antes de assinarNFe.
 * Evita o erro Node "key.key ... Received undefined" ao passar objeto/undefined.
 */
function assertPrivateKeyPemNfe(privateKeyPem) {
  if (privateKeyPem == null || typeof privateKeyPem !== 'string') {
    const err = new Error(MSG_CHAVE_PRIVADA);
    err.code = 'CERT_PRIVATE_KEY_INVALID';
    throw err;
  }
  const pem = privateKeyPem.trim();
  if (!pem) {
    const err = new Error(MSG_CHAVE_PRIVADA);
    err.code = 'CERT_PRIVATE_KEY_INVALID';
    throw err;
  }
  if (!/-----BEGIN (RSA )?PRIVATE KEY-----/.test(pem)) {
    const err = new Error(MSG_CHAVE_PRIVADA);
    err.code = 'CERT_PRIVATE_KEY_INVALID';
    throw err;
  }
  return pem;
}

function assertCertPemNfe(certPem) {
  if (certPem == null || typeof certPem !== 'string' || !String(certPem).trim()) {
    const err = new Error(MSG_CERT_PEM);
    err.code = 'CERT_PEM_INVALID';
    throw err;
  }
  if (!/-----BEGIN CERTIFICATE-----/.test(certPem)) {
    const err = new Error(MSG_CERT_PEM);
    err.code = 'CERT_PEM_INVALID';
    throw err;
  }
  return certPem;
}

/**
 * Checklist pré-assinatura NF-e: PFX no disco, senha tipada, carga + PEM válidos.
 * Retorna apenas strings PEM para o contrato assinarNFe(xml, privateKeyPem, certPem).
 */
function carregarEValidarCertificadoNfe(config, deps = {}) {
  const pathPfx = String(config.certificadoPath || '').trim();
  if (!deps.carregarCertificado && (!pathPfx || !fs.existsSync(pathPfx))) {
    const err = new Error('Certificado A1/PFX não encontrado.');
    err.code = 'CERT_AUSENTE';
    throw err;
  }
  logNfe('Certificado localizado');

  if (config.certificadoSenha != null && typeof config.certificadoSenha !== 'string') {
    const err = new Error('Senha do certificado digital inválida.');
    err.code = 'CERT_SENHA_INVALIDA';
    throw err;
  }
  logNfe('Senha válida');

  const material = (deps.carregarCertificado || carregarCertificadoPfx)(pathPfx, config.certificadoSenha || '');
  logNfe('PFX carregado');

  const privateKeyPem = assertPrivateKeyPemNfe(material.privateKeyPem);
  logNfe('Chave privada extraída');
  logNfe('PrivateKey OK');

  const certPem = assertCertPemNfe(material.certPem);
  logNfe('Certificado extraído');
  logNfe('Certificado OK');

  return { privateKeyPem, certPem };
}

function getUrlNFe55(config) {
  return resolverUrlNfe('autorizacao', config.ambiente, config);
}

function erroConfiguracaoCertificado(mensagem) {
  const err = new Error(mensagem);
  err.code = 'CERTIFICATE_CONFIGURATION_ERROR';
  return err;
}

/**
 * CNPJ configurado = CNPJ do certificado = CNPJ da empresa ativa (14 dígitos).
 * Bloqueia antes de reservar número ou transmitir; nunca ajusta o CNPJ configurado.
 * @param {object} config retorno de getFiscalConfig
 * @param {object} [deps]
 * @param {string} [deps.cnpjEmpresaAtiva] configuracoes.cnpj do banco ativo
 */
function validarCertificadoEmitenteNfe(config, deps = {}) {
  const cnpjEmitente = onlyDigits(config.cnpj || '');
  if (cnpjEmitente.length !== 14) {
    throw erroConfiguracaoCertificado('CNPJ do emitente não configurado (14 dígitos).');
  }
  if (deps.cnpjEmpresaAtiva !== undefined && onlyDigits(deps.cnpjEmpresaAtiva || '') !== cnpjEmitente) {
    throw erroConfiguracaoCertificado(
      `CNPJ fiscal configurado (${cnpjEmitente}) diverge do CNPJ da empresa ativa (${onlyDigits(deps.cnpjEmpresaAtiva || '') || 'não configurado'}).`
    );
  }
  const inspecao = (deps.inspecionarCertificado || inspecionarCertificadoPfx)(
    config.certificadoPath,
    config.certificadoSenha
  );
  const cnpjCertificado = onlyDigits(inspecao?.cnpj || '');
  if (cnpjCertificado.length !== 14) {
    throw erroConfiguracaoCertificado('Não foi possível identificar o CNPJ do certificado digital.');
  }
  if (cnpjCertificado !== cnpjEmitente) {
    throw erroConfiguracaoCertificado(
      `CNPJ do certificado (${cnpjCertificado}) diverge do CNPJ do emitente configurado (${cnpjEmitente}).`
    );
  }
  return inspecao;
}

/** Lote recebido pela SEFAZ: a consulta automática/CONSULTAR decide; nova emissão fica bloqueada. */
const STATUS_LOTE_NA_SEFAZ = Object.freeze(['aguardando_retorno', 'lote_processamento']);
const STATUS_EM_TRANSITO = Object.freeze(['emitindo', 'transmitindo', ...STATUS_LOTE_NA_SEFAZ]);
/** Transmissão sem retorno conclusivo (queda/timeout): só a consulta pela chave decide o próximo passo. */
const STATUS_RESULTADO_INCERTO = Object.freeze(['emitindo', 'transmitindo', 'erro_transmissao']);
/** cancelamento_rejeitado mantém a NF-e autorizada. */
const STATUS_AUTORIZADA = Object.freeze(['autorizada', 'cancelamento_rejeitado']);
const BLOQUEIO_NOVA_EMISSAO = Object.freeze({
  cancelada: {
    codigo: 'NFE_CANCELADA',
    message: 'A NF-e desta venda foi cancelada. Nova emissão para a mesma venda exige regra explícita.'
  },
  denegada: {
    codigo: 'NFE_DENEGADA',
    message: 'A NF-e desta venda foi denegada pela SEFAZ. Nova emissão para a mesma venda não é permitida.'
  }
});

function vendaEstaCancelada(venda) {
  return String(venda?.status || '').trim().toLowerCase() === 'cancelada';
}

/** Município digitado na emissão precisa existir na base IBGE da UF antes de consumir número. */
function validarMunicipioInformadoNfe(venda, dadosNfe = {}) {
  const municipio = String(dadosNfe.dest_municipio || '').trim();
  if (!municipio) return null;
  const uf = String(dadosNfe.dest_uf || venda?.cliente_uf || '').trim().toUpperCase();
  let codigo;
  try {
    codigo = resolverMunicipioDestinatario({
      cidade: municipio,
      uf,
      codigoMunicipio: dadosNfe.dest_codigo_municipio
    });
  } catch (_) {
    return null;
  }
  if (codigo) return null;
  return {
    success: false,
    status: 'erro_validacao',
    message: `Município "${municipio}" não encontrado na UF ${uf || '—'}. Verifique o município e a UF do destinatário.`,
    code: 'DEST_MUNICIPIO_INVALIDO',
    codigo: 'DEST_MUNICIPIO_INVALIDO'
  };
}

/** IE do destinatário precisa caber no leiaute antes de consumir número. */
function validarInscricaoEstadualInformadaNfe(venda, dadosNfe = {}) {
  try {
    assertInscricaoEstadualDestinatarioNfe(venda, dadosNfe);
    return null;
  } catch (err) {
    if (err.code !== 'DEST_IE_INVALIDA') throw err;
    return {
      success: false,
      status: 'erro_validacao',
      message: err.message,
      code: err.code,
      codigo: err.code
    };
  }
}

function resumoNotaNfe(nota) {
  if (!nota) return null;
  return {
    id: nota.id,
    status: String(nota.status || '').toLowerCase(),
    numero: nota.numero,
    serie: nota.serie,
    chave: nota.chave_acesso || null,
    protocolo: nota.protocolo || null,
    ambiente: nota.ambiente != null ? Number(nota.ambiente) : null,
    origem: nota.origem || null,
    pedido_id: nota.pedido_id != null ? Number(nota.pedido_id) : null,
    cstat: nota.cstat_consulta || null,
    xmotivo: nota.xmotivo_consulta || null,
    mensagem: nota.erro_mensagem || null,
    sugestao: nota.erro_sugestao || null,
    atualizado_em: nota.updated_at || nota.created_at || null
  };
}

function listarNotasResumoVenda(vendaId) {
  const sqlCompleto = `
    SELECT id, status, numero, serie, chave_acesso, protocolo, ambiente, origem, pedido_id,
           cstat_consulta, xmotivo_consulta, erro_mensagem, erro_sugestao, created_at, updated_at
    FROM nfe_notas WHERE venda_id = ? ORDER BY id DESC LIMIT 20`;
  const sqlBasico = `
    SELECT id, status, numero, serie, chave_acesso, protocolo, ambiente, created_at, updated_at
    FROM nfe_notas WHERE venda_id = ? ORDER BY id DESC LIMIT 20`;
  const all = (sql) => new Promise((resolve, reject) => {
    db.all(sql, [vendaId], (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
  return all(sqlCompleto).catch(() => all(sqlBasico)).catch(() => []);
}

/**
 * Situação NF-e da venda para a interface (sem XML/DANFE).
 * Usa as mesmas listas de status do emissor para decidir se pode emitir.
 */
async function resumoNfeDaVenda(venda, itens = []) {
  const vendaId = Number(venda?.id);
  const notas = Number.isFinite(vendaId) && vendaId > 0 ? await listarNotasResumoVenda(vendaId) : [];
  const autorizada = notas.find((n) => STATUS_AUTORIZADA.includes(String(n.status || '').toLowerCase())) || null;
  const ultima = notas[0] || null;
  const statusUltima = String(ultima?.status || '').toLowerCase();
  const chaveUltima = onlyDigits(ultima?.chave_acesso || '');

  const possuiParcelaFiscal = (itens || []).some(itemEntraNaNfe);
  const concluida = String(venda?.status || '').trim().toLowerCase() === 'concluida';
  const cancelada = vendaEstaCancelada(venda);
  const emAndamento = !autorizada && (
    STATUS_EM_TRANSITO.includes(statusUltima)
    || (STATUS_RESULTADO_INCERTO.includes(statusUltima) && chaveUltima.length === 44)
  );
  const bloqueio = !autorizada ? BLOQUEIO_NOVA_EMISSAO[statusUltima] : null;

  let motivo = null;
  if (cancelada) motivo = 'Venda cancelada.';
  else if (!concluida) motivo = 'Venda não concluída.';
  else if (!possuiParcelaFiscal) motivo = 'Venda sem parcela fiscal.';
  else if (autorizada) motivo = 'NF-e já autorizada para esta venda.';
  else if (emAndamento) motivo = 'NF-e desta venda em processamento.';
  else if (bloqueio) motivo = bloqueio.message;

  const podeEmitir = !motivo;
  let acao = 'nenhuma';
  if (autorizada) acao = 'autorizada';
  else if (emAndamento) acao = 'consultar';
  else if (podeEmitir) acao = ultima ? 'emitir_novamente' : 'emitir';

  return {
    nota: resumoNotaNfe(autorizada || ultima),
    possui_parcela_fiscal: possuiParcelaFiscal,
    em_andamento: emAndamento,
    pode_emitir: podeEmitir,
    motivo_bloqueio: motivo,
    acao
  };
}

function getConfiguracao(chave, padrao = '') {
  return new Promise((resolve, reject) => {
    db.get('SELECT valor FROM configuracoes WHERE chave = ?', [chave], (err, row) => {
      if (err) return reject(err);
      resolve(row?.valor || padrao);
    });
  });
}

/** CNPJ + série + ambiente + cUF do emitente que vai assinar a NF-e (mesma origem para numeração e chave). */
async function contextoNumeracaoNfe(config = null) {
  const serie = Number(config?.serieNfe)
    || Number(await getConfiguracao('fiscal_serie_nfe', await getConfiguracao('fiscal_serie', '1'))) || 1;
  const ambiente = Number(config?.ambiente)
    || resolverAmbienteNfe({ [CHAVE_AMBIENTE_NFE]: await getConfiguracao(CHAVE_AMBIENTE_NFE, '') }).ambiente || 2;
  const cnpj = onlyDigits(config?.cnpj || await getConfiguracao('cnpj', ''));
  const uf = String(config?.codigoUf || await getConfiguracao('fiscal_codigo_uf', '23'));
  return { serie, ambiente, cnpj, uf };
}

/**
 * Reserva o número na série/ambiente/CNPJ do emitente que vai assinar a NF-e.
 * @param {object} [config] config fiscal da emissão (serieNfe, ambiente, cnpj)
 */
async function proximoNumeroNFeVenda(config = null) {
  const { reservarProximoNumeroNfe } = require('./nfeNumeracaoNfeService');
  const { serie, ambiente, cnpj } = await contextoNumeracaoNfe(config);
  return reservarProximoNumeroNfe({ serie, ambiente, cnpj });
}

/** Uma reserva de número → uma identidade (chave) da NF-e, com os mesmos CNPJ/série/ambiente. */
async function reservarIdentidadeNfeVenda(config) {
  const { reservarProximoNumeroNfe } = require('./nfeNumeracaoNfeService');
  const ctx = validarParametrosIdentidadeNfe(await contextoNumeracaoNfe(config));
  const numero = await reservarProximoNumeroNfe({ serie: ctx.serie, ambiente: ctx.ambiente, cnpj: ctx.cnpj });
  return prepararIdentidadeEmissaoNfe({ ...ctx, numero: Number(numero?.numero ?? numero) });
}

function garantirTabelaNfeNotas() {
  return new Promise((resolve, reject) => {
    db.run(`
      CREATE TABLE IF NOT EXISTS nfe_notas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        venda_id INTEGER NOT NULL,
        pedido_id INTEGER,
        numero INTEGER NOT NULL,
        serie INTEGER NOT NULL,
        chave_acesso TEXT,
        ambiente INTEGER DEFAULT 2,
        status TEXT DEFAULT 'pendente',
        xml_enviado TEXT,
        xml_retorno TEXT,
        protocolo TEXT,
        recibo TEXT,
        danfe_html TEXT,
        natureza_operacao TEXT,
        cfop TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (venda_id) REFERENCES vendas(id)
      )
    `, (err) => {
      if (err) return reject(err);
      db.run('ALTER TABLE nfe_notas ADD COLUMN origem TEXT', () => resolve());
    });
  });
}

const ORIGENS_NFE = Object.freeze(['PEDIDO', 'MANUAL']);

/**
 * Origem da NF-e pelo vínculo gravado no banco: venda faturada de um pedido → PEDIDO;
 * qualquer outra venda → MANUAL. O pedido_id informado pelo cliente não é usado.
 */
function resolverOrigemNfeVenda(vendaId, conexao) {
  const alvo = conexao || db;
  return new Promise((resolve) => {
    alvo.get(
      'SELECT id FROM pedidos_comerciais WHERE venda_id = ? ORDER BY id DESC LIMIT 1',
      [Number(vendaId)],
      (err, row) => resolve(!err && row
        ? { origem: 'PEDIDO', pedidoId: Number(row.id) }
        : { origem: 'MANUAL', pedidoId: null })
    );
  });
}

function carregarVendaParaNfe(vendaId) {
  return new Promise((resolve, reject) => {
    db.get(`
      SELECT
        v.*,
        c.nome AS cliente_nome,
        c.cpf_cnpj AS cliente_cpf,
        c.rua AS cliente_rua,
        c.numero AS cliente_numero,
        c.bairro AS cliente_bairro,
        c.cidade AS cliente_cidade,
        c.uf AS cliente_uf,
        c.cep AS cliente_cep,
        c.inscricao_estadual AS cliente_inscricao_estadual
      FROM vendas v
      LEFT JOIN clientes c ON c.id = v.cliente_id
      WHERE v.id = ?
    `, [vendaId], (err, venda) => {
      if (err) return reject(err);
      if (!venda) return reject(new Error('Venda não encontrada.'));

      db.all(`
        SELECT
          vi.*,
          p.nome AS produto_nome,
          p.ncm AS produto_ncm,
          p.cfop,
          p.csosn,
          p.origem,
          p.codigo AS produto_codigo,
          p.unidade
        FROM vendas_itens vi
        INNER JOIN produtos p ON p.id = vi.produto_id
        WHERE vi.venda_id = ?
        ORDER BY vi.id
      `, [vendaId], (itErr, itens) => {
        if (itErr) return reject(itErr);

        db.all(`
          SELECT forma_pagamento, valor, tipo_recebimento
          FROM venda_recebimentos
          WHERE venda_id = ? AND status = 'aprovado'
          ORDER BY id
        `, [vendaId], (recErr, recebimentos) => {
          if (recErr) return reject(recErr);
          if (recebimentos && recebimentos.length) {
            venda.pagamentos = recebimentos;
            return resolve({ venda, itens: itens || [] });
          }
          db.all(
            'SELECT forma_pagamento, valor FROM venda_pagamentos WHERE venda_id = ?',
            [vendaId],
            (pgErr, pags) => {
              if (pgErr) return reject(pgErr);
              venda.pagamentos = pags || [];
              resolve({ venda, itens: itens || [] });
            }
          );
        });
      });
    });
  });
}

/** Toda NF-e tem origem PEDIDO (com pedido_id) ou MANUAL (sem pedido_id). */
function validarOrigemNotaNfe(payload) {
  const p = payload || {};
  let mensagem = null;
  if (!ORIGENS_NFE.includes(p.origem)) mensagem = 'NF-e sem origem definida (PEDIDO ou MANUAL).';
  else if (p.origem === 'PEDIDO' && !p.pedido_id) mensagem = 'NF-e de origem PEDIDO sem pedido_id.';
  else if (p.origem === 'MANUAL' && p.pedido_id) mensagem = 'NF-e de origem MANUAL não pode ter pedido_id.';
  if (!mensagem) return null;
  const err = new Error(mensagem);
  err.code = 'NFE_ORIGEM_INDEFINIDA';
  return err;
}

function salvarNotaNfe(payload) {
  return new Promise((resolve, reject) => {
    const erroOrigem = validarOrigemNotaNfe(payload);
    if (erroOrigem) return reject(erroOrigem);
    db.get(
      `SELECT id FROM nfe_notas WHERE venda_id = ? ORDER BY id DESC LIMIT 1`,
      [payload.venda_id],
      (selErr, row) => {
        if (selErr) return reject(selErr);
        if (row) {
          db.run(`
            UPDATE nfe_notas SET
              numero = ?, serie = ?, chave_acesso = ?, ambiente = ?, status = ?,
              xml_enviado = ?, xml_retorno = ?, protocolo = ?, recibo = ?, danfe_html = ?,
              natureza_operacao = ?, cfop = ?, origem = ?, pedido_id = ?,
              updated_at = datetime('now','localtime')
            WHERE id = ?
          `, [
            payload.numero, payload.serie, payload.chave_acesso || '', payload.ambiente,
            payload.status, payload.xml_enviado || '', payload.xml_retorno || '',
            payload.protocolo || '', payload.recibo || '', payload.danfe_html || '',
            payload.natureza_operacao || null, payload.cfop || null,
            payload.origem, payload.pedido_id || null, row.id
          ], (uErr) => (uErr ? reject(uErr) : resolve(row.id)));
          return;
        }
        db.run(`
          INSERT INTO nfe_notas (
            venda_id, pedido_id, origem, numero, serie, chave_acesso, ambiente, status,
            xml_enviado, xml_retorno, protocolo, recibo, danfe_html,
            natureza_operacao, cfop
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          payload.venda_id, payload.pedido_id || null, payload.origem, payload.numero, payload.serie,
          payload.chave_acesso || '', payload.ambiente, payload.status,
          payload.xml_enviado || '', payload.xml_retorno || '',
          payload.protocolo || '', payload.recibo || '', payload.danfe_html || '',
          payload.natureza_operacao || null, payload.cfop || null
        ], function onIns(iErr) {
          if (iErr) return reject(iErr);
          resolve(this.lastID);
        });
      }
    );
  });
}

/**
 * Transmissão anterior sem retorno conclusivo (queda durante o envio, timeout):
 * consulta a chave na SEFAZ e registra o resultado. Nunca gera outra NF-e nesta chamada.
 */
async function recuperarEmissaoIncerta({ nota, venda, itensFiscais, config, deps = {}, opcoes = {} }) {
  const { consultarSituacaoNfe } = require('./nfeCentralService');
  const base = {
    notaId: nota.id,
    numero: nota.numero,
    serie: nota.serie,
    chaveAcesso: nota.chave_acesso,
    recuperacao: true
  };
  traceNfe('recuperarEmissaoIncerta', { vendaId: venda.id, notaId: nota.id, statusAnterior: nota.status });

  let situacao;
  try {
    situacao = await (deps.consultarSituacao || consultarSituacaoNfe)(nota.id, {
      config,
      consultarProtocolo: deps.consultarProtocolo,
      usuarioId: opcoes.usuarioId,
      usuarioNome: opcoes.usuarioNome
    });
  } catch (err) {
    return {
      ...base,
      success: false,
      status: 'consulta_previa_falhou',
      codigo: 'CONSULTA_PREVIA_FALHOU',
      message: `Não foi possível confirmar na SEFAZ a NF-e transmitida anteriormente (${err.message}). Nenhuma nova NF-e foi gerada.`
    };
  }

  const status = String(situacao?.status || '').toLowerCase();
  const resumo = { cStat: situacao?.cStat || null, xMotivo: situacao?.xMotivo || null, protocolo: situacao?.protocolo || null };

  if (status === 'autorizada') {
    let danfeHtml = nota.danfe_html || '';
    if (!danfeHtml) {
      try {
        danfeHtml = await gerarDanfeNfeHtml({
          venda,
          itens: itensFiscais,
          empresa: { nome: config.nomeEmpresa, cnpj: config.cnpj, ie: config.ie, endereco: config.logradouro || config.endereco },
          chave: nota.chave_acesso,
          numero: nota.numero,
          serie: nota.serie,
          protocolo: resumo.protocolo,
          status,
          natureza: nota.natureza_operacao,
          dadosNfe: {}
        });
        await new Promise((resolve, reject) => {
          db.run(
            `UPDATE nfe_notas SET danfe_html = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
            [danfeHtml, nota.id],
            (err) => (err ? reject(err) : resolve())
          );
        });
      } catch (danfeErr) {
        console.warn('[NFe] DANFE (recuperação):', danfeErr.message);
      }
    }
    return {
      ...base,
      ...resumo,
      success: true,
      status: 'autorizada',
      danfeHtml,
      message: 'NF-e já autorizada pela SEFAZ na transmissão anterior. Autorização registrada; nenhuma nova NF-e foi gerada.'
    };
  }

  if (status === 'aguardando_retorno') {
    return {
      ...base,
      ...resumo,
      success: false,
      status: 'emissao_em_andamento',
      codigo: 'LOTE_PROCESSAMENTO',
      message: 'Lote ainda em processamento na SEFAZ. Nenhuma nova NF-e foi gerada.'
    };
  }

  if (status === 'nao_localizada_sefaz') {
    return {
      ...base,
      ...resumo,
      success: false,
      status: 'nao_localizada_sefaz',
      codigo: 'NFE_NAO_LOCALIZADA_SEFAZ',
      podeNovaTentativa: true,
      message: 'A SEFAZ não localizou a NF-e transmitida anteriormente. Nova tentativa liberada.'
    };
  }

  return {
    ...base,
    ...resumo,
    success: false,
    status: status || 'rejeitada',
    message: resumo.xMotivo
      ? `Transmissão anterior registrada pela SEFAZ como ${status}: ${resumo.xMotivo}`
      : `Transmissão anterior registrada pela SEFAZ como ${status}.`
  };
}

/**
 * Emite NF-e 55 para uma venda já criada pelo Núcleo.
 * @param {number} vendaId
 * @param {object} [opcoes]
 * @param {object} [opcoes.dadosNfe]
 * @param {number} [opcoes.pedidoId]
 */
async function emitirNfePorVendaId(vendaId, opcoes = {}) {
  try {
    return await withLock(`nfe-venda-${Number(vendaId)}`, () => emitirNfePorVendaIdSemLock(vendaId, opcoes));
  } catch (err) {
    if (err && err.code === 'EMISSAO_EM_ANDAMENTO') {
      return {
        success: false,
        status: 'emissao_em_andamento',
        message: 'A NF-e desta venda já está sendo processada. Aguarde a conclusão.',
        codigo: 'EMISSAO_EM_ANDAMENTO'
      };
    }
    throw err;
  }
}

async function emitirNfePorVendaIdSemLock(vendaId, opcoes = {}) {
  const deps = opcoes.deps || {};
  // RC3.16.13 — confirma qual backend o Electron está executando (somente diagnóstico)
  console.log('[RC3.16.12] Backend NF-e carregado');
  console.log('[RC3.16.12] Arquivo:', __filename);
  console.log('[RC3.16.12] app.asar:', String(__filename).includes('app.asar') ? 'SIM' : 'NÃO');

  // RC3.16.11 — TRACE (não altera emissão)
  traceNfe('emitirNfePorVendaId', {
    vendaId,
    pedidoId: opcoes.pedidoId || null,
    forcarReemissao: Boolean(opcoes.forcarReemissao),
    arquivo: __filename
  });

  if (!configService.recursoHabilitado('nfe')) {
    return {
      success: false,
      status: 'modulo_desabilitado',
      message: 'Módulo NF-e desabilitado na implantação.'
    };
  }

  await garantirTabelaNfeNotas();

  const id = Number(vendaId);
  const { venda, itens } = await carregarVendaParaNfe(id);
  const origemNfe = await resolverOrigemNfeVenda(id);
  venda.pedido_id = origemNfe.pedidoId;
  venda.nfe_origem = origemNfe.origem;

  if (String(venda.status_pagamento || '') !== 'quitada' && Number(venda.valor_nao_fiscal || 0) > 0) {
    // espelha gate do núcleo: preferir quitada; se só NF, status pode ser quitada forçado
  }

  const existente = await new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM nfe_notas WHERE venda_id = ? AND LOWER(COALESCE(status, '')) IN (${STATUS_AUTORIZADA.map(() => '?').join(',')})
       ORDER BY id DESC LIMIT 1`,
      [id, ...STATUS_AUTORIZADA],
      (err, row) => (err ? reject(err) : resolve(row || null))
    );
  });
  if (existente) {
    return {
      success: true,
      reused: true,
      status: 'autorizada',
      notaId: existente.id,
      numero: existente.numero,
      serie: existente.serie,
      chaveAcesso: existente.chave_acesso,
      protocolo: existente.protocolo,
      danfeHtml: existente.danfe_html
    };
  }

  const ultimaNota = await new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM nfe_notas WHERE venda_id = ? ORDER BY id DESC LIMIT 1`,
      [id],
      (err, row) => (err ? reject(err) : resolve(row || null))
    );
  });
  const statusUltima = String(ultimaNota?.status || '').toLowerCase();
  const bloqueio = BLOQUEIO_NOVA_EMISSAO[statusUltima];
  if (bloqueio) {
    return {
      success: false,
      status: statusUltima,
      notaId: ultimaNota.id,
      numero: ultimaNota.numero,
      serie: ultimaNota.serie,
      chaveAcesso: ultimaNota.chave_acesso,
      message: bloqueio.message,
      codigo: bloqueio.codigo
    };
  }

  if (vendaEstaCancelada(venda)) {
    return {
      success: false,
      status: 'venda_cancelada',
      message: 'Venda cancelada não pode emitir NF-e.',
      codigo: 'VENDA_CANCELADA'
    };
  }

  const config = deps.config || await getFiscalConfigNfe();
  config.serieNfe = Number(await getConfiguracao('fiscal_serie_nfe', String(config.serie || 1))) || 1;

  if (!ambienteNfePermitido(config.ambiente)) {
    const err = erroAmbienteNfe(config.ambiente, 'autorizacao');
    return { success: false, status: 'ambiente_bloqueado', message: err.message, codigo: err.code, code: err.code };
  }

  if (!config.nomeEmpresa || !config.cnpj || !config.ie) {
    return {
      success: false,
      status: 'configuracao_pendente',
      message: 'Configuração fiscal incompleta.',
      codigo: 'CONFIGURACAO_FISCAL_INCOMPLETA'
    };
  }
  if (!deps.carregarCertificado && (!config.certificadoPath || !fs.existsSync(config.certificadoPath))) {
    return {
      success: false,
      status: 'configuracao_pendente',
      message: 'Certificado A1/PFX não encontrado.',
      codigo: 'CERTIFICATE_NOT_FOUND'
    };
  }
  try {
    const cnpjEmpresaAtiva = deps.cnpjEmpresaAtiva !== undefined
      ? deps.cnpjEmpresaAtiva
      : await getConfiguracao('cnpj', '');
    validarCertificadoEmitenteNfe(config, { ...deps, cnpjEmpresaAtiva });
  } catch (certErr) {
    return {
      success: false,
      status: 'configuracao_pendente',
      message: certErr.message,
      code: certErr.code || certErr.codigo || 'CERTIFICATE_INVALID',
      codigo: certErr.code || certErr.codigo || 'CERTIFICATE_INVALID'
    };
  }
  if (config.certificadoSenha != null && typeof config.certificadoSenha !== 'string') {
    return {
      success: false,
      status: 'configuracao_pendente',
      message: 'Senha do certificado digital inválida.',
      codigo: 'CERT_SENHA_INVALIDA'
    };
  }
  const itensFiscais = itens.filter(itemEntraNaNfe);

  if (!opcoes.forcarReemissao && STATUS_EM_TRANSITO.concat(STATUS_RESULTADO_INCERTO).includes(statusUltima)) {
    const chaveAnterior = onlyDigits(ultimaNota.chave_acesso || '');
    if (chaveAnterior.length === 44 && STATUS_RESULTADO_INCERTO.includes(statusUltima)) {
      return recuperarEmissaoIncerta({ nota: ultimaNota, venda, itensFiscais, config, deps, opcoes });
    }
    if (STATUS_EM_TRANSITO.includes(statusUltima)) {
      return {
        success: false,
        status: 'emissao_em_andamento',
        notaId: ultimaNota.id,
        numero: ultimaNota.numero,
        serie: ultimaNota.serie,
        message: 'Já existe NF-e desta venda em processamento. Aguarde a conclusão.',
        codigo: 'EMISSAO_EM_ANDAMENTO'
      };
    }
  }

  if (!itens.length) {
    return { success: false, status: 'sem_itens', message: 'Venda sem itens para NF-e.' };
  }

  // Hotfix: SEFAZ recebe exclusivamente itens/qtds/valores fiscais do Motor.
  if (!itensFiscais.length) {
    return {
      success: false,
      status: 'sem_itens_fiscais',
      message: 'Venda sem parcela fiscal do Motor para emissão de NF-e.'
    };
  }

  try {
    validarParametrosIdentidadeNfe(await contextoNumeracaoNfe(config));
  } catch (idErr) {
    return {
      success: false,
      status: 'configuracao_pendente',
      message: idErr.message,
      code: idErr.code,
      codigo: idErr.code
    };
  }
  const wsAutorizacao = resolverWebserviceNfe('autorizacao', config.ambiente, config);
  if (!deps.enviarLote && !wsAutorizacao.ok) {
    return {
      success: false,
      status: 'configuracao_pendente',
      message: wsAutorizacao.mensagem,
      code: wsAutorizacao.codigo,
      codigo: wsAutorizacao.codigo
    };
  }

  const dadosNfe = opcoes.dadosNfe || {};

  // RC3.16.12 — valida identificador do dest ANTES de consumir número / montar XML
  try {
    const {
      montarDocumentoDestinatarioNfe,
      assertDestinatarioIdentificadoNfe
    } = require('./xmlBuilderNfeVenda');
    console.log('[RC3.16.12] Validando destinatário...');
    assertDestinatarioIdentificadoNfe(montarDocumentoDestinatarioNfe(venda, dadosNfe));
    console.log('[RC3.16.12] Destinatário validado.');
  } catch (destErr) {
    if (destErr && destErr.code === 'DEST_SEM_DOCUMENTO') {
      console.log('[RC3.16.12] BLOQUEADO: destinatário sem documento.');
      return {
        success: false,
        status: 'erro_validacao',
        message: destErr.message,
        code: 'DEST_SEM_DOCUMENTO',
        codigo: 'DEST_SEM_DOCUMENTO'
      };
    }
    throw destErr;
  }

  const erroMunicipio = validarMunicipioInformadoNfe(venda, dadosNfe);
  if (erroMunicipio) return erroMunicipio;

  const erroIe = validarInscricaoEstadualInformadaNfe(venda, dadosNfe);
  if (erroIe) return erroIe;

  const identidade = await reservarIdentidadeNfeVenda(config);
  const numero = identidade.numero;
  traceNfe('identidadeNfe', {
    vendaId: id,
    numero,
    serie: identidade.serie,
    ambiente: identidade.ambiente,
    chave: identidade.chave
  });

  // RC3.16.10 — auditoria exclusiva (não altera regras / builder / assinatura / SOAP)
  traceNfe('iniciarAuditoriaXmlNfe', { vendaId: id, numero, serie: identidade.serie });
  const auditoriaXml = iniciarAuditoriaXmlNfe({ config, venda, dadosNfe, vendaId: id });

  let built;
  try {
    traceNfe('buildNfeXml', { vendaId: id, numero, serie: identidade.serie });
    built = buildNfeXml({ config, venda, itens: itensFiscais, numero, dadosNfe, identidade });
    conferirIdentidadeXmlNfe(built.xmlSemAssinatura, identidade);
  } catch (buildErr) {
    if (buildErr && buildErr.code === 'IDENTIDADE_XML_DIVERGENTE') {
      return {
        success: false,
        status: 'erro_validacao',
        numero,
        serie: identidade.serie,
        message: buildErr.message,
        code: buildErr.code,
        codigo: buildErr.code
      };
    }
    // RC3.16.12 — bloqueio local (sem envio SEFAZ)
    if (buildErr && (buildErr.code === 'DEST_SEM_DOCUMENTO'
      || String(buildErr.message || '').includes('SEM CPF, CNPJ OU ID ESTRANGEIRO'))) {
      console.log('[RC3.16.12] BLOQUEADO: destinatário sem documento.');
      return {
        success: false,
        status: 'erro_validacao',
        message: buildErr.message,
        code: 'DEST_SEM_DOCUMENTO',
        codigo: 'DEST_SEM_DOCUMENTO'
      };
    }
    throw buildErr;
  }

  try {
    validarXmlFiscal({
      xml: built.xmlSemAssinatura,
      fase: 'pre_assinatura',
      modeloDoc: '55',
      validarXsd: false
    });
  } catch (validErr) {
    return {
      success: false,
      status: 'erro_validacao',
      message: validErr.message || 'XML NF-e inconsistente.',
      code: validErr.code || 'XML_INVALIDO',
      detalhes: validErr.detalhes || null
    };
  }

  let xmlAssinado;
  try {
    salvarDebug(`venda-${id}-01-original.xml`, built.xmlSemAssinatura);
    if (!built.xmlSemAssinatura || !String(built.xmlSemAssinatura).trim()) {
      throw new Error('XML NF-e não foi gerado.');
    }
    logNfe('XML criado');
    logNfe('XML OK');

    // RC3.16.10 — XML original (pré-assinatura) + DEST / xNome / schema
    try { auditoriaXml.aposGerarXml(built.xmlSemAssinatura); } catch (_) { /* diagnóstico não bloqueia */ }

    const { privateKeyPem, certPem } = carregarEValidarCertificadoNfe(config, deps);

    logNfe('Assinando...');
    traceNfe('assinarNFe', { vendaId: id, numero, chave: built.chave });
    // Contrato oficial (igual NFC-e): apenas strings PEM — nunca o objeto cert.
    const assinatura = assinarNFe(built.xmlSemAssinatura, privateKeyPem, certPem);
    xmlAssinado = assinatura?.xmlAssinado;
    if (!xmlAssinado) {
      throw new Error('Assinatura da NF-e não gerou XML.');
    }
    logNfe('Assinatura concluída');
    salvarDebug(`venda-${id}-02-assinado.xml`, xmlAssinado);

    // RC3.16.10 — XML assinado exatamente como será transmitido
    try { auditoriaXml.aposAssinar(xmlAssinado); } catch (_) { /* diagnóstico não bloqueia */ }
  } catch (signErr) {
    const { classificarErro } = require('./nfeErros');
    const rawMsg = String(signErr.message || signErr);
    const amigavel = classificarErro({ erro: rawMsg });
    const mensagemClara = signErr && typeof signErr.code === 'string' && signErr.code.startsWith('CERT_')
      ? rawMsg
      : (amigavel.mensagem || rawMsg);
    const notaId = await salvarNotaNfe({
      venda_id: id,
      pedido_id: venda.pedido_id,
      origem: venda.nfe_origem,
      numero,
      serie: built.serie,
      chave_acesso: built.chave,
      ambiente: config.ambiente,
      status: 'erro_assinatura',
      xml_enviado: built.xmlSemAssinatura,
      xml_retorno: rawMsg,
      natureza_operacao: dadosNfe.natureza_operacao,
      cfop: dadosNfe.cfop
    });
    return {
      success: false,
      notaId,
      status: 'erro_assinatura',
      message: mensagemClara,
      sugestao: amigavel.sugestao || null,
      codigo: signErr.code || amigavel.codigo || 'ERRO_ASSINATURA'
    };
  }

  // Registro durável antes do envio: se o processo cair sem resposta, a próxima
  // tentativa encontra a chave e consulta a SEFAZ antes de gerar outra NF-e.
  await salvarNotaNfe({
    venda_id: id,
    pedido_id: venda.pedido_id,
    origem: venda.nfe_origem,
    numero,
    serie: built.serie,
    chave_acesso: built.chave,
    ambiente: config.ambiente,
    status: 'transmitindo',
    xml_enviado: xmlAssinado,
    xml_retorno: '',
    natureza_operacao: dadosNfe.natureza_operacao,
    cfop: dadosNfe.cfop
  });

  const lote = montarLote(xmlAssinado, 1);
  let soapResponse;
  try {
    // RC3.16.10 — evidência imediatamente anterior ao envio SOAP
    try { auditoriaXml.antesEnvioSefaz(); } catch (_) { /* diagnóstico não bloqueia */ }
    logNfe('Enviando lote');
    traceNfe('enviarLote', {
      vendaId: id,
      numero,
      url: getUrlNFe55(config),
      tamanhoLote: Buffer.byteLength(String(lote || ''), 'utf8')
    });
    soapResponse = await (deps.enviarLote || enviarLote)({
      url: getUrlNFe55(config),
      loteXml: lote,
      certificadoPath: config.certificadoPath,
      certificadoSenha: config.certificadoSenha,
      cUF: String(config.codigoUf || '23')
    });
    if (soapResponse && typeof soapResponse === 'object' && soapResponse.success === false) {
      throw Object.assign(new Error(soapResponse.message || 'Falha na transmissão do lote NF-e.'), {
        code: soapResponse.code || soapResponse.status || 'erro_transmissao'
      });
    }
  } catch (txErr) {
    const notaId = await salvarNotaNfe({
      venda_id: id,
      pedido_id: venda.pedido_id,
      origem: venda.nfe_origem,
      numero,
      serie: built.serie,
      chave_acesso: built.chave,
      ambiente: config.ambiente,
      status: 'erro_transmissao',
      xml_enviado: xmlAssinado,
      xml_retorno: String(txErr.message || txErr),
      natureza_operacao: dadosNfe.natureza_operacao,
      cfop: dadosNfe.cfop
    });
    try {
      const { aplicarResultadoEmissao } = require('./nfeOperacionalService');
      await aplicarResultadoEmissao(notaId, {
        status: 'erro_transmissao',
        message: String(txErr.message || txErr)
      }, {
        vendaId: id,
        usuarioId: opcoes.usuarioId,
        usuarioNome: opcoes.usuarioNome,
        chave: built.chave,
        numero,
        acao: opcoes.forcarReemissao ? 'reenvio' : 'emissao',
        empresa: config.nomeEmpresa
      });
    } catch (_) { /* ignore */ }
    return {
      success: false,
      notaId,
      status: 'erro_transmissao',
      chaveAcesso: built.chave,
      message: `${txErr.message} Resultado na SEFAZ incerto: a próxima tentativa consulta a chave antes de gerar nova NF-e.`
    };
  }

  const raw = String(soapResponse?.raw || soapResponse?.body || soapResponse || '');
  salvarDebug(`venda-${id}-03-retorno.xml`, raw);

  // RC3.16.3 — status oficial via protNFe/infProt (não o cStat do lote)
  traceNfe('parseRetornoAutorizacaoNfe', { vendaId: id, numero, bytesRetorno: Buffer.byteLength(raw, 'utf8') });
  const parsed = parseRetornoAutorizacaoNfe(raw);
  traceNfe('parserRetorno_resultado', {
    vendaId: id,
    status: parsed.status,
    cStat: parsed.cStat,
    xMotivo: parsed.xMotivo
  });
  let status = parsed.status;
  let protocolo = parsed.nProt || '';
  let chaveRetorno = onlyDigits(parsed.chNFe || '');
  if (status === 'autorizada' && !protocolo) {
    const extraido = extrairChaveEProtocoloAutorizados(raw);
    if (extraido?.chave) chaveRetorno = onlyDigits(extraido.chave);
    if (extraido?.protocolo) protocolo = extraido.protocolo;
  }
  // A chave registrada é sempre a identidade oficial que foi assinada e transmitida.
  const chaveFinal = identidade.chave;
  const chaveRetornoDivergente = chaveRetorno.length === 44 && chaveRetorno !== chaveFinal ? chaveRetorno : null;
  if (chaveRetornoDivergente) {
    console.warn(`[NFE] Retorno SEFAZ com chNFe ${chaveRetornoDivergente} diferente da chave transmitida ${chaveFinal}.`);
    traceNfe('chaveRetornoDivergente', { vendaId: id, numero, chave: chaveFinal, chaveRetorno: chaveRetornoDivergente });
  }

  const empresa = {
    nome: config.nomeEmpresa,
    cnpj: config.cnpj,
    ie: config.ie,
    endereco: config.logradouro || config.endereco
  };

  let danfeHtml = '';
  try {
    danfeHtml = await gerarDanfeNfeHtml({
      venda,
      itens: itensFiscais,
      empresa,
      chave: chaveFinal,
      numero,
      serie: built.serie,
      protocolo,
      status,
      natureza: dadosNfe.natureza_operacao,
      dadosNfe
    });
  } catch (danfeErr) {
    console.warn('[NFe] DANFE:', danfeErr.message);
  }

  const notaId = await salvarNotaNfe({
    venda_id: id,
    pedido_id: venda.pedido_id,
    origem: venda.nfe_origem,
    numero,
    serie: built.serie,
    chave_acesso: chaveFinal,
    ambiente: config.ambiente,
    status,
    xml_enviado: xmlAssinado,
    xml_retorno: raw,
    protocolo,
    danfe_html: danfeHtml,
    natureza_operacao: dadosNfe.natureza_operacao,
    cfop: dadosNfe.cfop
  });

  try {
    const { registrarHistoricoNfe } = require('./nfeCentralService');
    await registrarHistoricoNfe({
      notaId,
      evento: status === 'autorizada' ? 'autorizacao' : (status.startsWith('erro') ? 'erro' : 'emissao'),
      usuarioId: opcoes.usuarioId || null,
      usuarioNome: opcoes.usuarioNome || null,
      detalhes: { vendaId: id, numero, serie: built.serie, chave: chaveFinal, status, protocolo }
    });
  } catch (_) { /* histórico não bloqueia emissão */ }

  try {
    const { aplicarResultadoEmissao } = require('./nfeOperacionalService');
    const op = await aplicarResultadoEmissao(notaId, {
      status,
      message: status === 'autorizada'
        ? 'NF-e autorizada.'
        : (parsed.xMotivo || raw),
      xml_retorno: raw
    }, {
      vendaId: id,
      usuarioId: opcoes.usuarioId || null,
      usuarioNome: opcoes.usuarioNome || null,
      chave: chaveFinal,
      numero,
      protocolo,
      tempoRespostaMs: null,
      tentativas: opcoes.forcarReemissao ? undefined : 1,
      acao: opcoes.forcarReemissao ? 'reenvio' : 'emissao',
      empresa: config.nomeEmpresa,
      xmlEnviado: xmlAssinado
    });
    if (op?.status) status = op.status;
    if (op?.nProt) protocolo = op.nProt;
  } catch (_) { /* operacional não bloqueia */ }

  // A venda permanece no ciclo comercial (vendas.status inalterado); a situação
  // fiscal da NF-e vive somente em nfe_notas.status.
  return {
    success: status === 'autorizada',
    status,
    notaId,
    numero,
    serie: built.serie,
    chaveAcesso: chaveFinal,
    protocolo,
    cStat: parsed.cStat,
    xMotivo: parsed.xMotivo,
    cStatLote: parsed.cStatLote,
    dhRecbto: parsed.dhRecbto,
    ...(chaveRetornoDivergente ? { chaveRetornoDivergente } : {}),
    danfeHtml,
    message: status === 'autorizada'
      ? 'NF-e autorizada.'
      : (parsed.xMotivo || `NF-e não autorizada (status: ${status}).`)
  };
}

async function obterNotaNfePorVenda(vendaId) {
  await garantirTabelaNfeNotas();
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM nfe_notas WHERE venda_id = ? ORDER BY id DESC LIMIT 1`,
      [vendaId],
      (err, row) => (err ? reject(err) : resolve(row || null))
    );
  });
}

module.exports = {
  emitirNfePorVendaId,
  obterNotaNfePorVenda,
  resumoNfeDaVenda,
  garantirTabelaNfeNotas,
  proximoNumeroNFeVenda,
  reservarIdentidadeNfeVenda,
  getUrlNFe55,
  validarCertificadoEmitenteNfe,
  STATUS_RESULTADO_INCERTO,
  STATUS_AUTORIZADA,
  ORIGENS_NFE,
  resolverOrigemNfeVenda,
  validarOrigemNotaNfe,
  // RC3.15.5 — helpers de robustez (testes / auditoria); não usados pela NFC-e
  assertPrivateKeyPemNfe,
  assertCertPemNfe,
  carregarEValidarCertificadoNfe,
  MSG_CHAVE_PRIVADA,
  MSG_CERT_PEM
};
