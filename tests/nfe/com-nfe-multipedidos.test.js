'use strict';

/**
 * Vários pedidos do mesmo cliente em uma NF-e.
 * Banco próprio. A venda e a SEFAZ são simuladas: o teste conta quantas vezes
 * o faturamento oficial seria chamado e confere o preço gravado no pedido.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');

const DIR = path.join(os.tmpdir(), 'cds-nfe-testes', 'multipedidos');
fs.mkdirSync(DIR, { recursive: true });
if (!require.cache[require.resolve('../../backend/database')]) {
  process.env.DB_DIR = DIR;
}

const pedidos = require('../../backend/services/pedidos/orcamentoPedidoService');
const db = new sqlite3.Database(path.join(DIR, 'multipedidos.db'));
const CPF = '52998224725';

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ id: this.lastID, changes: this.changes });
    });
  });
}
function get(sql, params = []) {
  return new Promise((resolve, reject) => db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null))));
}
function all(sql, params = []) {
  return new Promise((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || []))));
}

const DADOS_NFE = {
  dest_cpf: CPF,
  dest_nome: 'Maria',
  dest_logradouro: 'Rua A',
  dest_numero: '10',
  dest_bairro: 'Centro',
  dest_municipio: 'Fortaleza',
  dest_uf: 'CE',
  dest_cep: '60000000',
  natureza_operacao: 'Venda',
  cfop: '5102',
  dest_inscricao_estadual: ''
};

let vendasCriadas = [];

function deps(emitir) {
  return {
    db,
    diagnosticar: async () => ({ pronta: true }),
    criarVenda: async (payload) => {
      vendasCriadas.push(payload);
      const atual = await get('SELECT COALESCE(MAX(id), 100) AS id FROM vendas');
      const id = Number(atual.id) + 1;
      await run('INSERT INTO vendas (id) VALUES (?)', [id]);
      for (const item of payload.itens) {
        await run('INSERT INTO vendas_itens (venda_id, produto_id, quantidade, preco_unitario) VALUES (?, ?, ?, ?)',
          [id, item.produto_id, item.quantidade, item.preco_unitario]);
      }
      return { id };
    },
    cancelarVenda: async () => {},
    emitirNfePorVendaId: emitir
  };
}

async function emitirAutorizada(vendaId) {
  await run(`INSERT INTO nfe_notas (venda_id, numero, serie, status, origem) VALUES (?, ?, 1, 'autorizada', 'PEDIDO')`,
    [vendaId, 100 + vendaId]);
  return { success: true, status: 'autorizada', venda_id: vendaId };
}

before(async () => {
  await run('PRAGMA foreign_keys = OFF');
  await run(`CREATE TABLE IF NOT EXISTS clientes (
    id INTEGER PRIMARY KEY, nome TEXT, cpf_cnpj TEXT, telefone TEXT, rua TEXT, numero TEXT,
    bairro TEXT, cidade TEXT, uf TEXT, cep TEXT, inscricao_estadual TEXT)`);
  await run(`CREATE TABLE IF NOT EXISTS produtos (
    id INTEGER PRIMARY KEY, nome TEXT, preco_venda REAL, saldo_fiscal REAL, codigo TEXT, unidade TEXT)`);
  await run('CREATE TABLE IF NOT EXISTS vendas (id INTEGER PRIMARY KEY, codigo TEXT)');
  await run('ALTER TABLE vendas ADD COLUMN codigo TEXT').catch(() => {});
  await run(`CREATE TABLE IF NOT EXISTS vendas_itens (
    id INTEGER PRIMARY KEY AUTOINCREMENT, venda_id INTEGER, produto_id INTEGER, quantidade REAL, preco_unitario REAL)`);
  await run(`CREATE TABLE IF NOT EXISTS nfe_notas (
    id INTEGER PRIMARY KEY AUTOINCREMENT, venda_id INTEGER, pedido_id INTEGER, numero INTEGER, serie INTEGER,
    status TEXT, origem TEXT, chave_acesso TEXT)`);
  await pedidos.garantirSchemaPedidos(db);
  await run('DELETE FROM nfe_pedidos');
  await run('DELETE FROM venda_pedido_itens');
  await run('DELETE FROM venda_pedidos');
  await run('DELETE FROM pedido_itens');
  await run('DELETE FROM pedidos_comerciais');
  await run('DELETE FROM orcamentos');
  await run('DELETE FROM nfe_notas');
  await run('DELETE FROM vendas_itens');
  await run('DELETE FROM vendas');
  await run('DELETE FROM produtos');
  await run('DELETE FROM clientes');
  await run(`INSERT INTO clientes (id, nome, cpf_cnpj, rua, numero, bairro, cidade, uf, cep)
    VALUES (1, 'Maria', ?, 'Rua A', '10', 'Centro', 'Fortaleza', 'CE', '60000000')`, [CPF]);
  await run(`INSERT INTO clientes (id, nome, cpf_cnpj, rua, numero, bairro, cidade, uf, cep)
    VALUES (2, 'Joao', ?, 'Rua B', '20', 'Centro', 'Fortaleza', 'CE', '60000000')`, [CPF]);
  await run(`INSERT INTO produtos (id, nome, preco_venda, saldo_fiscal, codigo, unidade) VALUES (1, 'AÇAÍ', 60, 100, '42', 'kg')`);
});

async function novoPedido(clienteId, preco, desconto = 0) {
  return pedidos.criarPedidoDireto({
    cliente_id: clienteId,
    desconto,
    forma_pagamento: 'pix',
    itens: [{ produto_id: 1, quantidade: 1, preco_unitario: preco }]
  }, {}, { db });
}

describe('NF-e com vários pedidos', () => {
  it('importa um, dois e três pedidos do mesmo cliente com o preço gravado e uma só venda', async () => {
    vendasCriadas = [];
    const a = await novoPedido(1, 55);
    const b = await novoPedido(1, 10, 1);
    const c = await novoPedido(1, 8);
    assert.equal(a.itens[0].preco_unitario, 55);
    const um = await pedidos.prepararImportacaoPedidos([a.id], { db });
    assert.equal(um.pedidos.length, 1);
    assert.equal(um.pedidos[0].itens[0].preco_unitario, 55);
    assert.equal(um.total, 55);
    const tres = await pedidos.prepararImportacaoPedidos([a.id, b.id, c.id, a.id], { db });
    assert.equal(tres.pedidos.length, 3);
    assert.equal(tres.desconto, 1);
    assert.equal(tres.total, 55 + 9 + 8);

    const out = await pedidos.confirmarEmissaoNfePedidos([a.id, b.id, c.id], { dadosNfe: DADOS_NFE }, { usuarioId: 1 }, deps(emitirAutorizada));
    assert.equal(out.status, 'autorizada');
    assert.equal(vendasCriadas.length, 1);
    assert.equal(vendasCriadas[0].itens[0].preco_unitario, 55);
    assert.equal(vendasCriadas[0].itens.some((item) => item.preco_unitario === 60), false);
    assert.equal(vendasCriadas[0].desconto, 1);
    assert.equal(vendasCriadas[0].pagamentos.length, 1);
    const links = await all('SELECT pedido_id FROM venda_pedidos WHERE venda_id = ? ORDER BY pedido_id', [out.venda_id]);
    assert.deepEqual(links.map((l) => l.pedido_id), [a.id, b.id, c.id]);
    const notas = await all('SELECT pedido_id FROM nfe_pedidos WHERE venda_id = ? ORDER BY pedido_id', [out.venda_id]);
    assert.deepEqual(notas.map((l) => l.pedido_id), [a.id, b.id, c.id]);
    const item = await get('SELECT preco_unitario, quantidade FROM venda_pedido_itens WHERE pedido_id = ?', [a.id]);
    assert.equal(item.preco_unitario, 55);
    assert.equal(item.quantidade, 1);
    for (const id of [a.id, b.id, c.id]) {
      const row = await get('SELECT status FROM pedidos_comerciais WHERE id = ?', [id]);
      assert.equal(row.status, 'FATURADO');
    }
    const aberto = await pedidos.obterPedido(a.id, { db });
    assert.ok(aberto.nfe_relacionadas.length >= 1);
  });

  it('bloqueia outro cliente, orçamento, cancelado, faturado e segunda importação', async () => {
    const meu = await novoPedido(1, 12);
    const outro = await novoPedido(2, 12);
    await assert.rejects(
      () => pedidos.prepararImportacaoPedidos([meu.id, outro.id], { db }),
      (err) => err.code === 'CLIENTE_DIVERGENTE' && /outro cliente/.test(err.message)
    );
    await run(`INSERT INTO orcamentos (id, cliente_id, status, total_itens, desconto, total) VALUES (900001, 1, 'RASCUNHO', 0, 0, 0)`);
    await assert.rejects(
      () => pedidos.prepararImportacaoPedidos([900001], { db }),
      (err) => err.code === 'ORCAMENTO_NAO_IMPORTAVEL'
    );
    await assert.rejects(
      () => pedidos.prepararImportacaoPedidos([900002], { db }),
      (err) => err.code === 'PEDIDO_NAO_ENCONTRADO'
    );
    const cancelado = await novoPedido(1, 4);
    await pedidos.cancelarPedido(cancelado.id, { db });
    await assert.rejects(
      () => pedidos.prepararImportacaoPedidos([cancelado.id], { db }),
      (err) => err.code === 'PEDIDO_CANCELADO'
    );
    await assert.rejects(
      () => pedidos.prepararImportacaoPedidos([meu.id && 0], { db }),
      (err) => err.code === 'PEDIDO_OBRIGATORIO'
    );
    const livre = await novoPedido(1, 7);
    await pedidos.confirmarEmissaoNfePedidos([livre.id], { dadosNfe: DADOS_NFE }, {}, deps(emitirAutorizada));
    await assert.rejects(
      () => pedidos.prepararImportacaoPedidos([livre.id], { db }),
      (err) => err.code === 'PEDIDO_JA_FATURADO' && /faturado/.test(err.message)
    );
  });

  it('falha sem nota não deixa o pedido faturado; rejeição registrada não cria outra venda', async () => {
    vendasCriadas = [];
    const pedido = await novoPedido(1, 15);
    const falha = await pedidos.confirmarEmissaoNfePedidos([pedido.id], { dadosNfe: DADOS_NFE }, {}, deps(async () => ({ success: false, status: 'erro', message: 'sem nota' })));
    assert.equal(falha.faturamento_desfeito, true);
    assert.equal((await get('SELECT status FROM pedidos_comerciais WHERE id = ?', [pedido.id])).status, 'ABERTO');
    assert.equal(vendasCriadas.length, 1);

    const antes = vendasCriadas.length;
    const rejeitado = await novoPedido(1, 16);
    const rejeicao = await pedidos.confirmarEmissaoNfePedidos([rejeitado.id], { dadosNfe: DADOS_NFE }, {}, deps(async (vendaId) => {
      await run(`INSERT INTO nfe_notas (venda_id, numero, serie, status, origem) VALUES (?, 200, 1, 'rejeitada', 'PEDIDO')`, [vendaId]);
      return { success: false, status: 'rejeitada', venda_id: vendaId };
    }));
    assert.equal(rejeicao.faturamento_desfeito, false);
    assert.equal((await get('SELECT status, venda_id FROM pedidos_comerciais WHERE id = ?', [rejeitado.id])).status, 'FATURADO');
    assert.equal(vendasCriadas.length, antes + 1);
  });

  it('a tela do pedido e a Nova NF-e expõem os botões sem um segundo emissor', () => {
    const pedidosJs = fs.readFileSync(path.join(__dirname, '../../frontend/erp/js/pedidos.js'), 'utf8');
    const nfeJs = fs.readFileSync(path.join(__dirname, '../../frontend/erp/js/nfe.js'), 'utf8');
    assert.match(pedidosJs, /Emitir NF-e/);
    assert.match(nfeJs, /id="nfeManualBtnImportarPedido"/);
    assert.match(nfeJs, /\/nfe\/pedidos\/emitir/);
    assert.match(nfeJs, /\/nfe\/manual\/emitir/);
    assert.doesNotMatch(pedidosJs, /emitirNfePorVendaId|xmlBuilder|sefaz/i);
  });
});
