/**
 * LINHA DE PRODUTOS 05 — Distribuição da quantidade da Linha entre os produtos (PDV Desktop e Mobile).
 * Depois da quantidade total, o operador distribui essa quantidade entre os produtos da Linha
 * (identificados por produto_id). Continuar só conclui quando Distribuído = Quantidade total.
 * A distribuição é só um dado temporário em memória: não cria venda, não vai ao carrinho e não mexe em estoque.
 * Executar: npm run test:pdv-venda-linha-distribuicao
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const TMP = path.resolve(os.tmpdir()).toLowerCase();
if (!process.env.DB_DIR || !path.resolve(process.env.DB_DIR).toLowerCase().startsWith(TMP)) {
  console.error('Banco isolado ausente. Execute: node -r ./tests/pdv/_bancoIsolado.js --test tests/pdv/pdv-venda-por-linha-distribuicao.test.js');
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

const MSG_INCOMPLETA = 'Distribua toda a quantidade antes de continuar.';
const MSG_EXCEDIDA = 'A quantidade distribuída não pode ser maior que a quantidade total.';
const MSG_INVALIDA = 'Informe uma quantidade maior que zero.';

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

/** Objetos criados dentro do jsdom têm protótipos de outro realm; o deepStrictEqual exige normalizar. */
const json = (valor) => JSON.parse(JSON.stringify(valor));

function moduloNovo(caminho) {
  delete require.cache[require.resolve(caminho)];
  return require(caminho);
}

async function configurar(produto, linha) {
  const r = await api('PUT', '/configuracoes-avancadas/comercializacao', { permitirVendaPorProduto: produto, permitirVendaPorLinha: linha }, 'SUPER_ADMIN');
  assert.equal(r.status, 200);
}

