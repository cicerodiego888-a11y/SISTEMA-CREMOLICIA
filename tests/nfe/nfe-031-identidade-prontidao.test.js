/**
 * NF-E-03.1 — Identidade NF-e no fluxo real + prontidão local para homologação.
 *
 * Banco isolado em %TEMP%, SEFAZ simulada por injeção de dependência e rede
 * bloqueada nos cenários de configuração/diagnóstico. Nenhum acesso ao banco ativo.
 */

'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const net = require('net');
const tls = require('tls');
const dns = require('dns');
const http = require('http');
const https = require('https');

const DIR = path.join(os.tmpdir(), 'cds-nfe-testes', 'identidade-031');
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
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '../..');
const FISCAL = path.join(ROOT, 'backend/services/fiscal');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const db = require('../../backend/database');

// Espião instalado antes de carregar builder/emissor: ambos capturam a função na carga.
const identidadeSvc = require(path.join(FISCAL, 'nfeIdentityService'));
const prepararOriginal = identidadeSvc.prepararIdentidadeEmissaoNfe;
const identidadesCriadas = [];
identidadeSvc.prepararIdentidadeEmissaoNfe = (args) => {
  const id = prepararOriginal(args);
  identidadesCriadas.push(id);
  return id;
};

const auth = require('../../backend/middleware/auth');
const emissor = require(path.join(FISCAL, 'nfeEmissorVenda'));
const lock = require(path.join(FISCAL, 'nfeEmissionLockService'));
const { buildNfeXml } = require(path.join(FISCAL, 'xmlBuilderNfeVenda'));
const { getFiscalConfig, getFiscalConfigNfe } = require(path.join(FISCAL, 'configService'));
const danfeService = require(path.join(FISCAL, 'danfeService'));
const prontidao = require(path.join(FISCAL, 'nfeProntidaoService'));
const guard = require(path.join(FISCAL, 'nfeAmbienteGuard'));
const dataDir = require('../../backend/config/dataDir');
const nfeUi = require('../../frontend/erp/js/nfe.js');

const CNPJ = '36811652000153';
const CNPJ_OUTRA_EMPRESA = '11222333000181';
const CNPJ_FILIAL = '36811652000234';
const SENHA_PFX = 'senha-teste-031';
const URL_HOMOLOGACAO = 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx';
const URL_PRODUCAO = 'https://nfe.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx';

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

