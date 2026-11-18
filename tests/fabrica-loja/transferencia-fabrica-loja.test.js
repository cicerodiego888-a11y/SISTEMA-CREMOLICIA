/**
 * TRANSFERÊNCIA 01 — Fábrica → Loja pelo Motor de Estoque. Banco temporário.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const MotorEstoque = require('../../backend/motores/motor-estoque');
const {
  salvarTransferencia,
  confirmarTransferencia,
  ORIGEM_MOVIMENTO,
  MENSAGEM_ESTOQUE,
  MENSAGEM_INATIVO,
  MENSAGEM_NATUREZA,
  MENSAGEM_CONVERTIDO,
  MENSAGEM_CONFIRMADA,
  MENSAGEM_QUANTIDADE
} = require('../../backend/modules/fabrica-loja/TransferenciaEstoqueService');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-trf01-'));
const arquivo = path.join(dir, 'transferencia-fabrica-loja.db');

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) { if (err) reject(err); else resolve({ id: this.lastID }); });
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

async function produto(db, id, nome, natureza, ativo = 1) {
  await run(db, `
    INSERT INTO produtos (id, nome, unidade, estoque_atual, saldo_fiscal, saldo_nao_fiscal, natureza_cadastro, ativo, controlar_validade)
    VALUES (?, ?, 'UN', 0, 0, 0, ?, ?, 0)
  `, [id, nome, natureza, ativo]);
}

async function naFabrica(db, produtoId, quantidade) {
  await MotorEstoque.entrar(db, { produtoId, quantidadeBase: quantidade, origem: 'AJUSTE_MANUAL', local: 'FABRICA' });
}

async function saldo(db, produtoId, local) {
  return (await MotorEstoque.consultarSaldoLocal(db, produtoId, local)).estoqueAtual;
}

async function estado(db) {
  return {
    saldos: await all(db, 'SELECT produto_id, local, saldo_fiscal, saldo_nao_fiscal, estoque_atual FROM estoque_saldos_locais ORDER BY produto_id, local'),
    produtos: await all(db, 'SELECT id, estoque_atual, saldo_fiscal, saldo_nao_fiscal FROM produtos ORDER BY id'),
    movimentos: (await get(db, 'SELECT COUNT(*) AS total FROM estoque_movimentacoes')).total
  };
}

async function transferir(db, itens, correlationId) {
  const doc = await salvarTransferencia(db, { itens: itens.map((item) => ({ unidade: 'UN', ...item })) });
  return confirmarTransferencia(db, doc.id, { correlation_id: correlationId });
}

async function movimentosDa(db, transferenciaId) {
  return all(db, `
    SELECT produto_id, operacao, origem, referencia_tipo, referencia_id, quantidade_base
    FROM estoque_movimentacoes
    WHERE referencia_tipo = 'transferencia_estoque' AND referencia_id = ?
    ORDER BY id
  `, [transferenciaId]);
}

describe('TRANSFERÊNCIA 01 — Fábrica → Loja', () => {
  let db;

  before(async () => {
    db = new sqlite3.Database(arquivo);
    await run(db, `
      CREATE TABLE produtos (
        id INTEGER PRIMARY KEY, nome TEXT, unidade TEXT,
        estoque_atual REAL DEFAULT 0, saldo_fiscal REAL DEFAULT 0, saldo_nao_fiscal REAL DEFAULT 0,
        natureza_cadastro TEXT, ativo INTEGER DEFAULT 1, controlar_validade INTEGER DEFAULT 0, updated_at TEXT
      )
    `);
    await run(db, 'CREATE TABLE linhas_produtos_legado (id INTEGER PRIMARY KEY, produto_id INTEGER)');
    await run(db, `
      CREATE TABLE conversoes_estoque_linha (
        id INTEGER PRIMARY KEY, produto_origem_id INTEGER, status TEXT, correlation_id TEXT
      )
    `);
    await MotorEstoque.bootstrapMotorEstoqueSchema(db);

    await produto(db, 1, 'Picolé Abacaxi', 'PRODUZIDO');
    await produto(db, 2, 'Picolé Chocolate', 'PRODUZIDO');
    await produto(db, 3, 'Picolé Morango', 'PRODUZIDO');
    await produto(db, 4, 'Picolé Uva', 'PRODUZIDO');
    await produto(db, 5, 'Picolé Limão', 'PRODUZIDO');
    await produto(db, 6, 'Picolé Coco', 'PRODUZIDO');
    await produto(db, 7, 'Picolé Manga', 'PRODUZIDO');
    await produto(db, 20, 'Leite', 'INSUMO');
    await produto(db, 21, 'Caixa pronta', 'COMERCIAL');
    await produto(db, 22, 'Sem natureza', null);
    await produto(db, 23, 'Picolé inativo', 'PRODUZIDO', 0);
    await produto(db, 24, 'Linha convertida', 'PRODUZIDO');
    await run(db, 'INSERT INTO linhas_produtos_legado (produto_id) VALUES (24)');
    await run(db, `INSERT INTO conversoes_estoque_linha (produto_origem_id, status, correlation_id) VALUES (24, 'CONCLUIDA', 'conv-24')`);
  });

  after(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('1, 3, 4 e 11: homologação Abacaxi 100 → 30 → 20', async () => {
    await naFabrica(db, 1, 100);
    const primeira = await transferir(db, [{ produto_id: 1, quantidade: 30 }], 'trf01-abacaxi-1');
    assert.equal(primeira.transferencia.status, 'CONFIRMADA');
    assert.equal(await saldo(db, 1, 'FABRICA'), 70);
    assert.equal(await saldo(db, 1, 'LOJA'), 30);

    const movimentos = await movimentosDa(db, primeira.transferencia.id);
    assert.deepEqual(movimentos.map((item) => item.operacao), ['SAIDA', 'ENTRADA']);
    assert.ok(movimentos.every((item) => item.origem === 'TRANSFERENCIA' && item.origem === ORIGEM_MOVIMENTO));
    assert.ok(movimentos.every((item) => item.quantidade_base === 30));
    assert.ok(movimentos.every((item) => item.referencia_tipo === 'transferencia_estoque' && item.referencia_id === primeira.transferencia.id));

    await transferir(db, [{ produto_id: 1, quantidade: 20 }], 'trf01-abacaxi-2');
    assert.equal(await saldo(db, 1, 'FABRICA'), 50);
    assert.equal(await saldo(db, 1, 'LOJA'), 50);
    const global = await get(db, 'SELECT estoque_atual FROM produtos WHERE id = 1');
    assert.equal(global.estoque_atual, 100);
  });

  it('2: multi-item Abacaxi 100 / Chocolate 80 → 30 / 20', async () => {
    await naFabrica(db, 3, 100);
    await naFabrica(db, 2, 80);
    const resultado = await transferir(db, [
      { produto_id: 3, quantidade: 30 },
      { produto_id: 2, quantidade: 20 }
    ], 'trf01-multi');
    assert.equal(resultado.transferencia.itens.length, 2);
    assert.equal(await saldo(db, 3, 'FABRICA'), 70);
    assert.equal(await saldo(db, 3, 'LOJA'), 30);
    assert.equal(await saldo(db, 2, 'FABRICA'), 60);
    assert.equal(await saldo(db, 2, 'LOJA'), 20);
    const movimentos = await movimentosDa(db, resultado.transferencia.id);
    assert.equal(movimentos.length, 4);
    assert.ok(movimentos.every((item) => item.origem === 'TRANSFERENCIA'));
  });

  it('5: o mesmo produto_id nos dois locais, sem cadastro novo', async () => {
    const produtosAntes = (await get(db, 'SELECT COUNT(*) AS total FROM produtos')).total;
    await naFabrica(db, 4, 10);
    const resultado = await transferir(db, [{ produto_id: 4, quantidade: 4 }], 'trf01-identidade');
    const movimentos = await movimentosDa(db, resultado.transferencia.id);
    assert.ok(movimentos.every((item) => item.produto_id === 4));
    const locais = await all(db, 'SELECT local, estoque_atual FROM estoque_saldos_locais WHERE produto_id = 4 ORDER BY local');
    assert.deepEqual(locais.map((item) => [item.local, item.estoque_atual]), [['FABRICA', 6], ['LOJA', 4]]);
    assert.equal(resultado.transferencia.itens[0].produto_id, 4);
    assert.equal((await get(db, 'SELECT COUNT(*) AS total FROM produtos')).total, produtosAntes);
  });

  it('6: estoque insuficiente bloqueia sem movimentar', async () => {
    await naFabrica(db, 5, 10);
    const doc = await salvarTransferencia(db, { itens: [{ produto_id: 5, quantidade: 11, unidade: 'UN' }] });
    const antes = await estado(db);
    await assert.rejects(
      () => confirmarTransferencia(db, doc.id, { correlation_id: 'trf01-falta' }),
      (err) => {
        assert.equal(err.message, 'Quantidade disponível na Fábrica insuficiente.');
        assert.equal(err.message, MENSAGEM_ESTOQUE);
        assert.equal(err.code, 'ESTOQUE_INSUFICIENTE');
        assert.deepEqual(err.detalhes[0], { produto: 'Picolé Limão', disponivel: 10, solicitado: 11, faltante: 1, unidade: 'UN' });
        return true;
      }
    );
    assert.deepEqual(await estado(db), antes);
    const status = await get(db, 'SELECT status, correlation_id FROM transferencias_estoque WHERE id = ?', [doc.id]);
    assert.equal(status.status, 'RASCUNHO');
    assert.equal(status.correlation_id, null);
  });

  it('6b: linhas repetidas do mesmo produto somam contra o saldo da Fábrica', async () => {
    const antes = await estado(db);
    await assert.rejects(
      () => transferir(db, [{ produto_id: 5, quantidade: 6 }, { produto_id: 5, quantidade: 6 }], 'trf01-repetido-falta'),
      (err) => err.message === MENSAGEM_ESTOQUE && err.detalhes[0].disponivel === 4
    );
    assert.deepEqual(await estado(db), antes);
    await transferir(db, [{ produto_id: 5, quantidade: 6 }, { produto_id: 5, quantidade: 4 }], 'trf01-repetido-ok');
    assert.equal(await saldo(db, 5, 'FABRICA'), 0);
    assert.equal(await saldo(db, 5, 'LOJA'), 10);
  });

  it('7: produto inválido bloqueia (inexistente, inativo, não produzido, linha convertida)', async () => {
    const antes = await estado(db);
    const casos = [
      [999, 'O produto informado não existe.', 'PRODUTO_NAO_ENCONTRADO'],
      [23, MENSAGEM_INATIVO, 'PRODUTO_INATIVO'],
      [20, MENSAGEM_NATUREZA, 'PRODUTO_NAO_TRANSFERIVEL'],
      [21, MENSAGEM_NATUREZA, 'PRODUTO_NAO_TRANSFERIVEL'],
      [22, MENSAGEM_NATUREZA, 'PRODUTO_NAO_TRANSFERIVEL'],
      [24, MENSAGEM_CONVERTIDO, 'PRODUTO_LINHA_CONVERTIDO']
    ];
    for (const [produtoId, mensagem, codigo] of casos) {
      await assert.rejects(
        () => salvarTransferencia(db, { itens: [{ produto_id: produtoId, quantidade: 1, unidade: 'UN' }] }),
        (err) => err.message === mensagem && err.code === codigo,
        `produto ${produtoId}`
      );
    }
    assert.deepEqual(await estado(db), antes);
  });

  it('7b: produto inativado depois do rascunho bloqueia a confirmação', async () => {
    await naFabrica(db, 6, 10);
    const doc = await salvarTransferencia(db, { itens: [{ produto_id: 6, quantidade: 5, unidade: 'UN' }] });
    await run(db, 'UPDATE produtos SET ativo = 0 WHERE id = 6');
    const antes = await estado(db);
    await assert.rejects(
      () => confirmarTransferencia(db, doc.id, { correlation_id: 'trf01-inativado' }),
      (err) => err.message === MENSAGEM_INATIVO
    );
    assert.deepEqual(await estado(db), antes);
    await run(db, 'UPDATE produtos SET ativo = 1 WHERE id = 6');
  });

  it('8: quantidade zero ou negativa bloqueia', async () => {
    for (const quantidade of [0, -1, -0.5]) {
      await assert.rejects(
        () => salvarTransferencia(db, { itens: [{ produto_id: 6, quantidade, unidade: 'UN' }] }),
        (err) => err.message === MENSAGEM_QUANTIDADE
      );
    }
  });

  it('9: falha em um item desfaz a transferência inteira', async () => {
    await naFabrica(db, 7, 10);
    const antes = await estado(db);
    await assert.rejects(
      () => transferir(db, [
        { produto_id: 6, quantidade: 5 },
        { produto_id: 7, quantidade: 50 }
      ], 'trf01-falha-item'),
      (err) => err.message === MENSAGEM_ESTOQUE && err.detalhes.length === 1 && err.detalhes[0].produto === 'Picolé Manga'
    );
    assert.deepEqual(await estado(db), antes);

    const doc = await salvarTransferencia(db, {
      itens: [{ produto_id: 6, quantidade: 5, unidade: 'UN' }, { produto_id: 7, quantidade: 5, unidade: 'UN' }]
    });
    await assert.rejects(() => confirmarTransferencia(db, doc.id, { correlation_id: 'trf01-falha-meio' }, {
      aposSaida() { throw new Error('falha simulada'); }
    }));
    assert.deepEqual(await estado(db), antes);
    const status = await get(db, 'SELECT status, correlation_id FROM transferencias_estoque WHERE id = ?', [doc.id]);
    assert.equal(status.status, 'RASCUNHO');
    assert.equal(status.correlation_id, null);
  });

  it('10: repetir a confirmação não duplica', async () => {
    const doc = await salvarTransferencia(db, { itens: [{ produto_id: 6, quantidade: 2, unidade: 'UN' }] });
    const primeira = await confirmarTransferencia(db, doc.id, { correlation_id: 'trf01-idem' });
    const depoisPrimeira = await estado(db);
    const segunda = await confirmarTransferencia(db, doc.id, { correlation_id: 'trf01-idem' });
    assert.equal(primeira.repetida, false);
    assert.equal(segunda.repetida, true);
    assert.equal(segunda.transferencia.id, primeira.transferencia.id);
    await assert.rejects(
      () => confirmarTransferencia(db, doc.id, { correlation_id: 'trf01-idem-outra' }),
      (err) => err.message === MENSAGEM_CONFIRMADA
    );
    assert.deepEqual(await estado(db), depoisPrimeira);
    assert.equal((await movimentosDa(db, doc.id)).length, 2);
  });

  it('12: produtos fora da transferência não mudam', async () => {
    const antes = await estado(db);
    const intocados = (lista) => lista.saldos.filter((item) => item.produto_id !== 7);
    await transferir(db, [{ produto_id: 7, quantidade: 3 }], 'trf01-isolado');
    const depois = await estado(db);
    assert.deepEqual(intocados(depois), intocados(antes));
    assert.equal(await saldo(db, 7, 'FABRICA'), 7);
    assert.equal(await saldo(db, 7, 'LOJA'), 3);
  });
});
