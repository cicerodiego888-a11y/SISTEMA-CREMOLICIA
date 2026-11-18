/**
 * OP com vários produtos → uma transferência com todos. Banco temporário.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const MotorEstoque = require('../../backend/motores/motor-estoque');
const { salvarFicha } = require('../../backend/modules/fabrica-loja/FichaTecnicaService');
const { salvarOrdem, planejarOrdem, obterOrdem } = require('../../backend/modules/fabrica-loja/OrdemProducaoService');
const { executarProducao, iniciarProducao } = require('../../backend/modules/fabrica-loja/ProducaoExecucaoService');
const {
  sugerirTransferenciaOrdem,
  salvarTransferencia,
  confirmarTransferencia,
  MENSAGEM_ESTOQUE,
  MENSAGEM_SEM_DISPONIVEL
} = require('../../backend/modules/fabrica-loja/TransferenciaEstoqueService');
const bootstrapExecucoes = require('../../backend/modules/fabrica-loja/migrations/006_ordem_producao_execucoes');

const dir = path.join(os.tmpdir(), 'cds-fabrica-loja-testes');
fs.mkdirSync(dir, { recursive: true });
const arquivo = path.join(dir, 'op-multi-item-transferencia.db');
for (const sufixo of ['', '-wal', '-shm']) fs.rmSync(arquivo + sufixo, { force: true });

function abrir() { return new sqlite3.Database(arquivo); }
function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) { err ? reject(err) : resolve(this); });
  });
}
function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}
function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

async function local(db, produtoId, lugar) {
  return MotorEstoque.consultarSaldoLocal(db, produtoId, lugar);
}

describe('OP multi-item → transferência multi-item', () => {
  let db;
  const fichas = {};

  before(async () => {
    db = abrir();
    await run(db, `
      CREATE TABLE produtos (
        id INTEGER PRIMARY KEY, nome TEXT, unidade TEXT,
        estoque_atual REAL DEFAULT 0, saldo_fiscal REAL DEFAULT 0, saldo_nao_fiscal REAL DEFAULT 0,
        natureza_cadastro TEXT, ativo INTEGER DEFAULT 1, controlar_validade INTEGER DEFAULT 0, updated_at TEXT
      )
    `);
    const produtos = [
      [9, 'Leite', 'UN', 'INSUMO'],
      [1, 'Picolé Morango', 'UN', 'PRODUZIDO'],
      [2, 'Picolé Chocolate', 'UN', 'PRODUZIDO'],
      [3, 'Picolé Abacaxi', 'UN', 'PRODUZIDO'],
      [4, 'Morango Parcial', 'UN', 'PRODUZIDO'],
      [5, 'Chocolate Parcial', 'UN', 'PRODUZIDO'],
      [6, 'Abacaxi Parcial', 'UN', 'PRODUZIDO'],
      [7, 'Morango Falha', 'UN', 'PRODUZIDO'],
      [8, 'Chocolate Falha', 'UN', 'PRODUZIDO'],
      [10, 'Abacaxi Falha', 'UN', 'PRODUZIDO'],
      [11, 'Produto A', 'UN', 'PRODUZIDO'],
      [12, 'Produto B', 'UN', 'PRODUZIDO'],
      [13, 'Picolé Perda', 'UN', 'PRODUZIDO'],
      [14, 'Zero A', 'UN', 'PRODUZIDO'],
      [15, 'Zero B', 'UN', 'PRODUZIDO'],
      [16, 'Idem A', 'UN', 'PRODUZIDO'],
      [17, 'Idem B', 'UN', 'PRODUZIDO'],
      [18, 'Picolé Repetido', 'UN', 'PRODUZIDO']
    ];
    for (const [id, nome, unidade, natureza] of produtos) {
      await run(db, 'INSERT INTO produtos (id, nome, unidade, natureza_cadastro) VALUES (?, ?, ?, ?)', [id, nome, unidade, natureza]);
    }
    await MotorEstoque.bootstrapMotorEstoqueSchema(db);
    for (const [id, nome] of produtos) {
      if (id === 9) continue;
      const ficha = await salvarFicha(db, {
        codigo: 'FT-' + id,
        nome,
        produto_id: id,
        rendimento_quantidade: 1,
        rendimento_unidade: 'UN',
        componentes: [{ produto_id: 9, quantidade: 1, unidade: 'UN' }]
      });
      fichas[id] = ficha.id;
    }
  });

  after(() => db.close());

  async function produzir(itens, extra) {
    const total = itens.reduce((soma, item) => soma + item.quantidade, 0);
    await MotorEstoque.entrar(db, { produtoId: 9, quantidadeBase: total, origem: 'COMPRA', local: 'FABRICA' });
    const ordem = await salvarOrdem(db, {
      observacao: 'multi',
      itens: itens.map((item) => ({
        produto_id: item.id,
        descricao: item.nome,
        quantidade: item.quantidade,
        unidade: 'UN',
        ficha_tecnica_id: fichas[item.id]
      }))
    });
    await planejarOrdem(db, ordem.id);
    await iniciarProducao(db, ordem.id);
    const execucao = await executarProducao(db, ordem.id, Object.assign({ correlation_id: 'exec-' + ordem.id }, extra || {}));
    return { ordem, execucao };
  }

  async function transferir(itens, correlationId) {
    const doc = await salvarTransferencia(db, { itens });
    return confirmarTransferencia(db, doc.id, { correlation_id: correlationId });
  }

  it('produz 500, 300 e 200 e transfere os três em um único documento', async () => {
    const { ordem } = await produzir([
      { id: 1, nome: 'Picolé Morango', quantidade: 500 },
      { id: 2, nome: 'Picolé Chocolate', quantidade: 300 },
      { id: 3, nome: 'Picolé Abacaxi', quantidade: 200 }
    ]);
    assert.equal((await local(db, 1, 'FABRICA')).estoqueAtual, 500);
    assert.equal((await local(db, 2, 'FABRICA')).estoqueAtual, 300);
    assert.equal((await local(db, 3, 'FABRICA')).estoqueAtual, 200);

    const sugestao = await sugerirTransferenciaOrdem(db, ordem.id);
    assert.equal(sugestao.itens.length, 3);
    assert.deepEqual(sugestao.itens.map((item) => item.quantidade), [500, 300, 200]);

    const resultado = await transferir(sugestao.itens.map((item) => ({
      produto_id: item.produto_id,
      quantidade: item.quantidade,
      unidade: item.unidade
    })), 'trf-completa');
    assert.equal(resultado.transferencia.itens.length, 3);
    assert.match(resultado.transferencia.codigo, /^TRF-/);
    assert.equal((await obterOrdem(db, ordem.id)).status, 'CONCLUIDA');
    for (const id of [1, 2, 3]) {
      assert.equal((await local(db, id, 'FABRICA')).estoqueAtual, 0);
    }
    assert.equal((await local(db, 1, 'LOJA')).estoqueAtual, 500);
    assert.equal((await local(db, 2, 'LOJA')).estoqueAtual, 300);
    assert.equal((await local(db, 3, 'LOJA')).estoqueAtual, 200);
  });

  it('transfere parte e deixa o restante na fábrica', async () => {
    const { ordem } = await produzir([
      { id: 4, nome: 'Morango Parcial', quantidade: 500 },
      { id: 5, nome: 'Chocolate Parcial', quantidade: 300 },
      { id: 6, nome: 'Abacaxi Parcial', quantidade: 200 }
    ]);
    await transferir([
      { produto_id: 4, quantidade: 300, unidade: 'UN' },
      { produto_id: 5, quantidade: 200, unidade: 'UN' },
      { produto_id: 6, quantidade: 100, unidade: 'UN' }
    ], 'trf-parcial');
    assert.equal((await obterOrdem(db, ordem.id)).status, 'CONCLUIDA');
    assert.equal((await local(db, 4, 'FABRICA')).estoqueAtual, 200);
    assert.equal((await local(db, 5, 'FABRICA')).estoqueAtual, 100);
    assert.equal((await local(db, 6, 'FABRICA')).estoqueAtual, 100);
    assert.equal((await local(db, 4, 'LOJA')).estoqueAtual, 300);
    assert.equal((await local(db, 5, 'LOJA')).estoqueAtual, 200);
    assert.equal((await local(db, 6, 'LOJA')).estoqueAtual, 100);
    const nova = await sugerirTransferenciaOrdem(db, ordem.id);
    assert.deepEqual(nova.itens.map((item) => item.quantidade), [200, 100, 100]);
  });

  it('desfaz a transferência inteira quando um produto não tem saldo', async () => {
    await produzir([
      { id: 7, nome: 'Morango Falha', quantidade: 500 },
      { id: 8, nome: 'Chocolate Falha', quantidade: 300 },
      { id: 10, nome: 'Abacaxi Falha', quantidade: 200 }
    ]);
    await assert.rejects(
      () => transferir([
        { produto_id: 7, quantidade: 300, unidade: 'UN' },
        { produto_id: 8, quantidade: 400, unidade: 'UN' },
        { produto_id: 10, quantidade: 100, unidade: 'UN' }
      ], 'trf-falha'),
      (err) => err.message === MENSAGEM_ESTOQUE
    );
    assert.equal((await local(db, 7, 'FABRICA')).estoqueAtual, 500);
    assert.equal((await local(db, 8, 'FABRICA')).estoqueAtual, 300);
    assert.equal((await local(db, 10, 'FABRICA')).estoqueAtual, 200);
    assert.equal((await local(db, 7, 'LOJA')).estoqueAtual, 0);
    assert.equal((await local(db, 8, 'LOJA')).estoqueAtual, 0);
    assert.equal((await local(db, 10, 'LOJA')).estoqueAtual, 0);
  });

  it('calcula fiscal e não fiscal de cada produto separadamente', async () => {
    await MotorEstoque.entrar(db, {
      produtoId: 11, quantidadeBase: 100, quantidadeFiscal: 80, quantidadeNaoFiscal: 20,
      origem: 'COMPRA', local: 'FABRICA'
    });
    await MotorEstoque.entrar(db, {
      produtoId: 12, quantidadeBase: 100, quantidadeFiscal: 20, quantidadeNaoFiscal: 80,
      origem: 'COMPRA', local: 'FABRICA'
    });
    const resultado = await transferir([
      { produto_id: 11, quantidade: 50, unidade: 'UN' },
      { produto_id: 12, quantidade: 50, unidade: 'UN' }
    ], 'trf-fiscal');
    const a = resultado.transferencia.itens.find((item) => item.produto_id === 11);
    const b = resultado.transferencia.itens.find((item) => item.produto_id === 12);
    assert.equal(a.quantidade_fiscal, 40);
    assert.equal(a.quantidade_nao_fiscal, 10);
    assert.equal(b.quantidade_fiscal, 10);
    assert.equal(b.quantidade_nao_fiscal, 40);
    const fabricaA = await local(db, 11, 'FABRICA');
    const lojaA = await local(db, 11, 'LOJA');
    const fabricaB = await local(db, 12, 'FABRICA');
    const lojaB = await local(db, 12, 'LOJA');
    assert.equal(fabricaA.saldoFiscal, 40);
    assert.equal(fabricaA.saldoNaoFiscal, 10);
    assert.equal(lojaA.saldoFiscal, 40);
    assert.equal(lojaA.saldoNaoFiscal, 10);
    assert.equal(fabricaB.saldoFiscal, 10);
    assert.equal(fabricaB.saldoNaoFiscal, 40);
    assert.equal(lojaB.saldoFiscal, 10);
    assert.equal(lojaB.saldoNaoFiscal, 40);
  });

  it('sugere a quantidade produzida e ignora a perda', async () => {
    const { ordem } = await produzir(
      [{ id: 13, nome: 'Picolé Perda', quantidade: 500 }],
      { quantidade_produzida: 470, quantidade_perdida: 30, motivo_perda: 'Quebra' }
    );
    const sugestao = await sugerirTransferenciaOrdem(db, ordem.id);
    assert.equal(sugestao.itens.length, 1);
    assert.equal(sugestao.itens[0].quantidade, 470);
    assert.equal((await local(db, 13, 'FABRICA')).estoqueAtual, 470);
  });

  it('não cria transferência quando nada foi produzido', async () => {
    const ordem = await salvarOrdem(db, {
      observacao: 'zero',
      itens: [
        { produto_id: 14, descricao: 'Zero A', quantidade: 10, unidade: 'UN', ficha_tecnica_id: fichas[14] },
        { produto_id: 15, descricao: 'Zero B', quantidade: 10, unidade: 'UN', ficha_tecnica_id: fichas[15] }
      ]
    });
    await bootstrapExecucoes(db);
    await run(db, `
      INSERT INTO ordem_producao_execucoes (ordem_id, correlation_id, snapshot_json, local)
      VALUES (?, 'zero', ?, 'FABRICA')
    `, [ordem.id, JSON.stringify({
      produzidos: [
        { produto_id: 14, produto_nome: 'Zero A', quantidade_produzida: 0, quantidade_base: 0, unidade: 'UN', unidade_base: 'UN' },
        { produto_id: 15, produto_nome: 'Zero B', quantidade_produzida: 0, quantidade_base: 0, unidade: 'UN', unidade_base: 'UN' }
      ]
    })]);
    const antes = await get(db, 'SELECT COUNT(*) AS total FROM transferencias_estoque');
    const sugestao = await sugerirTransferenciaOrdem(db, ordem.id);
    const depois = await get(db, 'SELECT COUNT(*) AS total FROM transferencias_estoque');
    assert.equal(sugestao.itens.length, 0);
    assert.equal(sugestao.mensagem, MENSAGEM_SEM_DISPONIVEL);
    assert.equal(depois.total, antes.total);
  });

  it('não duplica a confirmação da mesma transferência', async () => {
    await produzir([
      { id: 16, nome: 'Idem A', quantidade: 10 },
      { id: 17, nome: 'Idem B', quantidade: 20 }
    ]);
    const doc = await salvarTransferencia(db, {
      itens: [
        { produto_id: 16, quantidade: 10, unidade: 'UN' },
        { produto_id: 17, quantidade: 20, unidade: 'UN' }
      ]
    });
    const primeira = await confirmarTransferencia(db, doc.id, { correlation_id: 'trf-idem' });
    const segunda = await confirmarTransferencia(db, doc.id, { correlation_id: 'trf-idem' });
    assert.equal(segunda.repetida, true);
    assert.equal(segunda.transferencia.id, primeira.transferencia.id);
    const movimentos = await all(db, `
      SELECT operacao, produto_id FROM estoque_movimentacoes
      WHERE referencia_tipo = 'transferencia_estoque' AND referencia_id = ?
    `, [doc.id]);
    assert.equal(movimentos.length, 4);
    assert.equal(movimentos.filter((item) => item.produto_id === 16).length, 2);
    assert.equal(movimentos.filter((item) => item.produto_id === 17).length, 2);
    assert.equal((await local(db, 16, 'LOJA')).estoqueAtual, 10);
    assert.equal((await local(db, 17, 'LOJA')).estoqueAtual, 20);
  });

  it('reúne o mesmo produto em uma linha só na sugestão', async () => {
    const { ordem } = await produzir([
      { id: 18, nome: 'Picolé Repetido', quantidade: 100 },
      { id: 18, nome: 'Picolé Repetido', quantidade: 50 }
    ]);
    const sugestao = await sugerirTransferenciaOrdem(db, ordem.id);
    assert.equal(sugestao.itens.length, 1);
    assert.equal(sugestao.itens[0].produto_id, 18);
    assert.equal(sugestao.itens[0].quantidade, 150);
    const gravada = await obterOrdem(db, ordem.id);
    assert.equal(gravada.itens.length, 2);
  });
});
