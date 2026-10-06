/**
 * CLIENTES-01 — Integridade do cadastro de clientes.
 *
 * Editar um cliente nunca apaga campos que não foram enviados/alterados; CPF/CNPJ é gravado
 * só com dígitos (POST e PUT); duplicidade após normalização devolve 409 sem alterar nada.
 * As telas reais (Comercial › Clientes, Cadastros/ERP, PDV e Mobile) são exercitadas contra
 * o backend real em banco temporário.
 *
 * Banco isolado em %TEMP%; nenhuma chamada externa.
 */

'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const DIR = path.join(os.tmpdir(), 'cds-clientes-testes', 'integridade-01');
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
const express = require('express');
const jwt = require('jsonwebtoken');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const db = require('../../backend/database');
const auth = require('../../backend/middleware/auth');

const CAMPOS = ['nome', 'cpf_cnpj', 'telefone', 'email', 'cep', 'rua', 'numero', 'bairro', 'cidade', 'uf',
  'limite_credito', 'tipo_comercial_id'];

let server;
let base;
let token;
let tipoConsumidorId;
let tipoAtacadistaId;

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

let seq = 0;
function cpfUnico() {
  seq += 1;
  const n = String(70000000000 + seq);
  return { formatado: `${n.slice(0, 3)}.${n.slice(3, 6)}.${n.slice(6, 9)}-${n.slice(9)}`, digitos: n };
}

function dadosCompletos(extra = {}) {
  const cpf = cpfUnico();
  return {
    cpf,
    body: {
      nome: `CLIENTE INTEGRIDADE ${seq}`,
      cpf_cnpj: cpf.formatado,
      telefone: '(88) 99999-0001',
      email: `cliente${seq}@integridade.test`,
      cep: '63010-000',
      rua: 'RUA DAS FLORES',
      numero: '123',
      bairro: 'CENTRO',
      cidade: 'JUAZEIRO DO NORTE',
      uf: 'CE',
      limite_credito: 250,
      tipo_comercial_id: tipoAtacadistaId,
      ...extra
    }
  };
}

/** Cliente criado pelo POST real com todos os campos e Tipo Comercial ATACADISTA. */
async function criarClienteCompleto(extra = {}) {
  const { cpf, body } = dadosCompletos(extra);
  const r = await api('POST', '/clientes', body);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const id = r.body.id;
  const salvo = await lerCliente(id);
  assert.equal(salvo.cpf_cnpj, cpf.digitos);
  return { id, salvo };
}

async function aguardar(condicao, descricao, tentativas = 200) {
  for (let i = 0; i < tentativas; i += 1) {
    if (await condicao()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`tempo esgotado aguardando: ${descricao}`);
}

before(async () => {
  assert.ok(path.resolve(process.env.DB_DIR).startsWith(path.resolve(os.tmpdir())), 'teste deve usar banco temporário');
  await new Promise((resolve, reject) => db.whenReady((err) => (err ? reject(err) : resolve())));
  assert.equal(path.resolve(db.dbPath), path.resolve(DIR, 'mercadao.db'));
  assert.ok(!/MercantilFiscal/i.test(db.dbPath), 'nunca o banco oficial');
  assert.ok(!/CDS Cremolicia/i.test(db.dbPath), 'nunca o banco antigo');

  tipoConsumidorId = (await get(`SELECT id FROM tipos_comerciais WHERE codigo = 'CONSUMIDOR_FINAL'`)).id;
  tipoAtacadistaId = (await get(`SELECT id FROM tipos_comerciais WHERE codigo = 'ATACADISTA'`)).id;
  assert.ok(tipoConsumidorId && tipoAtacadistaId && tipoConsumidorId !== tipoAtacadistaId);

  const adminId = (await run(`INSERT INTO usuarios (username, password_hash, role) VALUES ('cli01adm', 'x', 'admin')`)).id;
  token = jwt.sign({ id: adminId, username: 'cli01adm', role: 'admin', perfil: 'ADMIN' }, auth.JWT_SECRET);

  const { tiposComerciaisRouter } = require('../../backend/modules/comercial');
  const app = express();
  app.use(express.json());
  app.use('/api/clientes', auth.verificarToken, require('../../backend/rotas/clientes'));
  app.use('/api/tipos-comerciais', auth.verificarToken, tiposComerciaisRouter);
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => db.close(() => resolve()));
});

