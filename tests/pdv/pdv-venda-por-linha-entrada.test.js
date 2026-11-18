/**
 * LINHA DE PRODUTOS 03 — Entrada da venda por Linha no PDV (Desktop e Mobile).
 * A opção "Vender por Linha" só aparece com permitirVendaPorLinha ligado; a busca usa
 * linhas_produtos; a seleção guarda o id da linha e mostra os produtos vendáveis dela.
 * Selecionar não adiciona item ao carrinho, não calcula preço e não mexe em estoque.
 * Executar: npm run test:pdv-venda-linha
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const http = require('http');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const TMP = path.resolve(os.tmpdir()).toLowerCase();
if (!process.env.DB_DIR || !path.resolve(process.env.DB_DIR).toLowerCase().startsWith(TMP)) {
  console.error('Banco isolado ausente. Execute: node -r ./tests/pdv/_bancoIsolado.js --test tests/pdv/pdv-venda-por-linha-entrada.test.js');
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
const CAMINHO_COMERCIALIZACAO = path.join(RAIZ, 'frontend', 'shared', 'js', 'pdvComercializacao.js');
const CAMINHO_VENDA_LINHA = path.join(RAIZ, 'frontend', 'shared', 'js', 'pdvVendaPorLinha.js');
const fonteDesktop = fs.readFileSync(path.join(RAIZ, 'frontend', 'pdv', 'js', 'pdv.js'), 'utf8');
const fonteMobile = fs.readFileSync(path.join(RAIZ, 'frontend', 'apps', 'mobile', 'js', 'pages', 'pdv.js'), 'utf8');
const fonteTelaDesktop = fs.readFileSync(path.join(RAIZ, 'frontend', 'pdv', 'pages', 'pdv.html'), 'utf8');
const fonteModulo = fs.readFileSync(CAMINHO_VENDA_LINHA, 'utf8');

const ids = {};
let servidor;
let base;
let perfilRequisicao = 'OPERADOR';

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

async function api(method, rota, body, perfil = perfilRequisicao) {
  const anterior = perfilRequisicao;
  perfilRequisicao = perfil;
  try {
    const resposta = await fetch(base + rota, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: resposta.status, body: await resposta.json().catch(() => null) };
  } finally {
    perfilRequisicao = anterior;
  }
}

/** GET relativo a /api como fazem os PDVs (consultarApiPdv / CDSApi.get). */
async function consultar(caminho) {
  const resposta = await fetch(`${base}/${caminho}`);
  const corpo = await resposta.json().catch(() => null);
  if (!resposta.ok) throw Object.assign(new Error((corpo && corpo.error) || `HTTP ${resposta.status}`), { status: resposta.status, corpo });
  return corpo;
}

function moduloNovo(caminho) {
  delete require.cache[require.resolve(caminho)];
  return require(caminho);
}