/** Linha selecionada com quantidade total já informada. */
async function linhaComTotal(total = '100', linhaId = ids.cremoso) {
  await configurar(true, true);
  const vendaPorLinha = moduloNovo(CAMINHO_VENDA_LINHA);
  await vendaPorLinha.selecionarLinha(consultar, linhaId);
  assert.equal(vendaPorLinha.definirQuantidadeTotal(total).ok, true);
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
    saldos: (await get('SELECT SUM(saldo_nao_fiscal) + SUM(saldo_fiscal) AS q FROM produtos')).q,
    produtos: (await get('SELECT COUNT(*) AS q FROM produtos')).q,
    linhas: (await get('SELECT COUNT(*) AS q FROM linhas_produtos')).q,
    alteracoes: (await get('SELECT total_changes() AS q')).q
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
    db.all('SELECT * FROM produtos WHERE linha_produtos_id = ?', [ids.cremoso], (err, rows) => {
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

/** Desktop aberto nos campos de quantidade individual da Linha Cremoso. */
async function desktopNaDistribuicao() {
  await configurar(true, true);
  const w = await abrirDesktop();
  const $ = w.jQuery;
  const visivel = (id) => !w.document.getElementById(id).classList.contains('d-none');
  w.abrirVendaPorLinhaPdv();
  await esperar(() => w.document.querySelector(`[data-linha-id="${ids.cremoso}"]`), 'lista de linhas');
  $(`[data-linha-id="${ids.cremoso}"]`).trigger('click');
  await esperar(() => visivel('etapaProdutosLinhaPdv'), 'etapa da linha');
  const campo = (produtoId) => $(`[data-quantidade-produto-id="${produtoId}"]`);
  const digitar = (produtoId, valor) => campo(produtoId).val(valor).trigger('input');
  return { w, $, visivel, campo, digitar };
}

/** Mobile aberto na etapa de distribuição da Linha Cremoso com o total informado. */
async function mobileNaDistribuicao(total = '100') {
  await configurar(true, true);
  const { w, root } = await abrirMobile();
  const doc = w.document;
  root.querySelector('#pdv-venda-linha').click();
  await esperar(() => doc.querySelector(`[data-linha-id="${ids.cremoso}"]`), 'lista de linhas');
  doc.querySelector(`[data-linha-id="${ids.cremoso}"]`).click();
  await esperar(() => doc.getElementById('f-linha_quantidade_total'), 'campo de quantidade');
  doc.getElementById('f-linha_quantidade_total').value = total;
  const continuar = doc.getElementById('pdv-linha-continuar');
  const voltar = doc.getElementById('pdv-linha-voltar');
  continuar.click();
  const corpo = () => doc.getElementById('pdv-linha-corpo');
  const campo = (produtoId) => doc.querySelector(`[data-distribuir-produto-id="${produtoId}"]`);
  const digitar = (produtoId, valor) => {
    campo(produtoId).value = valor;
    campo(produtoId).dispatchEvent(new w.Event('input', { bubbles: true }));
  };
  const erroProduto = (produtoId) => doc.querySelector(`[data-distribuir-erro="${produtoId}"]`);
  const erroGeral = () => doc.getElementById('pdv-linha-distribuicao-erro');
  assert.ok(campo(ids.chocolate), 'abriu a distribuição');
  return { w, doc, corpo, campo, digitar, continuar, voltar, erroProduto, erroGeral };
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

describe('PDV — distribuição da quantidade da Linha entre os produtos', () => {
  it('1. total 100 distribuído como 30 + 70', async () => {
    const vendaPorLinha = await linhaComTotal('100');
    assert.equal(vendaPorLinha.definirQuantidadeProduto(ids.chocolate, '30').ok, true);
    assert.equal(vendaPorLinha.definirQuantidadeProduto(ids.morango, '70').ok, true);
    assert.deepEqual(
      { ...vendaPorLinha.resumoDistribuicao() },
      { quantidadeTotal: 100, distribuido: 100, restante: 0, completa: true, excedida: false, pendencias: 0 }
    );
    const r = vendaPorLinha.concluirDistribuicao();
    assert.equal(r.ok, true);
    assert.deepEqual(r.distribuicao, {
      linha_produtos_id: ids.cremoso,
      quantidade_total: 100,
      distribuicao: [{ produto_id: ids.chocolate, quantidade: 30 }, { produto_id: ids.morango, quantidade: 70 }]
    });
    assert.deepEqual(vendaPorLinha.obterDistribuicao(), r.distribuicao);
  });

  it('2. distribuição parcial mostra o restante', async () => {
    const vendaPorLinha = await linhaComTotal('100');
    vendaPorLinha.definirQuantidadeProduto(ids.chocolate, '30');
    let resumo = vendaPorLinha.resumoDistribuicao();
    assert.equal(resumo.distribuido, 30);
    assert.equal(resumo.restante, 70);
    assert.equal(resumo.completa, false);
    vendaPorLinha.definirQuantidadeProduto(ids.morango, '45,5');
    resumo = vendaPorLinha.resumoDistribuicao();
    assert.equal(resumo.distribuido, 75.5);
    assert.equal(resumo.restante, 24.5);
  });

  it('3. distribuição igual ao total permite continuar', async () => {
    const vendaPorLinha = await linhaComTotal('100');
    vendaPorLinha.definirQuantidadeProduto(ids.chocolate, '25,5');
    vendaPorLinha.definirQuantidadeProduto(ids.morango, '74,5');
    assert.equal(vendaPorLinha.resumoDistribuicao().completa, true);
    assert.equal(vendaPorLinha.concluirDistribuicao().ok, true);
    assert.equal(vendaPorLinha.obterSelecao().distribuicaoConcluida, true);

    const soUmProduto = await linhaComTotal('100');
    soUmProduto.definirQuantidadeProduto(ids.morango, '100');
    assert.deepEqual(soUmProduto.concluirDistribuicao().distribuicao.distribuicao, [{ produto_id: ids.morango, quantidade: 100 }]);
  });

  it('4. distribuição menor que o total impede concluir', async () => {
    const vendaPorLinha = await linhaComTotal('100');
    assert.deepEqual(
      { ok: vendaPorLinha.concluirDistribuicao().ok, mensagem: vendaPorLinha.concluirDistribuicao().mensagem },
      { ok: false, mensagem: MSG_INCOMPLETA },
      'nada distribuído'
    );
    vendaPorLinha.definirQuantidadeProduto(ids.chocolate, '30');
    vendaPorLinha.definirQuantidadeProduto(ids.morango, '60');
    const r = vendaPorLinha.concluirDistribuicao();
    assert.equal(r.ok, false);
    assert.equal(r.mensagem, MSG_INCOMPLETA);
    assert.equal(r.resumo.restante, 10);
    assert.equal(vendaPorLinha.obterSelecao().distribuicaoConcluida, false);
  });

  it('5. distribuição maior que o total é impedida', async () => {
    const vendaPorLinha = await linhaComTotal('100');
    let r = vendaPorLinha.definirQuantidadeProduto(ids.chocolate, '101');
    assert.equal(r.ok, false);
    assert.equal(r.mensagem, MSG_EXCEDIDA);
    assert.equal(vendaPorLinha.resumoDistribuicao().distribuido, 0, '101 não é aplicado');

    vendaPorLinha.definirQuantidadeProduto(ids.chocolate, '30');
    r = vendaPorLinha.definirQuantidadeProduto(ids.morango, '70,01');
    assert.equal(r.ok, false);
    assert.equal(r.mensagem, MSG_EXCEDIDA);
    assert.equal(r.resumo.distribuido, 30, 'o excesso não entra no distribuído');
    assert.equal(vendaPorLinha.valorDoCampo(ids.morango), '70,01', 'o campo mantém o que foi digitado');
    assert.equal(vendaPorLinha.concluirDistribuicao().mensagem, MSG_EXCEDIDA, 'não conclui com valor recusado');

    vendaPorLinha.definirQuantidadeProduto(ids.morango, '70');
    assert.equal(vendaPorLinha.concluirDistribuicao().ok, true);

    vendaPorLinha.definirQuantidadeTotal('50');
    const reduzido = vendaPorLinha.concluirDistribuicao();
    assert.equal(reduzido.ok, false, 'reduzir o total abaixo do distribuído bloqueia');
    assert.equal(reduzido.mensagem, MSG_EXCEDIDA);
    assert.equal(reduzido.resumo.excedida, true);
  });

  it('6. produto com quantidade vazia é tratado como 0 e não gera item', async () => {
    const vendaPorLinha = await linhaComTotal('100');
    vendaPorLinha.definirQuantidadeProduto(ids.chocolate, '30');
    for (const vazio of ['', '   ', null, undefined]) {
      vendaPorLinha.definirQuantidadeProduto(ids.chocolate, '30');
      const r = vendaPorLinha.definirQuantidadeProduto(ids.chocolate, vazio);
      assert.equal(r.ok, true, JSON.stringify(vazio));
      assert.equal(r.quantidade, 0);
      assert.equal(vendaPorLinha.resumoDistribuicao().distribuido, 0);
    }
    vendaPorLinha.definirQuantidadeProduto(ids.morango, '100');
    const r = vendaPorLinha.concluirDistribuicao();
    assert.equal(r.ok, true);
    assert.deepEqual(r.distribuicao.distribuicao, [{ produto_id: ids.morango, quantidade: 100 }], 'Chocolate vazio não vira item');
    assert.equal(vendaPorLinha.valorDoCampo(ids.chocolate), '');
  });

  it('7. quantidades decimais seguem a mesma regra da quantidade da Linha', async () => {
    const vendaPorLinha = await linhaComTotal('1000');
    for (const [valor, esperado] of [['1', 1], ['10', 10], ['25,5', 25.5], ['100', 100], ['1.234', 1.23], ['0,01', 0.01]]) {
      const r = vendaPorLinha.definirQuantidadeProduto(ids.chocolate, valor);
      assert.equal(r.ok, true, valor);
      assert.equal(r.quantidade, esperado, valor);
      assert.equal(r.quantidade, vendaPorLinha.interpretarQuantidadeTotal(valor), `${valor}: mesma interpretação da quantidade total`);
    }
    vendaPorLinha.definirQuantidadeProduto(ids.chocolate, '5');
    for (const invalida of ['0,001', '-1', 'abc', '10abc', '1e3', '0', '-0,5', '1,2,3', 'NaN']) {
      const r = vendaPorLinha.definirQuantidadeProduto(ids.morango, invalida);
      assert.equal(r.ok, false, invalida);
      assert.equal(r.mensagem, MSG_INVALIDA, invalida);
      assert.equal(vendaPorLinha.resumoDistribuicao().distribuido, 5, `${invalida} não entra no distribuído`);
    }
    assert.equal(vendaPorLinha.concluirDistribuicao().ok, false, 'campo inválido bloqueia');

    const somaExata = await linhaComTotal('0,3');
    somaExata.definirQuantidadeProduto(ids.chocolate, '0,1');
    somaExata.definirQuantidadeProduto(ids.morango, '0,2');
    assert.equal(somaExata.resumoDistribuicao().restante, 0, '0,1 + 0,2 fecha exatamente 0,3');
    assert.equal(somaExata.concluirDistribuicao().ok, true);
  });

  it('8. o produto_id é preservado (identidade não é nome nem posição)', async () => {
    const vendaPorLinha = await linhaComTotal('100');
    assert.deepEqual(vendaPorLinha.produtosParaDistribuir().map((p) => p.id), [ids.chocolate, ids.morango]);
    for (const estranho of [ids.uva, ids.avulso, 999999, 'Chocolate', 0, -1, null]) {
      const r = vendaPorLinha.definirQuantidadeProduto(estranho, '10');
      assert.equal(r.ok, false, `produto ${estranho} fora da Linha`);
    }
    vendaPorLinha.definirQuantidadeProduto(String(ids.morango), '70');
    vendaPorLinha.definirQuantidadeProduto(ids.chocolate, '30');
    const { distribuicao } = vendaPorLinha.obterDistribuicao();
    assert.deepEqual(distribuicao, [{ produto_id: ids.chocolate, quantidade: 30 }, { produto_id: ids.morango, quantidade: 70 }]);
    assert.ok(distribuicao.every((item) => Object.keys(item).join() === 'produto_id,quantidade'), 'só produto_id e quantidade');

    vendaPorLinha.marcarProduto(ids.morango, true);
    assert.deepEqual(vendaPorLinha.produtosParaDistribuir().map((p) => p.id), [ids.morango], 'com marcação, só os marcados');
    assert.deepEqual(vendaPorLinha.obterDistribuicao().distribuicao, [{ produto_id: ids.morango, quantidade: 70 }], 'desmarcado sai da distribuição');
    vendaPorLinha.marcarProduto(ids.morango, false);
    assert.equal(vendaPorLinha.produtosParaDistribuir().length, 2, 'sem marcação, todos os produtos da Linha');
  });

  it('9. renomear um produto não altera a identidade da distribuição', async () => {
    const vendaPorLinha = await linhaComTotal('100');
    vendaPorLinha.definirQuantidadeProduto(ids.chocolate, '30');
    vendaPorLinha.definirQuantidadeProduto(ids.morango, '70');
    await run('UPDATE produtos SET nome = ? WHERE id = ?', ['Chocolate Belga', ids.chocolate]);
    try {
      assert.deepEqual(vendaPorLinha.concluirDistribuicao().distribuicao.distribuicao, [
        { produto_id: ids.chocolate, quantidade: 30 }, { produto_id: ids.morango, quantidade: 70 }
      ]);
      const recarregada = await linhaComTotal('100');
      const chocolate = recarregada.produtosParaDistribuir().find((p) => p.id === ids.chocolate);
      assert.equal(chocolate.nome, 'Chocolate Belga', 'o nome é só exibição');
      assert.equal(recarregada.definirQuantidadeProduto(ids.chocolate, '100').ok, true);
      assert.deepEqual(recarregada.obterDistribuicao().distribuicao, [{ produto_id: ids.chocolate, quantidade: 100 }]);
    } finally {
      await run('UPDATE produtos SET nome = ? WHERE id = ?', ['Chocolate', ids.chocolate]);
    }
  });

  it('10. Voltar preserva os valores distribuídos', async () => {
    const vendaPorLinha = await linhaComTotal('100');
    vendaPorLinha.definirQuantidadeProduto(ids.chocolate, '30');
    vendaPorLinha.definirQuantidadeProduto(ids.morango, 'abc');
    assert.equal(vendaPorLinha.valorDoCampo(ids.chocolate), '30');
    assert.equal(vendaPorLinha.valorDoCampo(ids.morango), 'abc');
    const selecao = vendaPorLinha.obterSelecao();
    assert.deepEqual(selecao.quantidades, { [ids.chocolate]: 30 });
    selecao.quantidades[ids.chocolate] = 99;
    assert.equal(vendaPorLinha.resumoDistribuicao().distribuido, 30, 'a cópia não altera o estado');

    vendaPorLinha.definirQuantidadeTotal('100');
    assert.equal(vendaPorLinha.valorDoCampo(ids.chocolate), '30', 'reconfirmar o total mantém a distribuição');
    vendaPorLinha.definirQuantidadeProduto(ids.morango, '70');
    assert.equal(vendaPorLinha.concluirDistribuicao().ok, true);
  });

  it('11. Fechar descarta todo o fluxo temporário', async () => {
    const vendaPorLinha = await linhaComTotal('100');
    vendaPorLinha.definirQuantidadeProduto(ids.chocolate, '100');
    vendaPorLinha.concluirDistribuicao();
    vendaPorLinha.limpar();
    assert.equal(vendaPorLinha.obterSelecao(), null);
    assert.equal(vendaPorLinha.obterDistribuicao(), null);
    assert.equal(vendaPorLinha.resumoDistribuicao(), null);
    assert.equal(vendaPorLinha.definirQuantidadeProduto(ids.chocolate, '10').ok, false);
  });

  it('12, 13 e 14. nada é gravado no banco: nenhuma venda e nenhum movimento de estoque', async () => {
    const antes = await contagens();

    const desktop = await desktopNaDistribuicao();
    desktop.digitar(ids.chocolate, '30');
    desktop.digitar(ids.morango, '70');
    assert.deepEqual(Array.from(desktop.w.carrinho), []);

    const mobile = await mobileNaDistribuicao('100');
    mobile.digitar(ids.chocolate, '30');
    mobile.digitar(ids.morango, '70');
    mobile.continuar.click();
    assert.match(mobile.corpo().textContent, /Distribuição concluída\./);
    assert.deepEqual(mobile.w.toasts, []);

    assert.deepEqual(await contagens(), antes);

    const codigoModulo = fs.readFileSync(CAMINHO_VENDA_LINHA, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(codigoModulo, /carrinho|cart|preco|estoque|post\(|fetch\(|localStorage|sessionStorage|CDSApi|vendas?_?itens/i);
    const fluxoDesktop = extrairFuncao(fonteDesktop, 'abrirVendaPorLinhaPdv');
    assert.match(fluxoDesktop, /adicionarDistribuicaoLinhaNoCarrinhoPdv/);
    assert.doesNotMatch(fluxoDesktop, /adicionarItemNoCarrinho|atualizarCarrinho|method:\s*'POST'|\$\.ajax|\$\.post|localStorage/i);
    const fluxoMobile = extrairFuncao(fonteMobile, 'abrirVendaPorLinhaMobile')
      .replace(/const adicionarAoCarrinho = [\s\S]*?\n\s*\};\n/, '')
      .replace(/Adicionar ao carrinho|adicionarAoCarrinho\(\)/g, '');
    assert.doesNotMatch(fluxoMobile, /saveCart|loadCart|paintCart|resolverPrecos|openPdvAddProdutoSheet|CDSApi\.(post|put|patch|del)|localStorage/);
  });

  it('15. Desktop: quantidade individual, soma, bloqueio de zero e botões', async () => {
    const { w, $, visivel, campo, digitar } = await desktopNaDistribuicao();
    assert.match($('#etapaProdutosLinhaPdv').text().replace(/\s+/g, ' '), /Linha selecionada: Picolé Cremoso/);
    assert.equal($('#quantidadeTotalLinhaPdv').length, 0);
    assert.equal($('#listaProdutosLinhaPdv input[type="checkbox"]').length, 0);
    assert.deepEqual(
      Array.from(w.document.querySelectorAll('[data-quantidade-produto-id]')).map((el) => el.value),
      ['', '']
    );
    assert.deepEqual(
      Array.from(w.document.querySelectorAll('[data-quantidade-produto-id]')).map((el) => el.placeholder),
      ['0', '0']
    );
    assert.equal($('#somaProdutosLinhaPdv').text(), '0');
    assert.ok(visivel('btnContinuarLinhaPdv'));
    assert.ok(visivel('btnVoltarLinhasPdv'));

    $('#btnContinuarLinhaPdv').trigger('click');
    assert.match($('#erroQuantidadeProdutosLinhaPdv').text(), /pelo menos um produto/);
    assert.ok(visivel('etapaProdutosLinhaPdv'), 'não continua com todas as quantidades em zero');
    assert.deepEqual(Array.from(w.carrinho), []);

    digitar(ids.chocolate, '2');
    digitar(ids.morango, '3');
    assert.equal($('#somaProdutosLinhaPdv').text(), '5', 'soma individual automaticamente');
    $('#btnVoltarLinhasPdv').trigger('click');
    assert.ok(visivel('etapaBuscaLinhaPdv'), 'Voltar retorna à busca de Linhas');

    w.bootstrap.Modal.getOrCreateInstance(w.document.getElementById('modalVendaPorLinhaPdv')).hide();
    assert.equal(w.PdvVendaPorLinha.obterSelecao(), null, 'Fechar descarta a seleção');
    assert.equal(w.document.getElementById('modalVendaPorLinhaPdv'), null);
  });

  it('16. Mobile: distribuir, validar, Voltar, Continuar e Fechar', async () => {
    const { w, doc, corpo, campo, digitar, continuar, voltar, erroProduto, erroGeral } = await mobileNaDistribuicao('100');
    const texto = () => corpo().textContent.replace(/\s+/g, ' ');
    assert.match(texto(), /Linha: Picolé Cremoso/);
    assert.match(texto(), /Quantidade total: 100/);
    assert.match(texto(), /Distribua a quantidade:/);
    assert.deepEqual(
      Array.from(corpo().querySelectorAll('[data-distribuir-produto-id]')).map((el) => Number(el.getAttribute('data-distribuir-produto-id'))),
      [ids.chocolate, ids.morango]
    );
    assert.equal(campo(ids.chocolate).getAttribute('inputmode'), 'decimal');
    assert.equal(doc.getElementById('pdv-linha-distribuido').textContent, '0');
    assert.equal(doc.getElementById('pdv-linha-restante').textContent, '100');
    assert.equal(continuar.style.display, '');
    assert.equal(voltar.style.display, '');

    digitar(ids.chocolate, '30');
    assert.equal(doc.getElementById('pdv-linha-distribuido').textContent, '30');
    assert.equal(doc.getElementById('pdv-linha-restante').textContent, '70');
    continuar.click();
    assert.equal(erroGeral().textContent, MSG_INCOMPLETA);
    assert.equal(erroGeral().style.display, '');

    digitar(ids.morango, '101');
    assert.equal(erroProduto(ids.morango).textContent, MSG_EXCEDIDA);
    assert.equal(erroProduto(ids.morango).style.display, '');
    assert.equal(doc.getElementById('pdv-linha-distribuido').textContent, '30');
    continuar.click();
    assert.equal(erroGeral().textContent, MSG_EXCEDIDA);

    digitar(ids.morango, '1e3');
    assert.equal(erroProduto(ids.morango).textContent, MSG_INVALIDA);
    digitar(ids.morango, '70');
    assert.equal(erroProduto(ids.morango).style.display, 'none');
    assert.equal(doc.getElementById('pdv-linha-restante').textContent, '0');

    continuar.click();
    assert.match(texto(), /Chocolate: 30\s*Morango: 70/);
    assert.match(texto(), /Distribuição concluída\./);
    assert.equal(continuar.textContent, 'Adicionar ao carrinho', 'concluir não adiciona sozinho');
    assert.deepEqual(json(w.PdvVendaPorLinha.obterDistribuicao().distribuicao), [
      { produto_id: ids.chocolate, quantidade: 30 }, { produto_id: ids.morango, quantidade: 70 }
    ]);

    voltar.click();
    assert.equal(campo(ids.chocolate).value, '30', 'Voltar retorna à distribuição mantendo os valores');
    assert.equal(campo(ids.morango).value, '70');
    voltar.click();
    assert.equal(doc.getElementById('f-linha_quantidade_total').value, '100', 'Voltar retorna à quantidade total');
    continuar.click();
    assert.equal(campo(ids.chocolate).value, '30', 'ida e volta preserva a distribuição');
    assert.equal(campo(ids.morango).value, '70');

    doc.querySelector('#cds-mobile-sheet [data-sheet-close]').click();
    assert.equal(w.PdvVendaPorLinha.obterSelecao(), null, 'Fechar descarta tudo');
  });

  it('17. a venda tradicional por produto continua funcionando', async () => {
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
});