// ===========================================================================
// API /api/clientes
// ===========================================================================

describe('CLIENTES-01 — API /api/clientes (PUT com merge, CPF/CNPJ normalizado)', () => {
  it('TESTE 01 — cria com nome, CPF/CNPJ, rua, número, bairro, cidade, UF e Tipo Comercial; tudo persiste', async () => {
    const r = await api('POST', '/clientes', {
      nome: 'SORVETERIA INTEGRIDADE LTDA',
      cpf_cnpj: '47.273.832/0001-45',
      telefone: '(88) 3511-0000',
      email: 'contato@sorveteria.test',
      cep: '63010-000',
      rua: 'RUA SÃO PEDRO',
      numero: '1500',
      bairro: 'CENTRO',
      cidade: 'JUAZEIRO DO NORTE',
      uf: 'CE',
      limite_credito: 400,
      tipo_comercial_id: tipoAtacadistaId
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(await lerCliente(r.body.id), {
      nome: 'SORVETERIA INTEGRIDADE LTDA',
      cpf_cnpj: '47273832000145',
      telefone: '(88) 3511-0000',
      email: 'contato@sorveteria.test',
      cep: '63010-000',
      rua: 'RUA SÃO PEDRO',
      numero: '1500',
      bairro: 'CENTRO',
      cidade: 'JUAZEIRO DO NORTE',
      uf: 'CE',
      limite_credito: 400,
      tipo_comercial_id: tipoAtacadistaId
    });
    const lido = await api('GET', `/clientes/${r.body.id}`);
    assert.equal(lido.body.numero, '1500');
    assert.equal(lido.body.bairro, 'CENTRO');
    assert.equal(lido.body.tipo_comercial_id, tipoAtacadistaId);
    assert.equal(lido.body.tipo_comercial_codigo, 'ATACADISTA');
  });

  it('TESTE 02 — editar somente o nome preserva número, bairro, tipo, CPF/CNPJ e endereço', async () => {
    const { id, salvo } = await criarClienteCompleto();
    const r = await api('PUT', `/clientes/${id}`, { nome: 'NOME ALTERADO 02' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(await lerCliente(id), { ...salvo, nome: 'NOME ALTERADO 02' });
  });

  it('TESTE 03 — editar somente o telefone altera só o telefone', async () => {
    const { id, salvo } = await criarClienteCompleto();
    const r = await api('PUT', `/clientes/${id}`, { telefone: '(88) 98888-7777' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(await lerCliente(id), { ...salvo, telefone: '(88) 98888-7777' });
  });

  it('TESTE 04 — editar somente o endereço preserva nome, CPF/CNPJ, telefone, limite e tipo', async () => {
    const { id, salvo } = await criarClienteCompleto();
    const endereco = { cep: '63100-000', rua: 'AV. PADRE CÍCERO', numero: '45A', bairro: 'TRIÂNGULO', cidade: 'CRATO', uf: 'CE' };
    const r = await api('PUT', `/clientes/${id}`, endereco);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(await lerCliente(id), { ...salvo, ...endereco });
  });

  it('TESTE 05 — PUT sem tipo_comercial_id (ausente, null ou vazio) preserva o Tipo Comercial; tipo enviado continua editável', async () => {
    const { id, salvo } = await criarClienteCompleto();
    const { body: semTipo } = dadosCompletos();
    delete semTipo.tipo_comercial_id;
    semTipo.cpf_cnpj = salvo.cpf_cnpj;

    assert.equal((await api('PUT', `/clientes/${id}`, semTipo)).status, 200);
    assert.equal((await lerCliente(id)).tipo_comercial_id, tipoAtacadistaId, 'ausente preserva');
    assert.equal((await api('PUT', `/clientes/${id}`, { tipo_comercial_id: null })).status, 200);
    assert.equal((await lerCliente(id)).tipo_comercial_id, tipoAtacadistaId, 'null preserva');
    assert.equal((await api('PUT', `/clientes/${id}`, { tipo_comercial_id: '' })).status, 200);
    assert.equal((await lerCliente(id)).tipo_comercial_id, tipoAtacadistaId, 'vazio preserva');

    const invalido = await api('PUT', `/clientes/${id}`, { nome: 'NÃO DEVE GRAVAR', tipo_comercial_id: 999999 });
    assert.equal(invalido.status, 400);
    assert.notEqual((await lerCliente(id)).nome, 'NÃO DEVE GRAVAR');

    assert.equal((await api('PUT', `/clientes/${id}`, { tipo_comercial_id: tipoConsumidorId })).status, 200);
    assert.equal((await lerCliente(id)).tipo_comercial_id, tipoConsumidorId, 'tipo informado é aplicado');
  });

  it('TESTE 06 — PUT com CPF/CNPJ formatado grava só dígitos (mesma regra do POST)', async () => {
    const { id, salvo } = await criarClienteCompleto();
    const r = await api('PUT', `/clientes/${id}`, { cpf_cnpj: '12.345.678/0001-95' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(await lerCliente(id), { ...salvo, cpf_cnpj: '12345678000195' });

    const cpf = cpfUnico();
    assert.equal((await api('PUT', `/clientes/${id}`, { cpf_cnpj: cpf.formatado })).status, 200);
    assert.equal((await lerCliente(id)).cpf_cnpj, cpf.digitos);
  });

  it('TESTE 07 — CPF/CNPJ duplicado após normalização: 409 e nenhum campo alterado', async () => {
    const a = await criarClienteCompleto();
    const b = await criarClienteCompleto();
    const formatadoDeA = `${a.salvo.cpf_cnpj.slice(0, 3)}.${a.salvo.cpf_cnpj.slice(3, 6)}.${a.salvo.cpf_cnpj.slice(6, 9)}-${a.salvo.cpf_cnpj.slice(9)}`;

    const r = await api('PUT', `/clientes/${b.id}`, { nome: 'NÃO DEVE GRAVAR', cpf_cnpj: formatadoDeA, numero: '999' });
    assert.equal(r.status, 409);
    assert.equal(r.body.success, false);
    assert.match(r.body.message, /Já existe um cliente cadastrado com este CPF\/CNPJ/);
    assert.equal(r.body.error, r.body.message, 'telas ERP/PDV leem responseJSON.error');
    assert.deepEqual(await lerCliente(b.id), b.salvo);
    assert.deepEqual(await lerCliente(a.id), a.salvo);

    const legado = cpfUnico();
    const idLegado = (await run(
      `INSERT INTO clientes (nome, cpf_cnpj, tipo_comercial_id) VALUES ('LEGADO FORMATADO', ?, ?)`,
      [legado.formatado, tipoConsumidorId]
    )).id;
    const contraLegado = await api('PUT', `/clientes/${b.id}`, { cpf_cnpj: legado.digitos });
    assert.equal(contraLegado.status, 409, 'CPF legado gravado com máscara também é duplicidade');
    assert.deepEqual(await lerCliente(b.id), b.salvo);
    assert.ok(await lerCliente(idLegado));

    const proprio = await api('PUT', `/clientes/${b.id}`, { cpf_cnpj: b.salvo.cpf_cnpj, nome: 'MESMO CPF OK' });
    assert.equal(proprio.status, 200, 'o próprio CPF do cliente não é duplicidade');

    const post = await api('POST', '/clientes', { nome: 'DUPLICADO POST', cpf_cnpj: formatadoDeA, tipo_comercial_id: tipoConsumidorId });
    assert.equal(post.status, 409);
  });

  it('TESTE 09 — PUT sem limite_credito preserva o limite', async () => {
    const { id, salvo } = await criarClienteCompleto({ limite_credito: 750.5 });
    assert.equal(salvo.limite_credito, 750.5);
    const r = await api('PUT', `/clientes/${id}`, { nome: 'SEM LIMITE NO PUT', telefone: '' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(await lerCliente(id), { ...salvo, nome: 'SEM LIMITE NO PUT', telefone: '' });
  });

  it('TESTE 10 — limite_credito: 0 explícito zera o limite', async () => {
    const { id, salvo } = await criarClienteCompleto({ limite_credito: 300 });
    const r = await api('PUT', `/clientes/${id}`, { limite_credito: 0 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(await lerCliente(id), { ...salvo, limite_credito: 0 });
  });

  it('nome vazio → 400; cliente inexistente → 404; nada é gravado', async () => {
    const { id, salvo } = await criarClienteCompleto();
    assert.equal((await api('PUT', `/clientes/${id}`, { nome: '   ', numero: '1' })).status, 400);
    assert.deepEqual(await lerCliente(id), salvo);
    assert.equal((await api('PUT', '/clientes/99999999', { nome: 'X' })).status, 404);
    assert.equal(await lerCliente(99999999), null);
  });

  it('clientes sem CPF/CNPJ podem coexistir (vazio vira NULL, não colide no UNIQUE)', async () => {
    const r1 = await api('POST', '/clientes', { nome: 'SEM DOC 1', cpf_cnpj: '', tipo_comercial_id: tipoConsumidorId });
    const r2 = await api('POST', '/clientes', { nome: 'SEM DOC 2', cpf_cnpj: '', tipo_comercial_id: tipoConsumidorId });
    assert.equal(r1.status, 200, JSON.stringify(r1.body));
    assert.equal(r2.status, 200, JSON.stringify(r2.body));
    assert.equal((await lerCliente(r1.body.id)).cpf_cnpj, null);
    assert.equal((await lerCliente(r2.body.id)).cpf_cnpj, null);
    assert.equal((await api('PUT', `/clientes/${r2.body.id}`, { cpf_cnpj: '' })).status, 200);
  });
});

// ===========================================================================
// Comercial › Clientes (ClienteCadastroView do Motor Comercial)
// ===========================================================================

describe('CLIENTES-01 — Comercial › Clientes (ClienteCadastroView)', () => {
  let dom;
  let ClienteCadastroView;
  let chamadasFetch;
  let notificacoes;
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
    notificacoes = [];
    dom.window.showNotification = (msg, tipo) => notificacoes.push({ msg, tipo });
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

  function apiStub(perfis) {
    const chamadas = [];
    return {
      chamadas,
      listarPerfis: async (filtros) => { chamadas.push(['listarPerfis', filtros]); return { items: perfis }; },
      atualizarPerfil: async (...a) => { chamadas.push(['atualizarPerfil', ...a]); return {}; },
      alterarLimite: async (...a) => { chamadas.push(['alterarLimite', ...a]); return {}; },
      criarPerfil: async (...a) => { chamadas.push(['criarPerfil', ...a]); return { id: 999 }; }
    };
  }

  async function abrirEdicao(clienteId, perfis) {
    document.body.innerHTML = '';
    const api = apiStub(perfis);
    let salvoId = null;
    const view = new ClienteCadastroView({ isEdit: true, clienteId, api, onSalvo: (id) => { salvoId = id; } });
    document.body.appendChild(view.render());
    await aguardar(() => view._cadastroCarregado, 'cliente carregado na tela');
    return { view, api, salvo: () => salvoId };
  }

  const valorCampo = (name) => document.querySelector(`[name="${name}"]`)?.value;
  function digitar(name, valor) {
    const input = document.querySelector(`[name="${name}"]`);
    assert.ok(input, `campo ${name} existe na tela`);
    input.value = valor;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  }
  const putsCliente = (id) => chamadasFetch.filter((c) => c.metodo === 'PUT' && c.url.endsWith(`/clientes/${id}`));

  it('TESTE 08 — tela mostra Número e Bairro; editar só o nome preserva número, bairro, tipo, CPF/CNPJ, endereço e limite', async () => {
    const { id, salvo } = await criarClienteCompleto({ limite_credito: 180 });
    const { view, api, salvo: salvoId } = await abrirEdicao(id, [{ id: 11, perfilTipo: 'CONSIGNADO', limiteComercial: 500 }]);

    assert.equal(valorCampo('numero'), '123', 'Número carregado do cadastro');
    assert.equal(valorCampo('bairro'), 'CENTRO', 'Bairro carregado do cadastro');
    assert.equal(valorCampo('rua'), 'RUA DAS FLORES');
    assert.equal(view.tipoComercialId, tipoAtacadistaId, 'Tipo Comercial lido do GET');

    digitar('nome', 'NOME EDITADO NO COMERCIAL');
    await view._salvar();

    assert.equal(salvoId(), id, 'onSalvo chamado');
    const [put] = putsCliente(id);
    assert.ok(put, 'PUT enviado');
    assert.equal(put.body.numero, '123');
    assert.equal(put.body.bairro, 'CENTRO');
    assert.equal(put.body.tipo_comercial_id, tipoAtacadistaId);
    assert.ok(!('limite_credito' in put.body), 'sem capacidade Crédito o limite não é enviado');
    assert.deepEqual(await lerCliente(id), { ...salvo, nome: 'NOME EDITADO NO COMERCIAL' });
    assert.ok(api.chamadas.some(([m, pid]) => m === 'atualizarPerfil' && pid === 11), 'perfil comercial existente atualizado');

    const reaberto = await abrirEdicao(id, [{ id: 11, perfilTipo: 'CONSIGNADO', limiteComercial: 500 }]);
    assert.equal(valorCampo('numero'), '123');
    assert.equal(valorCampo('bairro'), 'CENTRO');
    assert.equal(valorCampo('nome'), 'NOME EDITADO NO COMERCIAL');
    digitar('telefone', '(88) 97777-6666');
    await reaberto.view._salvar();
    assert.deepEqual(await lerCliente(id), { ...salvo, nome: 'NOME EDITADO NO COMERCIAL', telefone: '(88) 97777-6666' });
  });

  it('TESTE 08 — Número/Bairro editados na tela do Comercial são gravados', async () => {
    const { id, salvo } = await criarClienteCompleto();
    const { view } = await abrirEdicao(id, [{ id: 12, perfilTipo: 'CONSIGNADO', limiteComercial: 0 }]);
    digitar('numero', '77B');
    digitar('bairro', 'LAGOA SECA');
    await view._salvar();
    assert.deepEqual(await lerCliente(id), { ...salvo, numero: '77B', bairro: 'LAGOA SECA' });
  });

  it('TESTE 09 (Comercial) — com a capacidade Crédito marcada o limite segue a regra existente', async () => {
    const { id, salvo } = await criarClienteCompleto({ limite_credito: 100 });
    const { view } = await abrirEdicao(id, [{ id: 13, perfilTipo: 'CONSUMIDOR', limiteComercial: 300 }]);
    assert.equal(valorCampo('cap-credito-limite-credito'), '300');
    await view._salvar();
    const [put] = putsCliente(id);
    assert.equal(put.body.limite_credito, 300);
    assert.deepEqual(await lerCliente(id), { ...salvo, limite_credito: 300 });
  });

  it('se o cadastro não carregar, salvar é bloqueado e nada é enviado', async () => {
    const { id, salvo } = await criarClienteCompleto();
    document.body.innerHTML = '';
    const api = apiStub([]);
    api.listarPerfis = async () => { throw new Error('falha simulada ao carregar perfis'); };
    const view = new ClienteCadastroView({ isEdit: true, clienteId: id, api });
    document.body.appendChild(view.render());
    await aguardar(() => document.body.textContent.includes('falha simulada'), 'erro exibido');
    const antes = chamadasFetch.length;
    notificacoes.length = 0;
    await view._salvar();
    assert.equal(view._cadastroCarregado, false);
    assert.equal(chamadasFetch.slice(antes).filter((c) => c.metodo !== 'GET').length, 0, 'nenhum PUT/POST');
    assert.match(notificacoes[0].msg, /não foram carregados/);
    assert.deepEqual(await lerCliente(id), salvo);
  });

  it('novo cliente pelo Comercial grava Número e Bairro', async () => {
    document.body.innerHTML = '';
    sessionStorage.clear();
    const api = apiStub([]);
    let salvoId = null;
    const view = new ClienteCadastroView({ isEdit: false, api, onSalvo: (novoId) => { salvoId = novoId; } });
    document.body.appendChild(view.render());
    await new Promise((r) => setTimeout(r, 20));
    const cpf = cpfUnico();
    digitar('nome', 'NOVO PELO COMERCIAL');
    digitar('cpf_cnpj', cpf.formatado);
    digitar('rua', 'RUA NOVA');
    digitar('numero', '10');
    digitar('bairro', 'PIRAJÁ');
    digitar('cidade', 'JUAZEIRO DO NORTE');
    digitar('uf', 'CE');
    const cap = document.querySelector('[data-cap-key="consignacao"] [data-role="cap-check"] input');
    cap.checked = true;
    await view._salvar();
    assert.ok(salvoId, 'cliente criado');
    const novo = await lerCliente(salvoId);
    assert.equal(novo.numero, '10');
    assert.equal(novo.bairro, 'PIRAJÁ');
    assert.equal(novo.cpf_cnpj, cpf.digitos);
    assert.equal(novo.tipo_comercial_id, tipoConsumidorId, 'tipo padrão do POST (regra existente)');
    assert.ok(api.chamadas.some(([m]) => m === 'criarPerfil'));
  });

  it('bundle do Motor Comercial contém a mesma tela (Número/Bairro e preservação de tipo/limite)', () => {
    const bundle = read('frontend/modules/motor-comercial/motor-comercial.bundle.js');
    assert.ok(bundle.includes('name: "numero"'), 'campo Número no bundle');
    assert.ok(bundle.includes('name: "bairro"'), 'campo Bairro no bundle');
    assert.ok(bundle.includes('cadastro.tipo_comercial_id = this.tipoComercialId'), 'tipo enviado no bundle');
    assert.ok(bundle.includes('_capacidadeMarcada("credito")'), 'limite condicionado no bundle');
    assert.ok(!/numero:\s*""/.test(bundle), 'bundle não envia mais número vazio fixo');
  });
});

// ===========================================================================
// Cadastros (ERP) e PDV — modais jQuery reais contra o backend real
// ===========================================================================

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
    },
    puts: () => chamadas.filter((c) => c.metodo === 'PUT')
  };
}

describe('CLIENTES-01 — TESTE 11: regressão Cadastros (modal ERP)', () => {
  let tela;
  before(() => { tela = criarJanelaModal('frontend/erp/js/clientes.js'); });
  after(() => tela.window.close());

  it('cria com todos os campos e Tipo Comercial; CPF/CNPJ mascarado na tela é gravado só com dígitos', async () => {
    tela.window.showClienteModal(null);
    await tela.aguardarAjax();
    tela.preencher({
      nome: 'CLIENTE VIA CADASTROS', cpf_cnpj: '11.222.333/0001-81', telefone: '(88) 3521-1000', email: 'erp@test.local',
      cep: '63040-000', rua: 'RUA DO ERP', numero: '88', bairro: 'SALESIANOS', cidade: 'JUAZEIRO DO NORTE', uf: 'CE',
      limite_credito: '150', tipo_comercial_id: String(tipoAtacadistaId)
    });
    tela.window.saveCliente();
    await tela.aguardarAjax();
    assert.ok(tela.notificacoes.some((n) => /salvo com sucesso/.test(n.msg)), JSON.stringify(tela.notificacoes));
    const row = await get(`SELECT id FROM clientes WHERE nome = 'CLIENTE VIA CADASTROS'`);
    assert.deepEqual(await lerCliente(row.id), {
      nome: 'CLIENTE VIA CADASTROS', cpf_cnpj: '11222333000181', telefone: '(88) 3521-1000', email: 'erp@test.local',
      cep: '63040-000', rua: 'RUA DO ERP', numero: '88', bairro: 'SALESIANOS', cidade: 'JUAZEIRO DO NORTE', uf: 'CE',
      limite_credito: 150, tipo_comercial_id: tipoAtacadistaId
    });
  });

  it('editar só o telefone no modal preserva tudo, inclusive Tipo Comercial e CPF/CNPJ', async () => {
    const { id, salvo } = await criarClienteCompleto();
    tela.window.editCliente(id);
    await tela.aguardarAjax();
    assert.equal(tela.valor('numero'), '123');
    assert.equal(tela.valor('bairro'), 'CENTRO');
    assert.equal(tela.valor('tipo_comercial_id'), String(tipoAtacadistaId), 'select do tipo carregado com o valor atual');
    assert.match(tela.valor('cpf_cnpj'), /^\d{3}\.\d{3}\.\d{3}-\d{2}$/, 'máscara visual mantida');
    tela.preencher({ telefone: '(88) 91234-5678' });
    tela.window.saveCliente();
    await tela.aguardarAjax();
    assert.deepEqual(await lerCliente(id), { ...salvo, telefone: '(88) 91234-5678' });
  });

  it('CPF/CNPJ duplicado: o modal mostra a mensagem do 409 e nada muda', async () => {
    const a = await criarClienteCompleto();
    const b = await criarClienteCompleto();
    tela.notificacoes.length = 0;
    tela.window.editCliente(b.id);
    await tela.aguardarAjax();
    tela.preencher({ cpf_cnpj: tela.window.formatarCpfCnpj(a.salvo.cpf_cnpj), nome: 'NÃO DEVE GRAVAR' });
    tela.window.saveCliente();
    await tela.aguardarAjax();
    assert.ok(tela.notificacoes.some((n) => n.tipo === 'danger' && /Já existe um cliente cadastrado com este CPF\/CNPJ/.test(n.msg)),
      JSON.stringify(tela.notificacoes));
    assert.deepEqual(await lerCliente(b.id), b.salvo);
  });
});

describe('CLIENTES-01 — TESTE 12: regressão PDV (modal de clientes do PDV)', () => {
  let tela;
  before(() => { tela = criarJanelaModal('frontend/pdv/js/clientes.js'); });
  after(() => tela.window.close());

  it('PDV cria cliente (sem Tipo Comercial na tela → padrão Consumidor Final, regra existente)', async () => {
    tela.window.showClienteModal(null);
    tela.preencher({
      nome: 'CLIENTE VIA PDV', cpf_cnpj: '529.982.247-25', telefone: '(88) 98000-0000', email: '',
      cep: '63050-000', rua: 'RUA DO PDV', numero: '5', bairro: 'JOÃO CABRAL', cidade: 'JUAZEIRO DO NORTE', uf: 'CE',
      limite_credito: '0'
    });
    tela.window.saveCliente();
    await tela.aguardarAjax();
    const row = await get(`SELECT id FROM clientes WHERE nome = 'CLIENTE VIA PDV'`);
    const salvo = await lerCliente(row.id);
    assert.equal(salvo.cpf_cnpj, '52998224725');
    assert.equal(salvo.numero, '5');
    assert.equal(salvo.bairro, 'JOÃO CABRAL');
    assert.equal(salvo.tipo_comercial_id, tipoConsumidorId);
  });

  it('PDV edita o nome de um cliente Atacadista: Tipo Comercial, número, bairro e CPF/CNPJ preservados', async () => {
    const { id, salvo } = await criarClienteCompleto();
    tela.window.editCliente(id);
    await tela.aguardarAjax();
    tela.preencher({ nome: 'EDITADO NO PDV' });
    tela.window.saveCliente();
    await tela.aguardarAjax();
    const [put] = tela.puts().slice(-1);
    assert.ok(!('tipo_comercial_id' in put.body), 'PDV não envia tipo (tela inalterada)');
    assert.deepEqual(await lerCliente(id), { ...salvo, nome: 'EDITADO NO PDV' });
  });
});

// ===========================================================================
// Mobile — Cadastros › Clientes e Comercial › Cliente Consignado (módulos ES reais)
// ===========================================================================

describe('CLIENTES-01 — TESTE 13: regressão Mobile', () => {
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
    const perfis = new Map();
    const chamarReal = async (metodo, rota, body) => {
      const r = await api(metodo, `/${rota}`, body);
      if (r.status >= 300) throw Object.assign(new Error(r.body?.message || r.body?.error || `HTTP ${r.status}`), { payload: r.body });
      return r.body;
    };
    dom.window.CDSApi = {
      async get(rota, params) {
        chamadasApi.push({ metodo: 'GET', rota, params });
        if (rota === 'comercial/perfil-comercial') return { data: perfis.get(Number(params?.clienteId)) || [] };
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
    dom.window.__perfisMobile = perfis;
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

  it('Cadastros › Clientes (payload igual ao Desktop, sem tipo): edição preserva Tipo Comercial e normaliza CPF/CNPJ', async () => {
    const { id, salvo } = await criarClienteCompleto();
    const formatado = `${salvo.cpf_cnpj.slice(0, 3)}.${salvo.cpf_cnpj.slice(3, 6)}.${salvo.cpf_cnpj.slice(6, 9)}-${salvo.cpf_cnpj.slice(9)}`;
    const payload = clientesMobile.buildClientePayload({ ...salvo, cpf_cnpj: formatado, nome: 'EDITADO NO MOBILE', limite_credito: String(salvo.limite_credito) });
    assert.ok(!('tipo_comercial_id' in payload));
    const r = await api('PUT', `/clientes/${id}`, payload);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(await lerCliente(id), { ...salvo, nome: 'EDITADO NO MOBILE' });
  });

  it('Comercial › Cliente Consignado: editar o nome preserva limite de crédito, tipo, número e bairro', async () => {
    const { id, salvo } = await criarClienteCompleto({ limite_credito: 420 });
    dom.window.__perfisMobile.set(id, [{ id: 31, perfilTipo: 'CONSIGNADO', ativo: true, limiteComercial: 200 }]);
    const root = document.getElementById('app');
    await comercialClientes.renderForm(root, id);
    const form = root.querySelector('#cc-form');
    assert.ok(form, 'formulário renderizado');
    assert.equal(form.querySelector('[name="numero"]').value, '123');
    assert.equal(form.querySelector('[name="bairro"]').value, 'CENTRO');
    form.querySelector('[name="nome"]').value = 'EDITADO NO MOBILE COMERCIAL';
    const antes = chamadasApi.length;
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await aguardar(() => chamadasApi.slice(antes).some((c) => c.metodo === 'PATCH'), 'perfil atualizado após salvar cliente');
    const put = chamadasApi.slice(antes).find((c) => c.metodo === 'PUT' && c.rota === `clientes/${id}`);
    assert.ok(put, 'PUT do cliente enviado');
    assert.ok(!('limite_credito' in put.body), 'sem capacidade Crédito o limite não é enviado na edição');
    assert.deepEqual(await lerCliente(id), { ...salvo, nome: 'EDITADO NO MOBILE COMERCIAL' });
  });

  it('Comercial › Cliente Consignado: com Crédito marcado o limite segue a regra existente', async () => {
    const { id, salvo } = await criarClienteCompleto({ limite_credito: 50 });
    dom.window.__perfisMobile.set(id, [{ id: 32, perfilTipo: 'CONSUMIDOR', ativo: true, limiteComercial: 600 }]);
    const root = document.getElementById('app');
    await comercialClientes.renderForm(root, id);
    const form = root.querySelector('#cc-form');
    assert.equal(form.querySelector('[name="cap_credito"]').checked, true);
    const antes = chamadasApi.length;
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await aguardar(() => chamadasApi.slice(antes).some((c) => c.metodo === 'PATCH'), 'perfil atualizado após salvar cliente');
    const put = chamadasApi.slice(antes).find((c) => c.metodo === 'PUT' && c.rota === `clientes/${id}`);
    assert.equal(put.body.limite_credito, 600);
    assert.deepEqual(await lerCliente(id), { ...salvo, limite_credito: 600 });
  });
});

describe('CLIENTES-01 — escopo', () => {
  // A IE (inscricao_estadual) passou a fazer parte do cadastro na CLIENTES-02.
  it('nenhuma migration na rota nem campo fora de escopo introduzido no cadastro de clientes', () => {
    const rota = read('backend/rotas/clientes.js');
    const view = read('frontend/modules/motor-comercial/pages/PerfilComercial/ClienteCadastroView.js');
    for (const campo of ['razao_social', 'codigo_municipio', 'utiliza_limite_credito', 'celular =']) {
      assert.ok(!rota.includes(campo), `rota não usa ${campo}`);
    }
    assert.ok(!/indIEDest/.test(view), 'tela não decide indIEDest');
    assert.ok(!/ALTER TABLE|CREATE TABLE/i.test(rota), 'rota sem DDL');
  });
});
