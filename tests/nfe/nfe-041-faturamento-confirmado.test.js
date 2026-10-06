/**
 * NF-E-04.1 — Formulário de emissão ≠ faturamento definitivo.
 *
 * Abrir/cancelar o formulário NF-e (pedido ou manual) não gera venda, não baixa estoque,
 * não lança financeiro, não marca FATURADO e não cria NF-e. Só o "Confirmar emissão" fatura
 * e emite pelo emissor existente; falha sem NF-e registrada desfaz o faturamento.
 *
 * Banco isolado em %TEMP%; SEFAZ apenas simulada por injeção de dependência; rede bloqueada.
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

const DIR = path.join(os.tmpdir(), 'cds-nfe-testes', 'faturamento-041');
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
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const db = require('../../backend/database');
const auth = require('../../backend/middleware/auth');
const lock = require('../../backend/services/fiscal/nfeEmissionLockService');
const faturamento = require('../../backend/services/vendas/faturamentoNfeService');
const pedidos = require('../../backend/services/pedidos/orcamentoPedidoService');
const nfeUi = require('../../frontend/erp/js/nfe.js');

const CNPJ = '36811652000153';
const CPF_CLIENTE = '529.982.247-25';

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
async function contar(tabela, where = '1=1', params = []) {
  try {
    return Number((await get(`SELECT COUNT(*) AS n FROM ${tabela} WHERE ${where}`, params)).n);
  } catch (err) {
    if (/no such table/i.test(err.message)) return 0;
    throw err;
  }
}
async function numeracaoFiscal() {
  try {
    const r = await get('SELECT COUNT(*) AS n, COALESCE(SUM(proximo_numero), 0) AS soma FROM fiscal_numeracao');
    return `${r.n}/${r.soma}`;
  } catch (err) {
    if (/no such table/i.test(err.message)) return '0/0';
    throw err;
  }
}
async function setConfig(chave, valor) {
  await run(
    `INSERT INTO configuracoes (chave, valor, tipo, descricao, updated_at)
     VALUES (?, ?, 'string', '', CURRENT_TIMESTAMP)
     ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`,
    [chave, String(valor)]
  );
}

/** Bloqueia qualquer saída de rede durante `fn`; devolve as tentativas registradas. */
async function semRede(fn) {
  const tentativas = [];
  const bloquear = (nome) => () => {
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

// --- SEFAZ simulada ---
let chaves;
let material;
function certificado(cnpj) {
  const cert = forge.pki.createCertificate();
  cert.publicKey = chaves.publicKey;
  cert.serialNumber = '041';
  cert.validity.notBefore = new Date(Date.now() - 86400000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86400000);
  const attrs = [{ name: 'commonName', value: `CREMOLICIA TESTE:${cnpj}` }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(chaves.privateKey, forge.md.sha256.create());
  return cert;
}
function retornoSefaz(loteXml, { cStat = '100', xMotivo = 'Autorizado o uso da NF-e' } = {}) {
  const chave = (String(loteXml).match(/Id="NFe(\d{44})"/) || [])[1];
  const prot = `<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><verAplic>SVRS</verAplic><chNFe>${chave}</chNFe>`
    + `<dhRecbto>2026-10-04T10:00:00-03:00</dhRecbto>${cStat === '100' ? '<nProt>223260000000041</nProt><digVal>abc=</digVal>' : ''}`
    + `<cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo></infProt></protNFe>`;
  return '<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>'
    + '<nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4"><retEnviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">'
    + '<tpAmb>2</tpAmb><verAplic>SVRS</verAplic><cStat>104</cStat><xMotivo>Lote processado</xMotivo>'
    + `<cUF>23</cUF><dhRecbto>2026-10-04T10:00:00-03:00</dhRecbto>${prot}</retEnviNFe></nfeResultMsg></soap:Body></soap:Envelope>`;
}
function loteSimulado(retorno) {
  const chamadas = [];
  const fn = async (args) => {
    chamadas.push(args);
    return { success: true, status: 'soap_enviado', raw: retornoSefaz(args.loteXml, retorno) };
  };
  fn.chamadas = chamadas;
  return fn;
}
const depsEmissao = (extra = {}) => ({ carregarCertificado: () => material, inspecionarCertificado: () => ({ cnpj: CNPJ }), ...extra });
const PRONTA = async () => ({ pronta: true, pendencias: [], chamadasSefaz: 0 });
const NAO_PRONTA = async () => ({ pronta: false, pendencias: ['Certificado'], chamadasSefaz: 0 });
/** Faturamento com prontidão OK e emissão com SEFAZ simulada. */
const depsOk = (retorno, extra = {}) => {
  const enviarLote = loteSimulado(retorno);
  return { diagnosticar: PRONTA, depsEmissao: depsEmissao({ enviarLote }), enviarLote, ...extra };
};
const dadosNfe = () => nfeUi.montarPayloadEmissaoNfe({
  tipo: 'CPF', documento: CPF_CLIENTE, nome: 'CLIENTE NFE 041', logradouro: 'RUA DAS FLORES', numero: '45',
  bairro: 'CENTRO', municipio: 'Juazeiro do Norte', uf: 'CE', cep: '63010-000',
  natureza: 'VENDA DE MERCADORIA', cfop: '5102'
});

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

let produtoId;
let clienteId;
let server;
let base;
let tokenAdmin;

// criarVenda gera vendas.codigo com resolução de segundo (VND-AAAAMMDDHHMMSS, índice único).
const proximoSegundo = () => new Promise((resolve) => setTimeout(resolve, 1100));
const itensPadrao = () => [{ produto_id: produtoId, quantidade: 2, preco_unitario: 10 }];
const saldoFiscal = async () => Number((await get('SELECT saldo_fiscal FROM produtos WHERE id = ?', [produtoId])).saldo_fiscal);
const novoPedido = (dados = {}) => pedidos.criarPedidoDireto({ cliente_id: clienteId, itens: itensPadrao(), forma_pagamento: 'dinheiro', ...dados });
const confirmarPedido = (id, deps, dados = dadosNfe()) => pedidos.confirmarEmissaoNfePedido(id, { dadosNfe: dados }, { usuarioId: 1, usuarioNome: 'teste041' }, deps);
let seqChave = 0;
const novaChave = () => `teste-041-${Date.now()}-${++seqChave}`;
const entradaManual = (extra = {}) => ({
  chaveOperacao: novaChave(), clienteId, itens: [{ produto_id: produtoId, quantidade: 1, preco_unitario: 15 }],
  formaPagamento: 'dinheiro', dadosNfe: dadosNfe(), ...extra
});

/** Estado comercial/fiscal observável: tudo que o formulário não pode alterar antes da confirmação. */
async function retrato(pedidoId) {
  const pedido = pedidoId ? await get('SELECT status, venda_id, faturado_em FROM pedidos_comerciais WHERE id = ?', [pedidoId]) : null;
  return {
    pedido,
    vendas: await contar('vendas'),
    vendasConcluidas: await contar('vendas', "status = 'concluida'"),
    saldoFiscal: await saldoFiscal(),
    estoqueAtual: Number((await get('SELECT estoque_atual FROM produtos WHERE id = ?', [produtoId])).estoque_atual),
    financeiroAtivo: await contar('financeiro', "COALESCE(status, '') != 'cancelado'"),
    financeiro: await contar('financeiro'),
    contasReceber: await contar('contas_receber'),
    recebimentos: await contar('venda_recebimentos'),
    nfe: await contar('nfe_notas'),
    nfce: await contar('nfce_notas'),
    numeracao: await numeracaoFiscal()
  };
}

before(async () => {
  assert.ok(path.resolve(process.env.DB_DIR).startsWith(path.resolve(os.tmpdir())), 'teste deve usar banco temporário');
  await new Promise((resolve, reject) => db.whenReady((err) => (err ? reject(err) : resolve())));
  assert.equal(path.resolve(db.dbPath), path.resolve(DIR, 'mercadao.db'));
  assert.ok(!/MercantilFiscal/i.test(db.dbPath), 'nunca o banco oficial');
  chaves = forge.pki.rsa.generateKeyPair(2048);
  material = {
    privateKeyPem: forge.pki.privateKeyToPem(chaves.privateKey),
    certPem: forge.pki.certificateToPem(certificado(CNPJ))
  };
  for (const [k, v] of Object.entries(CONFIG_BASE)) await setConfig(k, v);

  produtoId = (await run(
    `INSERT INTO produtos (codigo, nome, unidade, preco_venda, estoque_atual, saldo_fiscal, saldo_nao_fiscal, ncm, cfop, csosn, origem, ativo)
     VALUES ('SORV-041', 'SORVETE TESTE 041', 'UN', 10, 200, 200, 0, '21050010', '5102', '102', '0', 1)`
  )).id;
  clienteId = (await run(
    `INSERT INTO clientes (nome, cpf_cnpj, rua, numero, bairro, cidade, uf, cep)
     VALUES ('CLIENTE TESTE NFE041', ?, 'RUA CLIENTE', '10', 'BAIRRO', 'JUAZEIRO DO NORTE', 'CE', '63000-000')`,
    [CPF_CLIENTE]
  )).id;
  const adminId = (await run(`INSERT INTO usuarios (username, password_hash, role) VALUES ('nfe041adm', 'x', 'admin')`)).id;
  tokenAdmin = jwt.sign({ id: adminId, username: 'nfe041adm', role: 'admin', perfil: 'ADMIN' }, auth.JWT_SECRET);

  const { pedidosRouter } = require('../../backend/rotas/pedidos');
  const app = express();
  app.use(express.json());
  app.use('/api/nfe', auth.verificarToken, require('../../backend/rotas/nfe'));
  app.use('/api/pedidos', auth.verificarToken, pedidosRouter);
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  lock.resetLocksForTests();
  if (server) await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => db.close(() => resolve()));
});

// ===========================================================================
// Interface ligada ao backend real (banco temporário): o "teste manual" da Sprint
// ===========================================================================

const SCRIPTS_ERP = [
  'frontend/vendor/jquery/jquery.min.js',
  'frontend/shared/js/validarMotivo.js',
  'frontend/shared/js/access-control.js',
  'frontend/shared/js/core.js',
  'frontend/shared/js/vendasHistoricoUi.js',
  'frontend/shared/js/fiscalImpressao.js',
  'frontend/erp/js/nfe.js',
  'frontend/erp/js/pedidos.js',
  'frontend/erp/js/vendas.js',
  'frontend/erp/js/fiscal.js'
];

const janelas = [];
/**
 * `stubs`: respostas fixas por "METODO /api/caminho". O que não estiver em `stubs` vai ao
 * servidor express real (banco temporário) quando `servidorReal` for true.
 */
function criarJanela({ servidorReal = false } = {}) {
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
      const ev = new window.Event('hide.bs.modal', { cancelable: true });
      this.el.dispatchEvent(ev);
      if (ev.defaultPrevented) return;
      this.el.classList.remove('show');
      this.el.dispatchEvent(new window.Event('hidden.bs.modal'));
    }
  }
  window.bootstrap = { Modal: ModalStub };
  window.document.addEventListener('click', (ev) => {
    const botao = ev.target.closest('[data-bs-dismiss="modal"]');
    if (!botao || botao.disabled) return;
    const modal = botao.closest('.modal');
    if (modal) ModalStub.getOrCreateInstance(modal).hide();
  });
  for (const rel of SCRIPTS_ERP) window.eval(read(rel));
  window.CONFIG_IMPLANTACAO = { recursos: { fiscal: true, nfe: true } };
  window.eval('CONFIG_IMPLANTACAO = window.CONFIG_IMPLANTACAO;');
  const notificacoes = [];
  window.showNotification = (msg) => notificacoes.push(msg);
  window.viewVenda = () => {};
  window.confirm = () => true;
  const chamadas = [];
  const stubs = {};
  window.fetch = async (url, opts = {}) => {
    const u = new URL(url, 'http://localhost');
    const metodo = String(opts.method || 'GET').toUpperCase();
    const rota = `${metodo} ${u.pathname}`;
    chamadas.push({ rota, body: opts.body ? JSON.parse(opts.body) : undefined });
    const stub = stubs[rota];
    if (!stub && servidorReal) {
      return fetch(`${base}${u.pathname.replace(/^\/api/, '')}${u.search}`, {
        method: metodo,
        headers: { Authorization: `Bearer ${tokenAdmin}`, 'Content-Type': 'application/json' },
        body: opts.body
      });
    }
    const status = stub ? (stub.status || 200) : 404;
    const texto = JSON.stringify(stub ? stub.body : { success: false });
    return { ok: status < 300, status, headers: { get: () => null }, json: async () => JSON.parse(texto), text: async () => texto };
  };
  return { window, stubs, chamadas, notificacoes, posts: () => chamadas.filter((c) => c.rota.startsWith('POST ')) };
}
const DIAG_PRONTA = { success: true, pronta: true, itens: [], pendencias: [], chamadasSefaz: 0 };
const DIAG_NAO_PRONTA = {
  success: true, pronta: false, status: 'NAO_CONFIGURADA',
  itens: [{ id: 'certificado', nome: 'Certificado', nivel: 'pendente', ok: false, mensagem: 'Certificado A1 não configurado.' }],
  pendencias: ['Certificado'], chamadasSefaz: 0
};

