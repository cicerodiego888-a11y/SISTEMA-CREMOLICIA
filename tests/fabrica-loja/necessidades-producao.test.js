/**
 * Necessidade de produção. Banco temporário. Não usa o banco oficial.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');

const dir = path.join(os.tmpdir(), 'cds-fabrica-loja-testes');
fs.mkdirSync(dir, { recursive: true });
const arquivo = path.join(dir, 'necessidades.db');
for (const sufixo of ['', '-wal', '-shm']) {
  fs.rmSync(arquivo + sufixo, { force: true });
}

const { salvarNecessidade, listarNecessidades, obterNecessidade } = require('../../backend/modules/fabrica-loja');

function abrir() {
  return new sqlite3.Database(arquivo);
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => (err ? reject(err) : resolve()));
  });
}

describe('Necessidade de produção', () => {
  let db;

  before(async () => {
    db = abrir();
    await run(db, 'CREATE TABLE vendas (id INTEGER PRIMARY KEY, total REAL)');
    await run(db, 'INSERT INTO vendas (id, total) VALUES (1, 30)');
    await run(db, 'CREATE TABLE produtos (id INTEGER PRIMARY KEY, nome TEXT, estoque_atual REAL, natureza_cadastro TEXT, ativo INTEGER DEFAULT 1)');
    await run(db, "INSERT INTO produtos (id, nome, estoque_atual, natureza_cadastro) VALUES (3, 'Açaí', 10, 'PRODUZIDO')");
    await run(db, "INSERT INTO produtos (id, nome, estoque_atual, natureza_cadastro) VALUES (4, 'Base de leite', 0, 'PRODUZIDO')");
    await run(db, "INSERT INTO produtos (id, nome, estoque_atual, natureza_cadastro) VALUES (5, 'Sorvete de creme', 0, 'PRODUZIDO')");
    await run(db, "INSERT INTO produtos (id, nome, estoque_atual, natureza_cadastro) VALUES (6, 'Picolé', 0, 'PRODUZIDO')");
    await run(db, `
      CREATE TABLE pedidos_comerciais (
        id INTEGER PRIMARY KEY,
        codigo TEXT,
        status TEXT
      )
    `);
    await run(db, "INSERT INTO pedidos_comerciais (id, codigo, status) VALUES (8, 'PED-0008', 'ABERTO')");
    await run(db, `
      CREATE TABLE pedido_itens (
        id INTEGER PRIMARY KEY,
        pedido_id INTEGER,
        produto_id INTEGER,
        quantidade REAL
      )
    `);
    await run(db, 'INSERT INTO pedido_itens (id, pedido_id, produto_id, quantidade) VALUES (1, 8, 3, 4)');
  });

  after(() => {
    if (db) db.close();
  });

  it('registra necessidades manuais, de abastecimento, de planejamento e da loja', async () => {
    const manual = await salvarNecessidade(db, {
      origem: 'MANUAL',
      descricao: 'Calda para a semana',
      data_necessidade: '2026-10-12',
      itens: [
        { produto_id: 4, descricao: 'Calda de chocolate', quantidade: '2,5', unidade: 'L' },
        { produto_id: 3, descricao: 'Açaí', quantidade: 8, unidade: 'kg' }
      ]
    });
    const abastecimento = await salvarNecessidade(db, {
      origem: 'ABASTECIMENTO',
      descricao: 'Reposição do estoque da fábrica',
      itens: [{ produto_id: 4, descricao: 'Base de leite', quantidade: 20, unidade: 'L' }]
    });
    const planejamento = await salvarNecessidade(db, {
      origem: 'PLANEJAMENTO',
      descricao: 'Plano de sábado',
      itens: [{ produto_id: 5, descricao: 'Sorvete de creme', quantidade: 15, unidade: 'L' }]
    });
    const loja = await salvarNecessidade(db, {
      origem: 'PEDIDO_LOJA',
      referencia: 'Vitrine do fim de semana',
      descricao: 'Necessidade informada pela loja',
      itens: [{ produto_id: 6, descricao: 'Picolé', quantidade: 40, unidade: 'un' }]
    });

    assert.equal(manual.codigo, 'NP-0001');
    assert.equal(manual.status, 'ABERTA');
    assert.equal(manual.itens.length, 2);
    assert.equal(manual.itens[0].quantidade, 2.5);
    assert.equal(abastecimento.origem, 'ABASTECIMENTO');
    assert.equal(planejamento.origem, 'PLANEJAMENTO');
    assert.equal(loja.pedido_id, null);
    assert.equal(loja.referencia, 'Vitrine do fim de semana');
    const lista = await listarNecessidades(db, {});
    assert.equal(lista.length, 4);
  });

  it('copia a referência do pedido sem alterar a loja e recusa produção', async () => {
    const necessidade = await salvarNecessidade(db, {
      origem: 'PEDIDO_LOJA',
      pedido_id: 8,
      descricao: 'Produzir o pedido da loja',
      itens: [{ produto_id: 3, descricao: 'Açaí', quantidade: 4, unidade: 'kg' }]
    });
    assert.equal(necessidade.referencia, 'PED-0008');
    assert.equal(necessidade.pedido_id, 8);

    const alterada = await salvarNecessidade(db, {
      origem: 'PEDIDO_LOJA',
      pedido_id: 8,
      descricao: 'Produzir o pedido da loja',
      itens: [{ produto_id: 3, descricao: 'Açaí', quantidade: 9, unidade: 'kg' }]
    }, necessidade.id);
    assert.equal(alterada.itens[0].quantidade, 9);

    await assert.rejects(
      () => salvarNecessidade(db, {
        origem: 'PEDIDO_LOJA',
        pedido_id: 8,
        descricao: 'Produzir o pedido da loja',
        status: 'PRODUZIDA',
        itens: [{ descricao: 'Açaí', quantidade: 1 }]
      }, necessidade.id),
      (err) => err.code === 'STATUS_INVALIDO'
    );
    const preservada = await obterNecessidade(db, necessidade.id);
    assert.equal(preservada.status, 'ABERTA');
    assert.equal(preservada.itens[0].quantidade, 9);

    const pedido = await all(db, 'SELECT id, codigo, status FROM pedidos_comerciais');
    assert.deepEqual(pedido, [{ id: 8, codigo: 'PED-0008', status: 'ABERTO' }]);
    const itemPedido = await all(db, 'SELECT quantidade FROM pedido_itens');
    assert.deepEqual(itemPedido, [{ quantidade: 4 }]);
    const produto = await all(db, 'SELECT estoque_atual FROM produtos WHERE id = 3');
    assert.deepEqual(produto, [{ estoque_atual: 10 }]);
  });

  it('cancela a necessidade e não cria ordem de produção', async () => {
    const lista = await listarNecessidades(db, {});
    const id = lista.find((item) => item.descricao === 'Calda para a semana').id;
    const atual = await obterNecessidade(db, id);
    const cancelada = await salvarNecessidade(db, { ...atual, status: 'CANCELADA' }, id);
    assert.equal(cancelada.status, 'CANCELADA');
    assert.equal(cancelada.itens.length, 2);
    const abertas = await listarNecessidades(db, {});
    assert.equal(abertas.some((item) => item.id === id), false);

    await assert.rejects(
      () => salvarNecessidade(db, { origem: 'PEDIDO_LOJA', descricao: 'Sem origem', itens: [{ descricao: 'Açaí', quantidade: 1 }] }),
      (err) => err.code === 'ORIGEM_SEM_REFERENCIA'
    );
    await assert.rejects(
      () => salvarNecessidade(db, { origem: 'MANUAL', descricao: 'Vazia', itens: [] }),
      (err) => err.code === 'ITENS_OBRIGATORIOS'
    );

    const venda = await all(db, 'SELECT id, total FROM vendas');
    assert.deepEqual(venda, [{ id: 1, total: 30 }]);
    const tabelas = await all(db, "SELECT name FROM sqlite_master WHERE type = 'table'");
    const nomes = tabelas.map((tabela) => tabela.name);
    assert.equal(nomes.includes('ordens_producao'), false);
    assert.equal(nomes.includes('producao'), false);
    assert.equal(nomes.includes('necessidades_producao'), true);
  });
});
