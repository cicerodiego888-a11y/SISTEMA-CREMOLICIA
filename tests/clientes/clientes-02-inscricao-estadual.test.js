/**
 * CLIENTES-02 — Cliente preparado para NF-e (Inscrição Estadual).
 *
 * clientes.inscricao_estadual (migration aditiva/idempotente), regra única IE → indIEDest
 * (backend/services/fiscal/inscricaoEstadual.js) e o caminho completo
 * Cliente → formulário NF-e → payload dest_* → emissor → <dest> do XML.
 *
 * Banco isolado em %TEMP%; SEFAZ simulada por injeção de dependência (nenhuma transmissão real).
 */

'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const DIR = path.join(os.tmpdir(), 'cds-clientes-testes', 'inscricao-estadual-02');
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
const sqlite3 = require('sqlite3');
const express = require('express');
const jwt = require('jsonwebtoken');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '../..');
const FISCAL = path.join(ROOT, 'backend/services/fiscal');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const db = require('../../backend/database');
const auth = require('../../backend/middleware/auth');
const emissor = require(path.join(FISCAL, 'nfeEmissorVenda'));
const numeracao = require(path.join(FISCAL, 'numeracaoFiscalService'));
const lock = require(path.join(FISCAL, 'nfeEmissionLockService'));
const { buildNfeXml } = require(path.join(FISCAL, 'xmlBuilderNfeVenda'));
const { getFiscalConfig } = require(path.join(FISCAL, 'configService'));
const ie = require(path.join(FISCAL, 'inscricaoEstadual'));
const migration021 = require('../../backend/modules/comercial/migrations/021_clientes_inscricao_estadual');
const { validarDadosNfeConfirmacao } = require('../../backend/services/vendas/faturamentoNfeService');
const nfeUi = require('../../frontend/erp/js/nfe.js');

const CNPJ_EMITENTE = '36811652000153';
const CPF_VALIDO = '52998224725';
const CNPJ_CLIENTE = '11222333000181';

const CAMPOS = ['nome', 'cpf_cnpj', 'inscricao_estadual', 'telefone', 'email', 'cep', 'rua', 'numero', 'bairro',
  'cidade', 'uf', 'limite_credito', 'tipo_comercial_id'];

let server;
let base;
let token;
let tipoConsumidorId;
let tipoAtacadistaId;
let produtoId;
let material;

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