function clicar(window, id) {
  const el = window.document.getElementById(id);
  assert.ok(el, `elemento #${id} existe`);
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
}

describe('NF-E-04.1 — abrir/cancelar o formulário não fatura (interface + backend real, banco temporário)', () => {
  after(() => {
    for (const w of janelas.splice(0)) w.close();
  });

  it('1/2) pedido: [Emitir NF-e] abre o formulário sem faturar; [Cancelar] não deixa venda, estoque, financeiro, FATURADO nem NF-e', async () => {
    const p = await novoPedido();
    const antes = await retrato(p.id);
    const ctx = criarJanela({ servidorReal: true });
    ctx.stubs['GET /api/nfe/prontidao'] = { body: DIAG_PRONTA };

    const cliente = await get('SELECT id, nome, cpf_cnpj, rua, numero, bairro, cidade, uf, cep FROM clientes WHERE id = ?', [clienteId]);
    const produto = await get('SELECT id, nome, preco_venda, saldo_fiscal, ativo FROM produtos WHERE id = ?', [produtoId]);
    ctx.stubs['GET /api/clientes'] = { body: [cliente] };
    ctx.stubs['GET /api/produtos'] = { body: [produto] };
    await ctx.window.pedAbrirPedido(p.id);
    assert.ok(ctx.window.document.getElementById('pedBtnEmitirNfe'), 'pedido elegível mostra [Emitir NF-e]');
    await ctx.window.pedEmitirNfe(p.id);
    const doc = ctx.window.document;
    const modal = doc.getElementById('modalEmitirNfe');
    assert.ok(doc.getElementById('nfeNovaPainel'), 'Nova NF-e aberta');
    assert.equal(modal.dataset.contexto, 'pedidos');
    assert.equal(modal.dataset.vendaId, '', 'nenhuma venda existe com o formulário aberto');
    assert.match(doc.getElementById('nfeOrigemComercial').textContent, /Pedido de origem/);
    assert.match(doc.getElementById('nfeAvisoFaturamento').textContent, /só é registrada ao confirmar/);
    assert.match(doc.getElementById('btnConfirmarEmissaoNfe').textContent, /Confirmar emissão/);
    assert.equal(doc.getElementById('nfeDestNome').value, 'CLIENTE TESTE NFE041', 'destinatário vem do cliente do pedido');
    assert.equal(doc.getElementById('nfeDestLogradouro').value, 'RUA CLIENTE');
    assert.equal(doc.getElementById('nfeDestCep').value, '63000000');
    assert.deepEqual(ctx.posts(), [], 'abrir o formulário não faz nenhum POST');
    assert.deepEqual(await retrato(p.id), antes, 'formulário aberto: nada mudou');

    ctx.window.nfeManualCancelarDocumento();
    assert.equal(doc.getElementById('nfeOrigemComercial'), null, 'origem do pedido retirada ao cancelar');
    assert.deepEqual(ctx.posts(), []);
    const depois = await retrato(p.id);
    assert.deepEqual(depois, antes, 'cancelar: pedido, vendas, estoque, financeiro, NF-e, NFC-e e numeração intactos');
    assert.equal(depois.pedido.status, 'ABERTO');
    assert.equal(depois.pedido.venda_id, null);
    assert.equal((await pedidos.obterPedido(p.id)).nfe.acao, 'emitir_pedido', 'pedido continua apto a emitir');
  });

  it('4) manual: Nova NF-e → itens → formulário → [Cancelar] não deixa nenhum efeito definitivo', async () => {
    const antes = await retrato();
    const ctx = criarJanela({ servidorReal: true });
    ctx.stubs['GET /api/nfe/prontidao'] = { body: DIAG_PRONTA };
    const cliente = await get('SELECT id, nome, cpf_cnpj, rua, numero, bairro, cidade, uf, cep FROM clientes WHERE id = ?', [clienteId]);
    const produto = await get('SELECT id, nome, preco_venda, saldo_fiscal, ativo FROM produtos WHERE id = ?', [produtoId]);
    ctx.stubs['GET /api/clientes'] = { body: [cliente] };
    ctx.stubs['GET /api/produtos'] = { body: [produto] };

    await ctx.window.abrirNfeManual();
    const doc = ctx.window.document;
    doc.getElementById('nfeManualCliente').value = String(clienteId);
    if (!doc.querySelector('#nfeManualItens tr[data-opc-item]')) ctx.window.opcAdicionarItem('nfeManual');
    const linha = doc.querySelector('#nfeManualItens tr[data-opc-item]');
    const sel = linha.querySelector('[data-campo="produto"]');
    sel.value = String(produtoId);
    ctx.window.opcAoTrocarProduto(sel, 'nfeManual');
    linha.querySelector('[data-campo="quantidade"]').value = '3';
    ctx.window.confirmarNfeManual();

    const modal = doc.getElementById('modalEmitirNfe');
    assert.ok(modal, 'formulário de emissão aberto');
    assert.equal(modal.dataset.contexto, 'manual');
    assert.equal(doc.getElementById('modalNfeManual').classList.contains('modal'), false, 'documento na página');
    assert.equal(doc.getElementById('nfeDestNome').value, 'CLIENTE TESTE NFE041');
    assert.deepEqual(ctx.posts(), [], 'continuar para emissão não registra nada');
    assert.deepEqual(await retrato(), antes);

    clicar(ctx.window, 'nfeBtnCancelarEmissao');
    assert.equal(doc.getElementById('modalEmitirNfe'), null);
    assert.deepEqual(ctx.posts(), []);
    assert.deepEqual(await retrato(), antes, 'cancelar a emissão manual: nada registrado');
  });

  it('9) confirmar com prontidão bloqueada (diagnóstico real): 409, mensagem clara, nenhuma operação definitiva', async () => {
    const p = await novoPedido();
    const antes = await retrato(p.id);
    const ctx = criarJanela({ servidorReal: true });
    ctx.stubs['GET /api/nfe/prontidao'] = { body: DIAG_PRONTA };
    const cliente = await get('SELECT id, nome, cpf_cnpj, rua, numero, bairro, cidade, uf, cep FROM clientes WHERE id = ?', [clienteId]);
    const produto = await get('SELECT id, nome, preco_venda, saldo_fiscal, ativo FROM produtos WHERE id = ?', [produtoId]);
    ctx.stubs['GET /api/clientes'] = { body: [cliente] };
    ctx.stubs['GET /api/produtos'] = { body: [produto] };
    await ctx.window.pedEmitirNfe(p.id);
    ctx.window.confirmarNfeManual();
    await ctx.window.confirmarEmissaoNfe();
    const post = ctx.posts();
    assert.equal(post.length, 1);
    assert.equal(post[0].rota, 'POST /api/nfe/pedidos/emitir');
    assert.deepEqual(post[0].body.pedido_ids, [p.id]);
    assert.equal(post[0].body.dados_nfe.dest_cpf, '52998224725');
    const doc = ctx.window.document;
    const erro = doc.getElementById('nfeResultadoErro');
    assert.ok(erro, 'resultado de bloqueio exibido (não "verificando")');
    assert.equal(doc.getElementById('nfeResultadoVerificando'), null);
    assert.match(erro.textContent, /Nenhuma venda foi registrada/);
    assert.deepEqual(await retrato(p.id), antes, 'prontidão bloqueada: nada faturado');

    const ctxManual = criarJanela({ servidorReal: true });
    ctxManual.window.abrirEmissaoNfeManual({ cliente_id: clienteId, itens: itensPadrao(), desconto: 0, forma_pagamento: 'dinheiro', parcelas: null },
      { nome: 'CLIENTE TESTE NFE041', cpf_cnpj: CPF_CLIENTE, rua: 'RUA CLIENTE', numero: '10', bairro: 'BAIRRO', cidade: 'JUAZEIRO DO NORTE', uf: 'CE', cep: '63000000' });
    await ctxManual.window.confirmarEmissaoNfe();
    const postManual = ctxManual.posts();
    assert.equal(postManual.length, 1);
    assert.equal(postManual[0].rota, 'POST /api/nfe/manual/emitir');
    assert.match(postManual[0].body.chave_operacao, /^nfe-manual-/);
    assert.ok(ctxManual.window.document.getElementById('nfeResultadoErro'));
    assert.deepEqual(await retrato(p.id), antes, 'manual com prontidão bloqueada: nada faturado');
  });
});

