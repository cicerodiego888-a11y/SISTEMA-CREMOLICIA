/**
 * NF-E-02 — Isolamento do ambiente + contrato da venda (antes da interface NF-e).
 *
 * Banco isolado em %TEMP%. SEFAZ simulada por injeção de dependência: nenhuma
 * transmissão, consulta ou evento real. Certificado autoassinado gerado em memória.
 */

'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');

const DIR = path.join(os.tmpdir(), 'cds-nfe-testes', 'isolamento-02');
fs.mkdirSync(path.join(DIR, 'fiscal'), { recursive: true });
fs.mkdirSync(path.join(DIR, 'config'), { recursive: true });
for (const f of ['mercadao.db', 'mercadao.db-wal', 'mercadao.db-shm', 'mercadao.db-journal']) {
  fs.rmSync(path.join(DIR, f), { force: true });
}
process.env.DB_DIR = DIR;
process.env.FISCAL_DIR = path.join(DIR, 'fiscal');
fs.writeFileSync(
  path.join(DIR, 'config', 'configuracoes.json'),
  JSON.stringify({ tipoImplantacao: 'ERP_FISCAL', modoOperacao: 'LOCAL', ipServidor: '', porta: 3002 }),
  'utf8'
);

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const forge = require('node-forge');
const express = require('express');
const jwt = require('jsonwebtoken');

const ROOT = path.resolve(__dirname, '../..');
const FISCAL = path.join(ROOT, 'backend/services/fiscal');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const dataDir = require('../../backend/config/dataDir');
const db = require('../../backend/database');
const auth = require('../../backend/middleware/auth');
const { getFiscalConfig, incrementaNumeroFiscal, prepararConfiguracaoNfe } = require(path.join(FISCAL, 'configService'));
const emissor = require(path.join(FISCAL, 'nfeEmissorVenda'));
const operacional = require(path.join(FISCAL, 'nfeOperacionalService'));
const numeracao = require(path.join(FISCAL, 'numeracaoFiscalService'));
const numeracaoNfe = require(path.join(FISCAL, 'nfeNumeracaoNfeService'));
const lock = require(path.join(FISCAL, 'nfeEmissionLockService'));
const guard = require(path.join(FISCAL, 'nfeAmbienteGuard'));
const nfeWs = require(path.join(FISCAL, 'nfeWebServices'));
const { cancelarNfe } = require(path.join(FISCAL, 'cancelarNfe'));

const CNPJ = '36811652000153';
const CNPJ_OUTRA_EMPRESA = '57824986000131';
const CHAVE_REGEX = /^\d{44}$/;
const ENV_WIN = { PROGRAMDATA: 'C:\\ProgramData' };

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ id: this.lastID, changes: this.changes });
    });
  });
}
function get(sql, params = []) {
  return new Promise((resolve, reject) => db.get(sql, params, (e, r) => (e ? reject(e) : resolve(r || null))));
}
function all(sql, params = []) {
  return new Promise((resolve, reject) => db.all(sql, params, (e, r) => (e ? reject(e) : resolve(r || []))));
}
async function setConfig(chave, valor) {
  await run(
    `INSERT INTO configuracoes (chave, valor, tipo, descricao, updated_at)
     VALUES (?, ?, 'string', '', CURRENT_TIMESTAMP)
     ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`,
    [chave, String(valor)]
  );
}
async function getConfig(chave) {
  const row = await get('SELECT valor FROM configuracoes WHERE chave = ?', [chave]);
  return row ? row.valor : null;
}

function gerarCertificadoTeste(cnpj = CNPJ) {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86400000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86400000);
  const attrs = [{ name: 'commonName', value: `CREMOLICIA TESTE:${cnpj}` }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return {
    privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
    certPem: forge.pki.certificateToPem(cert)
  };
}

function chaveDoLote(loteXml) {
  return (String(loteXml).match(/Id="NFe(\d{44})"/) || [])[1];
}

function retornoSefaz(loteXml, { cStat = '100', xMotivo = 'Autorizado o uso da NF-e', lote = '104', semInfProt = false } = {}) {
  const chave = chaveDoLote(loteXml);
  const prot = semInfProt ? '' :
    `<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><verAplic>SVRS</verAplic><chNFe>${chave}</chNFe>` +
    `<dhRecbto>2026-10-04T10:00:00-03:00</dhRecbto>${cStat === '100' ? '<nProt>223260000000001</nProt>' : ''}` +
    `<digVal>abc=</digVal><cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo></infProt></protNFe>`;
  return `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>` +
    `<nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4"><retEnviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">` +
    `<tpAmb>2</tpAmb><verAplic>SVRS</verAplic><cStat>${lote}</cStat><xMotivo>${lote === '104' ? 'Lote processado' : 'Lote em processamento'}</xMotivo>` +
    `<cUF>23</cUF><dhRecbto>2026-10-04T10:00:00-03:00</dhRecbto>${prot}</retEnviNFe></nfeResultMsg></soap:Body></soap:Envelope>`;
}

