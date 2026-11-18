/**
 * LINHA DE PRODUTOS 01 — Comercialização (Configurações → Avançado):
 * permitirVendaPorLinha / permitirVendaPorProduto, globais da empresa, gravadas em
 * configuracoes.json da pasta de dados. Linha continua só agrupando produtos; a venda,
 * o estoque e o preço continuam no produto. Venda por Linha no PDV ainda não existe.
 * Banco e pasta de dados temporários via tests/pdv/_bancoIsolado.js.
 * Executar: npm run test:comercializacao
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const TMP = path.resolve(os.tmpdir()).toLowerCase();
const DB_DIR = path.resolve(String(process.env.DB_DIR || '')).toLowerCase();
if (!process.env.DB_DIR || !DB_DIR.startsWith(TMP)) {
  console.error('Banco isolado ausente. Execute: node -r ./tests/pdv/_bancoIsolado.js --test tests/configuracoes/comercializacao-config.test.js');
  process.exit(1);
}
const DIR_EMPRESA = process.env.DB_DIR;
const DIR_OUTRA_EMPRESA = path.join(os.tmpdir(), 'cds-pdv-testes', 'outra-empresa');
for (const sufixo of ['', '-wal', '-shm']) {
  fs.rmSync(path.join(DIR_EMPRESA, 'mercadao.db' + sufixo), { force: true });
}
fs.rmSync(path.join(DIR_EMPRESA, 'config'), { recursive: true, force: true });
fs.rmSync(DIR_OUTRA_EMPRESA, { recursive: true, force: true });

const express = require('express');
const db = require('../../backend/database');
const bootstrapLinhasProdutos = require('../../backend/modules/fabrica-loja/migrations/010_linhas_produtos');
const {
  MENSAGEM_PRODUTO_INSUMO_PDV,
  CODIGO_PRODUTO_INSUMO_PDV
} = require('../../backend/services/pdv/produtoComercializavelPdv');

const CAMINHO_CONFIG = require.resolve('../../backend/services/configuracaoService');
const CAMINHO_COMERCIALIZACAO = require.resolve('../../backend/services/comercializacaoConfigService');

function carregarServicos() {
  delete require.cache[CAMINHO_COMERCIALIZACAO];
  delete require.cache[CAMINHO_CONFIG];
  return {
    config: require(CAMINHO_CONFIG),
    comercializacao: require(CAMINHO_COMERCIALIZACAO)
  };
}

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
function all(sql, params = []) {
  return new Promise((resolve, reject) => db.all(sql, params, (e, r) => (e ? reject(e) : resolve(r || []))));
}
const hash = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');

const ids = {};
let servidor;
let base;
let perfilRequisicao = 'SUPER_ADMIN';

async function api(method, rota, body) {
  const resposta = await fetch(base + rota, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: resposta.status, body: await resposta.json().catch(() => null) };
}

function chamarServico(fn, body) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); return this; }
    };
    fn({ body, headers: {}, query: {}, user: { id: 1 } }, res);
  });
}

function corpoVenda(produtoId, quantidade = 1) {
  return {
    total: 2 * quantidade,
    forma_pagamento: 'dinheiro',
    itens: [{ produto_id: produtoId, quantidade, preco_unitario: 2, subtotal: 2 * quantidade }],
    pagamentos: [{ forma: 'dinheiro', valor: 2 * quantidade }],
    valor_recebido: 2 * quantidade,
    emitir_fiscal: false,
    origem_pdv: 'PDV_DESKTOP'
  };
}

async function salvar(linha, produto) {
  return api('PUT', '/configuracoes-avancadas/comercializacao', { permitirVendaPorLinha: linha, permitirVendaPorProduto: produto });
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
});

after(async () => {
  process.env.DB_DIR = DIR_EMPRESA;
  fs.rmSync(path.join(DIR_EMPRESA, 'config'), { recursive: true, force: true });
  fs.rmSync(DIR_OUTRA_EMPRESA, { recursive: true, force: true });
  if (servidor) await new Promise((resolve) => servidor.close(resolve));
  await new Promise((resolve) => db.close(() => resolve()));
});

describe('Configuração de comercialização', () => {
  it('1. padrão: venda por Linha = NÃO, venda por Produto = SIM', async () => {
    const { comercializacao } = carregarServicos();
    assert.deepEqual(comercializacao.obterComercializacao(), { permitirVendaPorLinha: false, permitirVendaPorProduto: true });
    assert.equal(comercializacao.isVendaPorLinhaPermitida(), false);
    assert.equal(comercializacao.isVendaPorProdutoPermitida(), true);
    const r = await api('GET', '/configuracoes-avancadas/comercializacao');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { permitirVendaPorLinha: false, permitirVendaPorProduto: true, aviso: null });
  });

  it('1. arquivo de configuração antigo (sem a seção) assume o padrão e preserva o resto', async () => {
    const { config, comercializacao } = carregarServicos();
    const antigo = { ...config.readConfig(), tipoImplantacao: 'ERP_FISCAL', cfop_padrao: '5405' };
    delete antigo.comercializacao;
    fs.writeFileSync(config.getConfigPath(), JSON.stringify(antigo, null, 2), 'utf8');
    assert.deepEqual(comercializacao.obterComercializacao(), { permitirVendaPorLinha: false, permitirVendaPorProduto: true });
    await salvar(true, true);
    const gravado = JSON.parse(fs.readFileSync(config.getConfigPath(), 'utf8'));
    assert.equal(gravado.tipoImplantacao, 'ERP_FISCAL');
    assert.equal(gravado.cfop_padrao, '5405');
  });

  for (const [numero, linha, produto] of [['2', true, true], ['3', true, false], ['4', false, true], ['5', false, false]]) {
    it(`${numero}. salvar Linha = ${linha ? 'SIM' : 'NÃO'} / Produto = ${produto ? 'SIM' : 'NÃO'}`, async () => {
      const r = await salvar(linha, produto);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.comercializacao.permitirVendaPorLinha, linha);
      assert.equal(r.body.comercializacao.permitirVendaPorProduto, produto);
      const lido = (await api('GET', '/configuracoes-avancadas/comercializacao')).body;
      assert.equal(lido.permitirVendaPorLinha, linha);
      assert.equal(lido.permitirVendaPorProduto, produto);
      assert.equal(lido.aviso, !linha && !produto ? 'Nenhuma forma de venda está habilitada.' : null);
      const { comercializacao } = carregarServicos();
      assert.equal(comercializacao.isVendaPorLinhaPermitida(), linha);
      assert.equal(comercializacao.isVendaPorProdutoPermitida(), produto);
      assert.equal(comercializacao.nenhumaFormaDeVendaHabilitada(), !linha && !produto);
    });
  }

  it('as duas chaves são independentes: gravar uma não muda a outra', async () => {
    await salvar(false, true);
    await api('PUT', '/configuracoes-avancadas/comercializacao', { permitirVendaPorLinha: true });
    let lido = (await api('GET', '/configuracoes-avancadas/comercializacao')).body;
    assert.deepEqual([lido.permitirVendaPorLinha, lido.permitirVendaPorProduto], [true, true]);
    await api('PUT', '/configuracoes-avancadas/comercializacao', { permitirVendaPorProduto: false });
    lido = (await api('GET', '/configuracoes-avancadas/comercializacao')).body;
    assert.deepEqual([lido.permitirVendaPorLinha, lido.permitirVendaPorProduto], [true, false]);
  });

  it('valor inválido é recusado e só SUPER_ADMIN grava', async () => {
    await salvar(false, true);
    const invalido = await api('PUT', '/configuracoes-avancadas/comercializacao', { permitirVendaPorLinha: 'talvez' });
    assert.equal(invalido.status, 400);
    perfilRequisicao = 'ADMIN';
    try {
      const negado = await salvar(true, false);
      assert.equal(negado.status, 403);
      const leitura = await api('GET', '/configuracoes-avancadas/comercializacao');
      assert.equal(leitura.status, 200);
    } finally {
      perfilRequisicao = 'SUPER_ADMIN';
    }
    const lido = (await api('GET', '/configuracoes-avancadas/comercializacao')).body;
    assert.deepEqual([lido.permitirVendaPorLinha, lido.permitirVendaPorProduto], [false, true]);
  });

  it('salvar as demais configurações avançadas não apaga a comercialização', async () => {
    await salvar(true, false);
    const { config } = carregarServicos();
    config.saveConfig({ ...config.readConfig(), midp_ativado: true });
    config.savePadraoFiscal({ cfop_padrao: '5102' });
    const r = await api('POST', '/configuracoes-avancadas', { tipoImplantacao: 'ERP_SEM_FISCAL', modoOperacao: 'LOCAL', porta: 3002 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.config.comercializacao, { permitirVendaPorLinha: true, permitirVendaPorProduto: false });
    const tela = (await api('GET', '/configuracoes-avancadas')).body;
    assert.deepEqual(tela.comercializacao, { permitirVendaPorLinha: true, permitirVendaPorProduto: false });
  });

  it('6. a configuração continua salva após reiniciar o contexto (módulos recarregados)', async () => {
    await salvar(true, false);
    const { config, comercializacao } = carregarServicos();
    assert.deepEqual(comercializacao.obterComercializacao(), { permitirVendaPorLinha: true, permitirVendaPorProduto: false });
    const arquivo = JSON.parse(fs.readFileSync(config.getConfigPath(), 'utf8'));
    assert.deepEqual(arquivo.comercializacao, { permitirVendaPorLinha: true, permitirVendaPorProduto: false });
    assert.equal(path.dirname(path.dirname(config.getConfigPath())).toLowerCase(), path.resolve(DIR_EMPRESA).toLowerCase());
  });

  it('7. a configuração é isolada por empresa (pasta de dados)', async () => {
    await salvar(true, false);
    process.env.DB_DIR = DIR_OUTRA_EMPRESA;
    try {
      let servicos = carregarServicos();
      assert.deepEqual(servicos.comercializacao.obterComercializacao(), { permitirVendaPorLinha: false, permitirVendaPorProduto: true });
      servicos.comercializacao.salvarComercializacao({ permitirVendaPorLinha: false, permitirVendaPorProduto: false });
      servicos = carregarServicos();
      assert.equal(servicos.comercializacao.nenhumaFormaDeVendaHabilitada(), true);
    } finally {
      process.env.DB_DIR = DIR_EMPRESA;
    }
    const { comercializacao } = carregarServicos();
    assert.deepEqual(comercializacao.obterComercializacao(), { permitirVendaPorLinha: true, permitirVendaPorProduto: false });
  });
});

describe('Linha continua só agrupando produtos', () => {
  let historicoAntes;
  let produtosAntes;

  before(async () => {
    await salvar(false, true);
    ids.linha = (await api('POST', '/fabrica-loja/linhas-produtos', { codigo: 'CREMOSA', nome: 'Cremosa' })).body.linha.id;
    const criado = await api('POST', '/produtos', {
      codigo: 'PIC-CHOC', nome: 'Picolé Chocolate', unidade: 'UN', preco_venda: 2,
      natureza_cadastro: 'PRODUZIDO', linha_produtos_id: ids.linha
    });
    assert.ok(criado.status < 300, JSON.stringify(criado.body));
    ids.chocolate = criado.body.id;
    await run('UPDATE produtos SET saldo_fiscal = 0, saldo_nao_fiscal = 50, estoque_atual = 50 WHERE id = ?', [ids.chocolate]);
    ids.insumo = (await run(`INSERT INTO produtos (codigo, nome, unidade, preco_venda, saldo_nao_fiscal, estoque_atual, ativo, natureza_cadastro)
      VALUES ('INS-LEITE', 'Leite em pó', 'KG', 10, 5, 5, 1, 'INSUMO')`)).id;

    const venda = await run(`INSERT INTO vendas (codigo, data_venda, total, status) VALUES ('V-HIST', '2026-09-01', 20, 'concluida')`);
    await run('INSERT INTO vendas_itens (venda_id, produto_id, quantidade, preco_unitario, subtotal) VALUES (?, ?, 10, 2, 20)', [venda.id, ids.chocolate]);
    ids.vendaHistorica = venda.id;
    historicoAntes = {
      vendas: hash(await all('SELECT * FROM vendas WHERE id <= ? ORDER BY id', [venda.id])),
      itens: hash(await all('SELECT * FROM vendas_itens WHERE venda_id <= ? ORDER BY id', [venda.id]))
    };
    produtosAntes = (await get('SELECT COUNT(*) AS q FROM produtos')).q;
  });

  it('8. a Linha de Produtos não tem estoque nem saldo', async () => {
    const colunas = (await all('PRAGMA table_info(linhas_produtos)')).map((c) => c.name);
    assert.ok(!colunas.some((c) => /estoque|saldo|produto_id|preco/i.test(c)), colunas.join(','));
    const tabelas = (await all(`SELECT name FROM sqlite_master WHERE type = 'table'`)).map((t) => t.name);
    for (const proibida of ['estoque_linhas', 'saldo_linha', 'estoque_por_linha']) assert.ok(!tabelas.includes(proibida), proibida);
    const lista = (await api('GET', '/fabrica-loja/linhas-produtos?incluir_inativas=1')).body.linhas;
    const linha = lista.find((l) => l.id === ids.linha);
    assert.deepEqual(Object.keys(linha).filter((k) => /estoque|saldo/i.test(k)), []);
    assert.equal(linha.quantidade_produtos, 1);
    const movimentos = await get(`SELECT COUNT(*) AS q FROM estoque_movimentacoes WHERE produto_id NOT IN (SELECT id FROM produtos)`);
    assert.equal(movimentos.q, 0);
  });

  it('9. o produto continua vinculado à Linha por ID (não por nome)', async () => {
    assert.equal((await get('SELECT linha_produtos_id FROM produtos WHERE id = ?', [ids.chocolate])).linha_produtos_id, ids.linha);
    const renomeada = await api('PUT', `/fabrica-loja/linhas-produtos/${ids.linha}`, { codigo: 'CREMOSA', nome: 'Linha Cremosa Renomeada' });
    assert.ok(renomeada.status < 300, JSON.stringify(renomeada.body));
    const detalhe = (await api('GET', `/fabrica-loja/linhas-produtos/${ids.linha}`)).body.linha;
    assert.deepEqual(detalhe.produtos.map((p) => p.id), [ids.chocolate]);
    assert.equal((await get('SELECT linha_produtos_id FROM produtos WHERE id = ?', [ids.chocolate])).linha_produtos_id, ids.linha);
  });

  it('10. o produto continua sendo o item físico da venda e do estoque', async () => {
    const VendaPagamentoService = require('../../backend/services/vendas/VendaPagamentoService');
    await salvar(true, true);
    const r = await chamarServico(VendaPagamentoService.criarVenda, corpoVenda(ids.chocolate, 3));
    assert.ok(r.status < 300, `status ${r.status}: ${JSON.stringify(r.body)}`);
    const item = await get('SELECT produto_id, quantidade FROM vendas_itens ORDER BY id DESC LIMIT 1');
    assert.deepEqual(item, { produto_id: ids.chocolate, quantidade: 3 });
    assert.equal((await get('SELECT estoque_atual FROM produtos WHERE id = ?', [ids.chocolate])).estoque_atual, 47);
  });

  it('11. o preço (RA-6) não muda com a configuração de comercialização', async () => {
    const Resolver = require('../../backend/modules/comercial/preco/ComercialPrecoResolver');
    const produto = await get('SELECT * FROM produtos WHERE id = ?', [ids.chocolate]);
    const precos = [];
    for (const [linha, prod] of [[false, true], [true, true], [true, false], [false, false]]) {
      await salvar(linha, prod);
      const r = await Resolver.resolver({ produto, canal: 'VAREJO' });
      precos.push([r.preco_venda, r.origem, r.tabela_preco_id ?? null, r.linha_comercial_id ?? null]);
    }
    assert.ok(precos.every((p) => JSON.stringify(p) === JSON.stringify(precos[0])), JSON.stringify(precos));
  });

  it('12. com só venda por produto, o PDV continua funcionando', async () => {
    await salvar(false, true);
    const VendaPagamentoService = require('../../backend/services/vendas/VendaPagamentoService');
    const busca = (await api('GET', '/produtos/consulta-pdv/buscar?q=PIC-CHOC&modo_fiscal=0')).body;
    assert.equal(busca[0].id, ids.chocolate);
    const vendasAntes = (await get('SELECT COUNT(*) AS n FROM vendas')).n;
    // vendas.codigo é gerado por segundo (VND-AAAAMMDDHHMMSS)
    await new Promise((ok) => setTimeout(ok, 1100));
    const r = await chamarServico(VendaPagamentoService.criarVenda, corpoVenda(ids.chocolate, 1));
    assert.ok(r.status < 300, `status ${r.status}: ${JSON.stringify(r.body)}`);
    assert.equal((await get('SELECT COUNT(*) AS n FROM vendas')).n, vendasAntes + 1);
  });

  it('13. INSUMO continua bloqueado no PDV (com ou sem venda por Linha)', async () => {
    const VendaPagamentoService = require('../../backend/services/vendas/VendaPagamentoService');
    for (const [linha, prod] of [[false, true], [true, true]]) {
      await salvar(linha, prod);
      const r = await chamarServico(VendaPagamentoService.criarVenda, corpoVenda(ids.insumo, 1));
      assert.equal(r.status, 409);
      assert.equal(r.body.codigo, CODIGO_PRODUTO_INSUMO_PDV);
      assert.equal(r.body.error, MENSAGEM_PRODUTO_INSUMO_PDV);
    }
    assert.deepEqual((await api('GET', '/produtos/consulta-pdv/buscar?q=INS-LEITE&modo_fiscal=0')).body, []);
  });

  it('14. nenhum produto-linha novo é criado', async () => {
    assert.equal((await get('SELECT COUNT(*) AS q FROM produtos')).q, produtosAntes);
    const comNomeDeLinha = await get(`SELECT COUNT(*) AS q FROM produtos WHERE UPPER(nome) LIKE '%LINHA%'`);
    assert.equal(comNomeDeLinha.q, 0);
  });

  it('15. nenhuma venda histórica é alterada', async () => {
    assert.deepEqual({
      vendas: hash(await all('SELECT * FROM vendas WHERE id <= ? ORDER BY id', [ids.vendaHistorica])),
      itens: hash(await all('SELECT * FROM vendas_itens WHERE venda_id <= ? ORDER BY id', [ids.vendaHistorica]))
    }, historicoAntes);
  });

  it('no PDV, só os módulos de leitura e da opção Vender por Linha conhecem a configuração', () => {
    const modulosPermitidos = ['pdvComercializacao.js', 'pdvVendaPorLinha.js']
      .map((nome) => path.join(__dirname, '..', '..', 'frontend', 'shared', 'js', nome));
    const raiz = path.join(__dirname, '..', '..', 'frontend');
    const arquivos = [];
    const varrer = (dir) => {
      for (const nome of fs.readdirSync(dir, { withFileTypes: true })) {
        const completo = path.join(dir, nome.name);
        if (nome.isDirectory()) varrer(completo);
        else if (nome.name.endsWith('.js')) arquivos.push(completo);
      }
    };
    varrer(path.join(raiz, 'pdv'));
    varrer(path.join(raiz, 'apps'));
    varrer(path.join(raiz, 'shared', 'js'));
    const usando = arquivos.filter((f) => !modulosPermitidos.includes(f) && /permitirVendaPorLinha|permitirVendaPorProduto|configuracoes-avancadas\/comercializacao|isVendaPorLinhaPermitida/.test(fs.readFileSync(f, 'utf8')));
    assert.deepEqual(usando, []);
  });
});
