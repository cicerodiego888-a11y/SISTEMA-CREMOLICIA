/**
 * NF-E-01 — Port do núcleo NF-e 55 (CDS Sistemas Atual → Sorveteria).
 *
 * Banco isolado em %TEMP% (nunca o banco fiscal ativo). SEFAZ simulada por injeção
 * de dependência: nenhuma transmissão real. Certificado autoassinado gerado em memória.
 */

'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');

const DIR = path.join(os.tmpdir(), 'cds-nfe-testes', 'integracao');
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

const ROOT = path.resolve(__dirname, '../..');
const FISCAL = path.join(ROOT, 'backend/services/fiscal');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const db = require('../../backend/database');
const { getFiscalConfig, incrementaNumeroFiscal } = require(path.join(FISCAL, 'configService'));
const emissor = require(path.join(FISCAL, 'nfeEmissorVenda'));
const central = require(path.join(FISCAL, 'nfeCentralService'));
const operacional = require(path.join(FISCAL, 'nfeOperacionalService'));
const danfeService = require(path.join(FISCAL, 'danfeService'));
const numeracao = require(path.join(FISCAL, 'numeracaoFiscalService'));
const numeracaoNfe = require(path.join(FISCAL, 'nfeNumeracaoNfeService'));
const lock = require(path.join(FISCAL, 'nfeEmissionLockService'));
const identidade = require(path.join(FISCAL, 'nfeIdentityService'));
const xmlIdentidade = require(path.join(FISCAL, 'nfeXmlIdentityService'));
const { parseRetornoAutorizacaoNfe, NOME_DEST_HOMOLOGACAO } = require(path.join(FISCAL, 'nfeRetornoAutorizacao'));
const { buildNfeXml, itemEntraNaNfe } = require(path.join(FISCAL, 'xmlBuilderNfeVenda'));
const { assinarNFe } = require(path.join(FISCAL, 'signer'));
const soapClient = require(path.join(FISCAL, 'soapClient'));
const nfeWs = require(path.join(FISCAL, 'nfeWebServices'));
const rtc = require('../../backend/motores/rtc');

const CNPJ = '12345678000195';
const CHAVE_REGEX = /^\d{44}$/;

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
  const attrs = [{ name: 'commonName', value: `EMPRESA TESTE NFE:${cnpj}` }];
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

