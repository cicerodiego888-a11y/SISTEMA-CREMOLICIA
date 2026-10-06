/**
 * NF-E-04.3 — Auditoria e unificação da configuração NF-e.
 *
 * Fonte única: fiscal_ambiente_nfe (resolverAmbienteNfe) para ambiente/tpAmb; resolverWebserviceNfe
 * para o WebService; GET /api/nfe/prontidao para a prontidão (Diagnóstico NF-e e Nova NF-e).
 * fiscal_ambiente continua sendo apenas da NFC-e. O backend é a última barreira.
 *
 * Banco isolado em %TEMP%; nenhuma chamada à SEFAZ (rede bloqueada); nenhuma NF-e emitida.
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

const DIR = path.join(process.env.TEMP || os.tmpdir(), 'cds-nfe-testes', 'config-043');
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
const lock = require('../../backend/services/fiscal/nfeEmissionLockService');
const pedidos = require('../../backend/services/pedidos/orcamentoPedidoService');
const { getFiscalConfigNfe } = require('../../backend/services/fiscal/configService');
const guard = require('../../backend/services/fiscal/nfeAmbienteGuard');
const ws = require('../../backend/services/fiscal/nfeWebServices');
const prontidao = require('../../backend/services/fiscal/nfeProntidaoService');
const nfeUi = require('../../frontend/erp/js/nfe.js');

const CNPJ = '36811652000153';
const CPF_CLIENTE = '529.982.247-25';
const URL_SVRS_HOM = 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx';
const URL_SVRS_PROD = 'https://nfe.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx';

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
    return Number((await get(`SELECT COUNT(*) AS n FROM ${tabela} WHERE ${where}`, params)).n);
  } catch (err) {
    if (/no such table/i.test(err.message)) return 0;
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
const apagarConfig = (chave) => run('DELETE FROM configuracoes WHERE chave = ?', [chave]);

/**
 * Bloqueia saídas de rede durante `fn`; devolve as tentativas registradas.
 * `local: true` mantém TCP/HTTP liberados para a API do teste em 127.0.0.1 (SEFAZ exige DNS + TLS/HTTPS).
 */
async function semRede(fn, { local = false } = {}) {
  const tentativas = [];
  const bloquear = (nome) => () => {
    tentativas.push(nome);
    throw new Error(`rede bloqueada no teste (${nome})`);
  };
  const alvos = [[tls, 'connect'], [dns, 'lookup'], [https, 'request']];
  if (!local) alvos.push([net.Socket.prototype, 'connect'], [http, 'request']);
  const originais = alvos.map(([alvo, nome]) => [alvo, nome, alvo[nome]]);
  for (const [alvo, nome] of originais) alvo[nome] = bloquear(nome);
  try {
    return { resultado: await fn(), tentativas };
  } finally {
    for (const [alvo, nome, original] of originais) alvo[nome] = original;
  }
}

const CONFIG_BASE = {
  nome_empresa: 'CREMOLICIA TESTE LTDA',
  cnpj: CNPJ,
  fiscal_ie: '061234567',
  fiscal_ambiente: '2',
  fiscal_ambiente_nfe: '2',
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
  fiscal_municipio_codigo: '2307304',
  fiscal_municipio_nome: 'JUAZEIRO DO NORTE'
};
const CHAVES_WS = ['autorizacao', 'consulta', 'status', 'evento']
  .flatMap((s) => [`fiscal_ws_nfe_${s}_homologacao`, `fiscal_ws_nfe_${s}_producao`]);

let produtoId;
let clienteId;
let server;
let base;
let tokenAdmin;

async function restaurarConfig() {
  for (const [k, v] of Object.entries(CONFIG_BASE)) await setConfig(k, v);
  for (const k of CHAVES_WS) await setConfig(k, '');
}

