/**
 * Fichas tradicionais independentes de produto.
 * Usa somente banco temporário e a tela real de cadastro de fichas.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const { JSDOM } = require('jsdom');
const {
  bootstrapFabricaLojaSchema,
  salvarFicha,
  obterFicha,
  listarFichasTradicionaisDoProduto,
  vincularFichaTradicionalProduto,
  desvincularFichaTradicionalProduto
} = require('../../backend/modules/fabrica-loja');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-ficha-independente-'));
const arquivo = path.join(dir, 'ficha.db');
const scriptFicha = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'erp', 'js', 'fichas-tecnicas.js'),
  'utf8'
);

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function esperar(condicao, descricao) {
  const inicio = Date.now();
  return new Promise((resolve, reject) => {
    const verificar = () => {
      if (condicao()) return resolve();
      if (Date.now() - inicio > 3000) return reject(new Error(`Tempo esgotado: ${descricao}`));
      setTimeout(verificar, 10);
    };
    verificar();
  });
}

describe('Ficha tradicional independente e vínculo no produto', () => {
  let db;

  before(async () => {
    db = new sqlite3.Database(arquivo);
    await run(db, `
      CREATE TABLE produtos (
        id INTEGER PRIMARY KEY,
        codigo TEXT,
        nome TEXT,
        unidade TEXT,
        ativo INTEGER DEFAULT 1,
        natureza_cadastro TEXT
      )
    `);
    await run(db, `
      INSERT INTO produtos (id, codigo, nome, unidade, ativo, natureza_cadastro) VALUES
        (1, 'P-1', 'Picolé A', 'UN', 1, 'PRODUZIDO'),
        (2, 'P-2', 'Picolé B', 'UN', 1, 'PRODUZIDO'),
        (3, 'I-1', 'Leite', 'L', 1, 'INSUMO')
    `);
    await bootstrapFabricaLojaSchema(db);
  });

  after(async () => {
    if (db) await new Promise((resolve, reject) => db.close((err) => (err ? reject(err) : resolve())));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('cria e edita ficha tradicional sem produto associado', async () => {
    const criada = await salvarFicha(db, {
      codigo: 'FT-INDEPENDENTE',
      nome: 'Base tradicional',
      rendimento_quantidade: 10,
      rendimento_unidade: 'UN',
      componentes: [{ produto_id: 3, quantidade: 2, unidade: 'L' }],
      etapas: [{ titulo: 'Misturar' }]
    });
    assert.equal(criada.produto_id, null);
    assert.equal(criada.componentes[0].produto_id, 3);

    const { produto_id, produto_nome, ...edicao } = criada;
    const atualizada = await salvarFicha(db, {
      ...edicao,
      nome: 'Base tradicional revisada',
      componentes: [{ produto_id: 3, quantidade: 3, unidade: 'L' }]
    }, criada.id);
    assert.equal(atualizada.produto_id, null);
    assert.equal(atualizada.nome, 'Base tradicional revisada');
    assert.equal(atualizada.componentes[0].quantidade, 3);
    assert.notEqual(produto_id, undefined);
    assert.notEqual(produto_nome, undefined);

    await assert.rejects(
      () => salvarFicha(db, { codigo: 'FT-INVALIDA', nome: 'Tentativa', produto_id: 1 }),
      (err) => err.code === 'FICHA_PRODUTO_REMOVIDO'
    );
  });

  it('vincula fichas tradicionais no cadastro do produto e preserva os dados ao desvincular', async () => {
    const primeira = await salvarFicha(db, {
      codigo: 'FT-TRAD-1',
      nome: 'Receita A',
      rendimento_quantidade: 10,
      rendimento_unidade: 'UN',
      componentes: [{ produto_id: 3, quantidade: 2, unidade: 'L' }]
    });
    const segunda = await salvarFicha(db, {
      codigo: 'FT-TRAD-2',
      nome: 'Receita B',
      componentes: [{ produto_id: 3, quantidade: 1, unidade: 'L' }]
    });
    const primeiraOriginal = await obterFicha(db, primeira.id);

    const vinculada = await vincularFichaTradicionalProduto(db, primeira.id, 1);
    await vincularFichaTradicionalProduto(db, segunda.id, 1);
    assert.equal(vinculada.produto_id, 1);
    assert.deepEqual(
      (await listarFichasTradicionaisDoProduto(db, 1)).map((item) => item.id),
      [primeira.id, segunda.id]
    );
    await assert.rejects(
      () => vincularFichaTradicionalProduto(db, primeira.id, 2),
      (err) => err.code === 'FICHA_VINCULADA_OUTRO_PRODUTO'
    );

    const { produto_id, produto_nome, ...edicao } = await obterFicha(db, primeira.id);
    await salvarFicha(db, { ...edicao, observacoes: 'Alteração da definição' }, primeira.id);
    assert.equal((await obterFicha(db, primeira.id)).produto_id, 1);

    const removido = await desvincularFichaTradicionalProduto(db, primeira.id, 1);
    assert.equal(removido.removido, true);
    const fichaDesvinculada = await obterFicha(db, primeira.id);
    assert.equal(fichaDesvinculada.id, primeiraOriginal.id);
    assert.equal(fichaDesvinculada.nome, primeiraOriginal.nome);
    assert.equal(fichaDesvinculada.produto_id, null);
    assert.equal(fichaDesvinculada.observacoes, 'Alteração da definição');
    assert.deepEqual(fichaDesvinculada.componentes.map((item) => ({
      produto_id: item.produto_id,
      descricao: item.descricao,
      quantidade: item.quantidade,
      unidade: item.unidade
    })), primeiraOriginal.componentes.map((item) => ({
      produto_id: item.produto_id,
      descricao: item.descricao,
      quantidade: item.quantidade,
      unidade: item.unidade
    })));
    assert.deepEqual(
      (await listarFichasTradicionaisDoProduto(db, 1)).map((item) => item.id),
      [segunda.id]
    );
    assert.notEqual(produto_id, undefined);
    assert.notEqual(produto_nome, undefined);
  });

  it('não exige nem exibe associação no formulário tradicional', async () => {
    const dom = new JSDOM('<!doctype html><body><div id="page-content"></div></body>', {
      runScripts: 'outside-only',
      url: 'http://localhost/'
    });
    const { window } = dom;
    window.eval(fs.readFileSync(
      path.join(__dirname, '..', '..', 'frontend', 'vendor', 'jquery', 'jquery.min.js'),
      'utf8'
    ));
    window.eval(scriptFicha);
    window.ftApi = () => {
      const deferred = window.$.Deferred();
      queueMicrotask(() => deferred.resolve({ success: true, fichas: [] }));
      return deferred.promise();
    };
    window.loadFichasTecnicas();
    await esperar(() => window.document.getElementById('ft-nova'), 'tela de fichas');
    window.document.getElementById('ft-nova').click();
    const formulario = window.document.getElementById('ft-form');
    assert.ok(formulario);
    assert.equal(formulario.querySelector('[data-ft-produto-nome]'), null);
    assert.doesNotMatch(formulario.textContent, /Produto fabricado/);
    dom.window.close();
  });
});