function retornoSefaz(loteXml, { cStat = '100', xMotivo = 'Autorizado o uso da NF-e', nProt = '223260000000001', lote = '104', semInfProt = false } = {}) {
  const chave = chaveDoLote(loteXml);
  const temProt = ['100', '150', '110', '301', '302'].includes(cStat);
  const prot = semInfProt ? '' :
    `<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><verAplic>SVRS</verAplic><chNFe>${chave}</chNFe>` +
    `<dhRecbto>2026-10-04T10:00:00-03:00</dhRecbto>${temProt ? `<nProt>${nProt}</nProt>` : ''}` +
    `<digVal>abc=</digVal><cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo></infProt></protNFe>`;
  return `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>` +
    `<nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4"><retEnviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">` +
    `<tpAmb>2</tpAmb><verAplic>SVRS</verAplic><cStat>${lote}</cStat><xMotivo>${lote === '104' ? 'Lote processado' : 'Lote em processamento'}</xMotivo>` +
    `<cUF>23</cUF><dhRecbto>2026-10-04T10:00:00-03:00</dhRecbto>${prot}</retEnviNFe></nfeResultMsg></soap:Body></soap:Envelope>`;
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

function loteAutorizado(opcoes = {}) {
  const chamadas = [];
  const fn = async (args) => {
    chamadas.push(args);
    return { success: true, status: 'soap_enviado', raw: retornoSefaz(args.loteXml, opcoes) };
  };
  fn.chamadas = chamadas;
  return fn;
}

async function criarVenda({ itens } = {}) {
  seqVenda += 1;
  const lista = itens || [
    { quantidade: 2, quantidade_fiscal: 2, quantidade_nao_fiscal: 0, preco_unitario: 10, subtotal: 20, valor_fiscal: 20, valor_nao_fiscal: 0 },
    { quantidade: 1, quantidade_fiscal: 0, quantidade_nao_fiscal: 1, preco_unitario: 5, subtotal: 5, valor_fiscal: 0, valor_nao_fiscal: 5 },
    { quantidade: 3, quantidade_fiscal: 1, quantidade_nao_fiscal: 2, preco_unitario: 7, subtotal: 21, valor_fiscal: 7, valor_nao_fiscal: 14 }
  ];
  const valorFiscal = lista.reduce((s, i) => s + i.valor_fiscal, 0);
  const valorNaoFiscal = lista.reduce((s, i) => s + i.valor_nao_fiscal, 0);
  const venda = await run(
    `INSERT INTO vendas (codigo, data_venda, cliente_id, total, desconto, forma_pagamento, status, status_pagamento, valor_fiscal, valor_nao_fiscal)
     VALUES (?, datetime('now','localtime'), ?, ?, 0, 'dinheiro', 'finalizada', 'quitada', ?, ?)`,
    [`NFE01-${Date.now()}-${seqVenda}`, clienteId, valorFiscal + valorNaoFiscal, valorFiscal, valorNaoFiscal]
  );
  for (const it of lista) {
    await run(
      `INSERT INTO vendas_itens (venda_id, produto_id, quantidade, preco_unitario, subtotal,
         quantidade_fiscal, quantidade_nao_fiscal, valor_fiscal, valor_nao_fiscal, item_fiscal)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [venda.id, produtoId, it.quantidade, it.preco_unitario, it.subtotal,
        it.quantidade_fiscal, it.quantidade_nao_fiscal, it.valor_fiscal, it.valor_nao_fiscal, it.valor_fiscal > 0 ? 1 : 0]
    );
  }
  return venda.id;
}

before(async () => {
  assert.ok(path.resolve(process.env.DB_DIR).startsWith(path.resolve(os.tmpdir())), 'teste deve usar banco temporário');
  await new Promise((resolve, reject) => db.whenReady((err) => (err ? reject(err) : resolve())));
  material = gerarCertificadoTeste();

  const cfg = {
    nome_empresa: 'SORVETERIA TESTE NFE LTDA',
    cnpj: CNPJ,
    fiscal_ie: '061234567',
    fiscal_ambiente: '2',
    fiscal_codigo_uf: '23',
    fiscal_uf: 'CE',
    fiscal_uf_sigla: 'CE',
    fiscal_serie: '1',
    fiscal_numero_atual: '41',
    fiscal_serie_nfe: '7',
    fiscal_regime_tributario: '1',
    fiscal_certificado_path: path.join(DIR, 'nao-existe.pfx'),
    fiscal_certificado_senha: '',
    fiscal_municipio_codigo: '2304400',
    fiscal_municipio_nome: 'FORTALEZA',
    fiscal_emitente_cep: '60000000',
    fiscal_emitente_logradouro: 'RUA DOS TESTES',
    fiscal_emitente_numero: '100',
    fiscal_emitente_bairro: 'CENTRO',
    fiscal_token_csc: 'TOKEN-CSC-SECRETO'
  };
  for (const [k, v] of Object.entries(cfg)) await setConfig(k, v);

  const prod = await run(
    `INSERT INTO produtos (codigo, nome, unidade, preco_venda, ncm, cfop, csosn, origem, ativo)
     VALUES ('SORV-01', 'SORVETE TESTE 1L', 'UN', 10, '21050010', '5102', '102', '0', 1)`
  );
  produtoId = prod.id;
  const cli = await run(
    `INSERT INTO clientes (nome, cpf_cnpj, rua, numero, bairro, cidade, uf, cep)
     VALUES ('CLIENTE TESTE NFE', '529.982.247-25', 'RUA CLIENTE', '10', 'BAIRRO', 'FORTALEZA', 'CE', '60000-000')`
  );
  clienteId = cli.id;
});

after(async () => {
  lock.resetLocksForTests();
  await new Promise((resolve) => db.close(() => resolve()));
});

describe('NF-E-01 — configuração (MESCLAR configService)', () => {
  it('expõe série/número NF-e, razão/fantasia e URLs NF-e sem exigir URL NFC-e', async () => {
    const cfg = await getFiscalConfig({ validarUrls: false });
    assert.equal(cfg.serieNfe, 7);
    assert.equal(cfg.serie, 1, 'série NFC-e preservada');
    assert.equal(cfg.razaoSocial, 'SORVETERIA TESTE NFE LTDA');
    assert.ok(cfg.urlsNfe && 'autorizacao' in cfg.urlsNfe && 'evento' in cfg.urlsNfe);
  });

  it('não imprime senha do certificado nem token CSC no log', async () => {
    const original = console.log;
    const linhas = [];
    console.log = (...a) => linhas.push(a.join(' '));
    try {
      await setConfig('fiscal_certificado_senha', 'SENHA-PFX-SECRETA');
      await getFiscalConfig({ validarUrls: false });
    } finally {
      console.log = original;
      await setConfig('fiscal_certificado_senha', '');
    }
    const texto = linhas.join('\n');
    assert.doesNotMatch(texto, /SENHA-PFX-SECRETA/);
    assert.doesNotMatch(texto, /TOKEN-CSC-SECRETO/);
  });
});

describe('NF-E-01 — SOAP / WebServices (REUTILIZAR soapClient)', () => {
  it('não existe segundo cliente SOAP nem segundo signer', () => {
    const arquivos = fs.readdirSync(FISCAL);
    assert.ok(!arquivos.some((f) => /^soapClient.+\.js$/i.test(f)), 'soapClient duplicado');
    assert.ok(!arquivos.some((f) => /^signer.+\.js$/i.test(f)), 'signer duplicado');
    assert.ok(!fs.existsSync(path.join(FISCAL, 'core')), 'runtime core/ do Atual não portado');
    const ws = read('backend/services/fiscal/nfeWebServices.js');
    assert.doesNotMatch(ws, /require\(['"]axios['"]\)|require\(['"]https['"]\)/);
    assert.match(ws, /enviarSoapSefaz/);
  });

  it('enviarSoapSefaz envia SOAP 1.2 com action e devolve corpo', async () => {
    let capturado;
    const out = await soapClient.enviarSoapSefaz({
      url: 'https://exemplo.invalid/ws',
      envelope: '<soap12:Envelope/>',
      soapAction: nfeWs.ACTIONS.EVENTO,
      httpsAgent: {},
      httpClient: async (url, body, opts) => { capturado = { url, body, opts }; return { status: 200, data: '<cStat>135</cStat>' }; }
    });
    assert.equal(out.success, true);
    assert.equal(out.body, '<cStat>135</cStat>');
    assert.match(capturado.opts.headers['Content-Type'], /application\/soap\+xml/);
    assert.match(capturado.opts.headers['Content-Type'], /NFeRecepcaoEvento4\/nfeRecepcaoEvento/);
  });

  it('falha HTTP retorna success=false estruturado (sem exceção)', async () => {
    const out = await soapClient.enviarSoapSefaz({
      url: 'https://exemplo.invalid/ws',
      envelope: '<x/>',
      httpsAgent: {},
      httpClient: async () => { const e = new Error('Request failed'); e.response = { status: 500, data: 'erro' }; throw e; }
    });
    assert.equal(out.success, false);
    assert.equal(out.statusCode, 500);
    const semUrl = await soapClient.enviarSoapSefaz({ url: '', envelope: '<x/>' });
    assert.equal(semUrl.code, 'URL_NAO_CONFIGURADA');
  });

  it('URLs NF-e: padrão SVRS do Atual, sobrescrevíveis por configuração', () => {
    assert.equal(nfeWs.resolverUrlNfe('autorizacao', 2), 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx');
    assert.equal(nfeWs.resolverUrlNfe('evento', 1), 'https://nfe.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx');
    const cfg = { ambiente: 2, urlsNfe: { autorizacao: 'https://sefaz.uf.invalid/NFeAutorizacao4' } };
    assert.equal(nfeWs.resolverUrlNfe('autorizacao', 2, cfg), 'https://sefaz.uf.invalid/NFeAutorizacao4');
    assert.equal(nfeWs.resolverUrlNfe('autorizacao', 1, cfg), 'https://nfe.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx', 'override só vale no ambiente configurado');
  });

  it('envelopes de consulta protocolo e status serviço', () => {
    const chave = '2'.repeat(44);
    const cons = nfeWs.montarEnvelopeConsultaProtocolo({ tpAmb: 2, chave, cUF: '23' });
    assert.match(cons, /<consSitNFe[^>]*versao="4.00"><tpAmb>2<\/tpAmb><xServ>CONSULTAR<\/xServ><chNFe>2{44}<\/chNFe>/);
    assert.match(cons, /NFeConsultaProtocolo4/);
    const st = nfeWs.montarEnvelopeStatusServico({ tpAmb: 1, cUF: '23' });
    assert.match(st, /<consStatServ[^>]*><tpAmb>1<\/tpAmb><cUF>23<\/cUF><xServ>STATUS<\/xServ>/);
  });
});

describe('NF-E-01 — retorno SEFAZ (HTTP 200 não é autorização)', () => {
  const lote = `<NFe><infNFe Id="NFe${'3'.repeat(44)}"></infNFe></NFe>`;
  it('autorizada somente com protNFe/infProt cStat 100', () => {
    const p = parseRetornoAutorizacaoNfe(retornoSefaz(lote));
    assert.equal(p.status, 'autorizada');
    assert.equal(p.cStat, '100');
    assert.equal(p.nProt, '223260000000001');
  });
  it('lote 104 com infProt de rejeição = rejeitada', () => {
    const p = parseRetornoAutorizacaoNfe(retornoSefaz(lote, { cStat: '225', xMotivo: 'Rejeicao: Falha no Schema XML' }));
    assert.equal(p.status, 'rejeitada');
    assert.equal(p.cStatLote, '104');
  });
  it('denegada (302) e lote em processamento sem infProt', () => {
    assert.equal(parseRetornoAutorizacaoNfe(retornoSefaz(lote, { cStat: '302', xMotivo: 'Uso Denegado' })).status, 'denegada');
    assert.equal(parseRetornoAutorizacaoNfe(retornoSefaz(lote, { lote: '105', semInfProt: true })).status, 'aguardando_retorno');
  });
  it('resposta HTTP 200 sem cStat não autoriza', () => {
    const p = parseRetornoAutorizacaoNfe('<html>200 OK</html>');
    assert.notEqual(p.status, 'autorizada');
  });
});

describe('NF-E-01 — numeração 55 e lock (sem tocar NFC-e)', () => {
  it('reservas concorrentes geram números distintos e consecutivos', async () => {
    const reservas = await Promise.all(
      Array.from({ length: 5 }, () => numeracaoNfe.reservarProximoNumeroNfe({ serie: 99, ambiente: 2, cnpj: CNPJ }))
    );
    const numeros = reservas.map((r) => Number(r.numero ?? r)).sort((a, b) => a - b);
    assert.deepEqual(numeros, [1, 2, 3, 4, 5]);
    // NF-E-02: reservar em outra série não altera a série configurada.
    assert.equal(await getConfig('fiscal_serie_nfe'), '7');
  });

  it('modelo 65 é recusado pela numeração NF-e', async () => {
    await assert.rejects(
      numeracao.reservarProximaNumeracaoFiscal({ cnpj: CNPJ, ambiente: 2, modelo: '65', serie: 1 }),
      (err) => err.code === 'MODELO_NAO_SUPORTADO'
    );
    const linha65 = await get(`SELECT COUNT(*) AS n FROM fiscal_numeracao WHERE modelo = '65'`);
    assert.equal(linha65.n, 0);
    assert.equal(await getConfig('fiscal_numero_atual'), '41', 'contador NFC-e intacto');
  });

  it('lock de emissão rejeita concorrência no mesmo escopo', async () => {
    const t = lock.adquirirLock('nfe-venda-teste');
    assert.throws(() => lock.adquirirLock('nfe-venda-teste'), (e) => e.code === 'EMISSAO_EM_ANDAMENTO' && e.statusCode === 409);
    lock.liberarLock(t);
    assert.equal(lock.lockAtivo('nfe-venda-teste'), false);
  });
});

describe('NF-E-01 — emissão NF-e 55 por venda (SEFAZ simulada)', () => {
  let vendaId;
  let resultado;
  let lote;

  it('certificado de outro CNPJ é bloqueado antes de reservar número', async () => {
    const v = await criarVenda();
    const antes = await all('SELECT * FROM fiscal_numeracao WHERE modelo = ?', ['55']);
    const out = await emissor.emitirNfePorVendaId(v, {
      deps: deps(loteAutorizado(), { inspecionarCertificado: () => ({ cnpj: '99888777000166' }) })
    });
    assert.equal(out.success, false);
    assert.equal(out.codigo, 'CERTIFICATE_CONFIGURATION_ERROR');
    const depois = await all('SELECT * FROM fiscal_numeracao WHERE modelo = ?', ['55']);
    assert.deepEqual(depois, antes, 'nenhum número consumido');
    assert.equal(await getConfig('cnpj'), CNPJ, 'CNPJ do emitente não é alterado para o do certificado');
    assert.throws(() => emissor.validarCertificadoEmitenteNfe(
      { cnpj: CNPJ, certificadoPath: 'x' },
      { inspecionarCertificado: () => ({ cnpj: '12345678000276' }) }
    ), (e) => e.code === 'CERTIFICATE_CONFIGURATION_ERROR', 'NF-E-02: certificado de filial (mesmo CNPJ-Base) é recusado');
  });

  it('autoriza com cStat 100, persiste em nfe_notas e não altera o status da venda', async () => {
    vendaId = await criarVenda();
    const enviar = loteAutorizado();
    resultado = await emissor.emitirNfePorVendaId(vendaId, { deps: deps(enviar), usuarioNome: 'teste' });
    assert.equal(resultado.status, 'autorizada', resultado.message);
    assert.equal(resultado.success, true);
    assert.equal(enviar.chamadas.length, 1);
    lote = enviar.chamadas[0];
    assert.equal(lote.url, 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx');
    assert.equal(lote.cUF, '23');

    const nota = await get('SELECT * FROM nfe_notas WHERE id = ?', [resultado.notaId]);
    assert.equal(nota.status, 'autorizada');
    assert.equal(nota.protocolo, '223260000000001');
    assert.equal(Number(nota.serie), 7);
    assert.match(nota.chave_acesso, CHAVE_REGEX);
    assert.ok(nota.danfe_html && nota.danfe_html.length > 100);
    const venda = await get('SELECT status FROM vendas WHERE id = ?', [vendaId]);
    assert.equal(venda.status, 'finalizada', 'NF-E-02: a venda nunca vira EMITIDA');
  });

  it('identidade: chave 44 dígitos coerente com modelo 55, série, número, CNPJ, UF, tpEmis', async () => {
    const nota = await get('SELECT * FROM nfe_notas WHERE id = ?', [resultado.notaId]);
    const p = identidade.parseChaveNfe(nota.chave_acesso);
    assert.equal(p.uf, '23');
    assert.equal(p.cnpj, CNPJ);
    assert.equal(String(p.modelo), '55');
    assert.equal(Number(p.serie), 7);
    assert.equal(Number(p.numero), Number(nota.numero));
    assert.equal(nota.chave_acesso.charAt(34), '1', 'tpEmis normal');
    assert.equal(xmlIdentidade.extrairChaveDoXml(nota.xml_enviado), nota.chave_acesso);
    assert.doesNotThrow(() => xmlIdentidade.validarChaveContraXml(nota.chave_acesso, nota.xml_enviado));
    assert.equal(xmlIdentidade.calcularHashXml(nota.xml_enviado), xmlIdentidade.calcularHashXml(nota.xml_enviado));
  });

  it('XML: modelo 55, homologação, assinatura e somente a parcela fiscal', async () => {
    const nota = await get('SELECT xml_enviado FROM nfe_notas WHERE id = ?', [resultado.notaId]);
    const xml = nota.xml_enviado;
    assert.match(xml, /<mod>55<\/mod>/);
    assert.match(xml, /<tpAmb>2<\/tpAmb>/);
    assert.match(xml, /<Signature[\s\S]*<SignatureValue>[^<]+<\/SignatureValue>/);
    assert.match(xml, /<X509Certificate>[^<\s]+<\/X509Certificate>/);
    assert.equal((xml.match(/<det nItem=/g) || []).length, 2, 'item não fiscal fora da NF-e');
    assert.match(xml, /<qCom>1\.0000<\/qCom>/, 'quantidade fiscal do item misto');
    assert.match(xml, /<vNF>27\.00<\/vNF>/, 'total = somente valor fiscal');
    assert.match(xml, new RegExp(`<xNome>${NOME_DEST_HOMOLOGACAO}</xNome>`));
    assert.match(xml, /<cMun>2304400<\/cMun>[\s\S]*<xMun>FORTALEZA<\/xMun>/, 'endereço do emitente vem da configuração');
    assert.match(xml, /<nro>100<\/nro>/);
  });

  it('idempotência: segunda emissão reutiliza a autorizada sem transmitir', async () => {
    const enviar = loteAutorizado();
    const out = await emissor.emitirNfePorVendaId(vendaId, { deps: deps(enviar) });
    assert.equal(out.reused, true);
    assert.equal(out.notaId, resultado.notaId);
    assert.equal(enviar.chamadas.length, 0);
  });

  it('concorrência: duas emissões simultâneas da mesma venda transmitem uma vez', async () => {
    const v = await criarVenda();
    const chamadas = [];
    const lento = async (args) => {
      chamadas.push(args);
      await new Promise((r) => setTimeout(r, 50));
      return { success: true, raw: retornoSefaz(args.loteXml) };
    };
    const [a, b] = await Promise.all([
      emissor.emitirNfePorVendaId(v, { deps: deps(lento) }),
      emissor.emitirNfePorVendaId(v, { deps: deps(lento) })
    ]);
    const status = [a.status, b.status].sort();
    assert.deepEqual(status, ['autorizada', 'emissao_em_andamento']);
    assert.equal(chamadas.length, 1);
  });

  it('rejeição (cStat 2xx) não autoriza e não marca a venda', async () => {
    const v = await criarVenda();
    const out = await emissor.emitirNfePorVendaId(v, {
      deps: deps(loteAutorizado({ cStat: '225', xMotivo: 'Rejeicao: Falha no Schema XML' }))
    });
    assert.equal(out.success, false);
    assert.equal(out.status, 'rejeitada');
    assert.equal(out.cStat, '225');
    const venda = await get('SELECT status FROM vendas WHERE id = ?', [v]);
    assert.notEqual(venda.status, 'EMITIDA');
  });

  it('denegação (302) persiste como denegada', async () => {
    const v = await criarVenda();
    const out = await emissor.emitirNfePorVendaId(v, { deps: deps(loteAutorizado({ cStat: '302', xMotivo: 'Uso Denegado' })) });
    assert.equal(out.status, 'denegada');
  });

  it('lote em processamento bloqueia nova emissão até consulta', async () => {
    const v = await criarVenda();
    const out = await emissor.emitirNfePorVendaId(v, { deps: deps(loteAutorizado({ lote: '105', semInfProt: true })) });
    operacional.cancelarTimerConsulta(out.notaId);
    assert.equal(out.status, 'aguardando_retorno');
    const enviar = loteAutorizado();
    const deNovo = await emissor.emitirNfePorVendaId(v, { deps: deps(enviar) });
    assert.equal(deNovo.status, 'emissao_em_andamento');
    assert.equal(enviar.chamadas.length, 0);
  });

  it('falha de transmissão (success=false) vira erro_transmissao, nunca autorizada', async () => {
    const v = await criarVenda();
    const out = await emissor.emitirNfePorVendaId(v, {
      deps: deps(async () => ({ success: false, status: 'erro_transmissao', message: 'timeout', code: 'ECONNABORTED' }))
    });
    assert.equal(out.success, false);
    assert.equal(out.status, 'erro_transmissao');
    const nota = await get('SELECT status, chave_acesso FROM nfe_notas WHERE id = ?', [out.notaId]);
    assert.equal(nota.status, 'erro_transmissao');
    assert.match(nota.chave_acesso, CHAVE_REGEX);
  });

  it('venda sem parcela fiscal não emite', async () => {
    const v = await criarVenda({
      itens: [{ quantidade: 1, quantidade_fiscal: 0, quantidade_nao_fiscal: 1, preco_unitario: 5, subtotal: 5, valor_fiscal: 0, valor_nao_fiscal: 5 }]
    });
    const out = await emissor.emitirNfePorVendaId(v, { deps: deps(loteAutorizado()) });
    assert.equal(out.status, 'sem_itens_fiscais');
    assert.equal(itemEntraNaNfe({ quantidade_fiscal: 1, valor_fiscal: 0 }), false);
  });
});

describe('NF-E-01 — reenvio idempotente', () => {
  it('não reemite quando a SEFAZ já registra a NF-e como autorizada', async () => {
    const v = await criarVenda();
    const falha = await emissor.emitirNfePorVendaId(v, {
      deps: deps(async () => ({ success: false, status: 'erro_transmissao', message: 'timeout' }))
    });
    const enviar = loteAutorizado();
    const out = await operacional.reenviarNfe(falha.notaId, {
      consultarSituacao: async () => ({ status: 'autorizada', protocolo: '223260000000777', cStat: '100' }),
      emissaoDeps: deps(enviar)
    });
    assert.equal(out.codigo, 'JA_PROCESSADA_SEFAZ');
    assert.equal(enviar.chamadas.length, 0);
  });

  it('reemite quando a SEFAZ não conhece a chave (217)', async () => {
    const v = await criarVenda();
    const falha = await emissor.emitirNfePorVendaId(v, {
      deps: deps(async () => ({ success: false, status: 'erro_transmissao', message: 'timeout' }))
    });
    const enviar = loteAutorizado();
    const out = await operacional.reenviarNfe(falha.notaId, {
      consultarSituacao: async () => ({ status: 'rejeitada', cStat: '217' }),
      emissaoDeps: deps(enviar)
    });
    assert.equal(out.success, true, out.mensagem);
    assert.equal(enviar.chamadas.length, 1);
  });
});

describe('NF-E-01 — consulta protocolo e DANFE', () => {
  let notaId;
  before(async () => {
    const v = await criarVenda();
    notaId = (await emissor.emitirNfePorVendaId(v, { deps: deps(loteAutorizado()) })).notaId;
  });

  it('consulta por chave atualiza cStat/xMotivo via infProt', async () => {
    const config = await getFiscalConfig({ validarUrls: false });
    let recebido;
    const out = await central.consultarSituacaoNfe(notaId, {
      config,
      consultarProtocolo: async (args) => {
        recebido = args;
        return { success: true, body: `<retConsSitNFe><cStat>100</cStat><protNFe><infProt><chNFe>${args.chave}</chNFe><nProt>223260000000001</nProt><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe></retConsSitNFe>` };
      }
    });
    assert.equal(out.status, 'autorizada');
    assert.equal(out.cStat, '100');
    assert.match(recebido.chave, CHAVE_REGEX);
  });

  it('DANFE NF-e (HTML/PDF/XML) somente para documento autorizado', async () => {
    const danfe = await danfeService.obterDanfe({ tipo: 'VENDA', id: notaId });
    assert.match(danfe.html, /DANFE/);
    assert.equal(danfe.documento.modelo, '55');
    const pdf = await danfeService.obterPdfDanfe({ tipo: 'VENDA', id: notaId });
    assert.equal(pdf.buffer.slice(0, 4).toString(), '%PDF');
    const xml = await danfeService.obterXmlAutorizado({ tipo: 'VENDA', id: notaId });
    assert.match(xml.xml, /<nfeProc[\s\S]*<protNFe/);

    const v = await criarVenda();
    const rej = await emissor.emitirNfePorVendaId(v, { deps: deps(loteAutorizado({ cStat: '225', xMotivo: 'Rejeicao' })) });
    await assert.rejects(danfeService.obterDanfe({ tipo: 'VENDA', id: rej.notaId }), (e) => e.code === 'DOCUMENTO_NAO_AUTORIZADO');
  });

  it('DANFE NF-e é separado do DANFE NFC-e e do comprovante de consignação', () => {
    const danfeNfe = read('backend/services/fiscal/danfeNfe.js');
    assert.doesNotMatch(danfeNfe, /require\(['"]\.\/danfe['"]\)|Comprovante/);
  });
});

describe('NF-E-01 — cancelamento (evento 110111)', () => {
  let notaId;
  let chave;
  let config;
  before(async () => {
    const v = await criarVenda();
    const out = await emissor.emitirNfePorVendaId(v, { deps: deps(loteAutorizado()) });
    notaId = out.notaId;
    chave = out.chaveAcesso;
    config = await getFiscalConfig({ validarUrls: false });
  });

  function retornoEvento(cStat, xMotivo) {
    return `<retEnvEvento><idLote>1</idLote><tpAmb>2</tpAmb><cStat>128</cStat><xMotivo>Lote de Evento Processado</xMotivo>` +
      `<retEvento versao="1.00"><infEvento><tpAmb>2</tpAmb><cOrgao>23</cOrgao><cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo>` +
      `<chNFe>${chave}</chNFe><tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento>${cStat === '135' ? '<nProt>323260000000099</nProt>' : ''}</infEvento></retEvento></retEnvEvento>`;
  }

  it('justificativa inválida é recusada antes da SEFAZ', async () => {
    let chamou = false;
    await assert.rejects(
      central.cancelarNfeCentral(notaId, 'curta', { deps: { config, carregarCertificado: () => material, enviarEvento: async () => { chamou = true; } } }),
      (e) => e.statusCode === 400
    );
    assert.equal(chamou, false);
  });

  it('rejeição do evento mantém a nota e marca cancelamento_rejeitado', async () => {
    const out = await central.cancelarNfeCentral(notaId, 'Cancelamento solicitado pelo cliente por desistencia da compra', {
      deps: { config, carregarCertificado: () => material, enviarEvento: async () => ({ success: true, body: retornoEvento('573', 'Rejeicao: Duplicidade de evento') }) }
    });
    assert.equal(out.success, false);
    assert.equal(out.status, 'cancelamento_rejeitado');
  });

  it('cStat 135 cancela, assina evento e grava protocolo/XML', async () => {
    let enviado;
    const out = await central.cancelarNfeCentral(notaId, 'Cancelamento solicitado pelo cliente por desistencia da compra', {
      usuarioNome: 'teste',
      deps: {
        config,
        carregarCertificado: () => material,
        enviarEvento: async (args) => { enviado = args; return { success: true, body: retornoEvento('135', 'Evento registrado e vinculado a NF-e') }; }
      }
    });
    assert.equal(out.success, true);
    assert.equal(out.status, 'cancelada');
    assert.equal(enviado.url, 'https://nfe-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx');
    assert.match(enviado.envelope, /<tpEvento>110111<\/tpEvento>/);
    assert.match(enviado.envelope, new RegExp(`<chNFe>${chave}</chNFe>`));
    assert.match(enviado.envelope, /<nProt>223260000000001<\/nProt>/);
    assert.match(enviado.envelope, /<Signature[\s\S]*<\/Signature>/);
    const nota = await get('SELECT status, protocolo_cancelamento, xml_cancelamento, motivo_cancelamento FROM nfe_notas WHERE id = ?', [notaId]);
    assert.equal(nota.status, 'cancelada');
    assert.equal(nota.protocolo_cancelamento, '323260000000099');
    assert.match(nota.xml_cancelamento, /<cStat>135<\/cStat>/);
    assert.match(nota.motivo_cancelamento, /desistencia/);
    const hist = await central.listarHistoricoNfe(notaId);
    assert.ok(hist.some((h) => h.acao === 'cancelamento'), 'auditoria do cancelamento');
  });

  it('cancelamento repetido é bloqueado (idempotência)', async () => {
    let chamou = false;
    await assert.rejects(
      central.cancelarNfeCentral(notaId, 'Cancelamento solicitado pelo cliente por desistencia da compra', {
        deps: { config, carregarCertificado: () => material, enviarEvento: async () => { chamou = true; } }
      }),
      (e) => e.statusCode === 404
    );
    assert.equal(chamou, false);
  });

  it('cancelarNfce (NFC-e) permanece separado', () => {
    const nfce = read('backend/services/fiscal/cancelarNfce.js');
    assert.doesNotMatch(nfce, /nfe_notas|cancelarNfe\b|nfeWebServices/);
  });
});

describe('NF-E-01 — devolução preservada', () => {
  it('módulo de devolução de compra intacto e carregável', () => {
    const dev = require(path.join(FISCAL, 'nfeDevolucaoCompra'));
    assert.equal(typeof dev.emitirNFeDevolucaoCompra, 'function');
    const src = read('backend/services/fiscal/nfeDevolucaoCompra.js');
    assert.doesNotMatch(src, /nfeEmissorVenda|nfeWebServices|numeracaoFiscalService/);
  });

  it('numeração NF-e venda não colide com número já usado pela devolução', async () => {
    await run(`
      CREATE TABLE IF NOT EXISTS nfe_devolucoes_compra (
        id INTEGER PRIMARY KEY AUTOINCREMENT, compra_id INTEGER NOT NULL, numero INTEGER, serie INTEGER,
        chave_acesso TEXT, protocolo TEXT, ambiente INTEGER, status TEXT, xml_enviado TEXT, xml_retorno TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    await run(
      `INSERT INTO nfe_devolucoes_compra (compra_id, numero, serie, chave_acesso, protocolo, ambiente, status, xml_retorno)
       VALUES (999, 500, 7, ?, '223260000000500', 2, 'autorizada', '<retEnviNFe/>')`,
      [`232610${CNPJ}55007000000500112345678` + '9']
    );
    const reserva = await numeracaoNfe.reservarProximoNumeroNfe({ serie: 7, ambiente: 2, cnpj: CNPJ });
    assert.ok(Number(reserva.numero ?? reserva) > 500);
  });

  it('Central NF-e lista a devolução de compra com as colunas existentes', async () => {
    const notas = await central.listarNfeNotas({ tipo: 'DEVOLUCAO_COMPRA' });
    assert.equal(notas.length, 1);
    assert.equal(notas[0].tipo, 'DEVOLUCAO_COMPRA');
    assert.equal(Number(notas[0].numero), 500);
    const vendas = await central.listarNfeNotas({ tipo: 'VENDA' });
    assert.ok(vendas.length >= 5);
  });
});

describe('NF-E-01 — RTC (contrato mínimo)', () => {
  it('ContextoFiscal valida modelo, ambiente e UF', () => {
    const ctx = rtc.criarContextoFiscal({
      modelo: '55', ambiente: 2, uf: 'ce', crt: '1', cnpjEmitente: CNPJ,
      itens: [{ produto_id: 1, ncm: '2105.00.10', cfop: '5102', csosn: '102', origem: '0', quantidade_fiscal: 2, valor_fiscal: 20 }]
    });
    assert.equal(ctx.uf, 'CE');
    assert.equal(ctx.itens[0].ncm, '21050010');
    assert.equal(ctx.itens[0].valorFiscal, 20);
    assert.ok(Object.isFrozen(ctx));
    assert.throws(() => rtc.criarContextoFiscal({ modelo: '59', ambiente: 2, uf: 'CE' }), (e) => e.code === 'RTC_CONTEXTO_INVALIDO');
  });

  it('IBS/CBS estruturais: sem alíquota padrão e valor exige fonte', () => {
    const r = rtc.criarResultadoTributario({ nItem: 1 });
    for (const t of ['ibs', 'cbs']) {
      assert.equal(r[t].aplicavel, false);
      assert.equal(r[t].aliquota, null);
      assert.equal(r[t].valor, null);
      assert.equal(r[t].fonte, rtc.ORIGEM_NAO_CONFIGURADO);
    }
    assert.throws(() => rtc.criarResultadoTributario({ nItem: 1, ibs: { aliquota: 0.1 } }), (e) => e.code === 'RTC_RESULTADO_INVALIDO');
    const comFonte = rtc.criarResultadoTributario({ nItem: 1, cbs: { cst: '000', aliquota: 0.9, fonte: 'configuracao:teste' } });
    assert.equal(comFonte.cbs.aplicavel, true);
  });

  it('descreve a tributação atual do builder sem inventar tributo', () => {
    const r = rtc.resultadoDoBuilderNfeAtual({ nItem: 1, csosn: '102', origem: '0' });
    assert.equal(r.icms.grupo, 'ICMSSN102');
    assert.equal(r.pis.cst, '49');
    assert.equal(r.ibs.aplicavel, false);
  });
});

describe('NF-E-01 — regressão NFC-e e Central', () => {
  it('NFC-e: contador, série e tabela intactos após emissões NF-e', async () => {
    assert.equal(await getConfig('fiscal_numero_atual'), '41');
    assert.equal(await getConfig('fiscal_serie'), '1');
    const nfce = await get('SELECT COUNT(*) AS n FROM nfce_notas');
    assert.equal(nfce.n, 0);
    const numero = await incrementaNumeroFiscal();
    assert.equal(numero, 41, 'numeração NFC-e continua no fluxo próprio');
    assert.equal(await getConfig('fiscal_numero_atual'), '42');
  });

  it('emissor/xmlBuilder NFC-e não dependem do núcleo NF-e 55', () => {
    for (const rel of ['backend/services/fiscal/emissor.js', 'backend/services/fiscal/xmlBuilder.js']) {
      assert.doesNotMatch(read(rel), /nfeEmissorVenda|xmlBuilderNfeVenda|nfeWebServices|numeracaoFiscalService/, rel);
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
      assert.doesNotMatch(fs.readFileSync(arq, 'utf8'), /nfeEmissorVenda|cancelarNfe\b|nfeCentralService|nfeOperacionalService/, arq);
    }
  });

  it('rotas: /api/nfe autenticada + recurso nfe; sem NF-e avulsa', () => {
    const server = read('backend/server.js');
    assert.match(server, /app\.use\('\/api\/nfe', verificarToken, exigirRecurso\('nfe'\), nfeRoutes\)/);
    const rotas = read('backend/rotas/nfe.js');
    assert.match(rotas, /router\.use\(exigirRecurso\('nfe'\)\)/);
    assert.match(rotas, /\/vendas\/:vendaId\/emitir/);
    assert.match(rotas, /\/notas\/:id\/cancelar/);
    assert.doesNotMatch(rotas, /nfeAvulsa/);
  });
});