async function api(method, rota, body) {
  const r = await fetch(`${base}${rota}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const texto = await r.text();
  let json = null;
  try { json = JSON.parse(texto); } catch (_) { /* corpo não JSON */ }
  return { status: r.status, body: json };
}

async function lerCliente(id) {
  const row = await get('SELECT * FROM clientes WHERE id = ?', [id]);
  if (!row) return null;
  return Object.fromEntries(CAMPOS.map((c) => [c, row[c]]));
}
const lerIe = async (id) => (await get('SELECT inscricao_estadual FROM clientes WHERE id = ?', [id])).inscricao_estadual;

let seq = 0;
function cpfUnico() {
  seq += 1;
  const n = String(81000000000 + seq);
  return { formatado: `${n.slice(0, 3)}.${n.slice(3, 6)}.${n.slice(6, 9)}-${n.slice(9)}`, digitos: n };
}

/** Cliente criado pelo POST real com todos os campos do cadastro. */
async function criarClienteCompleto(extra = {}) {
  const cpf = cpfUnico();
  const r = await api('POST', '/clientes', {
    nome: `CLIENTE IE ${seq}`,
    cpf_cnpj: cpf.formatado,
    telefone: '(88) 99999-0002',
    email: `ie${seq}@clientes02.test`,
    cep: '63010-000',
    rua: 'RUA DAS FLORES',
    numero: '123',
    bairro: 'CENTRO',
    cidade: 'JUAZEIRO DO NORTE',
    uf: 'CE',
    limite_credito: 250,
    tipo_comercial_id: tipoAtacadistaId,
    ...extra
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { id: r.body.id, salvo: await lerCliente(r.body.id) };
}

async function aguardar(condicao, descricao, tentativas = 200) {
  for (let i = 0; i < tentativas; i += 1) {
    if (await condicao()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`tempo esgotado aguardando: ${descricao}`);
}

function gerarCertificadoTeste(cnpj = CNPJ_EMITENTE) {
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
  return { privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey), certPem: forge.pki.certificateToPem(cert) };
}

function retornoSefazAutorizada(loteXml) {
  const chave = (String(loteXml).match(/Id="NFe(\d{44})"/) || [])[1];
  const prot = `<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><verAplic>SVRS</verAplic><chNFe>${chave}</chNFe>` +
    '<dhRecbto>2026-10-05T10:00:00-03:00</dhRecbto><nProt>223260000000099</nProt>' +
    '<digVal>abc=</digVal><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe>';
  return '<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>' +
    '<nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4"><retEnviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">' +
    '<tpAmb>2</tpAmb><verAplic>SVRS</verAplic><cStat>104</cStat><xMotivo>Lote processado</xMotivo>' +
    `<cUF>23</cUF><dhRecbto>2026-10-05T10:00:00-03:00</dhRecbto>${prot}</retEnviNFe></nfeResultMsg></soap:Body></soap:Envelope>`;
}

/** SEFAZ simulada: registra o lote e devolve autorização; nada sai da máquina. */
function loteSimulado() {
  const chamadas = [];
  const fn = async (args) => {
    chamadas.push(args);
    return { success: true, status: 'soap_enviado', raw: retornoSefazAutorizada(args.loteXml) };
  };
  fn.chamadas = chamadas;
  return fn;
}
const depsEmissor = (enviarLote) => ({
  carregarCertificado: () => material,
  inspecionarCertificado: () => ({ cnpj: CNPJ_EMITENTE }),
  enviarLote
});

async function criarVendaDoCliente(clienteId) {
  seq += 1;
  const venda = await run(
    `INSERT INTO vendas (codigo, data_venda, cliente_id, total, desconto, forma_pagamento, status, status_pagamento, valor_fiscal, valor_nao_fiscal)
     VALUES (?, datetime('now','localtime'), ?, 20, 0, 'dinheiro', 'concluida', 'quitada', 20, 0)`,
    [`CLI02-${Date.now()}-${seq}`, clienteId]
  );
  await run(
    `INSERT INTO vendas_itens (venda_id, produto_id, quantidade, preco_unitario, subtotal,
       quantidade_fiscal, quantidade_nao_fiscal, valor_fiscal, valor_nao_fiscal, item_fiscal)
     VALUES (?, ?, 2, 10, 20, 2, 0, 20, 0, 1)`,
    [venda.id, produtoId]
  );
  return venda.id;
}

/** Payload exatamente como o formulário NF-e do ERP monta (montarPayloadEmissaoNfe). */
const payloadFormulario = (extra = {}) => nfeUi.montarPayloadEmissaoNfe({
  tipo: 'CNPJ',
  documento: '11.222.333/0001-81',
  nome: 'CLIENTE CONTRIBUINTE',
  inscricao_estadual: '',
  logradouro: 'RUA DAS FLORES',
  numero: '123',
  bairro: 'CENTRO',
  municipio: 'JUAZEIRO DO NORTE',
  uf: 'CE',
  cep: '63010-000',
  natureza: 'VENDA DE MERCADORIA',
  cfop: '5102',
  ...extra
});

const blocoDest = (xml) => (String(xml).match(/<dest>[\s\S]*?<\/dest>/) || [''])[0];

before(async () => {
  assert.ok(path.resolve(process.env.DB_DIR).startsWith(path.resolve(os.tmpdir())), 'teste deve usar banco temporário');
  await new Promise((resolve, reject) => db.whenReady((err) => (err ? reject(err) : resolve())));
  assert.equal(path.resolve(db.dbPath), path.resolve(DIR, 'mercadao.db'));
  assert.ok(!/MercantilFiscal/i.test(db.dbPath), 'nunca o banco oficial');
  assert.ok(!/CDS Cremolicia/i.test(db.dbPath), 'nunca o banco antigo');
  material = gerarCertificadoTeste();

  const cfg = {
    nome_empresa: 'CREMOLICIA TESTE LTDA',
    cnpj: CNPJ_EMITENTE,
    fiscal_ie: '061234567',
    fiscal_ambiente: '2',
    fiscal_codigo_uf: '23',
    fiscal_uf: 'CE',
    fiscal_uf_sigla: 'CE',
    fiscal_serie: '1',
    fiscal_numero_atual: '10',
    fiscal_serie_nfe: '1',
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

  produtoId = (await run(
    `INSERT INTO produtos (codigo, nome, unidade, preco_venda, ncm, cfop, csosn, origem, ativo)
     VALUES ('SORV-CLI02', 'SORVETE TESTE CLI02', 'UN', 10, '21050010', '5102', '102', '0', 1)`
  )).id;

  tipoConsumidorId = (await get(`SELECT id FROM tipos_comerciais WHERE codigo = 'CONSUMIDOR_FINAL'`)).id;
  tipoAtacadistaId = (await get(`SELECT id FROM tipos_comerciais WHERE codigo = 'ATACADISTA'`)).id;

  const adminId = (await run(`INSERT INTO usuarios (username, password_hash, role) VALUES ('cli02adm', 'x', 'admin')`)).id;
  token = jwt.sign({ id: adminId, username: 'cli02adm', role: 'admin', perfil: 'ADMIN' }, auth.JWT_SECRET);

  const { tiposComerciaisRouter } = require('../../backend/modules/comercial');
  const app = express();
  app.use(express.json());
  app.use('/api/clientes', auth.verificarToken, require('../../backend/rotas/clientes'));
  app.use('/api/tipos-comerciais', auth.verificarToken, tiposComerciaisRouter);
  app.use('/api/vendas', auth.verificarToken, require('../../backend/rotas/vendas'));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  lock.resetLocksForTests();
  if (server) await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => db.close(() => resolve()));
});

// ===========================================================================
// Migration
// ===========================================================================

describe('CLIENTES-02 — migration clientes.inscricao_estadual', () => {
  it('banco novo: coluna inscricao_estadual VARCHAR(20) criada; migration registrada logo após a 020', async () => {
    const col = (await all('PRAGMA table_info(clientes)')).filter((c) => c.name === 'inscricao_estadual');
    assert.equal(col.length, 1);
    assert.equal(col[0].type.toUpperCase(), 'VARCHAR(20)');
    const ids = require('../../backend/modules/comercial/migrations').MIGRATIONS.map((m) => m.id);
    assert.deepEqual(ids.slice(-2), ['020_central_precificacao_rcm83', '021_clientes_inscricao_estadual']);
  });

  it('banco que já tem a coluna (ex.: banco oficial): reexecutar não altera nada e preserva as IEs', async () => {
    const { id } = await criarClienteCompleto({ inscricao_estadual: '123456789' });
    const antes = await all('PRAGMA table_info(clientes)');
    await migration021(db);
    await migration021(db);
    assert.deepEqual(await all('PRAGMA table_info(clientes)'), antes);
    assert.equal(await lerIe(id), '123456789');
  });

  it('banco legado sem a coluna: adiciona uma única vez, sem tocar dados nem outras colunas', async () => {
    const legado = new sqlite3.Database(':memory:');
    const q = (metodo, sql) => new Promise((resolve, reject) => legado[metodo](sql, [], (e, r) => (e ? reject(e) : resolve(r))));
    await q('run', 'CREATE TABLE clientes (id INTEGER PRIMARY KEY, nome TEXT, razao_social TEXT, observacoes TEXT)');
    await q('run', `INSERT INTO clientes (nome, razao_social, observacoes) VALUES ('ANTIGO', 'RAZAO', 'OBS')`);
    await migration021(legado);
    await migration021(legado);
    const cols = await q('all', 'PRAGMA table_info(clientes)');
    assert.deepEqual(cols.map((c) => c.name), ['id', 'nome', 'razao_social', 'observacoes', 'inscricao_estadual']);
    assert.deepEqual(await q('get', 'SELECT nome, razao_social, observacoes, inscricao_estadual FROM clientes'),
      { nome: 'ANTIGO', razao_social: 'RAZAO', observacoes: 'OBS', inscricao_estadual: null });
    await new Promise((resolve) => legado.close(resolve));
  });

  it('sem coluna ind_ie_dest: o indicador é sempre derivado da IE', async () => {
    const nomes = (await all('PRAGMA table_info(clientes)')).map((c) => c.name);
    assert.ok(!nomes.includes('ind_ie_dest'));
  });
});

// ===========================================================================
// API /api/clientes
// ===========================================================================

describe('CLIENTES-02 — API /api/clientes com Inscrição Estadual', () => {
  it('TESTE 01 — POST sem IE grava NULL', async () => {
    const { id } = await criarClienteCompleto();
    assert.equal(await lerIe(id), null);
    const { id: id2 } = await criarClienteCompleto({ inscricao_estadual: '   ' });
    assert.equal(await lerIe(id2), null, 'só espaços também vira NULL');
  });

  it('TESTE 02 — POST com IE 123456789 grava a IE', async () => {
    const { id } = await criarClienteCompleto({ inscricao_estadual: ' 123456789 ' });
    assert.equal(await lerIe(id), '123456789');
  });

  it('TESTE 03 — POST com ISENTO grava ISENTO', async () => {
    const { id } = await criarClienteCompleto({ inscricao_estadual: 'ISENTO' });
    assert.equal(await lerIe(id), 'ISENTO');
  });

  it('TESTE 04 — POST com " isento " grava "ISENTO"', async () => {
    const { id } = await criarClienteCompleto({ inscricao_estadual: ' isento ' });
    assert.equal(await lerIe(id), 'ISENTO');
    const { id: id2 } = await criarClienteCompleto({ inscricao_estadual: 'Isento' });
    assert.equal(await lerIe(id2), 'ISENTO');
  });

  it('TESTE 05 — PUT sem inscricao_estadual preserva a IE existente', async () => {
    const { id, salvo } = await criarClienteCompleto({ inscricao_estadual: '123456789' });
    const r = await api('PUT', `/clientes/${id}`, { nome: 'SÓ O NOME MUDOU' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(await lerCliente(id), { ...salvo, nome: 'SÓ O NOME MUDOU' });
    assert.equal((await api('PUT', `/clientes/${id}`, { inscricao_estadual: undefined, telefone: '(88) 90000-0000' })).status, 200);
    assert.equal(await lerIe(id), '123456789');
  });

  it('TESTE 06 — PUT com inscricao_estadual "" limpa e grava NULL; "isento" e IE normal também pelo PUT', async () => {
    const { id, salvo } = await criarClienteCompleto({ inscricao_estadual: '123456789' });
    assert.equal((await api('PUT', `/clientes/${id}`, { inscricao_estadual: '' })).status, 200);
    assert.deepEqual(await lerCliente(id), { ...salvo, inscricao_estadual: null });
    assert.equal((await api('PUT', `/clientes/${id}`, { inscricao_estadual: ' isento ' })).status, 200);
    assert.equal(await lerIe(id), 'ISENTO');
    assert.equal((await api('PUT', `/clientes/${id}`, { inscricao_estadual: ' 06.123.456-7 ' })).status, 200);
    assert.equal(await lerIe(id), '06.123.456-7');
    assert.equal((await api('PUT', `/clientes/${id}`, { inscricao_estadual: null })).status, 200);
    assert.equal(await lerIe(id), null, 'null explícito também limpa');
  });

  it('IE acima de 20 caracteres: 400 controlado, sem truncar e sem gravar (POST e PUT)', async () => {
    const longa = '1'.repeat(21);
    const antes = (await get('SELECT COUNT(*) n FROM clientes')).n;
    const post = await api('POST', '/clientes', { nome: 'IE LONGA', inscricao_estadual: longa, tipo_comercial_id: tipoConsumidorId });
    assert.equal(post.status, 400);
    assert.match(post.body.error, /no máximo 20/);
    assert.equal((await get('SELECT COUNT(*) n FROM clientes')).n, antes);

    const { id, salvo } = await criarClienteCompleto({ inscricao_estadual: '123456789' });
    const put = await api('PUT', `/clientes/${id}`, { nome: 'NÃO DEVE GRAVAR', inscricao_estadual: longa });
    assert.equal(put.status, 400);
    assert.deepEqual(await lerCliente(id), salvo);

    const { id: id20 } = await criarClienteCompleto({ inscricao_estadual: '9'.repeat(20) });
    assert.equal(await lerIe(id20), '9'.repeat(20), '20 caracteres cabem');
  });

  it('GET /api/clientes e /api/clientes/:id retornam inscricao_estadual', async () => {
    const { id } = await criarClienteCompleto({ inscricao_estadual: '123456789' });
    const um = await api('GET', `/clientes/${id}`);
    assert.equal(um.body.inscricao_estadual, '123456789');
    const lista = await api('GET', '/clientes');
    assert.equal(lista.body.find((c) => c.id === id).inscricao_estadual, '123456789');
  });

  it('GET /api/vendas/:id expõe cliente_inscricao_estadual para o formulário NF-e', async () => {
    const { id } = await criarClienteCompleto({ inscricao_estadual: '123456789' });
    const vendaId = await criarVendaDoCliente(id);
    const r = await api('GET', `/vendas/${vendaId}`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.cliente_inscricao_estadual, '123456789');
  });
});

// ===========================================================================
// Regra única IE → indIEDest
// ===========================================================================

describe('CLIENTES-02 — regra única de indIEDest (inscricaoEstadual.js)', () => {
  it('TESTE 07 — IE normal → indIEDest 1', () => {
    assert.deepEqual(ie.interpretarInscricaoEstadual('123456789'),
      { ie: '123456789', indIEDest: 1, ieXml: '123456789', ieXmlValida: true });
    assert.equal(ie.interpretarInscricaoEstadual('06.123.456-7').ieXml, '061234567', 'pontuação fora do XML');
  });

  it('TESTE 08 — ISENTO (qualquer caixa/espaços) → indIEDest 2, sem IE no XML', () => {
    for (const v of ['ISENTO', ' isento ', 'Isento']) {
      assert.deepEqual(ie.interpretarInscricaoEstadual(v), { ie: 'ISENTO', indIEDest: 2, ieXml: null, ieXmlValida: true });
    }
  });

  it('TESTE 09 — sem IE (null, vazio, espaços) → indIEDest 9, sem IE no XML', () => {
    for (const v of [null, undefined, '', '   ']) {
      assert.deepEqual(ie.interpretarInscricaoEstadual(v), { ie: null, indIEDest: 9, ieXml: null, ieXmlValida: true });
    }
  });

  it('IE fora do leiaute (letras, 1 dígito, > 14 dígitos) é marcada como inválida para o XML', () => {
    for (const v of ['ABC123', '1', '123456789012345', 'IE-123X']) {
      assert.equal(ie.interpretarInscricaoEstadual(v).ieXmlValida, false, v);
    }
    assert.throws(() => ie.assertInscricaoEstadualDestinatarioNfe({}, { dest_inscricao_estadual: 'ABC' }),
      (e) => e.code === 'DEST_IE_INVALIDA');
  });

  it('payload do formulário prevalece sobre o cadastro (mesmo vazio); sem o campo, vale o cadastro', () => {
    const venda = { cliente_inscricao_estadual: '123456789' };
    assert.equal(ie.resolverInscricaoEstadualDestinatario(venda, { dest_inscricao_estadual: '987654321' }).ieXml, '987654321');
    assert.equal(ie.resolverInscricaoEstadualDestinatario(venda, { dest_inscricao_estadual: '' }).indIEDest, 9);
    assert.equal(ie.resolverInscricaoEstadualDestinatario(venda, {}).ieXml, '123456789');
  });

  it('indIEDest não é decidido em nenhum outro ponto (tela, rota, faturamento, emissor, builder)', () => {
    for (const rel of ['backend/rotas/clientes.js', 'frontend/erp/js/nfe.js', 'backend/services/vendas/faturamentoNfeService.js',
      'backend/services/fiscal/nfeEmissorVenda.js', 'frontend/erp/js/clientes.js', 'frontend/pdv/js/clientes.js',
      'frontend/modules/motor-comercial/pages/PerfilComercial/ClienteCadastroView.js']) {
      assert.ok(!/indIEDest\s*[:=]|<indIEDest>[129]/.test(read(rel)), rel);
    }
    const builder = read('backend/services/fiscal/xmlBuilderNfeVenda.js');
    assert.ok(!/<indIEDest>[129]<\/indIEDest>/.test(builder), 'builder sem indIEDest fixo');
    assert.ok(builder.includes('<indIEDest>${destIe.indIEDest}</indIEDest>'));
  });
});

// ===========================================================================
// XML NF-e — grupo <dest>
// ===========================================================================

describe('CLIENTES-02 — XML NF-e (<dest>), sem transmissão', () => {
  let config;
  const itens = () => [{
    produto_id: produtoId, produto_nome: 'SORVETE', quantidade: 2, preco_unitario: 10, subtotal: 20,
    quantidade_fiscal: 2, valor_fiscal: 20, produto_ncm: '21050010', cfop: '5102', csosn: '102', origem: '0', unidade: 'UN'
  }];
  const vendaCom = (ieCadastro) => ({
    id: 1, cliente_nome: 'CLIENTE CONTRIBUINTE', cliente_cpf: CNPJ_CLIENTE, cliente_inscricao_estadual: ieCadastro,
    total: 20, desconto: 0, pagamentos: [{ forma_pagamento: 'dinheiro', valor: 20 }]
  });
  let numero = 9100;
  const gerar = (ieCadastro, dadosNfe) => buildNfeXml({
    config, venda: vendaCom(ieCadastro), itens: itens(), numero: ++numero, dadosNfe
  }).xmlSemAssinatura;

  before(async () => {
    config = { ...(await getFiscalConfig({ validarUrls: false })), ambiente: 2, serieNfe: 1 };
  });

  it('TESTE 10 — cenário A (IE 123456789): <indIEDest>1</indIEDest><IE>123456789</IE>', () => {
    const xml = gerar('123456789', payloadFormulario({ inscricao_estadual: '123456789' }));
    const dest = blocoDest(xml);
    assert.match(dest, /<\/enderDest><indIEDest>1<\/indIEDest><IE>123456789<\/IE><\/dest>$/);
  });

  it('TESTE 11 — cenário B (ISENTO): <indIEDest>2</indIEDest> e nenhum <IE>ISENTO</IE>', () => {
    const xml = gerar('ISENTO', payloadFormulario({ inscricao_estadual: 'ISENTO' }));
    const dest = blocoDest(xml);
    assert.match(dest, /<\/enderDest><indIEDest>2<\/indIEDest><\/dest>$/);
    assert.ok(!/<IE>/.test(dest));
    assert.ok(!xml.includes('<IE>ISENTO</IE>'));
  });

  it('TESTE 12 — cenário C (sem IE): <indIEDest>9</indIEDest> e nenhum <IE> no <dest>', () => {
    const xml = gerar(null, payloadFormulario({ inscricao_estadual: '' }));
    const dest = blocoDest(xml);
    assert.match(dest, /<\/enderDest><indIEDest>9<\/indIEDest><\/dest>$/);
    assert.ok(!/<IE>/.test(dest));
    const legado = gerar(null, {});
    assert.match(blocoDest(legado), /<indIEDest>9<\/indIEDest><\/dest>$/, 'payload antigo sem o campo continua 9');
  });

  it('IE com pontuação vai só com dígitos; idDest, indFinal e <IE> do emitente não mudam', () => {
    const xml = gerar(null, payloadFormulario({ inscricao_estadual: '06.123.456-7' }));
    assert.match(blocoDest(xml), /<indIEDest>1<\/indIEDest><IE>061234567<\/IE><\/dest>$/);
    for (const v of ['123456789', 'ISENTO', '']) {
      const x = gerar(null, payloadFormulario({ inscricao_estadual: v }));
      assert.match(x, /<idDest>1<\/idDest>/);
      assert.match(x, /<indFinal>1<\/indFinal>/);
      assert.match(x, /<emit>[\s\S]*<IE>061234567<\/IE><CRT>/);
    }
  });

  it('IE fora do leiaute no payload: builder recusa com DEST_IE_INVALIDA (não gera XML inválido)', () => {
    assert.throws(() => gerar(null, payloadFormulario({ inscricao_estadual: 'ABC' })), (e) => e.code === 'DEST_IE_INVALIDA');
  });
});

// ===========================================================================
// Formulário NF-e (ERP, JSDOM)
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

function criarJanelaNfe() {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body><div id="page-content"></div><div id="modal-container"></div></body></html>',
    { url: 'http://localhost/erp/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole() }
  );
  const { window } = dom;
  window.localStorage.setItem('token', 'token-teste');
  window.localStorage.setItem('user', JSON.stringify({ role: 'admin', perfil: 'ADMIN' }));
  class ModalStub {
    constructor(el) { this.el = el; el.__modal = this; }
    static getInstance(el) { return el.__modal || null; }
    static getOrCreateInstance(el) { return el.__modal || new ModalStub(el); }
    show() { this.el.classList.add('show'); }
    hide() { this.el.classList.remove('show'); this.el.dispatchEvent(new window.Event('hidden.bs.modal')); }
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
    chamadas.push({ metodo, path: u.pathname, body: opts.body ? JSON.parse(opts.body) : undefined });
    const r = rotas[`${metodo} ${u.pathname}`];
    const status = r ? (r.status || 200) : 404;
    const texto = JSON.stringify(r ? r.body : { success: false, mensagem: 'rota não simulada' });
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      json: async () => JSON.parse(texto),
      text: async () => texto
    };
  };
  return { window, rotas, chamadas };
}

const vendaParaFormulario = (extra = {}) => ({
  id: 7,
  codigo: 'V0007',
  status: 'concluida',
  total: 20,
  cliente_id: 3,
  cliente_nome: 'CLIENTE CONTRIBUINTE',
  cliente_cpf: '11.222.333/0001-81',
  cliente_inscricao_estadual: '123456789',
  cliente_rua: 'RUA DAS FLORES',
  cliente_numero: '123',
  cliente_bairro: 'CENTRO',
  cliente_cidade: 'JUAZEIRO DO NORTE',
  cliente_uf: 'CE',
  cliente_cep: '63010-000',
  itens: [],
  nfe: { nota: null, possui_parcela_fiscal: true, em_andamento: false, pode_emitir: true, motivo_bloqueio: null, acao: 'emitir' },
  ...extra
});

describe('CLIENTES-02 — formulário NF-e', () => {
  it('TESTE 13 — formulário pré-preenche a IE do cliente (venda, pedido e emissão manual)', async () => {
    const ctx = criarJanelaNfe();
    ctx.rotas['GET /api/vendas/7'] = { body: vendaParaFormulario() };
    await ctx.window.abrirEmissaoNfe(7);
    const campo = ctx.window.document.getElementById('nfeDestIe');
    assert.ok(campo, 'campo Inscrição Estadual no formulário');
    assert.equal(campo.value, '123456789');
    ctx.window.close();

    const ctx2 = criarJanelaNfe();
    const virtualCliente = ctx2.window.nfeVendaVirtualDoCliente({ nome: 'Y', inscricao_estadual: '987' });
    assert.equal(virtualCliente.cliente_inscricao_estadual, '987', 'cliente da emissão manual');
    const virtualDoPedido = ctx2.window.nfeVendaVirtualDoCliente({ cliente_nome: 'Z', cliente_inscricao_estadual: 'ISENTO' });
    assert.equal(ctx2.window.dadosIniciaisEmissaoNfe(virtualDoPedido).inscricao_estadual, 'ISENTO', 'pedido');
    ctx2.window.close();
  });

  it('TESTE 14 (tela) — IE alterada só no formulário vai no payload e nenhuma chamada altera o cliente', async () => {
    const ctx = criarJanelaNfe();
    ctx.rotas['GET /api/vendas/7'] = { body: vendaParaFormulario() };
    ctx.rotas['POST /api/nfe/vendas/7/emitir'] = { status: 422, body: { success: false, status: 'erro_validacao', message: 'simulado' } };
    await ctx.window.abrirEmissaoNfe(7);
    ctx.window.document.getElementById('nfeDestIe').value = '987654321';
    await ctx.window.confirmarEmissaoNfe();
    const envio = ctx.chamadas.find((c) => c.metodo === 'POST' && c.path === '/api/nfe/vendas/7/emitir');
    assert.ok(envio, 'emissão enviada');
    assert.equal(envio.body.dest_inscricao_estadual, '987654321');
    assert.ok(!('destinatarioFiscal' in envio.body), 'sem objeto destinatarioFiscal');
    assert.ok(!ctx.chamadas.some((c) => c.path.startsWith('/api/clientes')), 'nenhuma chamada a /api/clientes');
    ctx.window.close();
  });

  it('payload sempre leva dest_inscricao_estadual (vazio quando não há IE), junto dos dest_* existentes', () => {
    const p = payloadFormulario();
    assert.equal(p.dest_inscricao_estadual, '');
    for (const k of ['dest_nome', 'dest_logradouro', 'dest_numero', 'dest_bairro', 'dest_municipio', 'dest_uf', 'dest_cep', 'dest_cnpj']) {
      assert.ok(k in p, k);
    }
    assert.equal(payloadFormulario({ inscricao_estadual: ' isento ' }).dest_inscricao_estadual, 'isento');
  });
});

// ===========================================================================
// Emissão ponta a ponta (SEFAZ simulada)
// ===========================================================================

describe('CLIENTES-02 — cliente → payload → emissor → XML (SEFAZ simulada)', () => {
  it('TESTE 14 — cadastro 123456789, formulário 987654321: emissão usa 987654321 e o cadastro continua 123456789', async () => {
    const { id } = await criarClienteCompleto({ cpf_cnpj: '11.222.333/0001-81', inscricao_estadual: '123456789' });
    const vendaId = await criarVendaDoCliente(id);
    const enviar = loteSimulado();
    const out = await emissor.emitirNfePorVendaId(vendaId, {
      deps: depsEmissor(enviar),
      dadosNfe: payloadFormulario({ inscricao_estadual: '987654321' })
    });
    assert.equal(out.status, 'autorizada', out.message);
    assert.equal(enviar.chamadas.length, 1);
    const dest = blocoDest(enviar.chamadas[0].loteXml);
    assert.match(dest, /<indIEDest>1<\/indIEDest><IE>987654321<\/IE><\/dest>/);
    assert.equal(await lerIe(id), '123456789', 'cadastro do cliente intacto');
  });

  it('sem dest_inscricao_estadual no payload (chamada antiga), o emissor usa a IE do cadastro', async () => {
    const { id } = await criarClienteCompleto({ inscricao_estadual: '123456789' });
    const vendaId = await criarVendaDoCliente(id);
    const enviar = loteSimulado();
    const dadosNfe = payloadFormulario();
    delete dadosNfe.dest_inscricao_estadual;
    const out = await emissor.emitirNfePorVendaId(vendaId, { deps: depsEmissor(enviar), dadosNfe });
    assert.equal(out.status, 'autorizada', out.message);
    assert.match(blocoDest(enviar.chamadas[0].loteXml), /<indIEDest>1<\/indIEDest><IE>123456789<\/IE><\/dest>/);
  });

  it('cliente ISENTO e cliente sem IE chegam ao XML como 2 e 9, sem <IE>', async () => {
    for (const [ieCadastro, esperado] of [['ISENTO', '2'], [null, '9']]) {
      const { id } = await criarClienteCompleto({ inscricao_estadual: ieCadastro });
      const vendaId = await criarVendaDoCliente(id);
      const enviar = loteSimulado();
      const dadosNfe = payloadFormulario({ inscricao_estadual: ieCadastro || '' });
      const out = await emissor.emitirNfePorVendaId(vendaId, { deps: depsEmissor(enviar), dadosNfe });
      assert.equal(out.status, 'autorizada', out.message);
      const dest = blocoDest(enviar.chamadas[0].loteXml);
      assert.match(dest, new RegExp(`<indIEDest>${esperado}</indIEDest></dest>`));
      assert.ok(!/<IE>/.test(dest));
    }
  });

  it('IE inválida no formulário: recusada antes de reservar número; nada é enviado nem gravado', async () => {
    const { id } = await criarClienteCompleto({ inscricao_estadual: '123456789' });
    const vendaId = await criarVendaDoCliente(id);
    await numeracao.garantirTabelaNumeracaoFiscal();
    const antes = await all('SELECT empresa_cnpj, ambiente, serie, proximo_numero FROM fiscal_numeracao WHERE modelo = ? ORDER BY serie', ['55']);
    const enviar = loteSimulado();
    const out = await emissor.emitirNfePorVendaId(vendaId, {
      deps: depsEmissor(enviar),
      dadosNfe: payloadFormulario({ inscricao_estadual: 'IE-ERRADA' })
    });
    assert.equal(out.status, 'erro_validacao');
    assert.equal(out.codigo, 'DEST_IE_INVALIDA');
    assert.equal(enviar.chamadas.length, 0);
    assert.deepEqual(await all('SELECT empresa_cnpj, ambiente, serie, proximo_numero FROM fiscal_numeracao WHERE modelo = ? ORDER BY serie', ['55']), antes);
    assert.equal((await all('SELECT id FROM nfe_notas WHERE venda_id = ?', [vendaId])).length, 0);
  });

  it('faturamento (pedido/manual) recusa IE inválida antes de criar a venda e aceita IE, ISENTO e vazio', () => {
    assert.throws(() => validarDadosNfeConfirmacao(payloadFormulario({ inscricao_estadual: 'XYZ' })),
      (e) => e.code === 'DEST_IE_INVALIDA' && e.statusCode === 400);
    for (const v of ['123456789', 'ISENTO', '']) {
      assert.doesNotThrow(() => validarDadosNfeConfirmacao(payloadFormulario({ inscricao_estadual: v })));
    }
  });
});

// ===========================================================================
// Telas de cliente: Comercial › Clientes, Cadastros (ERP), PDV e Mobile
// ===========================================================================

describe('CLIENTES-02 — Comercial › Clientes (ClienteCadastroView)', () => {
  let dom;
  let ClienteCadastroView;
  let chamadasFetch;
  const globaisOriginais = {};
  const GLOBAIS = ['window', 'document', 'localStorage', 'sessionStorage', 'HTMLElement', 'Node', 'Event',
    'CustomEvent', 'KeyboardEvent', 'MouseEvent', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle'];
  const fetchNode = globalThis.fetch;

  before(() => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      url: 'http://localhost/erp/', pretendToBeVisual: true, virtualConsole: new VirtualConsole()
    });
    for (const nome of GLOBAIS) {
      globaisOriginais[nome] = Object.getOwnPropertyDescriptor(globalThis, nome);
      const valor = typeof dom.window[nome] === 'function' && /^[a-z]/.test(nome)
        ? dom.window[nome].bind(dom.window)
        : dom.window[nome];
      Object.defineProperty(globalThis, nome, { value: valor, configurable: true, writable: true });
    }
    dom.window.API_URL = base;
    dom.window.localStorage.setItem('token', token);
    dom.window.showNotification = () => {};
    chamadasFetch = [];
    globalThis.fetch = (url, opts = {}) => {
      chamadasFetch.push({ url: String(url), metodo: String(opts.method || 'GET').toUpperCase(), body: opts.body ? JSON.parse(opts.body) : undefined });
      return fetchNode(url, opts);
    };
    ClienteCadastroView = require('../../frontend/modules/motor-comercial/pages/PerfilComercial/ClienteCadastroView');
  });

  after(() => {
    globalThis.fetch = fetchNode;
    for (const nome of GLOBAIS) {
      if (globaisOriginais[nome]) Object.defineProperty(globalThis, nome, globaisOriginais[nome]);
      else delete globalThis[nome];
    }
    dom.window.close();
  });

  const apiStub = () => ({
    listarPerfis: async () => ({ items: [{ id: 21, perfilTipo: 'CONSIGNADO', limiteComercial: 0 }] }),
    atualizarPerfil: async () => ({}),
    alterarLimite: async () => ({}),
    criarPerfil: async () => ({ id: 999 })
  });
  async function abrirEdicao(clienteId) {
    document.body.innerHTML = '';
    const view = new ClienteCadastroView({ isEdit: true, clienteId, api: apiStub() });
    document.body.appendChild(view.render());
    await aguardar(() => view._cadastroCarregado, 'cliente carregado na tela');
    return view;
  }
  const valorCampo = (name) => document.querySelector(`[name="${name}"]`)?.value;
  function digitar(name, valor) {
    const input = document.querySelector(`[name="${name}"]`);
    assert.ok(input, `campo ${name} existe na tela`);
    input.value = valor;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  }

  it('campo Inscrição Estadual carrega a IE; editar outro campo preserva a IE', async () => {
    const { id, salvo } = await criarClienteCompleto({ inscricao_estadual: '123456789' });
    const view = await abrirEdicao(id);
    assert.equal(valorCampo('inscricao_estadual'), '123456789');
    digitar('telefone', '(88) 95555-4444');
    await view._salvar();
    assert.deepEqual(await lerCliente(id), { ...salvo, telefone: '(88) 95555-4444' });
    const reaberta = await abrirEdicao(id);
    assert.equal(valorCampo('inscricao_estadual'), '123456789');
    digitar('inscricao_estadual', ' isento ');
    await reaberta._salvar();
    assert.equal(await lerIe(id), 'ISENTO');
  });

  it('novo cliente pelo Comercial grava a IE informada', async () => {
    document.body.innerHTML = '';
    sessionStorage.clear();
    let salvoId = null;
    const view = new ClienteCadastroView({ isEdit: false, api: apiStub(), onSalvo: (novo) => { salvoId = novo; } });
    document.body.appendChild(view.render());
    await new Promise((r) => setTimeout(r, 20));
    digitar('nome', 'NOVO COM IE NO COMERCIAL');
    digitar('cpf_cnpj', cpfUnico().formatado);
    digitar('inscricao_estadual', '123456789');
    document.querySelector('[data-cap-key="consignacao"] [data-role="cap-check"] input').checked = true;
    await view._salvar();
    assert.ok(salvoId, 'cliente criado');
    assert.equal(await lerIe(salvoId), '123456789');
  });

  it('bundle do Motor Comercial contém o campo Inscrição Estadual', () => {
    const bundle = read('frontend/modules/motor-comercial/motor-comercial.bundle.js');
    assert.ok(bundle.includes('name: "inscricao_estadual"'));
    assert.ok(bundle.includes('inscricao_estadual: this._getFieldValue("inscricao_estadual")'));
  });
});

function extrairFuncao(fonte, nome) {
  const m = fonte.match(new RegExp(`function ${nome}\\([\\s\\S]*?\\r?\\n}\\r?\\n`));
  assert.ok(m, `função ${nome} encontrada`);
  return m[0];
}

function criarJanelaModal(scriptRel) {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body><div id="page-content"></div><div id="modal-container"></div></body></html>',
    { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole() }
  );
  const { window } = dom;
  window.eval(read('frontend/vendor/jquery/jquery.min.js'));
  const core = read('frontend/shared/js/core.js');
  for (const nome of ['formatarCPF', 'formatarCNPJ', 'formatarCpfCnpj', 'formatCpfCnpjInput']) {
    window.eval(extrairFuncao(core, nome));
  }
  window.eval(`var API_URL = ${JSON.stringify(base)};`);
  window.$.fn.modal = function modal() { return this; };
  const notificacoes = [];
  window.showNotification = (msg, tipo) => notificacoes.push({ msg, tipo });
  const pendentes = new Set();
  const erros = [];
  const chamadas = [];
  window.$.ajax = (opts) => {
    const metodo = String(opts.method || opts.type || 'GET').toUpperCase();
    chamadas.push({ metodo, url: opts.url, body: opts.data ? JSON.parse(opts.data) : undefined });
    const p = (async () => {
      const r = await fetch(opts.url, {
        method: metodo,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: opts.data
      });
      const texto = await r.text();
      let json = null;
      try { json = JSON.parse(texto); } catch (_) { /* corpo não JSON */ }
      if (r.ok) opts.success?.(json);
      else opts.error?.({ status: r.status, responseJSON: json });
    })().catch((err) => erros.push(err));
    pendentes.add(p);
    p.finally(() => pendentes.delete(p));
    return p;
  };
  window.eval(read(scriptRel));
  window.loadClientes = () => {};
  return {
    window,
    notificacoes,
    chamadas,
    async aguardarAjax() {
      while (pendentes.size) await Promise.all([...pendentes]);
      assert.deepEqual(erros, [], 'callbacks das telas sem erro');
    },
    valor: (id) => window.document.getElementById(id)?.value,
    preencher(campos) {
      for (const [id, v] of Object.entries(campos)) {
        const el = window.document.getElementById(id);
        assert.ok(el, `campo #${id} existe no modal`);
        el.value = v;
      }
    }
  };
}