function retornoConsulta(chave, { cStat, xMotivo, nProt = null, comInfProt = true }) {
  const prot = comInfProt
    ? `<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><chNFe>${chave}</chNFe>${nProt ? `<nProt>${nProt}</nProt>` : ''}` +
      `<cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo></infProt></protNFe>`
    : '';
  return `<retConsSitNFe versao="4.00"><tpAmb>2</tpAmb><cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo>${prot}</retConsSitNFe>`;
}

let material;
let produtoId;
let clienteId;
let seqVenda = 0;

function deps(enviarLote, extra = {}) {
  return {
    carregarCertificado: () => material,
    inspecionarCertificado: () => ({ cnpj: CNPJ }),
    enviarLote,
    ...extra
  };
}

function loteSimulado(opcoes = {}) {
  const chamadas = [];
  const fn = async (args) => {
    chamadas.push(args);
    return { success: true, status: 'soap_enviado', raw: retornoSefaz(args.loteXml, opcoes) };
  };
  fn.chamadas = chamadas;
  return fn;
}

async function criarVenda(status = 'concluida') {
  seqVenda += 1;
  const venda = await run(
    `INSERT INTO vendas (codigo, data_venda, cliente_id, total, desconto, forma_pagamento, status, status_pagamento, valor_fiscal, valor_nao_fiscal)
     VALUES (?, datetime('now','localtime'), ?, 20, 0, 'dinheiro', ?, 'quitada', 20, 0)`,
    [`NFE02-${Date.now()}-${seqVenda}`, clienteId, status]
  );
  await run(
    `INSERT INTO vendas_itens (venda_id, produto_id, quantidade, preco_unitario, subtotal,
       quantidade_fiscal, quantidade_nao_fiscal, valor_fiscal, valor_nao_fiscal, item_fiscal)
     VALUES (?, ?, 2, 10, 20, 2, 0, 20, 0, 1)`,
    [venda.id, produtoId]
  );
  return venda.id;
}

const numeracao55 = async () => {
  await numeracao.garantirTabelaNumeracaoFiscal();
  return all(`SELECT empresa_cnpj, ambiente, modelo, serie, proximo_numero FROM fiscal_numeracao ORDER BY empresa_cnpj, ambiente, serie`);
};
const notasDaVenda = (vendaId) => all('SELECT id, status, chave_acesso, numero FROM nfe_notas WHERE venda_id = ? ORDER BY id', [vendaId]);

/** Simula queda do processo durante o envio: o registro durável fica em "transmitindo". */
async function emitirComQueda(vendaId) {
  let durante;
  const out = await emissor.emitirNfePorVendaId(vendaId, {
    deps: deps(async (args) => {
      durante = await get('SELECT id, status, chave_acesso, xml_enviado FROM nfe_notas WHERE venda_id = ? ORDER BY id DESC LIMIT 1', [vendaId]);
      durante.chaveLote = chaveDoLote(args.loteXml);
      throw new Error('processo encerrado durante a transmissão');
    })
  });
  await run(`UPDATE nfe_notas SET status = 'transmitindo' WHERE id = ?`, [durante.id]);
  return { out, durante };
}

before(async () => {
  assert.ok(path.resolve(process.env.DB_DIR).startsWith(path.resolve(os.tmpdir())), 'teste deve usar banco temporário');
  await new Promise((resolve, reject) => db.whenReady((err) => (err ? reject(err) : resolve())));
  material = gerarCertificadoTeste();

  const cfg = {
    nome_empresa: 'CREMOLICIA TESTE LTDA',
    cnpj: CNPJ,
    fiscal_ie: '061234567',
    fiscal_ambiente: '2',
    fiscal_codigo_uf: '23',
    fiscal_uf: 'CE',
    fiscal_uf_sigla: 'CE',
    fiscal_serie: '1',
    fiscal_numero_atual: '77',
    fiscal_serie_nfe: '3',
    fiscal_regime_tributario: '1',
    fiscal_certificado_path: path.join(DIR, 'nao-existe.pfx'),
    fiscal_certificado_senha: '',
    fiscal_municipio_codigo: '2307304',
    fiscal_municipio_nome: 'JUAZEIRO DO NORTE',
    fiscal_emitente_cep: '63000000',
    fiscal_emitente_logradouro: 'RUA DOS TESTES',
    fiscal_emitente_numero: '100',
    fiscal_emitente_bairro: 'CENTRO'
  };
  for (const [k, v] of Object.entries(cfg)) await setConfig(k, v);

  const prod = await run(
    `INSERT INTO produtos (codigo, nome, unidade, preco_venda, ncm, cfop, csosn, origem, ativo)
     VALUES ('SORV-02', 'SORVETE TESTE 2L', 'UN', 10, '21050010', '5102', '102', '0', 1)`
  );
  produtoId = prod.id;
  const cli = await run(
    `INSERT INTO clientes (nome, cpf_cnpj, rua, numero, bairro, cidade, uf, cep)
     VALUES ('CLIENTE TESTE NFE02', '529.982.247-25', 'RUA CLIENTE', '10', 'BAIRRO', 'JUAZEIRO DO NORTE', 'CE', '63000-000')`
  );
  clienteId = cli.id;
});

