'use strict';

/**
 * NF-E-04.2 — Módulo Fiscal / interface oficial CDS.
 *
 * Menu Fiscal (NFC-e Emitidas, NF-e › Nova/Emitidas/Monitor/Fila/Diagnóstico, Central Contábil),
 * estados LOADING/EMPTY/DATA/ERROR, RBAC e preservação dos fluxos da NF-E-04.1.
 * Frontend em JSDOM com API simulada: nenhuma chamada sai da máquina e nada é transmitido à SEFAZ.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it, after, before } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const DIR = path.join(process.env.TEMP || os.tmpdir(), 'cds-nfe-testes', 'modulo-fiscal-042');
fs.mkdirSync(DIR, { recursive: true });
process.env.DB_DIR = DIR;
process.env.FISCAL_DIR = path.join(DIR, 'fiscal');

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const CPF_CLIENTE = '529.982.247-25';

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
  'frontend/erp/js/fiscal.js',
  'frontend/erp/js/navegacao-config-comercial.js'
];

const ADMIN = { role: 'admin', perfil: 'ADMIN' };
const SO_FISCAL = { role: 'operador', perfil: 'USUARIO', permissoes: ['fiscal'] };

function htmlMenuFiscal() {
  const html = read('frontend/erp/index.html');
  const inicio = html.indexOf('<li class="nav-item" data-recurso="fiscal" id="nav-fiscal">');
  assert.ok(inicio > 0, 'item Fiscal do menu');
  const fimSubmenu = html.indexOf('</ul>', html.indexOf('id="submenu-fiscal"'));
  const fim = html.indexOf('</li>', html.indexOf('</div>', fimSubmenu)) + '</li>'.length;
  return html.slice(inicio, fim);
}

const janelas = [];
function criarJanela({ usuario = ADMIN, recursos = { fiscal: true, nfe: true }, menu = false } = {}) {
  const corpo = `${menu ? `<ul class="nav flex-column" id="sidebar-nav">${htmlMenuFiscal()}</ul>` : ''}`
    + '<div id="page-content"></div><div id="modal-container"></div>';
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${corpo}</body></html>`,
    { url: 'http://localhost/erp/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
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
  window.showNotification = (msg, tipo) => notificacoes.push({ msg, tipo });
  window.viewVenda = () => {};
  const paginas = [];
  window.loadPage = (p) => paginas.push(p);
  window.confirm = () => true;

  const chamadas = [];
  const rotas = {};
  window.fetch = (url, opts = {}) => {
    const u = new URL(url, 'http://localhost');
    const metodo = String(opts.method || 'GET').toUpperCase();
    const rota = `${metodo} ${u.pathname}`;
    chamadas.push({ rota, url: u.href, search: u.search, body: opts.body ? JSON.parse(opts.body) : undefined });
    const handler = rotas[rota];
    const responder = (r) => {
      if (r && r.erroRede) throw new TypeError('Failed to fetch');
      const status = r ? (r.status || 200) : 404;
      const texto = JSON.stringify(r ? r.body : { success: false, mensagem: 'rota não simulada' });
      return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => JSON.parse(texto), text: async () => texto };
    };
    if (handler && handler.pendurar) {
      return new Promise((resolve, reject) => {
        if (opts.signal) opts.signal.addEventListener('abort', () => reject(new Error('AbortError')));
        handler.pendurar.push(() => resolve(responder(handler.depois)));
      });
    }
    return Promise.resolve().then(() => responder(typeof handler === 'function' ? handler(u, opts) : handler));
  };
  const posts = () => chamadas.filter((c) => c.rota.startsWith('POST '));
  return { window, doc: window.document, rotas, chamadas, posts, notificacoes, paginas };
}

const esperar = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function aguardar(fn, tentativas = 50) {
  for (let i = 0; i < tentativas; i += 1) {
    const v = fn();
    if (v) return v;
    await esperar(5);
  }
  return null;
}
const estado = (doc) => {
  const el = doc.querySelector('#nfeSecaoConteudo [data-estado]');
  return el ? el.getAttribute('data-estado') : null;
};
const acoes = (tr) => [...tr.querySelectorAll('button[data-acao]')].map((b) => b.getAttribute('data-acao'));

const DIAG_PRONTA = { success: true, pronta: true, status: 'PRONTA_PARA_HOMOLOGACAO', itens: [], pendencias: [], chamadasSefaz: 0 };
const ITENS_DIAG = (cert) => [
  { id: 'dbDir', nome: 'Banco de dados', nivel: 'ok', ok: true, mensagem: 'Banco da CDS Cremolícia.', valor: DIR },
  { id: 'empresa', nome: 'Empresa', nivel: 'ok', ok: true, mensagem: 'IE 061234567.', valor: 'CREMOLICIA LTDA' },
  { id: 'cnpj', nome: 'CNPJ', nivel: 'ok', ok: true, mensagem: 'CNPJ da empresa ativa.', valor: '11.222.333/0001-81' },
  cert,
  { id: 'ambiente', nome: 'Ambiente', nivel: 'ok', ok: true, mensagem: 'Homologação (tpAmb = 2).', valor: 'Homologação' },
  { id: 'serie', nome: 'Série', nivel: 'ok', ok: true, mensagem: 'Série da NF-e modelo 55.', valor: 1 },
  { id: 'numeracao', nome: 'Numeração', nivel: 'ok', ok: true, mensagem: 'Próximo número previsto.', valor: 15 },
  { id: 'webservice', nome: 'Webservice', nivel: 'ok', ok: true, mensagem: 'Autorização NF-e homologação (nfe-homologacao.svrs.rs.gov.br).', valor: 'https://nfe-homologacao.svrs.rs.gov.br/ws' },
  { id: 'producao', nome: 'Produção', nivel: 'ok', ok: true, mensagem: 'Produção NF-e bloqueada no backend (PRODUCAO_NFE_LIBERADA = false).', valor: 'Bloqueada' }
];
const DIAG_CERT_DIVERGENTE = {
  success: true, pronta: false, status: 'NAO_CONFIGURADA', uf: { sigla: 'CE', codigo: '23' }, verificadoEm: '2026-10-04T13:00:00.000Z',
  itens: ITENS_DIAG({ id: 'certificado', nome: 'Certificado', nivel: 'bloqueado', ok: false, codigo: 'CERTIFICATE_CONFIGURATION_ERROR',
    mensagem: 'CNPJ do certificado (99.888.777/0001-66) diverge do CNPJ da empresa (11.222.333/0001-81).', valor: 'cert.pfx — válido até 01/01/2027' }),
  pendencias: ['Certificado'], chamadasSefaz: 0
};
const DIAG_OK = {
  ...DIAG_CERT_DIVERGENTE, pronta: true, status: 'PRONTA_PARA_HOMOLOGACAO', pendencias: [],
  itens: ITENS_DIAG({ id: 'certificado', nome: 'Certificado', nivel: 'ok', ok: true,
    mensagem: 'CNPJ do certificado = CNPJ da empresa (11.222.333/0001-81).', valor: 'cert.pfx — válido até 01/01/2027' })
};

const NOTA_AUTORIZADA = {
  id: 55, venda_id: 7, venda_codigo: 'V0007', pedido_id: 5, origem: 'PEDIDO', numero: 12, serie: 1, status: 'autorizada',
  cliente_nome: 'MARIA', cliente_documento: '52998224725', valor: 150.5, created_at: '2026-10-04 10:00:00',
  chave_acesso: '2'.repeat(44), tem_xml: 1, tem_danfe: 1
};
const NOTA_MANUAL = { id: 56, venda_id: 8, venda_codigo: 'V0008', pedido_id: null, origem: 'MANUAL', numero: 13, serie: 1, status: 'rejeitada', cliente_nome: 'JOSE', cliente_documento: '11222333000181', valor: 20, created_at: '2026-10-04 11:00:00' };
const NOTA_ANTIGA = { id: 50, venda_id: 3, venda_codigo: 'V0003', pedido_id: null, origem: null, numero: 9, serie: 1, status: 'autorizada', cliente_nome: 'ANA', created_at: '2026-09-01 09:00:00' };

const FILA = [
  { id: 55, numero: 12, status: 'autorizada', fila_estado: 'autorizado', pode_reenviar: false },
  { id: 57, numero: 14, serie: 1, status: 'cancelada', fila_estado: 'cancelado', pode_reenviar: false },
  { id: 61, numero: 15, serie: 1, status: 'erro_comunicacao', fila_estado: 'erro', tentativas: 2, pode_reenviar: true, erro_mensagem: 'Falha de comunicação', updated_at: '2026-10-04 12:00:00', ultima_tentativa_em: '2026-10-04 11:59:00', cliente_nome: 'MARIA', valor: 30 },
  { id: 62, numero: 16, serie: 1, status: 'aguardando_retorno', fila_estado: 'aguardando', tentativas: 1, pode_reenviar: true, chave_acesso: '4'.repeat(44), updated_at: '2026-10-04 12:05:00' },
  { id: 63, numero: 17, serie: 1, status: 'transmitindo', fila_estado: 'transmitindo', tentativas: 1, pode_reenviar: false, updated_at: '2026-10-04 12:01:00' },
  { id: 64, numero: 18, serie: 1, status: 'pendente_reenvio', fila_estado: 'reenvio', tentativas: 1, pode_reenviar: true, updated_at: '2026-10-04 11:00:00' },
  { id: 65, numero: 19, serie: 1, status: 'rejeitada', fila_estado: 'erro', tentativas: 1, pode_reenviar: false, erro_mensagem: 'Rejeição 225', updated_at: '2026-10-04 10:00:00' }
];

after(() => {
  for (const w of janelas.splice(0)) w.close();
});

// ===========================================================================
// Menu e navegação
// ===========================================================================

describe('NF-E-04.2 — menu Fiscal e navegação', () => {
  it('menu Fiscal: NFC-e Emitidas, NF-e (Nova, Emitidas, Monitor, Fila, Diagnóstico) e Central Contábil, nessa ordem', () => {
    const menu = htmlMenuFiscal();
    const paginas = [...menu.matchAll(/data-page="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(paginas, ['fiscal', 'fiscal-nfe-nova', 'fiscal-nfe', 'fiscal-nfe-monitor', 'fiscal-nfe-fila', 'fiscal-nfe-diagnostico', 'fiscal-contabil']);
    const rotulos = [...menu.matchAll(/<span class="sidebar-nav-label">([^<]+)<\/span>/g)].map((m) => m[1]);
    assert.deepEqual(rotulos, ['Fiscal', 'NFC-e Emitidas', 'Nova NF-e', 'NF-e Emitidas', 'Monitor NF-e', 'Fila NF-e', 'Diagnóstico NF-e', 'Central Contábil']);
    assert.match(menu, /sidebar-comercial-group__label">NF-e</);
    assert.match(menu, /data-bs-target="#submenu-fiscal"/, 'submenu no padrão dos demais grupos do menu');
    assert.equal((read('frontend/erp/index.html').match(/data-page="fiscal"/g) || []).length, 1, 'um único item NFC-e Emitidas');
  });

  it('cada página do menu tem rota no loadPage, permissão de página e alias /fiscal/... no catálogo', () => {
    const app = read('frontend/erp/js/app.js');
    const acesso = read('frontend/shared/js/access-control.js');
    for (const p of ['fiscal-nfe-nova', 'fiscal-nfe', 'fiscal-nfe-monitor', 'fiscal-nfe-fila', 'fiscal-nfe-diagnostico', 'fiscal-contabil']) {
      assert.ok(app.includes(`case '${p}':`), `app.js: ${p}`);
      assert.ok(acesso.includes(`'${p}': 'fiscal'`), `access-control: ${p}`);
    }
    assert.match(app, /case 'fiscal':\s*\n\s*return typeof loadFiscal/);
    const ctx = criarJanela();
    const resolver = (a) => ctx.window.resolverPaginaErpNav(a);
    assert.equal(resolver('/fiscal/nfe/nova'), 'fiscal-nfe-nova');
    assert.equal(resolver('/fiscal/nfe'), 'fiscal-nfe');
    assert.equal(resolver('/fiscal/nfe/monitor'), 'fiscal-nfe-monitor');
    assert.equal(resolver('/fiscal/nfe/fila'), 'fiscal-nfe-fila');
    assert.equal(resolver('/fiscal/nfe/diagnostico'), 'fiscal-nfe-diagnostico');
    assert.equal(resolver('fiscal'), 'fiscal');
    assert.ok(ctx.window.pesquisarNavErp('monitor nf-e').some((h) => h.page === 'fiscal-nfe-monitor'));
  });

  it('active state: destaca a página aberta e expande o submenu Fiscal', () => {
    const ctx = criarJanela({ menu: true });
    const { doc } = ctx;
    for (const p of ['fiscal', 'fiscal-nfe-monitor', 'fiscal-contabil']) {
      ctx.window.destacarNavFiscal(p);
      assert.ok(doc.getElementById('submenu-fiscal').classList.contains('show'));
      assert.equal(doc.querySelector('[data-bs-target="#submenu-fiscal"]').getAttribute('aria-expanded'), 'true');
      const ativos = [...doc.querySelectorAll('.nav-link[data-page].active')].map((a) => a.getAttribute('data-page'));
      assert.deepEqual(ativos, [p]);
    }
    assert.match(read('frontend/erp/js/app.js'), /destacarNavFiscal\(page\)/, 'chamado pelo loadPage (mecanismo atual)');
  });

  it('implantação: sem NF-e os itens NF-e somem e as páginas são recusadas; NFC-e e Central Contábil continuam', () => {
    const ctx = criarJanela({ menu: true, recursos: { fiscal: true, nfe: false } });
    const { window, doc } = ctx;
    window.aplicarRecursosImplantacao();
    const visivel = (p) => doc.querySelector(`.nav-link[data-page="${p}"]`).closest('li').style.display !== 'none';
    assert.ok(visivel('fiscal'));
    assert.ok(visivel('fiscal-contabil'));
    for (const p of ['fiscal-nfe-nova', 'fiscal-nfe', 'fiscal-nfe-monitor', 'fiscal-nfe-fila', 'fiscal-nfe-diagnostico']) {
      assert.equal(visivel(p), false, p);
      assert.equal(window.paginaPermitidaPorImplantacao(p), false, p);
    }
    assert.equal(doc.querySelector('.sidebar-comercial-group[data-recurso="nfe"]').style.display, 'none');
    assert.ok(window.paginaPermitidaPorImplantacao('fiscal'));
    assert.ok(window.paginaPermitidaPorImplantacao('fiscal-contabil'));
    assert.ok(!window.pesquisarNavErp('nf-e').some((h) => h.page.startsWith('fiscal-nfe')), 'pesquisa não oferece NF-e');

    const semFiscal = criarJanela({ menu: true, recursos: { fiscal: false, nfe: false } });
    semFiscal.window.aplicarRecursosImplantacao();
    assert.equal(semFiscal.doc.getElementById('nav-fiscal').style.display, 'none');
    assert.equal(semFiscal.window.paginaPermitidaPorImplantacao('fiscal-contabil'), false);
  });

  it('permissões: sem a permissão Fiscal o grupo inteiro some; com ela todas as páginas aparecem', () => {
    const sem = criarJanela({ menu: true, usuario: { role: 'operador', perfil: 'USUARIO', permissoes: ['vendas'] } });
    sem.window.aplicarRecursosImplantacao();
    assert.equal(sem.doc.getElementById('nav-fiscal').style.display, 'none');
    assert.equal(sem.window.usuarioTemPermissao('fiscal-nfe'), false);

    const com = criarJanela({ menu: true, usuario: SO_FISCAL });
    com.window.aplicarRecursosImplantacao();
    assert.notEqual(com.doc.getElementById('nav-fiscal').style.display, 'none');
    for (const p of ['fiscal', 'fiscal-nfe-nova', 'fiscal-nfe', 'fiscal-nfe-monitor', 'fiscal-nfe-fila', 'fiscal-nfe-diagnostico', 'fiscal-contabil']) {
      assert.ok(com.window.usuarioTemPermissao(p), p);
      assert.notEqual(com.doc.querySelector(`.nav-link[data-page="${p}"]`).closest('li').style.display, 'none', p);
    }
  });
});

// ===========================================================================
// NFC-e Emitidas e Central Contábil
// ===========================================================================

describe('NF-E-04.2 — NFC-e Emitidas e Central Contábil', () => {
  it('NFC-e Emitidas preserva lista e emissão manual NFC-e, sem NF-e e sem Contabilidade', () => {
    const { window, doc } = criarJanela();
    window.renderFiscal();
    assert.ok(doc.getElementById('fiscal-pagina-nfce'));
    assert.ok(doc.querySelector('[data-bs-target="#fiscal-notas-tab"]'));
    assert.ok(doc.querySelector('[data-bs-target="#fiscal-emissao-tab"]'));
    assert.ok(doc.getElementById('btnEmitirNFCe'));
    assert.equal(doc.getElementById('nfe-pagina'), null);
    assert.equal(doc.getElementById('btnExportarContabilidade'), null);
    const src = read('frontend/erp/js/fiscal.js');
    for (const fn of ['function carregarFiscalNotas', 'function cancelarNfce', 'function exportarContabilidadeZip', 'function preencherPeriodoContabilidadePadrao']) {
      assert.ok(src.includes(fn), fn);
    }
    assert.doesNotMatch(src, /carregarPainelNfe|nfe-painel/);
  });

  it('Central Contábil: página própria com o mesmo conteúdo da antiga aba (período e ZIP do contador)', () => {
    const ctx = criarJanela();
    ctx.window.loadCentralContabil();
    const { doc } = ctx;
    assert.ok(doc.getElementById('fiscal-pagina-contabil'));
    assert.match(doc.getElementById('fiscalContabDataInicio').value, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(doc.getElementById('fiscalContabDataFim').value, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(doc.getElementById('btnExportarContabilidade'));
    assert.doesNotMatch(doc.getElementById('page-content').textContent, /NF-e/);
    assert.equal(ctx.chamadas.length, 0, 'abrir a Central Contábil não chama a API');
  });
});

// ===========================================================================
// Estados das telas NF-e
// ===========================================================================

describe('NF-E-04.2 — estados LOADING / EMPTY / DATA / ERROR', () => {
  it('LOADING enquanto a API responde, depois DATA', async () => {
    const ctx = criarJanela();
    const pend = { pendurar: [], depois: { body: { success: true, notas: [NOTA_AUTORIZADA] } } };
    ctx.rotas['GET /api/nfe/notas'] = pend;
    const carga = ctx.window.loadNfePagina('fiscal-nfe');
    assert.equal(estado(ctx.doc), 'loading');
    assert.match(ctx.doc.getElementById('nfeSecaoConteudo').textContent, /Carregando NF-e/);
    await aguardar(() => pend.pendurar.length);
    pend.pendurar.shift()();
    await carga;
    assert.equal(estado(ctx.doc), 'data');
  });

  it('EMPTY em todas as telas com dados vazios', async () => {
    const ctx = criarJanela();
    ctx.rotas['GET /api/nfe/notas'] = { body: { success: true, notas: [] } };
    ctx.rotas['GET /api/nfe/monitor'] = { body: { success: true, totais: [], contadores: {}, atualizadoEm: '2026-10-04T13:00:00.000Z' } };
    ctx.rotas['GET /api/nfe/fila'] = { body: { success: true, itens: [FILA[0], FILA[1]] } };
    await ctx.window.loadNfePagina('fiscal-nfe');
    assert.equal(estado(ctx.doc), 'empty');
    assert.match(ctx.doc.getElementById('nfeSecaoConteudo').textContent, /Nenhuma NF-e encontrada\./);
    await ctx.window.loadNfePagina('fiscal-nfe-monitor');
    assert.equal(estado(ctx.doc), 'empty');
    assert.match(ctx.doc.getElementById('nfeSecaoConteudo').textContent, /Nenhuma NF-e registrada/);
    assert.ok(ctx.doc.getElementById('nfeMonitorAtualizado'));
    await ctx.window.loadNfePagina('fiscal-nfe-fila');
    assert.equal(estado(ctx.doc), 'empty');
    assert.match(ctx.doc.getElementById('nfeSecaoConteudo').textContent, /Nenhuma NF-e na fila\./);
  });

  it('ERROR com mensagem e [Tentar novamente]; o retry recarrega e mostra DATA', async () => {
    const ctx = criarJanela();
    ctx.rotas['GET /api/nfe/notas'] = { status: 500, body: { success: false, mensagem: 'Falha interna.' } };
    await ctx.window.loadNfePagina('fiscal-nfe');
    assert.equal(estado(ctx.doc), 'error');
    const conteudo = ctx.doc.getElementById('nfeSecaoConteudo');
    assert.match(conteudo.textContent, /Não foi possível carregar as NF-e\./);
    assert.match(conteudo.textContent, /Falha interna\./);
    const retry = conteudo.querySelector('[data-acao="tentar-novamente"]');
    assert.ok(retry);
    assert.match(retry.textContent, /Tentar novamente/);

    ctx.rotas['GET /api/nfe/notas'] = { body: { success: true, notas: [NOTA_AUTORIZADA] } };
    retry.click();
    assert.ok(await aguardar(() => estado(ctx.doc) === 'data'));
    assert.equal(ctx.chamadas.filter((c) => c.rota === 'GET /api/nfe/notas').length, 2);
  });

  it('ERROR também para servidor fora do ar, sem permissão e em monitor/fila/diagnóstico', async () => {
    const ctx = criarJanela();
    ctx.rotas['GET /api/nfe/monitor'] = { erroRede: true };
    ctx.rotas['GET /api/nfe/fila'] = { status: 403, body: { success: false, mensagem: 'Acesso negado' } };
    ctx.rotas['GET /api/nfe/prontidao'] = { status: 500, body: { success: false } };
    await ctx.window.loadNfePagina('fiscal-nfe-monitor');
    assert.equal(estado(ctx.doc), 'error');
    assert.match(ctx.doc.getElementById('nfeSecaoConteudo').textContent, /Não foi possível comunicar com o servidor/);
    await ctx.window.loadNfePagina('fiscal-nfe-fila');
    assert.equal(estado(ctx.doc), 'error');
    assert.match(ctx.doc.getElementById('nfeSecaoConteudo').textContent, /permissão/);
    await ctx.window.loadNfePagina('fiscal-nfe-diagnostico');
    assert.equal(estado(ctx.doc), 'error');
    assert.ok(ctx.doc.querySelector('[data-acao="tentar-novamente"]'));
  });

  it('sem carregamento infinito: leituras das telas têm tempo limite', async () => {
    const ctx = criarJanela();
    ctx.rotas['GET /api/nfe/monitor'] = { pendurar: [], depois: { body: {} } };
    const r = await ctx.window.nfeRequest('/nfe/monitor', { timeoutMs: 30 });
    assert.equal(r.ok, false);
    assert.equal(r.status, 0);
    assert.match(r.data.mensagem, /demorou para responder/);
    const src = read('frontend/erp/js/nfe.js');
    assert.equal((src.match(/timeoutMs: NFE_TIMEOUT_TELA_MS/g) || []).length, 5, 'nova, emitidas, monitor, fila e diagnóstico');
  });

  it('troca rápida de tela: resposta atrasada da tela anterior não sobrescreve a atual', async () => {
    const ctx = criarJanela();
    const pend = { pendurar: [], depois: { body: { success: true, notas: [NOTA_AUTORIZADA] } } };
    ctx.rotas['GET /api/nfe/notas'] = pend;
    ctx.rotas['GET /api/nfe/monitor'] = { body: { success: true, totais: [{ status: 'autorizada', qtd: 1 }] } };
    ctx.window.loadNfePagina('fiscal-nfe');
    await aguardar(() => pend.pendurar.length);
    await ctx.window.loadNfePagina('fiscal-nfe-monitor');
    pend.pendurar.shift()();
    await esperar(10);
    assert.equal(ctx.doc.getElementById('nfe-pagina').dataset.secao, 'monitor');
    assert.ok(ctx.doc.getElementById('nfeMonitor'));
    assert.equal(ctx.doc.getElementById('nfeTabelaNotas'), null);
  });

  it('recurso NF-e desligado: tela informa e não chama a API', async () => {
    const ctx = criarJanela({ recursos: { fiscal: true, nfe: false } });
    await ctx.window.loadNfePagina('fiscal-nfe');
    assert.equal(estado(ctx.doc), 'empty');
    assert.match(ctx.doc.getElementById('nfeSecaoConteudo').textContent, /desabilitado/);
    assert.equal(ctx.chamadas.length, 0);
  });
});

// ===========================================================================
// NF-e Emitidas
// ===========================================================================

describe('NF-E-04.2 — NF-e Emitidas', () => {
  it('colunas oficiais e dados de nfe_notas (origem vinda do backend, nunca inferida)', async () => {
    const ctx = criarJanela();
    ctx.rotas['GET /api/nfe/notas'] = { body: { success: true, notas: [NOTA_AUTORIZADA, NOTA_MANUAL, NOTA_ANTIGA] } };
    await ctx.window.loadNfePagina('fiscal-nfe');
    const { doc } = ctx;
    const cab = [...doc.querySelectorAll('#nfeTabelaNotas thead th')].map((th) => th.textContent.trim());
    assert.deepEqual(cab, ['Número', 'Série', 'Data', 'Cliente', 'CPF/CNPJ', 'Valor', 'Status', 'Origem', 'Pedido', 'Venda', 'Chave', 'Ações']);
    const linha = (id) => doc.querySelector(`#nfeTabelaNotas tr[data-nota-id="${id}"]`);
    const celulas = (id) => [...linha(id).querySelectorAll('td')].map((td) => td.textContent.trim());
    const a = celulas(55);
    assert.equal(a[0], '000012');
    assert.equal(a[2], '04/10/2026 10:00');
    assert.equal(a[3], 'MARIA');
    assert.equal(a[4], '529.982.247-25');
    assert.match(a[5], /150,50/);
    assert.equal(a[6], 'Autorizada');
    assert.equal(a[7], 'Pedido');
    assert.equal(a[8], '#5');
    assert.equal(a[9], '#V0007');
    assert.match(a[10], /^2222 2222/);
    const m = celulas(56);
    assert.equal(m[4], '11.222.333/0001-81');
    assert.equal(m[7], 'Manual');
    assert.equal(m[8], '—');
    const antiga = celulas(50);
    assert.equal(antiga[7], '—', 'nota antiga sem origem não é reclassificada');
    assert.equal(linha(50).querySelector('[data-origem]').getAttribute('data-origem'), '');
    const call = ctx.chamadas.find((c) => c.rota === 'GET /api/nfe/notas');
    assert.match(call.search, /tipo=VENDA/);
  });

  it('ações: Visualizar, DANFE, XML, Consultar, Histórico, Cancelar (admin)', async () => {
    const ctx = criarJanela();
    ctx.rotas['GET /api/nfe/notas'] = { body: { success: true, notas: [NOTA_AUTORIZADA] } };
    await ctx.window.loadNfePagina('fiscal-nfe');
    assert.deepEqual(acoes(ctx.doc.querySelector('tr[data-nota-id="55"]')), ['Visualizar', 'DANFE', 'XML', 'Consultar', 'Histórico', 'Cancelar']);
    assert.equal(ctx.posts().length, 0);
  });

  it('RBAC: sem NF-E-EMITIR/NF-E-CANCELAR não aparecem Consultar nem Cancelar', async () => {
    const ctx = criarJanela({ usuario: SO_FISCAL });
    ctx.rotas['GET /api/nfe/notas'] = { body: { success: true, notas: [NOTA_AUTORIZADA] } };
    await ctx.window.loadNfePagina('fiscal-nfe');
    assert.deepEqual(acoes(ctx.doc.querySelector('tr[data-nota-id="55"]')), ['Visualizar', 'DANFE', 'XML', 'Histórico']);

    const cancelar = criarJanela({ usuario: { ...SO_FISCAL, permissoes: ['fiscal', 'NF-E-CANCELAR'] } });
    cancelar.rotas['GET /api/nfe/notas'] = { body: { success: true, notas: [NOTA_AUTORIZADA] } };
    await cancelar.window.loadNfePagina('fiscal-nfe');
    assert.deepEqual(acoes(cancelar.doc.querySelector('tr[data-nota-id="55"]')), ['Visualizar', 'DANFE', 'XML', 'Histórico', 'Cancelar']);
  });

  it('Histórico abre o detalhe da nota com a linha do tempo (somente leitura)', async () => {
    const ctx = criarJanela();
    ctx.rotas['GET /api/nfe/notas/55'] = { body: { success: true, nota: { ...NOTA_AUTORIZADA, ambiente: 2, protocolo: '223260000000012' } } };
    ctx.rotas['GET /api/nfe/notas/55/historico'] = { body: { success: true, eventos: [
      { acao: 'autorizacao', criado_em: '2026-10-04 10:00:00', usuario_nome: 'admin', detalhes: JSON.stringify({ status: 'autorizada' }) }
    ] } };
    ctx.rotas['GET /api/nfe/logs'] = { body: { success: true, logs: [] } };
    await ctx.window.nfeAbrirHistorico(55, null);
    assert.match(ctx.doc.getElementById('nfeListaHistorico').textContent, /Autorização/);
    assert.equal(ctx.posts().length, 0);
  });

  it('filtros vão para o endpoint existente', async () => {
    const ctx = criarJanela();
    ctx.rotas['GET /api/nfe/notas'] = { body: { success: true, notas: [] } };
    await ctx.window.loadNfePagina('fiscal-nfe');
    ctx.doc.getElementById('nfeFiltroStatus').value = 'rejeitada';
    ctx.doc.getElementById('nfeFiltroBusca').value = 'Maria';
    ctx.doc.getElementById('nfeBtnFiltrar').click();
    await aguardar(() => ctx.chamadas.filter((c) => c.rota === 'GET /api/nfe/notas').length === 2);
    const ultima = ctx.chamadas.filter((c) => c.rota === 'GET /api/nfe/notas').pop();
    const p = new URLSearchParams(ultima.search);
    assert.equal(p.get('status'), 'rejeitada');
    assert.equal(p.get('cliente'), 'Maria');
  });
});

// ===========================================================================
// Monitor, Fila e Diagnóstico
// ===========================================================================

describe('NF-E-04.2 — Monitor NF-e', () => {
  it('nove estados operacionais a partir dos totais de /nfe/monitor, com Outros e hora da atualização', async () => {
    const ctx = criarJanela();
    ctx.rotas['GET /api/nfe/monitor'] = { body: { success: true, atualizadoEm: '2026-10-04T13:00:00.000Z', contadores: {}, totais: [
      { status: 'transmitindo', qtd: 1 }, { status: 'emitindo', qtd: 1 }, { status: 'aguardando_retorno', qtd: 2 }, { status: 'autorizada', qtd: 10 },
      { status: 'rejeitada', qtd: 3 }, { status: 'denegada', qtd: 1 }, { status: 'erro_transmissao', qtd: 1 }, { status: 'timeout', qtd: 1 },
      { status: 'nao_localizada_sefaz', qtd: 1 }, { status: 'cancelada', qtd: 4 }, { status: 'cancelamento_rejeitado', qtd: 1 }, { status: 'pendente_reenvio', qtd: 2 }
    ] } };
    await ctx.window.loadNfePagina('fiscal-nfe-monitor');
    const { doc } = ctx;
    assert.equal(estado(doc), 'data');
    const cards = [...doc.querySelectorAll('[data-monitor]')].map((c) => [c.getAttribute('data-monitor'), c.textContent.replace(/\s+/g, ' ').trim()]);
    assert.deepEqual(cards, [
      ['transmitindo', 'Transmitindo 2'],
      ['aguardando_retorno', 'Aguardando retorno 2'],
      ['autorizada', 'Autorizada 10'],
      ['rejeitada', 'Rejeitada 3'],
      ['denegada', 'Denegada 1'],
      ['erro_transmissao', 'Erro de transmissão 2'],
      ['nao_localizada_sefaz', 'Não localizada 1'],
      ['cancelada', 'Cancelada 4'],
      ['cancelamento_rejeitado', 'Cancelamento rejeitado 1'],
      ['outros', 'Outros 2']
    ]);
    assert.match(doc.getElementById('nfeMonitorAtualizado').textContent, /Atualizado em \d{2}\/\d{2}\/\d{4}/);
    assert.equal(ctx.posts().length, 0);
  });
});

describe('NF-E-04.2 — Fila NF-e', () => {
  it('contadores (pendentes, em processamento, aguardando, erros, total), última atualização e só notas que precisam de ação', async () => {
    const ctx = criarJanela();
    ctx.rotas['GET /api/nfe/fila'] = { body: { success: true, itens: FILA } };
    await ctx.window.loadNfePagina('fiscal-nfe-fila');
    const { doc } = ctx;
    const contador = (k) => doc.querySelector(`[data-fila-contador="${k}"]`).textContent.replace(/\s+/g, ' ').trim();
    assert.equal(contador('pendentes'), 'Pendentes 1');
    assert.equal(contador('processamento'), 'Em processamento 1');
    assert.equal(contador('aguardando'), 'Aguardando retorno 1');
    assert.equal(contador('erros'), 'Erros 2');
    assert.equal(contador('total'), 'Na fila 5');
    assert.match(doc.getElementById('nfeFilaAtualizacao').textContent, /04\/10\/2026 12:05/);
    const ids = [...doc.querySelectorAll('#nfeTabelaFila tr[data-fila-nota-id]')].map((tr) => tr.getAttribute('data-fila-nota-id'));
    assert.deepEqual(ids.sort(), ['61', '62', '63', '64', '65']);
    assert.deepEqual(ctx.chamadas.map((c) => c.rota), ['GET /api/nfe/fila'], 'abrir a fila só lê; nada é enviado');
  });

  it('[Reprocessar] só com pode_reenviar e NF-E-EMITIR; exige confirmação e usa o endpoint existente', async () => {
    const ctx = criarJanela();
    ctx.rotas['GET /api/nfe/fila'] = { body: { success: true, itens: FILA } };
    ctx.rotas['POST /api/nfe/notas/61/reenviar'] = { body: { success: true, mensagem: 'Reenvio simulado.' } };
    await ctx.window.loadNfePagina('fiscal-nfe-fila');
    const { doc } = ctx;
    const tem = (id) => acoes(doc.querySelector(`tr[data-fila-nota-id="${id}"]`)).includes('Reprocessar');
    assert.ok(tem(61));
    assert.ok(tem(64));
    assert.equal(tem(63), false, 'transmitindo: sem reprocessar');
    assert.equal(tem(65), false, 'rejeitada: sem reprocessar');

    ctx.window.confirm = () => false;
    await ctx.window.nfeReprocessarNota(61);
    assert.equal(ctx.posts().length, 0, 'cancelar a confirmação não envia nada');

    ctx.window.confirm = () => true;
    await ctx.window.nfeReprocessarNota(61);
    assert.deepEqual(ctx.posts().map((c) => c.rota), ['POST /api/nfe/notas/61/reenviar']);
    assert.ok(await aguardar(() => ctx.chamadas.filter((c) => c.rota === 'GET /api/nfe/fila').length === 2), 'fila recarregada');

    const semPermissao = criarJanela({ usuario: SO_FISCAL });
    semPermissao.rotas['GET /api/nfe/fila'] = { body: { success: true, itens: FILA } };
    await semPermissao.window.loadNfePagina('fiscal-nfe-fila');
    assert.equal(acoes(semPermissao.doc.querySelector('tr[data-fila-nota-id="61"]')).includes('Reprocessar'), false);
    await semPermissao.window.nfeReprocessarNota(61);
    assert.equal(semPermissao.posts().length, 0);
  });

  it('não existe novo worker/agendador: a tela não usa setInterval nem envia nada sozinha', () => {
    const src = read('frontend/erp/js/nfe.js');
    assert.doesNotMatch(src, /setInterval\(/);
  });
});

describe('NF-E-04.2 — Diagnóstico NF-e', () => {
  it('grupos Certificado, Empresa, Ambiente, Numeração, Webservice e Permissões a partir de /nfe/prontidao', async () => {
    const ctx = criarJanela();
    ctx.rotas['GET /api/nfe/prontidao'] = { body: DIAG_OK };
    await ctx.window.loadNfePagina('fiscal-nfe-diagnostico');
    const { doc } = ctx;
    const grupos = [...doc.querySelectorAll('[data-diag-grupo]')].map((g) => g.getAttribute('data-diag-grupo'));
    for (const g of ['certificado', 'empresa', 'ambiente', 'numeracao', 'webservice', 'permissoes']) assert.ok(grupos.includes(g), g);
    const linhas = (g) => [...doc.querySelectorAll(`[data-diag-grupo="${g}"] [data-diag-linha]`)]
      .map((l) => `${l.getAttribute('data-diag-linha')}:${l.getAttribute('data-nivel')}`);
    assert.deepEqual(linhas('certificado'), ['Configurado:ok', 'Validade:ok', 'CNPJ compatível:ok']);
    assert.deepEqual(linhas('empresa'), ['Razão social:ok', 'CNPJ:ok', 'Inscrição estadual:ok', 'UF:ok']);
    assert.deepEqual(linhas('ambiente'), ['Ambiente:ok', 'Modelo:ok', 'Série:ok', 'Produção:ok']);
    assert.deepEqual(linhas('numeracao'), ['Série:ok', 'Numeração:ok']);
    assert.deepEqual(linhas('permissoes'), ['NF-E-EMITIR:ok', 'NF-E-CANCELAR:ok']);
    assert.match(doc.querySelector('[data-diag-grupo="certificado"]').textContent, /Válido até 01\/01\/2027/);
    assert.match(doc.getElementById('nfeProntidaoStatus').textContent, /PRONTA PARA HOMOLOGAÇÃO/);
    assert.equal(doc.getElementById('nfeDiagProblemas'), null);
    assert.deepEqual(ctx.chamadas.map((c) => c.rota), ['GET /api/nfe/prontidao'], 'só o diagnóstico local; /nfe/diagnostico (rede) não é usado');
  });

  it('problema operacional: "✕ Certificado incompatível com o CNPJ da empresa."', async () => {
    const ctx = criarJanela({ usuario: SO_FISCAL });
    ctx.rotas['GET /api/nfe/prontidao'] = { body: DIAG_CERT_DIVERGENTE };
    await ctx.window.loadNfePagina('fiscal-nfe-diagnostico');
    const { doc } = ctx;
    assert.equal(doc.getElementById('nfeProntidaoCard').getAttribute('data-status'), 'NAO_CONFIGURADA');
    assert.match(doc.getElementById('nfeDiagProblemas').textContent, /✕ Certificado incompatível com o CNPJ da empresa\./);
    assert.match(doc.getElementById('nfeProntidaoStatus').textContent, /NF-E NÃO CONFIGURADA/);
    const perm = [...doc.querySelectorAll('[data-diag-grupo="permissoes"] [data-diag-linha]')].map((l) => l.getAttribute('data-nivel'));
    assert.deepEqual(perm, ['alerta', 'alerta'], 'usuário sem NF-E-EMITIR/NF-E-CANCELAR');
  });

  it('prontidão do backend é local, informa a UF e nunca devolve a senha do certificado', async () => {
    const cert = path.join(DIR, 'cert-042.pfx');
    fs.writeFileSync(cert, 'pfx-simulado');
    const { diagnosticarProntidaoNfe } = require('../../backend/services/fiscal/nfeProntidaoService');
    const diag = await diagnosticarProntidaoNfe({
      dbDir: DIR,
      lerConfiguracoes: async () => ({
        nome_empresa: 'CREMOLICIA LTDA', cnpj: '11222333000181', fiscal_ie: '061234567', fiscal_codigo_uf: '23', fiscal_uf_sigla: 'ce',
        fiscal_ambiente: '2', fiscal_serie_nfe: '1', fiscal_numero_atual_nfe: '10', fiscal_certificado_path: cert,
        fiscal_certificado_senha: 'SEGREDO-042', fiscal_ws_nfe_autorizacao_homologacao: 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx'
      }),
      lerProximoNumero: async () => null,
      inspecionarCertificado: () => ({ cnpj: '99888777000166', valido: true, notAfter: '2027-01-01T00:00:00Z' })
    });
    assert.deepEqual(diag.uf, { sigla: 'CE', codigo: '23' });
    assert.equal(diag.chamadasSefaz, 0);
    assert.doesNotMatch(JSON.stringify(diag), /SEGREDO-042/);
    assert.ok(!JSON.stringify(diag).includes(DIR.replace(/\\/g, '\\\\') + '\\\\cert-042.pfx'), 'sem caminho completo do certificado');
    const c = diag.itens.find((i) => i.id === 'certificado');
    assert.equal(c.nivel, 'bloqueado');
    assert.match(c.mensagem, /diverge/);
    assert.doesNotMatch(read('frontend/erp/js/nfe.js'), /certificado_senha|certificadoSenha/);
  });
});

// ===========================================================================
// Nova NF-e / Pedido → Emitir NF-e: fronteira da NF-E-04.1 preservada
// ===========================================================================

describe('NF-E-04.2 — Nova NF-e e Pedido → Emitir NF-e (NF-E-04.1 preservada)', () => {
  const CLIENTE = { id: 9, nome: 'MARIA', cpf_cnpj: CPF_CLIENTE, rua: 'RUA A', numero: '1', bairro: 'CENTRO', cidade: 'CRATO', uf: 'CE', cep: '63100000' };
  const prepararManual = (ctx) => {
    ctx.rotas['GET /api/nfe/prontidao'] = { body: DIAG_PRONTA };
    ctx.rotas['GET /api/clientes'] = { body: [CLIENTE] };
    ctx.rotas['GET /api/produtos'] = { body: [{ id: 3, nome: 'SORVETE', preco_venda: 12, saldo_fiscal: 40, ativo: 1 }] };
  };
  const preencherItens = (ctx) => {
    const { doc } = ctx;
    doc.getElementById('nfeManualCliente').value = '9';
    if (!doc.querySelector('#nfeManualItens tr[data-opc-item]')) ctx.window.opcAdicionarItem('nfeManual');
    const linha = doc.querySelector('#nfeManualItens tr[data-opc-item]');
    const sel = linha.querySelector('[data-campo="produto"]');
    sel.value = '3';
    ctx.window.opcAoTrocarProduto(sel, 'nfeManual');
    linha.querySelector('[data-campo="quantidade"]').value = '2';
  };

  it('abrir Nova NF-e consulta a prontidão; pronta: [Emitir NF-e] liberado e abre o fluxo manual existente', async () => {
    const ctx = criarJanela();
    prepararManual(ctx);
    await ctx.window.loadNfePagina('fiscal-nfe-nova');
    const { doc } = ctx;
    assert.deepEqual(ctx.chamadas.map((c) => c.rota), ['GET /api/nfe/prontidao', 'GET /api/clientes', 'GET /api/produtos']);
    assert.equal(doc.getElementById('nfeNovaPainel').dataset.situacao, 'pronta');
    assert.match(doc.getElementById('nfeNovaStatus').textContent, /✓ NF-e pronta para emissão\./);
    assert.match(doc.getElementById('nfeNovaAviso').textContent, /não registra venda, não baixa estoque, não lança financeiro/);
    const documento = doc.getElementById('modalNfeManual');
    assert.ok(documento, 'o documento abre na página');
    assert.equal(documento.classList.contains('modal'), false, 'não é o modal Bootstrap');
    assert.equal(doc.getElementById('nfeManualEtapaFiscal').hidden, true, 'conferência fiscal ainda não abriu');
    assert.equal(doc.getElementById('nfeBtnEmitirNova'), null, 'a página pronta não repete o botão Emitir NF-e');
    assert.ok(doc.getElementById('nfeBtnManualContinuar'), 'continuar para emissão permanece');
    assert.ok(ctx.chamadas.every((c) => c.rota.startsWith('GET ')), 'nenhum POST ao abrir');
  });

  it('cancelar o editor e cancelar o formulário não produzem efeito; só Confirmar emissão chama POST /api/nfe/manual/emitir', async () => {
    const ctx = criarJanela();
    prepararManual(ctx);
    ctx.rotas['POST /api/nfe/manual/emitir'] = { body: { success: false, status: 'configuracao_pendente', message: 'Simulado.', faturamento_desfeito: true, venda_id: 90 } };
    await ctx.window.loadNfePagina('fiscal-nfe-nova');
    assert.ok(ctx.doc.getElementById('modalNfeManual'));
    ctx.window.nfeManualCancelarDocumento();
    assert.equal(ctx.posts().length, 0, 'cancelar o editor');

    preencherItens(ctx);
    ctx.window.confirmarNfeManual();
    assert.equal(ctx.doc.getElementById('modalEmitirNfe').dataset.contexto, 'manual');
    ctx.window.nfeManualCancelarEmissao();
    assert.equal(ctx.doc.getElementById('modalEmitirNfe'), null);
    assert.equal(ctx.posts().length, 0, 'cancelar o formulário NF-e');

    await ctx.window.loadNfePagina('fiscal-nfe-nova');
    assert.ok(await aguardar(() => ctx.doc.getElementById('nfeManualCliente')));
    preencherItens(ctx);
    ctx.window.confirmarNfeManual();
    await ctx.window.confirmarEmissaoNfe();
    assert.deepEqual(ctx.posts().map((c) => c.rota), ['POST /api/nfe/manual/emitir']);
    assert.match(ctx.posts()[0].body.chave_operacao, /^nfe-manual-/);
  });

  it('Nova NF-e sem permissão: aviso, nenhuma requisição e nenhum formulário', async () => {
    const ctx = criarJanela({ usuario: SO_FISCAL });
    await ctx.window.loadNfePagina('fiscal-nfe-nova');
    assert.equal(estado(ctx.doc), 'empty');
    assert.match(ctx.doc.getElementById('nfeSecaoConteudo').textContent, /sem permissão para emitir NF-e/);
    assert.equal(ctx.doc.getElementById('modalNfeManual'), null);
    assert.equal(ctx.doc.getElementById('nfeBtnEmitirNova'), null);
    assert.equal(ctx.chamadas.length, 0);
  });

  it('Nova NF-e com NF-e não pronta: aviso, [Emitir NF-e] bloqueado, atalho ao Diagnóstico e [Tentar novamente] só reconsulta', async () => {
    const ctx = criarJanela();
    ctx.rotas['GET /api/nfe/prontidao'] = { body: DIAG_CERT_DIVERGENTE };
    await ctx.window.loadNfePagina('fiscal-nfe-nova');
    assert.equal(estado(ctx.doc), 'error');
    assert.match(ctx.doc.getElementById('nfeNovaStatus').textContent, /⚠ NF-e não está pronta para emissão\./);
    assert.match(ctx.doc.getElementById('nfeNovaPendencias').textContent, /Certificado/);
    assert.equal(ctx.doc.getElementById('nfeBtnEmitirNova').disabled, true);
    assert.equal(ctx.doc.getElementById('modalNfeNaoPronta'), null, 'a página mostra o estado; sem modal');
    ctx.doc.querySelector('[data-ir-pagina="fiscal-nfe-diagnostico"]').click();
    assert.deepEqual(ctx.paginas, ['fiscal-nfe-diagnostico']);
    prepararManual(ctx);
    ctx.doc.querySelector('[data-acao="tentar-novamente"]').click();
    assert.ok(await aguardar(() => ctx.doc.getElementById('nfeNovaPainel')?.dataset.situacao === 'pronta'));
    assert.ok(await aguardar(() => ctx.doc.getElementById('nfeManualEtapaFiscal')));
    assert.equal(ctx.doc.getElementById('nfeManualEtapaFiscal').hidden, true, 'tentar novamente não abre a conferência');
    assert.equal(ctx.posts().length, 0);
    assert.ok(ctx.chamadas.every((c) => c.rota.startsWith('GET ')));
  });

  it('Pedido → Emitir NF-e abre a Nova NF-e; cancelar não fatura; confirmar usa POST /api/nfe/pedidos/emitir', async () => {
    const ctx = criarJanela();
    const PEDIDO = { id: 5, codigo: 'PED-000005', status: 'ABERTO', cliente_id: 9, cliente_nome: 'MARIA', cliente_documento: CPF_CLIENTE,
      cliente_rua: 'RUA A', cliente_numero: '1', cliente_bairro: 'CENTRO', cliente_cidade: 'CRATO', cliente_uf: 'CE', cliente_cep: '63100-000',
      total: 20, itens: [{ produto_id: 1, produto_nome: 'SORVETE', quantidade: 2, preco_unitario: 10, subtotal: 20 }],
      nfe: { pode_emitir: true, acao: 'emitir_pedido' } };
    ctx.rotas['GET /api/nfe/prontidao'] = { body: DIAG_PRONTA };
    ctx.rotas['GET /api/clientes'] = { body: [{ id: 9, nome: 'MARIA', cpf_cnpj: CPF_CLIENTE, rua: 'RUA A', numero: '1', bairro: 'CENTRO', cidade: 'CRATO', uf: 'CE', cep: '63100000' }] };
    ctx.rotas['GET /api/produtos'] = { body: [{ id: 1, nome: 'SORVETE', preco_venda: 60, ativo: 1 }] };
    ctx.rotas['GET /api/pedidos/5'] = { body: PEDIDO };
    ctx.rotas['POST /api/nfe/pedidos/emitir'] = { body: { success: false, status: 'configuracao_pendente', message: 'Simulado.', faturamento_desfeito: true, venda_id: 91, pedido_id: 5 } };
    await ctx.window.pedEmitirNfe(5);
    assert.equal(ctx.doc.getElementById('modalEmitirNfe').dataset.contexto, 'pedidos');
    assert.match(ctx.doc.getElementById('nfeOrigemComercial').textContent, /PED-000005/);
    ctx.window.nfeManualCancelarDocumento();
    assert.equal(ctx.posts().length, 0, 'cancelar o formulário não fatura o pedido');
    await ctx.window.pedEmitirNfe(5);
    ctx.window.confirmarNfeManual();
    await ctx.window.confirmarEmissaoNfe();
    assert.deepEqual(ctx.posts().map((c) => c.rota), ['POST /api/nfe/pedidos/emitir']);
  });

  it('NF-E-04.3-B: documento na página, cálculo local e um único POST na confirmação', async () => {
    const ctx = criarJanela();
    prepararManual(ctx);
    ctx.rotas['GET /api/nfe/prontidao'] = {
      body: {
        ...DIAG_PRONTA,
        ambiente: '2',
        itens: [
          { id: 'serie', nome: 'Série', ok: true, valor: 1 },
          { id: 'numeracao', nome: 'Numeração', ok: true, valor: 1 }
        ]
      }
    };
    await ctx.window.loadNfePagina('fiscal-nfe-nova');
    const { doc } = ctx;
    assert.equal(doc.getElementById('modalNfeManual').classList.contains('modal'), false);
    assert.equal(doc.getElementById('nfeManualAmbiente').textContent, 'Homologação');
    assert.equal(doc.getElementById('nfeManualSerie').textContent, '1');
    assert.equal(doc.getElementById('nfeManualNumero').textContent, '000001');
    assert.equal(doc.getElementById('nfeManualEtapaFiscal').hidden, true);

    doc.getElementById('nfeManualCliente').value = '9';
    ctx.window.nfeManualAoSelecionarCliente();
    assert.equal(doc.getElementById('nfeManualFicha').hidden, false);
    assert.match(doc.getElementById('nfeManualFichaNome').textContent, /MARIA/);
    assert.match(doc.getElementById('nfeManualFichaDoc').textContent, /529/);

    const antes = doc.querySelectorAll('#nfeManualItens tr[data-opc-item]').length;
    ctx.window.nfeManualAdicionarProduto();
    assert.equal(doc.querySelectorAll('#nfeManualItens tr[data-opc-item]').length, antes);
    assert.equal(doc.activeElement, doc.querySelector('[data-opc-busca-barra]'));
    ctx.window.opcAdicionarItem('nfeManual');
    assert.equal(doc.querySelectorAll('#nfeManualItens tr[data-opc-item]').length, antes + 1);
    assert.ok(doc.querySelector('#nfeManualItens tr[data-opc-item] [data-nfe-codigo]'));
    ctx.window.opcAdicionarItem('nfeManual');
    const extra = doc.querySelectorAll('#nfeManualItens tr[data-opc-item]');
    ctx.window.opcRemoverItem(extra[extra.length - 1].querySelector('button'), 'nfeManual');

    const linha = doc.querySelector('#nfeManualItens tr[data-opc-item]');
    const sel = linha.querySelector('[data-campo="produto"]');
    sel.value = '3';
    ctx.window.opcAoTrocarProduto(sel, 'nfeManual');
    ctx.window.nfeManualAtualizarLinhaFiscal(linha);
    linha.querySelector('[data-campo="quantidade"]').value = '2';
    linha.querySelector('[data-campo="quantidade"]').dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
    ctx.window.opcRecalcular('nfeManual');
    ctx.window.nfeManualAtualizarResumo();
    assert.match(linha.querySelector('[data-campo="subtotal"]').textContent, /24,00/);

    linha.querySelector('[data-campo="preco"]').value = '10';
    ctx.window.opcRecalcular('nfeManual');
    ctx.window.nfeManualAtualizarResumo();
    assert.match(linha.querySelector('[data-campo="subtotal"]').textContent, /20,00/);

    doc.getElementById('nfeManualDesconto').value = '5';
    ctx.window.opcRecalcular('nfeManual');
    ctx.window.nfeManualAtualizarResumo();
    assert.match(doc.getElementById('nfeManualTotal').textContent, /15,00/);
    assert.match(doc.getElementById('nfeManualSubtotalExibicao').textContent, /20,00/);

    assert.equal(doc.getElementById('nfeManualParcelasGrupo').classList.contains('d-none'), true);
    doc.getElementById('nfeManualForma').value = 'prazo';
    ctx.window.opcRecalcular('nfeManual');
    assert.equal(doc.getElementById('nfeManualParcelasGrupo').classList.contains('d-none'), false);
    doc.getElementById('nfeManualForma').value = 'dinheiro';
    ctx.window.opcRecalcular('nfeManual');
    assert.equal(doc.getElementById('nfeManualParcelasGrupo').classList.contains('d-none'), true);

    const postsAntes = ctx.posts().length;
    ctx.window.confirmarNfeManual();
    assert.equal(ctx.posts().length, postsAntes, 'continuar não faz POST');
    assert.equal(doc.getElementById('nfeManualEtapaFiscal').hidden, false);
    assert.equal(doc.getElementById('nfeDestNome').value, 'MARIA');
    assert.equal(doc.getElementById('nfeNatureza').value, 'VENDA DE MERCADORIA');
    assert.equal(doc.getElementById('nfeCfop').value, '5102');
    assert.equal(doc.getElementById('modalEmitirNfe').dataset.contexto, 'manual');

    ctx.window.nfeManualVoltarConferencia();
    assert.equal(doc.getElementById('nfeManualEtapaFiscal').hidden, true);
    assert.equal(ctx.posts().length, postsAntes, 'voltar não faz POST');
    ctx.window.confirmarNfeManual();

    ctx.rotas['POST /api/nfe/manual/emitir'] = { body: { success: false, status: 'configuracao_pendente', message: 'Simulado.', faturamento_desfeito: true } };
    let liberar;
    const bloqueio = new Promise((resolve) => { liberar = resolve; });
    const fetchOriginal = ctx.window.fetch;
    ctx.window.fetch = (url, opts = {}) => {
      const pendente = String(opts.method || 'GET').toUpperCase() === 'POST' ? bloqueio : Promise.resolve();
      return pendente.then(() => fetchOriginal(url, opts));
    };
    const primeira = ctx.window.confirmarEmissaoNfe();
    const segunda = ctx.window.confirmarEmissaoNfe();
    liberar();
    await Promise.all([primeira, segunda]);
    assert.equal(ctx.posts().filter((c) => c.rota === 'POST /api/nfe/manual/emitir').length, 1, 'duplo clique não emite duas vezes');
  });
});

// ===========================================================================
// Navegação sem efeitos
// ===========================================================================

describe('NF-E-04.2 — navegar pelo Fiscal não emite, não fatura e não fala com a SEFAZ', () => {
  it('percorrer todas as telas do menu gera apenas GETs para a API local', async () => {
    const ctx = criarJanela();
    ctx.rotas['GET /api/nfe/notas'] = { body: { success: true, notas: [NOTA_AUTORIZADA] } };
    ctx.rotas['GET /api/nfe/monitor'] = { body: { success: true, totais: [{ status: 'autorizada', qtd: 1 }] } };
    ctx.rotas['GET /api/nfe/fila'] = { body: { success: true, itens: FILA } };
    ctx.rotas['GET /api/nfe/prontidao'] = { body: DIAG_OK };
    ctx.rotas['GET /api/clientes'] = { body: [] };
    ctx.rotas['GET /api/produtos'] = { body: [] };
    ctx.window.renderFiscal();
    ctx.window.loadCentralContabil();
    for (const p of ['fiscal-nfe', 'fiscal-nfe-monitor', 'fiscal-nfe-fila', 'fiscal-nfe-diagnostico', 'fiscal-nfe-nova']) {
      await ctx.window.loadNfePagina(p);
      assert.notEqual(estado(ctx.doc), 'loading', p);
      ctx.doc.querySelectorAll('.modal').forEach((m) => m.remove());
    }
    await ctx.window.nfeRecarregarSecaoAtual();
    assert.equal(ctx.posts().length, 0);
    assert.ok(ctx.chamadas.every((c) => c.url.startsWith('http://localhost/api/')), 'nenhuma chamada externa');
    assert.ok(!ctx.chamadas.some((c) => c.rota === 'GET /api/nfe/diagnostico'));
  });

  it('Recarregar a Nova NF-e (após fechar o formulário) só reconsulta a prontidão; não reabre o formulário', async () => {
    const ctx = criarJanela();
    ctx.rotas['GET /api/nfe/prontidao'] = { body: DIAG_PRONTA };
    ctx.rotas['GET /api/clientes'] = { body: [] };
    ctx.rotas['GET /api/produtos'] = { body: [] };
    await ctx.window.loadNfePagina('fiscal-nfe-nova');
    assert.ok(ctx.doc.getElementById('modalNfeManual'));
    ctx.window.nfeFecharModal('modalNfeManual');
    const antes = ctx.chamadas.length;
    await ctx.window.nfeRecarregarSecaoAtual();
    assert.deepEqual(ctx.chamadas.slice(antes).map((c) => c.rota), ['GET /api/nfe/prontidao', 'GET /api/clientes', 'GET /api/produtos']);
    assert.equal(ctx.doc.getElementById('nfeManualEtapaFiscal').hidden, true, 'recarregar volta ao preenchimento, sem conferência');
    assert.equal(ctx.doc.getElementById('nfeBtnEmitirNova'), null);
    assert.ok(ctx.doc.getElementById('nfeBtnManualContinuar'));
    assert.equal(ctx.posts().length, 0);
  });
});

describe('NF-E-04.2 — isolamento', () => {
  before(() => {
    assert.ok(!/ProgramData[\\/]MercantilFiscal/i.test(DIR), 'testes nunca usam o banco oficial');
  });

  it('banco temporário e NFC-e/PDV sem NF-e', () => {
    assert.ok(DIR.includes('cds-nfe-testes'));
    assert.doesNotMatch(read('frontend/pdv/index.html'), /erp\/js\/nfe\.js/);
    assert.doesNotMatch(read('frontend/erp/js/nfe.js'), /\/fiscal\/emitir|cancelarNfce|\/nfce/i);
  });
});