describe('CLIENTES-02 — Cadastros › Clientes (modal ERP)', () => {
  let tela;
  before(() => { tela = criarJanelaModal('frontend/erp/js/clientes.js'); });
  after(() => tela.window.close());

  it('cria com IE; reabre com a IE; editar outro campo preserva a IE', async () => {
    tela.window.showClienteModal(null);
    await tela.aguardarAjax();
    const cpf = cpfUnico();
    tela.preencher({
      nome: 'CLIENTE IE VIA CADASTROS', cpf_cnpj: cpf.formatado, inscricao_estadual: '123456789', telefone: '(88) 3521-2000',
      email: '', cep: '63040-000', rua: 'RUA DO ERP', numero: '88', bairro: 'SALESIANOS', cidade: 'JUAZEIRO DO NORTE', uf: 'CE',
      limite_credito: '0', tipo_comercial_id: String(tipoAtacadistaId)
    });
    tela.window.saveCliente();
    await tela.aguardarAjax();
    const { id } = await get(`SELECT id FROM clientes WHERE nome = 'CLIENTE IE VIA CADASTROS'`);
    const salvo = await lerCliente(id);
    assert.equal(salvo.inscricao_estadual, '123456789');
    assert.equal(salvo.cpf_cnpj, cpf.digitos);

    tela.window.editCliente(id);
    await tela.aguardarAjax();
    assert.equal(tela.valor('inscricao_estadual'), '123456789', 'IE reaberta no modal');
    tela.preencher({ telefone: '(88) 91111-2222' });
    tela.window.saveCliente();
    await tela.aguardarAjax();
    assert.deepEqual(await lerCliente(id), { ...salvo, telefone: '(88) 91111-2222' });
  });

  it('limpar a IE no modal grava NULL', async () => {
    const { id } = await criarClienteCompleto({ inscricao_estadual: '123456789' });
    tela.window.editCliente(id);
    await tela.aguardarAjax();
    tela.preencher({ inscricao_estadual: '' });
    tela.window.saveCliente();
    await tela.aguardarAjax();
    assert.equal(await lerIe(id), null);
  });
});