let chaves;
function certificado(cnpj, { expirado = false } = {}) {
  const cert = forge.pki.createCertificate();
  cert.publicKey = chaves.publicKey;
  cert.serialNumber = '031';
  cert.validity.notBefore = new Date(Date.now() - (expirado ? 400 : 1) * 86400000);
  cert.validity.notAfter = new Date(Date.now() + (expirado ? -30 : 365) * 86400000);
  const attrs = [{ name: 'commonName', value: `CREMOLICIA TESTE:${cnpj}` }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(chaves.privateKey, forge.md.sha256.create());
  return cert;
}
function gravarPfx(nome, cnpj, opcoes) {
  const asn1 = forge.pkcs12.toPkcs12Asn1(chaves.privateKey, [certificado(cnpj, opcoes)], SENHA_PFX, { algorithm: '3des' });
  const arquivo = path.join(DIR, nome);
  fs.writeFileSync(arquivo, Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary'));
  return arquivo;
}

function retornoSefaz(loteXml, { cStat = '100', xMotivo = 'Autorizado o uso da NF-e' } = {}) {
  const chave = (String(loteXml).match(/Id="NFe(\d{44})"/) || [])[1];
  const prot = `<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><verAplic>SVRS</verAplic><chNFe>${chave}</chNFe>` +
    `<dhRecbto>2026-10-04T10:00:00-03:00</dhRecbto>${cStat === '100' ? '<nProt>223260000000031</nProt>' : ''}` +
    `<digVal>abc=</digVal><cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo></infProt></protNFe>`;
  return `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>` +
    `<nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4"><retEnviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">` +
    `<tpAmb>2</tpAmb><verAplic>SVRS</verAplic><cStat>104</cStat><xMotivo>Lote processado</xMotivo>` +
    `<cUF>23</cUF><dhRecbto>2026-10-04T10:00:00-03:00</dhRecbto>${prot}</retEnviNFe></nfeResultMsg></soap:Body></soap:Envelope>`;
}

function loteSimulado(opcoes) {
  const chamadas = [];
  const fn = async (args) => {
    chamadas.push(args);
    return { success: true, status: 'soap_enviado', raw: retornoSefaz(args.loteXml, opcoes) };
  };
  fn.chamadas = chamadas;
  return fn;
}

let material;
function deps(extra = {}) {
  return {
    carregarCertificado: () => material,
    inspecionarCertificado: () => ({ cnpj: CNPJ }),
    ...extra
  };
}

/** Bloqueia qualquer saída de rede durante `fn`; devolve as tentativas registradas. */
async function semRede(fn) {
  const tentativas = [];
  const bloquear = (nome) => (...args) => {
    tentativas.push(nome);
    throw new Error(`rede bloqueada no teste (${nome})`);
  };
  const originais = {
    socketConnect: net.Socket.prototype.connect,
    tlsConnect: tls.connect,
    dnsLookup: dns.lookup,
    httpRequest: http.request,
    httpsRequest: https.request
  };
  net.Socket.prototype.connect = bloquear('net.connect');
  tls.connect = bloquear('tls.connect');
  dns.lookup = bloquear('dns.lookup');
  http.request = bloquear('http.request');
  https.request = bloquear('https.request');
  try {
    const resultado = await fn();
    return { resultado, tentativas };
  } finally {
    net.Socket.prototype.connect = originais.socketConnect;
    tls.connect = originais.tlsConnect;
    dns.lookup = originais.dnsLookup;
    http.request = originais.httpRequest;
    https.request = originais.httpsRequest;
  }
}

let produtoId;
let clienteId;
let seq = 0;
async function criarVenda() {
  seq += 1;
  const venda = await run(
    `INSERT INTO vendas (codigo, data_venda, cliente_id, total, desconto, forma_pagamento, status, status_pagamento, valor_fiscal, valor_nao_fiscal)
     VALUES (?, datetime('now','localtime'), ?, 20, 0, 'dinheiro', 'concluida', 'quitada', 20, 0)`,
    [`NFE031-${Date.now()}-${seq}`, clienteId]
  );
  await run(
    `INSERT INTO vendas_itens (venda_id, produto_id, quantidade, preco_unitario, subtotal,
       quantidade_fiscal, quantidade_nao_fiscal, valor_fiscal, valor_nao_fiscal, item_fiscal)
     VALUES (?, ?, 2, 10, 20, 2, 0, 20, 0, 1)`,
    [venda.id, produtoId]
  );
  return venda.id;
}

const dadosNfe = () => nfeUi.montarPayloadEmissaoNfe({
  tipo: 'CPF',
  documento: '529.982.247-25',
  nome: 'CLIENTE NFE 031',
  logradouro: 'RUA DAS FLORES',
  numero: '45',
  bairro: 'CENTRO',
  municipio: 'Juazeiro do Norte',
  uf: 'CE',
  cep: '63010-000',
  natureza: 'VENDA DE MERCADORIA',
  cfop: '5102'
});

async function proximoNumero() {
  const r = await get(
    `SELECT proximo_numero FROM fiscal_numeracao
     WHERE empresa_cnpj = ? AND CAST(ambiente AS INTEGER) = 2 AND modelo = '55' AND CAST(serie AS INTEGER) = 1`,
    [CNPJ]
  );
  return r ? Number(r.proximo_numero) : null;
}

async function notaDaVenda(vendaId) {
  return get('SELECT * FROM nfe_notas WHERE venda_id = ? ORDER BY id DESC LIMIT 1', [vendaId]);
}

const CONFIG_BASE = {
  nome_empresa: 'CREMOLICIA TESTE LTDA',
  cnpj: CNPJ,
  fiscal_ie: '061234567',
  fiscal_ambiente: '2',
  fiscal_codigo_uf: '23',
  fiscal_uf: 'CE',
  fiscal_uf_sigla: 'CE',
  fiscal_serie: '1',
  fiscal_numero_atual: '10',
  fiscal_serie_nfe: '1',
  fiscal_numero_atual_nfe: '1',
  fiscal_regime_tributario: '1',
  fiscal_certificado_path: path.join(DIR, 'nao-existe.pfx'),
  fiscal_certificado_senha: '',
  fiscal_ws_nfe_autorizacao_homologacao: '',
  fiscal_municipio_codigo: '2307304',
  fiscal_municipio_nome: 'JUAZEIRO DO NORTE',
  fiscal_emitente_cep: '63000000',
  fiscal_emitente_logradouro: 'RUA DOS TESTES',
  fiscal_emitente_numero: '100',
  fiscal_emitente_bairro: 'CENTRO'
};

let server;
let base;
let token;

before(async () => {
  assert.ok(path.resolve(process.env.DB_DIR).startsWith(path.resolve(os.tmpdir())), 'teste deve usar banco temporário');
  await new Promise((resolve, reject) => db.whenReady((err) => (err ? reject(err) : resolve())));
  assert.equal(path.resolve(db.dbPath), path.resolve(DIR, 'mercadao.db'));
  chaves = forge.pki.rsa.generateKeyPair(2048);
  const cert = certificado(CNPJ);
  material = { privateKeyPem: forge.pki.privateKeyToPem(chaves.privateKey), certPem: forge.pki.certificateToPem(cert) };

  for (const [k, v] of Object.entries(CONFIG_BASE)) await setConfig(k, v);
  produtoId = (await run(
    `INSERT INTO produtos (codigo, nome, unidade, preco_venda, ncm, cfop, csosn, origem, ativo)
     VALUES ('SORV-031', 'SORVETE TESTE 031', 'UN', 10, '21050010', '5102', '102', '0', 1)`
  )).id;
  clienteId = (await run(
    `INSERT INTO clientes (nome, cpf_cnpj, rua, numero, bairro, cidade, uf, cep)
     VALUES ('CLIENTE TESTE NFE031', '529.982.247-25', 'RUA CLIENTE', '10', 'BAIRRO', 'JUAZEIRO DO NORTE', 'CE', '63000-000')`
  )).id;
  const usuarioId = (await run(`INSERT INTO usuarios (username, password_hash, role) VALUES ('nfe031', 'x', 'operador')`)).id;
  token = jwt.sign({ id: usuarioId, username: 'nfe031', role: 'operador', perfil: 'USUARIO' }, auth.JWT_SECRET);

  const app = express();
  app.use(express.json());
  app.use('/api/nfe', auth.verificarToken, require('../../backend/rotas/nfe'));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  identidadeSvc.prepararIdentidadeEmissaoNfe = prepararOriginal;
  lock.resetLocksForTests();
  if (server) await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => db.close(() => resolve()));
});

// ===========================================================================
// Identidade
// ===========================================================================

describe('NF-E-03.1 — identidade oficial no fluxo de emissão', () => {
  let emissao;
  let identidade;
  let nota;
  let xmlTransmitido;

  before(async () => {
    const vendaId = await criarVenda();
    const enviar = loteSimulado();
    const antes = identidadesCriadas.length;
    emissao = await emissor.emitirNfePorVendaId(vendaId, { deps: deps({ enviarLote: enviar }), dadosNfe: dadosNfe() });
    assert.equal(identidadesCriadas.length - antes, 1, 'uma emissão = uma identidade');
    identidade = identidadesCriadas[identidadesCriadas.length - 1];
    nota = await notaDaVenda(vendaId);
    xmlTransmitido = enviar.chamadas[0].loteXml;
  });

  it('identidade é criada pelo nfeIdentityService (builder não gera chave por conta própria)', () => {
    assert.equal(emissao.status, 'autorizada');
    const builder = read('backend/services/fiscal/xmlBuilderNfeVenda.js');
    assert.match(builder, /require\('\.\/nfeIdentityService'\)/);
    assert.doesNotMatch(builder, /gerarChaveAcesso|gerarCodigoNumerico/);
    const emissorSrc = read('backend/services/fiscal/nfeEmissorVenda.js');
    assert.match(emissorSrc, /reservarIdentidadeNfeVenda\(config\)/);
    assert.match(emissorSrc, /buildNfeXml\(\{[^}]*identidade \}\)/);
    assert.match(emissorSrc, /conferirIdentidadeXmlNfe\(built\.xmlSemAssinatura, identidade\)/);
  });

  it('chave usa CNPJ ativo, modelo 55, série, número reservado, UF, data, cNF e DV válido', () => {
    const p = identidadeSvc.parseChaveNfe(identidade.chave);
    assert.equal(p.uf, '23');
    assert.equal(p.cnpj, CNPJ);
    assert.equal(p.modelo, '55');
    assert.equal(p.serie, 1);
    assert.equal(p.numero, Number(nota.numero));
    assert.equal(p.numero, emissao.numero);
    assert.equal(p.tpEmis, '1');
    assert.equal(p.cNF, identidade.cNF);
    assert.notEqual(p.cNF, String(p.numero).padStart(8, '0'));
    const dh = /<dhEmi>(\d{2})(\d{2})-(\d{2})/.exec(xmlTransmitido);
    assert.equal(p.aamm, `${dh[2]}${dh[3]}`);
    assert.equal(identidadeSvc.chaveNfeComDvValido(identidade.chave), true);
  });

  it('ambiente da identidade = tpAmb do XML = ambiente da nota (homologação)', () => {
    assert.equal(identidade.ambiente, 2);
    assert.match(xmlTransmitido, /<tpAmb>2<\/tpAmb>/);
    assert.equal(Number(nota.ambiente), 2);
  });

  it('mesma chave no XML, em nfe_notas, no retorno e na auditoria/histórico', async () => {
    const chaveXml = (xmlTransmitido.match(/Id="NFe(\d{44})"/) || [])[1];
    assert.equal(chaveXml, identidade.chave);
    assert.equal(nota.chave_acesso, identidade.chave);
    assert.equal(emissao.chaveAcesso, identidade.chave);
    assert.equal((nota.xml_enviado.match(/Id="NFe(\d{44})"/) || [])[1], identidade.chave);
    const hist = await all('SELECT detalhes FROM nfe_historico WHERE nota_id = ?', [nota.id]).catch(() => []);
    for (const h of hist) {
      const chaveHist = (String(h.detalhes || '').match(/\d{44}/) || [])[0];
      if (chaveHist) assert.equal(chaveHist, identidade.chave);
    }
  });

  it('chave do DANFE = chave do banco', async () => {
    assert.ok(String(nota.danfe_html || '').replace(/\D/g, '').includes(identidade.chave));
    const danfe = await danfeService.obterDanfe({ tipo: 'VENDA', id: nota.id });
    assert.equal(String(danfe.documento.chave).replace(/\D/g, ''), identidade.chave);
    assert.ok(danfe.html.replace(/\D/g, '').includes(identidade.chave));
  });

  it('chave é única: duas vendas → duas identidades, números consecutivos, uma reserva cada', async () => {
    const n0 = await proximoNumero();
    const ids = [];
    for (let i = 0; i < 2; i += 1) {
      const out = await emissor.emitirNfePorVendaId(await criarVenda(), { deps: deps({ enviarLote: loteSimulado() }), dadosNfe: dadosNfe() });
      assert.equal(out.status, 'autorizada');
      ids.push(out);
    }
    assert.notEqual(ids[0].chaveAcesso, ids[1].chaveAcesso);
    assert.equal(ids[1].numero, ids[0].numero + 1);
    assert.equal(ids[0].numero, n0);
    assert.equal(await proximoNumero(), n0 + 2);
    const repetidas = await all(`SELECT chave_acesso, COUNT(*) c FROM nfe_notas WHERE chave_acesso <> '' GROUP BY chave_acesso HAVING c > 1`);
    assert.deepEqual(repetidas, []);
  });

  it('builder recusa número divergente da identidade', async () => {
    const config = await getFiscalConfig({ validarUrls: false });
    const id = prepararOriginal({ cnpj: CNPJ, serie: 1, numero: 700, ambiente: 2, uf: '23' });
    assert.throws(
      () => buildNfeXml({ config, venda: { id: 1, cliente_cpf: '52998224725', cliente_nome: 'X' }, itens: [], numero: 701, identidade: id, dadosNfe: dadosNfe() }),
      (e) => e.code === 'IDENTIDADE_XML_DIVERGENTE'
    );
  });

  it('conferência detecta XML com identidade alterada', () => {
    const id = prepararOriginal({ cnpj: CNPJ, serie: 1, numero: 42, ambiente: 2, uf: '23' });
    const xml = `<NFe><infNFe Id="NFe${id.chave}"><ide><cUF>23</cUF><cNF>${id.cNF}</cNF><mod>55</mod><serie>1</serie><nNF>42</nNF>` +
      `<dhEmi>${id.dhEmi}</dhEmi><tpEmis>1</tpEmis><cDV>${id.cDV}</cDV><tpAmb>2</tpAmb></ide><emit><CNPJ>${CNPJ}</CNPJ></emit></infNFe></NFe>`;
    assert.equal(identidadeSvc.conferirIdentidadeXmlNfe(xml, id), true);
    assert.throws(() => identidadeSvc.conferirIdentidadeXmlNfe(xml.replace('<nNF>42</nNF>', '<nNF>43</nNF>'), id), /nNF=43/);
    assert.throws(() => identidadeSvc.conferirIdentidadeXmlNfe(xml.replace(`<CNPJ>${CNPJ}</CNPJ>`, `<CNPJ>${CNPJ_FILIAL}</CNPJ>`), id), /emit\/CNPJ/);
  });

  it('parâmetros inválidos da chave são recusados (CNPJ, série, ambiente, UF, cNF = nNF)', () => {
    const okArgs = { cnpj: CNPJ, serie: 1, numero: 5, ambiente: 2, uf: '23' };
    assert.throws(() => prepararOriginal({ ...okArgs, cnpj: '123' }), /CNPJ/);
    assert.throws(() => prepararOriginal({ ...okArgs, serie: 1000 }), /Série/);
    assert.throws(() => prepararOriginal({ ...okArgs, ambiente: 3 }), /Ambiente/);
    assert.throws(() => prepararOriginal({ ...okArgs, uf: '99' }), /UF/);
    assert.throws(() => prepararOriginal({ ...okArgs, cNF: '00000005' }), /cNF/);
    assert.notEqual(identidadeSvc.gerarCnfNfe(5, (() => { let i = 0; return () => (i++ === 0 ? 5 : 77); })()), '00000005');
  });
});

