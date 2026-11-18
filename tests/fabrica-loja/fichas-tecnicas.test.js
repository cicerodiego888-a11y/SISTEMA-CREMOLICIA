/**
 * Fichas técnicas. Banco temporário. Não usa o banco oficial.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');

const dir = path.join(os.tmpdir(), 'cds-fabrica-loja-testes');
fs.mkdirSync(dir, { recursive: true });
const arquivo = path.join(dir, 'fichas.db');
for (const sufixo of ['', '-wal', '-shm']) {
  fs.rmSync(arquivo + sufixo, { force: true });
}

const {
  salvarFicha,
  obterFicha,
  listarFichas,
  listarInsumos,
  bootstrapFabricaLojaSchema,
  atualizarStatusFicha,
  excluirFicha,
  vincularFichaTradicionalProduto,
  desvincularFichaTradicionalProduto
} = require('../../backend/modules/fabrica-loja');

function abrir() {
  return new sqlite3.Database(arquivo);
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => (err ? reject(err) : resolve()));
  });
}

describe('Fichas técnicas', () => {
  let db;

  before(async () => {
    db = abrir();
    await run(db, 'CREATE TABLE vendas (id INTEGER PRIMARY KEY, total REAL)');
    await run(db, 'INSERT INTO vendas (id, total) VALUES (7, 40)');
    await run(db, `
      CREATE TABLE produtos (
        id INTEGER PRIMARY KEY,
        codigo TEXT,
        nome TEXT,
        unidade TEXT,
        estoque_atual REAL,
        ativo INTEGER DEFAULT 1,
        natureza_cadastro TEXT
      )
    `);
    await run(db, "INSERT INTO produtos (id, codigo, nome, unidade, estoque_atual, ativo, natureza_cadastro) VALUES (3, 'AC', 'Açaí', 'kg', 10, 1, 'PRODUZIDO')");
    await run(db, "INSERT INTO produtos (id, codigo, nome, unidade, estoque_atual, ativo, natureza_cadastro) VALUES (4, 'LE', 'Leite', 'L', 20, 1, 'INSUMO')");
    await run(db, "INSERT INTO produtos (id, codigo, nome, unidade, estoque_atual, ativo, natureza_cadastro) VALUES (5, 'AZ', 'Açúcar', 'kg', 8, 1, 'INSUMO')");
    await run(db, "INSERT INTO produtos (id, codigo, nome, unidade, estoque_atual, ativo, natureza_cadastro) VALUES (6, 'PO', 'Polpa', 'kg', 6, 1, 'INSUMO')");
    await run(db, "INSERT INTO produtos (id, codigo, nome, unidade, estoque_atual, ativo, natureza_cadastro) VALUES (7, 'CR', 'Creme de leite', 'L', 4, 1, 'INSUMO')");
  });

  after(() => {
    if (db) db.close();
  });

  it('grava fichas genéricas com qualquer quantidade de componentes, etapas e informações', async () => {
    const acai = await salvarFicha(db, {
      nome: 'Açaí da fábrica',
      rendimento_quantidade: '5,5',
      rendimento_unidade: 'kg',
      observacoes: 'Receita base',
      componentes: [
        { produto_id: 4, descricao: 'leite digitado', quantidade: 2, unidade: 'L' },
        { produto_id: 5, quantidade: '0,4', unidade: 'kg' },
        { produto_id: 6, quantidade: 3, unidade: 'kg', observacao: 'madura' }
      ],
      etapas: [
        { titulo: 'Misturar', descricao: 'Bater os ingredientes', tempo_minutos: 8 },
        { titulo: 'Resfriar', tempo_minutos: 30 }
      ],
      informacoes: [
        { titulo: 'Temperatura', valor: '4 °C' },
        { titulo: 'Validade', valor: '5 dias' }
      ]
    });
    const sorvete = await salvarFicha(db, {
      nome: 'Sorvete de creme',
      componentes: [{ produto_id: 7, descricao: 'Creme', quantidade: 1, unidade: 'L' }],
      etapas: [],
      informacoes: []
    });

    assert.equal(acai.codigo, 'FT-0001');
    assert.equal(acai.rendimento_quantidade, 5.5);
    assert.equal(acai.componentes.length, 3);
    assert.equal(acai.componentes[0].descricao, 'Leite');
    assert.equal(acai.componentes[0].produto_id, 4);
    assert.equal(acai.componentes[1].descricao, 'Açúcar');
    assert.equal(acai.componentes[1].produto_id, 5);
    assert.equal(acai.componentes[1].quantidade, 0.4);
    assert.equal(acai.etapas.length, 2);
    assert.equal(acai.informacoes.length, 2);
    assert.equal(sorvete.produto_id, null);
    assert.equal(sorvete.componentes.length, 1);
    assert.equal(sorvete.etapas.length, 0);

    const lista = await listarFichas(db, {});
    assert.equal(lista.length, 2);
    assert.equal(lista[0].componentes, 3);
  });

  it('atualiza a definição e recusa dados inválidos sem gravar pela metade', async () => {
    const lista = await listarFichas(db, {});
    const id = lista.find((ficha) => ficha.nome === 'Açaí da fábrica').id;
    const atualizada = await salvarFicha(db, {
      nome: 'Açaí da fábrica',
      componentes: [{ produto_id: 6, descricao: 'outro nome', quantidade: 4, unidade: 'kg' }],
      etapas: [{ titulo: 'Bater' }],
      informacoes: [{ titulo: 'Observação interna', valor: '' }]
    }, id);
    assert.equal(atualizada.componentes.length, 1);
    assert.equal(atualizada.componentes[0].descricao, 'Polpa');

    await assert.rejects(
      () => salvarFicha(db, { nome: '   ' }),
      (err) => err.code === 'NOME_OBRIGATORIO'
    );
    await assert.rejects(
      () => salvarFicha(db, {
        nome: 'Quebrada',
        componentes: [{ descricao: 'Chocolate', quantidade: 1, unidade: 'kg' }]
      }),
      (err) => err.code === 'COMPONENTE_SEM_PRODUTO'
    );
    const depois = await listarFichas(db, { incluirInativas: true });
    assert.equal(depois.some((ficha) => ficha.nome === 'Quebrada'), false);
    const preservada = await obterFicha(db, id);
    assert.equal(preservada.componentes.length, 1);
  });

  it('inativa sem apagar a definição e não mexe em estoque nem em venda', async () => {
    const lista = await listarFichas(db, {});
    const id = lista.find((ficha) => ficha.nome === 'Sorvete de creme').id;
    const atual = await obterFicha(db, id);
    const inativa = await salvarFicha(db, { ...atual, ativa: false }, id);
    assert.equal(inativa.ativa, false);
    const visiveis = await listarFichas(db, {});
    assert.equal(visiveis.some((ficha) => ficha.id === id), false);
    const todas = await listarFichas(db, { incluirInativas: true });
    assert.equal(todas.some((ficha) => ficha.id === id), true);

    const produtos = await all(db, 'SELECT id, estoque_atual FROM produtos ORDER BY id');
    assert.deepEqual(produtos, [
      { id: 3, estoque_atual: 10 },
      { id: 4, estoque_atual: 20 },
      { id: 5, estoque_atual: 8 },
      { id: 6, estoque_atual: 6 },
      { id: 7, estoque_atual: 4 }
    ]);
    const venda = await all(db, 'SELECT id, total FROM vendas');
    assert.deepEqual(venda, [{ id: 7, total: 40 }]);

    const tabelas = await all(db, "SELECT name FROM sqlite_master WHERE type = 'table'");
    const nomes = tabelas.map((t) => t.name);
    for (const proibida of ['ordens_producao', 'producao', 'necessidade_producao', 'transferencias']) {
      assert.equal(nomes.includes(proibida), false, proibida);
    }
    const colunasProduto = await all(db, 'PRAGMA table_info(produtos)');
    assert.deepEqual(colunasProduto.map((coluna) => coluna.name), [
      'id', 'codigo', 'nome', 'unidade', 'estoque_atual', 'ativo', 'natureza_cadastro'
    ]);
  });

  it('altera a situação e só exclui a ficha tradicional quando não há vínculos ou histórico', async () => {
    const criada = await salvarFicha(db, {
      codigo: 'FT-EXCLUIR-01',
      nome: 'Ficha removível',
      rendimento_quantidade: 1,
      rendimento_unidade: 'UN',
      componentes: [{ produto_id: 4, quantidade: 1, unidade: 'L' }]
    });
    const inativa = await atualizarStatusFicha(db, criada.id, { ativa: false });
    assert.equal(inativa.ativa, false);
    const reativada = await atualizarStatusFicha(db, criada.id, { ativa: true });
    assert.equal(reativada.ativa, true);

    await vincularFichaTradicionalProduto(db, criada.id, 3);
    await assert.rejects(
      excluirFicha(db, criada.id),
      (err) => err.code === 'FICHA_VINCULADA' && err.statusCode === 409
    );
    await desvincularFichaTradicionalProduto(db, criada.id, 3);

    const resultado = await excluirFicha(db, criada.id);
    assert.equal(resultado.removida, true);
    await assert.rejects(
      obterFicha(db, criada.id),
      (err) => err.code === 'FICHA_NAO_ENCONTRADA' && err.statusCode === 404
    );
  });
});

describe('Ficha técnica sobre a tabela antiga vazia', () => {
  const arquivoAntigo = path.join(dir, 'fichas-antigas.db');
  let db;

  before(async () => {
    for (const sufixo of ['', '-wal', '-shm']) fs.rmSync(arquivoAntigo + sufixo, { force: true });
    db = new sqlite3.Database(arquivoAntigo);
    await run(db, `
      CREATE TABLE fichas_tecnicas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        produto_resultante_id INTEGER NOT NULL,
        rendimento REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'RASCUNHO'
      )
    `);
    await run(db, `
      CREATE TABLE fichas_tecnicas_itens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ficha_id INTEGER NOT NULL,
        produto_insumo_id INTEGER NOT NULL,
        quantidade REAL NOT NULL
      )
    `);
    await run(db, `
      CREATE TABLE produtos (
        id INTEGER PRIMARY KEY,
        nome TEXT,
        unidade TEXT,
        ativo INTEGER,
        natureza_cadastro TEXT,
        estoque_atual REAL
      )
    `);
    await run(db, "INSERT INTO produtos (id, nome, unidade, ativo, natureza_cadastro, estoque_atual) VALUES (4, 'Leite', 'L', 1, 'INSUMO', 3)");
    await run(db, "INSERT INTO produtos (id, nome, unidade, ativo, natureza_cadastro, estoque_atual) VALUES (9, 'Picolé', 'un', 1, 'PRODUZIDO', 0)");
    await bootstrapFabricaLojaSchema(db);
  });

  after(() => {
    if (db) db.close();
  });

  it('recria a tabela vazia no formato novo e grava a ficha', async () => {
    const colunas = await all(db, 'PRAGMA table_info(fichas_tecnicas)');
    const nomes = colunas.map((coluna) => coluna.name);
    assert.equal(nomes.includes('codigo'), true);
    assert.equal(nomes.includes('produto_resultante_id'), false);
    const ficha = await salvarFicha(db, {
      nome: 'Base nova',
      componentes: [{ produto_id: 4, descricao: 'texto livre', quantidade: 1, unidade: 'L' }],
      etapas: [],
      informacoes: []
    });
    assert.equal(ficha.codigo, 'FT-0001');
    assert.equal(ficha.componentes[0].descricao, 'Leite');
  });
});

describe('Ficha técnica antiga com dados', () => {
  const arquivoCheio = path.join(dir, 'fichas-com-dados.db');
  let db;

  before(async () => {
    for (const sufixo of ['', '-wal', '-shm']) fs.rmSync(arquivoCheio + sufixo, { force: true });
    db = new sqlite3.Database(arquivoCheio);
    await run(db, `
      CREATE TABLE fichas_tecnicas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        produto_resultante_id INTEGER NOT NULL,
        rendimento REAL NOT NULL
      )
    `);
    await run(db, 'INSERT INTO fichas_tecnicas (produto_resultante_id, rendimento) VALUES (3, 2)');
  });

  after(() => {
    if (db) db.close();
  });

  it('não apaga a ficha existente', async () => {
    await assert.rejects(
      () => bootstrapFabricaLojaSchema(db),
      (err) => /contém dados/.test(err.message)
    );
    const linhas = await all(db, 'SELECT produto_resultante_id, rendimento FROM fichas_tecnicas');
    assert.deepEqual(linhas, [{ produto_resultante_id: 3, rendimento: 2 }]);
  });
});

describe('Componentes vinculados a insumos', () => {
  const arquivoInsumo = path.join(dir, 'fichas-insumos.db');
  let db;

  before(async () => {
    for (const sufixo of ['', '-wal', '-shm']) fs.rmSync(arquivoInsumo + sufixo, { force: true });
    db = new sqlite3.Database(arquivoInsumo);
    await run(db, `
      CREATE TABLE produtos (
        id INTEGER PRIMARY KEY,
        codigo TEXT,
        nome TEXT,
        unidade TEXT,
        estoque_atual REAL,
        ativo INTEGER DEFAULT 1,
        natureza_cadastro TEXT
      )
    `);
    await run(db, `
      INSERT INTO produtos (id, codigo, nome, unidade, estoque_atual, ativo, natureza_cadastro) VALUES
        (10, 'LE', 'Leite', 'L', 25, 1, 'INSUMO'),
        (11, 'LE2', 'Leite', 'L', 1, 1, 'INSUMO'),
        (12, 'LD', 'Leite desnatado', 'L', 2, 0, 'INSUMO'),
        (20, 'CH', 'Chocolate', 'kg', 15, 1, 'INSUMO'),
        (21, 'CP', 'Chocolate em Pó', 'kg', 9, 1, 'INSUMO'),
        (30, 'LN', 'Liga Neutra', 'kg', 4, 1, 'INSUMO'),
        (40, 'PI', 'Picolé de Cobertura de Chocolate', 'un', 0, 1, 'PRODUZIDO'),
        (50, 'CM', 'Caixa', 'un', 3, 1, 'COMERCIAL')
    `);
    await bootstrapFabricaLojaSchema(db);
    await run(db, `
      INSERT INTO fichas_tecnicas (codigo, nome, rendimento_quantidade, rendimento_unidade, ativa)
      VALUES ('FT-ANTIGA', 'Receita antiga', 1, 'un', 1)
    `);
    await run(db, `
      INSERT INTO ficha_tecnica_componentes (ficha_id, ordem, produto_id, descricao, quantidade, unidade, observacao)
      VALUES
        (1, 1, NULL, 'Leite', 1, 'L', 'ambíguo'),
        (1, 2, NULL, 'Chocolate em Pó', 2, 'kg', ''),
        (1, 3, NULL, 'choco', 1, 'kg', 'parcial'),
        (1, 4, 12, 'Leite desnatado', 1, 'L', 'já inativo')
    `);
  });

  after(() => {
    if (db) db.close();
  });

  it('busca só insumo ativo e grava a ficha pelo id do produto', async () => {
    const busca = await listarInsumos(db, 'choco');
    assert.deepEqual(busca.map((item) => item.id), [20, 21]);
    assert.equal(busca.some((item) => item.nome.includes('Picolé')), false);
    assert.equal(busca.some((item) => item.nome === 'Caixa'), false);
    assert.equal(busca.some((item) => item.nome === 'Leite desnatado'), false);
    const leite = await listarInsumos(db, 'leite');
    assert.deepEqual(leite.map((item) => item.id).sort((a, b) => a - b), [10, 11]);

    const ficha = await salvarFicha(db, {
      nome: 'Picolé de Cobertura de Chocolate',
      rendimento_quantidade: 280,
      rendimento_unidade: 'un',
      componentes: [
        { produto_id: 10, descricao: 'leite', quantidade: 25, unidade: 'L', observacao: 'integral' },
        { produto_id: 20, descricao: 'Chocolate', quantidade: 15, unidade: 'kg' },
        { produto_id: 30, descricao: 'Liga', quantidade: 15, unidade: 'kg' }
      ],
      etapas: [],
      informacoes: []
    });
    assert.deepEqual(ficha.componentes.map((item) => ({
      produto_id: item.produto_id,
      descricao: item.descricao,
      quantidade: item.quantidade,
      unidade: item.unidade
    })), [
      { produto_id: 10, descricao: 'Leite', quantidade: 25, unidade: 'L' },
      { produto_id: 20, descricao: 'Chocolate', quantidade: 15, unidade: 'kg' },
      { produto_id: 30, descricao: 'Liga Neutra', quantidade: 15, unidade: 'kg' }
    ]);

    await run(db, "UPDATE produtos SET nome = 'Chocolate 50%' WHERE id = 20");
    const relida = await obterFicha(db, ficha.id);
    assert.equal(relida.componentes[1].produto_id, 20);
    assert.equal(relida.componentes[1].descricao, 'Chocolate 50%');

    const semChocolate = await salvarFicha(db, {
      ...relida,
      componentes: relida.componentes.filter((item) => item.produto_id !== 20)
    }, ficha.id);
    assert.deepEqual(semChocolate.componentes.map((item) => item.produto_id), [10, 30]);

    await assert.rejects(
      () => salvarFicha(db, {
        nome: 'Sem insumo',
        componentes: [{ descricao: 'Chocolate', quantidade: 1, unidade: 'kg' }]
      }),
      (err) => err.code === 'COMPONENTE_SEM_PRODUTO' && err.message === 'Selecione um insumo cadastrado para este componente.'
    );
    await assert.rejects(
      () => salvarFicha(db, {
        nome: 'Inexistente',
        componentes: [{ produto_id: 999, quantidade: 1, unidade: 'kg' }]
      }),
      (err) => err.code === 'PRODUTO_NAO_ENCONTRADO' && err.message === 'Componente inválido. Selecione um insumo cadastrado.'
    );
    await assert.rejects(
      () => salvarFicha(db, {
        nome: 'Produzido',
        componentes: [{ produto_id: 40, quantidade: 1, unidade: 'un' }]
      }),
      (err) => err.code === 'PRODUTO_NAO_INSUMO'
    );
    await assert.rejects(
      () => salvarFicha(db, {
        nome: 'Inativo novo',
        componentes: [{ produto_id: 12, quantidade: 1, unidade: 'L' }]
      }),
      (err) => err.code === 'INSUMO_INATIVO'
    );
  });

  it('preserva a ficha antiga e só sugere o insumo de nome exatamente único', async () => {
    const antiga = await obterFicha(db, 1);
    const ambiguo = antiga.componentes.find((item) => item.observacao === 'ambíguo');
    const exato = antiga.componentes.find((item) => item.texto_legado === 'Chocolate em Pó');
    const parcial = antiga.componentes.find((item) => item.observacao === 'parcial');
    assert.equal(ambiguo.produto_id, null);
    assert.equal(ambiguo.vinculo_pendente, true);
    assert.equal(ambiguo.sugestao_produto_id, undefined);
    assert.equal(exato.produto_id, null);
    assert.equal(exato.texto_legado, 'Chocolate em Pó');
    assert.equal(exato.sugestao_produto_id, 21);
    assert.equal(parcial.produto_id, null);
    assert.equal(parcial.sugestao_produto_id, undefined);
    assert.equal(antiga.componentes.find((item) => item.observacao === 'já inativo').produto_id, 12);
    assert.equal(antiga.componentes.find((item) => item.produto_id === 12).produto_ativo, false);
    assert.equal(antiga.componentes.find((item) => item.produto_id === 12).descricao, 'Leite desnatado');

    const inativo = antiga.componentes.find((item) => item.produto_id === 12);
    const vinculada = await salvarFicha(db, {
      nome: antiga.nome,
      rendimento_quantidade: antiga.rendimento_quantidade,
      rendimento_unidade: antiga.rendimento_unidade,
      componentes: [{ ...exato, produto_id: exato.sugestao_produto_id }, inativo]
    }, antiga.id);
    assert.equal(vinculada.componentes[0].produto_id, 21);
    assert.equal(vinculada.componentes[0].descricao, 'Chocolate em Pó');
    assert.equal(vinculada.componentes[1].produto_id, 12);
    assert.equal(vinculada.componentes[1].descricao, 'Leite desnatado');
    assert.equal(vinculada.componentes[1].produto_ativo, false);

    const estoque = await all(db, 'SELECT id, estoque_atual FROM produtos WHERE id IN (10, 20, 30, 40) ORDER BY id');
    assert.deepEqual(estoque, [
      { id: 10, estoque_atual: 25 },
      { id: 20, estoque_atual: 15 },
      { id: 30, estoque_atual: 4 },
      { id: 40, estoque_atual: 0 }
    ]);
    const tabelas = await all(db, "SELECT name FROM sqlite_master WHERE type = 'table'");
    const ordens = await all(db, 'SELECT COUNT(*) AS total FROM ordens_producao');
    assert.equal(Number(ordens[0].total), 0);
    assert.equal(tabelas.some((tabela) => tabela.name === 'producao'), false);
  });
});
