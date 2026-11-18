/**
 * Ciclo necessidade → produção → transferência. Banco temporário. Não usa o banco oficial.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const MotorEstoque = require('../../backend/motores/motor-estoque');
const { salvarNecessidade, obterNecessidade } = require('../../backend/modules/fabrica-loja/NecessidadeProducaoService');
const { salvarOrdem, planejarOrdem } = require('../../backend/modules/fabrica-loja/OrdemProducaoService');
const { executarProducao, previaProducao, iniciarProducao } = require('../../backend/modules/fabrica-loja/ProducaoExecucaoService');
const { salvarTransferencia, confirmarTransferencia } = require('../../backend/modules/fabrica-loja/TransferenciaEstoqueService');

const dir = path.join(os.tmpdir(), 'cds-fabrica-loja-testes');
fs.mkdirSync(dir, { recursive: true });
const arquivo = path.join(dir, 'ciclo-fabrica-loja.db');
for (const sufixo of ['', '-wal', '-shm']) fs.rmSync(arquivo + sufixo, { force: true });

function abrir() { return new sqlite3.Database(arquivo); }
function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => (err ? reject(err) : resolve()));
  });
}
function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

async function saldo(db, produtoId, local) {
  return MotorEstoque.consultarSaldoLocal(db, produtoId, local);
}

describe('Ciclo fábrica → loja', () => {
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
    await run(db, `INSERT INTO produtos (id, nome, unidade, natureza_cadastro) VALUES
      (1, 'Leite em pó', 'KG', 'INSUMO'),
      (2, 'Chocolate', 'KG', 'INSUMO'),
      (5, 'Picolé Chocolate', 'UN', 'PRODUZIDO')`);
    await MotorEstoque.bootstrapMotorEstoqueSchema(db);
    const { salvarFicha } = require('../../backend/modules/fabrica-loja/FichaTecnicaService');
    await salvarFicha(db, {
      codigo: 'FT-0001',
      nome: 'Picolé Chocolate',
      produto_id: 5,
      rendimento_quantidade: 100,
      rendimento_unidade: 'UN',
      componentes: [
        { produto_id: 1, quantidade: 20, unidade: 'KG' },
        { produto_id: 2, quantidade: 5, unidade: 'KG' }
      ]
    });
    await salvarFicha(db, {
      codigo: 'FT-LEITE',
      nome: 'Só leite',
      produto_id: 5,
      rendimento_quantidade: 1,
      rendimento_unidade: 'UN',
      componentes: [{ produto_id: 1, quantidade: 1, unidade: 'KG' }]
    });
  });

  after(() => db.close());

  it('fluxo completo: necessidade, OP, produção na fábrica e transferência para a loja', async () => {
    await MotorEstoque.entrar(db, { produtoId: 1, quantidadeBase: 120, origem: 'COMPRA', local: 'FABRICA' });
    await MotorEstoque.entrar(db, { produtoId: 2, quantidadeBase: 40, origem: 'COMPRA', local: 'FABRICA' });
    const necessidade = await salvarNecessidade(db, {
      origem: 'ABASTECIMENTO',
      descricao: 'Picolé Chocolate',
      itens: [{ produto_id: 5, descricao: 'Picolé Chocolate', quantidade: 500, unidade: 'UN', ficha_tecnica_id: 1 }]
    });
    assert.equal(necessidade.status, 'ABERTA');
    const criada = await salvarOrdem(db, {
      origem: 'NECESSIDADE',
      necessidade_id: necessidade.id,
      itens: [{
        produto_id: 5,
        quantidade_planejada: 500,
        unidade: 'UN',
        necessidade_item_id: necessidade.itens[0].id
      }]
    });
    const ordem = await planejarOrdem(db, criada.id);
    assert.equal(ordem.status, 'PLANEJADA');
    assert.equal(ordem.itens[0].ficha_tecnica_id, 1);
    assert.equal(ordem.necessidade_id, necessidade.id);
    const previa = await previaProducao(db, ordem.id);
    const leitePrevisto = previa.consumos.find((item) => item.produto_id === 1);
    const chocolatePrevisto = previa.consumos.find((item) => item.produto_id === 2);
    assert.equal(leitePrevisto.quantidade, 100);
    assert.equal(leitePrevisto.disponivel_fabrica, 120);
    assert.equal(chocolatePrevisto.quantidade, 25);
    assert.equal(chocolatePrevisto.disponivel_fabrica, 40);
    assert.equal((await iniciarProducao(db, ordem.id)).status, 'EM_PRODUCAO');
    await executarProducao(db, ordem.id, { correlation_id: 'ciclo-1', quantidade_produzida: 500, quantidade_perdida: 0 });
    assert.equal((await saldo(db, 1, 'FABRICA')).estoqueAtual, 20);
    assert.equal((await saldo(db, 1, 'LOJA')).estoqueAtual, 0);
    assert.equal((await saldo(db, 2, 'FABRICA')).estoqueAtual, 15);
    assert.equal((await saldo(db, 2, 'LOJA')).estoqueAtual, 0);
    assert.equal((await saldo(db, 5, 'FABRICA')).estoqueAtual, 500);
    assert.equal((await saldo(db, 5, 'LOJA')).estoqueAtual, 0);
    const doc = await salvarTransferencia(db, { itens: [{ produto_id: 5, quantidade: 200, unidade: 'UN' }] });
    await confirmarTransferencia(db, doc.id, { correlation_id: 'ciclo-trf' });
    assert.equal((await saldo(db, 5, 'FABRICA')).estoqueAtual, 300);
    assert.equal((await saldo(db, 5, 'LOJA')).estoqueAtual, 200);
    const oficial = await get(db, 'SELECT estoque_atual FROM produtos WHERE id = 5');
    assert.equal(oficial.estoque_atual, 500);
    const atendida = await obterNecessidade(db, necessidade.id);
    assert.equal(atendida.status, 'ATENDIDA');
    assert.equal(atendida.atendimento.produzido, 500);
    assert.equal(atendida.atendimento.restante, 0);
    const produtos = await get(db, 'SELECT COUNT(*) AS total FROM produtos');
    assert.equal(produtos.total, 3);
  });

  it('a loja não completa o consumo da fábrica', async () => {
    await MotorEstoque.entrar(db, { produtoId: 1, quantidadeBase: 80, origem: 'COMPRA', local: 'FABRICA' });
    await MotorEstoque.entrar(db, { produtoId: 1, quantidadeBase: 500, origem: 'COMPRA', local: 'LOJA' });
    assert.equal((await saldo(db, 1, 'FABRICA')).estoqueAtual, 100);
    assert.equal((await saldo(db, 1, 'LOJA')).estoqueAtual, 500);
    const criada = await salvarOrdem(db, {
      origem: 'MANUAL',
      itens: [{ produto_id: 5, quantidade_planejada: 100, unidade: 'UN', ficha_tecnica_id: 2 }]
    });
    const ordem = await planejarOrdem(db, criada.id);
    await iniciarProducao(db, ordem.id);
    await executarProducao(db, ordem.id, { correlation_id: 'ciclo-loja', quantidade_produzida: 100, quantidade_perdida: 0 });
    assert.equal((await saldo(db, 1, 'FABRICA')).estoqueAtual, 0);
    assert.equal((await saldo(db, 1, 'LOJA')).estoqueAtual, 500);
  });

  it('fábrica insuficiente bloqueia mesmo com loja cheia', async () => {
    await MotorEstoque.entrar(db, { produtoId: 1, quantidadeBase: 80, origem: 'COMPRA', local: 'FABRICA' });
    const antesFabrica = (await saldo(db, 1, 'FABRICA')).estoqueAtual;
    const antesLoja = (await saldo(db, 1, 'LOJA')).estoqueAtual;
    const movimentos = await get(db, 'SELECT COUNT(*) AS total FROM estoque_movimentacoes');
    const criada = await salvarOrdem(db, {
      origem: 'MANUAL',
      itens: [{ produto_id: 5, quantidade_planejada: 100, unidade: 'UN', ficha_tecnica_id: 2 }]
    });
    const ordem = await planejarOrdem(db, criada.id);
    // Simula OP iniciada antes de o saldo da fábrica cair: o próprio início já recusaria a falta.
    await run(db, "UPDATE ordens_producao SET status = 'EM_PRODUCAO' WHERE id = ?", [ordem.id]);
    await assert.rejects(
      () => executarProducao(db, ordem.id, { correlation_id: 'ciclo-falta', quantidade_produzida: 100, quantidade_perdida: 0 }),
      (err) => err.message === 'Estoque insuficiente de Leite em pó na Fábrica para executar esta produção.'
    );
    assert.equal((await saldo(db, 1, 'FABRICA')).estoqueAtual, antesFabrica);
    assert.equal((await saldo(db, 1, 'LOJA')).estoqueAtual, antesLoja);
    const depois = await get(db, 'SELECT COUNT(*) AS total FROM estoque_movimentacoes');
    assert.equal(depois.total, movimentos.total);
    const status = await get(db, 'SELECT status FROM ordens_producao WHERE id = ?', [ordem.id]);
    assert.equal(status.status, 'EM_PRODUCAO');
  });

  it('necessidade parcial aceita o restante e recusa o excesso', async () => {
    const necessidade = await salvarNecessidade(db, {
      origem: 'MANUAL',
      descricao: 'Reposição parcial',
      itens: [{ produto_id: 5, descricao: 'Picolé Chocolate', quantidade: 500, unidade: 'UN', ficha_tecnica_id: 1 }]
    });
    const item = necessidade.itens[0].id;
    const primeira = await salvarOrdem(db, {
      origem: 'NECESSIDADE',
      necessidade_id: necessidade.id,
      itens: [{ produto_id: 5, quantidade_planejada: 300, unidade: 'UN', necessidade_item_id: item }]
    });
    const segunda = await salvarOrdem(db, {
      origem: 'NECESSIDADE',
      necessidade_id: necessidade.id,
      itens: [{ produto_id: 5, quantidade_planejada: 200, unidade: 'UN', necessidade_item_id: item }]
    });
    assert.equal(primeira.itens[0].quantidade_planejada, 300);
    assert.equal(segunda.itens[0].quantidade_planejada, 200);
    await assert.rejects(() => salvarOrdem(db, {
      origem: 'NECESSIDADE',
      necessidade_id: necessidade.id,
      itens: [{ produto_id: 5, quantidade_planejada: 1, unidade: 'UN', necessidade_item_id: item }]
    }), (err) => err.message === 'Quantidade da OP superior ao restante da necessidade.');
    const aberta = await obterNecessidade(db, necessidade.id);
    assert.equal(aberta.status, 'ABERTA');
  });

  it('a mesma execução não produz duas vezes', async () => {
    const criada = await salvarOrdem(db, {
      origem: 'MANUAL',
      itens: [{ produto_id: 5, quantidade_planejada: 10, unidade: 'UN', ficha_tecnica_id: 2 }]
    });
    const ordem = await planejarOrdem(db, criada.id);
    await iniciarProducao(db, ordem.id);
    const antes = await get(db, 'SELECT COUNT(*) AS total FROM estoque_movimentacoes');
    await executarProducao(db, ordem.id, { correlation_id: 'ciclo-idem', quantidade_produzida: 10, quantidade_perdida: 0 });
    const repetida = await executarProducao(db, ordem.id, { correlation_id: 'ciclo-idem', quantidade_produzida: 10, quantidade_perdida: 0 });
    assert.equal(repetida.repetida, true);
    const depois = await get(db, 'SELECT COUNT(*) AS total FROM estoque_movimentacoes');
    assert.equal(depois.total - antes.total, 2);
  });

  it('erro no meio não baixa insumo nem conclui a ordem', async () => {
    const leiteAntes = (await saldo(db, 1, 'FABRICA')).estoqueAtual;
    const criada = await salvarOrdem(db, {
      origem: 'MANUAL',
      itens: [{ produto_id: 5, quantidade_planejada: 10, unidade: 'UN', ficha_tecnica_id: 2 }]
    });
    const ordem = await planejarOrdem(db, criada.id);
    await iniciarProducao(db, ordem.id);
    await assert.rejects(() => executarProducao(db, ordem.id, { correlation_id: 'ciclo-rollback', quantidade_produzida: 10, quantidade_perdida: 0 }, {
      aposConsumo() { throw new Error('falha simulada'); }
    }));
    assert.equal((await saldo(db, 1, 'FABRICA')).estoqueAtual, leiteAntes);
    const status = await get(db, 'SELECT status FROM ordens_producao WHERE id = ?', [ordem.id]);
    assert.equal(status.status, 'EM_PRODUCAO');
    const picole = await get(db, 'SELECT COUNT(*) AS total FROM ordem_producao_execucoes WHERE correlation_id = ?', ['ciclo-rollback']);
    assert.equal(picole.total, 0);
  });
});
