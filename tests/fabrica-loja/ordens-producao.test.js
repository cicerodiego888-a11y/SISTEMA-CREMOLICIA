/**
 * Fundação da ordem de produção. Banco temporário. Não usa o banco oficial.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const { salvarNecessidade, obterNecessidade } = require('../../backend/modules/fabrica-loja/NecessidadeProducaoService');
const {
  salvarOrdem,
  obterOrdem,
  planejarOrdem,
  cancelarOrdem,
  MENSAGEM_QUANTIDADE,
  MENSAGEM_CANCELAR_EXECUCAO,
  MENSAGEM_MOTOR
} = require('../../backend/modules/fabrica-loja/OrdemProducaoService');
const bootstrap = require('../../backend/modules/fabrica-loja/migrations/005_ordens_producao');
const bootstrapFichas = require('../../backend/modules/fabrica-loja/migrations/002_fichas_tecnicas');

const dir = path.join(os.tmpdir(), 'cds-fabrica-loja-testes');
fs.mkdirSync(dir, { recursive: true });
const arquivo = path.join(dir, 'ordens-producao.db');
for (const sufixo of ['', '-wal', '-shm']) {
  fs.rmSync(arquivo + sufixo, { force: true });
}

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

describe('Ordem de produção', () => {
  let db;
  const eventos = [];

  before(async () => {
    db = abrir();
    await run(db, `
      CREATE TABLE produtos (
        id INTEGER PRIMARY KEY,
        nome TEXT,
        unidade TEXT,
        ativo INTEGER DEFAULT 1,
        estoque_atual REAL DEFAULT 0,
        saldo_fiscal REAL DEFAULT 0,
        saldo_nao_fiscal REAL DEFAULT 0,
        natureza_cadastro TEXT
      )
    `);
    await run(db, 'CREATE TABLE estoque_movimentacoes (id INTEGER PRIMARY KEY, produto_id INTEGER, operacao TEXT)');
    await run(db, "INSERT INTO produtos (id, nome, unidade, estoque_atual, saldo_fiscal, natureza_cadastro) VALUES (1, 'Chocolate', 'KG', 80, 80, 'INSUMO')");
    await run(db, "INSERT INTO produtos (id, nome, unidade, estoque_atual, saldo_fiscal, natureza_cadastro) VALUES (2, 'Leite', 'L', 100, 100, 'INSUMO')");
    await run(db, "INSERT INTO produtos (id, nome, unidade, estoque_atual, saldo_fiscal, natureza_cadastro) VALUES (3, 'Picolé Morango', 'UN', 0, 0, 'PRODUZIDO')");
    await run(db, "INSERT INTO produtos (id, nome, unidade, estoque_atual, saldo_fiscal, natureza_cadastro) VALUES (4, 'Picolé Chocolate', 'UN', 0, 0, 'PRODUZIDO')");
    await bootstrapFichas(db);
    await run(db, "INSERT INTO fichas_tecnicas (id, codigo, nome, produto_id, ativa) VALUES (7, 'FT-MOR', 'Picolé Morango v1', 3, 1)");
    await run(db, "INSERT INTO fichas_tecnicas (id, codigo, nome, produto_id, ativa) VALUES (8, 'FT-SEM-VINCULO', 'Ficha sem vínculo', NULL, 1)");
    await run(db, "INSERT INTO fichas_tecnicas (id, codigo, nome, produto_id, ativa) VALUES (9, 'FT-INATIVA', 'Ficha inativa', 3, 0)");
    await bootstrap(db);
  });

  after(() => {
    if (db) db.close();
  });

  function contexto() {
    return {
      usuario_id: 9,
      usuario_nome: 'Planejador',
      auditar: async (info) => { eventos.push(info.acao); }
    };
  }

  async function saldos() {
    return all(db, 'SELECT id, estoque_atual, saldo_fiscal FROM produtos ORDER BY id');
  }

  it('1 e 14. cria OP manual em rascunho sem necessidade', async () => {
    const ordem = await salvarOrdem(db, {
      origem: 'MANUAL',
      prioridade: 'ALTA',
      data_prevista: '2026-10-06',
      observacao: 'Recomposição de estoque',
      itens: [{ produto_id: 3, quantidade_planejada: 500, unidade: 'UN', ficha_tecnica_id: null }]
    }, null, contexto());
    assert.equal(ordem.status, 'RASCUNHO');
    assert.equal(ordem.origem, 'MANUAL');
    assert.equal(ordem.necessidade_id, null);
    assert.equal(ordem.prioridade, 'ALTA');
    assert.equal(ordem.data_prevista, '2026-10-06');
    assert.equal(ordem.usuario_nome, 'Planejador');
    assert.match(ordem.codigo, /^OP-\d{4}-\d{6}$/);
    assert.equal(eventos.includes('OP_CRIADA'), true);
  });

  it('2 e 3. copia produto, quantidade e ficha da necessidade sem marcá-la atendida', async () => {
    const necessidade = await salvarNecessidade(db, {
      origem: 'MANUAL',
      descricao: 'Picolés da semana',
      itens: [{ produto_id: 3, descricao: 'Picolé Morango', quantidade: 1000, unidade: 'UN', ficha_tecnica_id: 7 }]
    });
    const ordem = await salvarOrdem(db, {
      necessidade_id: necessidade.id,
      itens: [{ necessidade_item_id: necessidade.itens[0].id, produto_id: 3, quantidade_planejada: 600, unidade: 'UN' }]
    }, null, contexto());
    assert.equal(ordem.origem, 'NECESSIDADE');
    assert.equal(ordem.necessidade_id, necessidade.id);
    assert.equal(ordem.itens[0].produto_id, 3);
    assert.equal(ordem.itens[0].quantidade_planejada, 600);
    assert.equal(ordem.itens[0].unidade, 'UN');
    assert.equal(ordem.itens[0].ficha_tecnica_id, 7);
    const depois = await obterNecessidade(db, necessidade.id);
    assert.equal(depois.status, 'ABERTA');
    assert.equal(depois.itens[0].quantidade, 1000);
  });

  it('2b. impede uso de ficha tradicional sem vínculo ou inativa', async () => {
    for (const fichaId of [8, 9]) {
      await assert.rejects(
        salvarNecessidade(db, {
          origem: 'MANUAL',
          descricao: 'Ficha não utilizável',
          itens: [{ produto_id: 3, descricao: 'Picolé Morango', quantidade: 10, unidade: 'UN', ficha_tecnica_id: fichaId }]
        }),
        (err) => err.code === 'FICHA_NAO_VINCULADA' && err.statusCode === 409
      );
      await assert.rejects(
        salvarOrdem(db, {
          origem: 'MANUAL',
          itens: [{ produto_id: 3, quantidade_planejada: 10, unidade: 'UN', ficha_tecnica_id: fichaId }]
        }, null, contexto()),
        (err) => err.code === 'FICHA_NAO_VINCULADA' && err.statusCode === 409
      );
    }
  });

  it('2c. preserva a ficha histórica de uma ordem existente após desvinculá-la', async () => {
    await run(db, "INSERT INTO fichas_tecnicas (id, codigo, nome, produto_id, ativa) VALUES (10, 'FT-HIST', 'Ficha histórica', 3, 1)");
    const criada = await salvarOrdem(db, {
      origem: 'MANUAL',
      itens: [{ produto_id: 3, quantidade_planejada: 12, unidade: 'UN', ficha_tecnica_id: 10 }]
    }, null, contexto());
    await run(db, 'UPDATE fichas_tecnicas SET produto_id = NULL WHERE id = 10');
    const atualizada = await salvarOrdem(db, {
      origem: 'MANUAL',
      itens: [{
        id: criada.itens[0].id,
        produto_id: 3,
        quantidade_planejada: 12,
        unidade: 'UN',
        ficha_tecnica_id: 10
      }]
    }, criada.id, contexto());
    assert.equal(atualizada.itens[0].ficha_tecnica_id, 10);
  });

  it('4. cria OP sem ficha quando não há ficha aplicável', async () => {
    const ordem = await salvarOrdem(db, {
      origem: 'MANUAL',
      itens: [{ produto_id: 4, quantidade_planejada: 100, unidade: 'UN' }]
    }, null, contexto());
    assert.equal(ordem.itens[0].ficha_tecnica_id, null);
    assert.equal(ordem.status, 'RASCUNHO');
  });

  it('5. planeja a ordem sem executar produção', async () => {
    const criada = await salvarOrdem(db, {
      origem: 'PLANEJAMENTO',
      itens: [{ produto_id: 4, quantidade_planejada: 10, unidade: 'UN' }]
    }, null, contexto());
    const planejada = await planejarOrdem(db, criada.id, contexto());
    assert.equal(planejada.status, 'PLANEJADA');
    assert.equal(eventos.includes('OP_PLANEJADA'), true);
    await assert.rejects(
      () => salvarOrdem(db, { status: 'EM_PRODUCAO', itens: planejada.itens }, planejada.id, contexto()),
      (err) => err.message === MENSAGEM_MOTOR
    );
  });

  it('6. cancela rascunho', async () => {
    const criada = await salvarOrdem(db, {
      origem: 'MANUAL',
      itens: [{ produto_id: 3, quantidade_planejada: 20, unidade: 'UN', ficha_tecnica_id: null }]
    }, null, contexto());
    const cancelada = await cancelarOrdem(db, criada.id, contexto());
    assert.equal(cancelada.status, 'CANCELADA');
    assert.equal(eventos.includes('OP_CANCELADA'), true);
  });

  it('7. cancela ordem planejada', async () => {
    const criada = await salvarOrdem(db, {
      origem: 'MANUAL',
      itens: [{ produto_id: 3, quantidade_planejada: 15, unidade: 'UN', ficha_tecnica_id: null }]
    }, null, contexto());
    const planejada = await planejarOrdem(db, criada.id, contexto());
    const cancelada = await cancelarOrdem(db, planejada.id, contexto());
    assert.equal(cancelada.status, 'CANCELADA');
  });

  it('8. ordem cancelada não pode ser editada nem voltar a rascunho', async () => {
    const criada = await salvarOrdem(db, {
      origem: 'MANUAL',
      itens: [{ produto_id: 4, quantidade_planejada: 8, unidade: 'UN' }]
    }, null, contexto());
    const cancelada = await cancelarOrdem(db, criada.id, contexto());
    await assert.rejects(
      () => salvarOrdem(db, {
        origem: 'MANUAL',
        itens: [{ produto_id: 4, quantidade_planejada: 9, unidade: 'UN' }]
      }, cancelada.id, contexto()),
      (err) => err.code === 'ORDEM_CANCELADA'
    );
    const lida = await obterOrdem(db, cancelada.id);
    assert.equal(lida.status, 'CANCELADA');
  });

  it('9, 10, 11 e 16. criar e cancelar não movimenta estoque nem gera produto', async () => {
    const antes = await saldos();
    const produtosAntes = antes.length;
    const criada = await salvarOrdem(db, {
      origem: 'MANUAL',
      itens: [{ produto_id: 3, quantidade_planejada: 500, unidade: 'UN', ficha_tecnica_id: 7 }]
    }, null, contexto());
    await cancelarOrdem(db, criada.id, contexto());
    const depois = await saldos();
    assert.deepEqual(depois, antes);
    assert.equal(depois.length, produtosAntes);
    assert.equal(Number(depois.find((item) => item.id === 1).estoque_atual), 80);
    assert.equal(Number(depois.find((item) => item.id === 2).estoque_atual), 100);
    assert.equal(Number(depois.find((item) => item.id === 3).estoque_atual), 0);
    const movimentos = await all(db, 'SELECT id FROM estoque_movimentacoes');
    assert.equal(movimentos.length, 0);
  });

  it('12. duas OPs do mesmo produto permanecem independentes', async () => {
    const primeira = await salvarOrdem(db, {
      origem: 'MANUAL',
      itens: [{ produto_id: 3, quantidade_planejada: 500, unidade: 'UN', ficha_tecnica_id: null }]
    }, null, contexto());
    const segunda = await salvarOrdem(db, {
      origem: 'MANUAL',
      itens: [{ produto_id: 3, quantidade_planejada: 300, unidade: 'UN', ficha_tecnica_id: null }]
    }, null, contexto());
    assert.notEqual(primeira.id, segunda.id);
    assert.notEqual(primeira.codigo, segunda.codigo);
    assert.equal(primeira.itens[0].produto_id, 3);
    assert.equal(segunda.itens[0].produto_id, 3);
    assert.equal(primeira.itens[0].quantidade_planejada, 500);
    assert.equal(segunda.itens[0].quantidade_planejada, 300);
  });

  it('13 e 15. bloqueia quantidade acima do restante e não atende a necessidade', async () => {
    const necessidade = await salvarNecessidade(db, {
      origem: 'ABASTECIMENTO',
      descricao: 'Mil picolés',
      itens: [{ produto_id: 3, descricao: 'Picolé Morango', quantidade: 1000, unidade: 'UN', ficha_tecnica_id: 7 }]
    });
    const itemId = necessidade.itens[0].id;
    await salvarOrdem(db, {
      necessidade_id: necessidade.id,
      itens: [{ necessidade_item_id: itemId, produto_id: 3, quantidade_planejada: 700, unidade: 'UN' }]
    }, null, contexto());
    await assert.rejects(
      () => salvarOrdem(db, {
        necessidade_id: necessidade.id,
        itens: [{ necessidade_item_id: itemId, produto_id: 3, quantidade_planejada: 500, unidade: 'UN' }]
      }, null, contexto()),
      (err) => err.message === MENSAGEM_QUANTIDADE
    );
    const depois = await obterNecessidade(db, necessidade.id);
    assert.equal(depois.status, 'ABERTA');
  });

  it('17 e 18. a OP aponta para produto físico e não usa preço nem linha comercial', async () => {
    await assert.rejects(
      () => salvarOrdem(db, {
        origem: 'MANUAL',
        itens: [{ descricao: 'Picolé Cremoso', linha_comercial_id: 99, quantidade_planejada: 10 }]
      }, null, contexto()),
      (err) => err.code === 'PRODUTO_OBRIGATORIO'
    );
    const ordem = await salvarOrdem(db, {
      origem: 'MANUAL',
      itens: [{ produto_id: 3, quantidade_planejada: 40, unidade: 'UN', ficha_tecnica_id: null }]
    }, null, contexto());
    assert.equal(ordem.itens[0].produto_id, 3);
    assert.equal(ordem.itens[0].produto_nome, 'Picolé Morango');
    const fonte = fs.readFileSync(path.join(__dirname, '../../backend/modules/fabrica-loja/OrdemProducaoService.js'), 'utf8');
    assert.equal(fonte.includes('MotorEstoque'), false);
    assert.equal(fonte.includes('resolverPreco'), false);
    assert.equal(fonte.includes('entradaProducaoPropria'), false);
    assert.equal(fonte.includes("require('../lib/"), false);
    const rota = fs.readFileSync(path.join(__dirname, '../../backend/rotas/fabrica-loja.js'), 'utf8');
    assert.equal(rota.includes('/iniciar'), false);
    assert.equal(rota.includes('MotorEstoque'), false);
  });

  it('execução gravada à força não cancela por este fluxo', async () => {
    const criada = await salvarOrdem(db, {
      origem: 'MANUAL',
      itens: [{ produto_id: 4, quantidade_planejada: 5, unidade: 'UN' }]
    }, null, contexto());
    await run(db, "UPDATE ordens_producao SET status = 'EM_PRODUCAO' WHERE id = ?", [criada.id]);
    await assert.rejects(
      () => cancelarOrdem(db, criada.id, contexto()),
      (err) => err.message === MENSAGEM_CANCELAR_EXECUCAO
    );
    const estoque = await get(db, 'SELECT estoque_atual FROM produtos WHERE id = 4');
    assert.equal(Number(estoque.estoque_atual), 0);
  });
});
