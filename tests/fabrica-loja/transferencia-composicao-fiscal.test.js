/**
 * Composição fiscal da transferência Fábrica → Loja. Banco temporário.
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
  MENSAGEM_ESTOQUE
} = require('../../backend/modules/fabrica-loja/TransferenciaEstoqueService');

const dir = path.join(os.tmpdir(), 'cds-fabrica-loja-testes');
fs.mkdirSync(dir, { recursive: true });
const arquivo = path.join(dir, 'transferencia-composicao-fiscal.db');
for (const sufixo of ['', '-wal', '-shm']) fs.rmSync(arquivo + sufixo, { force: true });

function abrir() { return new sqlite3.Database(arquivo); }
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
function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

async function produto(db, id) {
  await run(db, `
    INSERT INTO produtos (
      id, nome, unidade, estoque_atual, saldo_fiscal, saldo_nao_fiscal,
      natureza_cadastro, ativo, controlar_validade
    ) VALUES (?, 'Picolé Chocolate', 'UN', 0, 0, 0, 'PRODUZIDO', 1, 0)
  `, [id]);
}

async function entrarFabrica(db, id, fiscal, naoFiscal) {
  await MotorEstoque.entrar(db, {
    produtoId: id,
    quantidadeBase: fiscal + naoFiscal,
    quantidadeFiscal: fiscal,
    quantidadeNaoFiscal: naoFiscal,
    origem: 'COMPRA',
    local: 'FABRICA'
  });
}

async function locais(db, id) {
  return {
    fabrica: await MotorEstoque.consultarSaldoLocal(db, id, 'FABRICA'),
    loja: await MotorEstoque.consultarSaldoLocal(db, id, 'LOJA'),
    global: await get(db, 'SELECT saldo_fiscal, saldo_nao_fiscal, estoque_atual FROM produtos WHERE id = ?', [id])
  };
}

function igual(saldo, fiscal, naoFiscal) {
  assert.equal(saldo.saldoFiscal, fiscal);
  assert.equal(saldo.saldoNaoFiscal, naoFiscal);
  assert.equal(saldo.estoqueAtual, fiscal + naoFiscal);
}

function igualGlobal(row, fiscal, naoFiscal) {
  assert.equal(row.saldo_fiscal, fiscal);
  assert.equal(row.saldo_nao_fiscal, naoFiscal);
  assert.equal(row.estoque_atual, fiscal + naoFiscal);
}

async function transferir(db, id, quantidade, correlation) {
  const doc = await salvarTransferencia(db, {
    itens: [{ produto_id: id, quantidade, unidade: 'UN' }]
  });
  return confirmarTransferencia(db, doc.id, { correlation_id: correlation });
}

describe('Composição fiscal da transferência', () => {
  let db;

  before(async () => {
    db = abrir();
    await run(db, `
      CREATE TABLE produtos (
        id INTEGER PRIMARY KEY, nome TEXT, unidade TEXT,
        estoque_atual REAL DEFAULT 0, saldo_fiscal REAL DEFAULT 0, saldo_nao_fiscal REAL DEFAULT 0,
        natureza_cadastro TEXT, ativo INTEGER DEFAULT 1, controlar_validade INTEGER DEFAULT 0, updated_at TEXT
      )
    `);
    await MotorEstoque.bootstrapMotorEstoqueSchema(db);
  });

  after(() => db.close());

  it('1. saldo só fiscal transfere só fiscal', async () => {
    await produto(db, 1);
    await entrarFabrica(db, 1, 100, 0);
    const resultado = await transferir(db, 1, 30, 'comp-fiscal');
    const saldo = await locais(db, 1);
    igual(saldo.fabrica, 70, 0);
    igual(saldo.loja, 30, 0);
    igualGlobal(saldo.global, 100, 0);
    assert.equal(resultado.transferencia.itens[0].quantidade_fiscal, 30);
    assert.equal(resultado.transferencia.itens[0].quantidade_nao_fiscal, 0);
    assert.equal(resultado.transferencia.origem_local, 'FABRICA');
    assert.equal(resultado.transferencia.destino_local, 'LOJA');
  });

  it('2. saldo só não fiscal transfere só não fiscal', async () => {
    await produto(db, 2);
    await entrarFabrica(db, 2, 0, 100);
    const resultado = await transferir(db, 2, 30, 'comp-nao');
    const saldo = await locais(db, 2);
    igual(saldo.fabrica, 0, 70);
    igual(saldo.loja, 0, 30);
    igualGlobal(saldo.global, 0, 100);
    assert.equal(resultado.transferencia.itens[0].quantidade_fiscal, 0);
    assert.equal(resultado.transferencia.itens[0].quantidade_nao_fiscal, 30);
  });

  it('3, 4, 12, 13 e 14. saldo misto preserva a proporção e o global', async () => {
    await produto(db, 3);
    await entrarFabrica(db, 3, 80, 20);
    const resultado = await transferir(db, 3, 50, 'comp-misto');
    const saldo = await locais(db, 3);
    igual(saldo.fabrica, 40, 10);
    igual(saldo.loja, 40, 10);
    igualGlobal(saldo.global, 80, 20);
    assert.equal(resultado.transferencia.itens[0].quantidade, 50);
    assert.equal(resultado.transferencia.itens[0].quantidade_fiscal, 40);
    assert.equal(resultado.transferencia.itens[0].quantidade_nao_fiscal, 10);
  });

  it('5. transferência total leva a composição inteira', async () => {
    await produto(db, 5);
    await entrarFabrica(db, 5, 80, 20);
    const resultado = await transferir(db, 5, 100, 'comp-total');
    const saldo = await locais(db, 5);
    igual(saldo.fabrica, 0, 0);
    igual(saldo.loja, 80, 20);
    igualGlobal(saldo.global, 80, 20);
    assert.equal(resultado.transferencia.itens[0].quantidade_fiscal, 80);
    assert.equal(resultado.transferencia.itens[0].quantidade_nao_fiscal, 20);
  });

  it('6. quantidade acima do total não movimenta nada', async () => {
    await produto(db, 6);
    await entrarFabrica(db, 6, 80, 20);
    const doc = await salvarTransferencia(db, { itens: [{ produto_id: 6, quantidade: 120, unidade: 'UN' }] });
    await assert.rejects(
      () => confirmarTransferencia(db, doc.id, { correlation_id: 'comp-falta' }),
      (err) => err.message === 'Quantidade disponível na Fábrica insuficiente.'
        && err.message === MENSAGEM_ESTOQUE
    );
    const saldo = await locais(db, 6);
    igual(saldo.fabrica, 80, 20);
    igual(saldo.loja, 0, 0);
    igualGlobal(saldo.global, 80, 20);
    const status = await get(db, 'SELECT status FROM transferencias_estoque WHERE id = ?', [doc.id]);
    assert.equal(status.status, 'RASCUNHO');
  });

  it('7. quantidade maior que o fiscal preserva a proporção sem converter natureza', async () => {
    await produto(db, 7);
    await entrarFabrica(db, 7, 20, 80);
    const resultado = await transferir(db, 7, 50, 'comp-menor');
    const saldo = await locais(db, 7);
    igual(saldo.fabrica, 10, 40);
    igual(saldo.loja, 10, 40);
    igualGlobal(saldo.global, 20, 80);
    assert.equal(resultado.transferencia.itens[0].quantidade_fiscal, 10);
    assert.equal(resultado.transferencia.itens[0].quantidade_nao_fiscal, 40);
  });

  it('8. falha na entrada devolve fábrica e loja ao estado anterior', async () => {
    await produto(db, 8);
    await entrarFabrica(db, 8, 80, 20);
    const doc = await salvarTransferencia(db, { itens: [{ produto_id: 8, quantidade: 50, unidade: 'UN' }] });
    await assert.rejects(() => confirmarTransferencia(db, doc.id, { correlation_id: 'comp-rollback' }, {
      aposSaida() { throw new Error('falha simulada'); }
    }));
    const saldo = await locais(db, 8);
    igual(saldo.fabrica, 80, 20);
    igual(saldo.loja, 0, 0);
    igualGlobal(saldo.global, 80, 20);
    const status = await get(db, 'SELECT status FROM transferencias_estoque WHERE id = ?', [doc.id]);
    assert.equal(status.status, 'RASCUNHO');
  });

  it('9, 10 e 11. a mesma confirmação não movimenta de novo e os locais permanecem fábrica e loja', async () => {
    await produto(db, 9);
    await entrarFabrica(db, 9, 80, 20);
    const antes = await get(db, 'SELECT COUNT(*) AS total FROM estoque_movimentacoes');
    const primeira = await transferir(db, 9, 50, 'comp-idem');
    const repetida = await confirmarTransferencia(db, primeira.transferencia.id, { correlation_id: 'comp-idem' });
    assert.equal(repetida.repetida, true);
    const depois = await get(db, 'SELECT COUNT(*) AS total FROM estoque_movimentacoes');
    assert.equal(depois.total - antes.total, 2);
    const movimentos = await all(db, `
      SELECT operacao, origem, quantidade_fiscal, quantidade_nao_fiscal
      FROM estoque_movimentacoes WHERE referencia_id = ? AND referencia_tipo = 'transferencia_estoque'
    `, [primeira.transferencia.id]);
    assert.equal(movimentos.length, 2);
    assert.equal(movimentos.every((item) => item.origem === 'TRANSFERENCIA'), true);
    const saldo = await locais(db, 9);
    igual(saldo.fabrica, 40, 10);
    igual(saldo.loja, 40, 10);
    assert.equal(primeira.transferencia.origem_local, 'FABRICA');
    assert.equal(primeira.transferencia.destino_local, 'LOJA');
  });
});