describe('CLIENTES-02 — PDV (modal de clientes)', () => {
  let tela;
  before(() => { tela = criarJanelaModal('frontend/pdv/js/clientes.js'); });
  after(() => tela.window.close());

  it('IE não é obrigatória no PDV; editar o nome preserva a IE; IE editável', async () => {
    tela.window.showClienteModal(null);
    tela.preencher({ nome: 'CLIENTE PDV SEM IE', cpf_cnpj: '', limite_credito: '0' });
    tela.window.saveCliente();
    await tela.aguardarAjax();
    const semIe = await get(`SELECT id, inscricao_estadual FROM clientes WHERE nome = 'CLIENTE PDV SEM IE'`);
    assert.ok(semIe, 'cliente criado sem IE');
    assert.equal(semIe.inscricao_estadual, null);

    const { id, salvo } = await criarClienteCompleto({ inscricao_estadual: 'ISENTO' });
    tela.window.editCliente(id);
    await tela.aguardarAjax();
    assert.equal(tela.valor('inscricao_estadual'), 'ISENTO');
    tela.preencher({ nome: 'EDITADO NO PDV COM IE' });
    tela.window.saveCliente();
    await tela.aguardarAjax();
    assert.deepEqual(await lerCliente(id), { ...salvo, nome: 'EDITADO NO PDV COM IE' });

    tela.window.editCliente(id);
    await tela.aguardarAjax();
    tela.preencher({ inscricao_estadual: '123456789' });
    tela.window.saveCliente();
    await tela.aguardarAjax();
    assert.equal(await lerIe(id), '123456789');
  });
});