describe('NF-E-03.1 — exemplo determinístico de chave', () => {
  it('CNPJ 36811652000153, série 1, nº 1, homologação, 10/2026, cNF 12345678', () => {
    const id = prepararOriginal({
      cnpj: CNPJ, serie: 1, numero: 1, ambiente: 2, uf: '23',
      dhEmi: '2026-10-04T21:30:00-03:00', cNF: '12345678'
    });
    assert.equal(id.chave, '23261036811652000153550010000000011123456785');
    assert.equal(id.chave.length, 44);
    assert.equal(identidadeSvc.chaveNfeComDvValido(id.chave), true);
    assert.equal(identidadeSvc.chaveNfeComDvValido(`${id.chave.slice(0, 43)}0`), false);
  });
});

// ===========================================================================
// Bloqueios de configuração — nada de número consumido, nada transmitido
// ===========================================================================

describe('NF-E-03.1 — bloqueios antes de reservar número', () => {
  async function semConsumo(montarDeps, verificar) {
    const vendaId = await criarVenda();
    const n0 = await proximoNumero();
    const enviar = loteSimulado();
    const ids0 = identidadesCriadas.length;
    const out = await emissor.emitirNfePorVendaId(vendaId, { deps: montarDeps(enviar), dadosNfe: dadosNfe() });
    verificar(out);
    assert.equal(await proximoNumero(), n0, 'nenhum número consumido');
    assert.equal(enviar.chamadas.length, 0, 'nada transmitido');
    assert.equal(identidadesCriadas.length, ids0, 'nenhuma identidade criada');
    assert.equal(await notaDaVenda(vendaId), null, 'nenhuma nota registrada');
  }

  it('CNPJ configurado divergente da empresa ativa bloqueia (CERTIFICATE_CONFIGURATION_ERROR)', () => semConsumo(
    (enviar) => deps({ enviarLote: enviar, cnpjEmpresaAtiva: CNPJ_OUTRA_EMPRESA }),
    (out) => {
      assert.equal(out.status, 'configuracao_pendente');
      assert.equal(out.codigo, 'CERTIFICATE_CONFIGURATION_ERROR');
    }
  ));

  it('certificado de outra empresa bloqueia', () => semConsumo(
    (enviar) => deps({ enviarLote: enviar, inspecionarCertificado: () => ({ cnpj: CNPJ_OUTRA_EMPRESA }) }),
    (out) => {
      assert.equal(out.codigo, 'CERTIFICATE_CONFIGURATION_ERROR');
      assert.match(out.message, /certificado/i);
    }
  ));

  it('certificado de filial (mesma raiz, outro estabelecimento) bloqueia', () => semConsumo(
    (enviar) => deps({ enviarLote: enviar, inspecionarCertificado: () => ({ cnpj: CNPJ_FILIAL }) }),
    (out) => {
      assert.equal(out.codigo, 'CERTIFICATE_CONFIGURATION_ERROR');
      assert.match(out.message, /36811652000234/);
    }
  ));

  it('ambiente produção bloqueia (PRODUCAO_NFE_LIBERADA = false)', async () => {
    assert.equal(guard.nfeProducaoLiberada(), false);
    const config = { ...(await getFiscalConfig({ validarUrls: false })), ambiente: 1 };
    await semConsumo(
      (enviar) => deps({ enviarLote: enviar, config }),
      (out) => {
        assert.equal(out.status, 'ambiente_bloqueado');
        assert.equal(out.codigo, 'NFE_PRODUCAO_BLOQUEADA');
      }
    );
  });

  it('UF do emitente inválida bloqueia antes da reserva', async () => {
    const config = { ...(await getFiscalConfig({ validarUrls: false })), codigoUf: '99' };
    await semConsumo(
      (enviar) => deps({ enviarLote: enviar, config }),
      (out) => {
        assert.equal(out.status, 'configuracao_pendente');
        assert.equal(out.codigo, 'NFE_IDENTIDADE_INVALIDA');
      }
    );
  });

  it('URL de homologação configurada com o webservice de produção bloqueia sem tocar a rede', async () => {
    const base = await getFiscalConfigNfe();
    const config = { ...base, urlsNfe: { ...base.urlsNfe, autorizacao: URL_PRODUCAO } };
    const { tentativas } = await semRede(() => semConsumo(
      () => deps({ config }),
      (out) => {
        assert.equal(out.status, 'configuracao_pendente');
        assert.equal(out.codigo, 'WS_NFE_PRODUCAO_EM_HOMOLOGACAO');
      }
    ));
    assert.deepEqual(tentativas, []);
  });

  it('UF sem autorizador SVRS e sem URL configurada bloqueia sem tocar a rede', async () => {
    const base = await getFiscalConfigNfe();
    const config = { ...base, codigoUf: '35', urlsNfe: { autorizacao: '', consultaProtocolo: '', status: '', evento: '' } };
    const { tentativas } = await semRede(() => semConsumo(
      () => deps({ config }),
      (out) => {
        assert.equal(out.status, 'configuracao_pendente');
        assert.equal(out.codigo, 'WS_NFE_NAO_CONFIGURADO');
      }
    ));
    assert.deepEqual(tentativas, []);
  });
});