async function configurar(produto, linha) {
  const r = await api('PUT', '/configuracoes-avancadas/comercializacao', { permitirVendaPorProduto: produto, permitirVendaPorLinha: linha }, 'SUPER_ADMIN');
  assert.equal(r.status, 200);
  const comercializacao = moduloNovo(CAMINHO_COMERCIALIZACAO);
  await comercializacao.carregar(consultar);
  return { comercializacao, vendaPorLinha: moduloNovo(CAMINHO_VENDA_LINHA) };
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

/** Executa a função real que mostra/esconde o botão no Desktop; devolve se o botão ficou visível. */
function botaoDesktopVisivel(modulos) {
  const classes = new Set(['pdv-btn-vender-linha', 'd-none']);
  const botao = { classList: { toggle: (classe, ligar) => (ligar ? classes.add(classe) : classes.delete(classe)) } };
  const contexto = vm.createContext({
    window: { PdvComercializacao: modulos.comercializacao, PdvVendaPorLinha: modulos.vendaPorLinha },
    document: { getElementById: (id) => (id === 'btnVenderPorLinhaPdv' ? botao : null) }
  });
  vm.runInContext(extrairFuncao(fonteDesktop, 'atualizarOpcaoVendaPorLinhaPdv'), contexto);
  contexto.atualizarOpcaoVendaPorLinhaPdv();
  return !classes.has('d-none');
}

/** Executa a função real que mostra/esconde o botão no Mobile; devolve se o botão ficou visível. */
function botaoMobileVisivel(modulos) {
  const botao = { style: { display: 'none' } };
  const contexto = vm.createContext({
    window: { PdvComercializacao: modulos.comercializacao, PdvVendaPorLinha: modulos.vendaPorLinha }
  });
  vm.runInContext(extrairFuncao(fonteMobile, 'atualizarOpcaoVendaPorLinhaMobile'), contexto);
  contexto.atualizarOpcaoVendaPorLinhaMobile({ querySelector: (sel) => (sel === '#pdv-venda-linha' ? botao : null) });
  return botao.style.display !== 'none';
}

async function inserirProduto(dados) {
  const p = { ativo: 1, natureza_cadastro: 'PRODUZIDO', item_fiscal: 1, linha: null, ...dados };
  return (await run(`INSERT INTO produtos (codigo, nome, unidade, preco_venda, ativo, natureza_cadastro, item_fiscal, linha_produtos_id, estoque_atual, saldo_nao_fiscal, saldo_fiscal)
    VALUES (?, ?, 'UN', 2, ?, ?, ?, ?, 50, 50, 0)`, [p.codigo, p.nome, p.ativo, p.natureza_cadastro, p.item_fiscal, p.linha])).id;
}

async function contagens() {
  return {
    vendas: (await get('SELECT COUNT(*) AS q FROM vendas')).q,
    itens: (await get('SELECT COUNT(*) AS q FROM vendas_itens')).q,
    movimentos: (await get('SELECT COUNT(*) AS q FROM estoque_movimentacoes')).q,
    estoque: (await get('SELECT SUM(estoque_atual) AS q FROM produtos')).q,
    produtos: (await get('SELECT COUNT(*) AS q FROM produtos')).q
  };
}

before(async () => {
  assert.ok(path.resolve(db.dbPath).toLowerCase().startsWith(TMP), `banco fora do temp: ${db.dbPath}`);
  await new Promise((resolve) => db.whenReady(() => resolve()));
  await bootstrapLinhasProdutos(db);

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = { id: 1, perfil: perfilRequisicao }; next(); });
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
  ids.antiga = await criarLinha('ANT', 'Linha Antiga');
  assert.equal((await api('POST', `/fabrica-loja/linhas-produtos/${ids.antiga}/desativar`, {}, 'SUPER_ADMIN')).status, 200);

  ids.chocolate = await inserirProduto({ codigo: 'PC-CHOC', nome: 'Chocolate', linha: ids.cremoso });
  ids.morango = await inserirProduto({ codigo: 'PC-MOR', nome: 'Morango', linha: ids.cremoso });
  ids.semFiscal = await inserirProduto({ codigo: 'PC-BISC', nome: 'Biscoito', linha: ids.cremoso, item_fiscal: 0 });
  ids.abacaxiInativo = await inserirProduto({ codigo: 'PC-ABAC', nome: 'Abacaxi', linha: ids.cremoso, ativo: 0 });
  ids.insumo = await inserirProduto({ codigo: 'INS-LEITE', nome: 'Leite em pó', linha: ids.cremoso, natureza_cadastro: 'INSUMO' });
  ids.uva = await inserirProduto({ codigo: 'FL-UVA', nome: 'Uva', linha: ids.frutaLeite });
  ids.avulso = await inserirProduto({ codigo: 'PIC-AVULSO', nome: 'Picolé Avulso' });
  ids.produtoLinhaAntiga = await inserirProduto({ codigo: 'ANT-1', nome: 'Sabor Antigo', linha: ids.antiga });
});

after(async () => {
  fs.rmSync(DIR_CONFIG, { recursive: true, force: true });
  if (servidor) await new Promise((resolve) => servidor.close(resolve));
  await new Promise((resolve) => db.close(() => resolve()));
});

