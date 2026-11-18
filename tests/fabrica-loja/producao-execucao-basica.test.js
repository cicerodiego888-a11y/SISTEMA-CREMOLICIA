/**
 * PRODUÇÃO 01 — execução básica de uma OP EM_PRODUCAO pelo motor existente.
 * Consome insumos da FÁBRICA pela ficha vinculada, entra o produzido na FÁBRICA e conclui a OP.
 * Banco temporário. Não usa o banco oficial.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const { salvarOrdem, planejarOrdem, cancelarOrdem, obterOrdem } = require('../../backend/modules/fabrica-loja/OrdemProducaoService');
const {
  iniciarProducao,
  executarProducao,
  MENSAGEM_NAO_INICIADA,
  MENSAGEM_CONCLUIDA
} = require('../../backend/modules/fabrica-loja/ProducaoExecucaoService');
const MotorEstoque = require('../../backend/motores/motor-estoque');
const bootstrapFichas = require('../../backend/modules/fabrica-loja/migrations/002_fichas_tecnicas');
const bootstrapOrdens = require('../../backend/modules/fabrica-loja/migrations/005_ordens_producao');
const bootstrapExecucoes = require('../../backend/modules/fabrica-loja/migrations/006_ordem_producao_execucoes');
const bootstrapInicio = require('../../backend/modules/fabrica-loja/migrations/009_ordem_producao_inicio');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-producao-01-'));

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) { err ? reject(err) : resolve({ id: this.lastID }); });
  });
}
function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}
function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

async function fotografia(db) {
  const tabelas = await all(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  const foto = {};
  for (const { name } of tabelas) foto[name] = await all(db, `SELECT * FROM "${name}" ORDER BY rowid`);
  return JSON.stringify(foto);
}

async function saldos(db) {
  const linhas = await all(db, 'SELECT produto_id, local, estoque_atual FROM estoque_saldos_locais ORDER BY produto_id, local');
  return Object.fromEntries(linhas.map((l) => [`${l.produto_id}:${l.local}`, l.estoque_atual]));
}

describe('PRODUÇÃO 01 — execução básica da OP', () => {
  let db;
  const eventos = [];
  const contexto = { usuario_id: 4, usuario_nome: 'Operador', auditar(info) { eventos.push(info); } };

  async function opEmProducao(quantidade = 100) {
    const criada = await salvarOrdem(db, {
      origem: 'MANUAL',
      itens: [{ produto_id: 5, quantidade_planejada: quantidade, unidade: 'UN', ficha_tecnica_id: 1 }]
    });
    await planejarOrdem(db, criada.id);
    return iniciarProducao(db, criada.id);
  }

  before(async () => {
    db = new sqlite3.Database(path.join(dir, 'producao-01.db'));
    await run(db, `
      CREATE TABLE produtos (
        id INTEGER PRIMARY KEY, nome TEXT, unidade TEXT, estoque_atual REAL DEFAULT 0,
        saldo_fiscal REAL DEFAULT 0, saldo_nao_fiscal REAL DEFAULT 0, natureza_cadastro TEXT,
        ativo INTEGER DEFAULT 1, controlar_validade INTEGER DEFAULT 0, updated_at TEXT, preco_compra REAL
      )
    `);
    await bootstrapFichas(db);
    await bootstrapOrdens(db);
    await bootstrapExecucoes(db);
    await bootstrapInicio(db);
    await MotorEstoque.bootstrapMotorEstoqueSchema(db);
    await run(db, `INSERT INTO produtos (id, nome, unidade, estoque_atual, saldo_fiscal, natureza_cadastro, preco_compra) VALUES
      (1, 'Leite', 'L', 1300, 1300, 'INSUMO', 2),
      (2, 'Açúcar', 'KG', 700, 700, 'INSUMO', 3),
      (5, 'Picolé', 'UN', 40, 40, 'PRODUZIDO', NULL)`);
    await run(db, `INSERT INTO estoque_saldos_locais (produto_id, local, saldo_fiscal, saldo_nao_fiscal, estoque_atual) VALUES
      (1, 'FABRICA', 1000, 0, 1000), (2, 'FABRICA', 500, 0, 500), (5, 'FABRICA', 0, 0, 0),
      (1, 'LOJA', 300, 0, 300), (2, 'LOJA', 200, 0, 200), (5, 'LOJA', 40, 0, 40)`);
    await run(db, `INSERT INTO fichas_tecnicas (id, codigo, nome, produto_id, rendimento_quantidade, rendimento_unidade, ativa)
      VALUES (1, 'FT-PICOLE', 'Picolé', 5, 100, 'UN', 1)`);
    await run(db, `INSERT INTO ficha_tecnica_componentes (ficha_id, ordem, produto_id, descricao, quantidade, unidade) VALUES
      (1, 1, 1, 'Leite', 20, 'L'), (1, 2, 2, 'Açúcar', 5, 'KG')`);
  });

  after(async () => {
    await new Promise((resolve) => db.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('1 a 6 e 10. Homologação: OP EM_PRODUCAO de 100 Picolés consome Leite e Açúcar da FÁBRICA, entra 100 Picolés na FÁBRICA e conclui', async () => {
    const op = await opEmProducao(100);
    assert.equal(op.status, 'EM_PRODUCAO');
    const fichaAntes = JSON.stringify(await all(db, 'SELECT * FROM ficha_tecnica_componentes ORDER BY id'))
      + JSON.stringify(await all(db, 'SELECT * FROM fichas_tecnicas ORDER BY id'));
    assert.deepEqual(await saldos(db), {
      '1:FABRICA': 1000, '1:LOJA': 300, '2:FABRICA': 500, '2:LOJA': 200, '5:FABRICA': 0, '5:LOJA': 40
    });

    eventos.length = 0;
    const resultado = await executarProducao(db, op.id, { correlation_id: 'prod01-homolog' }, contexto);

    assert.equal(resultado.repetida, false);
    assert.equal(resultado.ordem.status, 'CONCLUIDA');
    assert.equal((await obterOrdem(db, op.id)).status, 'CONCLUIDA');
    assert.deepEqual(await saldos(db), {
      '1:FABRICA': 980, '1:LOJA': 300,
      '2:FABRICA': 495, '2:LOJA': 200,
      '5:FABRICA': 100, '5:LOJA': 40
    });
    assert.equal(resultado.execucao.quantidade_planejada, 100);
    assert.equal(resultado.execucao.quantidade_produzida, 100);
    assert.equal(resultado.execucao.quantidade_perdida, 0);
    assert.equal(resultado.execucao.local, 'FABRICA');

    const movimentos = await all(db, `
      SELECT produto_id, operacao, origem, motor, quantidade_base, referencia_tipo
      FROM estoque_movimentacoes WHERE referencia_id = ? ORDER BY id
    `, [resultado.execucao.id]);
    assert.deepEqual(movimentos.map((m) => [m.produto_id, m.operacao, m.quantidade_base]), [
      [1, 'SAIDA', 20], [2, 'SAIDA', 5], [5, 'ENTRADA', 100]
    ]);
    assert.ok(movimentos.every((m) => m.motor === 'MotorEstoque' && m.origem === 'PRODUCAO' && m.referencia_tipo === 'ordem_producao_execucao'));

    const consumos = resultado.execucao.snapshot.consumos.map((c) => [c.produto_id, c.quantidade_base]);
    assert.deepEqual(consumos, [[1, 20], [2, 5]]);
    assert.equal(resultado.execucao.snapshot.produzidos[0].ficha.codigo, 'FT-PICOLE');

    const fichaDepois = JSON.stringify(await all(db, 'SELECT * FROM ficha_tecnica_componentes ORDER BY id'))
      + JSON.stringify(await all(db, 'SELECT * FROM fichas_tecnicas ORDER BY id'));
    assert.equal(fichaDepois, fichaAntes, 'a ficha cadastrada não é alterada');

    assert.deepEqual(eventos.map((e) => e.acao), ['PRODUCAO_CONCLUIDA']);
    assert.equal(eventos[0].referencia_id, op.id);
    assert.equal(eventos[0].detalhes.produzido, 100);
    assert.equal(eventos[0].detalhes.execucao_id, resultado.execucao.id);
  });

  it('4. A quantidade consumida acompanha a quantidade planejada (250 Picolés = 2,5 × a ficha)', async () => {
    const antes = await saldos(db);
    const op = await opEmProducao(250);
    const resultado = await executarProducao(db, op.id, { correlation_id: 'prod01-250' });
    const depois = await saldos(db);
    assert.equal(resultado.execucao.quantidade_produzida, 250);
    assert.equal(antes['1:FABRICA'] - depois['1:FABRICA'], 50);
    assert.equal(antes['2:FABRICA'] - depois['2:FABRICA'], 12.5);
    assert.equal(depois['5:FABRICA'] - antes['5:FABRICA'], 250);
    assert.equal(depois['1:LOJA'], antes['1:LOJA']);
    assert.equal(depois['2:LOJA'], antes['2:LOJA']);
    assert.equal(depois['5:LOJA'], antes['5:LOJA']);
  });

  it('7 e 8. Falha depois do consumo e da entrada desfaz tudo: sem estoque parcial, sem execução, OP continua EM_PRODUCAO', async () => {
    const op = await opEmProducao(100);
    const antes = await fotografia(db);
    eventos.length = 0;
    await assert.rejects(executarProducao(db, op.id, { correlation_id: 'prod01-falha-consumo' }, {
      ...contexto,
      aposConsumo() { throw new Error('falha simulada após o consumo'); }
    }), /falha simulada após o consumo/);
    assert.equal(await fotografia(db), antes);

    await assert.rejects(executarProducao(db, op.id, { correlation_id: 'prod01-falha-conclusao' }, {
      ...contexto,
      aposConsumo: () => run(db, "UPDATE ordens_producao SET status = 'CANCELADA' WHERE id = ?", [op.id])
    }), (err) => err.code === 'OP_CONCLUIDA');
    assert.equal(await fotografia(db), antes, 'falha na conclusão, depois da entrada do produto, também desfaz tudo');
    assert.equal((await obterOrdem(db, op.id)).status, 'EM_PRODUCAO');
    assert.deepEqual(eventos, []);

    const ok = await executarProducao(db, op.id, { correlation_id: 'prod01-depois-da-falha' }, contexto);
    assert.equal(ok.ordem.status, 'CONCLUIDA');
  });

  it('9. Reexecutar a mesma OP não consome, não produz, não movimenta e não altera saldo', async () => {
    const op = await opEmProducao(100);
    const primeira = await executarProducao(db, op.id, { correlation_id: 'prod01-idem' }, contexto);
    const antes = await fotografia(db);
    eventos.length = 0;

    const mesmaChave = await executarProducao(db, op.id, { correlation_id: 'prod01-idem' }, contexto);
    assert.equal(mesmaChave.repetida, true);
    assert.equal(mesmaChave.execucao.id, primeira.execucao.id);
    assert.equal(mesmaChave.ordem.status, 'CONCLUIDA');

    await assert.rejects(executarProducao(db, op.id, { correlation_id: 'prod01-outra-chave' }, contexto), (err) => {
      assert.equal(err.code, 'OP_CONCLUIDA');
      assert.equal(err.message, MENSAGEM_CONCLUIDA);
      return true;
    });
    assert.equal(await fotografia(db), antes);
    assert.deepEqual(eventos, []);
  });

  it('11. OP PLANEJADA continua bloqueada', async () => {
    const criada = await salvarOrdem(db, {
      origem: 'MANUAL',
      itens: [{ produto_id: 5, quantidade_planejada: 100, unidade: 'UN', ficha_tecnica_id: 1 }]
    });
    await planejarOrdem(db, criada.id);
    const antes = await fotografia(db);
    await assert.rejects(executarProducao(db, criada.id, { correlation_id: 'prod01-planejada' }), (err) => {
      assert.equal(err.code, 'OP_NAO_INICIADA');
      assert.equal(err.message, MENSAGEM_NAO_INICIADA);
      return true;
    });
    assert.equal(await fotografia(db), antes);
  });

  it('12. OP CANCELADA e OP CONCLUÍDA continuam bloqueadas', async () => {
    const criada = await salvarOrdem(db, {
      origem: 'MANUAL',
      itens: [{ produto_id: 5, quantidade_planejada: 100, unidade: 'UN', ficha_tecnica_id: 1 }]
    });
    await planejarOrdem(db, criada.id);
    await cancelarOrdem(db, criada.id);
    const concluida = await get(db, "SELECT id FROM ordens_producao WHERE status = 'CONCLUIDA' ORDER BY id LIMIT 1");
    const antes = await fotografia(db);
    await assert.rejects(executarProducao(db, criada.id, { correlation_id: 'prod01-cancelada' }), (err) => err.code === 'OP_CANCELADA');
    await assert.rejects(executarProducao(db, concluida.id, { correlation_id: 'prod01-concluida' }), (err) => err.code === 'OP_CONCLUIDA');
    assert.equal(await fotografia(db), antes);
  });
});
