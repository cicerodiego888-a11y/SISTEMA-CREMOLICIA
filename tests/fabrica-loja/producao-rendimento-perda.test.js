/**
 * PRODUÇÃO 02 — produzido + perdido na execução da OP.
 * Regra: produzido + perdido = planejado; só o produzido entra na FÁBRICA; a perda fica registrada na execução.
 * Banco temporário. Não usa o banco oficial.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const { salvarOrdem, planejarOrdem, obterOrdem } = require('../../backend/modules/fabrica-loja/OrdemProducaoService');
const {
  iniciarProducao,
  executarProducao,
  MENSAGEM_ACIMA,
  MENSAGEM_RESULTADO,
  MENSAGEM_PRODUZIDA_NEGATIVA,
  MENSAGEM_PERDIDA_NEGATIVA,
  MENSAGEM_CONCLUIDA
} = require('../../backend/modules/fabrica-loja/ProducaoExecucaoService');
const MotorEstoque = require('../../backend/motores/motor-estoque');
const bootstrapFichas = require('../../backend/modules/fabrica-loja/migrations/002_fichas_tecnicas');
const bootstrapOrdens = require('../../backend/modules/fabrica-loja/migrations/005_ordens_producao');
const bootstrapExecucoes = require('../../backend/modules/fabrica-loja/migrations/006_ordem_producao_execucoes');
const bootstrapInicio = require('../../backend/modules/fabrica-loja/migrations/009_ordem_producao_inicio');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-producao-02-'));

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) { err ? reject(err) : resolve({ id: this.lastID }); });
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

describe('PRODUÇÃO 02 — rendimento e perda na execução', () => {
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
    db = new sqlite3.Database(path.join(dir, 'producao-02.db'));
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

  for (const [caso, produzido, perdido, rendimento] of [['A', 100, 0, 100], ['B', 95, 5, 95], ['C', 90, 10, 90]]) {
    it(`1 a 3, 7, 8 e 11. Caso ${caso}: planejado 100, produzido ${produzido} e perdido ${perdido} → FÁBRICA +${produzido}, perda registrada, OP CONCLUÍDA`, async () => {
      const op = await opEmProducao(100);
      const antes = await saldos(db);
      eventos.length = 0;
      const resultado = await executarProducao(db, op.id, {
        correlation_id: `prod02-caso-${caso}`,
        quantidade_produzida: String(produzido),
        quantidade_perdida: String(perdido),
        motivo_perda: perdido ? 'Quebra' : ''
      }, contexto);
      const depois = await saldos(db);

      assert.equal(resultado.ordem.status, 'CONCLUIDA');
      assert.equal((await obterOrdem(db, op.id)).status, 'CONCLUIDA');
      assert.equal(depois['5:FABRICA'] - antes['5:FABRICA'], produzido, 'só o produzido entra na FÁBRICA');
      assert.equal(depois['1:FABRICA'] - antes['1:FABRICA'], -20, 'insumo segue a regra do motor: consumo do planejado');
      assert.equal(depois['2:FABRICA'] - antes['2:FABRICA'], -5);
      for (const loja of ['1:LOJA', '2:LOJA', '5:LOJA']) assert.equal(depois[loja], antes[loja]);

      const entradas = await all(db, `
        SELECT produto_id, quantidade_base FROM estoque_movimentacoes
        WHERE referencia_id = ? AND operacao = 'ENTRADA' ORDER BY id
      `, [resultado.execucao.id]);
      assert.deepEqual(entradas.map((m) => [m.produto_id, m.quantidade_base]), [[5, produzido]], 'a perda não gera entrada de produto');

      assert.equal(resultado.execucao.quantidade_planejada, 100);
      assert.equal(resultado.execucao.quantidade_processada, 100);
      assert.equal(resultado.execucao.quantidade_produzida, produzido);
      assert.equal(resultado.execucao.quantidade_perdida, perdido);
      assert.equal(resultado.execucao.rendimento_real, rendimento);
      assert.equal(resultado.execucao.motivo_perda, perdido ? 'Quebra' : '');
      assert.equal(resultado.execucao.snapshot.produzidos[0].quantidade_perdida, perdido);

      assert.deepEqual(eventos.map((e) => e.acao), ['PRODUCAO_CONCLUIDA']);
      assert.equal(eventos[0].detalhes.planejado, 100);
      assert.equal(eventos[0].detalhes.produzido, produzido);
      assert.equal(eventos[0].detalhes.perdido, perdido);
    });
  }

  it('4, 5, 6 e 11. Combinações inconsistentes são recusadas, sem alterar nada, e a OP não conclui', async () => {
    const op = await opEmProducao(100);
    const antes = await fotografia(db);
    const casos = [
      [{ quantidade_produzida: 95, quantidade_perdida: 10 }, 'PRODUCAO_ACIMA_PLANEJADO', MENSAGEM_ACIMA],
      [{ quantidade_produzida: 101, quantidade_perdida: 0 }, 'PRODUCAO_ACIMA_PLANEJADO', MENSAGEM_ACIMA],
      [{ quantidade_produzida: 0, quantidade_perdida: 101 }, 'PRODUCAO_ACIMA_PLANEJADO', MENSAGEM_ACIMA],
      [{ quantidade_perdida: 5 }, 'PRODUCAO_ACIMA_PLANEJADO', MENSAGEM_ACIMA],
      [{ quantidade_produzida: -1, quantidade_perdida: 101 }, 'PRODUCAO_NEGATIVA', MENSAGEM_PRODUZIDA_NEGATIVA],
      [{ quantidade_produzida: 101, quantidade_perdida: -1 }, 'PERDA_NEGATIVA', MENSAGEM_PERDIDA_NEGATIVA],
      [{ quantidade_produzida: 'abc', quantidade_perdida: 0 }, 'QUANTIDADE_INVALIDA', 'A quantidade produzida é inválida.'],
      [{ quantidade_produzida: 95, quantidade_perdida: 'cinco' }, 'QUANTIDADE_INVALIDA', 'A quantidade perdida é inválida.'],
      [{ quantidade_produzida: 'Infinity', quantidade_perdida: 0 }, 'QUANTIDADE_INVALIDA', 'A quantidade produzida é inválida.'],
      [{ quantidade_produzida: 0, quantidade_perdida: 0 }, 'RESULTADO_DIVERGENTE', MENSAGEM_RESULTADO],
      [{ quantidade_produzida: 90, quantidade_perdida: 5 }, 'RESULTADO_DIVERGENTE', MENSAGEM_RESULTADO]
    ];
    eventos.length = 0;
    for (const [i, [entrada, codigo, mensagem]] of casos.entries()) {
      await assert.rejects(
        executarProducao(db, op.id, { correlation_id: `prod02-invalido-${i}`, ...entrada }, contexto),
        (err) => {
          assert.equal(err.code, codigo, JSON.stringify(entrada));
          assert.equal(err.message, mensagem, JSON.stringify(entrada));
          return true;
        }
      );
    }
    assert.equal(MENSAGEM_ACIMA, 'A quantidade produzida + perdida não pode ser maior que a quantidade planejada.');
    assert.equal(await fotografia(db), antes);
    assert.equal((await obterOrdem(db, op.id)).status, 'EM_PRODUCAO');
    assert.deepEqual(eventos, []);

    const valida = await executarProducao(db, op.id, { correlation_id: 'prod02-depois-dos-invalidos', quantidade_produzida: 95, quantidade_perdida: 5 }, contexto);
    assert.equal(valida.ordem.status, 'CONCLUIDA');
  });

  it('9. Falha no meio de uma execução com perda faz rollback completo', async () => {
    const op = await opEmProducao(100);
    const antes = await fotografia(db);
    await assert.rejects(executarProducao(db, op.id, {
      correlation_id: 'prod02-falha', quantidade_produzida: 95, quantidade_perdida: 5
    }, { ...contexto, aposConsumo() { throw new Error('falha simulada'); } }), /falha simulada/);
    assert.equal(await fotografia(db), antes);
    assert.equal((await obterOrdem(db, op.id)).status, 'EM_PRODUCAO');
  });

  it('10. Reexecução continua idempotente: mesma chave devolve 95/5 sem mexer em nada; outra chave é recusada', async () => {
    const op = await opEmProducao(100);
    const primeira = await executarProducao(db, op.id, {
      correlation_id: 'prod02-idem', quantidade_produzida: 95, quantidade_perdida: 5
    }, contexto);
    const antes = await fotografia(db);
    eventos.length = 0;

    const repetida = await executarProducao(db, op.id, {
      correlation_id: 'prod02-idem', quantidade_produzida: 100, quantidade_perdida: 0
    }, contexto);
    assert.equal(repetida.repetida, true);
    assert.equal(repetida.execucao.id, primeira.execucao.id);
    assert.equal(repetida.execucao.quantidade_produzida, 95);
    assert.equal(repetida.execucao.quantidade_perdida, 5);

    await assert.rejects(executarProducao(db, op.id, {
      correlation_id: 'prod02-idem-outra', quantidade_produzida: 95, quantidade_perdida: 5
    }, contexto), (err) => err.message === MENSAGEM_CONCLUIDA);
    assert.equal(await fotografia(db), antes);
    assert.deepEqual(eventos, []);
  });
});