describe('PDV — entrada da venda por Linha', () => {
  it('1. permitirVendaPorLinha=false → a opção não aparece (Desktop e Mobile) e a API recusa', async () => {
    assert.match(fonteTelaDesktop, /id="btnVenderPorLinhaPdv" class="[^"]*\bd-none\b/, 'Desktop: botão começa escondido');
    assert.match(fonteMobile, /id="pdv-venda-linha" style="display:none/, 'Mobile: botão começa escondido');
    for (const produto of [true, false]) {
      const modulos = await configurar(produto, false);
      assert.equal(modulos.vendaPorLinha.opcaoVisivel(modulos.comercializacao), false);
      assert.equal(botaoDesktopVisivel(modulos), false, `Desktop com produto=${produto}`);
      assert.equal(botaoMobileVisivel(modulos), false, `Mobile com produto=${produto}`);
    }
    for (const rota of ['/produtos/consulta-pdv/linhas', `/produtos/consulta-pdv/linhas/${ids.cremoso}/produtos`]) {
      const r = await api('GET', rota);
      assert.equal(r.status, 403, rota);
      assert.equal(r.body.codigo, 'VENDA_POR_LINHA_DESABILITADA');
    }
    const semModulo = { comercializacao: undefined, vendaPorLinha: moduloNovo(CAMINHO_VENDA_LINHA) };
    assert.equal(botaoDesktopVisivel(semModulo), false, 'sem a configuração carregada a opção fica escondida');
  });

  it('2. permitirVendaPorLinha=true → a opção aparece (Desktop e Mobile), com ou sem venda por produto', async () => {
    for (const produto of [true, false]) {
      const modulos = await configurar(produto, true);
      assert.equal(modulos.vendaPorLinha.opcaoVisivel(modulos.comercializacao), true);
      assert.equal(botaoDesktopVisivel(modulos), true, `Desktop com produto=${produto}`);
      assert.equal(botaoMobileVisivel(modulos), true, `Mobile com produto=${produto}`);
    }
    assert.match(fonteTelaDesktop, />\s*<i class="fas fa-layer-group"><\/i> Vender por Linha\s*</);
    assert.match(fonteMobile, />\s*Vender por Linha\s*</);
  });

  it('3. a pesquisa retorna as linhas cadastradas (ativas), por nome ou código', async () => {
    const { vendaPorLinha } = await configurar(true, true);
    const todas = await vendaPorLinha.buscarLinhas(consultar, '');
    assert.deepEqual(todas.map((l) => l.nome), ['Especial', 'Fruta ao Leite', 'Picolé Cremoso']);
    assert.deepEqual(todas.find((l) => l.id === ids.cremoso), { id: ids.cremoso, nome: 'Picolé Cremoso', codigo: 'CREM' });
    assert.deepEqual((await vendaPorLinha.buscarLinhas(consultar, 'crem')).map((l) => l.id), [ids.cremoso]);
    assert.deepEqual((await vendaPorLinha.buscarLinhas(consultar, 'FLEITE')).map((l) => l.id), [ids.frutaLeite]);
    assert.deepEqual(await vendaPorLinha.buscarLinhas(consultar, 'nada-parecido'), []);
    const bruto = await api('GET', '/produtos/consulta-pdv/linhas');
    assert.deepEqual(Object.keys(bruto.body[0]).sort(), ['codigo', 'id', 'nome']);
  });

  it('4. a seleção usa o id da Linha (não o nome)', async () => {
    const { vendaPorLinha } = await configurar(true, true);
    const pedidos = [];
    const registrar = (caminho) => { pedidos.push(caminho); return consultar(caminho); };

    const selecao = await vendaPorLinha.selecionarLinha(registrar, ids.cremoso);
    assert.equal(selecao.linhaProdutosId, ids.cremoso);
    assert.equal(selecao.nome, 'Picolé Cremoso');
    assert.deepEqual(pedidos, [`produtos/consulta-pdv/linhas/${ids.cremoso}/produtos`]);
    assert.deepEqual(vendaPorLinha.obterSelecao().linhaProdutosId, ids.cremoso);

    const renomear = await api('PUT', `/fabrica-loja/linhas-produtos/${ids.cremoso}`, { codigo: 'CREM', nome: 'Cremoso Renomeado' }, 'SUPER_ADMIN');
    assert.ok(renomear.status < 300, JSON.stringify(renomear.body));
    try {
      const aposRenomear = await vendaPorLinha.selecionarLinha(consultar, ids.cremoso);
      assert.equal(aposRenomear.linhaProdutosId, ids.cremoso);
      assert.equal(aposRenomear.nome, 'Cremoso Renomeado');
      assert.deepEqual(aposRenomear.produtos.map((p) => p.id), selecao.produtos.map((p) => p.id));
    } finally {
      await api('PUT', `/fabrica-loja/linhas-produtos/${ids.cremoso}`, { codigo: 'CREM', nome: 'Picolé Cremoso' }, 'SUPER_ADMIN');
    }

    pedidos.length = 0;
    await assert.rejects(vendaPorLinha.selecionarLinha(registrar, 'Picolé Cremoso'), /Linha de Produtos inválida/);
    assert.deepEqual(pedidos, [], 'o nome não vira consulta');
    await assert.rejects(vendaPorLinha.selecionarLinha(consultar, ids.antiga), /não encontrada/, 'linha inativa não é selecionável');
    assert.equal((await api('GET', '/produtos/consulta-pdv/linhas/999999/produtos')).status, 404);
  });

  it('5. linha sem produtos → mensagem controlada', async () => {
    const { vendaPorLinha } = await configurar(true, true);
    const selecao = await vendaPorLinha.selecionarLinha(consultar, ids.especial);
    assert.equal(selecao.linhaProdutosId, ids.especial);
    assert.deepEqual(selecao.produtos, []);
    assert.equal(selecao.mensagem, 'Esta linha não tem produtos disponíveis para venda.');
    const bruto = await api('GET', `/produtos/consulta-pdv/linhas/${ids.especial}/produtos`);
    assert.equal(bruto.status, 200);
    assert.equal(bruto.body.mensagem, 'Esta linha não tem produtos disponíveis para venda.');
  });

  it('6. produtos inativos não aparecem', async () => {
    const { vendaPorLinha } = await configurar(true, true);
    const selecao = await vendaPorLinha.selecionarLinha(consultar, ids.cremoso);
    assert.ok(!selecao.produtos.some((p) => p.id === ids.abacaxiInativo));
    assert.deepEqual(vendaPorLinha.normalizarProdutos([{ id: 9, nome: 'X', ativo: 0 }]), []);
  });

  it('7. INSUMOS não aparecem', async () => {
    const { vendaPorLinha } = await configurar(true, true);
    const selecao = await vendaPorLinha.selecionarLinha(consultar, ids.cremoso);
    assert.ok(!selecao.produtos.some((p) => p.id === ids.insumo));
    assert.deepEqual(vendaPorLinha.normalizarProdutos([{ id: 9, nome: 'X', natureza_cadastro: 'insumo' }]), []);
  });

  it('8. produto de outra linha (ou sem linha) não aparece', async () => {
    const { vendaPorLinha } = await configurar(true, true);
    const cremoso = await vendaPorLinha.selecionarLinha(consultar, ids.cremoso);
    assert.deepEqual(cremoso.produtos.map((p) => p.nome), ['Biscoito', 'Chocolate', 'Morango']);
    assert.ok(!cremoso.produtos.some((p) => [ids.uva, ids.avulso].includes(p.id)));
    const frutaLeite = await vendaPorLinha.selecionarLinha(consultar, ids.frutaLeite);
    assert.deepEqual(frutaLeite.produtos.map((p) => p.id), [ids.uva]);
    const fiscal = await vendaPorLinha.selecionarLinha(consultar, ids.cremoso, { modoFiscal: '1' });
    assert.deepEqual(fiscal.produtos.map((p) => p.nome), ['Chocolate', 'Morango'], 'no modo fiscal segue o mesmo filtro da busca de produto');
    const bruto = await api('GET', `/produtos/consulta-pdv/linhas/${ids.cremoso}/produtos`);
    assert.deepEqual(Object.keys(bruto.body.produtos[0]).sort(), ['codigo', 'id', 'nome', 'unidade'], 'sem preço nem estoque');
  });

  it('9. a venda tradicional por produto continua funcionando', async () => {
    const VendaPagamentoService = require('../../backend/services/vendas/VendaPagamentoService');
    for (const linha of [false, true]) {
      await configurar(true, linha);
      const busca = await api('GET', '/produtos/consulta-pdv/buscar?q=PIC-AVULSO&modo_fiscal=0');
      assert.equal(busca.body[0].id, ids.avulso, `busca com linha=${linha}`);
      const buscaLinha = await api('GET', '/produtos/consulta-pdv/buscar?q=PC-CHOC&modo_fiscal=0');
      assert.equal(buscaLinha.body[0].id, ids.chocolate, 'produto de uma linha continua vendável sozinho');
    }
    const antes = (await get('SELECT estoque_atual FROM produtos WHERE id = ?', [ids.chocolate])).estoque_atual;
    const resposta = await new Promise((resolve) => {
      const res = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(payload) { resolve({ status: this.statusCode, body: payload }); return this; }
      };
      VendaPagamentoService.criarVenda({
        body: {
          total: 2, forma_pagamento: 'dinheiro', valor_recebido: 2, emitir_fiscal: false, origem_pdv: 'PDV_DESKTOP',
          itens: [{ produto_id: ids.chocolate, quantidade: 1, preco_unitario: 2, subtotal: 2 }],
          pagamentos: [{ forma: 'dinheiro', valor: 2 }]
        },
        headers: {}, query: {}, user: { id: 1 }
      }, res);
    });
    assert.ok(resposta.status < 300, `status ${resposta.status}: ${JSON.stringify(resposta.body)}`);
    assert.deepEqual(await get('SELECT produto_id, quantidade FROM vendas_itens ORDER BY id DESC LIMIT 1'), { produto_id: ids.chocolate, quantidade: 1 });
    assert.equal((await get('SELECT estoque_atual FROM produtos WHERE id = ?', [ids.chocolate])).estoque_atual, antes - 1);
  });

  it('10. selecionar a Linha não adiciona item ao carrinho nem mexe em venda, preço ou estoque', async () => {
    const { vendaPorLinha } = await configurar(true, true);
    const antes = await contagens();
    const pedidos = [];
    const registrar = (caminho) => { pedidos.push(caminho); return consultar(caminho); };

    await vendaPorLinha.buscarLinhas(registrar, '');
    const selecao = await vendaPorLinha.selecionarLinha(registrar, ids.cremoso);
    vendaPorLinha.marcarProduto(ids.chocolate, true);
    vendaPorLinha.marcarProduto(ids.morango, true);
    vendaPorLinha.marcarProduto(ids.uva, true);
    vendaPorLinha.marcarProduto(ids.morango, false);
    assert.deepEqual(vendaPorLinha.obterSelecao().marcados, [ids.chocolate], 'só marca produtos da própria linha');
    assert.equal(selecao.marcados.length, 0, 'a seleção devolvida é uma cópia');
    vendaPorLinha.limpar();
    assert.equal(vendaPorLinha.obterSelecao(), null);

    assert.ok(pedidos.every((p) => p.startsWith('produtos/consulta-pdv/linhas')), pedidos.join(', '));
    assert.deepEqual(await contagens(), antes);

    const codigoModulo = fonteModulo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(codigoModulo, /carrinho|cart|preco|estoque|post\(|fetch\(|localStorage|sessionStorage|CDSApi/i,
      'o módulo da Linha só consulta pelo GET recebido e não conhece carrinho, preço nem estoque');
    const semPonteCarrinho = (fonte) => fonte
      .replace(/const adicionarAoCarrinho = [\s\S]*?\n\s*\};\n/, '')
      .replace(/Adicionar ao carrinho|adicionarAoCarrinho\(\)/g, '');
    const desktop = ['atualizarOpcaoVendaPorLinhaPdv', 'abrirVendaPorLinhaPdv'].map((n) => extrairFuncao(fonteDesktop, n)).join('\n');
    assert.match(desktop, /adicionarDistribuicaoLinhaNoCarrinhoPdv/, 'Continuar reutiliza a integração comercial atual');
    assert.doesNotMatch(desktop, /adicionarItemNoCarrinho|adicionarProduto|atualizarCarrinho|Rascunho|method:\s*'POST'|\$\.ajax|\$\.post/i);
    const mobile = semPonteCarrinho(['atualizarOpcaoVendaPorLinhaMobile', 'bindVendaPorLinhaMobile', 'abrirVendaPorLinhaMobile'].map((n) => extrairFuncao(fonteMobile, n)).join('\n'));
    assert.doesNotMatch(mobile, /saveCart|loadCart|paintCart|resolverPrecos|openPdvAddProdutoSheet|CDSApi\.(post|put|patch|del)/);
  });
});