describe('CLIENTES-02 — Mobile (Cadastros › Clientes e Comercial › Cliente Consignado)', () => {
  let dom;
  let clientesMobile;
  let comercialClientes;
  const globaisOriginais = {};
  const GLOBAIS = ['window', 'document', 'localStorage', 'sessionStorage', 'HTMLElement', 'Node', 'Event',
    'CustomEvent', 'FormData', 'requestAnimationFrame', 'getComputedStyle'];
  const chamadasApi = [];

  before(async () => {
    dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', {
      url: 'http://localhost/mobile/', pretendToBeVisual: true, virtualConsole: new VirtualConsole()
    });
    for (const nome of GLOBAIS) {
      globaisOriginais[nome] = Object.getOwnPropertyDescriptor(globalThis, nome);
      const valor = typeof dom.window[nome] === 'function' && /^[a-z]/.test(nome)
        ? dom.window[nome].bind(dom.window)
        : dom.window[nome];
      Object.defineProperty(globalThis, nome, { value: valor, configurable: true, writable: true });
    }
    const chamarReal = async (metodo, rota, body) => {
      const r = await api(metodo, `/${rota}`, body);
      if (r.status >= 300) throw Object.assign(new Error(r.body?.message || r.body?.error || `HTTP ${r.status}`), { payload: r.body });
      return r.body;
    };
    dom.window.CDSApi = {
      async get(rota, params) {
        chamadasApi.push({ metodo: 'GET', rota, params });
        if (rota === 'comercial/perfil-comercial') {
          return { data: [{ id: 41, perfilTipo: 'CONSIGNADO', ativo: true, limiteComercial: 100 }] };
        }
        return chamarReal('GET', rota);
      },
      async put(rota, body) {
        chamadasApi.push({ metodo: 'PUT', rota, body });
        if (rota.startsWith('comercial/')) return { success: true };
        return chamarReal('PUT', rota, body);
      },
      async post(rota, body) {
        chamadasApi.push({ metodo: 'POST', rota, body });
        if (rota.startsWith('comercial/')) return { success: true };
        return chamarReal('POST', rota, body);
      },
      async patch(rota, body) {
        chamadasApi.push({ metodo: 'PATCH', rota, body });
        return { success: true };
      }
    };
    clientesMobile = (await import(pathToFileURL(path.join(ROOT, 'frontend/apps/mobile/js/pages/clientes.js')).href)).default;
    comercialClientes = (await import(pathToFileURL(path.join(ROOT, 'frontend/apps/mobile/js/pages/comercial-clientes.js')).href)).default;
  });

  after(() => {
    for (const nome of GLOBAIS) {
      if (globaisOriginais[nome]) Object.defineProperty(globalThis, nome, globaisOriginais[nome]);
      else delete globalThis[nome];
    }
    dom.window.close();
  });

  it('Cadastros › Clientes: payload leva a IE; formulário exibe o campo', async () => {
    const { id, salvo } = await criarClienteCompleto({ inscricao_estadual: '123456789' });
    const payload = clientesMobile.buildClientePayload({ ...salvo, nome: 'EDITADO NO MOBILE', limite_credito: String(salvo.limite_credito) });
    assert.equal(payload.inscricao_estadual, '123456789');
    assert.equal((await api('PUT', `/clientes/${id}`, payload)).status, 200);
    assert.deepEqual(await lerCliente(id), { ...salvo, nome: 'EDITADO NO MOBILE' });
    assert.equal(clientesMobile.buildClientePayload({ nome: 'X', inscricao_estadual: ' isento ' }).inscricao_estadual, 'isento');
    assert.match(read('frontend/apps/mobile/js/pages/clientes.js'), /name: 'inscricao_estadual', label: 'Inscrição Estadual'/);
  });

  it('Comercial › Cliente Consignado: carrega a IE, editar o nome preserva a IE, editar a IE grava', async () => {
    const { id, salvo } = await criarClienteCompleto({ inscricao_estadual: '123456789' });
    const root = document.getElementById('app');
    await comercialClientes.renderForm(root, id);
    let form = root.querySelector('#cc-form');
    assert.equal(form.querySelector('[name="inscricao_estadual"]').value, '123456789');
    form.querySelector('[name="nome"]').value = 'EDITADO NO MOBILE COMERCIAL IE';
    let antes = chamadasApi.length;
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await aguardar(() => chamadasApi.slice(antes).some((c) => c.metodo === 'PATCH'), 'perfil atualizado após salvar cliente');
    assert.deepEqual(await lerCliente(id), { ...salvo, nome: 'EDITADO NO MOBILE COMERCIAL IE' });

    await comercialClientes.renderForm(root, id);
    form = root.querySelector('#cc-form');
    form.querySelector('[name="inscricao_estadual"]').value = 'ISENTO';
    antes = chamadasApi.length;
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await aguardar(() => chamadasApi.slice(antes).some((c) => c.metodo === 'PATCH'), 'perfil atualizado após salvar cliente');
    assert.equal(await lerIe(id), 'ISENTO');
  });
});

