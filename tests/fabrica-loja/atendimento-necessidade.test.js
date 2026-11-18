/**
 * Atendimento da necessidade: solicitado, planejado, produzido e status.
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
const {
  salvarNecessidade,
  obterNecessidade,
  listarNecessidades,
  calcularAtendimentoNecessidade,
  MENSAGEM_NAO_CANCELA_ATENDIDA
} = require('../../backend/modules/fabrica-loja/NecessidadeProducaoService');
const { salvarOrdem, planejarOrdem, cancelarOrdem } = require('../../backend/modules/fabrica-loja/OrdemProducaoService');
const { executarProducao, iniciarProducao } = require('../../backend/modules/fabrica-loja/ProducaoExecucaoService');
const bootstrapExecucoes = require('../../backend/modules/fabrica-loja/migrations/006_ordem_producao_execucoes');

const dir = path.join(os.tmpdir(), 'cds-fabrica-loja-testes');
fs.mkdirSync(dir, { recursive: true });
const arquivo = path.join(dir, 'atendimento-necessidade.db');
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

describe('Atendimento da necessidade de produção', () => {
  let db;
  const fichas = {};

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
    await run(db, `CREATE TABLE pedidos_comerciais (id INTEGER PRIMARY KEY, codigo TEXT, status TEXT)`);
    await run(db, `CREATE TABLE pedido_itens (id INTEGER PRIMARY KEY, pedido_id INTEGER, produto_id INTEGER, quantidade REAL)`);
    await MotorEstoque.bootstrapMotorEstoqueSchema(db);
    await MotorEstoque.entrar(db, { produtoId: 9, quantidadeBase: 20000, origem: 'COMPRA', local: 'FABRICA' });
    for (const [id, nome] of [[1, 'Morango'], [2, 'Chocolate'], [3, 'Abacaxi']]) {
      const ficha = await salvarFicha(db, {
        codigo: 'FT-AT-' + id,
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

  async function necessidade(quantidade, produtoId, descricao) {
    return salvarNecessidade(db, {
      origem: 'ABASTECIMENTO',
      descricao: descricao || 'Demanda',
      itens: [{
        produto_id: produtoId || 1,
        descricao: 'Picolé',
        quantidade,
        unidade: 'UN',
        ficha_tecnica_id: fichas[produtoId || 1]
      }]
    });
  }

  async function produzir(necessidadeId, itemId, produtoId, planejada, produzida, perdida, chave) {
    const ordem = await salvarOrdem(db, {
      necessidade_id: necessidadeId,
      itens: [{ necessidade_item_id: itemId, produto_id: produtoId, quantidade_planejada: planejada, unidade: 'UN' }]
    });
    await planejarOrdem(db, ordem.id);
    if (produzida == null) return ordem;
    await iniciarProducao(db, ordem.id);
    await executarProducao(db, ordem.id, {
      correlation_id: chave,
      quantidade_produzida: produzida,
      quantidade_perdida: perdida || 0
    });
    return ordem;
  }

  it('1 e 2. necessidade nova e OP só planejada continuam abertas', async () => {
    const nova = await necessidade(100, 1, 'Nova');
    assert.equal(nova.status, 'ABERTA');
    assert.equal(nova.atendimento.solicitado, 100);
    assert.equal(nova.atendimento.produzido, 0);
    assert.equal(nova.atendimento.restante, 100);

    const planejada = await necessidade(100, 1, 'Só plano');
    await produzir(planejada.id, planejada.itens[0].id, 1, 100, null);
    const atendimento = await calcularAtendimentoNecessidade(db, planejada.id);
    assert.equal(atendimento.planejado, 100);
    assert.equal(atendimento.produzido, 0);
    assert.equal(atendimento.restante, 100);
    assert.equal(atendimento.status, 'ABERTA');
  });

  it('3 e 4. produção parcial e completa mudam o status', async () => {
    const parcial = await necessidade(100, 1, 'Parcial');
    await produzir(parcial.id, parcial.itens[0].id, 1, 100, 60, 40, 'parcial-60');
    const meio = await obterNecessidade(db, parcial.id);
    assert.equal(meio.status, 'PARCIALMENTE_ATENDIDA');
    assert.equal(meio.atendimento.produzido, 60);
    assert.equal(meio.atendimento.restante, 40);
    const filtro = await listarNecessidades(db, { atendimento: 'PARCIALMENTE_ATENDIDA' });
    assert.equal(filtro.some((item) => item.id === parcial.id), true);

    const completa = await necessidade(100, 1, 'Completa');
    await produzir(completa.id, completa.itens[0].id, 1, 100, 100, 0, 'completa-100');
    const fim = await calcularAtendimentoNecessidade(db, completa.id);
    assert.equal(fim.status, 'ATENDIDA');
    assert.equal(fim.restante, 0);
  });

  it('5. OP cancelada não entra no planejado nem no produzido', async () => {
    const base = await necessidade(1000, 1, 'Com cancelada');
    const item = base.itens[0].id;
    await produzir(base.id, item, 1, 400, 400, 0, 'canc-400');
    const cancelada = await salvarOrdem(db, {
      necessidade_id: base.id,
      itens: [{ necessidade_item_id: item, produto_id: 1, quantidade_planejada: 300, unidade: 'UN' }]
    });
    await cancelarOrdem(db, cancelada.id);
    await produzir(base.id, item, 1, 200, null);
    const atendimento = await calcularAtendimentoNecessidade(db, base.id);
    assert.equal(atendimento.planejado, 600);
    assert.equal(atendimento.produzido, 400);
    assert.equal(atendimento.restante, 600);
    assert.equal(atendimento.status, 'PARCIALMENTE_ATENDIDA');
  });

  it('6. várias OPs somam só o que foi produzido', async () => {
    const base = await necessidade(1000, 1, 'Várias OPs');
    const item = base.itens[0].id;
    await produzir(base.id, item, 1, 300, 300, 0, 'op-300');
    await produzir(base.id, item, 1, 200, 200, 0, 'op-200');
    await produzir(base.id, item, 1, 100, 100, 0, 'op-100');
    const atendimento = await calcularAtendimentoNecessidade(db, base.id);
    assert.equal(atendimento.produzido, 600);
    assert.equal(atendimento.restante, 400);
    assert.equal(atendimento.status, 'PARCIALMENTE_ATENDIDA');
  });

  it('7. perda não atende a necessidade', async () => {
    const base = await necessidade(1000, 1, 'Perda');
    await produzir(base.id, base.itens[0].id, 1, 1000, 900, 100, 'perda-100');
    const atendimento = await calcularAtendimentoNecessidade(db, base.id);
    assert.equal(atendimento.planejado, 1000);
    assert.equal(atendimento.produzido, 900);
    assert.equal(atendimento.restante, 100);
    assert.equal(atendimento.status, 'PARCIALMENTE_ATENDIDA');
  });

  it('8. vários produtos só fecham quando todos zeram o restante', async () => {
    const base = await salvarNecessidade(db, {
      origem: 'ABASTECIMENTO',
      descricao: 'Três produtos',
      itens: [
        { produto_id: 1, descricao: 'Picolé Morango', quantidade: 500, unidade: 'UN', ficha_tecnica_id: fichas[1] },
        { produto_id: 2, descricao: 'Picolé Chocolate', quantidade: 300, unidade: 'UN', ficha_tecnica_id: fichas[2] },
        { produto_id: 3, descricao: 'Picolé Abacaxi', quantidade: 200, unidade: 'UN', ficha_tecnica_id: fichas[3] }
      ]
    });
    const morango = base.itens.find((item) => item.produto_id === 1);
    const chocolate = base.itens.find((item) => item.produto_id === 2);
    const abacaxi = base.itens.find((item) => item.produto_id === 3);
    await produzir(base.id, morango.id, 1, 500, 500, 0, 'mix-morango');
    await produzir(base.id, chocolate.id, 2, 300, 180, 120, 'mix-chocolate');
    await produzir(base.id, abacaxi.id, 3, 100, 100, 0, 'mix-abacaxi');
    const atendimento = await calcularAtendimentoNecessidade(db, base.id);
    const porProduto = new Map(atendimento.itens.map((item) => [item.produto_id, item]));
    assert.equal(porProduto.get(1).restante, 0);
    assert.equal(porProduto.get(2).produzido, 180);
    assert.equal(porProduto.get(2).restante, 120);
    assert.equal(porProduto.get(3).planejado, 100);
    assert.equal(porProduto.get(3).restante, 100);
    assert.equal(atendimento.status, 'PARCIALMENTE_ATENDIDA');
  });

  it('9. a consolidação de vários pedidos continua sendo a demanda', async () => {
    await run(db, "INSERT INTO pedidos_comerciais (id, codigo, status) VALUES (1, 'PED-101', 'ABERTO'), (2, 'PED-102', 'ABERTO')");
    await run(db, 'INSERT INTO pedido_itens (id, pedido_id, produto_id, quantidade) VALUES (1, 1, 1, 100), (2, 2, 1, 150)');
    const base = await salvarNecessidade(db, {
      origem: 'PEDIDO_LOJA',
      descricao: 'Dois pedidos',
      pedidos: [
        { pedido_id: 1, itens: [{ produto_id: 1, quantidade: 100, unidade: 'UN' }] },
        { pedido_id: 2, itens: [{ produto_id: 1, quantidade: 150, unidade: 'UN' }] }
      ]
    });
    assert.equal(base.itens.length, 1);
    assert.equal(base.itens[0].quantidade, 250);
    assert.equal(base.pedidos.length, 2);
    assert.equal(base.atendimento.solicitado, 250);
    assert.equal(base.status, 'ABERTA');
  });

  it('10. cancelar não estorna produção nem estoque', async () => {
    const base = await necessidade(100, 1, 'Cancelar resto');
    await produzir(base.id, base.itens[0].id, 1, 100, 60, 40, 'cancelar-60');
    const antes = await get(db, 'SELECT estoque_atual, saldo_fiscal, saldo_nao_fiscal FROM produtos WHERE id = 1');
    const ordem = await get(db, 'SELECT id, status FROM ordens_producao WHERE necessidade_id = ?', [base.id]);
    const cancelada = await salvarNecessidade(db, {
      origem: 'ABASTECIMENTO',
      descricao: 'Cancelar resto',
      status: 'CANCELADA',
      itens: [{ produto_id: 1, descricao: 'Picolé', quantidade: 100, unidade: 'UN', ficha_tecnica_id: fichas[1] }]
    }, base.id);
    const depois = await get(db, 'SELECT estoque_atual, saldo_fiscal, saldo_nao_fiscal FROM produtos WHERE id = 1');
    const ordemDepois = await get(db, 'SELECT status FROM ordens_producao WHERE id = ?', [ordem.id]);
    assert.equal(cancelada.status, 'CANCELADA');
    assert.equal(cancelada.atendimento.produzido, 60);
    assert.equal(cancelada.atendimento.restante, 40);
    assert.deepEqual(depois, antes);
    assert.equal(ordemDepois.status, 'CONCLUIDA');
    await assert.rejects(
      () => salvarNecessidade(db, {
        origem: 'ABASTECIMENTO',
        descricao: 'Cancelar resto',
        status: 'CANCELADA',
        itens: [{ produto_id: 1, descricao: 'Picolé', quantidade: 100, unidade: 'UN' }]
      }, base.id),
      (err) => err.message === 'A necessidade já está cancelada.'
    );

    const cheia = await necessidade(50, 1, 'Já atendida');
    await produzir(cheia.id, cheia.itens[0].id, 1, 50, 50, 0, 'nao-cancela');
    await assert.rejects(
      () => salvarNecessidade(db, {
        origem: 'ABASTECIMENTO',
        descricao: 'Já atendida',
        status: 'CANCELADA',
        itens: [{ produto_id: 1, descricao: 'Picolé', quantidade: 50, unidade: 'UN' }]
      }, cheia.id),
      (err) => err.message === MENSAGEM_NAO_CANCELA_ATENDIDA
    );
  });

  it('protege restante quando a execução passa do solicitado e completa o ciclo 1000', async () => {
    const base = await necessidade(1000, 1, 'Ciclo oficial');
    const item = base.itens[0].id;
    await produzir(base.id, item, 1, 600, 500, 100, 'ciclo-500');
    const meio = await calcularAtendimentoNecessidade(db, base.id);
    assert.equal(meio.solicitado, 1000);
    assert.equal(meio.planejado, 600);
    assert.equal(meio.produzido, 500);
    assert.equal(meio.restante, 500);
    assert.equal(meio.status, 'PARCIALMENTE_ATENDIDA');
    await produzir(base.id, item, 1, 500, 500, 0, 'ciclo-mais-500');
    const fim = await calcularAtendimentoNecessidade(db, base.id);
    assert.equal(fim.planejado, 1100);
    assert.equal(fim.produzido, 1000);
    assert.equal(fim.restante, 0);
    assert.equal(fim.status, 'ATENDIDA');

    const extra = await necessidade(1000, 2, 'Acima');
    const ordem = await salvarOrdem(db, {
      necessidade_id: extra.id,
      itens: [{ necessidade_item_id: extra.itens[0].id, produto_id: 2, quantidade_planejada: 1000, unidade: 'UN' }]
    });
    await bootstrapExecucoes(db);
    await run(db, "UPDATE ordens_producao SET status = 'CONCLUIDA' WHERE id = ?", [ordem.id]);
    await run(db, `
      INSERT INTO ordem_producao_execucoes (ordem_id, correlation_id, snapshot_json, local, quantidade_produzida)
      VALUES (?, 'acima', ?, 'FABRICA', 1050)
    `, [ordem.id, JSON.stringify({ produzidos: [{ produto_id: 2, quantidade_produzida: 1050 }] })]);
    const acima = await calcularAtendimentoNecessidade(db, extra.id);
    assert.equal(acima.produzido, 1050);
    assert.equal(acima.restante, 0);
    assert.equal(acima.status, 'ATENDIDA');
  });
});