before(async () => {
  assert.ok(!/MercantilFiscal/i.test(DIR), 'nunca o banco oficial');
  assert.ok(path.resolve(process.env.DB_DIR).startsWith(path.resolve(process.env.TEMP || os.tmpdir())), 'banco temporário');
  await new Promise((resolve, reject) => db.whenReady((err) => (err ? reject(err) : resolve())));
  assert.equal(path.resolve(db.dbPath), path.resolve(DIR, 'mercadao.db'));
  assert.ok(!/MercantilFiscal/i.test(db.dbPath), 'nunca o banco oficial');
  await restaurarConfig();

  produtoId = (await run(
    `INSERT INTO produtos (codigo, nome, unidade, preco_venda, estoque_atual, saldo_fiscal, saldo_nao_fiscal, ncm, cfop, csosn, origem, ativo)
     VALUES ('SORV-043', 'SORVETE TESTE 043', 'UN', 10, 200, 200, 0, '21050010', '5102', '102', '0', 1)`
  )).id;
  clienteId = (await run(
    `INSERT INTO clientes (nome, cpf_cnpj, rua, numero, bairro, cidade, uf, cep)
     VALUES ('CLIENTE TESTE NFE043', ?, 'RUA CLIENTE', '10', 'BAIRRO', 'JUAZEIRO DO NORTE', 'CE', '63000-000')`,
    [CPF_CLIENTE]
  )).id;
  const adminId = (await run(`INSERT INTO usuarios (username, password_hash, role) VALUES ('nfe043adm', 'x', 'admin')`)).id;
  tokenAdmin = jwt.sign({ id: adminId, username: 'nfe043adm', role: 'admin', perfil: 'ADMIN' }, auth.JWT_SECRET);

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

/** Prontidão do banco temporário (mesma leitura de GET /api/nfe/prontidao). */
const prontidaoBanco = () => prontidao.diagnosticarProntidaoNfe({ dbDir: DIR });
const itemDe = (out, id) => out.itens.find((i) => i.id === id);

// ===========================================================================
// Ambiente (1–5)
// ===========================================================================

describe('NF-E-04.3 — ambiente NF-e: fonte única fiscal_ambiente_nfe', () => {
  after(restaurarConfig);

  it('1) fiscal_ambiente_nfe ausente → homologação (padrão), no emissor e no diagnóstico', async () => {
    assert.deepEqual(guard.resolverAmbienteNfe({}), { ambiente: 2, valido: true, origem: 'padrao', valorConfigurado: null });
    await apagarConfig('fiscal_ambiente_nfe');
    const cfg = await getFiscalConfigNfe();
    assert.equal(cfg.ambiente, 2);
    assert.equal(cfg.ambienteNfeOrigem, 'padrao');
    const diag = await prontidaoBanco();
    assert.equal(diag.tpAmb, 2);
    assert.equal(diag.ambienteOrigem, 'padrao');
    assert.equal(itemDe(diag, 'ambiente').nivel, 'ok');
    await setConfig('fiscal_ambiente_nfe', '2');
  });

  it('2) fiscal_ambiente_nfe = 2 → homologação (tpAmb 2)', async () => {
    assert.equal(guard.resolverAmbienteNfe({ fiscal_ambiente_nfe: '2' }).ambiente, 2);
    assert.equal((await getFiscalConfigNfe()).ambiente, 2);
    const diag = await prontidaoBanco();
    assert.equal(diag.tpAmb, 2);
    assert.equal(diag.ambienteOrigem, 'fiscal_ambiente_nfe');
    assert.match(itemDe(diag, 'ambiente').mensagem, /Homologação \(tpAmb = 2\)/);
  });

  it('3) fiscal_ambiente_nfe = 1 → produção, bloqueada (PRODUCAO_NFE_LIBERADA = false)', async () => {
    await setConfig('fiscal_ambiente_nfe', '1');
    try {
      assert.equal((await getFiscalConfigNfe()).ambiente, 1);
      assert.equal(guard.ambienteNfePermitido(1), false);
      assert.throws(() => guard.assertAmbienteNfePermitido(1, 'autorizacao'), { code: guard.CODIGO_PRODUCAO_BLOQUEADA });
      const diag = await prontidaoBanco();
      assert.equal(diag.pronta, false);
      assert.equal(itemDe(diag, 'ambiente').nivel, 'bloqueado');
      assert.equal(itemDe(diag, 'ambiente').codigo, 'NFE_PRODUCAO_BLOQUEADA');
      assert.equal(diag.producaoBloqueada, true);
    } finally {
      await setConfig('fiscal_ambiente_nfe', '2');
    }
  });

  it('4) fiscal_ambiente_nfe inválido → sem ambiente; diagnóstico pendente e NF-e não pronta', async () => {
    for (const valor of ['3', '0', 'abc', 'homologacao']) {
      const r = guard.resolverAmbienteNfe({ fiscal_ambiente_nfe: valor });
      assert.equal(r.valido, false, valor);
      assert.equal(r.ambiente, null, valor);
    }
    await setConfig('fiscal_ambiente_nfe', 'abc');
    try {
      const cfg = await getFiscalConfigNfe();
      assert.equal(guard.ambienteNfePermitido(cfg.ambiente), false, 'emissor recusa ambiente inválido');
      const diag = await prontidaoBanco();
      assert.equal(diag.pronta, false);
      assert.equal(itemDe(diag, 'ambiente').codigo, 'NFE_AMBIENTE_INVALIDO');
      assert.ok(diag.pendencias.includes('Ambiente'));
    } finally {
      await setConfig('fiscal_ambiente_nfe', '2');
    }
  });

  it('5) fiscal_ambiente (NFC-e) = 1 não altera a NF-e: emissor e diagnóstico continuam em homologação', async () => {
    await setConfig('fiscal_ambiente', '1');
    try {
      const cfg = await getFiscalConfigNfe();
      assert.equal(cfg.ambiente, 2);
      assert.equal(cfg.ambienteNfce, 1);
      const diag = await prontidaoBanco();
      assert.equal(diag.tpAmb, cfg.ambiente, 'diagnóstico e emissor leem a mesma fonte');
      assert.equal(diag.ambienteNfce, 'Produção');
      assert.equal(itemDe(diag, 'ambiente').nivel, 'ok');
      assert.equal(diag.webservices.autorizacao.url, URL_SVRS_HOM);
    } finally {
      await setConfig('fiscal_ambiente', '2');
    }
  });
});

// ===========================================================================
// WebService (6–11)
// ===========================================================================

describe('NF-E-04.3 — WebService NF-e: resolvedor único', () => {
  after(restaurarConfig);

  it('6) CE + homologação → SVRS homologação (padrão oficial) para todos os serviços', () => {
    const cfg = { ambiente: 2, codigoUf: '23', urlsNfe: {} };
    const aut = ws.resolverWebserviceNfe('autorizacao', 2, cfg);
    assert.equal(aut.ok, true);
    assert.equal(aut.url, URL_SVRS_HOM);
    assert.equal(aut.origem, 'padrao_svrs');
    assert.equal(aut.chave, 'fiscal_ws_nfe_autorizacao_homologacao');
    for (const servico of ['consultaProtocolo', 'status', 'evento']) {
      const r = ws.resolverWebserviceNfe(servico, 2, cfg);
      assert.equal(r.ok, true, servico);
      assert.equal(new URL(r.url).hostname, 'nfe-homologacao.svrs.rs.gov.br', servico);
    }
    assert.ok(ws.UFS_AUTORIZADOR_SVRS_NFE.includes('23'));
  });

  it('7) CE + produção → SVRS produção (nenhum host de homologação)', () => {
    const r = ws.resolverWebserviceNfe('autorizacao', 1, { ambiente: 1, codigoUf: '23', urlsNfe: {} });
    assert.equal(r.ok, true);
    assert.equal(r.url, URL_SVRS_PROD);
    assert.equal(r.chave, 'fiscal_ws_nfe_autorizacao_producao');
  });

  it('8) URL configurada válida (chave existente) prevalece sobre o padrão', () => {
    const custom = 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx?teste=043';
    const urls = ws.urlsNfeDaConfiguracao({ fiscal_ws_nfe_autorizacao_homologacao: custom }, 2);
    const r = ws.resolverWebserviceNfe('autorizacao', 2, { ambiente: 2, codigoUf: '23', urlsNfe: urls });
    assert.equal(r.ok, true);
    assert.equal(r.url, custom);
    assert.equal(r.origem, 'configuracao');
    const outroAmbiente = ws.resolverWebserviceNfe('autorizacao', 1, { ambiente: 2, codigoUf: '23', urlsNfe: urls });
    assert.equal(outroAmbiente.url, URL_SVRS_PROD, 'URL de homologação nunca é usada em produção');
  });

  it('9) URL ausente: fallback SVRS só para UF atendida pela SVRS; outra UF fica não configurada', () => {
    assert.equal(ws.resolverWebserviceNfe('autorizacao', 2, { ambiente: 2, codigoUf: '23', urlsNfe: {} }).url, URL_SVRS_HOM);
    const sp = ws.resolverWebserviceNfe('autorizacao', 2, { ambiente: 2, codigoUf: '35', urlsNfe: {} });
    assert.equal(sp.ok, false);
    assert.equal(sp.codigo, 'WS_NFE_NAO_CONFIGURADO');
    assert.equal(sp.url, null);
    assert.throws(() => ws.resolverUrlNfe('autorizacao', 2, { ambiente: 2, codigoUf: '35', urlsNfe: {} }), { code: 'WS_NFE_NAO_CONFIGURADO' });
  });

  it('10) URL inválida: sem https, NFC-e ou do outro ambiente → erro com código, sem fallback silencioso', () => {
    const casos = [
      ['http://nfe-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx', 'WS_NFE_INVALIDO'],
      ['nao-e-url', 'WS_NFE_INVALIDO'],
      ['https://nfce-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx', 'WS_NFE_URL_NFCE'],
      [URL_SVRS_PROD, 'WS_NFE_PRODUCAO_EM_HOMOLOGACAO']
    ];
    for (const [url, codigo] of casos) {
      const r = ws.resolverWebserviceNfe('autorizacao', 2, { ambiente: 2, codigoUf: '23', urlsNfe: { autorizacao: url } });
      assert.equal(r.ok, false, url);
      assert.equal(r.codigo, codigo, url);
    }
    const homEmProd = ws.resolverWebserviceNfe('autorizacao', 1, { ambiente: 1, codigoUf: '23', urlsNfe: { autorizacao: URL_SVRS_HOM } });
    assert.equal(homEmProd.codigo, 'WS_NFE_HOMOLOGACAO_EM_PRODUCAO');
  });

  it('11) emissor, diagnóstico e GET /api/nfe/prontidao usam o mesmo resolvedor e as mesmas chaves', async () => {
    const custom = 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx?teste=043';
    for (const valor of ['', custom]) {
      await setConfig('fiscal_ws_nfe_autorizacao_homologacao', valor);
      const cfg = await getFiscalConfigNfe();
      const doEmissor = ws.resolverWebserviceNfe('autorizacao', cfg.ambiente, cfg);
      assert.equal(ws.resolverUrlNfe('autorizacao', cfg.ambiente, cfg), doEmissor.url);
      const diag = await prontidaoBanco();
      assert.equal(diag.webservices.autorizacao.url, doEmissor.url, `valor ${valor || '(vazio)'}`);
      assert.equal(diag.webservices.autorizacao.origem, doEmissor.origem);
      const r = await fetch(`${base}/nfe/prontidao`, { headers: { Authorization: `Bearer ${tokenAdmin}` } });
      assert.equal((await r.json()).webservices.autorizacao.url, doEmissor.url);
    }
    await setConfig('fiscal_ws_nfe_autorizacao_homologacao', '');

    for (const arquivo of ['nfeEmissorVenda.js', 'nfeProntidaoService.js', 'nfeCentralService.js', 'cancelarNfe.js', 'configService.js']) {
      const src = read(`backend/services/fiscal/${arquivo}`);
      assert.doesNotMatch(src, /svrs\.rs\.gov\.br|sefazvirtual/i, `${arquivo}: sem URL fixa`);
    }
    assert.match(read('backend/services/fiscal/nfeEmissorVenda.js'), /resolverWebserviceNfe\('autorizacao'/);
    assert.match(read('backend/services/fiscal/nfeProntidaoService.js'), /resolverWebserviceNfe/);
    assert.doesNotMatch(read('frontend/erp/js/nfe.js'), /https?:\/\/[^'"`\s]*svrs/i, 'frontend não fixa URL');
    assert.deepEqual(Object.values(ws.CHAVES_WS_NFE).sort(),
      ['fiscal_ws_nfe_autorizacao', 'fiscal_ws_nfe_consulta', 'fiscal_ws_nfe_evento', 'fiscal_ws_nfe_status'], 'sem chaves novas');
  });
});

// ===========================================================================
// Prontidão (12–16)
// ===========================================================================

describe('NF-E-04.3 — prontidão oficial', () => {
  const pfx = path.join(DIR, 'cert-043.pfx');
  before(() => fs.writeFileSync(pfx, 'pfx-simulado-043'));

  const CFG_PRONTA = {
    ...CONFIG_BASE, fiscal_certificado_path: pfx, fiscal_certificado_senha: 'senha-043', fiscal_ambiente: '1'
  };
  const diag = (extra = {}, inspecionar = () => ({ cnpj: CNPJ, valido: true, notAfter: '2027-01-01T00:00:00Z' })) =>
    prontidao.diagnosticarProntidaoNfe({
      dbDir: DIR,
      lerConfiguracoes: async (chaves) => {
        const cfg = { ...CFG_PRONTA, ...extra };
        return Object.fromEntries(chaves.filter((k) => cfg[k] !== undefined).map((k) => [k, cfg[k]]));
      },
      lerProximoNumero: async () => 7,
      inspecionarCertificado: inspecionar
    });

  it('12) configuração completa → pronta (homologação, SVRS, produção bloqueada), com NFC-e em produção', async () => {
    const out = await diag();
    assert.equal(out.pronta, true, JSON.stringify(out.pendencias));
    assert.equal(out.status, 'PRONTA_PARA_HOMOLOGACAO');
    assert.equal(out.tpAmb, 2);
    assert.equal(out.ambienteNfce, 'Produção');
    assert.equal(itemDe(out, 'webservice').valor, URL_SVRS_HOM);
    assert.equal(itemDe(out, 'producao').valor, 'Bloqueada');
    assert.equal(out.chamadasSefaz, 0);
    assert.doesNotMatch(JSON.stringify(out), /senha-043/);
  });

  it('13) WebService inválido/ausente sem autorizador → NÃO CONFIGURADA (erro não mascarado)', async () => {
    const semUf = await diag({ fiscal_codigo_uf: '35' });
    assert.equal(semUf.pronta, false);
    assert.equal(itemDe(semUf, 'webservice').codigo, 'WS_NFE_NAO_CONFIGURADO');
    assert.ok(semUf.pendencias.includes('Webservice'));
    const http = await diag({ fiscal_ws_nfe_status_homologacao: 'http://inseguro.invalid/ws' });
    assert.equal(http.pronta, false);
    assert.equal(itemDe(http, 'webservice').codigo, 'WS_NFE_INVALIDO');
    assert.equal(http.webservices.status.ok, false);
  });

  it('14) certificado inválido (não abre / fora da validade) → não pronta', async () => {
    const naoAbre = await diag({}, () => { const e = new Error('mac verify failure'); e.codigo = 'CERTIFICATE_INVALID'; throw e; });
    assert.equal(naoAbre.pronta, false);
    assert.equal(itemDe(naoAbre, 'certificado').codigo, 'CERTIFICATE_INVALID');
    const vencido = await diag({}, () => { const e = new Error('vencido'); e.codigo = 'CERTIFICATE_EXPIRED'; throw e; });
    assert.equal(itemDe(vencido, 'certificado').nivel, 'bloqueado');
    const futuro = await diag({}, () => ({ cnpj: CNPJ, valido: false }));
    assert.equal(futuro.pronta, false);
  });

  it('15) CNPJ do certificado divergente → bloqueado', async () => {
    const out = await diag({}, () => ({ cnpj: '99888777000166', valido: true }));
    assert.equal(out.pronta, false);
    assert.equal(itemDe(out, 'certificado').codigo, 'CERTIFICATE_CONFIGURATION_ERROR');
    assert.match(itemDe(out, 'certificado').mensagem, /diverge/);
  });

  it('16) ambiente inválido ou produção → não pronta', async () => {
    const invalido = await diag({ fiscal_ambiente_nfe: '9' });
    assert.equal(invalido.pronta, false);
    assert.equal(invalido.tpAmb, null);
    assert.equal(itemDe(invalido, 'ambiente').codigo, 'NFE_AMBIENTE_INVALIDO');
    const producao = await diag({ fiscal_ambiente_nfe: '1' });
    assert.equal(producao.pronta, false);
    assert.equal(itemDe(producao, 'ambiente').codigo, 'NFE_PRODUCAO_BLOQUEADA');
  });
});

// ===========================================================================
// Frontend — Nova NF-e (17–21)
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
  window.confirm = () => true;
  const paginas = [];
  window.loadPage = (p) => paginas.push(p);
  const chamadas = [];
  const rotas = {};
  window.fetch = async (url, opts = {}) => {
    const u = new URL(url, 'http://localhost');
    const rota = `${String(opts.method || 'GET').toUpperCase()} ${u.pathname}`;
    chamadas.push({ rota, url: u.href });
    const r = rotas[rota];
    if (r && r.erroRede) throw new TypeError('Failed to fetch');
    const status = r ? (r.status || 200) : 404;
    const texto = JSON.stringify(r ? r.body : { success: false });
    return { ok: status < 300, status, headers: { get: () => null }, json: async () => JSON.parse(texto), text: async () => texto };
  };
  const doc = window.document;
  return { window, doc, rotas, chamadas, paginas, posts: () => chamadas.filter((c) => !c.rota.startsWith('GET ')) };
}
const esperar = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function aguardar(fn, tentativas = 60) {
  for (let i = 0; i < tentativas; i += 1) {
    const v = fn();
    if (v) return v;
    await esperar(5);
  }
  return null;
}
const DIAG_PRONTA = { success: true, pronta: true, status: 'PRONTA_PARA_HOMOLOGACAO', ambiente: '2', tpAmb: 2, itens: [], pendencias: [], chamadasSefaz: 0 };
const DIAG_WS_INVALIDO = {
  success: true, pronta: false, status: 'NAO_CONFIGURADA', ambiente: '2', tpAmb: 2,
  itens: [{ id: 'webservice', nome: 'Webservice', nivel: 'pendente', ok: false, codigo: 'WS_NFE_INVALIDO', mensagem: 'URL do WebService NF-e inválida.' }],
  pendencias: ['Webservice'], chamadasSefaz: 0
};
const botaoEmitirLiberado = (doc) => {
  const b = doc.getElementById('nfeBtnEmitirNova');
  return Boolean(b && !b.disabled);
};

describe('NF-E-04.3 — Nova NF-e consulta a prontidão oficial', () => {
  after(() => {
    for (const w of janelas.splice(0)) w.close();
  });

  it('17) pronta → "✓ NF-e pronta para emissão." e [Emitir NF-e] liberado', async () => {
    const ctx = criarJanela();
    ctx.rotas['GET /api/nfe/prontidao'] = { body: DIAG_PRONTA };
    await ctx.window.loadNfePagina('fiscal-nfe-nova');
    assert.deepEqual(ctx.chamadas.map((c) => c.rota), ['GET /api/nfe/prontidao', 'GET /api/clientes', 'GET /api/produtos']);
    assert.match(ctx.doc.getElementById('nfeNovaStatus').textContent, /✓ NF-e pronta para emissão\./);
    assert.match(ctx.doc.getElementById('nfeNovaStatus').textContent, /Homologação \(tpAmb 2\)/);
    assert.equal(ctx.doc.getElementById('nfeBtnEmitirNova'), null, 'pronta não mostra o botão superior Emitir NF-e');
    assert.doesNotMatch(ctx.doc.body.textContent, /Modo operacional fiscal|F12/);
  });

  it('18) não pronta (recurso NF-e ativo) → aviso e [Emitir NF-e] bloqueado; clique não abre o formulário', async () => {
    const ctx = criarJanela();
    ctx.rotas['GET /api/nfe/prontidao'] = { body: DIAG_WS_INVALIDO };
    await ctx.window.loadNfePagina('fiscal-nfe-nova');
    assert.match(ctx.doc.getElementById('nfeNovaStatus').textContent, /⚠ NF-e não está pronta para emissão\./);
    assert.match(ctx.doc.getElementById('nfeNovaPendencias').textContent, /Webservice: URL do WebService NF-e inválida\./);
    const btn = ctx.doc.getElementById('nfeBtnEmitirNova');
    assert.equal(btn.disabled, true);
    btn.click();
    await esperar(20);
    assert.equal(ctx.doc.getElementById('modalNfeManual'), null);
    assert.deepEqual(ctx.chamadas.map((c) => c.rota), ['GET /api/nfe/prontidao']);
  });

  it('19) [Abrir Diagnóstico NF-e] leva ao Diagnóstico NF-e', async () => {
    const ctx = criarJanela();
    ctx.rotas['GET /api/nfe/prontidao'] = { body: DIAG_WS_INVALIDO };
    await ctx.window.loadNfePagina('fiscal-nfe-nova');
    const ir = ctx.doc.querySelector('[data-ir-pagina="fiscal-nfe-diagnostico"]');
    assert.match(ir.textContent, /Abrir Diagnóstico NF-e/);
    ir.click();
    assert.deepEqual(ctx.paginas, ['fiscal-nfe-diagnostico']);
    assert.equal(ctx.posts().length, 0);
  });

  it('20) [Tentar novamente] só reconsulta a prontidão (sem POST, sem formulário)', async () => {
    const ctx = criarJanela();
    ctx.rotas['GET /api/nfe/prontidao'] = { body: DIAG_WS_INVALIDO };
    await ctx.window.loadNfePagina('fiscal-nfe-nova');
    ctx.doc.querySelector('[data-acao="tentar-novamente"]').click();
    assert.ok(await aguardar(() => ctx.chamadas.length === 2 && ctx.doc.getElementById('nfeNovaPainel')));
    assert.equal(botaoEmitirLiberado(ctx.doc), false);
    ctx.rotas['GET /api/nfe/prontidao'] = { body: DIAG_PRONTA };
    ctx.doc.querySelector('[data-acao="tentar-novamente"]').click();
    assert.ok(await aguardar(() => ctx.doc.getElementById('nfeNovaPainel')?.dataset.situacao === 'pronta'));
    assert.equal(ctx.doc.getElementById('nfeBtnEmitirNova'), null);
    assert.equal(ctx.chamadas.filter((c) => c.rota === 'GET /api/nfe/prontidao').length, 3);
    assert.ok(ctx.chamadas.every((c) => c.rota.startsWith('GET ')));
    assert.equal(ctx.posts().length, 0);
  });

  it('21) erro na consulta (500, rede, resposta sem "pronta") nunca deixa [Emitir NF-e] liberado', async () => {
    for (const resposta of [{ status: 500, body: { success: false } }, { erroRede: true }, { body: { success: true } }, { body: { success: true, pronta: 'sim' } }]) {
      const ctx = criarJanela();
      ctx.rotas['GET /api/nfe/prontidao'] = resposta;
      await ctx.window.loadNfePagina('fiscal-nfe-nova');
      assert.equal(botaoEmitirLiberado(ctx.doc), false, JSON.stringify(resposta));
      assert.ok(ctx.doc.querySelector('#nfeSecaoConteudo [data-estado="error"]'), JSON.stringify(resposta));
      assert.ok(ctx.doc.querySelector('[data-acao="tentar-novamente"]'));
    }
    const ctx = criarJanela();
    ctx.rotas['GET /api/nfe/prontidao'] = { body: DIAG_PRONTA };
    await ctx.window.loadNfePagina('fiscal-nfe-nova');
    assert.equal(ctx.doc.getElementById('nfeBtnEmitirNova'), null, 'não há segundo caminho pelo botão superior');
    assert.equal(ctx.posts().length, 0);
  });
});

// ===========================================================================
// Segurança — backend é a última barreira (22–27)
// ===========================================================================

describe('NF-E-04.3 — backend bloqueia configuração inválida antes de faturar', () => {
  after(restaurarConfig);

  const dadosNfe = () => nfeUi.montarPayloadEmissaoNfe({
    tipo: 'CPF', documento: CPF_CLIENTE, nome: 'CLIENTE NFE 043', logradouro: 'RUA DAS FLORES', numero: '45',
    bairro: 'CENTRO', municipio: 'Juazeiro do Norte', uf: 'CE', cep: '63010-000',
    natureza: 'VENDA DE MERCADORIA', cfop: '5102'
  });
  const post = (rota, body) => fetch(`${base}${rota}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAdmin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(async (r) => ({ status: r.status, json: await r.json() }));
  async function retrato(pedidoId) {
    return {
      pedido: pedidoId ? await get('SELECT status, venda_id, faturado_em FROM pedidos_comerciais WHERE id = ?', [pedidoId]) : null,
      vendas: await contar('vendas'),
      saldoFiscal: Number((await get('SELECT saldo_fiscal FROM produtos WHERE id = ?', [produtoId])).saldo_fiscal),
      estoqueAtual: Number((await get('SELECT estoque_atual FROM produtos WHERE id = ?', [produtoId])).estoque_atual),
      financeiro: await contar('financeiro'),
      contasReceber: await contar('contas_receber'),
      nfe: await contar('nfe_notas'),
      nfce: await contar('nfce_notas')
    };
  }
  const CONFIGS_INVALIDAS = [
    ['WebService sem https', 'fiscal_ws_nfe_autorizacao_homologacao', 'http://inseguro.invalid/ws', 'Webservice'],
    ['ambiente NF-e inválido', 'fiscal_ambiente_nfe', 'abc', 'Ambiente'],
    ['produção NF-e', 'fiscal_ambiente_nfe', '1', 'Ambiente']
  ];

  it('22/23) chamada direta à API (sem a tela) é recusada: manual e pedido → 409 NFE_NAO_PRONTA', async () => {
    for (const [rotulo, chave, valor, pendencia] of CONFIGS_INVALIDAS) {
      await setConfig(chave, valor);
      try {
        const pedido = await pedidos.criarPedidoDireto({
          cliente_id: clienteId, itens: [{ produto_id: produtoId, quantidade: 2, preco_unitario: 10 }], forma_pagamento: 'dinheiro'
        });
        const { resultado, tentativas } = await semRede(async () => ({
          manual: await post('/nfe/manual/emitir', {
            chave_operacao: `teste-043-${Date.now()}-${chave}`, cliente_id: clienteId,
            itens: [{ produto_id: produtoId, quantidade: 1, preco_unitario: 15 }], forma_pagamento: 'dinheiro', dados_nfe: dadosNfe()
          }),
          pedido: await post(`/pedidos/${pedido.id}/emitir-nfe`, { dados_nfe: dadosNfe() })
        }), { local: true });
        assert.deepEqual(tentativas, [], `${rotulo}: nenhuma chamada externa`);
        for (const [origem, r] of Object.entries(resultado)) {
          assert.equal(r.status, 409, `${rotulo} (${origem})`);
          assert.equal(r.json.codigo, 'NFE_NAO_PRONTA', `${rotulo} (${origem})`);
          assert.ok(r.json.pendencias.includes(pendencia), `${rotulo} (${origem}): ${r.json.pendencias}`);
        }
      } finally {
        await setConfig(chave, CONFIG_BASE[chave] ?? '');
      }
    }
  });

  it('24/25/26/27) bloqueio não cria venda, não baixa estoque, não lança financeiro e não fatura o pedido', async () => {
    const pedido = await pedidos.criarPedidoDireto({
      cliente_id: clienteId, itens: [{ produto_id: produtoId, quantidade: 3, preco_unitario: 10 }], forma_pagamento: 'dinheiro'
    });
    const antes = await retrato(pedido.id);
    for (const [, chave, valor] of CONFIGS_INVALIDAS) {
      await setConfig(chave, valor);
      try {
        const manual = await post('/nfe/manual/emitir', {
          chave_operacao: `teste-043-efeito-${Date.now()}-${chave}`, cliente_id: clienteId,
          itens: [{ produto_id: produtoId, quantidade: 1, preco_unitario: 15 }], forma_pagamento: 'dinheiro', dados_nfe: dadosNfe()
        });
        const doPedido = await post(`/pedidos/${pedido.id}/emitir-nfe`, { dados_nfe: dadosNfe() });
        assert.equal(manual.status, 409);
        assert.equal(doPedido.status, 409);
      } finally {
        await setConfig(chave, CONFIG_BASE[chave] ?? '');
      }
    }
    const depois = await retrato(pedido.id);
    assert.equal(depois.vendas, antes.vendas, '24) nenhuma venda');
    assert.equal(depois.saldoFiscal, antes.saldoFiscal, '25) estoque fiscal intacto');
    assert.equal(depois.estoqueAtual, antes.estoqueAtual, '25) estoque intacto');
    assert.equal(depois.financeiro, antes.financeiro, '26) nenhum lançamento financeiro');
    assert.equal(depois.contasReceber, antes.contasReceber, '26) nenhuma conta a receber');
    assert.notEqual(depois.pedido.status, 'FATURADO', '27) pedido não faturado');
    assert.equal(depois.pedido.venda_id, null);
    assert.equal(depois.pedido.faturado_em, null);
    assert.equal(depois.nfe, antes.nfe, 'nenhuma NF-e registrada');
    assert.equal(depois.nfce, antes.nfce, 'NFC-e não acionada');
  });

  it('a prontidão do backend não chama a SEFAZ (nenhuma conexão, DNS ou HTTP(S))', async () => {
    const { resultado, tentativas } = await semRede(() => prontidaoBanco());
    assert.deepEqual(tentativas, []);
    assert.equal(resultado.chamadasSefaz, 0);
  });
});

describe('NF-E-04.3 — isolamento', () => {
  it('banco temporário; devolução mantém fluxo próprio; NFC-e lê apenas fiscal_ambiente', () => {
    assert.ok(DIR.includes('cds-nfe-testes'));
    assert.ok(!/MercantilFiscal/i.test(db.dbPath));
    assert.doesNotMatch(read('backend/services/fiscal/nfeDevolucaoCompra.js'), /nfeEmissorVenda|nfeWebServices|numeracaoFiscalService/);
    for (const arquivo of ['emissor.js', 'cancelarNfce.js']) {
      assert.doesNotMatch(read(`backend/services/fiscal/${arquivo}`), /fiscal_ambiente_nfe|getFiscalConfigNfe|resolverAmbienteNfe/, arquivo);
    }
  });
});
