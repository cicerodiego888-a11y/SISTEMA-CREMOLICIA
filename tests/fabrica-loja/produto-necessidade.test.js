/**
 * Vínculo obrigatório do produto na necessidade. Banco temporário.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const { salvarFicha, listarFichas } = require('../../backend/modules/fabrica-loja/FichaTecnicaService');
const {
  salvarNecessidade,
  obterNecessidade,
  listarProdutosProduzidos,
  MENSAGEM_SELECIONE_PRODUTO,
  MENSAGEM_PRODUTO_NAO_ENCONTRADO,
  MENSAGEM_SOMENTE_PRODUZIDO
} = require('../../backend/modules/fabrica-loja/NecessidadeProducaoService');
const { salvarOrdem, planejarOrdem } = require('../../backend/modules/fabrica-loja/OrdemProducaoService');
const { executarProducao, iniciarProducao } = require('../../backend/modules/fabrica-loja/ProducaoExecucaoService');
const MotorEstoque = require('../../backend/motores/motor-estoque');

const dir = path.join(os.tmpdir(), 'cds-fabrica-loja-testes');
fs.mkdirSync(dir, { recursive: true });
const arquivo = path.join(dir, 'produto-necessidade.db');
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

describe('Produto obrigatório na necessidade', () => {
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
      (15, 'COP', '', 'Copo', 'UN', 'COMERCIAL', 1),
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

  it('busca só produto produzido e ativo', async () => {
    const achados = await listarProdutosProduzidos(db, 'Chocolate');
    const ids = achados.map((item) => item.id).sort();
    assert.deepEqual(ids, [10, 11]);
    assert.equal(achados.every((item) => item.natureza_cadastro === 'PRODUZIDO' && item.ativo === 1), true);
    assert.equal(achados.find((item) => item.id === 10).codigo_barras, '789001');
    const porCodigo = await listarProdutosProduzidos(db, 'PIC-001');
    assert.equal(porCodigo[0].id, 10);
    const picoles = await listarProdutosProduzidos(db, 'Picolé');
    assert.equal(picoles.some((item) => item.id === 14), false);
    assert.equal(picoles.some((item) => item.id === 13), false);
  });

  it('salva a necessidade com o produto_id do produzido', async () => {
    const salva = await salvarNecessidade(db, {
      origem: 'ABASTECIMENTO',
      descricao: 'Reposição da Loja',
      itens: [{ produto_id: 10, quantidade: 500, unidade: 'UN' }]
    });
    assert.equal(salva.itens[0].produto_id, 10);
    assert.equal(salva.itens[0].descricao, 'Picolé Chocolate');
    assert.equal(salva.itens[0].quantidade, 500);
  });

  it('nome cadastrado digitado sem seleção não vincula', async () => {
    const antes = await get(db, 'SELECT COUNT(*) AS total FROM necessidades_producao');
    await assert.rejects(
      () => salvarNecessidade(db, {
        origem: 'MANUAL',
        descricao: 'Nome igual',
        itens: [{ descricao: 'Picolé Chocolate', quantidade: 500, unidade: 'UN' }]
      }),
      (err) => err.message === MENSAGEM_SELECIONE_PRODUTO
    );
    const depois = await get(db, 'SELECT COUNT(*) AS total FROM necessidades_producao');
    assert.equal(Number(depois.total), Number(antes.total));
  });

  it('bloqueia texto livre, produto inexistente, insumo e inativo', async () => {
    const antes = await get(db, 'SELECT COUNT(*) AS total FROM necessidades_producao');
    await assert.rejects(
      () => salvarNecessidade(db, {
        origem: 'MANUAL',
        descricao: 'Livre',
        itens: [{ descricao: 'Produto inventado', quantidade: 1, unidade: 'UN' }]
      }),
      (err) => err.message === MENSAGEM_SELECIONE_PRODUTO
    );
    await assert.rejects(
      () => salvarNecessidade(db, {
        origem: 'MANUAL',
        descricao: 'Inexistente',
        itens: [{ produto_id: 999, quantidade: 1, unidade: 'UN' }]
      }),
      (err) => err.message === MENSAGEM_PRODUTO_NAO_ENCONTRADO
    );
    await assert.rejects(
      () => salvarNecessidade(db, {
        origem: 'MANUAL',
        descricao: 'Insumo',
        itens: [{ produto_id: 13, quantidade: 1, unidade: 'KG' }]
      }),
      (err) => err.message === MENSAGEM_SOMENTE_PRODUZIDO
    );
    await assert.rejects(
      () => salvarNecessidade(db, {
        origem: 'MANUAL',
        descricao: 'Inativo',
        itens: [{ produto_id: 14, quantidade: 1, unidade: 'UN' }]
      }),
      (err) => err.code === 'PRODUTO_INATIVO'
    );
    const depois = await get(db, 'SELECT COUNT(*) AS total FROM necessidades_producao');
    assert.equal(Number(depois.total), Number(antes.total));
  });

  it('lista as fichas do produto e a OP usa o mesmo produto_id', async () => {
    const fichas = (await listarFichas(db, {})).filter((ficha) => ficha.produto_id === 10 && ficha.ativa);
    assert.equal(fichas.length, 2);
    const necessidade = await salvarNecessidade(db, {
      origem: 'MANUAL',
      descricao: 'Com ficha',
      itens: [{ produto_id: 10, quantidade: 500, unidade: 'UN', ficha_tecnica_id: fichas[0].id }]
    });
    const ordem = await salvarOrdem(db, {
      necessidade_id: necessidade.id,
      itens: [{
        necessidade_item_id: necessidade.itens[0].id,
        produto_id: necessidade.itens[0].produto_id,
        quantidade_planejada: 500,
        unidade: 'UN',
        ficha_tecnica_id: necessidade.itens[0].ficha_tecnica_id
      }]
    });
    assert.equal(ordem.itens[0].produto_id, necessidade.itens[0].produto_id);
    await planejarOrdem(db, ordem.id);
    await MotorEstoque.bootstrapMotorEstoqueSchema(db);
    await MotorEstoque.entrar(db, { produtoId: 12, quantidadeBase: 500, origem: 'COMPRA', local: 'FABRICA' });
    await iniciarProducao(db, ordem.id);
    const producao = await executarProducao(db, ordem.id, {
      correlation_id: 'produto-necessidade-op',
      quantidade_produzida: 500,
      quantidade_perdida: 0
    });
    assert.equal(producao.execucao.snapshot.produzidos[0].produto_id, 10);
    const todas = await listarFichas(db, {});
    assert.equal(todas.filter((ficha) => ficha.produto_id === 16 && ficha.ativa).length, 1);
    assert.equal(todas.filter((ficha) => ficha.produto_id === 17 && ficha.ativa).length, 0);
  });

  it('trocar o produto remove a ficha do produto anterior', async () => {
    const fichas = await listarFichas(db, {});
    const chocolate = fichas.find((ficha) => ficha.codigo === 'FT-002');
    const criada = await salvarNecessidade(db, {
      origem: 'MANUAL',
      descricao: 'Troca',
      itens: [{ produto_id: 10, quantidade: 500, unidade: 'UN', ficha_tecnica_id: chocolate.id }]
    });
    const trocada = await salvarNecessidade(db, {
      origem: 'MANUAL',
      descricao: 'Troca',
      itens: [{ produto_id: 16, quantidade: 500, unidade: 'UN', ficha_tecnica_id: chocolate.id }]
    }, criada.id);
    assert.equal(trocada.itens[0].produto_id, 16);
    assert.equal(trocada.itens[0].ficha_tecnica_id, null);
  });

  it('necessidade antiga sem produto_id continua consultável', async () => {
    const inserida = await run(db, `
      INSERT INTO necessidades_producao (codigo, origem, descricao, status)
      VALUES ('NP-LEGADO', 'MANUAL', 'Texto antigo', 'ABERTA')
    `);
    await run(db, `
      INSERT INTO necessidade_producao_itens (necessidade_id, ordem, produto_id, descricao, quantidade, unidade)
      VALUES (?, 1, NULL, 'Picolé inventado na época', 3, 'UN')
    `, [inserida.lastID]);
    const lida = await obterNecessidade(db, inserida.lastID);
    assert.equal(lida.itens[0].produto_id, null);
    assert.equal(lida.itens[0].descricao, 'Picolé inventado na época');
    assert.equal(lida.itens[0].quantidade, 3);
  });
});
