/**
 * NF-E-03 — Interface operacional NF-e (ERP).
 *
 * Backend: banco isolado em %TEMP%, SEFAZ simulada por injeção de dependência.
 * Frontend: scripts reais do ERP carregados em JSDOM com fetch/bootstrap simulados.
 * Nenhuma transmissão real e nenhum acesso ao banco ativo.
 */

'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');

const DIR = path.join(os.tmpdir(), 'cds-nfe-testes', 'interface-03');
fs.mkdirSync(path.join(DIR, 'fiscal'), { recursive: true });
fs.mkdirSync(path.join(DIR, 'config'), { recursive: true });
for (const f of ['mercadao.db', 'mercadao.db-wal', 'mercadao.db-shm', 'mercadao.db-journal']) {
  fs.rmSync(path.join(DIR, f), { force: true });
}
process.env.DB_DIR = DIR;
process.env.FISCAL_DIR = path.join(DIR, 'fiscal');
const CONFIG_IMPLANTACAO = path.join(DIR, 'config', 'configuracoes.json');
const escreverImplantacao = (tipo) => fs.writeFileSync(
  CONFIG_IMPLANTACAO,
  JSON.stringify({ tipoImplantacao: tipo, modoOperacao: 'LOCAL', ipServidor: '', porta: 3002 }),
  'utf8'
);
escreverImplantacao('ERP_FISCAL');

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
const auth = require('../../backend/middleware/auth');
const configService = require('../../backend/services/configuracaoService');
const emissor = require(path.join(FISCAL, 'nfeEmissorVenda'));
const numeracao = require(path.join(FISCAL, 'numeracaoFiscalService'));
const lock = require(path.join(FISCAL, 'nfeEmissionLockService'));
const { buildNfeXml } = require(path.join(FISCAL, 'xmlBuilderNfeVenda'));
const { getFiscalConfig } = require(path.join(FISCAL, 'configService'));
const { resolverNomeDestinatarioNfe } = require(path.join(FISCAL, 'nfeRetornoAutorizacao'));
const nfeUi = require('../../frontend/erp/js/nfe.js');

const CNPJ = '36811652000153';
const CPF_VALIDO = '52998224725';
const CNPJ_VALIDO = '11222333000181';

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

function retornoSefaz(loteXml, { cStat = '100', xMotivo = 'Autorizado o uso da NF-e' } = {}) {
  const chave = chaveDoLote(loteXml);
  const prot = `<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><verAplic>SVRS</verAplic><chNFe>${chave}</chNFe>` +
    `<dhRecbto>2026-10-04T10:00:00-03:00</dhRecbto>${cStat === '100' ? '<nProt>223260000000003</nProt>' : ''}` +
    `<digVal>abc=</digVal><cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo></infProt></protNFe>`;
  return `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>` +
    `<nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4"><retEnviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">` +
    `<tpAmb>2</tpAmb><verAplic>SVRS</verAplic><cStat>104</cStat><xMotivo>Lote processado</xMotivo>` +
    `<cUF>23</cUF><dhRecbto>2026-10-04T10:00:00-03:00</dhRecbto>${prot}</retEnviNFe></nfeResultMsg></soap:Body></soap:Envelope>`;
}

let material;
let produtoId;
let clienteId;
let seqVenda = 0;

function loteSimulado(opcoes = {}) {
  const chamadas = [];
  const fn = async (args) => {
    chamadas.push(args);
    return { success: true, status: 'soap_enviado', raw: retornoSefaz(args.loteXml, opcoes) };
  };
  fn.chamadas = chamadas;
  return fn;
}

function deps(enviarLote) {
  return {
    carregarCertificado: () => material,
    inspecionarCertificado: () => ({ cnpj: CNPJ }),
    enviarLote
  };
}

async function criarVenda({ status = 'concluida', fiscal = true } = {}) {
  seqVenda += 1;
  const venda = await run(
    `INSERT INTO vendas (codigo, data_venda, cliente_id, total, desconto, forma_pagamento, status, status_pagamento, valor_fiscal, valor_nao_fiscal)
     VALUES (?, datetime('now','localtime'), ?, 20, 0, 'dinheiro', ?, 'quitada', ?, ?)`,
    [`NFE03-${Date.now()}-${seqVenda}`, clienteId, status, fiscal ? 20 : 0, fiscal ? 0 : 20]
  );
  await run(
    `INSERT INTO vendas_itens (venda_id, produto_id, quantidade, preco_unitario, subtotal,
       quantidade_fiscal, quantidade_nao_fiscal, valor_fiscal, valor_nao_fiscal, item_fiscal)
     VALUES (?, ?, 2, 10, 20, ?, ?, ?, ?, ?)`,
    [venda.id, produtoId, fiscal ? 2 : 0, fiscal ? 0 : 2, fiscal ? 20 : 0, fiscal ? 0 : 20, fiscal ? 1 : 0]
  );
  return venda.id;
}

async function garantirColunasNota() {
  await emissor.garantirTabelaNfeNotas();
  for (const def of ['cstat_consulta TEXT', 'xmotivo_consulta TEXT', 'erro_mensagem TEXT', 'erro_sugestao TEXT']) {
    await run(`ALTER TABLE nfe_notas ADD COLUMN ${def}`).catch(() => null);
  }
}

async function inserirNota(vendaId, campos) {
  await garantirColunasNota();
  const dados = { venda_id: vendaId, ambiente: 2, serie: 1, ...campos };
  const cols = Object.keys(dados);
  const out = await run(
    `INSERT INTO nfe_notas (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    cols.map((c) => dados[c])
  );
  return out.id;
}

const payloadValido = (extra = {}) => nfeUi.montarPayloadEmissaoNfe({
  tipo: 'CPF',
  documento: '529.982.247-25',
  nome: 'CLIENTE CORRIGIDO NA EMISSAO',
  logradouro: 'AV BEIRA MAR',
  numero: '500',
  complemento: 'APTO 12',
  bairro: 'MEIRELES',
  municipio: 'Fortaleza',
  uf: 'CE',
  cep: '60165-121',
  natureza: 'VENDA DE MERCADORIA',
  cfop: '5102',
  ...extra
});

let server;
let base;
let tokenSemPermissao;
let tokenEmitir;
let tokenCancelar;

before(async () => {
  assert.ok(path.resolve(process.env.DB_DIR).startsWith(path.resolve(os.tmpdir())), 'teste deve usar banco temporário');
  await new Promise((resolve, reject) => db.whenReady((err) => (err ? reject(err) : resolve())));
  assert.equal(path.resolve(db.dbPath), path.resolve(DIR, 'mercadao.db'));
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
     VALUES ('SORV-03', 'SORVETE TESTE 03', 'UN', 10, '21050010', '5102', '102', '0', 1)`
  )).id;
  clienteId = (await run(
    `INSERT INTO clientes (nome, cpf_cnpj, rua, numero, bairro, cidade, uf, cep)
     VALUES ('CLIENTE TESTE NFE03', '529.982.247-25', 'RUA CLIENTE', '10', 'BAIRRO', 'JUAZEIRO DO NORTE', 'CE', '63000-000')`
  )).id;

  const criarUsuario = async (username) => (await run(
    `INSERT INTO usuarios (username, password_hash, role) VALUES (?, 'x', 'operador')`, [username]
  )).id;
  const semPermissao = await criarUsuario('nfe03-sem');
  const emitir = await criarUsuario('nfe03-emitir');
  const cancelar = await criarUsuario('nfe03-cancelar');
  await run(`INSERT INTO usuario_permissoes (usuario_id, permissao, permitido) VALUES (?, 'NF-E-EMITIR', 1)`, [emitir]);
  await run(`INSERT INTO usuario_permissoes (usuario_id, permissao, permitido) VALUES (?, 'NF-E-CANCELAR', 1)`, [cancelar]);
  const token = (id, username) => jwt.sign({ id, username, role: 'operador', perfil: 'USUARIO' }, auth.JWT_SECRET);
  tokenSemPermissao = token(semPermissao, 'nfe03-sem');
  tokenEmitir = token(emitir, 'nfe03-emitir');
  tokenCancelar = token(cancelar, 'nfe03-cancelar');

  const app = express();
  app.use(express.json());
  app.use('/api/vendas', require('../../backend/rotas/vendas'));
  app.use('/api/nfe', auth.verificarToken, require('../../backend/rotas/nfe'));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  escreverImplantacao('ERP_FISCAL');
  lock.resetLocksForTests();
  if (server) await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => db.close(() => resolve()));
});

