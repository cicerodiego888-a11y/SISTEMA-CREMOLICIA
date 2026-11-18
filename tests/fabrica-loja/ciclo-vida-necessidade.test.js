/**
 * Ciclo de vida da necessidade: origem, ordens, produção e atendimento.
 * Banco temporário. Não usa o banco oficial.
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
const { salvarNecessidade, obterNecessidade } = require('../../backend/modules/fabrica-loja/NecessidadeProducaoService');
const {
  salvarOrdem,
  planejarOrdem,
  cancelarOrdem,
  coberturaNecessidade,
  MENSAGEM_QUANTIDADE
} = require('../../backend/modules/fabrica-loja/OrdemProducaoService');
const { executarProducao, iniciarProducao } = require('../../backend/modules/fabrica-loja/ProducaoExecucaoService');

const dir = path.join(os.tmpdir(), 'cds-fabrica-loja-testes');
fs.mkdirSync(dir, { recursive: true });
const arquivo = path.join(dir, 'ciclo-vida-necessidade.db');
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

describe('Ciclo de vida da necessidade de produção', () => {
  let db;
  const fichas = {};
  let movimentosIniciais = 0;

  before(async () => {
    db = abrir();
    await run(db, `
      CREATE TABLE produtos (
        id INTEGER PRIMARY KEY, nome TEXT, unidade TEXT,
        estoque_atual REAL DEFAULT 0, saldo_fiscal REAL DEFAULT 0, saldo_nao_fiscal REAL DEFAULT 0,
        natureza_cadastro TEXT, ativo INTEGER DEFAULT 1, controlar_validade INTEGER DEFAULT 0, updated_at TEXT
      )
    `);
    await run(db, `INSERT INTO produtos (id, nome, unidade, natureza_cadastro) VALUES
      (1, 'Picolé Morango', 'UN', 'PRODUZIDO'),
      (2, 'Picolé Chocolate', 'UN', 'PRODUZIDO'),
      (3, 'Picolé Abacaxi', 'UN', 'PRODUZIDO'),
      (9, 'Leite', 'UN', 'INSUMO')`);
    await run(db, `CREATE TABLE clientes (id INTEGER PRIMARY KEY, nome TEXT)`);
    await run(db, `INSERT INTO clientes (id, nome) VALUES (1, 'Loja Centro')`);
    await run(db, `
      CREATE TABLE pedidos_comerciais (
        id INTEGER PRIMARY KEY, codigo TEXT, status TEXT, cliente_id INTEGER, created_at TEXT
      )
    `);
    await run(db, `CREATE TABLE pedido_itens (id INTEGER PRIMARY KEY, pedido_id INTEGER, produto_id INTEGER, quantidade REAL)`);
    await run(db, `INSERT INTO pedidos_comerciais (id, codigo, status, cliente_id, created_at) VALUES
      (101, 'PED-101', 'ABERTO', 1, '2026-10-06 09:00:00'),
      (102, 'PED-102', 'ABERTO', 1, '2026-10-06 09:10:00'),
      (103, 'PED-103', 'ABERTO', 1, '2026-10-06 09:20:00')`);
    await run(db, `INSERT INTO pedido_itens (id, pedido_id, produto_id, quantidade) VALUES
      (1, 101, 1, 300), (2, 102, 1, 400), (3, 103, 1, 300),
      (4, 101, 2, 120), (5, 101, 3, 50)`);
    await MotorEstoque.bootstrapMotorEstoqueSchema(db);
    await MotorEstoque.entrar(db, { produtoId: 9, quantidadeBase: 50000, origem: 'COMPRA', local: 'FABRICA' });
    const contagem = await get(db, 'SELECT COUNT(*) AS total FROM estoque_movimentacoes');
    movimentosIniciais = Number(contagem.total);
    for (const [id, nome] of [[1, 'Morango'], [2, 'Chocolate'], [3, 'Abacaxi']]) {
      const ficha = await salvarFicha(db, {
        codigo: 'FT-CV-' + id,
        nome,
        produto_id: id,
        rendimento_quantidade: 1,
        rendimento_unidade: 'UN',
        componentes: [{ produto_id: 9, quantidade: 1, unidade: 'UN' }]
      });
      fichas[id] = ficha.id;
    }
  });

  after(() => db.close());

  async function movimentos() {
    const row = await get(db, 'SELECT COUNT(*) AS total FROM estoque_movimentacoes');
    return Number(row.total);
  }

  async function produzir(necessidadeId, itemId, produtoId, planejada, produzida, perdida, chave) {
    const ordem = await salvarOrdem(db, {
      necessidade_id: necessidadeId,
      itens: [{
        necessidade_item_id: itemId,
        produto_id: produtoId,
        quantidade_planejada: planejada,
        unidade: 'UN',
        ficha_tecnica_id: fichas[produtoId]
      }]
    });
    await planejarOrdem(db, ordem.id);
    if (produzida == null) return obterNecessidade(db, necessidadeId);
    await iniciarProducao(db, ordem.id);
    await executarProducao(db, ordem.id, {
      correlation_id: chave,
      quantidade_produzida: produzida,
      quantidade_perdida: perdida || 0
    });
    return obterNecessidade(db, necessidadeId);
  }

  it('1. detalhe traz origem, itens, ordens, produção e resumo', async () => {
    const criada = await salvarNecessidade(db, {
      origem: 'MANUAL',
      descricao: 'Detalhe',
      itens: [{ produto_id: 1, descricao: 'Picolé Morango', quantidade: 100, unidade: 'UN', ficha_tecnica_id: fichas[1] }]
    });
    assert.equal(await movimentos(), movimentosIniciais);
    const depois = await produzir(criada.id, criada.itens[0].id, 1, 100, 100, 0, 'cv-detalhe');
    assert.ok(depois.resumo);
    assert.equal(depois.resumo.solicitado, 100);
    assert.equal(depois.resumo.produzido, 100);
    assert.equal(depois.resumo.restante, 0);
    assert.equal(depois.origem_nome, 'Manual');
    assert.equal(depois.pedidos.length, 0);
    assert.equal(depois.ordens_producao.length, 1);
    assert.equal(depois.ordens_producao[0].produzido, 100);
    assert.equal(depois.ordens_producao[0].producoes[0].produzido, 100);
    assert.equal(depois.atendimento.itens[0].situacao, 'ATENDIDO');
    assert.ok(depois.historico.some((evento) => evento.texto === 'Necessidade criada'));
    assert.ok(depois.historico.some((evento) => evento.texto === 'Necessidade atendida'));
  });

  it('2. três pedidos viram uma necessidade consolidada', async () => {
    const necessidade = await salvarNecessidade(db, {
      origem: 'PEDIDO_LOJA',
      descricao: 'Loja',
      pedidos: [
        { pedido_id: 101, itens: [{ produto_id: 1, quantidade: 300, unidade: 'UN' }] },
        { pedido_id: 102, itens: [{ produto_id: 1, quantidade: 400, unidade: 'UN' }] },
        { pedido_id: 103, itens: [{ produto_id: 1, quantidade: 300, unidade: 'UN' }] }
      ]
    });
    const detalhe = await obterNecessidade(db, necessidade.id);
    assert.equal(detalhe.itens.length, 1);
    assert.equal(detalhe.resumo.solicitado, 1000);
    assert.equal(detalhe.origem_nome, 'Pedidos da Loja');
    assert.deepEqual(detalhe.pedidos.map((pedido) => pedido.codigo), ['PED-101', 'PED-102', 'PED-103']);
    assert.equal(detalhe.pedidos[0].cliente_nome, 'Loja Centro');
    assert.equal(detalhe.pedidos[0].itens[0].quantidade, 300);
    assert.equal(detalhe.pedidos[1].itens[0].quantidade, 400);
    assert.equal(detalhe.pedidos[2].itens[0].quantidade, 300);
    const pedido = await get(db, 'SELECT status FROM pedidos_comerciais WHERE id = 101');
    assert.equal(pedido.status, 'ABERTO');
    const antes = await movimentos();
    const deNovo = await obterNecessidade(db, necessidade.id);
    assert.equal(deNovo.resumo.solicitado, 1000);
    assert.equal(await movimentos(), antes);
  });

  it('3. ordem só planejada mantém a necessidade aberta', async () => {
    const criada = await salvarNecessidade(db, {
      origem: 'PLANEJAMENTO',
      descricao: 'Plano',
      itens: [{ produto_id: 1, descricao: 'Picolé Morango', quantidade: 80, unidade: 'UN', ficha_tecnica_id: fichas[1] }]
    });
    const detalhe = await produzir(criada.id, criada.itens[0].id, 1, 80, null);
    assert.equal(detalhe.status, 'ABERTA');
    assert.equal(detalhe.resumo.produzido, 0);
    assert.equal(detalhe.resumo.planejado, 80);
    assert.equal(detalhe.aviso, 'Nenhuma quantidade foi efetivamente produzida.');
    assert.equal(detalhe.origem_nome, 'Planejamento');
    assert.equal(detalhe.pedidos.length, 0);
    assert.equal(detalhe.pode_criar_op, false);
    assert.equal(detalhe.pode_cancelar, true);
  });

  it('4 e 5. produção parcial e depois completa', async () => {
    const criada = await salvarNecessidade(db, {
      origem: 'ABASTECIMENTO',
      descricao: 'Parcial',
      itens: [{ produto_id: 2, descricao: 'Picolé Chocolate', quantidade: 200, unidade: 'UN', ficha_tecnica_id: fichas[2] }]
    });
    const parcial = await produzir(criada.id, criada.itens[0].id, 2, 80, 80, 0, 'cv-parcial');
    assert.equal(parcial.status, 'PARCIALMENTE_ATENDIDA');
    assert.equal(parcial.resumo.produzido, 80);
    assert.equal(parcial.resumo.restante, 120);
    assert.equal(parcial.aviso, 'Ainda falta produzir: 120');
    assert.equal(parcial.pode_criar_op, true);
    assert.equal(parcial.atendimento.itens[0].situacao, 'PARCIAL');
    assert.equal(parcial.origem_nome, 'Abastecimento interno');

    const completa = await produzir(criada.id, criada.itens[0].id, 2, 120, 120, 0, 'cv-completa');
    assert.equal(completa.status, 'ATENDIDA');
    assert.equal(completa.resumo.restante, 0);
    assert.equal(completa.pode_criar_op, false);
    assert.equal(completa.pode_cancelar, false);
  });

  it('6. ordem cancelada aparece e não conta no atendimento', async () => {
    const criada = await salvarNecessidade(db, {
      origem: 'MANUAL',
      descricao: 'Cancelada na ordem',
      itens: [{ produto_id: 1, descricao: 'Picolé Morango', quantidade: 300, unidade: 'UN', ficha_tecnica_id: fichas[1] }]
    });
    const cancelada = await salvarOrdem(db, {
      necessidade_id: criada.id,
      itens: [{ necessidade_item_id: criada.itens[0].id, produto_id: 1, quantidade_planejada: 300, unidade: 'UN' }]
    });
    await cancelarOrdem(db, cancelada.id);
    const detalhe = await produzir(criada.id, criada.itens[0].id, 1, 100, 100, 0, 'cv-depois-cancelada');
    const historica = detalhe.ordens_producao.find((ordem) => ordem.id === cancelada.id);
    assert.equal(historica.status, 'CANCELADA');
    assert.equal(historica.conta_atendimento, false);
    assert.equal(historica.produzido, 0);
    assert.equal(historica.planejado, 300);
    assert.equal(detalhe.resumo.planejado, 100);
    assert.equal(detalhe.resumo.produzido, 100);
    assert.ok(detalhe.historico.some((evento) => /cancelada/.test(evento.texto)));
  });

  it('7 e 8. nova ordem usa o restante e o excedente é bloqueado', async () => {
    const criada = await salvarNecessidade(db, {
      origem: 'MANUAL',
      descricao: 'Restante',
      itens: [{ produto_id: 3, descricao: 'Picolé Abacaxi', quantidade: 1000, unidade: 'UN', ficha_tecnica_id: fichas[3] }]
    });
    await produzir(criada.id, criada.itens[0].id, 3, 700, 700, 0, 'cv-setecentos');
    const cobertura = await coberturaNecessidade(db, criada.id);
    assert.equal(cobertura.itens[0].restante, 300);
    await assert.rejects(
      () => salvarOrdem(db, {
        necessidade_id: criada.id,
        itens: [{ necessidade_item_id: criada.itens[0].id, produto_id: 3, quantidade_planejada: 301, unidade: 'UN' }]
      }),
      (err) => err.message === MENSAGEM_QUANTIDADE
    );
    const nova = await salvarOrdem(db, {
      necessidade_id: criada.id,
      itens: [{ necessidade_item_id: criada.itens[0].id, produto_id: 3, quantidade_planejada: 300, unidade: 'UN' }]
    });
    const detalhe = await obterNecessidade(db, criada.id);
    assert.equal(nova.status, 'RASCUNHO');
    assert.equal(detalhe.resumo.solicitado, 1000);
    assert.equal(detalhe.resumo.planejado, 1000);
    assert.equal(detalhe.resumo.produzido, 700);
    assert.equal(detalhe.resumo.restante, 300);
    assert.equal(detalhe.status, 'PARCIALMENTE_ATENDIDA');
  });

  it('9. a ordem pode incluir só parte dos produtos', async () => {
    const criada = await salvarNecessidade(db, {
      origem: 'MANUAL',
      descricao: 'Vários',
      itens: [
        { produto_id: 1, descricao: 'Picolé Morango', quantidade: 100, unidade: 'UN', ficha_tecnica_id: fichas[1] },
        { produto_id: 2, descricao: 'Picolé Chocolate', quantidade: 120, unidade: 'UN', ficha_tecnica_id: fichas[2] },
        { produto_id: 3, descricao: 'Picolé Abacaxi', quantidade: 50, unidade: 'UN', ficha_tecnica_id: fichas[3] }
      ]
    });
    const cobertura = await coberturaNecessidade(db, criada.id);
    const escolhidos = cobertura.itens.filter((item) => item.produto_id !== 3);
    const ordem = await salvarOrdem(db, {
      necessidade_id: criada.id,
      itens: escolhidos.map((item) => ({
        necessidade_item_id: item.necessidade_item_id,
        produto_id: item.produto_id,
        quantidade_planejada: item.restante,
        unidade: 'UN'
      }))
    });
    assert.equal(ordem.itens.length, 2);
    assert.equal(ordem.itens.some((item) => item.produto_id === 3), false);
    const detalhe = await obterNecessidade(db, criada.id);
    assert.equal(detalhe.status, 'ABERTA');
    assert.equal(detalhe.atendimento.itens.find((item) => item.produto_id === 3).restante, 50);
    assert.equal(detalhe.atendimento.itens.find((item) => item.produto_id === 3).situacao, 'ABERTA');
  });

  it('10. necessidade atendida não oferece nova ordem nem cancelamento', async () => {
    const criada = await salvarNecessidade(db, {
      origem: 'MANUAL',
      descricao: 'Fechada',
      itens: [{ produto_id: 2, descricao: 'Picolé Chocolate', quantidade: 40, unidade: 'UN', ficha_tecnica_id: fichas[2] }]
    });
    const detalhe = await produzir(criada.id, criada.itens[0].id, 2, 40, 40, 0, 'cv-fechada');
    assert.equal(detalhe.status, 'ATENDIDA');
    assert.equal(detalhe.pode_criar_op, false);
    assert.equal(detalhe.pode_cancelar, false);
    await assert.rejects(
      () => salvarOrdem(db, {
        necessidade_id: criada.id,
        itens: [{ necessidade_item_id: criada.itens[0].id, produto_id: 2, quantidade_planejada: 1, unidade: 'UN' }]
      }),
      (err) => err.message === 'A necessidade de produção já foi atendida.'
    );
    await assert.rejects(
      () => salvarNecessidade(db, {
        origem: 'MANUAL',
        descricao: detalhe.descricao,
        status: 'CANCELADA',
        itens: detalhe.itens
      }, criada.id),
      (err) => /não pode ser cancelada/.test(err.message)
    );
  });

  it('11. necessidade cancelada não gera nova ordem', async () => {
    const criada = await salvarNecessidade(db, {
      origem: 'MANUAL',
      descricao: 'Encerrar',
      itens: [{ produto_id: 1, descricao: 'Picolé Morango', quantidade: 10, unidade: 'UN', ficha_tecnica_id: fichas[1] }]
    });
    const cancelada = await salvarNecessidade(db, {
      origem: 'MANUAL',
      descricao: criada.descricao,
      status: 'CANCELADA',
      itens: criada.itens
    }, criada.id);
    assert.equal(cancelada.status, 'CANCELADA');
    assert.equal(cancelada.pode_criar_op, false);
    assert.equal(cancelada.pode_cancelar, false);
    assert.equal(cancelada.itens.length, 1);
    await assert.rejects(
      () => salvarOrdem(db, {
        necessidade_id: criada.id,
        itens: [{ necessidade_item_id: criada.itens[0].id, produto_id: 1, quantidade_planejada: 10, unidade: 'UN' }]
      }),
      (err) => err.message === 'A necessidade cancelada não gera ordem de produção.'
    );
  });

  it('aceite: 300 + 400 + 300, produção 500 e depois 500', async () => {
    const row = await get(db, `SELECT id FROM necessidades_producao WHERE descricao = 'Loja'`);
    const necessidade = await obterNecessidade(db, row.id);
    assert.equal(necessidade.resumo.solicitado, 1000);
    assert.deepEqual(necessidade.pedidos.map((pedido) => pedido.itens[0].quantidade), [300, 400, 300]);
    const antes = await movimentos();
    const parcial = await produzir(necessidade.id, necessidade.itens[0].id, 1, 600, 500, 100, 'cv-aceite-1');
    assert.equal(parcial.resumo.solicitado, 1000);
    assert.equal(parcial.resumo.planejado, 600);
    assert.equal(parcial.resumo.produzido, 500);
    assert.equal(parcial.resumo.restante, 500);
    assert.equal(parcial.status, 'PARCIALMENTE_ATENDIDA');
    assert.equal(parcial.pode_criar_op, true);
    const depoisParcial = await movimentos();
    assert.ok(depoisParcial > antes);

    const final = await produzir(necessidade.id, necessidade.itens[0].id, 1, 500, 500, 0, 'cv-aceite-2');
    assert.equal(final.resumo.planejado, 1100);
    assert.equal(final.resumo.produzido, 1000);
    assert.equal(final.resumo.restante, 0);
    assert.equal(final.status, 'ATENDIDA');
    assert.equal(final.pode_criar_op, false);
    assert.equal(final.pode_cancelar, false);
    assert.equal(final.ordens_producao.length, 2);
    assert.equal(final.ordens_producao[0].produzido, 500);
    assert.equal(final.ordens_producao[0].producoes[0].perdido, 100);
    assert.equal(final.ordens_producao[1].produzido, 500);
    const transferencias = await get(db, `
      SELECT COUNT(*) AS total FROM sqlite_master
      WHERE type = 'table' AND name = 'transferencias_estoque'
    `);
    if (Number(transferencias.total) > 0) {
      const feitas = await get(db, 'SELECT COUNT(*) AS total FROM transferencias_estoque');
      assert.equal(Number(feitas.total), 0);
    }
  });
});