// ===========================================================================
// Idempotência (NF-E-02) preservada
// ===========================================================================

describe('NF-E-03.1 — idempotência intacta', () => {
  it('autorizada: reutiliza a nota, sem nova chave nem número', async () => {
    const vendaId = await criarVenda();
    const primeira = await emissor.emitirNfePorVendaId(vendaId, { deps: deps({ enviarLote: loteSimulado() }), dadosNfe: dadosNfe() });
    const n0 = await proximoNumero();
    const ids0 = identidadesCriadas.length;
    const segunda = await emissor.emitirNfePorVendaId(vendaId, { deps: deps({ enviarLote: loteSimulado() }), dadosNfe: dadosNfe() });
    assert.equal(segunda.reused, true);
    assert.equal(segunda.chaveAcesso, primeira.chaveAcesso);
    assert.equal(await proximoNumero(), n0);
    assert.equal(identidadesCriadas.length, ids0);
  });

  it('transmitindo com chave: consulta antes de qualquer nova emissão', async () => {
    const vendaId = await criarVenda();
    const chave = prepararOriginal({ cnpj: CNPJ, serie: 1, numero: 880, ambiente: 2, uf: '23' }).chave;
    await run(
      `INSERT INTO nfe_notas (venda_id, numero, serie, chave_acesso, ambiente, status) VALUES (?, 880, 1, ?, 2, 'transmitindo')`,
      [vendaId, chave]
    );
    const n0 = await proximoNumero();
    const ids0 = identidadesCriadas.length;
    const consultas = [];
    const enviar = loteSimulado();
    const out = await emissor.emitirNfePorVendaId(vendaId, {
      deps: deps({
        enviarLote: enviar,
        consultarSituacao: async (notaId) => { consultas.push(notaId); return { status: 'autorizada', cStat: '100', protocolo: '223260000000880' }; }
      }),
      dadosNfe: dadosNfe()
    });
    assert.equal(consultas.length, 1);
    assert.equal(out.recuperacao, true);
    assert.equal(out.chaveAcesso, chave);
    assert.equal(enviar.chamadas.length, 0);
    assert.equal(await proximoNumero(), n0);
    assert.equal(identidadesCriadas.length, ids0);
  });

  it('aguardando_retorno: bloqueia nova emissão (consulta decide)', async () => {
    const vendaId = await criarVenda();
    await run(
      `INSERT INTO nfe_notas (venda_id, numero, serie, chave_acesso, ambiente, status) VALUES (?, 881, 1, ?, 2, 'aguardando_retorno')`,
      [vendaId, '2'.repeat(44)]
    );
    const n0 = await proximoNumero();
    const out = await emissor.emitirNfePorVendaId(vendaId, { deps: deps({ enviarLote: loteSimulado() }), dadosNfe: dadosNfe() });
    assert.equal(out.status, 'emissao_em_andamento');
    assert.equal(await proximoNumero(), n0);
  });

  it('rejeitada: reprocessamento existente gera nova identidade com novo número', async () => {
    const vendaId = await criarVenda();
    const rejeitada = await emissor.emitirNfePorVendaId(vendaId, {
      deps: deps({ enviarLote: loteSimulado({ cStat: '225', xMotivo: 'Rejeicao: Falha no Schema XML' }) }),
      dadosNfe: dadosNfe()
    });
    assert.equal(rejeitada.status, 'rejeitada');
    const nova = await emissor.emitirNfePorVendaId(vendaId, { deps: deps({ enviarLote: loteSimulado() }), dadosNfe: dadosNfe() });
    assert.equal(nova.status, 'autorizada');
    assert.notEqual(nova.chaveAcesso, rejeitada.chaveAcesso);
    assert.equal(nova.numero, rejeitada.numero + 1);
  });
});