after(async () => {
  lock.resetLocksForTests();
  await new Promise((resolve) => db.close(() => resolve()));
});

describe('NF-E-02 — banco isolado', () => {
  it('padrão da Cremolícia é C:\\ProgramData\\MercantilFiscal\\dados; DB_DIR substitui o padrão', () => {
    assert.equal(dataDir.resolverDbDir(ENV_WIN), 'C:\\ProgramData\\MercantilFiscal\\dados');
    assert.equal(dataDir.resolverDbDir({ ...ENV_WIN, DB_DIR: '  D:\\cremolicia\\dados ' }), 'D:\\cremolicia\\dados');
    assert.ok(dataDir.mesmoDiretorio('c:/programdata/mercantilfiscal/dados/', dataDir.dirPadraoCremolicia(ENV_WIN)));
  });

  it('backend, Electron, backup e reset de usuários resolvem o DB_DIR pelo mesmo módulo', () => {
    assert.match(read('backend/database.js'), /= resolverDbDir\(\)/);
    assert.match(read('backend/services/configuracaoService.js'), /return resolverDbDir\(\)/);
    assert.match(read('backend/backup.js'), /resolverDbDir\(\)/);
    assert.match(read('backend/reset-users.js'), /= resolverDbDir\(\)/);
    for (const rel of ['electron.js', 'electron-common.js']) {
      const src = read(rel);
      assert.match(src, /process\.env\.DB_DIR = require\('\.\/backend\/config\/dataDir'\)\.resolverDbDir\(\)/, rel);
      assert.doesNotMatch(src, /MercantilFiscal/, rel);
    }
    assert.doesNotMatch(read('backend/rotas/backup.js'), /MercantilFiscal/);
  });

  it('o banco aberto neste processo é o temporário do teste', () => {
    assert.equal(path.resolve(db.dbPath), path.resolve(DIR, 'mercadao.db'));
    assert.equal(dataDir.mesmoDiretorio(db.dbDir, dataDir.dirPadraoCremolicia()), false);
  });
});

describe('NF-E-02 — empresa e certificado', () => {
  it('CNPJ do certificado divergente bloqueia sem consumir número nem alterar o CNPJ', async () => {
    const v = await criarVenda();
    const enviar = loteSimulado();
    const antes = await numeracao55();
    const out = await emissor.emitirNfePorVendaId(v, {
      deps: deps(enviar, { inspecionarCertificado: () => ({ cnpj: CNPJ_OUTRA_EMPRESA }) })
    });
    assert.equal(out.success, false);
    assert.equal(out.codigo, 'CERTIFICATE_CONFIGURATION_ERROR');
    assert.equal(enviar.chamadas.length, 0);
    assert.deepEqual(await numeracao55(), antes, 'nenhum número consumido');
    assert.equal(await getConfig('cnpj'), CNPJ, 'CNPJ configurado nunca é trocado pelo do certificado');
    assert.deepEqual(await notasDaVenda(v), []);
  });

  it('empresa ativa diferente do CNPJ configurado bloqueia', async () => {
    const v = await criarVenda();
    const enviar = loteSimulado();
    const out = await emissor.emitirNfePorVendaId(v, { deps: deps(enviar, { cnpjEmpresaAtiva: CNPJ_OUTRA_EMPRESA }) });
    assert.equal(out.codigo, 'CERTIFICATE_CONFIGURATION_ERROR');
    assert.equal(enviar.chamadas.length, 0);
  });

  it('CNPJ incompleto, certificado sem CNPJ ou de filial são recusados', () => {
    const validar = (cfgCnpj, certCnpj, empresa) => () => emissor.validarCertificadoEmitenteNfe(
      { cnpj: cfgCnpj, certificadoPath: 'x' },
      { inspecionarCertificado: () => ({ cnpj: certCnpj }), cnpjEmpresaAtiva: empresa }
    );
    const ehErroCert = (e) => e.code === 'CERTIFICATE_CONFIGURATION_ERROR';
    assert.throws(validar('3681165200015', CNPJ), ehErroCert);
    assert.throws(validar(CNPJ, ''), ehErroCert);
    assert.throws(validar(CNPJ, '36811652000234'), ehErroCert);
    assert.doesNotThrow(validar('36.811.652/0001-53', CNPJ, CNPJ));
  });
});

