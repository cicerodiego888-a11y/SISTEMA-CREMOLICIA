/**
 * Vínculo obrigatório do produto na ordem de produção. Banco temporário.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const { salvarFicha, listarFichas } = require('../../backend/modules/fabrica-loja/FichaTecnicaService');
const { salvarNecessidade } = require('../../backend/modules/fabrica-loja/NecessidadeProducaoService');
const { listarProdutosProduzidos } = require('../../backend/modules/fabrica-loja/NecessidadeProducaoService');
const {
  salvarOrdem,
  obterOrdem,
  planejarOrdem,
  MENSAGEM_SELECIONE_PRODUTO,
  MENSAGEM_PRODUTO_NAO_ENCONTRADO,
  MENSAGEM_SOMENTE_PRODUZIDO,
  MENSAGEM_PRODUTO_INATIVO
} = require('../../backend/modules/fabrica-loja/OrdemProducaoService');
const { executarProducao, iniciarProducao } = require('../../backend/modules/fabrica-loja/ProducaoExecucaoService');
const MotorEstoque = require('../../backend/motores/motor-estoque');

const dir = path.join(os.tmpdir(), 'cds-fabrica-loja-testes');
fs.mkdirSync(dir, { recursive: true });
const arquivo = path.join(dir, 'produto-ordem.db');
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

describe('Produto obrigatório na ordem de produção', () => {
  let db;

  before(async () => {
    db = abrir();
    await run(db, `
      CREATE TABLE produtos (
        id INTEGER PRIMARY KEY, codigo TEXT, codigo_barras TEXT, nome TEXT, unidade TEXT,
        natureza_cadastro TEXT, ativo INTEGER DEFAULT 1, estoque_atual REAL DEFAULT 0,
        saldo_fiscal REAL DEFAULT 0, saldo_nao_fiscal REAL DEFAULT 0,
        controlar_validade INTEGER DEFAULT 0, preco_compra REAL, updated_at TEXT
      )
    `);
    await run(db, `INSERT INTO produtos (id, codigo, codigo_barras, nome, unidade, natureza_cadastro, ativo) VALUES
      (10, 'PIC-001', '789001', 'Picolé Chocolate', 'UN', 'PRODUZIDO', 1),
      (11, 'PIC-002', '789002', 'Picolé Chocolate Branco', 'UN', 'PRODUZIDO', 1),
      (12, 'LEI', '', 'Leite', 'L', 'INSUMO', 1),
      (13, 'CHO', '', 'Chocolate em Pó', 'KG', 'INSUMO', 1),
      (14, 'PIC-003', '', 'Picolé Inativo', 'UN', 'PRODUZIDO', 0),
      (16, 'PIC-004', '', 'Picolé Morango', 'UN', 'PRODUZIDO', 1),
      (17, 'PIC-005', '', 'Picolé Abacaxi', 'UN', 'PRODUZIDO', 1)`);
    await salvarFicha(db, {
      codigo: 'FT-002',
      nome: 'Picolé Chocolate',
      produto_id: 10,
      rendimento_quantidade: 100,
      rendimento_unidade: 'UN',
      componentes: [{ produto_id: 12, quantidade: 20, unidade: 'L' }]
    });
    await salvarFicha(db, {
      codigo: 'FT-005',
      nome: 'Picolé Chocolate Especial',
      produto_id: 10,
      rendimento_quantidade: 100,
      rendimento_unidade: 'UN',
      componentes: [{ produto_id: 12, quantidade: 18, unidade: 'L' }]
    });
    await salvarFicha(db, {
      codigo: 'FT-010',
      nome: 'Picolé Morango',
      produto_id: 16,
      rendimento_quantidade: 100,
      rendimento_unidade: 'UN',
      componentes: [{ produto_id: 12, quantidade: 15, unidade: 'L' }]
    });
  });

  after(() => db && db.close());

  it('1 e 2. busca Chocolate e esconde insumo, inativo e comercial', async () => {
    const achados = await listarProdutosProduzidos(db, 'Chocolate');
    assert.deepEqual(achados.map((item) => item.id).sort(), [10, 11]);
    assert.equal(achados.every((item) => item.natureza_cadastro === 'PRODUZIDO' && item.ativo === 1), true);
    assert.equal(achados.some((item) => item.id === 13), false);
    const picoles = await listarProdutosProduzidos(db, 'Picolé');
    assert.equal(picoles.some((item) => item.id === 14), false);
    assert.equal(picoles.some((item) => item.id === 13), false);
  });

  it('3, 4 e 10. OP manual grava o produto selecionado e recusa o nome digitado', async () => {
    const antes = await get(db, 'SELECT COUNT(*) AS total FROM produtos');
    await assert.rejects(
      () => salvarOrdem(db, {
        origem: 'MANUAL',
        itens: [{ produto_nome: 'Picolé Chocolate', quantidade_planejada: 500, unidade: 'UN' }]
      }),
      (err) => err.message === MENSAGEM_SELECIONE_PRODUTO
    );
    const ordem = await salvarOrdem(db, {
      origem: 'MANUAL',
      itens: [{ produto_id: 10, quantidade_planejada: 500, unidade: 'UN' }]
    });
    assert.equal(ordem.itens[0].produto_id, 10);
    assert.equal(ordem.itens[0].ficha_tecnica_id, null);
    assert.equal(ordem.itens[0].produto_nome, 'Picolé Chocolate');
    assert.equal(ordem.itens[0].produto_codigo, 'PIC-001');
    const depois = await get(db, 'SELECT COUNT(*) AS total FROM produtos');
    assert.equal(Number(depois.total), Number(antes.total));
  });

  it('5, 6 e insumo. a API bloqueia id inexistente, inativo e insumo', async () => {
    const antes = await get(db, 'SELECT COUNT(*) AS total FROM ordens_producao');
    await assert.rejects(
      () => salvarOrdem(db, {
        origem: 'MANUAL',
        itens: [{ produto_id: 999999999, quantidade_planejada: 1, unidade: 'UN' }]
      }),
      (err) => err.message === MENSAGEM_PRODUTO_NAO_ENCONTRADO
    );
    await assert.rejects(
      () => salvarOrdem(db, {
        origem: 'MANUAL',
        itens: [{ produto_id: 14, quantidade_planejada: 1, unidade: 'UN' }]
      }),
      (err) => err.message === MENSAGEM_PRODUTO_INATIVO
    );
    await assert.rejects(
      () => salvarOrdem(db, {
        origem: 'MANUAL',
        itens: [{ produto_id: 13, quantidade_planejada: 1, unidade: 'KG' }]
      }),
      (err) => err.message === MENSAGEM_SOMENTE_PRODUZIDO
    );
    const depois = await get(db, 'SELECT COUNT(*) AS total FROM ordens_producao');
    assert.equal(Number(depois.total), Number(antes.total));
  });

  it('7, 8 e 9. troca o produto, sugere uma ficha e remove a ficha incompatível', async () => {
    const fichas = await listarFichas(db, {});
    assert.equal(fichas.filter((ficha) => ficha.produto_id === 10 && ficha.ativa).length, 2);
    assert.equal(fichas.filter((ficha) => ficha.produto_id === 16 && ficha.ativa).length, 1);
    assert.equal(fichas.filter((ficha) => ficha.produto_id === 17 && ficha.ativa).length, 0);
    const morango = await salvarOrdem(db, {
      origem: 'MANUAL',
      itens: [{ produto_id: 16, quantidade_planejada: 40, unidade: 'UN' }]
    });
    const fichaMorango = fichas.find((ficha) => ficha.codigo === 'FT-010');
    assert.equal(morango.itens[0].ficha_tecnica_id, fichaMorango.id);
    const abacaxi = await salvarOrdem(db, {
      origem: 'MANUAL',
      itens: [{ produto_id: 17, quantidade_planejada: 10, unidade: 'UN' }]
    });
    assert.equal(abacaxi.itens[0].ficha_tecnica_id, null);
    const chocolate = fichas.find((ficha) => ficha.codigo === 'FT-002');
    const criada = await salvarOrdem(db, {
      origem: 'MANUAL',
      itens: [{ produto_id: 10, quantidade_planejada: 80, unidade: 'UN', ficha_tecnica_id: chocolate.id }]
    });
    assert.equal(criada.itens[0].ficha_tecnica_id, chocolate.id);
    const trocada = await salvarOrdem(db, {
      origem: 'MANUAL',
      itens: [{ produto_id: 16, quantidade_planejada: 80, unidade: 'UN', ficha_tecnica_id: chocolate.id }]
    }, criada.id);
    assert.equal(trocada.itens[0].produto_id, 16);
    assert.equal(trocada.itens[0].ficha_tecnica_id, null);
  });

  it('11 e 12. a OP da necessidade e a produção usam o mesmo produto_id', async () => {
    const fichas = await listarFichas(db, {});
    const chocolate = fichas.find((ficha) => ficha.codigo === 'FT-002');
    const necessidade = await salvarNecessidade(db, {
      origem: 'MANUAL',
      descricao: 'OP da necessidade',
      itens: [{ produto_id: 10, quantidade: 100, unidade: 'UN', ficha_tecnica_id: chocolate.id }]
    });
    const ordem = await salvarOrdem(db, { necessidade_id: necessidade.id });
    assert.equal(ordem.itens[0].produto_id, necessidade.itens[0].produto_id);
    assert.equal(ordem.itens[0].produto_id, 10);
    assert.equal(ordem.itens[0].ficha_tecnica_id, chocolate.id);
    await planejarOrdem(db, ordem.id);
    await MotorEstoque.bootstrapMotorEstoqueSchema(db);
    await MotorEstoque.entrar(db, { produtoId: 12, quantidadeBase: 500, origem: 'COMPRA', local: 'FABRICA' });
    await iniciarProducao(db, ordem.id);
    const producao = await executarProducao(db, ordem.id, {
      correlation_id: 'produto-ordem-op',
      quantidade_produzida: 100,
      quantidade_perdida: 0
    });
    assert.equal(producao.execucao.snapshot.produzidos[0].produto_id, 10);
    const saldo = await get(db, `
      SELECT estoque_atual FROM estoque_saldos_locais WHERE produto_id = 10 AND local = 'FABRICA'
    `);
    assert.equal(Number(saldo.estoque_atual), 100);
  });

  it('13. ordem já gravada continua consultável e o nome não vira vínculo', async () => {
    const colunas = await all(db, 'PRAGMA table_info(ordem_producao_itens)');
    const produto = colunas.find((coluna) => coluna.name === 'produto_id');
    assert.equal(produto.notnull, 1);
    const ordem = await salvarOrdem(db, {
      origem: 'MANUAL',
      itens: [{ produto_id: 16, quantidade_planejada: 12, unidade: 'UN' }]
    });
    await run(db, 'UPDATE produtos SET ativo = 0 WHERE id = 16');
    const lida = await obterOrdem(db, ordem.id);
    assert.equal(lida.itens[0].produto_id, 16);
    assert.equal(lida.itens[0].produto_nome, 'Picolé Morango');
    await assert.rejects(
      () => salvarOrdem(db, {
        origem: 'MANUAL',
        itens: [{ produto_nome: 'Picolé Morango', quantidade_planejada: 12, unidade: 'UN' }]
      }),
      (err) => err.message === MENSAGEM_SELECIONE_PRODUTO
    );
    const permanece = await obterOrdem(db, ordem.id);
    assert.equal(permanece.itens[0].produto_id, 16);
    await run(db, 'UPDATE produtos SET ativo = 1 WHERE id = 16');
  });
});