const getJson = async (rota, token = tokenSemPermissao) => {
  const r = await fetch(`${base}${rota}`, { headers: { Authorization: `Bearer ${token}` } });
  const texto = await r.text();
  let json = null;
  try { json = JSON.parse(texto); } catch (_) { json = null; }
  return { status: r.status, json, texto, headers: r.headers };
};
const postJson = async (rota, token, body = {}) => {
  const r = await fetch(`${base}${rota}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  });
  return { status: r.status, json: await r.json().catch(() => null) };
};

// ===========================================================================
// Backend
// ===========================================================================

describe('NF-E-03 — GET /api/vendas/:id com resumo NF-e', () => {
  it('venda concluída com parcela fiscal: elegível para emitir', async () => {
    const vendaId = await criarVenda();
    const { status, json } = await getJson(`/vendas/${vendaId}`);
    assert.equal(status, 200);
    assert.equal(json.status, 'concluida');
    assert.equal(json.nfe.pode_emitir, true);
    assert.equal(json.nfe.acao, 'emitir');
    assert.equal(json.nfe.possui_parcela_fiscal, true);
    assert.equal(json.nfe.nota, null);
    assert.equal(json.cliente_rua, 'RUA CLIENTE');
    assert.equal(json.cliente_cidade, 'JUAZEIRO DO NORTE');
    assert.equal(json.cliente_uf, 'CE');
  });

  it('sem parcela fiscal: não elegível', async () => {
    const vendaId = await criarVenda({ fiscal: false });
    const { json } = await getJson(`/vendas/${vendaId}`);
    assert.equal(json.nfe.pode_emitir, false);
    assert.equal(json.nfe.possui_parcela_fiscal, false);
    assert.equal(json.nfe.motivo_bloqueio, 'Venda sem parcela fiscal.');
  });

  it('venda cancelada: não elegível e o emissor recusa sem consumir número', async () => {
    const vendaId = await criarVenda({ status: 'cancelada' });
    const { json } = await getJson(`/vendas/${vendaId}`);
    assert.equal(json.nfe.pode_emitir, false);
    assert.equal(json.nfe.motivo_bloqueio, 'Venda cancelada.');

    const enviar = loteSimulado();
    const out = await emissor.emitirNfePorVendaId(vendaId, { deps: deps(enviar), dadosNfe: payloadValido() });
    assert.equal(out.status, 'venda_cancelada');
    assert.equal(enviar.chamadas.length, 0);
    assert.equal((await all('SELECT id FROM nfe_notas WHERE venda_id = ?', [vendaId])).length, 0);
  });

  it('NF-e autorizada: resumo sem XML/DANFE e sem botão de emissão', async () => {
    const vendaId = await criarVenda();
    const notaId = await inserirNota(vendaId, {
      numero: 501, status: 'autorizada', chave_acesso: '2'.repeat(44), protocolo: '223260000000501',
      xml_enviado: '<NFe>conteudo</NFe>', xml_retorno: '<protNFe>x</protNFe>', danfe_html: '<html>danfe</html>'
    });
    const { json, texto } = await getJson(`/vendas/${vendaId}`);
    assert.equal(json.nfe.acao, 'autorizada');
    assert.equal(json.nfe.pode_emitir, false);
    assert.deepEqual(
      { id: json.nfe.nota.id, status: json.nfe.nota.status, numero: json.nfe.nota.numero, serie: json.nfe.nota.serie, chave: json.nfe.nota.chave, protocolo: json.nfe.nota.protocolo },
      { id: notaId, status: 'autorizada', numero: 501, serie: 1, chave: '2'.repeat(44), protocolo: '223260000000501' }
    );
    assert.doesNotMatch(texto, /<NFe|<protNFe|danfe_html|xml_enviado|xml_retorno/);
  });

  it('NF-e rejeitada: permite emitir novamente e expõe cStat/xMotivo', async () => {
    const vendaId = await criarVenda();
    await inserirNota(vendaId, {
      numero: 502, status: 'rejeitada', chave_acesso: '3'.repeat(44),
      cstat_consulta: '539', xmotivo_consulta: 'Duplicidade de NF-e', erro_sugestao: 'Verifique a numeração.'
    });
    const { json } = await getJson(`/vendas/${vendaId}`);
    assert.equal(json.nfe.acao, 'emitir_novamente');
    assert.equal(json.nfe.pode_emitir, true);
    assert.equal(json.nfe.nota.cstat, '539');
    assert.equal(json.nfe.nota.xmotivo, 'Duplicidade de NF-e');
    assert.equal(json.nfe.nota.sugestao, 'Verifique a numeração.');
  });

  it('aguardando retorno / transmitindo / erro de transmissão com chave: consultar, nunca emitir', async () => {
    for (const status of ['aguardando_retorno', 'transmitindo', 'erro_transmissao']) {
      const vendaId = await criarVenda();
      await inserirNota(vendaId, { numero: 600, status, chave_acesso: '4'.repeat(44) });
      const { json } = await getJson(`/vendas/${vendaId}`);
      assert.equal(json.nfe.acao, 'consultar', status);
      assert.equal(json.nfe.em_andamento, true, status);
      assert.equal(json.nfe.pode_emitir, false, status);
    }
  });

  it('NF-e cancelada ou denegada: bloqueia nova emissão', async () => {
    for (const status of ['cancelada', 'denegada']) {
      const vendaId = await criarVenda();
      await inserirNota(vendaId, { numero: 700, status, chave_acesso: '5'.repeat(44) });
      const { json } = await getJson(`/vendas/${vendaId}`);
      assert.equal(json.nfe.pode_emitir, false, status);
      assert.equal(json.nfe.nota.status, status);
    }
  });

  it('recurso NF-e desabilitado: resposta da venda não traz NF-e', async () => {
    const vendaId = await criarVenda();
    escreverImplantacao('ERP_SIMPLES');
    try {
      assert.equal(configService.recursoHabilitado('nfe'), false);
      const { json } = await getJson(`/vendas/${vendaId}`);
      assert.equal(json.id, vendaId);
      assert.equal(json.nfe, null);
    } finally {
      escreverImplantacao('ERP_FISCAL');
    }
    assert.equal(configService.recursoHabilitado('nfe'), true);
  });

  it('resumo usa uma única consulta em nfe_notas (sem N+1)', () => {
    const src = read('backend/services/fiscal/nfeEmissorVenda.js');
    const trecho = src.slice(src.indexOf('function listarNotasResumoVenda'), src.indexOf('async function resumoNfeDaVenda'));
    assert.match(trecho, /WHERE venda_id = \? ORDER BY id DESC LIMIT 20/);
    assert.doesNotMatch(trecho, /xml_enviado|xml_retorno|danfe_html/);
  });
});

describe('NF-E-03 — emissão com os dados do modal (SEFAZ simulada)', () => {
  let vendaAutorizada;
  let notaAutorizada;

  it('payload do modal chega ao XML: CPF, complemento e município do destinatário', async () => {
    vendaAutorizada = await criarVenda();
    const enviar = loteSimulado();
    const out = await emissor.emitirNfePorVendaId(vendaAutorizada, { deps: deps(enviar), dadosNfe: payloadValido() });
    assert.equal(out.status, 'autorizada', out.message);
    notaAutorizada = out.notaId;
    const lote = enviar.chamadas[0].loteXml;
    const enderDest = (lote.match(/<enderDest>[\s\S]*?<\/enderDest>/) || [''])[0];
    assert.match(lote, new RegExp(`<dest><CPF>${CPF_VALIDO}</CPF>`));
    assert.match(enderDest, /<xLgr>AV BEIRA MAR<\/xLgr><nro>500<\/nro><xCpl>APTO 12<\/xCpl><xBairro>MEIRELES<\/xBairro>/);
    assert.match(enderDest, /<cMun>2304400<\/cMun><xMun>Fortaleza<\/xMun><UF>CE<\/UF><CEP>60165121<\/CEP>/);
    assert.match(lote, new RegExp(`<xNome>${resolverNomeDestinatarioNfe(2, 'x')}</xNome>`));
  });

  it('a venda permanece CONCLUIDA após a autorização', async () => {
    const venda = await get('SELECT status FROM vendas WHERE id = ?', [vendaAutorizada]);
    assert.equal(venda.status, 'concluida');
  });

  it('cadastro do cliente não é alterado pelos dados da emissão', async () => {
    const cli = await get('SELECT nome, rua, cidade FROM clientes WHERE id = ?', [clienteId]);
    assert.deepEqual(cli, { nome: 'CLIENTE TESTE NFE03', rua: 'RUA CLIENTE', cidade: 'JUAZEIRO DO NORTE' });
  });

  it('nome/razão digitado vira xNome fora da homologação (builder)', async () => {
    const config = { ...(await getFiscalConfig({ validarUrls: false })), ambiente: 1, serieNfe: 1 };
    const venda = { id: 1, cliente_nome: 'NOME DO CADASTRO', cliente_cpf: CPF_VALIDO, total: 20, desconto: 0, pagamentos: [{ forma_pagamento: 'dinheiro', valor: 20 }] };
    const itens = [{ produto_id: produtoId, produto_nome: 'SORVETE', quantidade: 2, preco_unitario: 10, subtotal: 20, quantidade_fiscal: 2, valor_fiscal: 20, produto_ncm: '21050010', cfop: '5102', csosn: '102', origem: '0', unidade: 'UN' }];
    const built = buildNfeXml({ config, venda, itens, numero: 9001, dadosNfe: payloadValido({ nome: 'RAZAO DIGITADA NA EMISSAO' }) });
    assert.match(built.xmlSemAssinatura, /<xNome>RAZAO DIGITADA NA EMISSAO<\/xNome>/);
  });

  it('município inexistente na UF é recusado antes de reservar número', async () => {
    const vendaId = await criarVenda();
    await numeracao.garantirTabelaNumeracaoFiscal();
    const antes = await all('SELECT empresa_cnpj, ambiente, serie, proximo_numero FROM fiscal_numeracao WHERE modelo = ? ORDER BY serie', ['55']);
    const enviar = loteSimulado();
    const out = await emissor.emitirNfePorVendaId(vendaId, {
      deps: deps(enviar),
      dadosNfe: payloadValido({ municipio: 'CIDADE QUE NAO EXISTE' })
    });
    assert.equal(out.status, 'erro_validacao');
    assert.equal(out.codigo, 'DEST_MUNICIPIO_INVALIDO');
    assert.equal(enviar.chamadas.length, 0);
    assert.deepEqual(await all('SELECT empresa_cnpj, ambiente, serie, proximo_numero FROM fiscal_numeracao WHERE modelo = ? ORDER BY serie', ['55']), antes);
    assert.equal((await all('SELECT id FROM nfe_notas WHERE venda_id = ?', [vendaId])).length, 0);
  });

  it('rejeição pela SEFAZ mantém a nota rejeitada e libera nova tentativa', async () => {
    const vendaId = await criarVenda();
    const out = await emissor.emitirNfePorVendaId(vendaId, {
      deps: deps(loteSimulado({ cStat: '225', xMotivo: 'Rejeicao: Falha no Schema XML' })),
      dadosNfe: payloadValido()
    });
    assert.equal(out.status, 'rejeitada');
    assert.equal(out.cStat, '225');
    const notas = await all('SELECT status FROM nfe_notas WHERE venda_id = ?', [vendaId]);
    assert.deepEqual(notas.map((n) => n.status), ['rejeitada']);
    const { json } = await getJson(`/vendas/${vendaId}`);
    assert.equal(json.nfe.acao, 'emitir_novamente');
  });

  describe('endpoints usados pela interface', () => {
    it('GET /nfe/notas lista a nota autorizada com tem_xml/tem_danfe', async () => {
      const { status, json } = await getJson('/nfe/notas?tipo=VENDA&status=autorizada');
      assert.equal(status, 200);
      const nota = json.notas.find((n) => n.id === notaAutorizada);
      assert.ok(nota);
      assert.equal(nota.tem_xml, 1);
      assert.equal(nota.tem_danfe, 1);
      assert.equal(nota.venda_id, vendaAutorizada);
    });

    it('GET /nfe/monitor devolve os contadores usados nos cards', async () => {
      const { json } = await getJson('/nfe/monitor');
      for (const k of ['autorizada', 'rejeitada', 'aguardando_retorno', 'erro_comunicacao', 'pendente_reenvio']) {
        assert.equal(typeof json.contadores[k], 'number', k);
      }
      assert.ok(json.contadores.autorizada >= 1);
      assert.ok(json.contadores.rejeitada >= 1);
    });

    it('GET /nfe/fila devolve itens com fila_estado', async () => {
      const { json } = await getJson('/nfe/fila?limite=200');
      assert.ok(Array.isArray(json.itens));
      const item = json.itens.find((i) => i.id === notaAutorizada);
      assert.equal(item.fila_estado, 'autorizado');
    });

    it('GET /nfe/notas/:id/historico registra a autorização', async () => {
      const { json } = await getJson(`/nfe/notas/${notaAutorizada}/historico`);
      assert.ok(json.eventos.some((e) => e.acao === 'autorizacao'));
    });

    it('GET /nfe/notas/:id/xml?download=1 entrega o XML autorizado como arquivo', async () => {
      const r = await getJson(`/nfe/notas/${notaAutorizada}/xml?download=1`);
      assert.equal(r.status, 200);
      assert.match(r.headers.get('content-disposition'), /attachment; filename="NFe-\d{44}\.xml"/);
      assert.match(r.texto, /<nfeProc|<protNFe/);
    });

    it('GET /nfe/notas/:id/danfe entrega o DANFE HTML existente', async () => {
      const r = await getJson(`/nfe/notas/${notaAutorizada}/danfe`);
      assert.equal(r.status, 200);
      assert.match(r.headers.get('content-type'), /text\/html/);
    });

    it('POST emitir sem NF-E-EMITIR é 403 e não chama o emissor', async () => {
      const original = emissor.emitirNfePorVendaId;
      let chamado = false;
      emissor.emitirNfePorVendaId = async () => { chamado = true; return { success: false }; };
      try {
        const r = await postJson(`/nfe/vendas/${vendaAutorizada}/emitir`, tokenSemPermissao, payloadValido());
        assert.equal(r.status, 403);
        assert.equal(chamado, false);
      } finally {
        emissor.emitirNfePorVendaId = original;
      }
    });

    it('POST emitir com permissão entrega exatamente o payload do modal ao emissor existente', async () => {
      const original = emissor.emitirNfePorVendaId;
      let recebido = null;
      emissor.emitirNfePorVendaId = async (vendaId, opcoes) => {
        recebido = { vendaId, dadosNfe: opcoes.dadosNfe };
        return { success: false, status: 'configuracao_pendente', message: 'simulado' };
      };
      try {
        const payload = payloadValido({ dados_adicionais: 'PEDIDO 123' });
        const r = await postJson(`/nfe/vendas/${vendaAutorizada}/emitir`, tokenEmitir, payload);
        assert.equal(r.status, 200);
        assert.equal(String(recebido.vendaId), String(vendaAutorizada));
        assert.deepEqual(recebido.dadosNfe, payload);
      } finally {
        emissor.emitirNfePorVendaId = original;
      }
    });

    it('POST cancelar exige NF-E-CANCELAR e justificativa de 15+ caracteres (sem SEFAZ)', async () => {
      const semPerm = await postJson(`/nfe/notas/${notaAutorizada}/cancelar`, tokenEmitir, { justificativa: 'Cancelamento de teste valido' });
      assert.equal(semPerm.status, 403);
      const curta = await postJson(`/nfe/notas/${notaAutorizada}/cancelar`, tokenCancelar, { justificativa: 'curta' });
      assert.equal(curta.status, 400);
      const nota = await get('SELECT status FROM nfe_notas WHERE id = ?', [notaAutorizada]);
      assert.equal(nota.status, 'autorizada');
    });

    it('POST consultar exige NF-E-EMITIR', async () => {
      const r = await postJson(`/nfe/notas/${notaAutorizada}/consultar`, tokenCancelar);
      assert.equal(r.status, 403);
    });
  });
});

// ===========================================================================
// Frontend (JSDOM)
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

function criarJanela({ recursos = { fiscal: true, nfe: true }, usuario = { role: 'admin', perfil: 'ADMIN' } } = {}) {
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body><div id="page-content"></div><div id="modal-container"></div></body></html>',
    { url: 'http://localhost/erp/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole }
  );
  const { window } = dom;
  window.localStorage.setItem('token', 'token-teste');
  window.localStorage.setItem('user', JSON.stringify(usuario));

  class ModalStub {
    constructor(el) { this.el = el; el.__modal = this; }
    static getInstance(el) { return el.__modal || null; }
    static getOrCreateInstance(el) { return el.__modal || new ModalStub(el); }
    show() { this.el.classList.add('show'); }
    hide() {
      const ev = new window.Event('hide.bs.modal', { cancelable: true });
      this.el.dispatchEvent(ev);
      if (ev.defaultPrevented) return;
      this.el.classList.remove('show');
      this.el.dispatchEvent(new window.Event('hidden.bs.modal'));
    }
  }
  window.bootstrap = { Modal: ModalStub };

  for (const rel of SCRIPTS_ERP) window.eval(read(rel));

  window.CONFIG_IMPLANTACAO = { recursos };
  window.eval('CONFIG_IMPLANTACAO = window.CONFIG_IMPLANTACAO;');
  const notificacoes = [];
  window.showNotification = (mensagem, tipo) => notificacoes.push({ mensagem, tipo });
  const vendasAbertas = [];
  window.viewVenda = (id) => vendasAbertas.push(id);
  window.URL.createObjectURL = () => 'blob:teste';
  window.URL.revokeObjectURL = () => {};
  const janelas = [];
  window.open = () => {
    const janela = { html: '', document: { open() {}, write(h) { janela.html += h; }, close() {} }, focus() {} };
    janelas.push(janela);
    return janela;
  };

  const chamadas = [];
  const rotas = {};
  window.fetch = async (url, opts = {}) => {
    const u = new URL(url, 'http://localhost');
    const metodo = String(opts.method || 'GET').toUpperCase();
    chamadas.push({
      metodo,
      path: u.pathname,
      search: u.search,
      body: opts.body ? JSON.parse(opts.body) : undefined,
      headers: opts.headers || {}
    });
    const handler = rotas[`${metodo} ${u.pathname}`];
    const r = typeof handler === 'function' ? await handler(u, opts) : handler;
    const status = r ? (r.status || 200) : 404;
    const body = r ? r.body : { success: false, mensagem: 'rota não simulada' };
    const headers = (r && r.headers) || {};
    const texto = typeof body === 'string' ? body : JSON.stringify(body);
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (k) => headers[k] || headers[String(k).toLowerCase()] || null },
      json: async () => JSON.parse(texto),
      text: async () => texto,
      blob: async () => new window.Blob([texto])
    };
  };

  return { dom, window, rotas, chamadas, notificacoes, vendasAbertas, janelas };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
async function aguardar(cond, limite = 50) {
  for (let i = 0; i < limite; i++) {
    if (cond()) return true;
    await tick();
  }
  return cond();
}

function vendaUi(nfe, extra = {}) {
  return {
    id: 7,
    codigo: 'V0007',
    status: 'concluida',
    data_venda: '2026-10-04',
    total: 20,
    desconto: 0,
    forma_pagamento: 'dinheiro',
    cliente_id: 3,
    cliente_nome: 'MARIA CLIENTE',
    cliente_cpf: '529.982.247-25',
    cliente_rua: 'RUA DAS FLORES',
    cliente_numero: '45',
    cliente_bairro: 'CENTRO',
    cliente_cidade: 'JUAZEIRO DO NORTE',
    cliente_uf: 'CE',
    cliente_cep: '63010-000',
    itens: [{ produto_id: 1, produto_nome: 'SORVETE', quantidade: 2, preco_unitario: 10, subtotal: 20, quantidade_fiscal: 2, valor_fiscal: 20 }],
    nfe,
    ...extra
  };
}

const NFE_ELEGIVEL = { nota: null, possui_parcela_fiscal: true, em_andamento: false, pode_emitir: true, motivo_bloqueio: null, acao: 'emitir' };
const NOTA_AUTORIZADA = { id: 55, status: 'autorizada', numero: 12, serie: 1, chave: '2'.repeat(44), protocolo: '223260000000012', ambiente: 2 };

function abrirModalVenda(ctx, nfe, extra) {
  ctx.window.showVendaModal(vendaUi(nfe, extra));
  return ctx.window.document;
}

describe('NF-E-03 — botão Emitir NF-e no modal da venda', () => {
  it('botão aparece para venda elegível', () => {
    const ctx = criarJanela();
    const doc = abrirModalVenda(ctx, NFE_ELEGIVEL);
    const btn = doc.getElementById('btnEmitirNfeVenda');
    assert.ok(btn);
    assert.match(btn.textContent, /Emitir NF-e/);
    ctx.window.close();
  });

  it('não aparece com NF-e autorizada; mostra autorizada, DANFE, XML e Consultar', () => {
    const ctx = criarJanela();
    const doc = abrirModalVenda(ctx, { ...NFE_ELEGIVEL, nota: NOTA_AUTORIZADA, pode_emitir: false, acao: 'autorizada' });
    assert.equal(doc.getElementById('btnEmitirNfeVenda'), null);
    assert.match(doc.getElementById('nfeSecaoVenda').textContent, /NF-e autorizada/);
    assert.ok(doc.getElementById('btnNfeDanfeVenda'));
    assert.ok(doc.getElementById('btnNfeXmlVenda'));
    assert.ok(doc.getElementById('btnNfeConsultarVenda'));
    assert.ok(doc.getElementById('btnNfeCancelarVenda'));
    ctx.window.close();
  });

  it('não aparece sem parcela fiscal', () => {
    const ctx = criarJanela();
    const doc = abrirModalVenda(ctx, { ...NFE_ELEGIVEL, possui_parcela_fiscal: false, pode_emitir: false, acao: 'nenhuma', motivo_bloqueio: 'Venda sem parcela fiscal.' });
    assert.equal(doc.getElementById('btnEmitirNfeVenda'), null);
    assert.match(doc.getElementById('nfeSecaoVenda').textContent, /Venda sem parcela fiscal\./);
    assert.equal(doc.getElementById('nfeSemPermissaoEmitir'), null);
    ctx.window.close();
  });

  it('não aparece com venda cancelada (resumo do backend)', () => {
    const ctx = criarJanela();
    const doc = abrirModalVenda(ctx, { ...NFE_ELEGIVEL, pode_emitir: false, acao: 'nenhuma', motivo_bloqueio: 'Venda cancelada.' }, { status: 'cancelada' });
    assert.equal(doc.getElementById('btnEmitirNfeVenda'), null);
    ctx.window.close();
  });

  it('não aparece sem o recurso NF-e', () => {
    const ctx = criarJanela({ recursos: { fiscal: true, nfe: false } });
    const doc = abrirModalVenda(ctx, NFE_ELEGIVEL);
    assert.equal(doc.getElementById('btnEmitirNfeVenda'), null);
    assert.equal(doc.getElementById('nfeSecaoVenda'), null);
    ctx.window.close();
  });

  it('sem NF-E-EMITIR não exibe o botão e não emite', async () => {
    const ctx = criarJanela({ usuario: { role: 'operador', perfil: 'USUARIO', permissoes: ['vendas'] } });
    const doc = abrirModalVenda(ctx, NFE_ELEGIVEL);
    assert.equal(doc.getElementById('btnEmitirNfeVenda'), null);
    assert.ok(doc.getElementById('nfeSecaoVenda'));
    assert.equal(doc.getElementById('nfeSemPermissaoEmitir').textContent.trim(), 'Usuário sem permissão para emitir NF-e.');
    await ctx.window.abrirEmissaoNfe(7);
    assert.equal(ctx.chamadas.length, 0);
    assert.equal(doc.getElementById('modalEmitirNfe'), null);
    assert.match(ctx.notificacoes.at(-1).mensagem, /permissão/);
    ctx.window.close();
  });

  it('usuário com NF-E-EMITIR (sem ser admin) vê o botão; sem NF-E-CANCELAR não vê Cancelar', () => {
    const ctx = criarJanela({ usuario: { role: 'operador', perfil: 'USUARIO', permissoes: ['vendas', 'NF-E-EMITIR'] } });
    let doc = abrirModalVenda(ctx, NFE_ELEGIVEL);
    assert.ok(doc.getElementById('btnEmitirNfeVenda'));
    assert.equal(doc.getElementById('nfeSemPermissaoEmitir'), null);
    doc = abrirModalVenda(ctx, { ...NFE_ELEGIVEL, nota: NOTA_AUTORIZADA, pode_emitir: false, acao: 'autorizada' });
    assert.equal(doc.getElementById('btnNfeCancelarVenda'), null);
    ctx.window.close();
  });

  it('rejeitada mostra "Emitir novamente"; em processamento mostra Consultando sem emitir; cancelada mostra DANFE/XML/Histórico', () => {
    const ctx = criarJanela();
    let doc = abrirModalVenda(ctx, {
      ...NFE_ELEGIVEL, acao: 'emitir_novamente',
      nota: { id: 60, status: 'rejeitada', numero: 13, serie: 1, cstat: '225', xmotivo: 'Falha no Schema' }
    });
    assert.match(doc.getElementById('btnEmitirNfeVenda').textContent, /Emitir novamente/);
    assert.match(doc.getElementById('nfeSecaoVenda').textContent, /225/);

    doc = abrirModalVenda(ctx, {
      ...NFE_ELEGIVEL, pode_emitir: false, em_andamento: true, acao: 'consultar',
      nota: { id: 61, status: 'aguardando_retorno', numero: 14, serie: 1, chave: '4'.repeat(44) }
    });
    assert.equal(doc.getElementById('btnEmitirNfeVenda'), null);
    assert.match(doc.getElementById('nfeSecaoVenda').textContent, /Consultando NF-e/);
    assert.ok(doc.getElementById('btnNfeConsultarVenda'));

    doc = abrirModalVenda(ctx, {
      ...NFE_ELEGIVEL, pode_emitir: false, acao: 'nenhuma', motivo_bloqueio: 'cancelada',
      nota: { ...NOTA_AUTORIZADA, status: 'cancelada' }
    });
    assert.match(doc.getElementById('nfeSecaoVenda').textContent, /NF-e cancelada/);
    assert.ok(doc.getElementById('btnNfeDanfeVenda'));
    assert.ok(doc.getElementById('btnNfeXmlVenda'));
    assert.ok(doc.getElementById('btnNfeHistoricoVenda'));
    assert.equal(doc.getElementById('btnEmitirNfeVenda'), null);
    ctx.window.close();
  });
});

describe('NF-E-03 — modal de emissão', () => {
  async function abrirModalEmissao(ctx, nfe = NFE_ELEGIVEL) {
    ctx.rotas['GET /api/vendas/7'] = { body: vendaUi(nfe) };
    await ctx.window.abrirEmissaoNfe(7);
    return ctx.window.document;
  }

  it('modal abre e preenche o destinatário com o cliente da venda', async () => {
    const ctx = criarJanela();
    const doc = await abrirModalEmissao(ctx);
    assert.ok(doc.getElementById('modalEmitirNfe').classList.contains('show'));
    assert.match(doc.getElementById('modalEmitirNfeLabel').textContent, /Venda #V0007/);
    assert.equal(doc.getElementById('nfeDestTipo').value, 'CPF');
    assert.equal(doc.getElementById('nfeDestDocumento').value, CPF_VALIDO);
    assert.equal(doc.getElementById('nfeDestNome').value, 'MARIA CLIENTE');
    assert.equal(doc.getElementById('nfeDestLogradouro').value, 'RUA DAS FLORES');
    assert.equal(doc.getElementById('nfeDestNumero').value, '45');
    assert.equal(doc.getElementById('nfeDestBairro').value, 'CENTRO');
    assert.equal(doc.getElementById('nfeDestMunicipio').value, 'JUAZEIRO DO NORTE');
    assert.equal(doc.getElementById('nfeDestUf').value, 'CE');
    assert.equal(doc.getElementById('nfeDestCep').value, '63010000');
    assert.equal(doc.getElementById('nfeNatureza').value, 'VENDA DE MERCADORIA');
    assert.equal(doc.getElementById('nfeCfop').value, '5102');
    ctx.window.close();
  });

  it('não abre se o backend disser que a venda não pode emitir', async () => {
    const ctx = criarJanela();
    const doc = await abrirModalEmissao(ctx, { ...NFE_ELEGIVEL, pode_emitir: false, motivo_bloqueio: 'Venda sem parcela fiscal.' });
    assert.equal(doc.getElementById('modalEmitirNfe'), null);
    assert.match(ctx.notificacoes.at(-1).mensagem, /sem parcela fiscal/);
    ctx.window.close();
  });

  it('documento vazio: mensagem oficial e nenhum POST', async () => {
    const ctx = criarJanela();
    const doc = await abrirModalEmissao(ctx);
    doc.getElementById('nfeDestDocumento').value = '';
    await ctx.window.confirmarEmissaoNfe();
    assert.match(doc.getElementById('nfeEmissaoErros').textContent, /Informe o CPF ou CNPJ do destinatário para emitir a NF-e\./);
    assert.ok(doc.getElementById('nfeDestDocumento').classList.contains('is-invalid'));
    assert.equal(ctx.chamadas.filter((c) => c.metodo === 'POST').length, 0);
    ctx.window.close();
  });

  it('POST correto: rota existente, só campos aceitos, cadastro do cliente intocado', async () => {
    const ctx = criarJanela();
    try {
      const doc = await abrirModalEmissao(ctx);
      doc.getElementById('nfeDestNome').value = 'MARIA CORRIGIDA';
      doc.getElementById('nfeDestComplemento').value = 'CASA 2';
      ctx.rotas['POST /api/nfe/vendas/7/emitir'] = { body: { success: false, status: 'configuracao_pendente', message: 'Certificado A1/PFX não encontrado.' } };
      await ctx.window.confirmarEmissaoNfe();
      const posts = ctx.chamadas.filter((c) => c.metodo === 'POST');
      assert.equal(posts.length, 1);
      assert.equal(posts[0].path, '/api/nfe/vendas/7/emitir');
      assert.equal(posts[0].headers.Authorization, 'Bearer token-teste');
      // CLIENTES-02: dest_inscricao_estadual sempre presente; vazio quando o cliente não tem IE.
      assert.deepEqual(posts[0].body, {
        dest_tipo_pessoa: 'PF',
        dest_cpf: CPF_VALIDO,
        dest_nome: 'MARIA CORRIGIDA',
        dest_inscricao_estadual: '',
        dest_logradouro: 'RUA DAS FLORES',
        dest_numero: '45',
        dest_complemento: 'CASA 2',
        dest_bairro: 'CENTRO',
        dest_municipio: 'JUAZEIRO DO NORTE',
        dest_uf: 'CE',
        dest_cep: '63010000',
        natureza_operacao: 'VENDA DE MERCADORIA',
        cfop: '5102'
      });
      assert.equal(ctx.chamadas.some((c) => c.path.startsWith('/api/clientes')), false);
      assert.match(doc.getElementById('nfeResultadoErro').textContent, /Certificado A1\/PFX não encontrado/);
      assert.match(doc.getElementById('btnConfirmarEmissaoNfe').textContent, /Corrigir \/ Emitir novamente/);
    } finally {
      ctx.window.close();
    }
  });

  it('estado emitindo: botão travado, sem fechar, sem segundo POST; depois autorizada', async () => {
    const ctx = criarJanela();
    const doc = await abrirModalEmissao(ctx);
    let liberar;
    ctx.rotas['POST /api/nfe/vendas/7/emitir'] = () => new Promise((resolve) => { liberar = resolve; });
    const emissao = ctx.window.confirmarEmissaoNfe();
    await aguardar(() => typeof liberar === 'function');

    const btn = doc.getElementById('btnConfirmarEmissaoNfe');
    assert.equal(btn.disabled, true);
    assert.match(btn.textContent, /Emitindo NF-e\.\.\./);
    assert.equal(doc.getElementById('nfeBtnCancelarEmissao').disabled, true);
    assert.doesNotMatch(doc.getElementById('nfeEmissaoProgresso').textContent, /%/);
    ctx.window.bootstrap.Modal.getInstance(doc.getElementById('modalEmitirNfe')).hide();
    assert.ok(doc.getElementById('modalEmitirNfe').classList.contains('show'), 'modal não pode fechar durante a emissão');
    await ctx.window.confirmarEmissaoNfe();
    assert.equal(ctx.chamadas.filter((c) => c.metodo === 'POST').length, 1);

    liberar({ body: { success: true, status: 'autorizada', notaId: 55, numero: 12, serie: 1, chaveAcesso: '2'.repeat(44), protocolo: '223260000000012', cStat: '100', xMotivo: 'Autorizado o uso da NF-e' } });
    await emissao;
    const ok = doc.getElementById('nfeResultadoAutorizada');
    assert.ok(ok);
    assert.match(ok.textContent, /NF-e autorizada/);
    assert.match(ok.textContent, /000012/);
    assert.match(ok.textContent, /223260000000012/);
    assert.match(ok.textContent, /2222 2222/);
    const rodape = doc.getElementById('nfeEmissaoRodape').textContent;
    assert.match(rodape, /DANFE/);
    assert.match(rodape, /XML/);
    assert.match(rodape, /Fechar/);

    ctx.window.nfeFecharModal('modalEmitirNfe');
    assert.equal(doc.getElementById('modalEmitirNfe'), null);
    assert.deepEqual(ctx.vendasAbertas, [7]);
    ctx.window.close();
  });

  it('rejeitada: cStat, xMotivo, sugestão do backend e "Corrigir / Emitir novamente"', async () => {
    const ctx = criarJanela();
    const doc = await abrirModalEmissao(ctx);
    ctx.rotas['POST /api/nfe/vendas/7/emitir'] = { body: { success: false, status: 'rejeitada', notaId: 60, cStat: '225', xMotivo: 'Rejeicao: Falha no Schema XML', message: 'Rejeicao: Falha no Schema XML' } };
    ctx.rotas['GET /api/nfe/notas/60'] = { body: { success: true, nota: { id: 60, status: 'rejeitada', erro_sugestao: 'Revise os dados do destinatário.' } } };
    await ctx.window.confirmarEmissaoNfe();
    const box = doc.getElementById('nfeResultadoRejeitada');
    assert.match(box.textContent, /NF-e rejeitada pela SEFAZ/);
    assert.match(box.textContent, /225/);
    assert.match(box.textContent, /Falha no Schema XML/);
    assert.match(box.textContent, /Revise os dados do destinatário\./);
    assert.match(doc.getElementById('btnConfirmarEmissaoNfe').textContent, /Corrigir \/ Emitir novamente/);
    assert.equal(doc.getElementById('nfeEmissaoFormulario').classList.contains('d-none'), false);
    ctx.window.close();
  });

  it('aguardando retorno: "Estamos verificando…", sem nova emissão; Consultar chama a rota de consulta', async () => {
    const ctx = criarJanela();
    const doc = await abrirModalEmissao(ctx);
    ctx.rotas['POST /api/nfe/vendas/7/emitir'] = { status: 409, body: { success: false, status: 'emissao_em_andamento', notaId: 61, codigo: 'LOTE_PROCESSAMENTO', message: 'Lote em processamento na SEFAZ.' } };
    await ctx.window.confirmarEmissaoNfe();
    assert.match(doc.getElementById('nfeResultadoVerificando').textContent, /Estamos verificando a situação da NF-e\./);
    assert.equal(doc.getElementById('btnConfirmarEmissaoNfe'), null);

    ctx.rotas['POST /api/nfe/notas/61/consultar'] = { body: { success: true, notaId: 61, status: 'autorizada', chave: '4'.repeat(44), protocolo: '223260000000061', cStat: '100', xMotivo: 'Autorizado o uso da NF-e' } };
    ctx.rotas['GET /api/nfe/notas/61'] = { body: { success: true, nota: { id: 61, numero: 14, serie: 1 } } };
    await ctx.window.nfeConsultarDoModalEmissao(61, 7);
    assert.ok(ctx.chamadas.some((c) => c.metodo === 'POST' && c.path === '/api/nfe/notas/61/consultar'));
    assert.match(doc.getElementById('nfeResultadoAutorizada').textContent, /000014/);
    ctx.window.close();
  });

  it('erro de transmissão também cai em verificação (nunca reemissão imediata)', () => {
    const r = nfeUi.classificarResultadoEmissaoNfe({ status: 200, data: { success: false, status: 'erro_transmissao', notaId: 9 } });
    assert.equal(r.tipo, 'verificando');
    assert.equal(r.podeTentarNovamente, false);
  });
});

describe('NF-E-03 — validações do formulário', () => {
  const base = {
    tipo: 'CPF', documento: CPF_VALIDO, nome: 'X', logradouro: 'R', numero: '1', bairro: 'B',
    municipio: 'M', uf: 'CE', cep: '63000000', natureza: 'VENDA', cfop: '5102'
  };
  const campos = (r) => r.erros.map((e) => e.campo);

  it('CPF/CNPJ: dígitos verificadores', () => {
    assert.equal(nfeUi.nfeCpfValido(CPF_VALIDO), true);
    assert.equal(nfeUi.nfeCpfValido('52998224724'), false);
    assert.equal(nfeUi.nfeCpfValido('11111111111'), false);
    assert.equal(nfeUi.nfeCnpjValido(CNPJ_VALIDO), true);
    assert.equal(nfeUi.nfeCnpjValido('11222333000180'), false);
    assert.deepEqual(campos(nfeUi.validarDadosEmissaoNfe({ ...base, documento: '123' })), ['documento']);
    assert.deepEqual(campos(nfeUi.validarDadosEmissaoNfe({ ...base, tipo: 'CNPJ', documento: CPF_VALIDO })), ['documento']);
    assert.equal(nfeUi.validarDadosEmissaoNfe({ ...base, tipo: 'CNPJ', documento: CNPJ_VALIDO }).valido, true);
    assert.equal(nfeUi.validarDadosEmissaoNfe({ ...base, documento: '' }).erros[0].mensagem, nfeUi.NFE_MSG_SEM_DOCUMENTO);
  });

  it('endereço: nome, logradouro, número, bairro, município, UF, CEP', () => {
    const r = nfeUi.validarDadosEmissaoNfe({ ...base, nome: '', logradouro: ' ', numero: '', bairro: '', municipio: '', uf: 'XX', cep: '123' });
    assert.deepEqual(campos(r), ['nome', 'logradouro', 'numero', 'bairro', 'municipio', 'uf', 'cep']);
  });

  it('natureza e CFOP', () => {
    assert.deepEqual(campos(nfeUi.validarDadosEmissaoNfe({ ...base, natureza: '', cfop: '1102' })), ['natureza', 'cfop']);
    assert.deepEqual(campos(nfeUi.validarDadosEmissaoNfe({ ...base, cfop: '51' })), ['cfop']);
    assert.equal(nfeUi.validarDadosEmissaoNfe({ ...base, cfop: '6108' }).valido, true);
  });

  it('parcela fiscal ausente bloqueia o envio', () => {
    const r = nfeUi.validarDadosEmissaoNfe(base, { possuiParcelaFiscal: false });
    assert.equal(r.valido, false);
    assert.equal(r.erros[0].campo, null);
  });

  it('payload: CNPJ vira dest_cnpj/PJ e campos extras aceitos são preservados', () => {
    const p = nfeUi.montarPayloadEmissaoNfe({ ...base, tipo: 'CNPJ', documento: '11.222.333/0001-81' }, {
      mod_frete: '9', frete: 0, volumes: 2, peso: 1.5, observacoes: 'obs', campo_inventado: 'x'
    });
    assert.equal(p.dest_cnpj, CNPJ_VALIDO);
    assert.equal(p.dest_tipo_pessoa, 'PJ');
    assert.equal(p.dest_cpf, undefined);
    assert.equal(p.mod_frete, '9');
    assert.equal(p.frete, 0);
    assert.equal(p.volumes, 2);
    assert.equal(p.peso, 1.5);
    assert.equal(p.observacoes, 'obs');
    assert.equal(p.campo_inventado, undefined);
  });
});

describe('NF-E-03 — consulta, DANFE, XML, cancelamento, histórico', () => {
  it('consulta: POST /nfe/notas/:id/consultar e atualiza a venda', async () => {
    const ctx = criarJanela();
    ctx.rotas['POST /api/nfe/notas/55/consultar'] = { body: { success: true, notaId: 55, status: 'autorizada', cStat: '100', xMotivo: 'Autorizado o uso da NF-e' } };
    const out = await ctx.window.nfeConsultarSituacao(55, 7);
    assert.equal(out.status, 'autorizada');
    assert.match(ctx.notificacoes.at(-1).mensagem, /cStat 100/);
    assert.deepEqual(ctx.vendasAbertas, [7]);
    ctx.window.close();
  });

  it('DANFE: usa GET /nfe/notas/:id/danfe com token e abre o HTML do backend', async () => {
    const ctx = criarJanela();
    ctx.rotas['GET /api/nfe/notas/55/danfe'] = { body: '<html><body>DANFE NF-e 000012</body></html>', headers: { 'content-type': 'text/html' } };
    assert.equal(await ctx.window.nfeAbrirDanfe(55), true);
    assert.equal(ctx.chamadas[0].headers.Authorization, 'Bearer token-teste');
    assert.match(ctx.janelas[0].html, /DANFE NF-e 000012/);
    ctx.window.close();
  });

  it('XML: baixa de GET /nfe/notas/:id/xml?download=1 (nada gerado no frontend)', async () => {
    const ctx = criarJanela();
    ctx.rotas['GET /api/nfe/notas/55/xml'] = { body: '<nfeProc/>', headers: { 'Content-Disposition': 'attachment; filename="NFe-123.xml"' } };
    assert.equal(await ctx.window.nfeBaixarXml(55), true);
    assert.equal(ctx.chamadas[0].path, '/api/nfe/notas/55/xml');
    assert.equal(ctx.chamadas[0].search, '?download=1');
    ctx.window.close();
  });

  it('cancelamento: aviso, justificativa >= 15 caracteres e POST /nfe/notas/:id/cancelar', async () => {
    const ctx = criarJanela();
    ctx.window.nfeAbrirCancelamento(55, 7);
    const doc = ctx.window.document;
    assert.match(doc.getElementById('modalCancelarNfe').textContent, /Cancele somente se a operação fiscal realmente precisar ser cancelada\./);
    doc.getElementById('nfeJustificativaCancelamento').value = 'curta demais';
    doc.getElementById('btnConfirmarCancelamentoNfe').click();
    await tick();
    assert.equal(ctx.chamadas.length, 0);
    assert.match(doc.getElementById('nfeJustificativaErro').textContent, /mínimo 15 caracteres/);

    ctx.rotas['POST /api/nfe/notas/55/cancelar'] = { body: { success: true, status: 'cancelada', notaId: 55, protocoloCancelamento: '135260000000001' } };
    doc.getElementById('nfeJustificativaCancelamento').value = 'Cliente desistiu da compra apos emissao da nota';
    doc.getElementById('btnConfirmarCancelamentoNfe').click();
    await aguardar(() => /NF-e cancelada/.test(doc.getElementById('nfeCancelamentoResultado').textContent));
    assert.deepEqual(ctx.chamadas[0], {
      metodo: 'POST', path: '/api/nfe/notas/55/cancelar', search: '',
      body: { justificativa: 'Cliente desistiu da compra apos emissao da nota' },
      headers: ctx.chamadas[0].headers
    });
    ctx.window.nfeFecharModal('modalCancelarNfe');
    assert.deepEqual(ctx.vendasAbertas, [7]);
    ctx.window.close();
  });

  it('cancelamento sem NF-E-CANCELAR não abre', () => {
    const ctx = criarJanela({ usuario: { role: 'operador', perfil: 'USUARIO', permissoes: ['NF-E-EMITIR'] } });
    ctx.window.nfeAbrirCancelamento(55, 7);
    assert.equal(ctx.window.document.getElementById('modalCancelarNfe'), null);
    ctx.window.close();
  });

  it('histórico: GET /nfe/notas/:id/historico e eventos legíveis', async () => {
    const ctx = criarJanela();
    ctx.rotas['GET /api/nfe/notas/55'] = { body: { success: true, nota: { id: 55, numero: 12, serie: 1, status: 'autorizada', ambiente: 2, chave_acesso: '2'.repeat(44), protocolo: '223260000000012', tem_xml: 1, tem_danfe: 1 } } };
    ctx.rotas['GET /api/nfe/notas/55/historico'] = { body: { success: true, eventos: [
      { acao: 'consulta', criado_em: '2026-10-04 10:05:00', usuario_nome: 'admin', detalhes: JSON.stringify({ cStat: '100', xMotivo: 'Autorizado o uso da NF-e', status: 'autorizada' }) },
      { acao: 'autorizacao', criado_em: '2026-10-04 10:00:00', usuario_nome: 'admin', detalhes: JSON.stringify({ status: 'autorizada', protocolo: '223260000000012' }) }
    ] } };
    ctx.rotas['GET /api/nfe/logs'] = { body: { success: true, logs: [{ acao: 'emissao', sucesso: 1, cstat: '100', criado_em: '2026-10-04 10:00:00' }] } };
    await ctx.window.nfeAbrirHistorico(55, 7);
    const doc = ctx.window.document;
    const hist = doc.getElementById('nfeListaHistorico').textContent;
    assert.match(hist, /Autorização/);
    assert.match(hist, /Consulta à SEFAZ/);
    assert.match(hist, /04\/10\/2026 10:05/);
    assert.match(doc.getElementById('nfeListaLogs').textContent, /emissao/);
    assert.ok(ctx.chamadas.some((c) => c.path === '/api/nfe/notas/55/historico'));
    ctx.window.nfeFecharModal('modalDetalheNfe');
    assert.deepEqual(ctx.vendasAbertas, [7]);
    ctx.window.close();
  });
});

describe('NF-E-03 / 04.2 — páginas NF-e no módulo Fiscal', () => {
  function prepararPainel(ctx) {
    ctx.rotas['GET /api/nfe/monitor'] = { body: { success: true, atualizadoEm: '2026-10-04T13:00:00.000Z', contadores: {}, totais: [
      { status: 'autorizada', qtd: 4 }, { status: 'rejeitada', qtd: 2 }, { status: 'aguardando_retorno', qtd: 1 },
      { status: 'erro_comunicacao', qtd: 3 }, { status: 'cancelada', qtd: 1 }
    ] } };
    ctx.rotas['GET /api/nfe/notas'] = { body: { success: true, notas: [
      { id: 55, venda_id: 7, venda_codigo: 'V0007', numero: 12, serie: 1, status: 'autorizada', cliente_nome: 'MARIA', created_at: '2026-10-04 10:00:00', chave_acesso: '2'.repeat(44), tem_xml: 1, tem_danfe: 1 }
    ] } };
    ctx.rotas['GET /api/nfe/fila'] = { body: { success: true, itens: [
      { id: 55, venda_id: 7, numero: 12, status: 'autorizada', fila_estado: 'autorizado' },
      { id: 61, venda_id: 8, numero: 14, status: 'aguardando_retorno', fila_estado: 'aguardando', tentativas: 1, chave_acesso: '4'.repeat(44), erro_mensagem: 'Lote em processamento' }
    ] } };
  }

  it('página NFC-e Emitidas mantém as abas NFC-e e não mistura NF-e nem Contabilidade', () => {
    const ctx = criarJanela();
    ctx.window.renderFiscal();
    const doc = ctx.window.document;
    assert.ok(doc.querySelector('[data-bs-target="#fiscal-notas-tab"]'));
    assert.ok(doc.querySelector('[data-bs-target="#fiscal-emissao-tab"]'));
    assert.ok(doc.getElementById('btnEmitirNFCe'));
    assert.equal(doc.getElementById('fiscal-nfe-tab-btn'), null);
    assert.equal(doc.querySelector('[data-bs-target="#fiscal-contabilidade-tab"]'), null);
    ctx.window.close();
  });

  it('sem recurso NF-e a página NFC-e continua igual', () => {
    const ctx = criarJanela({ recursos: { fiscal: true, nfe: false } });
    ctx.window.renderFiscal();
    assert.ok(ctx.window.document.querySelector('[data-bs-target="#fiscal-notas-tab"]'));
    ctx.window.close();
  });

  it('monitor, lista e fila vêm dos endpoints /nfe/monitor, /nfe/notas e /nfe/fila', async () => {
    const ctx = criarJanela();
    prepararPainel(ctx);
    const doc = ctx.window.document;
    await ctx.window.loadNfePagina('fiscal-nfe-monitor');
    const card = (k) => doc.querySelector(`[data-monitor="${k}"]`).textContent;
    assert.match(card('autorizada'), /Autorizada\s*4/);
    assert.match(card('rejeitada'), /Rejeitada\s*2/);
    assert.match(card('aguardando_retorno'), /Aguardando retorno\s*1/);
    assert.match(card('erro_transmissao'), /Erro de transmissão\s*3/);
    assert.match(card('cancelada'), /Cancelada\s*1/);

    await ctx.window.loadNfePagina('fiscal-nfe');
    const linhas = doc.querySelectorAll('#nfeTabelaNotas tbody tr[data-nota-id]');
    assert.equal(linhas.length, 1);
    assert.match(linhas[0].textContent, /000012/);
    assert.match(linhas[0].textContent, /#V0007/);
    assert.match(linhas[0].textContent, /MARIA/);
    assert.match(linhas[0].textContent, /Autorizada/);

    await ctx.window.loadNfePagina('fiscal-nfe-fila');
    const fila = doc.querySelectorAll('#nfeTabelaFila tbody tr[data-fila-nota-id]');
    assert.equal(fila.length, 1, 'fila mostra somente o que precisa de atenção');
    assert.equal(fila[0].getAttribute('data-fila-nota-id'), '61');

    const notasCall = ctx.chamadas.find((c) => c.path === '/api/nfe/notas');
    assert.match(notasCall.search, /tipo=VENDA/);
    ctx.window.close();
  });

  it('filtros vão para a API (status, período, busca)', () => {
    const q = (f) => new URLSearchParams(nfeUi.nfeQueryNotas(f));
    let p = q({ status: 'rejeitada', dataInicio: '2026-10-01', dataFim: '2026-10-04', busca: '' });
    assert.equal(p.get('status'), 'rejeitada');
    assert.equal(p.get('dataInicio'), '2026-10-01');
    assert.equal(p.get('dataFim'), '2026-10-04');
    assert.equal(q({ busca: '12' }).get('numero'), '12');
    assert.equal(q({ busca: '2'.repeat(44) }).get('chave'), '2'.repeat(44));
    p = q({ busca: 'Maria' });
    assert.equal(p.get('cliente'), 'Maria');
  });
});

describe('NF-E-03 — recurso, segurança e isolamento', () => {
  it('core.js oculta [data-recurso="nfe"] quando o recurso está desligado', () => {
    for (const nfe of [true, false]) {
      const ctx = criarJanela({ recursos: { fiscal: true, nfe } });
      const doc = ctx.window.document;
      doc.body.insertAdjacentHTML('beforeend', '<button id="alvoNfe" data-recurso="nfe">NF-e</button>');
      ctx.window.aplicarRecursosImplantacao();
      assert.equal(doc.getElementById('alvoNfe').style.display === 'none', !nfe, `nfe=${nfe}`);
      assert.equal(doc.body.classList.contains('implantacao-nfe'), nfe);
      ctx.window.close();
    }
  });

  it('nfe.js não gera XML, não assina, não fala com SEFAZ e não guarda segredos', () => {
    const src = read('frontend/erp/js/nfe.js');
    assert.doesNotMatch(src, /<infNFe|<NFe[\s>]|<enviNFe|soap|assinar|privateKey|certificadoSenha|senha|pfx/i);
    assert.doesNotMatch(src, /localStorage\.setItem/);
    assert.doesNotMatch(src, /cancelarNfce|\/fiscal\/emitir|\/nfce/i);
    const rotasPost = [...src.matchAll(/nfeRequest\(`([^`]+)`,\s*\{\s*method: 'POST'/g)].map((m) => m[1]);
    assert.deepEqual(rotasPost.sort(), [
      '/nfe/notas/${Number(notaId)}/cancelar',
      '/nfe/notas/${Number(notaId)}/consultar',
      '/nfe/notas/${Number(notaId)}/consultar',
      // NF-E-04.2: [Reprocessar] da Fila usa o endpoint de reenvio já existente.
      '/nfe/notas/${Number(notaId)}/reenviar',
      '/nfe/vendas/${Number(contexto.vendaId)}/emitir',
      // NF-E-04.1: confirmação de pedido (fatura + emissor existente); a manual usa string literal.
      '/pedidos/${Number(contexto.pedidoId)}/emitir-nfe'
    ].sort());
    assert.equal((src.match(/nfeRequest\('\/nfe\/manual\/emitir'/g) || []).length, 1);
  });

  it('PDV não recebe NF-e', () => {
    const pdvHtml = read('frontend/pdv/index.html');
    assert.doesNotMatch(pdvHtml, /erp\/js\/nfe\.js/);
    assert.doesNotMatch(read('frontend/pdv/js/vendas.js'), /nfeHtmlSecaoVenda|abrirEmissaoNfe/);
    assert.match(read('frontend/erp/index.html'), /<script src="\/erp\/js\/nfe\.js"><\/script>/);
  });

  it('nenhum emissor, SOAP, assinador, DANFE ou numeração novos foram criados', () => {
    const fiscalDir = path.join(ROOT, 'backend/services/fiscal');
    const arquivos = fs.readdirSync(fiscalDir);
    for (const proibido of ['nfeEmissorVenda2.js', 'nfeSoap.js', 'nfeSigner.js', 'danfeNfe2.js']) {
      assert.equal(arquivos.includes(proibido), false, proibido);
    }
    const rotas = read('backend/rotas/nfe.js');
    // Emissão direta pela venda e confirmação manual (NF-E-04.1: fatura e chama o mesmo emissor).
    assert.deepEqual((rotas.match(/router\.post\('[^']*\/emitir'/g) || []).sort(),
      ["router.post('/manual/emitir'", "router.post('/vendas/:vendaId/emitir'"], 'rotas de emissão NF-e conhecidas');
  });

  it('produção continua bloqueada', () => {
    const guard = require(path.join(FISCAL, 'nfeAmbienteGuard'));
    assert.equal(guard.nfeProducaoLiberada(), false);
    assert.equal(guard.ambienteNfePermitido(1), false);
    assert.equal(guard.ambienteNfePermitido(2), true);
  });

  it('NFC-e e Central não referenciam a interface NF-e', () => {
    for (const rel of [
      'backend/services/fiscal/emissor.js',
      'backend/services/fiscal/cancelarNfce.js',
      'backend/rotas/central-entradas.js'
    ]) {
      if (!fs.existsSync(path.join(ROOT, rel))) continue;
      assert.doesNotMatch(read(rel), /resumoNfeDaVenda|nfeHtmlSecaoVenda/, rel);
    }
  });
});