describe('NF-E-02 — ambiente homologação (produção bloqueada)', () => {
  it('produção não é liberada por configuração', () => {
    assert.equal(guard.nfeProducaoLiberada(), false);
    assert.equal(guard.ambienteNfePermitido(2), true);
    assert.equal(guard.ambienteNfePermitido('2'), true);
    for (const amb of [1, '1', 0, null, undefined, 3]) assert.equal(guard.ambienteNfePermitido(amb), false, String(amb));
  });

  it('fiscal_ambiente_nfe=1 bloqueia a emissão antes de reservar número', async () => {
    const v = await criarVenda();
    const enviar = loteSimulado();
    const antes = await numeracao55();
    await setConfig('fiscal_ambiente_nfe', '1');
    try {
      const out = await emissor.emitirNfePorVendaId(v, { deps: deps(enviar) });
      assert.equal(out.success, false);
      assert.equal(out.status, 'ambiente_bloqueado');
      assert.equal(out.codigo, 'NFE_PRODUCAO_BLOQUEADA');
    } finally {
      await setConfig('fiscal_ambiente_nfe', '2');
    }
    assert.equal(enviar.chamadas.length, 0);
    assert.deepEqual(await numeracao55(), antes);
    assert.deepEqual(await notasDaVenda(v), []);
  });

  it('fiscal_ambiente (NFC-e) = 1 não altera o ambiente da NF-e', async () => {
    const { getFiscalConfigNfe } = require('../../backend/services/fiscal/configService');
    await setConfig('fiscal_ambiente', '1');
    try {
      const cfg = await getFiscalConfigNfe();
      assert.equal(cfg.ambiente, 2);
      assert.equal(cfg.ambienteNfce, 1);
    } finally {
      await setConfig('fiscal_ambiente', '2');
    }
  });

  it('consulta, status e evento em produção são recusados sem chamar o transporte', async () => {
    let chamadas = 0;
    const httpClient = async () => { chamadas += 1; return { status: 200, data: '' }; };
    const base = { ambiente: 1, cUF: '23', certificadoPath: 'x', certificadoSenha: '', httpClient, httpsAgent: {} };
    const outs = [
      await nfeWs.consultarProtocoloNfe({ ...base, chave: '2'.repeat(44) }),
      await nfeWs.consultarStatusServicoNfe(base),
      await nfeWs.enviarEventoNfe({ ...base, envelope: '<x/>' })
    ];
    for (const out of outs) {
      assert.equal(out.success, false);
      assert.equal(out.code, 'NFE_PRODUCAO_BLOQUEADA');
    }
    assert.equal(chamadas, 0);
  });

  it('cancelamento de NF-e de produção é recusado antes do evento', async () => {
    const v = await criarVenda();
    const nota = await run(
      `INSERT INTO nfe_notas (venda_id, numero, serie, chave_acesso, protocolo, status, ambiente)
       VALUES (?, 108, 1, ?, '123456789012345', 'autorizada', 1)`,
      [v, `232610${CNPJ_OUTRA_EMPRESA}55001000000108112345678` + '0']
    );
    let enviou = false;
    const config = await getFiscalConfig({ validarUrls: false });
    await assert.rejects(
      cancelarNfe(nota.id, 'Cancelamento solicitado pelo cliente por desistencia da compra', {
        deps: { config, carregarCertificado: () => material, enviarEvento: async () => { enviou = true; } }
      }),
      (e) => e.code === 'NFE_PRODUCAO_BLOQUEADA' && e.statusCode === 403
    );
    assert.equal(enviou, false);
  });

  it('devolução de compra aplica a mesma trava antes de reservar número', () => {
    const src = read('backend/services/fiscal/nfeDevolucaoCompra.js');
    const trava = src.indexOf("assertAmbienteNfePermitido(config.ambiente, 'devolucao_compra')");
    assert.ok(trava > 0);
    assert.ok(trava < src.indexOf('await proximoNumeroNFeDevolucao()'), 'trava antes da numeração');
  });

  it('prepararConfiguracaoNfe cria só as chaves ausentes e não troca o ambiente', async () => {
    await run(`DELETE FROM configuracoes WHERE chave LIKE 'fiscal_ws_nfe_%' OR chave = 'fiscal_numero_atual_nfe'`);
    await setConfig('fiscal_ambiente', '1');
    try {
      const criadas = await prepararConfiguracaoNfe();
      assert.ok(criadas.includes('fiscal_numero_atual_nfe'));
      assert.equal(criadas.filter((c) => c.startsWith('fiscal_ws_nfe_')).length, 8);
      assert.ok(!criadas.includes('fiscal_ambiente') && !criadas.includes('fiscal_serie_nfe'));
      assert.equal(await getConfig('fiscal_ambiente'), '1', 'nunca sobrescreve valor existente');
      assert.equal(await getConfig('fiscal_serie_nfe'), '3');
      assert.equal(await getConfig('fiscal_ws_nfe_autorizacao_homologacao'), '');
      assert.deepEqual(await prepararConfiguracaoNfe(), [], 'idempotente');
    } finally {
      await setConfig('fiscal_ambiente', '2');
    }
    await run(`DELETE FROM configuracoes WHERE chave = 'fiscal_ambiente'`);
    assert.deepEqual(await prepararConfiguracaoNfe(), ['fiscal_ambiente']);
    assert.equal(await getConfig('fiscal_ambiente'), '2', 'banco novo nasce em homologação');
  });

  it('URLs padrão do autorizador do Ceará (SVRS) por ambiente', () => {
    assert.equal(nfeWs.resolverUrlNfe('autorizacao', 2), 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx');
    assert.equal(nfeWs.resolverUrlNfe('autorizacao', 1), 'https://nfe.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx');
    assert.equal(nfeWs.resolverUrlNfe('consultaProtocolo', 2), 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeConsulta/NFeConsultaProtocolo4.asmx');
    assert.equal(nfeWs.resolverUrlNfe('evento', 2), 'https://nfe-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx');
  });
});

describe('NF-E-02 — contrato da venda e ciclo próprio da NF-e', () => {
  let vendaId;
  let autorizada;

  it('NF-e autorizada não marca a venda como EMITIDA; venda permanece CONCLUIDA', async () => {
    vendaId = await criarVenda('concluida');
    const enviar = loteSimulado();
    autorizada = await emissor.emitirNfePorVendaId(vendaId, { deps: deps(enviar) });
    assert.equal(autorizada.status, 'autorizada', autorizada.message);
    assert.equal(enviar.chamadas.length, 1);
    assert.equal(enviar.chamadas[0].url, nfeWs.resolverUrlNfe('autorizacao', 2));
    assert.match(enviar.chamadas[0].loteXml, /<tpAmb>2<\/tpAmb>/);
    const venda = await get('SELECT status FROM vendas WHERE id = ?', [vendaId]);
    assert.equal(venda.status, 'concluida');
    const nota = await get('SELECT status, ambiente, serie, chave_acesso FROM nfe_notas WHERE id = ?', [autorizada.notaId]);
    assert.equal(nota.status, 'autorizada');
    assert.equal(Number(nota.ambiente), 2);
    assert.equal(Number(nota.serie), 3);
    assert.equal(nota.chave_acesso.slice(6, 20), CNPJ, 'chave com o CNPJ da empresa ativa');
  });

  it('o emissor não contém UPDATE em vendas', () => {
    assert.doesNotMatch(read('backend/services/fiscal/nfeEmissorVenda.js'), /UPDATE\s+vendas/i);
  });

  it('NF-e autorizada não é emitida de novo (duplicidade bloqueada)', async () => {
    const enviar = loteSimulado();
    const out = await emissor.emitirNfePorVendaId(vendaId, { deps: deps(enviar) });
    assert.equal(out.reused, true);
    assert.equal(out.notaId, autorizada.notaId);
    assert.equal(enviar.chamadas.length, 0);
    assert.equal((await notasDaVenda(vendaId)).length, 1);
  });

  it('NF-e em processamento (lote 105) bloqueia segunda emissão', async () => {
    const v = await criarVenda();
    const primeira = await emissor.emitirNfePorVendaId(v, { deps: deps(loteSimulado({ lote: '105', semInfProt: true })) });
    operacional.cancelarTimerConsulta(primeira.notaId);
    assert.equal(primeira.status, 'aguardando_retorno');
    const enviar = loteSimulado();
    let consultou = false;
    const out = await emissor.emitirNfePorVendaId(v, {
      deps: deps(enviar, { consultarProtocolo: async () => { consultou = true; return { success: false }; } })
    });
    assert.equal(out.status, 'emissao_em_andamento');
    assert.equal(enviar.chamadas.length, 0);
    assert.equal(consultou, false, 'lote recebido pela SEFAZ: a consulta automática decide');
  });

  it('NF-e cancelada não é reaproveitada nem reemitida', async () => {
    const v = await criarVenda();
    const out1 = await emissor.emitirNfePorVendaId(v, { deps: deps(loteSimulado()) });
    await run(`UPDATE nfe_notas SET status = 'cancelada' WHERE id = ?`, [out1.notaId]);
    const enviar = loteSimulado();
    const out = await emissor.emitirNfePorVendaId(v, { deps: deps(enviar) });
    assert.equal(out.success, false);
    assert.equal(out.codigo, 'NFE_CANCELADA');
    assert.equal(enviar.chamadas.length, 0);
  });

  it('NF-e rejeitada pode ser reprocessada (regra existente)', async () => {
    const v = await criarVenda();
    const rej = await emissor.emitirNfePorVendaId(v, { deps: deps(loteSimulado({ cStat: '225', xMotivo: 'Rejeicao: Falha no Schema XML' })) });
    assert.equal(rej.status, 'rejeitada');
    const enviar = loteSimulado();
    const out = await emissor.emitirNfePorVendaId(v, { deps: deps(enviar) });
    assert.equal(out.status, 'autorizada', out.message);
    assert.equal(enviar.chamadas.length, 1);
  });
});

describe('NF-E-02 — queda durante a transmissão e recuperação pela chave', () => {
  it('a NF-e assinada é gravada como "transmitindo" com a chave antes do envio', async () => {
    const v = await criarVenda();
    const { out, durante } = await emitirComQueda(v);
    assert.equal(out.status, 'erro_transmissao');
    assert.equal(durante.status, 'transmitindo');
    assert.match(durante.chave_acesso, CHAVE_REGEX);
    assert.equal(durante.chave_acesso, durante.chaveLote, 'chave persistida = chave transmitida');
    assert.match(durante.xml_enviado, /<Signature/);
  });

  it('autorizada na SEFAZ: registra a autorização sem gerar outra NF-e nem consumir número', async () => {
    const v = await criarVenda();
    const { durante } = await emitirComQueda(v);
    const numeracaoAntes = await numeracao55();
    const enviar = loteSimulado();
    const consultas = [];
    const out = await emissor.emitirNfePorVendaId(v, {
      deps: deps(enviar, {
        consultarProtocolo: async (args) => {
          consultas.push(args);
          return { success: true, body: retornoConsulta(args.chave, { cStat: '100', xMotivo: 'Autorizado o uso da NF-e', nProt: '223260000000555' }) };
        }
      })
    });
    assert.equal(out.success, true, out.message);
    assert.equal(out.status, 'autorizada');
    assert.equal(out.recuperacao, true);
    assert.equal(out.notaId, durante.id);
    assert.equal(consultas.length, 1);
    assert.equal(consultas[0].chave, durante.chave_acesso);
    assert.equal(Number(consultas[0].ambiente), 2);
    assert.equal(enviar.chamadas.length, 0, 'nenhuma nova transmissão');
    assert.deepEqual(await numeracao55(), numeracaoAntes, 'nenhum número consumido');
    const notas = await notasDaVenda(v);
    assert.equal(notas.length, 1);
    const nota = await get('SELECT status, protocolo, xml_retorno, danfe_html FROM nfe_notas WHERE id = ?', [durante.id]);
    assert.equal(nota.status, 'autorizada');
    assert.equal(nota.protocolo, '223260000000555');
    assert.match(nota.xml_retorno, /<cStat>100<\/cStat>/);
    assert.ok(nota.danfe_html && nota.danfe_html.length > 100);
    const xmlAutorizado = await require(path.join(FISCAL, 'danfeService')).obterXmlAutorizado({ tipo: 'VENDA', id: durante.id });
    assert.match(xmlAutorizado.xml, /<nfeProc[\s\S]*<nProt>223260000000555<\/nProt>/);
    assert.equal((await get('SELECT status FROM vendas WHERE id = ?', [v])).status, 'concluida');
  });

  it('rejeitada na SEFAZ: registra a rejeição sem retransmitir', async () => {
    const v = await criarVenda();
    const { durante } = await emitirComQueda(v);
    const enviar = loteSimulado();
    const out = await emissor.emitirNfePorVendaId(v, {
      deps: deps(enviar, {
        consultarProtocolo: async (args) => ({
          success: true,
          body: retornoConsulta(args.chave, { cStat: '225', xMotivo: 'Rejeicao: Falha no Schema XML' })
        })
      })
    });
    assert.equal(out.success, false);
    assert.equal(out.status, 'rejeitada');
    assert.equal(enviar.chamadas.length, 0);
    assert.equal((await get('SELECT status FROM nfe_notas WHERE id = ?', [durante.id])).status, 'rejeitada');
  });

  it('não localizada (217): só então libera nova tentativa', async () => {
    const v = await criarVenda();
    const { durante } = await emitirComQueda(v);
    const enviar = loteSimulado();
    const consulta217 = async () => ({
      success: true,
      body: retornoConsulta('', { cStat: '217', xMotivo: 'Rejeicao: NF-e nao consta na base de dados da SEFAZ', comInfProt: false })
    });
    const out = await emissor.emitirNfePorVendaId(v, { deps: deps(enviar, { consultarProtocolo: consulta217 }) });
    assert.equal(out.success, false);
    assert.equal(out.codigo, 'NFE_NAO_LOCALIZADA_SEFAZ');
    assert.equal(out.podeNovaTentativa, true);
    assert.equal(enviar.chamadas.length, 0, 'a consulta não transmite');
    assert.equal((await get('SELECT status FROM nfe_notas WHERE id = ?', [durante.id])).status, 'nao_localizada_sefaz');

    const nova = await emissor.emitirNfePorVendaId(v, { deps: deps(enviar) });
    assert.equal(nova.status, 'autorizada', nova.message);
    assert.equal(enviar.chamadas.length, 1);
  });

  it('falha na consulta prévia não gera nova NF-e', async () => {
    const v = await criarVenda();
    await emitirComQueda(v);
    const enviar = loteSimulado();
    const out = await emissor.emitirNfePorVendaId(v, {
      deps: deps(enviar, { consultarProtocolo: async () => ({ success: false, error: 'timeout' }) })
    });
    assert.equal(out.success, false);
    assert.equal(out.codigo, 'CONSULTA_PREVIA_FALHOU');
    assert.equal(enviar.chamadas.length, 0);
    assert.equal((await notasDaVenda(v)).length, 1);
  });
});

describe('NF-E-02 — numeração 55 isolada (empresa, CNPJ, ambiente, modelo, série)', () => {
  const reservar = (cnpj, ambiente, serie) => numeracaoNfe.reservarProximoNumeroNfe({ cnpj, ambiente, serie }).then((r) => Number(r.numero ?? r));

  it('cada CNPJ e cada ambiente têm sequência própria', async () => {
    assert.equal(await reservar(CNPJ, 2, 31), 1);
    assert.equal(await reservar(CNPJ_OUTRA_EMPRESA, 2, 31), 1);
    assert.equal(await reservar(CNPJ, 2, 31), 2);
    assert.equal(await reservar(CNPJ, 1, 31), 1);
    const linhas = await all(`SELECT empresa_cnpj, ambiente, proximo_numero FROM fiscal_numeracao WHERE serie = 31 ORDER BY empresa_cnpj, ambiente`);
    assert.deepEqual(linhas.map((l) => [l.empresa_cnpj, Number(l.ambiente), Number(l.proximo_numero)]), [
      [CNPJ, 1, 2],
      [CNPJ, 2, 3],
      [CNPJ_OUTRA_EMPRESA, 2, 2]
    ]);
  });

  it('NF-e de outro CNPJ no banco não avança a numeração; sem chave conta (conservador)', async () => {
    const v = await criarVenda();
    await run(
      `INSERT INTO nfe_notas (venda_id, numero, serie, chave_acesso, status, ambiente) VALUES (?, 900, 32, ?, 'autorizada', 2)`,
      [v, `232610${CNPJ_OUTRA_EMPRESA}55032000000900112345678` + '0']
    );
    assert.equal(await reservar(CNPJ, 2, 32), 1);
    await run(`INSERT INTO nfe_notas (venda_id, numero, serie, chave_acesso, status, ambiente) VALUES (?, 40, 33, '', 'rejeitada', 2)`, [v]);
    assert.equal(await reservar(CNPJ, 2, 33), 41);
  });

  it('número ocupado na SEFAZ (539) de outro CNPJ não bloqueia esta empresa', async () => {
    for (const numero of [1, 2, 3]) {
      await numeracaoNfe.registrarNumeroOcupadoSefaz({ cnpj: CNPJ_OUTRA_EMPRESA, serie: 34, numero, ambiente: 2, origem: 'teste' });
    }
    assert.equal(numeracaoNfe.numeroOcupadoSefazEmMemoria({ cnpj: CNPJ, ambiente: 2, serie: 34, numero: 1 }), false);
    assert.equal(numeracaoNfe.numeroOcupadoSefazEmMemoria({ cnpj: CNPJ_OUTRA_EMPRESA, ambiente: 2, serie: 34, numero: 1 }), true);
    assert.equal(await reservar(CNPJ, 2, 34), 1);
    assert.equal(await reservar(CNPJ_OUTRA_EMPRESA, 2, 34), 4);
    numeracaoNfe.marcarOcupadoMemoria({ ambiente: 2, serie: 35, numero: 1 });
    assert.equal(await reservar(CNPJ, 2, 35), 2, 'ocupação sem CNPJ bloqueia qualquer emitente');
  });

  it('reservas fora da numeração ativa não alteram fiscal_serie_nfe / fiscal_numero_atual_nfe', async () => {
    await setConfig('fiscal_numero_atual_nfe', '7');
    await reservar(CNPJ_OUTRA_EMPRESA, 2, 3);
    await reservar(CNPJ, 1, 3);
    await reservar(CNPJ, 2, 36);
    assert.equal(await getConfig('fiscal_serie_nfe'), '3');
    assert.equal(await getConfig('fiscal_numero_atual_nfe'), '7');
    const n = await reservar(CNPJ, 2, 3);
    assert.equal(await getConfig('fiscal_numero_atual_nfe'), String(n + 1), 'numeração ativa mantém o espelho');
  });

  it('modelo 65 é recusado pela numeração NF-e', async () => {
    await assert.rejects(
      numeracao.reservarProximaNumeracaoFiscal({ cnpj: CNPJ, ambiente: 2, modelo: '65', serie: 1 }),
      (err) => err.code === 'MODELO_NAO_SUPORTADO'
    );
    const linha65 = await get(`SELECT COUNT(*) AS n FROM fiscal_numeracao WHERE modelo <> '55'`);
    assert.equal(linha65.n, 0);
  });
});

describe('NF-E-02 — permissões NF-E-EMITIR / NF-E-CANCELAR', () => {
  let server;
  let base;
  let tokenSemPermissao;
  let tokenEmitir;
  let tokenCancelar;

  before(async () => {
    const criarUsuario = async (username) => (await run(
      `INSERT INTO usuarios (username, password_hash, role) VALUES (?, 'x', 'operador')`, [username]
    )).id;
    const semPermissao = await criarUsuario('nfe02-sem');
    const emitir = await criarUsuario('nfe02-emitir');
    const cancelar = await criarUsuario('nfe02-cancelar');
    await run(`INSERT INTO usuario_permissoes (usuario_id, permissao, permitido) VALUES (?, 'NF-E-EMITIR', 1)`, [emitir]);
    await run(`INSERT INTO usuario_permissoes (usuario_id, permissao, permitido) VALUES (?, 'NF-E-CANCELAR', 1)`, [cancelar]);
    const token = (id, username) => jwt.sign({ id, username, role: 'operador', perfil: 'USUARIO' }, auth.JWT_SECRET);
    tokenSemPermissao = token(semPermissao, 'nfe02-sem');
    tokenEmitir = token(emitir, 'nfe02-emitir');
    tokenCancelar = token(cancelar, 'nfe02-cancelar');

    const app = express();
    app.use(express.json());
    app.use('/api/nfe', auth.verificarToken, require('../../backend/rotas/nfe'));
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${server.address().port}/api/nfe`;
  });

  after(() => new Promise((resolve) => server.close(resolve)));

  const post = (rota, token, body = {}) => fetch(`${base}${rota}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  });

  it('as permissões fazem parte da lista oficial', () => {
    assert.ok(auth.PERMISSOES_DISPONIVEIS.includes('NF-E-EMITIR'));
    assert.ok(auth.PERMISSOES_DISPONIVEIS.includes('NF-E-CANCELAR'));
  });

  it('sem NF-E-EMITIR: emitir, reenviar e consultar retornam 403', async () => {
    for (const rota of ['/vendas/999999/emitir', '/notas/999999/reenviar', '/notas/999999/consultar']) {
      const r = await post(rota, tokenSemPermissao);
      assert.equal(r.status, 403, rota);
      assert.match((await r.json()).error, /NF-E-EMITIR/);
    }
    const r = await post('/notas/999999/cancelar', tokenEmitir, { justificativa: 'x'.repeat(20) });
    assert.equal(r.status, 403, 'NF-E-EMITIR não autoriza cancelar');
  });

  it('com NF-E-EMITIR a rota chega ao serviço (venda/nota inexistente, sem SEFAZ)', async () => {
    const r = await post('/notas/999999/consultar', tokenEmitir);
    assert.equal(r.status, 404);
    const e = await post('/vendas/999999/emitir', tokenEmitir);
    assert.notEqual(e.status, 403);
  });

  it('sem NF-E-CANCELAR: cancelar retorna 403; com a permissão chega ao serviço', async () => {
    const negado = await post('/notas/999999/cancelar', tokenSemPermissao, { justificativa: 'x'.repeat(20) });
    assert.equal(negado.status, 403);
    assert.match((await negado.json()).error, /NF-E-CANCELAR/);
    const permitido = await post('/notas/999999/cancelar', tokenCancelar, {
      justificativa: 'Cancelamento solicitado pelo cliente por desistencia da compra'
    });
    assert.notEqual(permitido.status, 403);
    const emitir = await post('/vendas/999999/emitir', tokenCancelar);
    assert.equal(emitir.status, 403, 'NF-E-CANCELAR não autoriza emitir');
  });
});

describe('NF-E-02 — regressão NFC-e e Central', () => {
  it('NFC-e (65): contador e série intactos; fluxo próprio continua', async () => {
    assert.equal(await getConfig('fiscal_numero_atual'), '77');
    assert.equal(await getConfig('fiscal_serie'), '1');
    assert.equal((await get('SELECT COUNT(*) AS n FROM nfce_notas')).n, 0);
    assert.equal(await incrementaNumeroFiscal(), 77);
    assert.equal(await getConfig('fiscal_numero_atual'), '78');
  });

  it('NFC-e, TEF e PDV não dependem das travas NF-e', () => {
    for (const rel of ['backend/services/fiscal/emissor.js', 'backend/services/fiscal/xmlBuilder.js', 'backend/services/fiscal/cancelarNfce.js']) {
      assert.doesNotMatch(read(rel), /nfeAmbienteGuard|nfeEmissorVenda|numeracaoFiscalService|nfeNumeracaoNfeService/, rel);
    }
  });

  it('Central de Entradas não depende do núcleo NF-e 55', () => {
    const dir = path.join(ROOT, 'backend/motores/central-entradas');
    const arquivos = [];
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) arquivos.push(p);
    });
    walk(dir);
    for (const arq of arquivos) {
      assert.doesNotMatch(fs.readFileSync(arq, 'utf8'), /nfeAmbienteGuard|nfeEmissorVenda|cancelarNfe\b|nfeCentralService|nfeOperacionalService/, arq);
    }
  });
});
