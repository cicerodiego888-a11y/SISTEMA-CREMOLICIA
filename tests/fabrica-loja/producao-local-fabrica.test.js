/**
 * Produção consome somente o saldo da fábrica. Banco temporário. Não usa o banco oficial.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const MotorEstoque = require('../../backend/motores/motor-estoque');
const { salvarOrdem, planejarOrdem } = require('../../backend/modules/fabrica-loja/OrdemProducaoService');
const { executarProducao } = require('../../backend/modules/fabrica-loja/ProducaoExecucaoService');
const bootstrapFichas = require('../../backend/modules/fabrica-loja/migrations/002_fichas_tecnicas');
const bootstrapOrdens = require('../../backend/modules/fabrica-loja/migrations/005_ordens_producao');

const dir = path.join(os.tmpdir(), 'cds-fabrica-loja-testes');
fs.mkdirSync(dir, { recursive: true });
const arquivo = path.join(dir, 'producao-local-fabrica.db');
for (const sufixo of ['', '-wal', '-shm']) fs.rmSync(arquivo + sufixo, { force: true });

function abrir() { return new sqlite3.Database(arquivo); }
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

async function base(db) {
  await run(db, `
    CREATE TABLE produtos (
      id INTEGER PRIMARY KEY, nome TEXT, unidade TEXT,
      estoque_atual REAL DEFAULT 0, saldo_fiscal REAL DEFAULT 0, saldo_nao_fiscal REAL DEFAULT 0,
      natureza_cadastro TEXT, ativo INTEGER DEFAULT 1, controlar_validade INTEGER DEFAULT 0, updated_at TEXT
    )
  `);
  await run(db, `INSERT INTO produtos (id, nome, unidade, natureza_cadastro) VALUES (1, 'Leite', 'L', 'INSUMO')`);
  await run(db, `INSERT INTO produtos (id, nome, unidade, natureza_cadastro) VALUES (5, 'Picolé', 'UN', 'PRODUZIDO')`);
  await bootstrapFichas(db);
  await bootstrapOrdens(db);
  await MotorEstoque.bootstrapMotorEstoqueSchema(db);
  await run(db, `
    INSERT INTO fichas_tecnicas (id, codigo, nome, produto_id, rendimento_quantidade, rendimento_unidade, ativa)
    VALUES (1, 'FT-1', 'Picolé', 5, 1, 'UN', 1)
  `);
}

// Simula OP já iniciada cujo saldo mudou depois do início: aqui se testam as validações da execução.
async function ordem(db, fichaId, quantidade) {
  const criada = await salvarOrdem(db, {
    origem: 'MANUAL',
    itens: [{ produto_id: 5, quantidade_planejada: quantidade, unidade: 'UN', ficha_tecnica_id: fichaId }]
  });
  const planejada = await planejarOrdem(db, criada.id);
  await run(db, "UPDATE ordens_producao SET status = 'EM_PRODUCAO' WHERE id = ? AND status = 'PLANEJADA'", [planejada.id]);
  return { ...planejada, status: 'EM_PRODUCAO' };
}

describe('Produção só consome a fábrica', () => {
  let db;

  before(async () => {
    db = abrir();
    await base(db);
  });

  after(() => db.close());

  it('aceite: fábrica 100 e loja 500, produção de 80 deixa a loja intacta', async () => {
    await run(db, `
      INSERT INTO ficha_tecnica_componentes (ficha_id, ordem, produto_id, descricao, quantidade, unidade)
      VALUES (1, 1, 1, 'Leite', 80, 'L')
    `);
    await MotorEstoque.entrar(db, { produtoId: 1, quantidadeBase: 100, origem: 'COMPRA', local: 'FABRICA' });
    await MotorEstoque.entrar(db, { produtoId: 1, quantidadeBase: 500, origem: 'COMPRA', local: 'LOJA' });
    const planejada = await ordem(db, 1, 1);
    const movimentosAntes = await get(db, 'SELECT COUNT(*) AS total FROM estoque_movimentacoes');
    await executarProducao(db, planejada.id, { correlation_id: 'aceite-80', quantidade_produzida: 1, quantidade_perdida: 0 });
    const fabrica = await MotorEstoque.consultarSaldoLocal(db, 1, 'FABRICA');
    const loja = await MotorEstoque.consultarSaldoLocal(db, 1, 'LOJA');
    const picole = await MotorEstoque.consultarSaldoLocal(db, 5, 'FABRICA');
    const picoleLoja = await MotorEstoque.consultarSaldoLocal(db, 5, 'LOJA');
    const saida = await get(db, `
      SELECT origem, operacao, quantidade_base FROM estoque_movimentacoes
      WHERE produto_id = 1 AND operacao = 'SAIDA' ORDER BY id DESC LIMIT 1
    `);
    assert.equal(fabrica.estoqueAtual, 20);
    assert.equal(loja.estoqueAtual, 500);
    assert.equal(picole.estoqueAtual, 1);
    assert.equal(picoleLoja.estoqueAtual, 0);
    assert.equal(saida.origem, 'PRODUCAO');
    assert.equal(saida.quantidade_base, 80);
    assert.ok((await get(db, 'SELECT COUNT(*) AS total FROM estoque_movimentacoes')).total > movimentosAntes.total);
  });

  it('bloqueio: fábrica 80 e loja 500 não completam uma produção de 100', async () => {
    await run(db, `UPDATE ficha_tecnica_componentes SET quantidade = 100 WHERE ficha_id = 1`);
    await MotorEstoque.entrar(db, { produtoId: 1, quantidadeBase: 60, origem: 'AJUSTE_MANUAL', local: 'FABRICA' });
    const fabricaAntes = await MotorEstoque.consultarSaldoLocal(db, 1, 'FABRICA');
    const lojaAntes = await MotorEstoque.consultarSaldoLocal(db, 1, 'LOJA');
    assert.equal(fabricaAntes.estoqueAtual, 80);
    assert.equal(lojaAntes.estoqueAtual, 500);
    const planejada = await ordem(db, 1, 1);
    const movimentos = await get(db, 'SELECT COUNT(*) AS total FROM estoque_movimentacoes');
    await assert.rejects(
      () => executarProducao(db, planejada.id, { correlation_id: 'bloqueio-100', quantidade_produzida: 1, quantidade_perdida: 0 }),
      (err) => err.message === 'Estoque insuficiente de Leite na Fábrica para executar esta produção.'
    );
    const fabrica = await MotorEstoque.consultarSaldoLocal(db, 1, 'FABRICA');
    const loja = await MotorEstoque.consultarSaldoLocal(db, 1, 'LOJA');
    const depois = await get(db, 'SELECT COUNT(*) AS total FROM estoque_movimentacoes');
    const status = await get(db, 'SELECT status FROM ordens_producao WHERE id = ?', [planejada.id]);
    assert.equal(fabrica.estoqueAtual, 80);
    assert.equal(loja.estoqueAtual, 500);
    assert.equal(depois.total, movimentos.total);
    assert.equal(status.status, 'EM_PRODUCAO');
  });
});