// ===========================================================================
// TESTE 15 — regressão CLIENTES-01 com IE
// ===========================================================================

describe('CLIENTES-02 — TESTE 15: regressão CLIENTES-01', () => {
  it('Número, Bairro, Tipo Comercial, CPF/CNPJ, limite e endereço preservados ao editar só a IE ou só o nome', async () => {
    const { id, salvo } = await criarClienteCompleto({ limite_credito: 333, inscricao_estadual: '123456789' });
    assert.equal(salvo.numero, '123');
    assert.equal(salvo.bairro, 'CENTRO');
    assert.equal(salvo.tipo_comercial_id, tipoAtacadistaId);

    assert.equal((await api('PUT', `/clientes/${id}`, { inscricao_estadual: '987654321' })).status, 200);
    assert.deepEqual(await lerCliente(id), { ...salvo, inscricao_estadual: '987654321' });

    assert.equal((await api('PUT', `/clientes/${id}`, { nome: 'SÓ NOME 15' })).status, 200);
    assert.deepEqual(await lerCliente(id), { ...salvo, inscricao_estadual: '987654321', nome: 'SÓ NOME 15' });

    const endereco = { cep: '63100-000', rua: 'AV. PADRE CÍCERO', numero: '45A', bairro: 'TRIÂNGULO', cidade: 'CRATO', uf: 'CE' };
    assert.equal((await api('PUT', `/clientes/${id}`, endereco)).status, 200);
    assert.deepEqual(await lerCliente(id), { ...salvo, inscricao_estadual: '987654321', nome: 'SÓ NOME 15', ...endereco });
  });

  it('CPF/CNPJ continua normalizado e duplicidade continua 409 sem alterar a IE', async () => {
    const a = await criarClienteCompleto({ inscricao_estadual: '111111111' });
    const b = await criarClienteCompleto({ inscricao_estadual: '222222222' });
    const r = await api('PUT', `/clientes/${b.id}`, { cpf_cnpj: a.salvo.cpf_cnpj, inscricao_estadual: '333333333' });
    assert.equal(r.status, 409);
    assert.deepEqual(await lerCliente(b.id), b.salvo);
  });
});

