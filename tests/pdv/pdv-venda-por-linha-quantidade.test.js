/**
 * LINHA DE PRODUTOS 04 — Quantidade total na venda por Linha (PDV Desktop e Mobile).
 * Depois de selecionar a Linha, o operador informa a quantidade total a vender e continua.
 * A quantidade segue o padrão do PDV (vírgula decimal, 2 casas) e é só um dado temporário:
 * não distribui entre produtos, não vai ao carrinho, não cria venda e não mexe em estoque.
 * Executar: npm run test:pdv-venda-linha-quantidade
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const http = require('http');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const TMP = path.resolve(os.tmpdir()).toLowerCase();
if (!process.env.DB_DIR || !path.resolve(process.env.DB_DIR).toLowerCase().startsWith(TMP)) {
  console.error('Banco isolado ausente. Execute: node -r ./tests/pdv/_bancoIsolado.js --test tests/pdv/pdv-venda-por-linha-quantidade.test.js');
  process.exit(1);
}
for (const sufixo of ['', '-wal', '-shm']) {
  fs.rmSync(path.join(process.env.DB_DIR, 'mercadao.db' + sufixo), { force: true });
}
const DIR_CONFIG = path.join(process.env.DB_DIR, 'config');
fs.rmSync(DIR_CONFIG, { recursive: true, force: true });

const express = require('express');
const db = require('../../backend/database');
const bootstrapLinhasProdutos = require('../../backend/modules/fabrica-loja/migrations/010_linhas_produtos');

const RAIZ = path.join(__dirname, '..', '..');
const ler = (...partes) => fs.readFileSync(path.join(RAIZ, ...partes), 'utf8');
const CAMINHO_COMERCIALIZACAO = path.join(RAIZ, 'frontend', 'shared', 'js', 'pdvComercializacao.js');
const CAMINHO_VENDA_LINHA = path.join(RAIZ, 'frontend', 'shared', 'js', 'pdvVendaPorLinha.js');
const fonteDesktop = ler('frontend', 'pdv', 'js', 'pdv.js');
const fonteMobile = ler('frontend', 'apps', 'mobile', 'js', 'pages', 'pdv.js');
const fonteForms = ler('frontend', 'apps', 'mobile', 'js', 'forms.js');
const fonteFormatters = ler('frontend', 'apps', 'mobile', 'js', 'formatters.js');
const fonteUi = ler('frontend', 'apps', 'mobile', 'js', 'ui.js');
const fonteJquery = ler('frontend', 'vendor', 'jquery', 'jquery.min.js');

const ids = {};
let servidor;
let base;

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}
function get(sql, params = []) {
  return new Promise((resolve, reject) => db.get(sql, params, (e, r) => (e ? reject(e) : resolve(r || null))));
}

async function api(method, rota, body, perfil = 'OPERADOR') {
  const resposta = await fetch(base + rota, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-perfil-teste': perfil },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: resposta.status, body: await resposta.json().catch(() => null) };
}

async function consultar(caminho) {
  const resposta = await fetch(`${base}/${caminho}`);
  const corpo = await resposta.json().catch(() => null);
  if (!resposta.ok) throw new Error((corpo && corpo.error) || `HTTP ${resposta.status}`);
  return corpo;
}

function moduloNovo(caminho) {
  delete require.cache[require.resolve(caminho)];
  return require(caminho);
}

async function configurar(produto, linha) {
  const r = await api('PUT', '/configuracoes-avancadas/comercializacao', { permitirVendaPorProduto: produto, permitirVendaPorLinha: linha }, 'SUPER_ADMIN');
  assert.equal(r.status, 200);
}

async function linhaSelecionada(linhaId = ids.cremoso) {
  await configurar(true, true);
  const vendaPorLinha = moduloNovo(CAMINHO_VENDA_LINHA);
  await vendaPorLinha.selecionarLinha(consultar, linhaId);
  return vendaPorLinha;
}

function extrairFuncao(fonte, nome) {
  const inicio = fonte.indexOf(`function ${nome}(`);
  assert.ok(inicio >= 0, `função ${nome} não encontrada`);
  let i = fonte.indexOf(') {', inicio) + 2;
  let nivel = 0;
  for (; i < fonte.length; i += 1) {
    if (fonte[i] === '{') nivel += 1;
    else if (fonte[i] === '}' && --nivel === 0) break;
  }
  return fonte.slice(inicio, i + 1);
}

async function esperar(condicao, descricao, limiteMs = 4000) {
  const inicio = Date.now();
  while (Date.now() - inicio < limiteMs) {
    if (condicao()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`tempo esgotado esperando: ${descricao}`);
}

async function inserirProduto(codigo, nome, linha) {
  return (await run(`INSERT INTO produtos (codigo, nome, unidade, preco_venda, ativo, natureza_cadastro, item_fiscal, linha_produtos_id, estoque_atual, saldo_nao_fiscal, saldo_fiscal)
    VALUES (?, ?, 'UN', 2, 1, 'PRODUZIDO', 1, ?, 50, 50, 0)`, [codigo, nome, linha])).id;
}

async function contagens() {
  return {
    vendas: (await get('SELECT COUNT(*) AS q FROM vendas')).q,
    itens: (await get('SELECT COUNT(*) AS q FROM vendas_itens')).q,
    movimentos: (await get('SELECT COUNT(*) AS q FROM estoque_movimentacoes')).q,
    estoque: (await get('SELECT SUM(estoque_atual) AS q FROM produtos')).q,
    produtos: (await get('SELECT COUNT(*) AS q FROM produtos')).q,
    linhas: (await get('SELECT COUNT(*) AS q FROM linhas_produtos')).q
  };
}

/** PDV Desktop: jQuery real + funções reais do pdv.js; o Bootstrap Modal é simulado. */
async function abrirDesktop() {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'http://127.0.0.1/', pretendToBeVisual: true });
  const w = dom.window;
  w.eval(fonteJquery);
  w.eval(fs.readFileSync(CAMINHO_COMERCIALIZACAO, 'utf8'));
  w.eval(fs.readFileSync(CAMINHO_VENDA_LINHA, 'utf8'));
  w.API_URL = base;
  w.fetch = (url, opcoes) => fetch(url, opcoes);
  w.notificacoes = [];
  w.carrinho = [];
  const produtosPdv = await new Promise((resolve, reject) => {
    db.all('SELECT * FROM produtos WHERE id IN (?, ?, ?)', [ids.chocolate, ids.morango, ids.avulso], (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
  w.produtosDisponiveis = produtosPdv;
  w.bootstrap = {
    Modal: {
      getOrCreateInstance: (el) => ({
        show() { el.classList.add('show'); w.jQuery(el).trigger('shown.bs.modal'); },
        hide() { el.classList.remove('show'); w.jQuery(el).trigger('hidden.bs.modal'); }
      })
    }
  };
  w.eval(`
    function showNotification(mensagem, tipo) { notificacoes.push({ mensagem, tipo }); }
    function focarCampoCodigo() {}
    function modoFiscalQueryParam() { return '0'; }
    function adicionarItemNoCarrinho() { throw new Error('não deveria adicionar ao carrinho'); }
  `);
  for (const nome of [
    'escapeHtml', 'consultarApiPdv', 'carregarComercializacaoPdv', 'atualizarOpcaoVendaPorLinhaPdv',
    'unidadeEhKg', 'produtoUsaConversaoUnidadesPdv', 'quantidadeUsaDecimaisPdv',
    'parseQuantidadePdv', 'normalizarQuantidadePdv', 'abrirVendaPorLinhaPdv'
  ]) {
    w.eval(extrairFuncao(fonteDesktop, nome));
  }
  w.document.body.innerHTML = '<button id="btnVenderPorLinhaPdv" class="pdv-btn-vender-linha d-none">Vender por Linha</button>';
  await w.carregarComercializacaoPdv();
  w.atualizarOpcaoVendaPorLinhaPdv();
  return w;
}

/** PDV Mobile: funções reais de pdv.js, forms.js, formatters.js e ui.js; CDSApi aponta para o servidor de teste. */
async function abrirMobile() {
  const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>', { runScripts: 'outside-only', url: 'http://127.0.0.1/', pretendToBeVisual: true });
  const w = dom.window;
  w.eval(fs.readFileSync(CAMINHO_COMERCIALIZACAO, 'utf8'));
  w.eval(fs.readFileSync(CAMINHO_VENDA_LINHA, 'utf8'));
  w.CDSApi = { get: (caminho) => consultar(caminho) };
  w.toasts = [];
  w.eval(`
    function icon() { return ''; }
    function showToast(mensagem, tipo) { toasts.push({ mensagem, tipo }); }
    function saveCart() { throw new Error('não deveria mexer no carrinho'); }
  `);
  const funcoes = [
    [fonteFormatters, ['asText', 'escapeHtml']],
    [fonteUi, ['loadingHtml', 'emptyHtml', 'searchBarHtml', 'debounce']],
    [fonteForms, ['fieldHtml', 'openBottomSheet', 'closeBottomSheet']],
    [fonteMobile, ['carregarComercializacaoMobile', 'atualizarOpcaoVendaPorLinhaMobile', 'bindVendaPorLinhaMobile', 'abrirVendaPorLinhaMobile']]
  ];
  for (const [fonte, nomes] of funcoes) {
    for (const nome of nomes) w.eval(extrairFuncao(fonte, nome));
  }
  const root = w.document.getElementById('root');
  root.innerHTML = `<button type="button" class="cds-quick" id="pdv-venda-linha" style="display:none;width:100%;margin:0 0 8px">Vender por Linha</button>`;
  await w.carregarComercializacaoMobile();
  w.bindVendaPorLinhaMobile(root);
  await w.PdvComercializacao.pronto();
  return { w, root };
}

before(async () => {
  assert.ok(path.resolve(db.dbPath).toLowerCase().startsWith(TMP), `banco fora do temp: ${db.dbPath}`);
  await new Promise((resolve) => db.whenReady(() => resolve()));
  await bootstrapLinhasProdutos(db);

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = { id: 1, perfil: req.headers['x-perfil-teste'] || 'OPERADOR' }; next(); });
  app.use('/api/configuracoes-avancadas', require('../../backend/rotas/configuracoes_avancadas'));
  app.use('/api/produtos', require('../../backend/rotas/produtos'));
  app.use('/api/fabrica-loja', require('../../backend/rotas/fabrica-loja'));
  servidor = http.createServer(app);
  await new Promise((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${servidor.address().port}/api`;

  const criarLinha = async (codigo, nome) => {
    const r = await api('POST', '/fabrica-loja/linhas-produtos', { codigo, nome }, 'SUPER_ADMIN');
    assert.ok(r.status < 300, JSON.stringify(r.body));
    return r.body.linha.id;
  };
  ids.cremoso = await criarLinha('CREM', 'Picolé Cremoso');
  ids.frutaLeite = await criarLinha('FLEITE', 'Fruta ao Leite');
  ids.especial = await criarLinha('', 'Especial');
  ids.chocolate = await inserirProduto('PC-CHOC', 'Chocolate', ids.cremoso);
  ids.morango = await inserirProduto('PC-MOR', 'Morango', ids.cremoso);
  ids.uva = await inserirProduto('FL-UVA', 'Uva', ids.frutaLeite);
  ids.avulso = await inserirProduto('PIC-AVULSO', 'Picolé Avulso', null);
});

after(async () => {
  fs.rmSync(DIR_CONFIG, { recursive: true, force: true });
  if (servidor) await new Promise((resolve) => servidor.close(resolve));
  await new Promise((resolve) => db.close(() => resolve()));
});

describe('PDV — quantidade total na venda por Linha', () => {
  it('1. com a Linha habilitada e selecionada, a quantidade total pode ser informada', async () => {
    const vendaPorLinha = await linhaSelecionada();
    assert.equal(vendaPorLinha.obterSelecao().quantidadeTotal, null, 'começa sem quantidade');
    const r = vendaPorLinha.definirQuantidadeTotal('100');
    assert.equal(r.ok, true);
    assert.equal(vendaPorLinha.obterSelecao().quantidadeTotal, 100);

    const semSelecao = moduloNovo(CAMINHO_VENDA_LINHA);
    assert.deepEqual(semSelecao.definirQuantidadeTotal('100'), { ok: false, mensagem: 'Selecione uma linha.' });
    const vazia = await linhaSelecionada(ids.especial);
    assert.deepEqual(vazia.definirQuantidadeTotal('100'), { ok: false, mensagem: 'Esta linha não tem produtos disponíveis para venda.' });
  });

  const recusadas = {
    '2. quantidade vazia é recusada': ['', '   ', null, undefined],
    '3. quantidade zero é recusada': ['0', '0,00', '0.0', '0,001'],
    '4. quantidade negativa é recusada': ['-1', '-0,5', '-100'],
    '5. texto inválido é recusado': ['abc', '10abc', '1,2,3', '1e3', 'NaN', 'Infinity', '10 un', '1.23.4', ',5', '5,']
  };
  for (const [titulo, valores] of Object.entries(recusadas)) {
    it(titulo, async () => {
      const vendaPorLinha = await linhaSelecionada();
      vendaPorLinha.definirQuantidadeTotal('7');
      for (const valor of valores) {
        assert.equal(vendaPorLinha.interpretarQuantidadeTotal(valor), null, JSON.stringify(valor));
        assert.deepEqual(vendaPorLinha.definirQuantidadeTotal(valor), { ok: false, mensagem: 'Informe uma quantidade maior que zero.' }, JSON.stringify(valor));
      }
      assert.equal(vendaPorLinha.obterSelecao().quantidadeTotal, 7, 'valor recusado não substitui a quantidade já aceita');
    });
  }

  it('6. quantidade válida é aceita', async () => {
    const vendaPorLinha = await linhaSelecionada();
    for (const [valor, esperado] of [['1', 1], ['10', 10], ['100', 100], [' 250 ', 250]]) {
      const r = vendaPorLinha.definirQuantidadeTotal(valor);
      assert.equal(r.ok, true, valor);
      assert.equal(r.quantidadeTotal, esperado);
      assert.equal(vendaPorLinha.obterSelecao().quantidadeTotal, esperado);
    }
  });

  it('7. quantidade decimal segue o padrão do PDV (vírgula decimal, 2 casas)', async () => {
    const vendaPorLinha = await linhaSelecionada();
    const contexto = vm.createContext({});
    vm.runInContext('function quantidadeUsaDecimaisPdv() { return true; }', contexto);
    for (const nome of ['parseQuantidadePdv', 'normalizarQuantidadePdv', 'formatarQuantidadePdv']) {
      vm.runInContext(extrairFuncao(fonteDesktop, nome), contexto);
    }
    const casos = [['250,5', 250.5], ['1.234,5', 1234.5], ['10,456', 10.46], ['250.5', 250.5], ['0,5', 0.5], ['100', 100]];
    for (const [valor, esperado] of casos) {
      assert.equal(vendaPorLinha.interpretarQuantidadeTotal(valor), esperado, valor);
      const pdv = contexto.normalizarQuantidadePdv(contexto.parseQuantidadePdv(valor), {});
      assert.equal(vendaPorLinha.interpretarQuantidadeTotal(valor), pdv, `${valor}: igual ao campo de quantidade do PDV`);
      assert.equal(vendaPorLinha.formatarQuantidade(esperado), contexto.formatarQuantidadePdv(esperado, {}), `${valor}: mesma exibição do PDV`);
    }
    assert.equal(vendaPorLinha.definirQuantidadeTotal('250,5').quantidadeTotal, 250.5);
    assert.equal(vendaPorLinha.formatarQuantidade(250.5), '250,5');
  });

  it('8. o id da Linha permanece correto durante todo o fluxo', async () => {
    const vendaPorLinha = await linhaSelecionada();
    vendaPorLinha.definirQuantidadeTotal('abc');
    vendaPorLinha.definirQuantidadeTotal('100');
    vendaPorLinha.marcarProduto(ids.chocolate, true);
    vendaPorLinha.definirQuantidadeTotal('80');
    let selecao = vendaPorLinha.obterSelecao();
    assert.equal(selecao.linhaProdutosId, ids.cremoso);
    assert.equal(selecao.nome, 'Picolé Cremoso');
    assert.equal(selecao.quantidadeTotal, 80);

    const renomear = await api('PUT', `/fabrica-loja/linhas-produtos/${ids.cremoso}`, { codigo: 'CREM', nome: 'Cremoso Novo Nome' }, 'SUPER_ADMIN');
    assert.ok(renomear.status < 300);
    try {
      assert.equal(vendaPorLinha.obterSelecao().linhaProdutosId, ids.cremoso, 'renomear não muda a seleção');
    } finally {
      await api('PUT', `/fabrica-loja/linhas-produtos/${ids.cremoso}`, { codigo: 'CREM', nome: 'Picolé Cremoso' }, 'SUPER_ADMIN');
    }

    await vendaPorLinha.selecionarLinha(consultar, ids.frutaLeite);
    selecao = vendaPorLinha.obterSelecao();
    assert.equal(selecao.linhaProdutosId, ids.frutaLeite);
    assert.equal(selecao.quantidadeTotal, null, 'outra linha começa sem quantidade');
  });

  it('9 e 10. nenhum produto vai ao carrinho e nenhuma venda, estoque ou movimento é criado', async () => {
    const antes = await contagens();
    const vendaPorLinha = await linhaSelecionada();
    vendaPorLinha.definirQuantidadeTotal('100');
    vendaPorLinha.definirQuantidadeTotal('250,5');

    const desktop = await abrirDesktop();
    desktop.abrirVendaPorLinhaPdv();
    await esperar(() => desktop.document.querySelector(`[data-linha-id="${ids.cremoso}"]`), 'linhas no Desktop');
    desktop.jQuery(`[data-linha-id="${ids.cremoso}"]`).trigger('click');
    await esperar(() => !desktop.document.getElementById('etapaProdutosLinhaPdv').classList.contains('d-none'), 'produtos no Desktop');
    assert.deepEqual(
      Array.from(desktop.document.querySelectorAll('[data-quantidade-produto-id]')).map((campo) => campo.value),
      ['', ''],
      'os campos começam vazios'
    );
    assert.deepEqual(
      Array.from(desktop.document.querySelectorAll('[data-quantidade-produto-id]')).map((campo) => campo.placeholder),
      ['0', '0'],
      'o zero é apenas uma referência visual'
    );
    assert.deepEqual(Array.from(desktop.carrinho), []);

    const { w: mobile } = await abrirMobile();
    mobile.abrirVendaPorLinhaMobile();
    await esperar(() => mobile.document.querySelector(`[data-linha-id="${ids.cremoso}"]`), 'linhas no Mobile');
    mobile.document.querySelector(`[data-linha-id="${ids.cremoso}"]`).click();
    await esperar(() => mobile.document.getElementById('f-linha_quantidade_total'), 'quantidade no Mobile');
    mobile.document.getElementById('f-linha_quantidade_total').value = '100';
    mobile.document.getElementById('pdv-linha-continuar').click();

    assert.deepEqual(await contagens(), antes);

    const codigoModulo = fs.readFileSync(CAMINHO_VENDA_LINHA, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(codigoModulo, /carrinho|cart|preco|estoque|post\(|fetch\(|localStorage|sessionStorage|CDSApi/i);
    const fluxoDesktop = extrairFuncao(fonteDesktop, 'abrirVendaPorLinhaPdv');
    assert.match(fluxoDesktop, /adicionarDistribuicaoLinhaNoCarrinhoPdv/, 'Continuar reutiliza a integração comercial existente');
    assert.doesNotMatch(fluxoDesktop, /adicionarItemNoCarrinho|atualizarCarrinho|resolverPrecos|method:\s*'POST'|\$\.ajax|\$\.post/i);
    const fluxoMobile = extrairFuncao(fonteMobile, 'abrirVendaPorLinhaMobile')
      .replace(/const adicionarAoCarrinho = [\s\S]*?\n\s*\};\n/, '')
      .replace(/Adicionar ao carrinho|adicionarAoCarrinho\(\)/g, '');
    assert.doesNotMatch(fluxoMobile, /saveCart|loadCart|paintCart|resolverPrecos|openPdvAddProdutoSheet|CDSApi\.(post|put|patch|del)/);
  });

  it('11. a venda tradicional por produto continua funcionando', async () => {
    await configurar(true, true);
    const busca = await api('GET', '/produtos/consulta-pdv/buscar?q=PIC-AVULSO&modo_fiscal=0');
    assert.equal(busca.body[0].id, ids.avulso);
    const VendaPagamentoService = require('../../backend/services/vendas/VendaPagamentoService');
    const resposta = await new Promise((resolve) => {
      const res = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(payload) { resolve({ status: this.statusCode, body: payload }); return this; }
      };
      VendaPagamentoService.criarVenda({
        body: {
          total: 4, forma_pagamento: 'dinheiro', valor_recebido: 4, emitir_fiscal: false, origem_pdv: 'PDV_DESKTOP',
          itens: [{ produto_id: ids.avulso, quantidade: 2, preco_unitario: 2, subtotal: 4 }],
          pagamentos: [{ forma: 'dinheiro', valor: 4 }]
        },
        headers: {}, query: {}, user: { id: 1 }
      }, res);
    });
    assert.ok(resposta.status < 300, `status ${resposta.status}: ${JSON.stringify(resposta.body)}`);
    assert.deepEqual(await get('SELECT produto_id, quantidade FROM vendas_itens ORDER BY id DESC LIMIT 1'), { produto_id: ids.avulso, quantidade: 2 });
    assert.equal((await get('SELECT estoque_atual FROM produtos WHERE id = ?', [ids.avulso])).estoque_atual, 48);
  });

  it('12a. Desktop: quantidades individuais, total, validações e botões', async () => {
    await configurar(true, false);
    const desligado = await abrirDesktop();
    assert.ok(desligado.document.getElementById('btnVenderPorLinhaPdv').classList.contains('d-none'));
    desligado.abrirVendaPorLinhaPdv();
    assert.equal(desligado.document.getElementById('modalVendaPorLinhaPdv'), null, 'com a Linha desligada não abre');

    await configurar(true, true);
    const w = await abrirDesktop();
    const $ = w.jQuery;
    const visivel = (id) => !w.document.getElementById(id).classList.contains('d-none');
    assert.ok(visivel('btnVenderPorLinhaPdv'));
    w.abrirVendaPorLinhaPdv();
    await esperar(() => w.document.querySelector(`[data-linha-id="${ids.cremoso}"]`), 'lista de linhas');
    $(`[data-linha-id="${ids.cremoso}"]`).trigger('click');
    await esperar(() => visivel('etapaProdutosLinhaPdv'), 'etapa da linha');

    assert.equal($('#nomeLinhaSelecionadaPdv').text(), 'Picolé Cremoso');
    assert.equal($('#quantidadeTotalLinhaPdv').length, 0, 'não exige quantidade total prévia');
    assert.equal($('#listaProdutosLinhaPdv input[type="checkbox"]').length, 0, 'não mostra caixas de seleção');
    assert.ok(visivel('btnContinuarLinhaPdv'));
    const campos = $('#listaProdutosLinhaPdv [data-quantidade-produto-id]');
    assert.equal(campos.length, 2);
    assert.deepEqual(Array.from(campos.map((_, el) => el.value).get()), ['', '']);
    assert.deepEqual(Array.from(campos.map((_, el) => el.placeholder).get()), ['0', '0']);
    assert.ok(!$('#totalProdutosLinhaPdv').hasClass('d-none'), 'o total acompanha os campos de produto');

    $('#btnContinuarLinhaPdv').trigger('click');
    assert.match($('#erroQuantidadeProdutosLinhaPdv').text(), /pelo menos um produto/);
    assert.ok(w.document.getElementById('modalVendaPorLinhaPdv'), 'não continua quando todas as quantidades são zero');

    const chocolate = $(`[data-quantidade-produto-id="${ids.chocolate}"]`);
    const morango = $(`[data-quantidade-produto-id="${ids.morango}"]`);
    chocolate.val('2').trigger('input');
    morango.val('3').trigger('input');
    assert.equal($('#somaProdutosLinhaPdv').text(), '5', 'soma automaticamente as quantidades');
    assert.ok(visivel('btnVoltarLinhasPdv'));

    chocolate.val('1,5').trigger('input');
    assert.ok(chocolate.hasClass('is-invalid'), 'bloqueia fração em produto por unidade');
    $('#btnContinuarLinhaPdv').trigger('click');
    assert.ok(visivel('etapaProdutosLinhaPdv'), 'não avança enquanto houver campo inválido');
    assert.equal(w.document.getElementById('modalVendaPorLinhaPdv') !== null, true, 'não tenta adicionar');
    chocolate.val('2').trigger('input');

    let payload;
    w.adicionarDistribuicaoLinhaNoCarrinhoPdv = (itens) => {
      payload = itens;
      return Promise.resolve({ ok: true });
    };
    $('#btnContinuarLinhaPdv').trigger('click');
    await esperar(() => !w.document.getElementById('modalVendaPorLinhaPdv'), 'inclusão dos produtos');
    assert.deepEqual(JSON.parse(JSON.stringify(payload.distribuicao)), [
      { produto_id: ids.chocolate, quantidade: 2 },
      { produto_id: ids.morango, quantidade: 3 }
    ], 'usa cada produto_id e sua quantidade individual');
    assert.equal(w.PdvVendaPorLinha.obterSelecao(), null, 'Fechar após inclusão limpa a seleção');

    w.abrirVendaPorLinhaPdv();
    await esperar(() => w.document.querySelector(`[data-linha-id="${ids.cremoso}"]`), 'linhas na reabertura');
    $(`[data-linha-id="${ids.cremoso}"]`).trigger('click');
    await esperar(() => visivel('etapaProdutosLinhaPdv'), 'produtos na reabertura');
    assert.deepEqual(
      Array.from($('#listaProdutosLinhaPdv [data-quantidade-produto-id]').map((_, el) => el.value).get()),
      ['', ''],
      'reabrir não duplica nem reaproveita quantidades anteriores'
    );
    $(`[data-quantidade-produto-id="${ids.morango}"]`).val('4').trigger('input');
    $('#btnContinuarLinhaPdv').trigger('click');
    await esperar(() => !w.document.getElementById('modalVendaPorLinhaPdv'), 'inclusão sem quantidades zeradas');
    assert.deepEqual(JSON.parse(JSON.stringify(payload.distribuicao)), [
      { produto_id: ids.morango, quantidade: 4 }
    ], 'produtos com quantidade zero são omitidos');

    w.abrirVendaPorLinhaPdv();
    await esperar(() => w.document.querySelector(`[data-linha-id="${ids.cremoso}"]`), 'linhas antes de voltar');
    $(`[data-linha-id="${ids.cremoso}"]`).trigger('click');
    await esperar(() => visivel('etapaProdutosLinhaPdv'), 'produto antes de voltar');
    $('#btnVoltarLinhasPdv').trigger('click');
    assert.ok(visivel('etapaBuscaLinhaPdv'));
    assert.equal(w.PdvVendaPorLinha.obterSelecao(), null);
    w.bootstrap.Modal.getOrCreateInstance(w.document.getElementById('modalVendaPorLinhaPdv')).hide();
    assert.equal(w.document.getElementById('modalVendaPorLinhaPdv'), null, 'Fechar remove o modal');
  });

  it('12b. Mobile: selecionar Linha → quantidade total → Continuar', async () => {
    await configurar(true, false);
    const desligado = await abrirMobile();
    assert.equal(desligado.root.querySelector('#pdv-venda-linha').style.display, 'none');

    await configurar(true, true);
    const { w, root } = await abrirMobile();
    const doc = w.document;
    const botao = root.querySelector('#pdv-venda-linha');
    assert.equal(botao.style.display, '', 'botão aparece');
    botao.click();
    await esperar(() => doc.querySelector(`#cds-mobile-sheet [data-linha-id="${ids.cremoso}"]`), 'lista de linhas');
    doc.querySelector(`[data-linha-id="${ids.cremoso}"]`).click();
    await esperar(() => doc.getElementById('f-linha_quantidade_total'), 'campo de quantidade');

    const corpo = () => doc.getElementById('pdv-linha-corpo');
    const continuar = doc.getElementById('pdv-linha-continuar');
    const voltar = doc.getElementById('pdv-linha-voltar');
    assert.match(corpo().textContent, /Linha selecionada:\s*Picolé Cremoso/);
    assert.match(corpo().textContent, /Quantidade total a vender/);
    assert.match(corpo().textContent, /Depois você poderá distribuir essa quantidade entre os produtos da linha\./);
    assert.equal(continuar.style.display, '');
    assert.equal(corpo().querySelectorAll('[data-produto-id]').length, 2);
    assert.equal(corpo().querySelectorAll('[data-produto-id]:checked').length, 0);

    for (const invalida of ['', '0', '-1', 'abc']) {
      doc.getElementById('f-linha_quantidade_total').value = invalida;
      continuar.click();
      const erro = doc.getElementById('pdv-linha-quantidade-erro');
      assert.equal(erro.style.display, '', `mensagem com "${invalida}"`);
      assert.equal(erro.textContent, 'Informe uma quantidade maior que zero.');
      assert.ok(doc.getElementById('f-linha_quantidade_total'), `não avança com "${invalida}"`);
    }

    const primeiro = corpo().querySelector('[data-produto-id]');
    primeiro.checked = true;
    primeiro.dispatchEvent(new w.Event('change', { bubbles: true }));
    doc.getElementById('f-linha_quantidade_total').value = '250,5';
    continuar.click();
    assert.equal(doc.getElementById('f-linha_quantidade_total'), null, 'avançou para a próxima etapa');
    assert.match(corpo().textContent, /Quantidade total:\s*250,5/);
    const selecao = w.PdvVendaPorLinha.obterSelecao();
    assert.equal(selecao.linhaProdutosId, ids.cremoso);
    assert.equal(selecao.quantidadeTotal, 250.5);

    voltar.click();
    assert.equal(doc.getElementById('f-linha_quantidade_total').value, '250,5', 'Voltar retorna para a quantidade');
    assert.equal(corpo().querySelectorAll('[data-produto-id]:checked').length, 1, 'mantém o que foi marcado');
    voltar.click();
    assert.ok(doc.getElementById('pdv-linha-busca'), 'volta para a busca');
    assert.equal(w.PdvVendaPorLinha.obterSelecao(), null);

    await esperar(() => doc.querySelector(`[data-linha-id="${ids.especial}"]`), 'lista de linhas novamente');
    doc.querySelector(`[data-linha-id="${ids.especial}"]`).click();
    await esperar(() => /Esta linha não tem produtos/.test(corpo().textContent), 'linha vazia');
    assert.equal(doc.getElementById('f-linha_quantidade_total'), null, 'linha sem produtos não pede quantidade');
    assert.equal(continuar.style.display, 'none');
  });
});
