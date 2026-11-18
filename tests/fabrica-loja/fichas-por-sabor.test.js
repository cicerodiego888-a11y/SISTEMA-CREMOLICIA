'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const FabricaLoja = require('../../backend/modules/fabrica-loja');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-fichas-sabor-'));
const arquivo = path.join(dir, 'fichas-sabor.db');

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

describe('Fichas por sabor — herança integral e versões isoladas', () => {
  let db;

  before(async () => {
    db = new sqlite3.Database(arquivo);
    await run(db, 'PRAGMA foreign_keys = ON');
    await run(db, `
      CREATE TABLE produtos (
        id INTEGER PRIMARY KEY,
        codigo TEXT,
        nome TEXT NOT NULL,
        unidade TEXT NOT NULL,
        estoque_atual REAL DEFAULT 0,
        ativo INTEGER DEFAULT 1,
        natureza_cadastro TEXT NOT NULL
      )
    `);
    await run(db, `
      INSERT INTO produtos (id, codigo, nome, unidade, estoque_atual, ativo, natureza_cadastro) VALUES
        (1, 'LE', 'Leite', 'kg', 80, 1, 'INSUMO'),
        (2, 'AC', 'Açúcar', 'kg', 70, 1, 'INSUMO'),
        (3, 'ES', 'Estabilizante', 'kg', 60, 1, 'INSUMO'),
        (4, 'CH', 'Chocolate', 'kg', 50, 1, 'INSUMO'),
        (5, 'PO', 'Polpa', 'kg', 40, 1, 'INSUMO'),
        (100, 'SORV-M', 'Sorvete Morango', 'kg', 0, 1, 'PRODUZIDO'),
        (101, 'SORV-C', 'Sorvete Chocolate', 'kg', 0, 1, 'PRODUZIDO')
    `);
    await FabricaLoja.bootstrapFabricaLojaSchema(db);
    await run(db, `
      CREATE TABLE produto_conversoes (
        id INTEGER PRIMARY KEY,
        produto_id INTEGER NOT NULL,
        origem TEXT NOT NULL,
        destino TEXT NOT NULL,
        fator REAL NOT NULL,
        tipo TEXT NOT NULL,
        ativo INTEGER NOT NULL DEFAULT 1
      )
    `);
    await run(db, `
      INSERT INTO produto_conversoes (id, produto_id, origem, destino, fator, tipo, ativo)
      VALUES (1, 1, 'BALDE', 'kg', 2, 'FIXA', 1)
    `);
    await run(db, `
      CREATE TABLE produto_unidades (
        id INTEGER PRIMARY KEY,
        produto_id INTEGER NOT NULL,
        unidade TEXT NOT NULL,
        descricao TEXT,
        fator_conversao REAL NOT NULL,
        principal INTEGER NOT NULL DEFAULT 0,
        ativo INTEGER NOT NULL DEFAULT 1,
        ordem INTEGER NOT NULL DEFAULT 0
      )
    `);
    await run(db, `
      INSERT INTO produto_unidades
        (id, produto_id, unidade, descricao, fator_conversao, principal, ativo, ordem)
      VALUES (1, 2, 'CAIXA', 'Caixa', 2, 0, 1, 1)
    `);
  });

  after(async () => {
    if (db) await new Promise((resolve, reject) => db.close((err) => (err ? reject(err) : resolve())));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('herda toda a ficha, isola personalizações, mantém versões e revisa a origem sem sobrescrever dados', async () => {
    const tradicional = await FabricaLoja.salvarFicha(db, {
      codigo: 'FT-BASE-CREME',
      nome: 'Base cremosa',
      rendimento_quantidade: 10,
      rendimento_unidade: 'kg',
      observacoes: 'Resfriar antes de armazenar',
      componentes: [
        { produto_id: 1, quantidade: 4, unidade: 'kg', observacao: 'Integral' },
        { produto_id: 2, quantidade: 2, unidade: 'kg', observacao: '' },
        { produto_id: 3, quantidade: 0.2, unidade: 'kg', observacao: 'Homogeneizar' }
      ],
      etapas: Array.from({ length: 5 }, (_, indice) => ({
        titulo: `Etapa ${indice + 1}`,
        descricao: `Instrução ${indice + 1}`,
        tempo_minutos: indice + 1,
        observacao: `Nota ${indice + 1}`
      })),
      informacoes: Array.from({ length: 4 }, (_, indice) => ({
        titulo: `Informação ${indice + 1}`,
        valor: `Valor ${indice + 1}`
      }))
    });
    const origemAntes = await FabricaLoja.obterFicha(db, tradicional.id);
    await assert.rejects(
      () => FabricaLoja.criarFichaPorSabor(db, {
        codigo: 'SAB-INSUMO',
        nome: 'Produto inválido',
        produto_id: 1,
        ficha_tradicional_id: tradicional.id
      }),
      (err) => err.code === 'PRODUTO_NAO_PRODUZIDO'
    );
    const comConversaoCadastrada = await FabricaLoja.criarFichaPorSabor(db, {
      codigo: 'SAB-CONVERSAO-CADASTRADA',
      nome: 'Conversão cadastrada',
      produto_id: 100,
      ficha_tradicional_id: tradicional.id,
      componentes: [{ produto_id: 1, quantidade: 1, unidade: 'BALDE' }]
    });
    assert.equal(comConversaoCadastrada.versoes[0].componentes[0].unidade, 'BALDE');
    const publicadaComConversao = await FabricaLoja.publicarVersaoPadrao(
      db,
      comConversaoCadastrada.id,
      comConversaoCadastrada.versoes[0].id
    );
    assert.equal(publicadaComConversao.estado, 'PUBLICADA');
    const comUnidadeComercial = await FabricaLoja.criarFichaPorSabor(db, {
      codigo: 'SAB-UNIDADE-COMERCIAL',
      nome: 'Unidade comercial cadastrada',
      produto_id: 100,
      ficha_tradicional_id: tradicional.id,
      componentes: [{ produto_id: 2, quantidade: 1, unidade: 'CAIXA' }]
    });
    const publicadaComUnidadeComercial = await FabricaLoja.publicarVersaoPadrao(
      db,
      comUnidadeComercial.id,
      comUnidadeComercial.versoes[0].id
    );
    assert.equal(publicadaComUnidadeComercial.estado, 'PUBLICADA');
    const morango = await FabricaLoja.criarFichaPorSabor(db, {
      codigo: 'SAB-MORANGO',
      nome: 'Morango',
      produto_id: 100,
      ficha_tradicional_id: tradicional.id,
      componentes: [
        { produto_id: 1, quantidade: 7, unidade: 'kg', observacao: 'Quantidade personalizada' },
        ...origemAntes.componentes.slice(1).map((item) => ({
          produto_id: item.produto_id,
          quantidade: item.quantidade,
          unidade: item.unidade,
          observacao: item.observacao
        })),
        { produto_id: 4, quantidade: 1, unidade: 'kg', observacao: 'Adicionado ao sabor' }
      ],
      etapas: [
        { ...origemAntes.etapas[0], titulo: 'Misturar base e morango' },
        ...origemAntes.etapas.slice(1).map((item) => ({ ...item })),
        { titulo: 'Adicionar polpa', descricao: 'Misturar ao final', tempo_minutos: 2, observacao: 'Etapa do sabor' }
      ],
      informacoes: [
        { ...origemAntes.informacoes[0], valor: 'Personalizado para morango' },
        ...origemAntes.informacoes.slice(1).map((item) => ({ ...item })),
        { titulo: 'Sabor', valor: 'Morango' }
      ]
    });
    const chocolate = await FabricaLoja.criarFichaPorSabor(db, {
      codigo: 'SAB-CHOCOLATE',
      nome: 'Chocolate',
      produto_id: 101,
      ficha_tradicional_id: tradicional.id
    });

    assert.deepEqual(morango.vinculos.map((item) => item.produto_id), [100]);
    assert.deepEqual(chocolate.vinculos.map((item) => item.produto_id), [101]);
    assert.equal(morango.vinculos[0].produto_codigo, 'SORV-M');
    await assert.rejects(
      () => FabricaLoja.obterSnapshotVinculoProduto(
        db,
        morango.vinculos[0].id,
        100,
        morango.versoes[0].id
      ),
      (err) => err.code === 'VERSAO_NAO_PUBLICADA'
    );
    assert.equal(morango.versoes[0].componentes.length, 4);
    assert.equal(morango.versoes[0].etapas.length, 6);
    assert.equal(morango.versoes[0].informacoes.length, 5);
    assert.equal(morango.versoes[0].rendimento_quantidade, 10);
    assert.equal(morango.versoes[0].observacoes, origemAntes.observacoes);
    assert.equal(morango.versoes[0].ficha_tradicional_snapshot.ficha_tradicional_id, tradicional.id);
    assert.match(morango.versoes[0].ficha_tradicional_revisao, /^[a-f0-9]{64}$/);
    assert.equal(chocolate.versoes[0].componentes.length, 3);
    assert.equal(chocolate.versoes[0].componentes[0].quantidade, 4);
    assert.equal(chocolate.versoes[0].etapas.length, 5);
    assert.deepEqual(await FabricaLoja.obterFicha(db, tradicional.id), origemAntes);

    const morangoV1Id = morango.versoes[0].id;
    await FabricaLoja.publicarVersaoPadrao(db, morango.id, morangoV1Id);
    await FabricaLoja.publicarVersaoPadrao(db, chocolate.id, chocolate.versoes[0].id);
    const snapshotInicial = await FabricaLoja.obterSnapshotVinculoProduto(
      db,
      morango.vinculos[0].id,
      100,
      morangoV1Id
    );
    assert.equal(snapshotInicial.ficha_padrao_snapshot.ficha_padrao_versao_id, morangoV1Id);
    assert.equal(snapshotInicial.ficha_padrao_snapshot.numero_versao, 1);
    const rascunho = await FabricaLoja.criarVersaoPadrao(db, morango.id);
    const conteudoRascunho = {
      ...rascunho,
      componentes: rascunho.componentes.map((item) => ({
        produto_id: item.produto_id,
        quantidade: item.produto_id === 1 ? 8 : item.quantidade,
        unidade: item.unidade,
        observacao: item.observacao
      })),
      etapas: rascunho.etapas.map((item) => ({ ...item })),
      informacoes: rascunho.informacoes.map((item) => ({ ...item }))
    };
    await FabricaLoja.atualizarVersaoPadrao(db, morango.id, rascunho.id, conteudoRascunho);
    await assert.rejects(
      () => FabricaLoja.atualizarVersaoPadrao(db, morango.id, morangoV1Id, conteudoRascunho),
      (err) => err.code === 'VERSAO_IMUTAVEL'
    );
    const antesNovaOrigem = await FabricaLoja.obterFichaPadrao(db, morango.id);
    assert.equal(antesNovaOrigem.versoes.find((item) => item.id === morangoV1Id).componentes[0].quantidade, 7);
    assert.equal(antesNovaOrigem.versoes.find((item) => item.id === rascunho.id).componentes[0].quantidade, 8);
    await FabricaLoja.publicarVersaoPadrao(db, morango.id, rascunho.id);

    const chocolateAntes = await FabricaLoja.obterFichaPadrao(db, chocolate.id);
    const origemAtualizada = await FabricaLoja.salvarFicha(db, {
      ...origemAntes,
      componentes: [
        { produto_id: 1, quantidade: 5, unidade: 'kg', observacao: 'Integral atualizado' },
        { produto_id: 3, quantidade: 0.25, unidade: 'kg', observacao: 'Homogeneizar' },
        { produto_id: 5, quantidade: 1, unidade: 'kg', observacao: 'Polpa-base nova' }
      ],
      etapas: [
        { ...origemAntes.etapas[0], titulo: 'Mistura atualizada' },
        { ...origemAntes.etapas[1], descricao: 'Instrução revisada' },
        ...origemAntes.etapas.slice(2),
        { titulo: 'Resfriar', descricao: 'Nova etapa da origem', tempo_minutos: 15 }
      ],
      informacoes: [
        { ...origemAntes.informacoes[0], valor: 'Valor revisado' },
        ...origemAntes.informacoes.slice(1),
        { titulo: 'Armazenamento', valor: 'Congelado' }
      ]
    }, tradicional.id);

    const atualizada = await FabricaLoja.obterFichaPorSabor(db, morango.id);
    assert.equal(atualizada.atualizacao_origem_disponivel, true);
    assert.equal(atualizada.versoes.find((item) => item.estado === 'PUBLICADA').ficha_tradicional_snapshot.componentes.length, 3);
    const revisada = await FabricaLoja.revisarOrigemFichaPorSabor(db, morango.id);
    assert.equal(revisada.estado, 'EM_EDICAO');
    assert.ok(revisada.ficha_tradicional_snapshot_anterior);
    assert.equal(revisada.ficha_tradicional_snapshot.componentes.length, 3);
    assert.equal(revisada.componentes.find((item) => item.produto_id === 1).quantidade, 8);
    assert.equal(revisada.componentes.some((item) => item.produto_id === 2), false);
    assert.equal(revisada.componentes.some((item) => item.produto_id === 5), true);
    assert.equal(revisada.etapas.find((item) => item.ordem === 1).titulo, 'Misturar base e morango');
    assert.equal(revisada.etapas.find((item) => item.ordem === 2).descricao, 'Instrução revisada');
    assert.equal(revisada.etapas.some((item) => item.titulo === 'Adicionar polpa'), true);
    assert.equal(revisada.etapas.some((item) => item.titulo === 'Resfriar'), true);
    assert.equal(revisada.informacoes.find((item) => item.ordem === 1).valor, 'Personalizado para morango');
    assert.equal(revisada.informacoes.find((item) => item.ordem === 2).valor, 'Valor 2');
    assert.equal(revisada.informacoes.some((item) => item.titulo === 'Sabor'), true);
    assert.equal(revisada.informacoes.some((item) => item.titulo === 'Armazenamento'), true);
    assert.equal((await FabricaLoja.obterFichaPadrao(db, chocolate.id)).versoes[0].componentes[0].quantidade,
      chocolateAntes.versoes[0].componentes[0].quantidade);
    assert.deepEqual(await FabricaLoja.obterFicha(db, tradicional.id), origemAtualizada);

    await FabricaLoja.publicarVersaoPadrao(db, morango.id, revisada.id);
    assert.equal((await FabricaLoja.obterFichaPorSabor(db, morango.id)).atualizacao_origem_disponivel, false);
    const snapshotProducao = await FabricaLoja.obterSnapshotVinculoProduto(
      db,
      morango.vinculos[0].id,
      100,
      morangoV1Id
    );
    assert.equal(snapshotProducao.ficha_padrao_snapshot.ficha_por_sabor.ficha_tradicional_id, tradicional.id);
    assert.equal(snapshotProducao.ficha_padrao_snapshot.ficha_padrao_versao_id, morangoV1Id);
    assert.equal(snapshotProducao.ficha_padrao_snapshot.componentes.some((item) => item.produto_id === 5), false);
    assert.equal(snapshotProducao.ficha_padrao_snapshot.etapas.some((item) => item.titulo === 'Adicionar polpa'), true);

    const estoque = await all(db, 'SELECT id, estoque_atual FROM produtos ORDER BY id');
    assert.deepEqual(estoque.map((item) => item.estoque_atual), [80, 70, 60, 50, 40, 0, 0]);
  });
});
