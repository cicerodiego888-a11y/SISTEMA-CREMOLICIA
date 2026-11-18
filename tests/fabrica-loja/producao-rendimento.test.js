/**
 * Rendimento real e perda da execução. Banco temporário. Não usa o banco oficial.
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
  executarProducao,
  MENSAGEM_CONCLUIDA,
  MENSAGEM_RESULTADO,
  MENSAGEM_ACIMA,
  MENSAGEM_PRODUZIDA_NEGATIVA,
  MENSAGEM_PERDIDA_NEGATIVA
} = require('../../backend/modules/fabrica-loja/ProducaoExecucaoService');
const MotorEstoque = require('../../backend/motores/motor-estoque');
const bootstrapFichas = require('../../backend/modules/fabrica-loja/migrations/002_fichas_tecnicas');
const bootstrapOrdens = require('../../backend/modules/fabrica-loja/migrations/005_ordens_producao');

const dir = path.join(os.tmpdir(), 'cds-fabrica-loja-testes');
fs.mkdirSync(dir, { recursive: true });
const arquivo = path.join(dir, 'producao-rendimento.db');
for (const sufixo of ['', '-wal', '-shm']) fs.rmSync(arquivo + sufixo, { force: true });

function abrir() {
  return new sqlite3.Database(arquivo);
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID });
    });
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

// Simula OP já iniciada cujos dados mudaram depois do início: aqui se testam as validações da execução.
async function ordemEmProducao(db, quantidade, fichaId, produtoId) {
  const criada = await salvarOrdem(db, {
    origem: 'MANUAL',
    itens: [{ produto_id: produtoId || 5, quantidade_planejada: quantidade, unidade: 'UN', ficha_tecnica_id: fichaId || 1 }]
  });
  const planejada = await planejarOrdem(db, criada.id);
  await run(db, "UPDATE ordens_producao SET status = 'EM_PRODUCAO' WHERE id = ? AND status = 'PLANEJADA'", [planejada.id]);
  return { ...planejada, status: 'EM_PRODUCAO' };
}

describe('Rendimento real e perda', () => {
  let db;

  before(async () => {
    db = abrir();
    await run(db, `
      CREATE TABLE produtos (
        id INTEGER PRIMARY KEY,
        nome TEXT,
        unidade TEXT,
        estoque_atual REAL DEFAULT 0,
        saldo_fiscal REAL DEFAULT 0,
        saldo_nao_fiscal REAL DEFAULT 0,
        natureza_cadastro TEXT,
        ativo INTEGER DEFAULT 1,
        controlar_validade INTEGER DEFAULT 0,
        updated_at TEXT,
        preco_compra REAL
      )
    `);
    await bootstrapFichas(db);
    await bootstrapOrdens(db);
    await MotorEstoque.bootstrapMotorEstoqueSchema(db);
    await run(db, `
      INSERT INTO produtos (id, nome, unidade, estoque_atual, saldo_fiscal, natureza_cadastro, preco_compra)
      VALUES (1, 'Leite', 'L', 100000, 100000, 'INSUMO', 2)
    `);
    await run(db, `
      INSERT INTO produtos (id, nome, unidade, estoque_atual, saldo_fiscal, natureza_cadastro)
      VALUES (5, 'Picolé de Morango', 'UN', 0, 0, 'PRODUZIDO')
    `);
    await run(db, `
      INSERT INTO produtos (id, nome, unidade, estoque_atual, saldo_fiscal, natureza_cadastro)
      VALUES (9, 'Leite curto', 'L', 10, 10, 'INSUMO')
    `);
    await run(db, `
      INSERT INTO estoque_saldos_locais (produto_id, local, saldo_fiscal, saldo_nao_fiscal, estoque_atual)
      VALUES (1, 'FABRICA', 100000, 0, 100000), (9, 'FABRICA', 10, 0, 10)
    `);
    await run(db, `
      INSERT INTO fichas_tecnicas (id, codigo, nome, produto_id, rendimento_quantidade, rendimento_unidade, ativa)
      VALUES (1, 'FT-1', 'Picolé de Morango', 5, 100, 'UN', 1)
    `);
    await run(db, `
      INSERT INTO ficha_tecnica_componentes (ficha_id, ordem, produto_id, descricao, quantidade, unidade)
      VALUES (1, 1, 1, 'Leite', 20, 'L')
    `);
    await run(db, `
      INSERT INTO fichas_tecnicas (id, codigo, nome, produto_id, rendimento_quantidade, rendimento_unidade, ativa)
      VALUES (2, 'FT-2', 'Ficha curta', 5, 100, 'UN', 1)
    `);
    await run(db, `
      INSERT INTO ficha_tecnica_componentes (ficha_id, ordem, produto_id, descricao, quantidade, unidade)
      VALUES (2, 1, 9, 'Leite curto', 20, 'L')
    `);
  });

  after(() => db.close());

  it('1: produzido integral entra 500', async () => {
    const ordem = await ordemEmProducao(db, 500);
    const antes = await get(db, 'SELECT estoque_atual FROM produtos WHERE id = 5');
    const resultado = await executarProducao(db, ordem.id, { correlation_id: 'rend-1', quantidade_produzida: 500, quantidade_perdida: 0 });
    const picole = await get(db, 'SELECT estoque_atual FROM produtos WHERE id = 5');
    assert.equal(resultado.execucao.quantidade_produzida, 500);
    assert.equal(resultado.execucao.quantidade_perdida, 0);
    assert.equal(picole.estoque_atual - antes.estoque_atual, 500);
    const gravada = await obterOrdem(db, ordem.id);
    assert.equal(gravada.itens[0].quantidade_planejada, 500);
  });

  it('2, 12 e 15: 470 produzidos e 30 perdidos entram só 470 e consomem o planejado', async () => {
    const leiteAntes = await get(db, 'SELECT estoque_atual FROM produtos WHERE id = 1');
    const picoleAntes = await get(db, 'SELECT estoque_atual FROM produtos WHERE id = 5');
    const ordem = await ordemEmProducao(db, 500);
    const resultado = await executarProducao(db, ordem.id, {
      correlation_id: 'rend-2',
      quantidade_produzida: 470,
      quantidade_perdida: 30,
      motivo_perda: 'Quebra'
    });
    const picole = await get(db, 'SELECT estoque_atual FROM produtos WHERE id = 5');
    const leite = await get(db, 'SELECT estoque_atual FROM produtos WHERE id = 1');
    const entrada = await get(db, `
      SELECT quantidade_base FROM estoque_movimentacoes
      WHERE referencia_id = ? AND operacao = 'ENTRADA'
    `, [resultado.execucao.id]);
    assert.equal(picole.estoque_atual - picoleAntes.estoque_atual, 470);
    assert.equal(entrada.quantidade_base, 470);
    assert.equal(leiteAntes.estoque_atual - leite.estoque_atual, 100);
    assert.equal(resultado.execucao.quantidade_planejada, 500);
    assert.equal(resultado.execucao.rendimento_real, 94);
    const gravada = await obterOrdem(db, ordem.id);
    assert.equal(gravada.itens[0].quantidade_planejada, 500);
  });

  it('3 e 16: produção zero não gera entrada e registra a perda', async () => {
    const picoleAntes = await get(db, 'SELECT estoque_atual FROM produtos WHERE id = 5');
    const ordem = await ordemEmProducao(db, 500);
    const resultado = await executarProducao(db, ordem.id, {
      correlation_id: 'rend-3',
      quantidade_produzida: 0,
      quantidade_perdida: 500
    });
    const picole = await get(db, 'SELECT estoque_atual FROM produtos WHERE id = 5');
    const entradas = await all(db, `
      SELECT id FROM estoque_movimentacoes WHERE referencia_id = ? AND operacao = 'ENTRADA'
    `, [resultado.execucao.id]);
    const saidas = await all(db, `
      SELECT id FROM estoque_movimentacoes WHERE referencia_id = ? AND operacao = 'SAIDA'
    `, [resultado.execucao.id]);
    assert.equal(entradas.length, 0);
    assert.equal(saidas.length, 1);
    assert.equal(picole.estoque_atual, picoleAntes.estoque_atual);
    assert.equal(resultado.execucao.quantidade_produzida, 0);
    assert.equal(resultado.execucao.quantidade_perdida, 500);
    assert.equal(resultado.ordem.status, 'CONCLUIDA');
  });

  it('4, 5, 6 e 7: quantidades inválidas bloqueiam sem movimentar', async () => {
    const antes = await get(db, 'SELECT COUNT(*) AS total FROM estoque_movimentacoes');
    const divergente = await ordemEmProducao(db, 500);
    await assert.rejects(() => executarProducao(db, divergente.id, {
      correlation_id: 'rend-4', quantidade_produzida: 470, quantidade_perdida: 10
    }), (err) => err.message === MENSAGEM_RESULTADO);
    const acima = await ordemEmProducao(db, 500);
    await assert.rejects(() => executarProducao(db, acima.id, {
      correlation_id: 'rend-5', quantidade_produzida: 510, quantidade_perdida: 0
    }), (err) => err.message === MENSAGEM_ACIMA);
    const negativa = await ordemEmProducao(db, 500);
    await assert.rejects(() => executarProducao(db, negativa.id, {
      correlation_id: 'rend-6', quantidade_produzida: -1, quantidade_perdida: 501
    }), (err) => err.message === MENSAGEM_PRODUZIDA_NEGATIVA);
    const perdaNegativa = await ordemEmProducao(db, 500);
    await assert.rejects(() => executarProducao(db, perdaNegativa.id, {
      correlation_id: 'rend-7', quantidade_produzida: 501, quantidade_perdida: -1
    }), (err) => err.message === MENSAGEM_PERDIDA_NEGATIVA);
    const depois = await get(db, 'SELECT COUNT(*) AS total FROM estoque_movimentacoes');
    assert.equal(depois.total, antes.total);
    const status = await get(db, 'SELECT status FROM ordens_producao WHERE id = ?', [divergente.id]);
    assert.equal(status.status, 'EM_PRODUCAO');
  });

  it('8: estoque insuficiente não registra perda nem baixa insumo', async () => {
    const ordem = await ordemEmProducao(db, 500, 2);
    const antes = await all(db, 'SELECT id, estoque_atual FROM produtos ORDER BY id');
    await assert.rejects(() => executarProducao(db, ordem.id, {
      correlation_id: 'rend-8', quantidade_produzida: 470, quantidade_perdida: 30
    }), (err) => err.message === 'Estoque insuficiente de Leite curto na Fábrica para executar esta produção.');
    const depois = await all(db, 'SELECT id, estoque_atual FROM produtos ORDER BY id');
    assert.deepEqual(depois, antes);
    const execucao = await get(db, 'SELECT id FROM ordem_producao_execucoes WHERE ordem_id = ?', [ordem.id]);
    assert.equal(execucao, undefined);
    const status = await get(db, 'SELECT status FROM ordens_producao WHERE id = ?', [ordem.id]);
    assert.equal(status.status, 'EM_PRODUCAO');
  });

  it('9, 10 e 11: motivo e observação da perda', async () => {
    const comMotivo = await ordemEmProducao(db, 500);
    const registrada = await executarProducao(db, comMotivo.id, {
      correlation_id: 'rend-9',
      quantidade_produzida: 470,
      quantidade_perdida: 30,
      motivo_perda: 'Quebra',
      observacao_perda: 'Parte da produção apresentou problema de textura.'
    });
    assert.equal(registrada.execucao.motivo_perda, 'Quebra');
    assert.equal(registrada.execucao.observacao_perda, 'Parte da produção apresentou problema de textura.');
    const semMotivo = await ordemEmProducao(db, 500);
    const livre = await executarProducao(db, semMotivo.id, {
      correlation_id: 'rend-10',
      quantidade_produzida: 500,
      quantidade_perdida: 0
    });
    assert.equal(livre.execucao.motivo_perda, '');
    assert.equal(livre.execucao.observacao_perda, '');
  });

  it('13 e 14: ficha e snapshot não mudam com a perda', async () => {
    const ordem = await get(db, 'SELECT id FROM ordens_producao WHERE id IN (SELECT ordem_id FROM ordem_producao_execucoes WHERE correlation_id = ?)', ['rend-2']);
    await run(db, 'UPDATE fichas_tecnicas SET rendimento_quantidade = 80 WHERE id = 1');
    await run(db, 'UPDATE ficha_tecnica_componentes SET quantidade = 99 WHERE ficha_id = 1');
    const ficha = await get(db, 'SELECT rendimento_quantidade FROM fichas_tecnicas WHERE id = 1');
    const execucao = await get(db, 'SELECT snapshot_json FROM ordem_producao_execucoes WHERE correlation_id = ?', ['rend-2']);
    const snapshot = JSON.parse(execucao.snapshot_json);
    assert.equal(ficha.rendimento_quantidade, 80);
    assert.equal(snapshot.produzidos[0].ficha.rendimento_quantidade, 100);
    assert.equal(snapshot.produzidos[0].ficha.componentes[0].quantidade, 20);
    assert.equal(snapshot.produzidos[0].quantidade_produzida, 470);
    assert.equal(snapshot.produzidos[0].quantidade_perdida, 30);
    await run(db, 'UPDATE fichas_tecnicas SET rendimento_quantidade = 100 WHERE id = 1');
    await run(db, 'UPDATE ficha_tecnica_componentes SET quantidade = 20 WHERE ficha_id = 1');
    assert.ok(ordem.id);
  });

  it('17 e 18: a mesma chave e a ordem concluída não produzem de novo', async () => {
    const antes = await get(db, 'SELECT COUNT(*) AS total FROM estoque_movimentacoes');
    const repetida = await executarProducao(db, 1, { correlation_id: 'rend-2' });
    assert.equal(repetida.repetida, true);
    assert.equal(repetida.execucao.quantidade_produzida, 470);
    const depois = await get(db, 'SELECT COUNT(*) AS total FROM estoque_movimentacoes');
    assert.equal(depois.total, antes.total);
    await assert.rejects(() => executarProducao(db, repetida.ordem.id, { correlation_id: 'rend-outra' }), (err) => err.message === MENSAGEM_CONCLUIDA);
  });

  it('19: falha no meio desfaz baixa, entrada e perda', async () => {
    const leiteAntes = await get(db, 'SELECT estoque_atual FROM produtos WHERE id = 1');
    const picoleAntes = await get(db, 'SELECT estoque_atual FROM produtos WHERE id = 5');
    const ordem = await ordemEmProducao(db, 500);
    await assert.rejects(() => executarProducao(db, ordem.id, {
      correlation_id: 'rend-19',
      quantidade_produzida: 470,
      quantidade_perdida: 30
    }, {
      aposConsumo() { throw new Error('falha simulada'); }
    }));
    const leite = await get(db, 'SELECT estoque_atual FROM produtos WHERE id = 1');
    const picole = await get(db, 'SELECT estoque_atual FROM produtos WHERE id = 5');
    const execucao = await get(db, 'SELECT id FROM ordem_producao_execucoes WHERE correlation_id = ?', ['rend-19']);
    const status = await get(db, 'SELECT status FROM ordens_producao WHERE id = ?', [ordem.id]);
    assert.equal(leite.estoque_atual, leiteAntes.estoque_atual);
    assert.equal(picole.estoque_atual, picoleAntes.estoque_atual);
    assert.equal(execucao, undefined);
    assert.equal(status.status, 'EM_PRODUCAO');
  });

  it('20: auditoria registra planejado, produzido e perdido', async () => {
    const eventos = [];
    const ordem = await ordemEmProducao(db, 500);
    await executarProducao(db, ordem.id, {
      correlation_id: 'rend-20',
      quantidade_produzida: 470,
      quantidade_perdida: 30
    }, {
      usuario_nome: 'Ana',
      auditar(info) { eventos.push(info); }
    });
    const conclusao = eventos.find((item) => item.acao === 'PRODUCAO_CONCLUIDA');
    assert.equal(conclusao.detalhes.planejado, 500);
    assert.equal(conclusao.detalhes.produzido, 470);
    assert.equal(conclusao.detalhes.perdido, 30);
    assert.equal(conclusao.detalhes.produto, 'Picolé de Morango');
    assert.equal(conclusao.detalhes.usuario_nome, 'Ana');
    assert.deepEqual(eventos.map((item) => item.acao), ['PRODUCAO_CONCLUIDA']);
  });
});
