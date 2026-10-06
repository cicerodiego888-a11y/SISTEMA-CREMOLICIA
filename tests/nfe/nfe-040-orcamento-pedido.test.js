/**
 * NF-E-04.0 — Orçamento → Pedido → NF-e 55 e emissão manual.
 *
 * Banco isolado em %TEMP%. Faturamento pelo criarVenda real (estoque/financeiro do fluxo
 * oficial) com a rede bloqueada; emissão apenas com SEFAZ simulada por injeção de
 * dependência. Nenhum acesso ao banco ativo, nenhuma chamada real à SEFAZ.
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

const DIR = path.join(os.tmpdir(), 'cds-nfe-testes', 'pedido-040');
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
const auth = require('../../backend/middleware/auth');
const emissor = require(path.join(FISCAL, 'nfeEmissorVenda'));
const lock = require(path.join(FISCAL, 'nfeEmissionLockService'));
const faturamento = require('../../backend/services/vendas/faturamentoNfeService');
const pedidos = require('../../backend/services/pedidos/orcamentoPedidoService');
const nfeUi = require('../../frontend/erp/js/nfe.js');
const pedUi = require('../../frontend/erp/js/pedidos.js');

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
async function contar(tabela, where = '1=1', params = []) {
  try {
    const r = await get(`SELECT COUNT(*) AS n FROM ${tabela} WHERE ${where}`, params);
    return Number(r.n);
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

// --- SEFAZ simulada (somente para provar que a emissão usa o motor existente) ---
let chaves;
let material;
function certificado(cnpj) {
  const cert = forge.pki.createCertificate();
  cert.publicKey = chaves.publicKey;
  cert.serialNumber = '040';
  cert.validity.notBefore = new Date(Date.now() - 86400000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86400000);
  const attrs = [{ name: 'commonName', value: `CREMOLICIA TESTE:${cnpj}` }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(chaves.privateKey, forge.md.sha256.create());
  return cert;
}
function retornoSefaz(loteXml) {
  const chave = (String(loteXml).match(/Id="NFe(\d{44})"/) || [])[1];
  const prot = `<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><verAplic>SVRS</verAplic><chNFe>${chave}</chNFe>`
    + '<dhRecbto>2026-10-04T10:00:00-03:00</dhRecbto><nProt>223260000000040</nProt>'
    + '<digVal>abc=</digVal><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe>';
  return '<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>'
    + '<nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4"><retEnviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">'
    + '<tpAmb>2</tpAmb><verAplic>SVRS</verAplic><cStat>104</cStat><xMotivo>Lote processado</xMotivo>'
    + `<cUF>23</cUF><dhRecbto>2026-10-04T10:00:00-03:00</dhRecbto>${prot}</retEnviNFe></nfeResultMsg></soap:Body></soap:Envelope>`;
}
function loteSimulado() {
  const chamadas = [];
  const fn = async (args) => {
    chamadas.push(args);
    return { success: true, status: 'soap_enviado', raw: retornoSefaz(args.loteXml) };
  };
  fn.chamadas = chamadas;
  return fn;
}
function depsEmissao(extra = {}) {
  return { carregarCertificado: () => material, inspecionarCertificado: () => ({ cnpj: CNPJ }), ...extra };
}
const dadosNfe = () => nfeUi.montarPayloadEmissaoNfe({
  tipo: 'CPF', documento: CPF_CLIENTE, nome: 'CLIENTE NFE 040', logradouro: 'RUA DAS FLORES', numero: '45',
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

const PRONTA = async () => ({ pronta: true, pendencias: [], chamadasSefaz: 0 });
const NAO_PRONTA = async () => ({ pronta: false, pendencias: ['Certificado'], chamadasSefaz: 0 });
const depsFat = (extra = {}) => ({ diagnosticar: PRONTA, ...extra });

let produtoId;
let clienteId;
let clienteSemEndereco;
let server;
let base;
let tokenOperador;
let tokenAdmin;

// criarVenda gera vendas.codigo com resolução de segundo (VND-AAAAMMDDHHMMSS, índice único).
const proximoSegundo = () => new Promise((resolve) => setTimeout(resolve, 1100));

const itensPadrao = () => [{ produto_id: produtoId, quantidade: 2, preco_unitario: 10 }];
const saldoFiscal = async () => Number((await get('SELECT saldo_fiscal FROM produtos WHERE id = ?', [produtoId])).saldo_fiscal);

async function novoPedidoDireto(dados = {}) {
  return pedidos.criarPedidoDireto({ cliente_id: clienteId, itens: itensPadrao(), forma_pagamento: 'dinheiro', ...dados });
}

before(async () => {
  assert.ok(path.resolve(process.env.DB_DIR).startsWith(path.resolve(os.tmpdir())), 'teste deve usar banco temporário');
  await new Promise((resolve, reject) => db.whenReady((err) => (err ? reject(err) : resolve())));
  assert.equal(path.resolve(db.dbPath), path.resolve(DIR, 'mercadao.db'));
  chaves = forge.pki.rsa.generateKeyPair(2048);
  material = {
    privateKeyPem: forge.pki.privateKeyToPem(chaves.privateKey),
    certPem: forge.pki.certificateToPem(certificado(CNPJ))
  };
  for (const [k, v] of Object.entries(CONFIG_BASE)) await setConfig(k, v);

  produtoId = (await run(
    `INSERT INTO produtos (codigo, nome, unidade, preco_venda, estoque_atual, saldo_fiscal, saldo_nao_fiscal, ncm, cfop, csosn, origem, ativo)
     VALUES ('SORV-040', 'SORVETE TESTE 040', 'UN', 10, 100, 100, 0, '21050010', '5102', '102', '0', 1)`
  )).id;
  clienteId = (await run(
    `INSERT INTO clientes (nome, cpf_cnpj, rua, numero, bairro, cidade, uf, cep)
     VALUES ('CLIENTE TESTE NFE040', ?, 'RUA CLIENTE', '10', 'BAIRRO', 'JUAZEIRO DO NORTE', 'CE', '63000-000')`,
    [CPF_CLIENTE]
  )).id;
  clienteSemEndereco = (await run(
    `INSERT INTO clientes (nome, cpf_cnpj, cidade, uf) VALUES ('CLIENTE SEM ENDERECO', '111.444.777-35', 'JUAZEIRO DO NORTE', 'CE')`
  )).id;

  const operadorId = (await run(`INSERT INTO usuarios (username, password_hash, role) VALUES ('nfe040op', 'x', 'operador')`)).id;
  tokenOperador = jwt.sign({ id: operadorId, username: 'nfe040op', role: 'operador', perfil: 'USUARIO' }, auth.JWT_SECRET);
  const adminId = (await run(`INSERT INTO usuarios (username, password_hash, role) VALUES ('nfe040adm', 'x', 'admin')`)).id;
  tokenAdmin = jwt.sign({ id: adminId, username: 'nfe040adm', role: 'admin', perfil: 'ADMIN' }, auth.JWT_SECRET);

  const { orcamentosRouter, pedidosRouter } = require('../../backend/rotas/pedidos');
  const app = express();
  app.use(express.json());
  app.use('/api/nfe', auth.verificarToken, require('../../backend/rotas/nfe'));
  app.use('/api/orcamentos', auth.verificarToken, orcamentosRouter);
  app.use('/api/pedidos', auth.verificarToken, pedidosRouter);
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  lock.resetLocksForTests();
  if (server) await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => db.close(() => resolve()));
});

async function api(metodo, caminho, token, body) {
  const resp = await fetch(`${base}${caminho}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  let data = {};
  try { data = await resp.json(); } catch (_) { data = {}; }
  return { status: resp.status, data };
}

// ===========================================================================
// A, B, C — Orçamento → Pedido
// ===========================================================================

describe('NF-E-04.0 — orçamento → pedido', () => {
  it('A) orçamento aprovado gera pedido; orçamento preservado; nada é faturado nem emitido', async () => {
    const vendasAntes = await contar('vendas');
    const notasAntes = await contar('nfe_notas');
    const saldoAntes = await saldoFiscal();
    const orc = await pedidos.criarOrcamento({
      cliente_id: clienteId,
      itens: [{ produto_id: produtoId, quantidade: 3, preco_unitario: 12.5 }],
      desconto: 2.5,
      forma_pagamento: 'pix'
    });
    assert.equal(orc.status, 'RASCUNHO');
    assert.match(orc.codigo, /^ORC-\d{6}$/);
    assert.equal(orc.total, 35);
    const apresentado = await pedidos.alterarStatusOrcamento(orc.id, 'APRESENTADO');
    assert.equal(apresentado.status, 'APRESENTADO');

    const pedido = await pedidos.aprovarOrcamento(orc.id);
    assert.equal(pedido.status, 'ABERTO');
    assert.equal(pedido.origem, 'ORCAMENTO');
    assert.match(pedido.codigo, /^PED-\d{6}$/);
    assert.equal(pedido.cliente_id, clienteId);
    assert.equal(pedido.itens.length, 1);
    assert.equal(pedido.itens[0].quantidade, 3);
    assert.equal(pedido.itens[0].preco_unitario, 12.5);
    assert.equal(pedido.total_itens, 37.5);
    assert.equal(pedido.desconto, 2.5);
    assert.equal(pedido.total, 35);
    assert.equal(pedido.forma_pagamento, 'pix');
    assert.equal(pedido.venda_id, null);

    const orcDepois = await pedidos.obterOrcamento(orc.id);
    assert.equal(orcDepois.status, 'APROVADO');
    assert.equal(orcDepois.pedido_id, pedido.id);
    assert.equal(orcDepois.itens.length, 1, 'orçamento e seus itens são preservados');

    assert.equal(await contar('vendas'), vendasAntes, 'aprovação não gera venda');
    assert.equal(await contar('nfe_notas'), notasAntes, 'aprovação não emite NF-e');
    assert.equal(await saldoFiscal(), saldoAntes, 'aprovação não movimenta estoque');
  });

  it('B) pedido guarda orcamento_id; aprovar de novo devolve o mesmo pedido; transições inválidas bloqueadas', async () => {
    const orc = await pedidos.criarOrcamento({ cliente_id: clienteId, itens: itensPadrao() });
    const p1 = await pedidos.aprovarOrcamento(orc.id);
    assert.equal(p1.orcamento_id, orc.id);
    assert.equal(p1.orcamento_codigo, orc.codigo);
    const p2 = await pedidos.aprovarOrcamento(orc.id);
    assert.equal(p2.id, p1.id, 'aprovação idempotente');
    assert.equal(await contar('pedidos_comerciais', 'orcamento_id = ?', [orc.id]), 1);

    await assert.rejects(pedidos.alterarStatusOrcamento(orc.id, 'CANCELADO'), { code: 'TRANSICAO_INVALIDA' });
    await assert.rejects(pedidos.atualizarOrcamento(orc.id, { cliente_id: clienteId, itens: itensPadrao() }), { code: 'ORCAMENTO_NAO_EDITAVEL' });

    const reprovado = await pedidos.criarOrcamento({ cliente_id: clienteId, itens: itensPadrao() });
    await pedidos.alterarStatusOrcamento(reprovado.id, 'REPROVADO');
    await assert.rejects(pedidos.aprovarOrcamento(reprovado.id), { code: 'TRANSICAO_INVALIDA' });
    await assert.rejects(pedidos.alterarStatusOrcamento(reprovado.id, 'APROVADO'), { code: 'TRANSICAO_INVALIDA' });
    assert.equal(await contar('pedidos_comerciais', 'orcamento_id = ?', [reprovado.id]), 0);
    assert.equal((await pedidos.obterOrcamento(reprovado.id)).status, 'REPROVADO', 'orçamento reprovado continua registrado');
  });

  it('C) pedido direto: origem DIRETO, orcamento_id NULL; banco recusa origem incoerente', async () => {
    const p = await novoPedidoDireto();
    assert.equal(p.origem, 'DIRETO');
    assert.equal(p.orcamento_id, null);
    assert.equal(p.status, 'ABERTO');
    assert.equal(p.total, 20);
    await assert.rejects(
      run("INSERT INTO pedidos_comerciais (origem, orcamento_id, cliente_id) VALUES ('DIRETO', 1, ?)", [clienteId]),
      /CHECK constraint failed/
    );
    await assert.rejects(
      run("INSERT INTO pedidos_comerciais (origem, orcamento_id, cliente_id) VALUES ('ORCAMENTO', NULL, ?)", [clienteId]),
      /CHECK constraint failed/
    );
    await assert.rejects(
      run("INSERT INTO pedidos_comerciais (origem, orcamento_id, cliente_id) VALUES ('BALCAO', NULL, ?)", [clienteId]),
      /CHECK constraint failed/
    );
  });
});

// ===========================================================================
// D, E, F, J, K, L, M — Pedido → NF-e
// ===========================================================================

describe('NF-E-04.0 — pedido → NF-e', () => {
  it('D) pedido elegível: situação NF-e permite emitir (ação emitir_pedido)', async () => {
    const p = await novoPedidoDireto();
    assert.equal(p.nfe.pode_emitir, true);
    assert.equal(p.nfe.acao, 'emitir_pedido');
    assert.equal(p.nfe.motivo_bloqueio, null);
  });

  const confirmarPedido = (id, deps = depsFat()) => pedidos.confirmarEmissaoNfePedido(id, { dadosNfe: dadosNfe() }, {}, deps);

  it('E) pedido não elegível é bloqueado: cliente sem endereço, sem estoque fiscal, cancelado', async () => {
    const semEndereco = await pedidos.criarPedidoDireto({ cliente_id: clienteSemEndereco, itens: itensPadrao() });
    assert.equal(semEndereco.nfe.pode_emitir, false);
    assert.equal(semEndereco.nfe.codigo, 'CLIENTE_ENDERECO_INCOMPLETO');
    await assert.rejects(confirmarPedido(semEndereco.id), { code: 'CLIENTE_ENDERECO_INCOMPLETO' });

    const semEstoque = await novoPedidoDireto({ itens: [{ produto_id: produtoId, quantidade: 100000, preco_unitario: 10 }] });
    assert.equal(semEstoque.nfe.pode_emitir, false);
    assert.equal(semEstoque.nfe.codigo, 'SEM_PARCELA_FISCAL');

    const cancelado = await pedidos.cancelarPedido((await novoPedidoDireto()).id);
    assert.equal(cancelado.status, 'CANCELADO');
    assert.equal(cancelado.nfe.pode_emitir, false);
    await assert.rejects(confirmarPedido(cancelado.id), { code: 'PEDIDO_NAO_ELEGIVEL' });

    assert.equal((await pedidos.obterPedido(semEndereco.id)).status, 'ABERTO');
    assert.equal(await contar('vendas', "origem_pdv = 'PEDIDO' AND id IN (SELECT venda_id FROM pedidos_comerciais WHERE id IN (?, ?, ?))",
      [semEndereco.id, semEstoque.id, cancelado.id]), 0);
  });

  it('J) prontidão não pronta bloqueia antes de gerar venda', async () => {
    const p = await novoPedidoDireto();
    const vendasAntes = await contar('vendas');
    const saldoAntes = await saldoFiscal();
    await assert.rejects(
      confirmarPedido(p.id, { diagnosticar: NAO_PRONTA }),
      (err) => err.code === 'NFE_NAO_PRONTA' && err.statusCode === 409 && err.pendencias.includes('Certificado')
    );
    assert.equal((await pedidos.obterPedido(p.id)).status, 'ABERTO');
    assert.equal(await contar('vendas'), vendasAntes);
    assert.equal(await saldoFiscal(), saldoAntes);
  });

  it('F/K/L/M) confirmar emissão: uma venda pelo fluxo oficial + NF-e pelo motor existente (origem PEDIDO), sem NFC-e', async () => {
    const p = await novoPedidoDireto();
    const antes = {
      vendas: await contar('vendas'),
      nfe: await contar('nfe_notas'),
      nfce: await contar('nfce_notas'),
      saldo: await saldoFiscal()
    };
    await proximoSegundo();
    const enviar = loteSimulado();
    const { resultado, tentativas } = await semRede(() => confirmarPedido(p.id, depsFat({ depsEmissao: depsEmissao({ enviarLote: enviar }) })));
    assert.deepEqual(tentativas, [], 'nenhuma tentativa de rede (SEFAZ simulada)');
    assert.equal(enviar.chamadas.length, 1);
    assert.equal(resultado.status, 'autorizada');
    assert.equal(resultado.reutilizado, false);
    assert.equal(resultado.faturamento_desfeito, false);
    const vendaPedido = resultado.venda_id;
    const pedidoFaturado = await pedidos.obterPedido(p.id);

    assert.equal(pedidoFaturado.status, 'FATURADO');
    assert.equal(pedidoFaturado.venda_id, vendaPedido);
    const venda = await get('SELECT * FROM vendas WHERE id = ?', [vendaPedido]);
    assert.equal(venda.status, 'concluida');
    assert.equal(venda.origem_pdv, 'PEDIDO');
    assert.equal(venda.cliente_id, clienteId);
    assert.equal(Number(venda.total), 20);
    assert.equal(Number(venda.valor_fiscal), 20, 'parcela fiscal integral para a NF-e');

    assert.equal(await contar('vendas'), antes.vendas + 1);
    assert.equal(await saldoFiscal(), antes.saldo - 2, 'uma única baixa de estoque, pelo criarVenda');
    assert.equal(await contar('nfe_notas'), antes.nfe + 1);
    assert.equal(await contar('nfce_notas'), antes.nfce, 'venda para NF-e não dispara NFC-e');
    const nota = await get('SELECT * FROM nfe_notas WHERE venda_id = ? ORDER BY id DESC LIMIT 1', [vendaPedido]);
    assert.equal(nota.origem, 'PEDIDO');
    assert.equal(nota.pedido_id, p.id, 'pedido_id vem do vínculo no banco');
    assert.equal(pedidoFaturado.nfe.nota.status, 'autorizada');
    assert.equal(pedidoFaturado.nfe.pode_emitir, false);

    const repetido = await confirmarPedido(p.id, depsFat({ depsEmissao: depsEmissao({ enviarLote: loteSimulado() }) }));
    assert.equal(repetido.reutilizado, true);
    assert.equal(repetido.venda_id, vendaPedido);
    assert.equal(await contar('vendas'), antes.vendas + 1, 'confirmar de novo não fatura outra vez');
    assert.equal(await saldoFiscal(), antes.saldo - 2);
    assert.equal(await contar('nfe_notas'), antes.nfe + 1, 'NF-e autorizada não é emitida de novo');
  });
});

// ===========================================================================
// G, H — Emissão manual
// ===========================================================================

describe('NF-E-04.0 — emissão manual', () => {
  it('G/H) manual gera venda NFE_MANUAL; NF-e grava origem MANUAL e pedido_id NULL', async () => {
    const saldoAntes = await saldoFiscal();
    const numeracaoAntes = await numeracaoFiscal();
    await proximoSegundo();
    const { resultado: fat, tentativas } = await semRede(() => faturamento.faturarOperacaoNfe({
      origem: faturamento.ORIGEM_VENDA.MANUAL,
      clienteId,
      itens: [{ produto_id: produtoId, quantidade: 1, preco_unitario: 15 }],
      formaPagamento: 'dinheiro'
    }, depsFat()));
    assert.deepEqual(tentativas, []);
    assert.equal(await numeracaoFiscal(), numeracaoAntes, 'faturar não reserva número');
    const venda = await get('SELECT * FROM vendas WHERE id = ?', [fat.vendaId]);
    assert.equal(venda.origem_pdv, 'NFE_MANUAL');
    assert.equal(await saldoFiscal(), saldoAntes - 1);
    assert.deepEqual(await emissor.resolverOrigemNfeVenda(fat.vendaId), { origem: 'MANUAL', pedidoId: null });

    const enviar = loteSimulado();
    const { resultado } = await semRede(() => emissor.emitirNfePorVendaId(fat.vendaId, {
      deps: depsEmissao({ enviarLote: enviar }),
      dadosNfe: dadosNfe(),
      pedidoId: 12345
    }));
    assert.equal(resultado.status, 'autorizada');
    const nota = await get('SELECT * FROM nfe_notas WHERE venda_id = ?', [fat.vendaId]);
    assert.equal(nota.origem, 'MANUAL');
    assert.equal(nota.pedido_id, null, 'pedido_id informado pelo cliente é ignorado');
  });

  it('F/G) NF-e sem origem válida é recusada; não existe terceira origem', () => {
    const v = emissor.validarOrigemNotaNfe;
    assert.deepEqual([...emissor.ORIGENS_NFE], ['PEDIDO', 'MANUAL']);
    assert.equal(v({ origem: undefined }).code, 'NFE_ORIGEM_INDEFINIDA');
    assert.equal(v({ origem: 'VENDA' }).code, 'NFE_ORIGEM_INDEFINIDA');
    assert.equal(v({ origem: 'PEDIDO', pedido_id: null }).code, 'NFE_ORIGEM_INDEFINIDA');
    assert.equal(v({ origem: 'MANUAL', pedido_id: 3 }).code, 'NFE_ORIGEM_INDEFINIDA');
    assert.equal(v({ origem: 'PEDIDO', pedido_id: 3 }), null);
    assert.equal(v({ origem: 'MANUAL', pedido_id: null }), null);
  });

  it('manual: origem de faturamento desconhecida e dados inválidos são recusados sem gerar venda', async () => {
    const vendasAntes = await contar('vendas');
    await assert.rejects(faturamento.faturarOperacaoNfe({ origem: 'PDV', clienteId, itens: itensPadrao() }, depsFat()), { code: 'ORIGEM_INVALIDA' });
    await assert.rejects(faturamento.faturarOperacaoNfe({ origem: 'NFE_MANUAL', clienteId: null, itens: itensPadrao() }, depsFat()), { code: 'CLIENTE_OBRIGATORIO' });
    await assert.rejects(faturamento.faturarOperacaoNfe({ origem: 'NFE_MANUAL', clienteId, itens: [] }, depsFat()), { code: 'ITENS_OBRIGATORIOS' });
    await assert.rejects(faturamento.faturarOperacaoNfe({ origem: 'NFE_MANUAL', clienteId, itens: itensPadrao(), desconto: 50 }, depsFat()), { code: 'DESCONTO_INVALIDO' });
    await assert.rejects(faturamento.faturarOperacaoNfe({ origem: 'NFE_MANUAL', clienteId, itens: itensPadrao() }, { diagnosticar: NAO_PRONTA }), { code: 'NFE_NAO_PRONTA' });
    assert.equal(await contar('vendas'), vendasAntes);
  });

  it('payload da venda: documento NFE, prioridade fiscal e pagamento fiscal integral', () => {
    const payload = faturamento.montarPayloadVendaNfe({
      origem: 'PEDIDO', clienteId: 1, cpfCnpj: CPF_CLIENTE, itens: faturamento.normalizarItensComerciais(itensPadrao()),
      desconto: 2, formaPagamento: 'prazo', parcelas: 2
    });
    assert.equal(payload.documento_fiscal, 'NFE');
    assert.equal(payload.emitir_fiscal, true);
    assert.equal(payload.origem_pdv, 'PEDIDO');
    assert.equal(payload.total, 18);
    assert.equal(payload.desconto, 2);
    assert.deepEqual(payload.pagamentos, [{ forma_pagamento: 'prazo', valor: 18, tipo_recebimento: 'fiscal' }]);
    assert.equal(payload.parcelas, 2);
    assert.match(payload.primeiro_vencimento, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(payload.cpf_cnpj_nota, '52998224725');
  });
});

// ===========================================================================
// I, J — rotas: permissão e prontidão
// ===========================================================================

describe('NF-E-04.0 — rotas', () => {
  const corpoManual = () => ({ cliente_id: clienteId, itens: itensPadrao(), chave_operacao: `teste-040-${Date.now()}`, dados_nfe: dadosNfe() });

  it('I) usuário sem NF-E-EMITIR: confirmar emissão do pedido e manual recusados (403), nada gerado', async () => {
    const p = await novoPedidoDireto();
    const vendasAntes = await contar('vendas');
    const r1 = await api('POST', `/pedidos/${p.id}/emitir-nfe`, tokenOperador, { dados_nfe: dadosNfe() });
    assert.equal(r1.status, 403);
    assert.match(r1.data.error, /NF-E-EMITIR/);
    const r2 = await api('POST', '/nfe/manual/emitir', tokenOperador, corpoManual());
    assert.equal(r2.status, 403);
    assert.equal((await pedidos.obterPedido(p.id)).status, 'ABERTO');
    assert.equal(await contar('vendas'), vendasAntes);
  });

  it('rotas antigas que faturavam sem emitir não existem mais', async () => {
    const p = await novoPedidoDireto();
    assert.equal((await api('POST', `/pedidos/${p.id}/faturar-nfe`, tokenAdmin, {})).status, 404);
    assert.equal((await api('POST', '/nfe/manual', tokenAdmin, { cliente_id: clienteId, itens: itensPadrao() })).status, 404);
  });

  it('J) com permissão, mas NF-e não pronta (diagnóstico local real): 409 com pendências, nada gerado', async () => {
    const p = await novoPedidoDireto();
    const vendasAntes = await contar('vendas');
    const r1 = await api('POST', `/pedidos/${p.id}/emitir-nfe`, tokenAdmin, { dados_nfe: dadosNfe() });
    assert.equal(r1.status, 409);
    assert.equal(r1.data.codigo, 'NFE_NAO_PRONTA');
    assert.ok(r1.data.pendencias.includes('Certificado'));
    assert.equal(r1.data.prontidao.pronta, false);
    assert.equal(r1.data.prontidao.chamadasSefaz, 0);
    const r2 = await api('POST', '/nfe/manual/emitir', tokenAdmin, corpoManual());
    assert.equal(r2.status, 409);
    assert.equal(r2.data.codigo, 'NFE_NAO_PRONTA');
    assert.equal((await pedidos.obterPedido(p.id)).status, 'ABERTO');
    assert.equal(await contar('vendas'), vendasAntes);
  });

  it('orçamentos e pedidos pela API: criar, aprovar e consultar', async () => {
    const criado = await api('POST', '/orcamentos', tokenOperador, { cliente_id: clienteId, itens: itensPadrao() });
    assert.equal(criado.status, 201);
    const aprovado = await api('POST', `/orcamentos/${criado.data.id}/aprovar`, tokenOperador, {});
    assert.equal(aprovado.status, 200);
    assert.equal(aprovado.data.origem, 'ORCAMENTO');
    assert.equal(aprovado.data.orcamento_id, criado.data.id);
    const lista = await api('GET', '/pedidos', tokenOperador);
    assert.ok(lista.data.some((p) => p.id === aprovado.data.id));
    const invalido = await api('POST', '/pedidos', tokenOperador, { cliente_id: clienteId, itens: [] });
    assert.equal(invalido.status, 400);
    assert.equal(invalido.data.codigo, 'ITENS_OBRIGATORIOS');
  });
});

// ===========================================================================
// N — sem emissor/XML/SOAP paralelos
// ===========================================================================

describe('NF-E-04.0 — reaproveitamento do motor existente', () => {
  const NOVOS = [
    'backend/services/vendas/faturamentoNfeService.js',
    'backend/services/pedidos/orcamentoPedidoService.js',
    'backend/rotas/pedidos.js',
    'frontend/erp/js/pedidos.js'
  ];

  it('N) arquivos novos não montam XML, não assinam, não usam SOAP nem reservam número', () => {
    for (const rel of NOVOS) {
      const src = read(rel);
      assert.doesNotMatch(src, /xmlBuilder|buildNfeXml|assinar|SignedXml|soapClient|enviarLote|https?\.request|reservarIdentidade|proximoNumero|fiscal_numeracao/i, rel);
    }
  });

  it('M) pedido e manual usam o formulário NF-e existente; faturamento por criarVendaInterna e emissão por emitirNfePorVendaId', () => {
    const ui = read('frontend/erp/js/pedidos.js');
    const nfe = read('frontend/erp/js/nfe.js');
    assert.match(ui, /abrirNfeManual\(/);
    assert.match(ui, /nfeAplicarImportacao\(/);
    assert.match(ui, /await abrirEmissaoNfe\(vendaId\)/);
    assert.match(nfe, /function abrirEmissaoNfeManual\(/);
    assert.match(nfe, /function confirmarEmissaoNfe\(/);
    assert.match(nfe, /\/nfe\/manual\/emitir/);
    const fat = read('backend/services/vendas/faturamentoNfeService.js');
    assert.match(fat, /require\('\.\/criarVendaInterna'\)\.criarVendaInterna/);
    assert.match(fat, /require\('\.\.\/fiscal\/nfeEmissorVenda'\)\.emitirNfePorVendaId/);
    assert.match(read('backend/services/pedidos/orcamentoPedidoService.js'), /faturamento\.faturarOperacaoNfe\(/);
  });

  it('venda para NF-e não aciona NFC-e (documento_fiscal NFE)', () => {
    const src = read('backend/services/vendas/VendaPagamentoService.js');
    assert.match(src, /const emitirNfceAoConcluir = !!emitir_fiscal && !documentoNfe55;/);
    assert.doesNotMatch(src, /emitirFiscal: !!emitir_fiscal/);
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
  'frontend/erp/js/pedidos.js',
  'frontend/erp/js/vendas.js',
  'frontend/erp/js/fiscal.js'
];

const janelas = [];
function criarJanela(usuario = { role: 'admin', perfil: 'ADMIN' }) {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body><div id="page-content"></div><div id="modal-container"></div></body></html>',
    { url: 'http://localhost/erp/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole() }
  );
  const { window } = dom;
  janelas.push(window);
  window.localStorage.setItem('token', 'token-teste');
  window.localStorage.setItem('user', JSON.stringify(usuario));
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
  const notificacoes = [];
  window.showNotification = (msg) => notificacoes.push(msg);
  window.viewVenda = () => {};
  window.confirm = () => true;
  const chamadas = [];
  const rotas = {};
  window.fetch = async (url, opts = {}) => {
    const u = new URL(url, 'http://localhost');
    const metodo = String(opts.method || 'GET').toUpperCase();
    chamadas.push({ rota: `${metodo} ${u.pathname}`, body: opts.body ? JSON.parse(opts.body) : undefined });
    const r = rotas[`${metodo} ${u.pathname}`];
    const status = r ? (r.status || 200) : 404;
    const texto = JSON.stringify(r ? r.body : { success: false });
    return { ok: status < 300, status, headers: { get: () => null }, json: async () => JSON.parse(texto), text: async () => texto };
  };
  return { window, rotas, chamadas, notificacoes, rotasChamadas: () => chamadas.map((c) => c.rota) };
}

const DIAG_PRONTA = { success: true, pronta: true, itens: [], pendencias: [], chamadasSefaz: 0 };
const DIAG_NAO_PRONTA = {
  success: true, pronta: false, status: 'NAO_CONFIGURADA',
  itens: [{ id: 'certificado', nome: 'Certificado', nivel: 'pendente', ok: false, mensagem: 'Certificado A1 não configurado.' }],
  pendencias: ['Certificado'], chamadasSefaz: 0
};
const VENDA_77 = {
  id: 77, codigo: 'V0077', status: 'concluida', cliente_nome: 'MARIA', cliente_cpf: CPF_CLIENTE,
  itens: [], nfe: { nota: null, possui_parcela_fiscal: true, pode_emitir: true, acao: 'emitir' }
};
const PEDIDO_UI = (nfe, extra = {}) => ({
  id: 5, codigo: 'PED-000005', origem: 'DIRETO', status: 'ABERTO', cliente_nome: 'MARIA', total_itens: 20, desconto: 0, total: 20,
  forma_pagamento: 'dinheiro', itens: [{ produto_id: 1, produto_nome: 'SORVETE', quantidade: 2, preco_unitario: 10, subtotal: 20 }],
  nfe, ...extra
});

describe('NF-E-04.0 — interface', () => {
  after(() => {
    for (const w of janelas.splice(0)) w.close();
  });

  it('D) detalhe do pedido elegível mostra [Emitir NF-e]', () => {
    const { window } = criarJanela();
    const html = window.pedHtmlBotaoNfePedido(PEDIDO_UI({ pode_emitir: true, acao: 'emitir_pedido' }));
    assert.match(html, /id="pedBtnEmitirNfe"/);
    assert.match(html, /Emitir NF-e/);
    assert.match(html, /🧾/);
    assert.doesNotMatch(html, /disabled/);
  });

  it('E) pedido não elegível não mostra o botão e exibe o motivo', () => {
    const { window } = criarJanela();
    const html = window.pedHtmlAcaoNfePedido(PEDIDO_UI({ pode_emitir: false, motivo_bloqueio: 'Pedido cancelado.' }));
    assert.doesNotMatch(html, /pedBtnEmitirNfe/);
    assert.match(html, /id="pedNfeBloqueio"/);
    assert.match(html, /Pedido cancelado\./);
  });

  it('I) sem permissão: mensagem "Usuário sem permissão para emitir NF-e." e nenhum botão', async () => {
    const ctx = criarJanela({ role: 'operador', perfil: 'USUARIO', permissoes: ['vendas'] });
    const html = ctx.window.pedHtmlAcaoNfePedido(PEDIDO_UI({ pode_emitir: true, acao: 'emitir_pedido' }));
    assert.doesNotMatch(html, /pedBtnEmitirNfe/);
    assert.match(html, /id="pedSemPermissaoEmitir"/);
    assert.match(html, /Usuário sem permissão para emitir NF-e\./);
    await ctx.window.abrirNfeManual();
    assert.ok(ctx.notificacoes.includes('Usuário sem permissão para emitir NF-e.'));
    assert.equal(ctx.window.document.getElementById('modalNfeManual'), null);
    assert.equal(ctx.chamadas.length, 0);
  });

  it('J) [Emitir NF-e] com NF-e não pronta mostra pendências e não fatura', async () => {
    const ctx = criarJanela();
    ctx.rotas['GET /api/nfe/prontidao'] = { body: DIAG_NAO_PRONTA };
    await ctx.window.pedEmitirNfe(5);
    const modal = ctx.window.document.getElementById('modalNfeNaoPronta');
    assert.ok(modal);
    assert.match(modal.textContent, /Certificado/);
    assert.ok(!ctx.rotasChamadas().some((r) => r.startsWith('POST ')));
  });

  it('pedido elegível: abre a Nova NF-e sem faturar (nenhum POST)', async () => {
    const ctx = criarJanela();
    ctx.rotas['GET /api/nfe/prontidao'] = { body: DIAG_PRONTA };
    ctx.rotas['GET /api/clientes'] = { body: [{ id: 9, nome: 'MARIA', cpf_cnpj: CPF_CLIENTE, rua: 'RUA A', numero: '1', bairro: 'CENTRO', cidade: 'CRATO', uf: 'CE', cep: '63100000' }] };
    ctx.rotas['GET /api/produtos'] = { body: [{ id: 1, nome: 'SORVETE', preco_venda: 60, ativo: 1 }] };
    ctx.rotas['GET /api/pedidos/5'] = { body: PEDIDO_UI({ pode_emitir: true, acao: 'emitir_pedido' }, { cliente_id: 9 }) };
    await ctx.window.pedEmitirNfe(5);
    const doc = ctx.window.document;
    const pagina = doc.getElementById('modalEmitirNfe');
    assert.ok(doc.getElementById('nfeNovaPainel'), 'abre a Nova NF-e');
    assert.equal(pagina.dataset.contexto, 'pedidos');
    assert.match(doc.getElementById('nfeOrigemComercial').textContent, /PED-000005/);
    assert.match(pagina.textContent, /Confirmar emissão/);
    assert.equal(doc.querySelector('#nfeManualItens [data-campo="preco"]').value, '10');
    assert.ok(!ctx.rotasChamadas().some((r) => r.startsWith('POST ')), 'nada é faturado nem emitido ao abrir');
  });

  it('pedido já faturado: vai direto ao formulário NF-e da venda, sem faturar de novo', async () => {
    const ctx = criarJanela();
    ctx.rotas['GET /api/nfe/prontidao'] = { body: DIAG_PRONTA };
    ctx.rotas['GET /api/pedidos/5'] = { body: PEDIDO_UI({ pode_emitir: true, acao: 'emitir' }, { status: 'FATURADO', venda_id: 77 }) };
    ctx.rotas['GET /api/vendas/77'] = { body: VENDA_77 };
    await ctx.window.pedEmitirNfe(5);
    assert.ok(!ctx.rotasChamadas().some((r) => r.startsWith('POST ')));
    const modal = ctx.window.document.getElementById('modalEmitirNfe');
    assert.ok(modal);
    assert.equal(modal.dataset.contexto, 'venda');
    assert.equal(modal.dataset.vendaId, '77');
  });

  it('Fiscal → NF-e Emitidas: coluna Origem (Pedido / Manual) e coluna Pedido', () => {
    const { window } = criarJanela();
    const tabela = window.nfeHtmlTabelaEmitidas([
      { id: 1, numero: 1, serie: 1, origem: 'PEDIDO', pedido_id: 5, venda_id: 77, status: 'autorizada' },
      { id: 2, numero: 2, serie: 1, origem: 'MANUAL', pedido_id: null, venda_id: 78, status: 'autorizada' }
    ]);
    assert.match(tabela, /<th>Origem<\/th>/);
    assert.match(tabela, /<th>Pedido<\/th>/);
    assert.match(tabela, /data-origem="PEDIDO">Pedido</);
    assert.match(tabela, /#5/);
    assert.match(tabela, /data-origem="MANUAL">Manual</);
    assert.equal(nfeUi.nfeRotuloOrigem({ origem: 'PEDIDO', pedido_id: 5 }), 'Pedido #5');
    assert.equal(nfeUi.nfeRotuloOrigem({ tipo: 'DEVOLUCAO_COMPRA' }), 'Devolução');
    assert.equal(nfeUi.nfeRotuloOrigem({}), '—');
  });

  it('G) Nova NF-e manual: prontidão → cliente/itens → formulário NF-e, sem registrar venda (nenhum POST)', async () => {
    const ctx = criarJanela();
    ctx.rotas['GET /api/nfe/prontidao'] = { body: DIAG_PRONTA };
    ctx.rotas['GET /api/clientes'] = { body: [{ id: 9, nome: 'MARIA', cpf_cnpj: CPF_CLIENTE, rua: 'RUA A', cidade: 'CRATO', uf: 'CE' }] };
    ctx.rotas['GET /api/produtos'] = { body: [{ id: 3, nome: 'SORVETE', preco_venda: 12, saldo_fiscal: 40, ativo: 1 }] };
    await ctx.window.abrirNfeManual();
    const doc = ctx.window.document;
    assert.ok(doc.getElementById('modalNfeManual'));
    doc.getElementById('nfeManualCliente').value = '9';
    if (!doc.querySelector('#nfeManualItens tr[data-opc-item]')) ctx.window.opcAdicionarItem('nfeManual');
    const linha = doc.querySelector('#nfeManualItens tr[data-opc-item]');
    const sel = linha.querySelector('[data-campo="produto"]');
    sel.value = '3';
    ctx.window.opcAoTrocarProduto(sel, 'nfeManual');
    assert.equal(linha.querySelector('[data-campo="preco"]').value, '12.00');
    linha.querySelector('[data-campo="quantidade"]').value = '2';
    await ctx.window.confirmarNfeManual();
    const modal = doc.getElementById('modalEmitirNfe');
    assert.ok(modal);
    assert.equal(modal.dataset.contexto, 'manual');
    assert.equal(doc.getElementById('nfeDestNome').value, 'MARIA', 'destinatário pré-preenchido do cadastro');
    assert.equal(doc.getElementById('nfeDestLogradouro').value, 'RUA A');
    assert.ok(!ctx.rotasChamadas().some((r) => r.startsWith('POST ')), 'nenhuma venda registrada antes de confirmar');
  });

  it('J) Nova NF-e com NF-e não pronta: pendências, sem formulário', async () => {
    const ctx = criarJanela();
    ctx.rotas['GET /api/nfe/prontidao'] = { body: DIAG_NAO_PRONTA };
    await ctx.window.abrirNfeManual();
    assert.ok(ctx.window.document.getElementById('modalNfeNaoPronta'));
    assert.equal(ctx.window.document.getElementById('modalNfeManual'), null);
    assert.ok(!ctx.rotasChamadas().includes('GET /api/clientes'));
  });

  it('editor: validação local de cliente, itens e desconto', () => {
    assert.deepEqual(pedUi.opcValidarDados({ cliente_id: 1, itens: [{ produto_id: 1, quantidade: 1, preco_unitario: 5 }], desconto: 0 }), []);
    const erros = pedUi.opcValidarDados({ cliente_id: null, itens: [{ produto_id: null, quantidade: 0, preco_unitario: 0 }], desconto: 0 });
    assert.ok(erros.includes('Selecione o cliente.'));
    assert.ok(erros.some((e) => /selecione o produto/.test(e)));
    assert.ok(pedUi.opcValidarDados({ cliente_id: 1, itens: [{ produto_id: 1, quantidade: 1, preco_unitario: 5 }], desconto: 5 }).includes('Desconto inválido.'));
    assert.deepEqual(pedUi.opcTotais({ itens: [{ quantidade: 3, preco_unitario: 12.5 }], desconto: 2.5 }), { totalItens: 37.5, desconto: 2.5, total: 35 });
  });

  it('navegação: menu Orçamentos e Pedidos, script carregado e permissão de página', () => {
    const html = read('frontend/erp/index.html');
    assert.match(html, /data-page="pedidos"/);
    assert.match(html, /<script src="\/erp\/js\/pedidos\.js"><\/script>/);
    assert.match(read('frontend/erp/js/app.js'), /case 'pedidos':/);
    assert.match(read('frontend/shared/js/access-control.js'), /pedidos: 'vendas'/);
  });
});