// ===========================================================================
// Confirmação (backend, SEFAZ simulada)
// ===========================================================================

describe('NF-E-04.1 — confirmar emissão fatura e emite pelo emissor existente', () => {
  it('3/6/8) pedido: confirmar cria a venda, baixa estoque, lança financeiro, FATURADO e NF-e origem PEDIDO; NFC-e não é acionada', async () => {
    const p = await novoPedido();
    const antes = await retrato(p.id);
    await proximoSegundo();
    const deps = depsOk();
    const { resultado, tentativas } = await semRede(() => confirmarPedido(p.id, deps));
    assert.deepEqual(tentativas, [], 'SEFAZ = 0 chamadas reais');
    assert.equal(deps.enviarLote.chamadas.length, 1, 'transmissão apenas pela SEFAZ simulada');
    assert.equal(resultado.status, 'autorizada');
    assert.equal(resultado.pedido_id, p.id);
    assert.equal(resultado.faturamento_desfeito, false);

    const vendaId = resultado.venda_id;
    const venda = await get('SELECT * FROM vendas WHERE id = ?', [vendaId]);
    assert.equal(venda.status, 'concluida');
    assert.equal(venda.origem_pdv, 'PEDIDO');
    const pedido = await get('SELECT status, venda_id, faturado_em FROM pedidos_comerciais WHERE id = ?', [p.id]);
    assert.equal(pedido.status, 'FATURADO');
    assert.equal(pedido.venda_id, vendaId);
    assert.ok(pedido.faturado_em);

    const depois = await retrato(p.id);
    assert.equal(depois.vendas, antes.vendas + 1, 'uma venda');
    assert.equal(depois.saldoFiscal, antes.saldoFiscal - 2, 'uma baixa de estoque');
    assert.ok(depois.financeiroAtivo > antes.financeiroAtivo, 'financeiro lançado');
    assert.equal(await contar('financeiro', 'venda_id = ?', [vendaId]), depois.financeiro - antes.financeiro);
    assert.equal(depois.nfe, antes.nfe + 1);
    assert.equal(depois.nfce, antes.nfce, 'NFC-e não acionada');

    const nota = await get('SELECT * FROM nfe_notas WHERE venda_id = ?', [vendaId]);
    assert.equal(nota.status, 'autorizada');
    assert.equal(nota.origem, 'PEDIDO');
    assert.equal(nota.pedido_id, p.id);
  });

  it('5/8) manual: confirmar cria venda NFE_MANUAL e NF-e origem MANUAL (pedido_id NULL, venda_id preenchido); NFC-e não é acionada', async () => {
    const antes = await retrato();
    await proximoSegundo();
    const deps = depsOk();
    const { resultado, tentativas } = await semRede(() => faturamento.confirmarEmissaoNfeManual(entradaManual(), { usuarioId: 1 }, deps));
    assert.deepEqual(tentativas, []);
    assert.equal(resultado.status, 'autorizada');
    assert.equal(resultado.reutilizado, false);
    const venda = await get('SELECT * FROM vendas WHERE id = ?', [resultado.venda_id]);
    assert.equal(venda.origem_pdv, 'NFE_MANUAL');
    const nota = await get('SELECT * FROM nfe_notas WHERE venda_id = ?', [resultado.venda_id]);
    assert.equal(nota.origem, 'MANUAL');
    assert.equal(nota.pedido_id, null);
    assert.equal(nota.venda_id, resultado.venda_id);
    const depois = await retrato();
    assert.equal(depois.vendas, antes.vendas + 1);
    assert.equal(depois.saldoFiscal, antes.saldoFiscal - 1);
    assert.equal(depois.nfce, antes.nfce);
  });

  it('7) duplo clique: pedido e manual geram uma única venda e uma única NF-e', async () => {
    const p = await novoPedido();
    const antes = await retrato(p.id);
    await proximoSegundo();
    const resultados = await Promise.allSettled([confirmarPedido(p.id, depsOk()), confirmarPedido(p.id, depsOk())]);
    const ok = resultados.filter((r) => r.status === 'fulfilled');
    const recusados = resultados.filter((r) => r.status === 'rejected');
    assert.equal(ok.length, 1, recusados.map((r) => `${r.reason.code}: ${r.reason.message}`).join(' | '));
    assert.equal(recusados[0].reason.code, 'FATURAMENTO_EM_ANDAMENTO');
    assert.equal((await retrato(p.id)).vendas, antes.vendas + 1);
    assert.equal(await contar('nfe_notas', 'pedido_id = ?', [p.id]), 1);

    const repetido = await confirmarPedido(p.id, depsOk());
    assert.equal(repetido.reutilizado, true, 'pedido já faturado não fatura de novo');
    assert.equal((await retrato(p.id)).vendas, antes.vendas + 1);

    await proximoSegundo();
    const entrada = entradaManual();
    const vendasAntesManual = await contar('vendas');
    const manuais = await Promise.allSettled([
      faturamento.confirmarEmissaoNfeManual(entrada, {}, depsOk()),
      faturamento.confirmarEmissaoNfeManual(entrada, {}, depsOk())
    ]);
    assert.equal(manuais.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(manuais.find((r) => r.status === 'rejected').reason.code, 'OPERACAO_EM_ANDAMENTO');
    const repetidoManual = await faturamento.confirmarEmissaoNfeManual(entrada, {}, depsOk());
    assert.equal(repetidoManual.reutilizado, true, 'mesma chave_operacao reaproveita a venda');
    assert.equal(await contar('vendas'), vendasAntesManual + 1, 'uma venda manual só');
  });

  it('9) prontidão bloqueada e dados NF-e incompletos: recusados antes de faturar (pedido e manual)', async () => {
    const p = await novoPedido();
    const antes = await retrato(p.id);
    await assert.rejects(confirmarPedido(p.id, { diagnosticar: NAO_PRONTA }), { code: 'NFE_NAO_PRONTA' });
    await assert.rejects(faturamento.confirmarEmissaoNfeManual(entradaManual(), {}, { diagnosticar: NAO_PRONTA }), { code: 'NFE_NAO_PRONTA' });
    await assert.rejects(confirmarPedido(p.id, depsOk(), { ...dadosNfe(), dest_cep: '' }), { code: 'DADOS_NFE_INCOMPLETOS' });
    await assert.rejects(confirmarPedido(p.id, depsOk(), { ...dadosNfe(), dest_cpf: '11111111111' }), { code: 'DEST_DOCUMENTO_INVALIDO' });
    await assert.rejects(faturamento.confirmarEmissaoNfeManual(entradaManual({ chaveOperacao: '' }), {}, depsOk()), { code: 'CHAVE_OPERACAO_OBRIGATORIA' });
    assert.deepEqual(await retrato(p.id), antes, 'nada faturado');
  });
});

// ===========================================================================
// 10 — falha do emissor não deixa faturamento parcial
// ===========================================================================

describe('NF-E-04.1 — falha do emissor', () => {
  it('10) pedido: emissor falha sem registrar NF-e → venda cancelada pelo fluxo oficial, estoque e financeiro estornados, pedido ABERTO', async () => {
    const p = await novoPedido();
    const antes = await retrato(p.id);
    await proximoSegundo();
    // Sem certificado injetado: o emissor existente recusa por configuração, sem gravar nfe_notas.
    const { resultado, tentativas } = await semRede(() => confirmarPedido(p.id, { diagnosticar: PRONTA, depsEmissao: {} }));
    assert.deepEqual(tentativas, []);
    assert.equal(resultado.success, false);
    assert.equal(resultado.faturamento_desfeito, true, resultado.message);
    const vendaId = resultado.venda_id;

    const venda = await get('SELECT status, cancelada FROM vendas WHERE id = ?', [vendaId]);
    assert.equal(venda.status, 'cancelada');
    assert.equal(venda.cancelada, 1);
    const cancelamento = await get('SELECT motivo FROM vendas_canceladas WHERE venda_id = ?', [vendaId]);
    assert.match(cancelamento.motivo, /NF-e não emitida/);
    assert.equal(await contar('financeiro', "venda_id = ? AND COALESCE(status, '') != 'cancelado'", [vendaId]), 0, 'financeiro estornado');

    const depois = await retrato(p.id);
    assert.deepEqual(depois.pedido, antes.pedido, 'pedido volta a ABERTO, sem venda_id nem faturado_em');
    assert.equal(depois.saldoFiscal, antes.saldoFiscal, 'estoque devolvido');
    assert.equal(depois.estoqueAtual, antes.estoqueAtual);
    assert.equal(depois.financeiroAtivo, antes.financeiroAtivo);
    assert.equal(depois.vendasConcluidas, antes.vendasConcluidas, 'nenhuma venda concluída a mais');
    assert.equal(depois.nfe, antes.nfe, 'nenhuma NF-e');
    assert.equal(depois.nfce, antes.nfce);

    await proximoSegundo();
    const nova = await confirmarPedido(p.id, depsOk());
    assert.equal(nova.status, 'autorizada', 'pedido pode ser emitido de novo após a falha');
    assert.notEqual(nova.venda_id, vendaId);
  });

  it('10) manual: emissor lança exceção → faturamento desfeito e a mesma chave pode ser confirmada de novo', async () => {
    const antes = await retrato();
    const entrada = entradaManual();
    await proximoSegundo();
    const falha = await faturamento.confirmarEmissaoNfeManual(entrada, {}, {
      diagnosticar: PRONTA,
      emitirNfePorVendaId: async () => { throw new Error('falha simulada do emissor'); }
    });
    assert.equal(falha.success, false);
    assert.equal(falha.faturamento_desfeito, true);
    assert.match(falha.message, /falha simulada/);
    const depois = await retrato();
    assert.equal(depois.saldoFiscal, antes.saldoFiscal);
    assert.equal(depois.financeiroAtivo, antes.financeiroAtivo);
    assert.equal(depois.vendasConcluidas, antes.vendasConcluidas);
    assert.equal(depois.nfe, antes.nfe);

    await proximoSegundo();
    const nova = await faturamento.confirmarEmissaoNfeManual(entrada, {}, depsOk());
    assert.equal(nova.reutilizado, false, 'venda desfeita não é reaproveitada');
    assert.equal(nova.status, 'autorizada');
  });

  it('10) NF-e rejeitada (registrada): venda e FATURADO mantidos; nova tentativa usa a mesma venda', async () => {
    const p = await novoPedido();
    const antes = await retrato(p.id);
    await proximoSegundo();
    const rejeicao = await confirmarPedido(p.id, depsOk({ cStat: '225', xMotivo: 'Rejeicao: Falha no Schema XML' }));
    assert.equal(rejeicao.status, 'rejeitada');
    assert.equal(rejeicao.faturamento_desfeito, false, 'com NF-e registrada a venda não é desfeita');
    const pedido = await get('SELECT status, venda_id FROM pedidos_comerciais WHERE id = ?', [p.id]);
    assert.equal(pedido.status, 'FATURADO');
    assert.equal(pedido.venda_id, rejeicao.venda_id);
    assert.equal((await retrato(p.id)).vendas, antes.vendas + 1);

    const nova = await confirmarPedido(p.id, depsOk());
    assert.equal(nova.reutilizado, true);
    assert.equal(nova.venda_id, rejeicao.venda_id);
    assert.equal(nova.status, 'autorizada');
    assert.equal((await retrato(p.id)).vendas, antes.vendas + 1, 'nenhuma venda nova');
    assert.equal((await retrato(p.id)).saldoFiscal, antes.saldoFiscal - 2, 'uma baixa só');
  });

  it('10) se o desfazimento falhar, a resposta sinaliza FATURAMENTO_PENDENTE_REVISAO (venda e pedido preservados para revisão)', async () => {
    const p = await novoPedido();
    await proximoSegundo();
    const r = await confirmarPedido(p.id, {
      diagnosticar: PRONTA,
      depsEmissao: {},
      cancelarVenda: async () => { throw new Error('cancelamento indisponível (simulado)'); }
    });
    assert.equal(r.faturamento_desfeito, false);
    assert.equal(r.codigo_desfazimento, 'FATURAMENTO_PENDENTE_REVISAO');
    assert.match(r.mensagem_desfazimento, /Cancele a venda manualmente/);
    const pedido = await get('SELECT status, venda_id FROM pedidos_comerciais WHERE id = ?', [p.id]);
    assert.equal(pedido.venda_id, r.venda_id, 'vínculo pedido↔venda mantido para revisão');
    const situacao = (await pedidos.obterPedido(p.id)).nfe;
    assert.equal(situacao.pode_emitir, true, 'pedido faturado sem NF-e continua com [Emitir NF-e] pela venda');
  });
});

// ===========================================================================
// Interface — roteamento da confirmação e interpretação das respostas
// ===========================================================================

describe('NF-E-04.1 — interface: confirmação', () => {
  after(() => {
    for (const w of janelas.splice(0)) w.close();
  });

  const PEDIDO = { id: 5, codigo: 'PED-000005', status: 'ABERTO', cliente_id: 9, cliente_nome: 'MARIA', cliente_documento: CPF_CLIENTE,
    cliente_rua: 'RUA A', cliente_numero: '1', cliente_bairro: 'CENTRO', cliente_cidade: 'CRATO', cliente_uf: 'CE', cliente_cep: '63100-000',
    itens: [{ produto_id: 1, produto_nome: 'SORVETE', quantidade: 2, preco_unitario: 10, subtotal: 20 }],
    nfe: { pode_emitir: true, acao: 'emitir_pedido' } };

  it('pedido: confirmar envia uma única requisição (duplo clique bloqueado) e, com venda faturada, a nova tentativa segue pela venda', async () => {
    const ctx = criarJanela();
    ctx.stubs['GET /api/nfe/prontidao'] = { body: DIAG_PRONTA };
    ctx.stubs['GET /api/clientes'] = { body: [{ id: 9, nome: 'MARIA', cpf_cnpj: CPF_CLIENTE, rua: 'RUA A', numero: '1', bairro: 'CENTRO', cidade: 'CRATO', uf: 'CE', cep: '63100000' }] };
    ctx.stubs['GET /api/produtos'] = { body: [{ id: 1, nome: 'SORVETE', preco_venda: 60, ativo: 1 }] };
    ctx.stubs['GET /api/pedidos/5'] = { body: PEDIDO };
    ctx.stubs['POST /api/nfe/pedidos/emitir'] = {
      body: { success: false, status: 'rejeitada', notaId: 3, venda_id: 77, pedido_id: 5, faturamento_desfeito: false, cStat: '225', xMotivo: 'Rejeicao: Falha no Schema XML' }
    };
    ctx.stubs['GET /api/nfe/notas/3'] = { body: { success: true, nota: { id: 3, erro_sugestao: 'Revise o XML.' } } };
    ctx.stubs['POST /api/nfe/vendas/77/emitir'] = { body: { success: true, status: 'autorizada', notaId: 4, numero: 2, serie: 1 } };
    await ctx.window.pedEmitirNfe(5);
    ctx.window.confirmarNfeManual();
    await Promise.all([ctx.window.confirmarEmissaoNfe(), ctx.window.confirmarEmissaoNfe()]);
    assert.deepEqual(ctx.posts().map((c) => c.rota), ['POST /api/nfe/pedidos/emitir'], 'duplo clique: uma requisição');
    const doc = ctx.window.document;
    assert.ok(doc.getElementById('nfeResultadoRejeitada'));
    const modal = doc.getElementById('modalEmitirNfe');
    assert.equal(modal.dataset.vendaId, '77');

    await ctx.window.confirmarEmissaoNfe();
    assert.deepEqual(ctx.posts().map((c) => c.rota), ['POST /api/nfe/pedidos/emitir', 'POST /api/nfe/vendas/77/emitir'],
      'nova tentativa usa a venda existente, sem novo faturamento');
    assert.ok(doc.getElementById('nfeResultadoAutorizada'));
  });

  it('manual: faturamento desfeito mantém o contexto manual e informa o estorno', async () => {
    const ctx = criarJanela();
    ctx.stubs['POST /api/nfe/manual/emitir'] = {
      body: { success: false, status: 'configuracao_pendente', message: 'Certificado não configurado.', venda_id: 90, faturamento_desfeito: true }
    };
    ctx.window.abrirEmissaoNfeManual({ cliente_id: 1, itens: [{ produto_id: 1, quantidade: 1, preco_unitario: 5 }], desconto: 0, forma_pagamento: 'dinheiro', parcelas: null },
      { nome: 'MARIA', cpf_cnpj: CPF_CLIENTE, rua: 'RUA A', numero: '1', bairro: 'CENTRO', cidade: 'CRATO', uf: 'CE', cep: '63100000' });
    await ctx.window.confirmarEmissaoNfe();
    const doc = ctx.window.document;
    assert.match(doc.getElementById('nfeResultadoErro').textContent, /cancelada automaticamente/);
    assert.equal(doc.getElementById('modalEmitirNfe').dataset.vendaId, '', 'venda desfeita não vira contexto');
    await ctx.window.confirmarEmissaoNfe();
    const posts = ctx.posts();
    assert.equal(posts.length, 2);
    assert.ok(posts.every((c) => c.rota === 'POST /api/nfe/manual/emitir'));
    assert.match(posts[0].body.chave_operacao, /^nfe-manual-/);
    assert.equal(posts[1].body.chave_operacao, posts[0].body.chave_operacao, 'mesma operação, mesma chave');
  });

  it('classificação: recusa anterior ao faturamento não é "verificando"; desfazimento e pendência de revisão são informados', () => {
    const c = nfeUi.classificarResultadoConfirmacaoNfe;
    const naoPronta = c({ status: 409, data: { success: false, codigo: 'NFE_NAO_PRONTA', mensagem: 'NF-e não está pronta.', pendencias: ['Certificado'] } });
    assert.equal(naoPronta.tipo, 'bloqueada');
    assert.match(naoPronta.mensagem, /Certificado/);
    assert.match(naoPronta.mensagem, /Nenhuma venda foi registrada/);
    assert.equal(c({ status: 409, data: { success: false, codigo: 'FATURAMENTO_EM_ANDAMENTO', mensagem: 'x' } }).tipo, 'bloqueada');
    const incompleto = c({ status: 400, data: { success: false, codigo: 'DADOS_NFE_INCOMPLETOS', mensagem: 'Dados da NF-e incompletos: CEP.' } });
    assert.equal(incompleto.tipo, 'erro');
    assert.equal(incompleto.podeTentarNovamente, true);
    assert.equal(c({ status: 200, data: { success: true, status: 'autorizada', venda_id: 1 } }).tipo, 'autorizada');
    const pendente = c({ status: 200, data: { success: false, status: 'erro', message: 'x', codigo_desfazimento: 'FATURAMENTO_PENDENTE_REVISAO', mensagem_desfazimento: 'Cancele a venda manualmente.' } });
    assert.match(pendente.mensagem, /Cancele a venda manualmente/);
    assert.equal(pendente.podeTentarNovamente, false);
    assert.equal(c({ status: 403, data: { error: 'sem permissão' } }).tipo, 'sem_permissao');
  });
});

// ===========================================================================
// Fronteira no código
// ===========================================================================

describe('NF-E-04.1 — fronteira no código', () => {
  it('rotas que faturavam sem emitir foram removidas; confirmação é a única entrada de faturamento NF-e', () => {
    const rotasPedidos = read('backend/rotas/pedidos.js');
    const rotasNfe = read('backend/rotas/nfe.js');
    assert.doesNotMatch(rotasPedidos, /faturar-nfe/);
    assert.match(rotasPedidos, /'\/:id\/emitir-nfe'/);
    assert.doesNotMatch(rotasNfe, /router\.post\('\/manual',/);
    assert.match(rotasNfe, /router\.post\('\/manual\/emitir',/);
    assert.equal(pedidos.faturarPedidoParaNfe, undefined);
    const ui = read('frontend/erp/js/pedidos.js') + read('frontend/erp/js/nfe.js');
    assert.doesNotMatch(ui, /faturar-nfe|'\/nfe\/manual'/);
  });

  it('novos arquivos não montam XML, não assinam, não usam SOAP nem reservam número', () => {
    for (const rel of ['backend/services/vendas/cancelarVendaInterna.js', 'backend/services/vendas/faturamentoNfeService.js']) {
      assert.doesNotMatch(read(rel), /xmlBuilder|buildNfeXml|assinar|SignedXml|soapClient|enviarLote|https?\.request|reservarIdentidade|proximoNumero|fiscal_numeracao/i, rel);
    }
    assert.match(read('backend/services/vendas/cancelarVendaInterna.js'), /cancelarVendaPost/);
  });

  it('pedido e venda: fonte única de verdade, sem reclassificar vendas PDV', async () => {
    const pdv = await all("SELECT id FROM vendas WHERE origem_pdv NOT IN ('PEDIDO', 'NFE_MANUAL') OR origem_pdv IS NULL");
    assert.equal(pdv.length, 0, 'banco de teste só contém vendas criadas por pedido/manual');
    const notas = await all('SELECT origem, pedido_id, venda_id FROM nfe_notas');
    assert.ok(notas.length > 0);
    for (const n of notas) {
      assert.ok(['PEDIDO', 'MANUAL'].includes(n.origem));
      assert.ok(n.venda_id);
      if (n.origem === 'PEDIDO') assert.ok(n.pedido_id);
      else assert.equal(n.pedido_id, null);
    }
  });
});
