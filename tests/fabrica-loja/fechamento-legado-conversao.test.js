/**
 * Fechamento do legado da conversão de estoque da Linha (FABRICA-CONVERSAO-03):
 * migration 011 no bootstrap oficial; produto-linha convertido fora de venda, pedido,
 * PDV e consignação novos; consignação antiga, devolução e histórico preservados;
 * pendência de consignação separada do estoque; produtos-linha pendentes intactos.
 * Banco temporário via tests/pdv/_bancoIsolado.js. Executar: npm run test:fechamento-legado
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
  console.error('Banco isolado ausente. Execute: node -r ./tests/pdv/_bancoIsolado.js --test tests/fabrica-loja/fechamento-legado-conversao.test.js');
  process.exit(1);
}
for (const sufixo of ['', '-wal', '-shm']) {
  fs.rmSync(path.join(process.env.DB_DIR, 'mercadao.db' + sufixo), { force: true });
}

const express = require('express');
const db = require('../../backend/database');
const MotorEstoque = require('../../backend/motores/motor-estoque');
const { bootstrapFabricaLojaSchema } = require('../../backend/modules/fabrica-loja');
const bootstrapLinhasProdutos = require('../../backend/modules/fabrica-loja/migrations/010_linhas_produtos');
const Conversao = require('../../backend/modules/fabrica-loja/ConversaoEstoqueLinhaService');
const {
  MENSAGEM_PRODUTO_LINHA_CONVERTIDO,
  CODIGO_PRODUTO_LINHA_CONVERTIDO
} = require('../../backend/modules/fabrica-loja/produtoLinhaConvertido');

const TABELAS_011 = ['linhas_produtos_legado', 'conversoes_estoque_linha', 'conversoes_estoque_linha_itens'];

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

async function criarProduto(d) {
  const r = await run(
    `INSERT INTO produtos (codigo, codigo_barras, nome, unidade, preco_venda, preco_compra, saldo_fiscal, saldo_nao_fiscal,
       estoque_atual, ativo, natureza_cadastro, linha_produtos_id, item_fiscal)
     VALUES (?, ?, ?, 'UN', 2, 0, ?, ?, ?, ?, ?, ?, 0)`,
    [d.codigo, d.ean || null, d.nome, d.fiscal || 0, d.naoFiscal || 0, (d.fiscal || 0) + (d.naoFiscal || 0),
      d.ativo == null ? 1 : d.ativo, d.natureza || null, d.linha || null]
  );
  return r.id;
}

async function api(method, rota, body) {
  const resposta = await fetch(base + rota, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: resposta.status, body: await resposta.json().catch(() => null) };
}

function chamarServico(fn, body, headers = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); return this; }
    };
    fn({ body, headers, query: {}, user: { id: 1 } }, res);
  });
}

function corpoVenda(itens, extra = {}) {
  const total = itens.reduce((s, i) => s + i.quantidade * 2, 0);
  return {
    total,
    forma_pagamento: 'dinheiro',
    itens: itens.map((i) => ({ produto_id: i.produto_id, quantidade: i.quantidade, preco_unitario: 2, subtotal: i.quantidade * 2 })),
    pagamentos: [{ forma: 'dinheiro', valor: total }],
    valor_recebido: total,
    emitir_fiscal: false,
    ...extra
  };
}

async function estoque(id) {
  return get('SELECT saldo_fiscal, saldo_nao_fiscal, estoque_atual, ativo FROM produtos WHERE id = ?', [id]);
}

async function estoqueGlobal() {
  return (await get('SELECT ROUND(SUM(estoque_atual), 3) AS total FROM produtos')).total;
}

async function esquema011() {
  return all(`SELECT type, name, tbl_name, sql FROM sqlite_master
    WHERE tbl_name IN (${TABELAS_011.map(() => '?').join(',')}) ORDER BY type, name`, TABELAS_011);
}

async function tabelaExiste(nome) {
  return !!(await get(`SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?`, [nome]));
}

async function historico() {
  const nfce = await tabelaExiste('nfce_notas') ? await all('SELECT * FROM nfce_notas ORDER BY id') : [];
  return {
    vendas: hash(await all('SELECT * FROM vendas WHERE id <= ? ORDER BY id', [ids.ultimaVendaHistorica])),
    vendas_itens: hash(await all('SELECT * FROM vendas_itens WHERE venda_id <= ? ORDER BY id', [ids.ultimaVendaHistorica])),
    consignacoes: hash(await all('SELECT * FROM consignacoes ORDER BY id')),
    consignacoes_itens: hash(await all('SELECT * FROM consignacoes_itens ORDER BY id')),
    nfce_notas: hash(nfce)
  };
}

async function legadoNaLista(produtoId) {
  const lista = (await api('GET', '/fabrica-loja/conversoes-linha')).body;
  for (const linha of lista.linhas) {
    const achado = linha.produtos_legado.find((p) => p.id === produtoId);
    if (achado) return achado;
  }
  return null;
}

before(async () => {
  assert.ok(path.resolve(db.dbPath).toLowerCase().startsWith(TMP), `banco fora do temp: ${db.dbPath}`);
  await new Promise((resolve) => db.whenReady(() => resolve()));

  const app = express();
  app.use(express.json());
  app.use('/api/produtos', require('../../backend/rotas/produtos'));
  app.use('/api/fabrica-loja', require('../../backend/rotas/fabrica-loja'));
  servidor = http.createServer(app);
  await new Promise((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${servidor.address().port}/api`;
});

after(async () => {
  if (servidor) await new Promise((resolve) => servidor.close(resolve));
  await new Promise((resolve) => db.close(() => resolve()));
});

describe('Migration 011 no bootstrap oficial da Fábrica', () => {
  it('sem a Linha de Produtos (010) o bootstrap não cria as tabelas da 011', async () => {
    assert.equal(await tabelaExiste('linhas_produtos'), false);
    await bootstrapFabricaLojaSchema(db);
    for (const tabela of TABELAS_011) assert.equal(await tabelaExiste(tabela), false, tabela);
  });

  it('14. com a Linha de Produtos, o bootstrap cria cada tabela da 011 uma única vez', async () => {
    await bootstrapLinhasProdutos(db);
    await bootstrapFabricaLojaSchema(db);
    const tabelas = await all(`SELECT name, COUNT(*) AS q FROM sqlite_master WHERE type = 'table' AND name IN (?, ?, ?) GROUP BY name`, TABELAS_011);
    assert.deepEqual(tabelas.map((t) => [t.name, t.q]).sort(), TABELAS_011.map((t) => [t, 1]).sort());
  });

  it('15. reexecutar o bootstrap é idempotente: mesmo esquema e mesmos dados', async () => {
    const linha = await run(`INSERT INTO linhas_produtos (codigo, nome) VALUES ('TMP-IDEMP', 'Linha idempotência')`);
    const produto = await criarProduto({ codigo: 'TMP-IDEMP', nome: 'Produto idempotência' });
    await run('INSERT INTO linhas_produtos_legado (linha_produtos_id, produto_id) VALUES (?, ?)', [linha.id, produto]);
    const esquemaAntes = await esquema011();
    const dadosAntes = hash(await all('SELECT * FROM linhas_produtos_legado ORDER BY id'));

    await bootstrapFabricaLojaSchema(db);
    await bootstrapFabricaLojaSchema(db);

    assert.deepEqual(await esquema011(), esquemaAntes);
    assert.equal(hash(await all('SELECT * FROM linhas_produtos_legado ORDER BY id')), dadosAntes);

    await run('DELETE FROM linhas_produtos_legado WHERE produto_id = ?', [produto]);
    await run('DELETE FROM produtos WHERE id = ?', [produto]);
    await run('DELETE FROM linhas_produtos WHERE id = ?', [linha.id]);
  });
});

describe('Produto-linha convertido (cenário do banco de teste)', () => {
  let globalAntes;
  let historicoAntes;
  let conversao;

  before(async () => {
    for (let n = 1; n <= 6; n += 1) {
      ids[`linha${n}`] = (await run(`INSERT INTO linhas_produtos (codigo, nome) VALUES (?, ?)`, [`L${n}`, `Linha ${n}`])).id;
    }
    ids.p50 = await criarProduto({ codigo: '0047', ean: '7890000000505', nome: 'PICOLE LINHA CREMOSA', fiscal: 100, naoFiscal: 400 });
    ids.p51 = await criarProduto({ codigo: '0048', nome: 'PICOLE LINHA FRUTA AO LEITE', ativo: 0 });
    ids.p52 = await criarProduto({ codigo: '0049', nome: 'PICOLE LINHA FRUTA COM AGUA', fiscal: 10, naoFiscal: 90 });
    ids.p53 = await criarProduto({ codigo: '0050', nome: 'PICOLE LINHA KIDS', fiscal: 0, naoFiscal: 40 });
    ids.p54 = await criarProduto({ codigo: '0051', nome: 'PICOLE LINHA ESPECIAL', fiscal: 5, naoFiscal: 15 });
    ids.p55 = await criarProduto({ codigo: '0052', nome: 'PICOLE LINHA SKIMO', fiscal: 2, naoFiscal: 8 });
    ids.p58 = await criarProduto({ codigo: '0058', nome: 'PICOLE ESPECIAL ANTIGO', ativo: 0 });
    ids.chocolate = await criarProduto({ codigo: '0002', nome: 'PICOLE CHOCOLATE', fiscal: 7, naoFiscal: 3, ativo: 0, natureza: 'PRODUZIDO', linha: ids.linha1 });
    ids.morango = await criarProduto({ codigo: '0003', nome: 'PICOLE MORANGO', natureza: 'PRODUZIDO', linha: ids.linha1 });
    ids.uva = await criarProduto({ codigo: '0030', nome: 'PICOLE UVA AGUA', natureza: 'COMERCIAL', linha: ids.linha5 });
    ids.insumo = await criarProduto({ codigo: 'INS-1', nome: 'Leite em pó', fiscal: 5, natureza: 'INSUMO' });

    const mapa = [[ids.p50, 1], [ids.p51, 2], [ids.p52, 5], [ids.p53, 3], [ids.p54, 4], [ids.p55, 6], [ids.p58, 4]];
    for (const [produtoId, n] of mapa) {
      await Conversao.registrarProdutoLegado(db, { linha_produtos_id: ids[`linha${n}`], produto_id: produtoId });
    }

    const venda = await run(`INSERT INTO vendas (codigo, data_venda, total, status) VALUES ('V-HIST-50', '2026-09-01', 20, 'concluida')`);
    await run(`INSERT INTO vendas_itens (venda_id, produto_id, quantidade, preco_unitario, subtotal) VALUES (?, ?, 10, 2, 20)`, [venda.id, ids.p50]);
    ids.vendaHistorica = venda.id;
    ids.ultimaVendaHistorica = venda.id;
    const cliente = await run(`INSERT INTO clientes (nome) VALUES ('Cliente consignado')`);
    ids.cliente = cliente.id;
    const perfil = await run(`INSERT INTO perfil_comercial (cliente_id, perfil_tipo) VALUES (?, 'CONSIGNADO')`, [cliente.id]);
    const consignacao = await run(`INSERT INTO consignacoes (cliente_id, perfil_comercial_id, status) VALUES (?, ?, 'ENTREGUE')`, [cliente.id, perfil.id]);
    ids.consignacao = consignacao.id;
    ids.itemConsignado = (await run(
      `INSERT INTO consignacoes_itens (consignacao_id, produto_id, quantidade_entregue, preco_unitario) VALUES (?, ?, 30, 2)`,
      [consignacao.id, ids.p50]
    )).id;

    await run(`CREATE TABLE IF NOT EXISTS produto_unidades (
      id INTEGER PRIMARY KEY AUTOINCREMENT, produto_id INTEGER NOT NULL, unidade TEXT NOT NULL,
      descricao TEXT, fator_conversao REAL NOT NULL DEFAULT 1, preco REAL DEFAULT 0,
      codigo_barras TEXT, codigo_auxiliar TEXT, principal INTEGER DEFAULT 0, ativo INTEGER DEFAULT 1,
      ordem INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    await run(`INSERT INTO produto_unidades (produto_id, unidade, fator_conversao, codigo_barras, ativo) VALUES (?, 'CX', 20, '17890000000502', 1)`, [ids.p50]);

    globalAntes = await estoqueGlobal();
    historicoAntes = await historico();
    conversao = await Conversao.converterEstoqueLinha(db, {
      produto_origem_id: ids.p50,
      itens: [
        { produto_id: ids.chocolate, quantidade_fiscal: 60, quantidade_nao_fiscal: 240, reativar: true },
        { produto_id: ids.morango, quantidade_fiscal: 40, quantidade_nao_fiscal: 160 }
      ]
    }, { usuario_id: 1, usuario_nome: 'teste' });
  });

  it('1. nova venda (PDV, mobile, NF-e manual, pedido) com o produto-linha convertido é recusada', async () => {
    const vendasAntes = (await get('SELECT COUNT(*) AS n FROM vendas')).n;
    for (const origem of [undefined, 'PDV_DESKTOP', 'PDV_MOBILE', 'NFE_MANUAL', 'PEDIDO']) {
      const r = await chamarServico(
        require('../../backend/services/vendas/VendaPagamentoService').criarVenda,
        corpoVenda([{ produto_id: ids.p50, quantidade: 1 }], origem ? { origem_pdv: origem } : {})
      );
      assert.equal(r.status, 409, `origem ${origem}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.error, MENSAGEM_PRODUTO_LINHA_CONVERTIDO);
      assert.equal(r.body.codigo, CODIGO_PRODUTO_LINHA_CONVERTIDO);
      assert.deepEqual(r.body.itens.map((i) => i.produto_id), [ids.p50]);
    }
    const misturada = await chamarServico(
      require('../../backend/services/vendas/VendaPagamentoService').criarVenda,
      corpoVenda([{ produto_id: ids.morango, quantidade: 1 }, { produto_id: ids.p50, quantidade: 1 }])
    );
    assert.equal(misturada.status, 409);
    const preCalculo = await chamarServico(require('../../backend/services/vendas/VendaPagamentoService').preCalcularDistribuicao, {
      itens: [{ produto_id: ids.p50, quantidade: 1, preco_unitario: 2 }], emitir_fiscal: false
    });
    assert.equal(preCalculo.status, 409);
    assert.equal(preCalculo.body.error, MENSAGEM_PRODUTO_LINHA_CONVERTIDO);
    assert.equal((await get('SELECT COUNT(*) AS n FROM vendas')).n, vendasAntes);
    assert.deepEqual(await estoque(ids.morango), { saldo_fiscal: 40, saldo_nao_fiscal: 160, estoque_atual: 200, ativo: 1 });
  });

  it('1. o PDV não oferece o produto-linha convertido (código, EAN, nome, lista e unidade MUC)', async () => {
    assert.deepEqual((await api('GET', '/produtos/consulta-pdv/buscar?q=0047&modo_fiscal=0')).body, []);
    assert.deepEqual((await api('GET', '/produtos/consulta-pdv/buscar?q=7890000000505&modo_fiscal=0')).body, []);
    const buscaSemContexto = (await api('GET', '/produtos/search?q=picole')).body;
    assert.ok(buscaSemContexto.items.some((p) => p.id === ids.p50));
    const buscaDaEntrega = (await api('GET', '/produtos/search?q=picole&contexto=pdv')).body;
    assert.ok(!buscaDaEntrega.items.some((p) => p.id === ids.p50));
    assert.deepEqual(
      buscaDaEntrega.items.filter((p) => [ids.chocolate, ids.morango].includes(p.id)).map((p) => p.id).sort(),
      [ids.chocolate, ids.morango].sort()
    );
    assert.deepEqual(
      await get('SELECT produto_id, quantidade_entregue FROM consignacoes_itens WHERE id = ?', [ids.itemConsignado]),
      { produto_id: ids.p50, quantidade_entregue: 30 }
    );
    const nome = (await api('GET', '/produtos/search?q=linha%20cremosa&contexto=pdv')).body;
    assert.ok(!nome.items.some((p) => p.id === ids.p50));
    const lista = (await api('GET', '/produtos?modo_fiscal=0&contexto=pdv')).body;
    assert.ok(!lista.some((p) => p.id === ids.p50));
    assert.ok(lista.some((p) => p.id === ids.morango));
    const muc = await api('GET', '/produtos/muc/barras/17890000000502?contexto=pdv');
    assert.equal(muc.status, 409);
    assert.equal(muc.body.error, MENSAGEM_PRODUTO_LINHA_CONVERTIDO);
    const sabor = (await api('GET', '/produtos/consulta-pdv/buscar?q=0003&modo_fiscal=0')).body;
    assert.equal(sabor[0].id, ids.morango);
  });

  it('1. novo orçamento e novo pedido com o produto-linha convertido são recusados', async () => {
    const Pedidos = require('../../backend/services/pedidos/orcamentoPedidoService');
    const dados = { cliente_id: ids.cliente, itens: [{ produto_id: ids.p50, quantidade: 1, preco_unitario: 2 }] };
    for (const criar of [Pedidos.criarOrcamento, Pedidos.criarPedidoDireto]) {
      await assert.rejects(criar(dados, {}, { db }), (err) => {
        assert.equal(err.code, CODIGO_PRODUTO_LINHA_CONVERTIDO);
        assert.equal(err.statusCode, 409);
        assert.equal(err.message, MENSAGEM_PRODUTO_LINHA_CONVERTIDO);
        return true;
      });
    }
    const pedido = await Pedidos.criarPedidoDireto(
      { cliente_id: ids.cliente, itens: [{ produto_id: ids.morango, quantidade: 1, preco_unitario: 2 }] }, {}, { db }
    );
    assert.ok(pedido, 'pedido com sabor deve ser criado');
  });

  it('2. nova consignação com o produto-linha convertido é recusada', async () => {
    const { criarBridgeAdapters } = require('../../backend/motores/motor-comercial/bridges/adapters');
    const AdicionarItem = require('../../backend/motores/motor-comercial/usecases/consignacao/AdicionarItemConsignacaoUseCase');
    const { produtoBridge } = criarBridgeAdapters({ db });
    assert.equal(await produtoBridge.motivoBloqueioComercial(ids.p50), MENSAGEM_PRODUTO_LINHA_CONVERTIDO);
    assert.equal(await produtoBridge.motivoBloqueioComercial(ids.morango), null);

    const useCase = new AdicionarItem({ produtoBridge });
    await assert.rejects(
      useCase.processar({ consignacaoId: ids.consignacao, produtoId: ids.p50, quantidade: 1 }),
      (err) => err.name === 'ProdutoInvalidoError' && String(err.message).includes(MENSAGEM_PRODUTO_LINHA_CONVERTIDO)
    );
    const itensConsignados = (await get('SELECT COUNT(*) AS q FROM consignacoes_itens')).q;
    assert.equal(itensConsignados, 1);
  });

  it('3. o histórico do produto-linha continua consultável', async () => {
    const produto = await api('GET', `/produtos/${ids.p50}`);
    assert.equal(produto.status, 200);
    assert.equal(produto.body.nome, 'PICOLE LINHA CREMOSA');
    const erp = (await api('GET', '/produtos?modo_fiscal=0')).body;
    assert.ok(erp.some((p) => p.id === ids.p50));
    const item = await get('SELECT produto_id, quantidade FROM vendas_itens WHERE venda_id = ?', [ids.vendaHistorica]);
    assert.deepEqual(item, { produto_id: ids.p50, quantidade: 10 });
    const comprovante = (await api('GET', `/fabrica-loja/conversoes-linha/${conversao.id}`)).body.conversao;
    assert.equal(comprovante.descricao_operacao, 'Operação de conversão de estoque legado.');
    assert.equal(comprovante.totais.total_origem, 500);
    assert.equal(comprovante.totais.total_distribuido, 500);
    assert.equal(comprovante.movimentacoes.length, 3);
  });

  it('8. a pendência de consignação não aparece como estoque disponível', async () => {
    const grade = (await api('GET', `/fabrica-loja/conversoes-linha/origem/${ids.p50}`)).body.grade;
    assert.equal(grade.origem.situacao, 'CONVERTIDO');
    assert.equal(grade.origem.convertivel, false);
    assert.equal(grade.origem.estoque_disponivel, 0);
    assert.equal(grade.origem.consignacao_pendente, 30);
    assert.equal(grade.origem.saldo_residual, 0);
    assert.equal(grade.origem.bloqueio.mensagem, 'Este produto-linha já foi convertido.');
    const lista = await legadoNaLista(ids.p50);
    assert.equal(lista.estoque_disponivel, 0);
    assert.equal(lista.consignacao_pendente, 30);
    assert.equal(lista.conversao_id, conversao.id);
  });

  it('7. segunda conversão do mesmo produto-linha retorna 409 controlado', async () => {
    const movimentosAntes = (await get('SELECT COUNT(*) AS q FROM estoque_movimentacoes')).q;
    const r = await api('POST', '/fabrica-loja/conversoes-linha', {
      produto_origem_id: ids.p50,
      itens: [{ produto_id: ids.morango, quantidade_fiscal: 1, quantidade_nao_fiscal: 0 }]
    });
    assert.equal(r.status, 409);
    assert.equal(r.body.codigo, 'PRODUTO_LINHA_JA_CONVERTIDO');
    assert.equal(r.body.error, 'Este produto-linha já foi convertido.');
    assert.equal(r.body.detalhes.conversao_id, conversao.id);
    assert.equal((await get('SELECT COUNT(*) AS q FROM conversoes_estoque_linha')).q, 1);
    assert.equal((await get('SELECT COUNT(*) AS q FROM estoque_movimentacoes')).q, movimentosAntes);
  });

  for (const [numero, chave, estoqueEsperado] of [['9', 'p52', 100], ['10', 'p53', 40], ['11', 'p54', 20], ['12', 'p55', 10]]) {
    it(`${numero}. produto-linha ${chave.slice(1)} continua PENDENTE de distribuição física`, async () => {
      const grade = (await api('GET', `/fabrica-loja/conversoes-linha/origem/${ids[chave]}`)).body.grade;
      assert.equal(grade.origem.situacao, 'PENDENTE');
      assert.equal(grade.origem.convertivel, true);
      assert.equal(grade.origem.estoque_disponivel, estoqueEsperado);
      assert.equal(grade.origem.aviso, 'Conversão pendente de distribuição física.');
      assert.equal((await estoque(ids[chave])).estoque_atual, estoqueEsperado);
      assert.equal((await get('SELECT COUNT(*) AS q FROM conversoes_estoque_linha WHERE produto_origem_id = ?', [ids[chave]])).q, 0);
    });
  }

  it('13. o 58 continua inativo, com saldo 0, sem conversão; o 51 também segue inativo', async () => {
    const p58 = await legadoNaLista(ids.p58);
    assert.equal(p58.situacao, 'INATIVO');
    assert.equal(p58.estoque_disponivel, 0);
    assert.equal(p58.convertivel, false);
    assert.deepEqual(await estoque(ids.p58), { saldo_fiscal: 0, saldo_nao_fiscal: 0, estoque_atual: 0, ativo: 0 });
    const p51 = await legadoNaLista(ids.p51);
    assert.equal(p51.situacao, 'INATIVO');
    assert.equal((await estoque(ids.p51)).ativo, 0);
    assert.equal((await get('SELECT COUNT(*) AS q FROM conversoes_estoque_linha WHERE produto_origem_id IN (?, ?)', [ids.p51, ids.p58])).q, 0);
  });

  it('16. o estoque global continua consistente', async () => {
    assert.equal(await estoqueGlobal(), globalAntes);
  });

  it('17. nenhuma venda, NFC-e ou consignação já registrada foi alterada', async () => {
    assert.deepEqual(await historico(), historicoAntes);
  });

  it('4. a consignação antiga continua: o acerto da venda do produto-linha é gravado', async () => {
    const VendaPagamentoService = require('../../backend/services/vendas/VendaPagamentoService');
    const vendasAntes = (await get('SELECT COUNT(*) AS n FROM vendas')).n;
    const r = await chamarServico(VendaPagamentoService.criarVenda, corpoVenda([{ produto_id: ids.p50, quantidade: 5 }], {
      origem: 'CONSIGNACAO',
      origem_pdv: 'CONSIGNACAO',
      politicaEstoque: 'JA_BAIXADO_CONSIGNACAO'
    }));
    assert.ok(r.status < 300, `status ${r.status}: ${JSON.stringify(r.body)}`);
    assert.equal((await get('SELECT COUNT(*) AS n FROM vendas')).n, vendasAntes + 1);
    const item = await get('SELECT produto_id, quantidade FROM vendas_itens ORDER BY id DESC LIMIT 1');
    assert.deepEqual(item, { produto_id: ids.p50, quantidade: 5 });
    assert.equal((await estoque(ids.p50)).estoque_atual, 0);
  });

  it('5. a devolução da consignação antiga volta para o próprio produto-linha (produto_id não muda)', async () => {
    const saboresAntes = [await estoque(ids.chocolate), await estoque(ids.morango)];
    await MotorEstoque.entrar(db, {
      produtoId: ids.p50, quantidadeBase: 5, quantidadeFiscal: 0, quantidadeNaoFiscal: 5,
      origem: 'DEVOLUCAO', referenciaTipo: 'consignacao', referenciaId: ids.consignacao, motivo: 'COM_DEVOLUCAO:teste'
    });
    await run('UPDATE consignacoes_itens SET quantidade_devolvida = 5 WHERE id = ?', [ids.itemConsignado]);
    assert.equal((await get('SELECT produto_id FROM consignacoes_itens WHERE id = ?', [ids.itemConsignado])).produto_id, ids.p50);
    assert.equal((await estoque(ids.p50)).estoque_atual, 5);
    assert.deepEqual([await estoque(ids.chocolate), await estoque(ids.morango)], saboresAntes);
  });

  it('6. a devolução não reabre a conversão: vira saldo residual, não estoque disponível', async () => {
    const grade = (await api('GET', `/fabrica-loja/conversoes-linha/origem/${ids.p50}`)).body.grade;
    assert.equal(grade.origem.situacao, 'CONVERTIDO');
    assert.equal(grade.origem.convertivel, false);
    assert.equal(grade.origem.estoque_disponivel, 0);
    assert.equal(grade.origem.saldo_residual, 5);
    assert.equal(grade.origem.consignacao_pendente, 25);
    const r = await api('POST', '/fabrica-loja/conversoes-linha', {
      produto_origem_id: ids.p50,
      itens: [{ produto_id: ids.morango, quantidade_fiscal: 0, quantidade_nao_fiscal: 5 }]
    });
    assert.equal(r.status, 409);
    assert.equal(r.body.codigo, 'PRODUTO_LINHA_JA_CONVERTIDO');
    const venda = await chamarServico(
      require('../../backend/services/vendas/VendaPagamentoService').criarVenda,
      corpoVenda([{ produto_id: ids.p50, quantidade: 1 }], { origem_pdv: 'PDV_DESKTOP' })
    );
    assert.equal(venda.status, 409);
    assert.equal((await estoque(ids.p50)).estoque_atual, 5);
  });
});

describe('Classificação PRODUZIDO pelo cadastro (linhas 2–6)', () => {
  it('sabor sem natureza PRODUZIDO não é apto até ser classificado no cadastro', async () => {
    let grade = (await api('GET', `/fabrica-loja/conversoes-linha/origem/${ids.p52}`)).body.grade;
    assert.equal(grade.sabores.find((s) => s.id === ids.uva).apto, false);

    const r = await api('PUT', `/produtos/${ids.uva}`, { natureza_cadastro: 'PRODUZIDO' });
    assert.ok(r.status < 300, `status ${r.status}: ${JSON.stringify(r.body)}`);
    assert.equal((await get('SELECT natureza_cadastro FROM produtos WHERE id = ?', [ids.uva])).natureza_cadastro, 'PRODUZIDO');
    grade = (await api('GET', `/fabrica-loja/conversoes-linha/origem/${ids.p52}`)).body.grade;
    assert.equal(grade.sabores.find((s) => s.id === ids.uva).apto, true);
    assert.equal(grade.origem.situacao, 'PENDENTE');
  });

  it('INSUMO não pode ser reclassificado como PRODUZIDO', async () => {
    const r = await api('PUT', `/produtos/${ids.insumo}`, { natureza_cadastro: 'PRODUZIDO' });
    assert.equal(r.status, 400);
    assert.equal(r.body.codigo, 'NATUREZA_INSUMO_PARA_PRODUZIDO');
    assert.equal((await get('SELECT natureza_cadastro FROM produtos WHERE id = ?', [ids.insumo])).natureza_cadastro, 'INSUMO');
  });

  it('nenhum produto foi classificado automaticamente', async () => {
    const naturezas = await all('SELECT id, natureza_cadastro FROM produtos WHERE id IN (?, ?, ?, ?, ?, ?, ?) ORDER BY id',
      [ids.p50, ids.p51, ids.p52, ids.p53, ids.p54, ids.p55, ids.p58]);
    assert.ok(naturezas.every((n) => n.natureza_cadastro == null), JSON.stringify(naturezas));
  });
});