// ===========================================================================
// Prontidão local
// ===========================================================================

describe('NF-E-03.1 — diagnóstico local de prontidão', () => {
  const PROGRAMDATA = 'C:\\PDTESTE';
  const env = { PROGRAMDATA };
  const dirCremolicia = path.join(PROGRAMDATA, 'MercantilFiscal', 'dados');
  let pfxOk;

  before(() => {
    pfxOk = gravarPfx('cert-031-ok.pfx', CNPJ);
  });

  const lerCfg = (extra = {}) => async (chaves) => {
    const cfg = { ...CONFIG_BASE, fiscal_certificado_path: pfxOk, fiscal_certificado_senha: SENHA_PFX, fiscal_ws_nfe_autorizacao_homologacao: URL_HOMOLOGACAO, ...extra };
    return Object.fromEntries(chaves.filter((k) => cfg[k] !== undefined).map((k) => [k, cfg[k]]));
  };
  const diag = (extra, outros = {}) => prontidao.diagnosticarProntidaoNfe({
    env, dbDir: dirCremolicia, lerConfiguracoes: lerCfg(extra), lerProximoNumero: async () => 7, ...outros
  });
  const itemDe = (out, id) => out.itens.find((i) => i.id === id);

  it('configuração completa: PRONTA PARA HOMOLOGAÇÃO, produção bloqueada', async () => {
    const out = await diag();
    assert.equal(out.status, 'PRONTA_PARA_HOMOLOGACAO');
    assert.equal(out.pronta, true);
    assert.deepEqual(out.pendencias, []);
    assert.equal(itemDe(out, 'ambiente').valor, 'Homologação');
    assert.equal(itemDe(out, 'serie').valor, 1);
    assert.equal(itemDe(out, 'numeracao').valor, 7);
    assert.equal(itemDe(out, 'producao').valor, 'Bloqueada');
    assert.equal(out.producaoBloqueada, true);
    assert.equal(itemDe(out, 'dbDir').nivel, 'ok');
  });

  it('não expõe senha nem caminho completo do certificado', async () => {
    const texto = JSON.stringify(await diag());
    assert.doesNotMatch(texto, new RegExp(SENHA_PFX));
    assert.ok(!texto.includes(pfxOk.replace(/\\/g, '\\\\')));
    assert.match(texto, /cert-031-ok\.pfx/);
    assert.doesNotMatch(texto, /PRIVATE KEY|senha"/i);
  });

  it('configuração vazia: NF-E NÃO CONFIGURADA com os itens pendentes', async () => {
    const out = await prontidao.diagnosticarProntidaoNfe({ env, dbDir: dirCremolicia, lerConfiguracoes: async () => ({}), lerProximoNumero: async () => null });
    assert.equal(out.status, 'NAO_CONFIGURADA');
    assert.equal(out.mensagem, 'NF-e não está pronta para emissão.');
    for (const nome of ['Empresa', 'CNPJ', 'Certificado', 'Série']) {
      assert.ok(out.pendencias.includes(nome), `pendência ${nome}`);
    }
    assert.ok(!out.pendencias.includes('Produção'));
    assert.equal(itemDe(out, 'ambiente').nivel, 'ok', 'fiscal_ambiente_nfe ausente = homologação (padrão)');
    assert.equal(out.ambienteOrigem, 'padrao');
    assert.equal(itemDe(out, 'webservice').valor, URL_HOMOLOGACAO, 'sem URL configurada: SVRS oficial do CE');
  });

  it('CNPJ do certificado divergente bloqueia (CERTIFICATE_CONFIGURATION_ERROR)', async () => {
    const pfx = gravarPfx('cert-031-outra.pfx', CNPJ_OUTRA_EMPRESA);
    const c = itemDe(await diag({ fiscal_certificado_path: pfx }), 'certificado');
    assert.equal(c.nivel, 'bloqueado');
    assert.equal(c.codigo, 'CERTIFICATE_CONFIGURATION_ERROR');
  });

  it('certificado de filial bloqueia', async () => {
    const pfx = gravarPfx('cert-031-filial.pfx', CNPJ_FILIAL);
    const out = await diag({ fiscal_certificado_path: pfx });
    assert.equal(itemDe(out, 'certificado').codigo, 'CERTIFICATE_CONFIGURATION_ERROR');
    assert.equal(out.pronta, false);
  });

  it('CNPJ da empresa inválido fica pendente', async () => {
    const out = await diag({ cnpj: '36811652000100' });
    assert.equal(itemDe(out, 'cnpj').nivel, 'pendente');
    assert.ok(out.pendencias.includes('CNPJ'));
  });

  it('certificado vencido e senha incorreta não passam', async () => {
    const vencido = gravarPfx('cert-031-vencido.pfx', CNPJ, { expirado: true });
    assert.equal(itemDe(await diag({ fiscal_certificado_path: vencido }), 'certificado').codigo, 'CERTIFICATE_EXPIRED');
    const senhaErrada = itemDe(await diag({ fiscal_certificado_senha: 'errada' }), 'certificado');
    assert.equal(senhaErrada.ok, false);
    assert.doesNotMatch(JSON.stringify(senhaErrada), /errada/);
  });

  it('fiscal_ambiente_nfe = 1 bloqueia; valor inválido fica pendente; fiscal_ambiente (NFC-e) não interfere', async () => {
    const prod = await diag({ fiscal_ambiente_nfe: '1' });
    assert.equal(itemDe(prod, 'ambiente').nivel, 'bloqueado');
    assert.equal(itemDe(prod, 'ambiente').codigo, 'NFE_PRODUCAO_BLOQUEADA');
    assert.equal(prod.pronta, false);
    const invalido = itemDe(await diag({ fiscal_ambiente_nfe: '3' }), 'ambiente');
    assert.equal(invalido.nivel, 'pendente');
    assert.equal(invalido.codigo, 'NFE_AMBIENTE_INVALIDO');
    const nfceProducao = await diag({ fiscal_ambiente: '1', fiscal_ambiente_nfe: '2' });
    assert.equal(nfceProducao.pronta, true);
    assert.equal(nfceProducao.tpAmb, 2);
    assert.equal(nfceProducao.ambienteNfce, 'Produção');
    assert.equal(itemDe(nfceProducao, 'webservice').valor, URL_HOMOLOGACAO);
  });

  it('URL ausente usa a SVRS oficial; sem https, de produção ou da NFC-e bloqueia', async () => {
    const padrao = itemDe(await diag({ fiscal_ws_nfe_autorizacao_homologacao: '' }), 'webservice');
    assert.equal(padrao.nivel, 'ok');
    assert.equal(padrao.valor, URL_HOMOLOGACAO);
    const http = itemDe(await diag({ fiscal_ws_nfe_autorizacao_homologacao: 'http://exemplo.invalid/ws' }), 'webservice');
    assert.equal(http.nivel, 'pendente');
    assert.equal(http.codigo, 'WS_NFE_INVALIDO');
    const prod = itemDe(await diag({ fiscal_ws_nfe_autorizacao_homologacao: URL_PRODUCAO }), 'webservice');
    assert.equal(prod.nivel, 'bloqueado');
    assert.equal(prod.codigo, 'WS_NFE_PRODUCAO_EM_HOMOLOGACAO');
    const nfce = itemDe(await diag({ fiscal_ws_nfe_autorizacao_homologacao: 'https://nfce-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx' }), 'webservice');
    assert.equal(nfce.nivel, 'bloqueado');
    assert.equal(nfce.codigo, 'WS_NFE_URL_NFCE');
    const evento = await diag({ fiscal_ws_nfe_evento_homologacao: 'ftp://x.invalid' });
    assert.equal(itemDe(evento, 'webservice').codigo, 'WS_NFE_INVALIDO');
    assert.equal(evento.pronta, false);
  });

  it('série inválida fica pendente', async () => {
    assert.equal(itemDe(await diag({ fiscal_serie_nfe: '' }), 'serie').nivel, 'pendente');
    assert.equal(itemDe(await diag({ fiscal_serie_nfe: '1000' }), 'serie').nivel, 'pendente');
  });

  it('DB_DIR: padrão (MercantilFiscal\\dados) ok, outro caminho só alerta', async () => {
    assert.equal(dataDir.resolverDbDir(env), dirCremolicia);
    assert.equal(itemDe(await diag(), 'dbDir').nivel, 'ok');
    assert.equal(itemDe(await diag({}, { dbDir: path.join(PROGRAMDATA, 'CDS Cremolicia', 'dados') }), 'dbDir').nivel, 'alerta');
    assert.equal(itemDe(await diag({}, { dbDir: DIR }), 'dbDir').nivel, 'alerta');
  });

  it('banco real (temporário): lê configuração e próxima numeração sem consumir número', async () => {
    await setConfig('fiscal_certificado_path', pfxOk);
    await setConfig('fiscal_certificado_senha', SENHA_PFX);
    await setConfig('fiscal_ws_nfe_autorizacao_homologacao', URL_HOMOLOGACAO);
    try {
      const n0 = await proximoNumero();
      const out = await prontidao.diagnosticarProntidaoNfe({ env });
      assert.equal(out.pronta, true, JSON.stringify(out.pendencias));
      assert.equal(itemDe(out, 'numeracao').valor, n0);
      assert.equal(itemDe(out, 'dbDir').valor, db.dbDir);
      assert.equal(await proximoNumero(), n0);
    } finally {
      await setConfig('fiscal_certificado_path', CONFIG_BASE.fiscal_certificado_path);
      await setConfig('fiscal_certificado_senha', '');
      await setConfig('fiscal_ws_nfe_autorizacao_homologacao', '');
    }
  });

  it('GET /api/nfe/prontidao devolve o diagnóstico sem dados sensíveis', async () => {
    const r = await fetch(`${base}/nfe/prontidao`, { headers: { Authorization: `Bearer ${token}` } });
    const json = await r.json();
    assert.equal(r.status, 200);
    assert.equal(json.status, 'NAO_CONFIGURADA');
    assert.ok(json.pendencias.includes('Certificado'));
    assert.ok(!json.pendencias.includes('Webservice'));
    assert.equal(json.webservices.autorizacao.url, URL_HOMOLOGACAO);
    assert.equal(json.webservices.autorizacao.origem, 'padrao_svrs');
    assert.equal(json.chamadasSefaz, 0);
    assert.doesNotMatch(JSON.stringify(json), /fiscal_certificado_senha|PRIVATE KEY/);
  });

  it('diagnóstico não chama SEFAZ: nenhuma conexão, DNS ou HTTP(S)', async () => {
    const { resultado, tentativas } = await semRede(() => diag());
    assert.deepEqual(tentativas, []);
    assert.equal(resultado.pronta, true);
    assert.equal(resultado.chamadasSefaz, 0);
    const src = read('backend/services/fiscal/nfeProntidaoService.js');
    assert.doesNotMatch(src, /enviarSoap|enviarLote|consultarStatusServico|consultarProtocolo|require\('(https?|dns|net|tls|axios)'\)/);
  });
});

// ===========================================================================
// Interface
// ===========================================================================

const SCRIPTS_ERP = [
  'frontend/vendor/jquery/jquery.min.js',
  'frontend/shared/js/validarMotivo.js',
  'frontend/shared/js/access-control.js',
  'frontend/shared/js/core.js',
  'frontend/shared/js/vendasHistoricoUi.js',
  'frontend/shared/js/fiscalImpressao.js',
  'frontend/erp/js/nfe.js',
  'frontend/erp/js/vendas.js',
  'frontend/erp/js/fiscal.js'
];

const janelas = [];
function criarJanela() {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body><div id="page-content"></div><div id="modal-container"></div></body></html>',
    { url: 'http://localhost/erp/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole() }
  );
  const { window } = dom;
  janelas.push(window);
  window.localStorage.setItem('token', 'token-teste');
  window.localStorage.setItem('user', JSON.stringify({ role: 'admin', perfil: 'ADMIN' }));
  class ModalStub {
    constructor(el) { this.el = el; el.__modal = this; }
    static getInstance(el) { return el.__modal || null; }
    static getOrCreateInstance(el) { return el.__modal || new ModalStub(el); }
    show() { this.el.classList.add('show'); }
    hide() {
      this.el.classList.remove('show');
      this.el.dispatchEvent(new window.Event('hidden.bs.modal'));
    }
  }
  window.bootstrap = { Modal: ModalStub };
  for (const rel of SCRIPTS_ERP) window.eval(read(rel));
  window.CONFIG_IMPLANTACAO = { recursos: { fiscal: true, nfe: true } };
  window.eval('CONFIG_IMPLANTACAO = window.CONFIG_IMPLANTACAO;');
  window.showNotification = () => {};
  window.viewVenda = () => {};
  const chamadas = [];
  const rotas = {};
  window.fetch = async (url, opts = {}) => {
    const u = new URL(url, 'http://localhost');
    const metodo = String(opts.method || 'GET').toUpperCase();
    chamadas.push(`${metodo} ${u.pathname}`);
    const r = rotas[`${metodo} ${u.pathname}`];
    const status = r ? (r.status || 200) : 404;
    const texto = JSON.stringify(r ? r.body : { success: false });
    return { ok: status < 300, status, headers: { get: () => null }, json: async () => JSON.parse(texto), text: async () => texto };
  };
  return { window, rotas, chamadas };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
async function aguardar(cond) {
  for (let i = 0; i < 50 && !cond(); i += 1) await tick();
  return cond();
}

const ITENS_PENDENTES = [
  { id: 'dbDir', nome: 'Banco de dados', nivel: 'ok', ok: true, mensagem: 'Banco da CDS Cremolícia.', valor: 'C:\\ProgramData\\MercantilFiscal\\dados' },
  { id: 'empresa', nome: 'Empresa', nivel: 'pendente', ok: false, mensagem: 'Informe: inscrição estadual.' },
  { id: 'cnpj', nome: 'CNPJ', nivel: 'pendente', ok: false, mensagem: 'CNPJ da empresa não configurado.' },
  { id: 'certificado', nome: 'Certificado', nivel: 'pendente', ok: false, mensagem: 'Certificado A1 não configurado.' },
  { id: 'ambiente', nome: 'Ambiente', nivel: 'ok', ok: true, mensagem: 'Homologação (tpAmb = 2).', valor: 'Homologação' },
  { id: 'serie', nome: 'Série', nivel: 'ok', ok: true, mensagem: 'Série da NF-e modelo 55.', valor: 1 },
  { id: 'webservice', nome: 'Webservice', nivel: 'pendente', ok: false, mensagem: 'URL de autorização NF-e de homologação não configurada.' },
  { id: 'producao', nome: 'Produção', nivel: 'ok', ok: true, mensagem: 'Produção NF-e bloqueada no backend.', valor: 'Bloqueada' }
];
const DIAG_NAO_PRONTA = {
  success: true, pronta: false, status: 'NAO_CONFIGURADA', mensagem: 'NF-e não está pronta para emissão.',
  itens: ITENS_PENDENTES, pendencias: ['Empresa', 'CNPJ', 'Certificado', 'Webservice'], chamadasSefaz: 0
};
const DIAG_PRONTA = {
  success: true, pronta: true, status: 'PRONTA_PARA_HOMOLOGACAO', mensagem: 'NF-e pronta para emissão em homologação.',
  itens: ITENS_PENDENTES.map((i) => ({ ...i, nivel: 'ok', ok: true })), pendencias: [], chamadasSefaz: 0
};

describe('NF-E-03.1 — interface de prontidão', () => {
  after(() => {
    for (const w of janelas.splice(0)) w.close();
  });

  it('cartão mostra "NF-e não está pronta para emissão." e os itens pendentes', () => {
    const html = nfeUi.nfeHtmlProntidao(DIAG_NAO_PRONTA);
    assert.equal(nfeUi.NFE_MSG_NAO_PRONTA, 'NF-e não está pronta para emissão.');
    assert.match(html, /NF-e não está pronta para emissão\./);
    for (const nome of ['Empresa', 'CNPJ', 'Certificado', 'Webservice']) assert.match(html, new RegExp(`<strong>${nome}</strong>`));
    assert.match(html, /STATUS: NF-E NÃO CONFIGURADA/);
  });

  it('cartão pronto mostra STATUS: PRONTA PARA HOMOLOGAÇÃO e produção com cadeado', () => {
    const html = nfeUi.nfeHtmlProntidao(DIAG_PRONTA);
    assert.match(html, /STATUS: PRONTA PARA HOMOLOGAÇÃO/);
    assert.doesNotMatch(html, /nfeProntidaoAviso/);
    assert.match(html, /data-prontidao-item="producao"[\s\S]*?fa-lock/);
  });

  it('Emitir NF-e com configuração incompleta abre aviso controlado e não chama emissão', async () => {
    const ctx = criarJanela();
    ctx.rotas['GET /api/nfe/prontidao'] = { body: DIAG_NAO_PRONTA };
    await ctx.window.abrirEmissaoNfe(7);
    const modal = ctx.window.document.getElementById('modalNfeNaoPronta');
    assert.ok(modal);
    assert.match(modal.textContent, /NF-e não está pronta para emissão\./);
    assert.match(modal.textContent, /Certificado/);
    assert.equal(ctx.window.document.getElementById('modalEmitirNfe'), null);
    assert.ok(!ctx.chamadas.includes('GET /api/vendas/7'));
    assert.ok(!ctx.chamadas.some((c) => c.startsWith('POST ')));
  });

  it('Emitir NF-e com configuração pronta segue para o formulário', async () => {
    const ctx = criarJanela();
    ctx.rotas['GET /api/nfe/prontidao'] = { body: DIAG_PRONTA };
    ctx.rotas['GET /api/vendas/7'] = {
      body: {
        id: 7, codigo: 'V0007', status: 'concluida', cliente_nome: 'MARIA', cliente_cpf: '529.982.247-25',
        itens: [], nfe: { nota: null, possui_parcela_fiscal: true, pode_emitir: true, acao: 'emitir' }
      }
    };
    await ctx.window.abrirEmissaoNfe(7);
    assert.ok(ctx.window.document.getElementById('modalEmitirNfe'));
    assert.equal(ctx.window.document.getElementById('modalNfeNaoPronta'), null);
  });

  it('Fiscal › NF-e › Diagnóstico NF-e exibe a prontidão', async () => {
    const ctx = criarJanela();
    ctx.rotas['GET /api/nfe/prontidao'] = { body: DIAG_NAO_PRONTA };
    if (!ctx.window.document.getElementById('page-content')) {
      ctx.window.document.body.insertAdjacentHTML('beforeend', '<div id="page-content"></div>');
    }
    await ctx.window.loadNfePagina('fiscal-nfe-diagnostico');
    assert.ok(await aguardar(() => ctx.window.document.getElementById('nfeProntidaoCard')));
    const card = ctx.window.document.getElementById('nfeProntidaoCard');
    assert.equal(card.getAttribute('data-status'), 'NAO_CONFIGURADA');
    assert.match(card.textContent, /NF-e não está pronta para emissão\./);
    assert.ok(ctx.window.document.getElementById('nfeBtnAtualizar'));
    assert.ok(!ctx.chamadas.some((c) => c.startsWith('POST ')));
  });

  it('interface não manipula senha de certificado', () => {
    const src = read('frontend/erp/js/nfe.js');
    assert.doesNotMatch(src, /certificado_senha|certificadoSenha|PRIVATE KEY/);
  });
});

// ===========================================================================
// Isolamento
// ===========================================================================

describe('NF-E-03.1 — NFC-e, Central e produção intactos', () => {
  it('NFC-e continua com builder/emissor próprios, sem identidade/prontidão NF-e', () => {
    for (const rel of ['backend/services/fiscal/xmlBuilder.js', 'backend/services/fiscal/emissor.js']) {
      const src = read(rel);
      assert.doesNotMatch(src, /nfeIdentityService|nfeProntidaoService|nfeEmissorVenda/, rel);
    }
    assert.match(read('backend/services/fiscal/xmlBuilder.js'), /gerarChaveAcesso\(/);
  });

  it('Central de Entradas não referencia identidade/prontidão NF-e', () => {
    const pasta = path.join(ROOT, 'backend/motores/central-entradas');
    const arquivos = [];
    const varrer = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) varrer(p);
        else if (e.name.endsWith('.js')) arquivos.push(p);
      }
    };
    varrer(pasta);
    for (const arq of arquivos) {
      assert.doesNotMatch(fs.readFileSync(arq, 'utf8'), /nfeIdentityService|nfeProntidaoService/, arq);
    }
  });

  it('produção continua bloqueada no backend', () => {
    assert.match(read('backend/services/fiscal/nfeAmbienteGuard.js'), /const PRODUCAO_NFE_LIBERADA = false;/);
    assert.equal(guard.ambienteNfePermitido(1), false);
    assert.equal(guard.ambienteNfePermitido(2), true);
  });
});
