/**
 * Vários pedidos da loja numa necessidade. Banco temporário. Não usa o banco oficial.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const MotorEstoque = require('../../backend/motores/motor-estoque');
const { salvarFicha } = require('../../backend/modules/fabrica-loja/FichaTecnicaService');
const {
  salvarNecessidade,
  obterNecessidade,
  MENSAGEM_DEMANDA
} = require('../../backend/modules/fabrica-loja/NecessidadeProducaoService');
const {
  salvarOrdem,
  planejarOrdem,
  coberturaNecessidade,
  MENSAGEM_QUANTIDADE
} = require('../../backend/modules/fabrica-loja/OrdemProducaoService');
const { executarProducao, iniciarProducao } = require('../../backend/modules/fabrica-loja/ProducaoExecucaoService');

const dir = path.join(os.tmpdir(), 'cds-fabrica-loja-testes');
fs.mkdirSync(dir, { recursive: true });
const arquivo = path.join(dir, 'multipedidos-necessidade.db');
for (const sufixo of ['', '-wal', '-shm']) fs.rmSync(arquivo + sufixo, { force: true });

function abrir() { return new sqlite3.Database(arquivo); }
function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) { err ? reject(err) : resolve(this); });
  });
}
function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}
function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

describe('Múltiplos pedidos → necessidade → OP', () => {
  let db;

  before(async () => {
    db = abrir();
    await run(db, `
      CREATE TABLE produtos (
        id INTEGER PRIMARY KEY, nome TEXT, unidade TEXT,
        estoque_atual REAL DEFAULT 0, saldo_fiscal REAL DEFAULT 0, saldo_nao_fiscal REAL DEFAULT 0,
        natureza_cadastro TEXT, ativo INTEGER DEFAULT 1, controlar_validade INTEGER DEFAULT 0, updated_at TEXT
      )
    `);
    await run(db, `INSERT INTO produtos (id, nome, unidade, natureza_cadastro, estoque_atual) VALUES
      (1, 'Picolé Morango', 'UN', 'PRODUZIDO', 10),
      (2, 'Picolé Chocolate', 'UN', 'PRODUZIDO', 10),
      (9, 'Leite', 'UN', 'INSUMO', 0),
      (30, 'Picolé Produzido', 'UN', 'PRODUZIDO', 0)`);
    await run(db, `
      CREATE TABLE pedidos_comerciais (
        id INTEGER PRIMARY KEY, codigo TEXT, status TEXT, cliente_id INTEGER
      )
    `);
    await run(db, 'CREATE TABLE clientes (id INTEGER PRIMARY KEY, nome TEXT)');
    await run(db, "INSERT INTO clientes (id, nome) VALUES (1, 'Cliente A'), (2, 'Cliente B'), (3, 'Cliente C')");
    await run(db, `
      CREATE TABLE pedido_itens (
        id INTEGER PRIMARY KEY,
        pedido_id INTEGER,
        produto_id INTEGER,
        quantidade REAL,
        preco_unitario REAL
      )
    `);
    await salvarFicha(db, {
      codigo: 'FT-30',
      nome: 'Picolé Produzido',
      produto_id: 30,
      rendimento_quantidade: 1,
      rendimento_unidade: 'UN',
      componentes: [{ produto_id: 9, quantidade: 1, unidade: 'UN' }]
    });
  });

  after(() => db.close());

  async function pedido(id, codigo, clienteId, itens) {
    await run(db, 'INSERT INTO pedidos_comerciais (id, codigo, status, cliente_id) VALUES (?, ?, ?, ?)', [id, codigo, 'ABERTO', clienteId]);
    let itemId = id * 100;
    for (const item of itens) {
      await run(db, 'INSERT INTO pedido_itens (id, pedido_id, produto_id, quantidade, preco_unitario) VALUES (?, ?, ?, ?, 2)', [itemId, id, item.produto, item.quantidade]);
      itemId += 1;
    }
  }

  function demanda(pedidoId, itens) {
    return { pedido_id: pedidoId, itens: itens.map((item) => ({ produto_id: item.produto, quantidade: item.quantidade, unidade: 'UN' })) };
  }

  async function consolidar(pedidos, descricao) {
    return salvarNecessidade(db, {
      origem: 'PEDIDO_LOJA',
      descricao,
      pedidos
    });
  }

  it('A. um pedido vira uma necessidade com o mesmo produto', async () => {
    await pedido(1, 'PED-001', 1, [{ produto: 1, quantidade: 100 }]);
    const antes = await all(db, 'SELECT quantidade, preco_unitario FROM pedido_itens WHERE pedido_id = 1');
    const necessidade = await consolidar([demanda(1, [{ produto: 1, quantidade: 100 }])], 'Pedido único');
    assert.equal(necessidade.pedido_id, 1);
    assert.equal(necessidade.itens.length, 1);
    assert.equal(necessidade.itens[0].quantidade, 100);
    assert.equal(necessidade.pedidos.length, 1);
    assert.equal(necessidade.pedidos[0].itens[0].quantidade, 100);
    assert.deepEqual(await all(db, 'SELECT quantidade, preco_unitario FROM pedido_itens WHERE pedido_id = 1'), antes);
    assert.equal((await get(db, 'SELECT status FROM pedidos_comerciais WHERE id = 1')).status, 'ABERTO');
  });

  it('B. dois pedidos do mesmo produto somam 250', async () => {
    await pedido(2, 'PED-002', 2, [{ produto: 1, quantidade: 100 }]);
    await pedido(3, 'PED-003', 3, [{ produto: 1, quantidade: 150 }]);
    const necessidade = await consolidar([
      demanda(2, [{ produto: 1, quantidade: 100 }]),
      demanda(3, [{ produto: 1, quantidade: 150 }])
    ], 'Dois pedidos');
    assert.equal(necessidade.pedido_id, null);
    assert.equal(necessidade.itens.length, 1);
    assert.equal(necessidade.itens[0].quantidade, 250);
    assert.deepEqual(necessidade.pedidos.map((item) => item.pedido_id), [2, 3]);
  });

  it('C, cenário e O. três pedidos, uma necessidade, uma OP e produção de 300', async () => {
    await pedido(4, 'PED-101', 1, [{ produto: 30, quantidade: 100 }]);
    await pedido(5, 'PED-102', 2, [{ produto: 30, quantidade: 150 }]);
    await pedido(6, 'PED-103', 3, [{ produto: 30, quantidade: 50 }]);
    const estoqueAntes = await get(db, 'SELECT estoque_atual FROM produtos WHERE id = 30');
    const necessidade = await consolidar([
      demanda(4, [{ produto: 30, quantidade: 100 }]),
      demanda(5, [{ produto: 30, quantidade: 150 }]),
      demanda(6, [{ produto: 30, quantidade: 50 }])
    ], 'Três pedidos');
    assert.equal(necessidade.itens.length, 1);
    assert.equal(necessidade.itens[0].quantidade, 300);
    assert.equal(necessidade.pedido_id, null);
    assert.equal(necessidade.pedidos.length, 3);
    assert.equal((await get(db, 'SELECT estoque_atual FROM produtos WHERE id = 30')).estoque_atual, estoqueAntes.estoque_atual);

    const ordem = await salvarOrdem(db, { necessidade_id: necessidade.id });
    assert.equal(ordem.pedido_id, null);
    assert.equal(ordem.necessidade_id, necessidade.id);
    assert.equal(ordem.itens[0].quantidade_planejada, 300);
    assert.equal(ordem.itens[0].necessidade_item_id, necessidade.itens[0].id);
    assert.equal((await get(db, 'SELECT estoque_atual FROM produtos WHERE id = 30')).estoque_atual, 0);
    await MotorEstoque.bootstrapMotorEstoqueSchema(db);
    await MotorEstoque.entrar(db, { produtoId: 9, quantidadeBase: 300, origem: 'COMPRA', local: 'FABRICA' });
    const planejada = await planejarOrdem(db, ordem.id);
    assert.equal(planejada.status, 'PLANEJADA');
    assert.equal((await MotorEstoque.consultarSaldoLocal(db, 30, 'FABRICA')).estoqueAtual, 0);
    await iniciarProducao(db, ordem.id);
    await executarProducao(db, ordem.id, { correlation_id: 'exec-multi-pedidos' });
    assert.equal((await MotorEstoque.consultarSaldoLocal(db, 30, 'FABRICA')).estoqueAtual, 300);
    const atendida = await obterNecessidade(db, necessidade.id);
    assert.equal(atendida.status, 'ATENDIDA');
    assert.equal(atendida.atendimento.solicitado, 300);
    assert.equal(atendida.atendimento.produzido, 300);
  });

  it('D. dois pedidos com produtos diferentes consolidam cada produto', async () => {
    await pedido(7, 'PED-201', 1, [{ produto: 1, quantidade: 100 }, { produto: 2, quantidade: 50 }]);
    await pedido(8, 'PED-202', 2, [{ produto: 1, quantidade: 150 }, { produto: 2, quantidade: 20 }]);
    const necessidade = await consolidar([
      demanda(7, [{ produto: 1, quantidade: 100 }, { produto: 2, quantidade: 50 }]),
      demanda(8, [{ produto: 1, quantidade: 150 }, { produto: 2, quantidade: 20 }])
    ], 'Dois produtos');
    const morango = necessidade.itens.find((item) => item.produto_id === 1);
    const chocolate = necessidade.itens.find((item) => item.produto_id === 2);
    assert.equal(morango.quantidade, 250);
    assert.equal(chocolate.quantidade, 70);
    assert.equal(necessidade.itens.length, 2);
    const primeiro = necessidade.pedidos.find((item) => item.pedido_id === 7);
    assert.equal(primeiro.itens.find((item) => item.produto_id === 1).quantidade, 100);
    assert.equal(primeiro.itens.find((item) => item.produto_id === 2).quantidade, 50);
  });

  it('E. a OP recebe a quantidade consolidada da necessidade', async () => {
    await pedido(9, 'PED-301', 1, [{ produto: 1, quantidade: 250 }]);
    const necessidade = await consolidar([demanda(9, [{ produto: 1, quantidade: 250 }])], 'Para a OP');
    const ordem = await salvarOrdem(db, { necessidade_id: necessidade.id });
    assert.equal(ordem.pedido_id, 9);
    assert.equal(ordem.itens[0].quantidade_planejada, 250);
  });

  it('F e G. várias OPs respeitam o restante da necessidade', async () => {
    await pedido(10, 'PED-401', 1, [{ produto: 1, quantidade: 500 }]);
    const necessidade = await consolidar([demanda(10, [{ produto: 1, quantidade: 500 }])], 'Cobertura');
    const item = necessidade.itens[0];
    await salvarOrdem(db, {
      necessidade_id: necessidade.id,
      itens: [{ necessidade_item_id: item.id, produto_id: 1, quantidade_planejada: 200 }]
    });
    await salvarOrdem(db, {
      necessidade_id: necessidade.id,
      itens: [{ necessidade_item_id: item.id, produto_id: 1, quantidade_planejada: 300 }]
    });
    const cobertura = await coberturaNecessidade(db, necessidade.id);
    assert.equal(cobertura.itens[0].atendido, 500);
    assert.equal(cobertura.itens[0].restante, 0);
    await assert.rejects(
      () => salvarOrdem(db, {
        necessidade_id: necessidade.id,
        itens: [{ necessidade_item_id: item.id, produto_id: 1, quantidade_planejada: 1 }]
      }),
      (err) => err.message === MENSAGEM_QUANTIDADE
    );

    await pedido(11, 'PED-402', 1, [{ produto: 1, quantidade: 500 }]);
    const outra = await consolidar([demanda(11, [{ produto: 1, quantidade: 500 }])], 'Excesso');
    await salvarOrdem(db, {
      necessidade_id: outra.id,
      itens: [{ necessidade_item_id: outra.itens[0].id, produto_id: 1, quantidade_planejada: 300 }]
    });
    await assert.rejects(
      () => salvarOrdem(db, {
        necessidade_id: outra.id,
        itens: [{ necessidade_item_id: outra.itens[0].id, produto_id: 1, quantidade_planejada: 201 }]
      }),
      (err) => err.message === MENSAGEM_QUANTIDADE
    );
  });

  it('H e I. o mesmo pedido pode ser dividido até o limite do produto', async () => {
    await pedido(12, 'PED-501', 1, [{ produto: 1, quantidade: 500 }]);
    const parcial = await consolidar([demanda(12, [{ produto: 1, quantidade: 300 }])], 'Parcial');
    assert.equal(parcial.itens[0].quantidade, 300);
    assert.equal((await get(db, 'SELECT quantidade FROM pedido_itens WHERE pedido_id = 12')).quantidade, 500);

    await pedido(13, 'PED-502', 2, [{ produto: 2, quantidade: 500 }]);
    const primeira = await consolidar([demanda(13, [{ produto: 2, quantidade: 300 }])], 'Parte 1');
    const segunda = await consolidar([demanda(13, [{ produto: 2, quantidade: 200 }])], 'Parte 2');
    assert.equal(primeira.itens[0].quantidade, 300);
    assert.equal(segunda.itens[0].quantidade, 200);
    await assert.rejects(
      () => consolidar([demanda(13, [{ produto: 2, quantidade: 1 }])], 'Parte 3'),
      (err) => err.message === MENSAGEM_DEMANDA
    );
    assert.equal((await get(db, 'SELECT quantidade FROM pedido_itens WHERE pedido_id = 13')).quantidade, 500);
  });

  it('J. necessidade legada com pedido_id continua gerando OP', async () => {
    await pedido(14, 'PED-0008', 1, [{ produto: 1, quantidade: 4 }]);
    const necessidade = await salvarNecessidade(db, {
      origem: 'PEDIDO_LOJA',
      pedido_id: 14,
      descricao: 'Legado',
      itens: [{ produto_id: 1, descricao: 'Picolé Morango', quantidade: 9, unidade: 'UN' }]
    });
    assert.equal(necessidade.pedido_id, 14);
    assert.equal(necessidade.referencia, 'PED-0008');
    assert.equal(necessidade.itens[0].quantidade, 9);
    await run(db, 'DELETE FROM necessidade_producao_pedidos WHERE necessidade_id = ?', [necessidade.id]);
    const ordem = await salvarOrdem(db, {
      necessidade_id: necessidade.id,
      itens: [{ necessidade_item_id: necessidade.itens[0].id, produto_id: 1, quantidade_planejada: 4 }]
    });
    assert.equal(ordem.pedido_id, 14);
    const cobertura = await coberturaNecessidade(db, necessidade.id);
    assert.equal(cobertura.pedido_id, 14);
    assert.equal(cobertura.itens[0].restante, 5);
  });

  it('K, L e M. manual, abastecimento e planejamento não vinculam pedido', async () => {
    const manual = await salvarNecessidade(db, {
      origem: 'MANUAL',
      descricao: 'Manual',
      itens: [{ produto_id: 1, descricao: 'Calda', quantidade: 2, unidade: 'L' }]
    });
    const abastecimento = await salvarNecessidade(db, {
      origem: 'ABASTECIMENTO',
      descricao: 'Abastecimento',
      itens: [{ produto_id: 1, descricao: 'Base', quantidade: 3, unidade: 'L' }]
    });
    const planejamento = await salvarNecessidade(db, {
      origem: 'PLANEJAMENTO',
      descricao: 'Planejamento',
      itens: [{ produto_id: 1, descricao: 'Plano', quantidade: 4, unidade: 'L' }]
    });
    for (const necessidade of [manual, abastecimento, planejamento]) {
      assert.equal(necessidade.pedido_id, null);
      assert.equal(necessidade.pedidos.length, 0);
      const links = await get(db, 'SELECT COUNT(*) AS total FROM necessidade_producao_pedidos WHERE necessidade_id = ?', [necessidade.id]);
      assert.equal(links.total, 0);
    }
    await assert.rejects(
      () => salvarNecessidade(db, {
        origem: 'MANUAL',
        descricao: 'Manual com pedido',
        pedidos: [demanda(1, [{ produto: 1, quantidade: 1 }])],
        itens: [{ descricao: 'Calda', quantidade: 1 }]
      }),
      (err) => err.code === 'PEDIDO_ORIGEM_INVALIDA'
    );
  });

  it('N. criar a necessidade não movimenta estoque', async () => {
    await pedido(15, 'PED-601', 1, [{ produto: 1, quantidade: 20 }]);
    const antes = await get(db, 'SELECT estoque_atual, saldo_fiscal, saldo_nao_fiscal FROM produtos WHERE id = 1');
    await consolidar([demanda(15, [{ produto: 1, quantidade: 20 }])], 'Sem estoque');
    const depois = await get(db, 'SELECT estoque_atual, saldo_fiscal, saldo_nao_fiscal FROM produtos WHERE id = 1');
    assert.deepEqual(depois, antes);
    const tabela = await get(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'estoque_movimentacoes'");
    if (tabela) {
      const movimentos = await get(db, "SELECT COUNT(*) AS total FROM estoque_movimentacoes WHERE origem = 'NECESSIDADE'");
      assert.equal(movimentos.total, 0);
    }
  });
});
