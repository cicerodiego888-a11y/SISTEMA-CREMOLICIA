/**
 * Grupos livres de insumos. Banco temporário. Não mexe em estoque nem em natureza.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const {
  criarGrupoInsumo,
  atualizarGrupoInsumo,
  excluirGrupoInsumo,
  aplicarGrupoInsumo,
  listarGruposInsumos,
  filtrarInsumosCatalogo,
  MENSAGEM_GRUPO_EM_USO
} = require('../../backend/modules/fabrica-loja/GrupoInsumoService');
const { aplicarNaturezaCadastro } = require('../../backend/modules/fabrica-loja/naturezaCadastro');

const dir = path.join(os.tmpdir(), 'cds-fabrica-loja-testes');
fs.mkdirSync(dir, { recursive: true });
const arquivo = path.join(dir, 'grupos-insumos.db');
for (const sufixo of ['', '-wal', '-shm']) {
  fs.rmSync(arquivo + sufixo, { force: true });
}

function abrir() {
  return new sqlite3.Database(arquivo);
}

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

describe('Grupos de insumos', () => {
  let db;

  before(async () => {
    db = abrir();
    await run(db, `
      CREATE TABLE produtos (
        id INTEGER PRIMARY KEY,
        codigo TEXT,
        nome TEXT,
        unidade TEXT,
        estoque_atual REAL DEFAULT 0,
        saldo_fiscal REAL DEFAULT 0,
        saldo_nao_fiscal REAL DEFAULT 0,
        ativo INTEGER DEFAULT 1,
        natureza_cadastro TEXT,
        observacoes TEXT
      )
    `);
    await run(db, `
      INSERT INTO produtos (id, codigo, nome, unidade, estoque_atual, saldo_fiscal, natureza_cadastro)
      VALUES (20, 'LEI', 'Leite Integral', 'L', 25, 25, 'INSUMO')
    `);
  });

  after(() => {
    if (db) db.close();
  });

  it('cria, edita, vincula e reabre o grupo sem mudar natureza nem estoque', async () => {
    const materia = await criarGrupoInsumo(db, { nome: 'Matéria-prima' });
    const editado = await atualizarGrupoInsumo(db, materia.id, { nome: 'Laticínios' });
    assert.equal(editado.nome, 'Laticínios');
    assert.equal(editado.id, materia.id);

    await aplicarGrupoInsumo(db, 20, { grupo_insumo_id: editado.id, natureza_cadastro: 'COMERCIAL' });
    const leite = await get(db, `
      SELECT grupo_insumo_id, natureza_cadastro, estoque_atual, saldo_fiscal
      FROM produtos WHERE id = 20
    `);
    assert.equal(Number(leite.grupo_insumo_id), editado.id);
    assert.equal(leite.natureza_cadastro, 'INSUMO');
    assert.equal(Number(leite.estoque_atual), 25);
    assert.equal(Number(leite.saldo_fiscal), 25);
  });

  it('exclui grupo livre e bloqueia grupo usado, sem apagar o insumo', async () => {
    const palitos = await criarGrupoInsumo(db, { nome: 'Palitos' });
    await excluirGrupoInsumo(db, palitos.id);
    const sumiu = await get(db, 'SELECT id FROM grupos_insumos WHERE id = ?', [palitos.id]);
    assert.equal(sumiu, undefined);

    const leite = await get(db, 'SELECT grupo_insumo_id FROM produtos WHERE id = 20');
    await assert.rejects(
      () => excluirGrupoInsumo(db, leite.grupo_insumo_id),
      (err) => err.message === MENSAGEM_GRUPO_EM_USO
    );
    const permanece = await get(db, `
      SELECT id, nome, natureza_cadastro, estoque_atual FROM produtos WHERE id = 20
    `);
    assert.equal(permanece.nome, 'Leite Integral');
    assert.equal(permanece.natureza_cadastro, 'INSUMO');
    assert.equal(Number(permanece.estoque_atual), 25);
    assert.equal(
      MENSAGEM_GRUPO_EM_USO,
      'Não é possível excluir este grupo porque existem insumos vinculados a ele.'
    );
  });

  it('grava, reabre, troca e filtra o grupo do insumo', async () => {
    await run(db, `
      INSERT INTO produtos (id, codigo, nome, unidade, natureza_cadastro, ativo)
      VALUES (43, '0043', 'POUPA DE ABACAXI', 'KG', NULL, 1)
    `);
    const frutas = await criarGrupoInsumo(db, { nome: 'Frutas' });
    await aplicarNaturezaCadastro(db, 43, { natureza_cadastro: 'INSUMO', observacoes: 'Polpa' });
    await aplicarGrupoInsumo(db, 43, { grupo_insumo_id: frutas.id });
    const reaberto = await get(db, `
      SELECT id, codigo, nome, unidade, natureza_cadastro, grupo_insumo_id, ativo, estoque_atual
      FROM produtos WHERE id = 43
    `);
    assert.equal(reaberto.nome, 'POUPA DE ABACAXI');
    assert.equal(reaberto.codigo, '0043');
    assert.equal(reaberto.unidade, 'KG');
    assert.equal(reaberto.natureza_cadastro, 'INSUMO');
    assert.equal(Number(reaberto.grupo_insumo_id), frutas.id);
    assert.equal(Number(reaberto.estoque_atual || 0), 0);

    const grupos = await listarGruposInsumos(db);
    const frutasLista = grupos.find((item) => item.id === frutas.id);
    assert.equal(frutasLista.nome, 'Frutas');
    assert.equal(frutasLista.quantidade, 1);
    const catalogo = [reaberto];
    assert.equal(filtrarInsumosCatalogo(catalogo, grupos, { grupoId: String(frutas.id) }).length, 1);
    assert.equal(filtrarInsumosCatalogo(catalogo, grupos, { grupoId: 'sem' }).length, 0);
    assert.equal(filtrarInsumosCatalogo(catalogo, grupos, { termo: 'frutas' }).length, 1);

    await aplicarGrupoInsumo(db, 43, { grupo_insumo_id: null });
    const semGrupo = await get(db, 'SELECT grupo_insumo_id, natureza_cadastro FROM produtos WHERE id = 43');
    assert.equal(semGrupo.grupo_insumo_id, null);
    assert.equal(semGrupo.natureza_cadastro, 'INSUMO');
    const sem = Object.assign({}, reaberto, { grupo_insumo_id: null });
    assert.equal(filtrarInsumosCatalogo([sem], grupos, { grupoId: 'sem' }).length, 1);
    assert.equal(filtrarInsumosCatalogo([sem], grupos, { grupoId: String(frutas.id) }).length, 0);

    const embalagens = await criarGrupoInsumo(db, { nome: 'Embalagens' });
    await aplicarGrupoInsumo(db, 43, { grupo_insumo_id: embalagens.id });
    const trocado = await get(db, 'SELECT grupo_insumo_id, ativo FROM produtos WHERE id = 43');
    assert.equal(Number(trocado.grupo_insumo_id), embalagens.id);
    await run(db, 'UPDATE produtos SET ativo = 0 WHERE id = 43');
    const inativo = await get(db, 'SELECT grupo_insumo_id, ativo, natureza_cadastro FROM produtos WHERE id = 43');
    assert.equal(Number(inativo.grupo_insumo_id), embalagens.id);
    assert.equal(Number(inativo.ativo), 0);
    const linha = Object.assign({}, reaberto, { grupo_insumo_id: embalagens.id, ativo: 0 });
    assert.equal(filtrarInsumosCatalogo([linha], grupos, {}).length, 0);
    assert.equal(filtrarInsumosCatalogo([linha], grupos, { mostrarInativos: true, grupoId: String(embalagens.id) }).length, 1);

    await run(db, `
      INSERT INTO produtos (id, codigo, nome, unidade, natureza_cadastro)
      VALUES (44, '0044', 'Água', 'L', 'INSUMO')
    `);
    const agua = await get(db, 'SELECT grupo_insumo_id FROM produtos WHERE id = 44');
    assert.equal(agua.grupo_insumo_id, null);
  });
});
