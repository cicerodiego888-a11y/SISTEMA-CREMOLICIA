/**
 * Compra sem produto correspondente não cria produto nem estoque.
 * Banco temporário. Não abre o banco oficial.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const {
  resolverProdutoItemCompra,
  resolverItensCompra,
  itemPodeEntrarEstoque,
  MENSAGEM_PRODUTO_NAO_CADASTRADO,
  CODIGO_PRODUTO_NAO_CADASTRADO
} = require('../../backend/modules/compras/resolverProdutoItem');
const { aplicarNaturezaCadastro } = require('../../backend/modules/fabrica-loja/naturezaCadastro');
const { criarGrupoInsumo, aplicarGrupoInsumo } = require('../../backend/modules/fabrica-loja/GrupoInsumoService');

const dir = path.join(os.tmpdir(), 'cds-compras-testes');
fs.mkdirSync(dir, { recursive: true });
const arquivo = path.join(dir, 'bloqueio-cadastro-automatico.db');
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
      else resolve({ id: this.lastID, changes: this.changes });
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

describe('Bloqueio de cadastro automático na compra', () => {
  let db;

  before(async () => {
    db = abrir();
    await run(db, `
      CREATE TABLE produtos (
        id INTEGER PRIMARY KEY,
        codigo TEXT,
        codigo_barras TEXT,
        nome TEXT,
        unidade TEXT,
        natureza_cadastro TEXT,
        estoque_atual REAL DEFAULT 0
      )
    `);
    await run(db, `
      CREATE TABLE estoque_movimentacoes (
        id INTEGER PRIMARY KEY,
        produto_id INTEGER,
        operacao TEXT
      )
    `);
    await run(db, "INSERT INTO produtos (id, codigo, codigo_barras, nome, unidade, natureza_cadastro) VALUES (1, 'LEI', '7891000000001', 'Leite', 'L', 'INSUMO')");
    await run(db, "INSERT INTO produtos (id, codigo, codigo_barras, nome, unidade, natureza_cadastro) VALUES (2, 'CHO', '7891000000002', 'Chocolate', 'KG', 'INSUMO')");
    await run(db, "INSERT INTO produtos (id, codigo, codigo_barras, nome, unidade, natureza_cadastro) VALUES (4, 'COP', '7891000000004', 'Copo descartavel', 'UN', 'COMERCIAL')");
  });

  after(() => {
    if (db) db.close();
  });

  it('1. usa o produto_id informado', async () => {
    const antes = await get(db, 'SELECT natureza_cadastro FROM produtos WHERE id = 1');
    const resultado = await resolverProdutoItemCompra(db, {
      produto_id: 1,
      produto_nome: 'Outro nome',
      quantidade: 10
    });
    assert.equal(resultado.situacao, 'VINCULADO');
    assert.equal(resultado.produtoId, 1);
    assert.equal(itemPodeEntrarEstoque(resultado), true);
    const depois = await get(db, 'SELECT natureza_cadastro FROM produtos WHERE id = 1');
    assert.equal(depois.natureza_cadastro, antes.natureza_cadastro);
  });

  it('2. código igual vira sugestão, sem vínculo e sem criar produto', async () => {
    const antes = await all(db, 'SELECT id FROM produtos');
    const resultado = await resolverProdutoItemCompra(db, {
      codigo: 'CHO',
      produto_nome: 'Chocolate da nota',
      quantidade: 5
    });
    const depois = await all(db, 'SELECT id FROM produtos');
    assert.equal(resultado.produtoId, null);
    assert.equal(resultado.situacao, CODIGO_PRODUTO_NAO_CADASTRADO);
    assert.equal(resultado.sugestoes[0].id, 2);
    assert.equal(resultado.sugestoes[0].motivo, 'CODIGO');
    assert.deepEqual(depois.map((row) => row.id), antes.map((row) => row.id));
  });

  it('3. código de barras igual vira sugestão, sem vínculo e sem criar produto', async () => {
    const antes = await all(db, 'SELECT id FROM produtos');
    const resultado = await resolverProdutoItemCompra(db, {
      codigo_barras: '7891000000002',
      produto_nome: 'Item sem nome igual',
      quantidade: 3
    });
    const depois = await all(db, 'SELECT id FROM produtos');
    assert.equal(resultado.produtoId, null);
    assert.equal(resultado.sugestoes[0].id, 2);
    assert.equal(resultado.sugestoes[0].motivo, 'CODIGO_BARRAS');
    assert.deepEqual(depois.map((row) => row.id), antes.map((row) => row.id));
  });

  it('4. nome igual não vincula: só sugere', async () => {
    const resultado = await resolverProdutoItemCompra(db, {
      produto_nome: 'Leite',
      quantidade: 100,
      unidade: 'L'
    });
    assert.equal(resultado.produtoId, null);
    assert.equal(resultado.situacao, CODIGO_PRODUTO_NAO_CADASTRADO);
    assert.equal(itemPodeEntrarEstoque(resultado), false);
    assert.deepEqual(resultado.sugestoes.map((s) => [s.id, s.motivo]), [[1, 'NOME']]);
  });

  it('5. sem correspondência fica pendente e não cria produto', async () => {
    const antes = await all(db, 'SELECT id FROM produtos');
    const resultado = await resolverProdutoItemCompra(db, {
      produto_nome: 'Freezer 300L',
      codigo: 'FRZ-NOVO',
      codigo_barras: '7899999999999',
      quantidade: 1,
      unidade: 'UN'
    });
    const depois = await all(db, 'SELECT id FROM produtos');
    assert.equal(resultado.situacao, CODIGO_PRODUTO_NAO_CADASTRADO);
    assert.equal(resultado.produtoId, null);
    assert.equal(itemPodeEntrarEstoque(resultado), false);
    assert.deepEqual(depois.map((row) => row.id), antes.map((row) => row.id));
  });

  it('6 e 12. item sem produto não entra no estoque', async () => {
    const resultado = await resolverProdutoItemCompra(db, {
      produto_nome: 'Balança',
      codigo_barras: '0000000000000',
      quantidade: 1
    });
    assert.equal(itemPodeEntrarEstoque(resultado), false);
    const movimentos = await all(db, 'SELECT id FROM estoque_movimentacoes');
    assert.equal(movimentos.length, 0);

    const compras = fs.readFileSync(path.join(__dirname, '../../backend/rotas/compras.js'), 'utf8');
    const processar = compras.slice(
      compras.indexOf('function processarItensCompra'),
      compras.indexOf('router.get(')
    );
    const bloqueio = processar.indexOf('if (prodErr) return finalizarItem(prodErr);');
    const entrada = processar.indexOf('MotorEstoque.entrar(db,');
    assert.ok(bloqueio >= 0 && entrada > bloqueio);
  });

  it('7. depois do cadastro o produto_id fica vinculado ao item', async () => {
    const antes = await all(db, 'SELECT id FROM produtos');
    const semCadastro = await resolverProdutoItemCompra(db, { produto_nome: 'Palito de madeira', codigo: 'PALITO' });
    assert.equal(semCadastro.situacao, CODIGO_PRODUTO_NAO_CADASTRADO);
    const criado = await run(
      db,
      "INSERT INTO produtos (codigo, nome, unidade, natureza_cadastro) VALUES ('PALITO', 'Palito de madeira', 'UN', NULL)"
    );
    const vinculado = await resolverProdutoItemCompra(db, { produto_id: criado.id, produto_nome: 'Palito de madeira' });
    const depois = await all(db, 'SELECT id FROM produtos');
    assert.equal(vinculado.produtoId, criado.id);
    assert.equal(vinculado.situacao, 'VINCULADO');
    assert.equal(depois.length, antes.length + 1);
  });

  it('8. vincular produto existente grava o produto_id sem criar outro', async () => {
    const antes = await all(db, 'SELECT id FROM produtos');
    const resultado = await resolverProdutoItemCompra(db, { produto_id: 2, produto_nome: 'Chocolate em pó' });
    const depois = await all(db, 'SELECT id FROM produtos');
    assert.equal(resultado.produtoId, 2);
    assert.deepEqual(depois.map((row) => row.id), antes.map((row) => row.id));
  });

  it('9. cadastro como insumo grava a natureza escolhida', async () => {
    const criado = await run(
      db,
      "INSERT INTO produtos (codigo, nome, unidade) VALUES ('PO', 'Chocolate em Po', 'KG')"
    );
    const grupo = await criarGrupoInsumo(db, { nome: 'Matéria-prima teste' });
    await aplicarNaturezaCadastro(db, criado.id, { natureza_cadastro: 'INSUMO' });
    await aplicarGrupoInsumo(db, criado.id, { grupo_insumo_id: grupo.id });
    const produto = await get(db, 'SELECT natureza_cadastro, grupo_insumo_id FROM produtos WHERE id = ?', [criado.id]);
    const vinculado = await resolverProdutoItemCompra(db, { produto_id: criado.id });
    assert.equal(produto.natureza_cadastro, 'INSUMO');
    assert.equal(Number(produto.grupo_insumo_id), Number(grupo.id));
    assert.equal(vinculado.natureza_cadastro, 'INSUMO');
    assert.equal(vinculado.produtoId, criado.id);
  });

  it('10. vincular não altera a natureza do produto existente', async () => {
    const antes = await get(db, 'SELECT natureza_cadastro FROM produtos WHERE id = 4');
    const resultado = await resolverProdutoItemCompra(db, {
      produto_id: 4,
      produto_nome: 'Copo descartável da nota'
    });
    const depois = await get(db, 'SELECT natureza_cadastro FROM produtos WHERE id = 4');
    assert.equal(resultado.produtoId, 4);
    assert.equal(depois.natureza_cadastro, 'COMERCIAL');
    assert.equal(depois.natureza_cadastro, antes.natureza_cadastro);
    const fonte = fs.readFileSync(path.join(__dirname, '../../backend/modules/compras/resolverProdutoItem.js'), 'utf8');
    assert.equal(fonte.includes('INSERT'), false);
    assert.equal(fonte.includes('UPDATE'), false);
  });

  it('11. nota mista segue com os itens confirmados e deixa os outros pendentes', async () => {
    const antes = await all(db, 'SELECT id FROM produtos');
    const resolvido = await resolverItensCompra(db, [
      { produto_id: 1, produto_nome: 'Leite', quantidade: 100 },
      { produto_id: 2, produto_nome: 'Chocolate', quantidade: 50 },
      { codigo: 'CHO', produto_nome: 'Chocolate', quantidade: 50 },
      { produto_nome: 'Freezer', codigo: 'FRZ-AUSENTE', quantidade: 1, unidade: 'UN' }
    ]);
    const depois = await all(db, 'SELECT id FROM produtos');
    assert.equal(resolvido.resultados[0].situacao, 'VINCULADO');
    assert.equal(resolvido.resultados[1].situacao, 'VINCULADO');
    assert.equal(resolvido.resultados[2].situacao, CODIGO_PRODUTO_NAO_CADASTRADO);
    assert.equal(resolvido.resultados[3].situacao, CODIGO_PRODUTO_NAO_CADASTRADO);
    assert.equal(itemPodeEntrarEstoque(resolvido.resultados[0]), true);
    assert.equal(itemPodeEntrarEstoque(resolvido.resultados[1]), true);
    assert.equal(itemPodeEntrarEstoque(resolvido.resultados[2]), false);
    assert.equal(itemPodeEntrarEstoque(resolvido.resultados[3]), false);
    assert.equal(resolvido.pendentes.length, 2);
    assert.deepEqual(depois.map((row) => row.id), antes.map((row) => row.id));
    assert.equal(MENSAGEM_PRODUTO_NAO_CADASTRADO, 'Existem itens da compra sem produto cadastrado. Cadastre ou vincule esses produtos antes de concluir a entrada.');
  });

  it('a compra não insere produto automaticamente e a tela oferece as duas ações', () => {
    const compras = fs.readFileSync(path.join(__dirname, '../../backend/rotas/compras.js'), 'utf8');
    const garantia = compras.slice(
      compras.indexOf('function ensureProductForItem'),
      compras.indexOf('function resolverItensAntesDeGravar')
    );
    assert.ok(garantia.length > 0);
    assert.equal(garantia.includes('INSERT INTO produtos'), false);
    assert.match(compras, /MotorEstoque\.entrar\(db,/);
    assert.match(compras, /MENSAGEM_PRODUTO_NAO_CADASTRADO/);
    const mensagem = fs.readFileSync(path.join(__dirname, '../../backend/modules/compras/resolverProdutoItem.js'), 'utf8');
    assert.match(mensagem, /Existem itens da compra sem produto cadastrado/);

    const tela = fs.readFileSync(path.join(__dirname, '../../frontend/erp/js/compras.js'), 'utf8');
    assert.match(tela, /Existem itens da compra sem produto cadastrado/);
    assert.match(tela, /PRODUTO NÃO CADASTRADO/);
    assert.match(tela, /Cadastrar produto/);
    assert.match(tela, /Vincular produto existente/);
    assert.match(tela, /showProdutoModal\(null\)/);
    const vinculo = tela.slice(
      tela.indexOf('function vincularProdutoItemCompra'),
      tela.indexOf('function buscarSugestoesProdutosItensCompra')
    );
    assert.equal(vinculo.includes('natureza_cadastro'), false);
    const prefill = tela.slice(
      tela.indexOf('function preencherCadastroProdutoDesdeItemCompra'),
      tela.indexOf('function cadastrarProdutoItemCompra')
    );
    assert.equal(prefill.includes('INSUMO'), false);
  });
});