// ===========================================================================
// Escopo
// ===========================================================================

describe('CLIENTES-02 — escopo', () => {
  it('NFC-e (xmlBuilder.js) e idDest/indFinal da NF-e não foram alterados', () => {
    const nfce = read('backend/services/fiscal/xmlBuilder.js');
    assert.ok(!nfce.includes('inscricaoEstadual'), 'builder NFC-e não usa a regra de IE');
    assert.ok(nfce.includes('<indIEDest>9</indIEDest>'), 'NFC-e mantém indIEDest 9');
    const nfe = read('backend/services/fiscal/xmlBuilderNfeVenda.js');
    assert.ok(nfe.includes('<idDest>1</idDest>'));
    assert.ok(nfe.includes('<indFinal>1</indFinal>'));
  });

  it('nenhum endpoint novo em /api/clientes e nenhum endpoint para alterar cliente a partir da NF-e', () => {
    const rotas = read('backend/rotas/clientes.js').match(/router\.(get|post|put|delete|patch)\('[^']*'/g) || [];
    assert.deepEqual(rotas, [
      "router.get('/'", "router.get('/buscar'", "router.get('/:id/vendas'", "router.get('/:id'",
      "router.post('/'", "router.put('/:id'", "router.delete('/:id'"
    ]);
    const escritaNfe = read('backend/rotas/nfe.js').match(/router\.(post|put|patch)\('[^']*'/g) || [];
    assert.ok(escritaNfe.length > 0);
    assert.ok(escritaNfe.every((r) => !/clientes/.test(r)), escritaNfe.join(', '));
    assert.ok(!/UPDATE\s+clientes/i.test(read('backend/services/fiscal/nfeEmissorVenda.js')));
    assert.ok(!/UPDATE\s+clientes/i.test(read('backend/services/vendas/faturamentoNfeService.js')));
  });
});
