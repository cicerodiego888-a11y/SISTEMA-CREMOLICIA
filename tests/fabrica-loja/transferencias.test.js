/**
 * Transferência Fábrica → Loja. Banco temporário. Não usa o banco oficial.
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
  cancelarTransferencia,
  MENSAGEM_ESTOQUE,
  MENSAGEM_NATUREZA,
  MENSAGEM_CONFIRMADA,
  MENSAGEM_CANCELAR,
  MENSAGEM_QUANTIDADE
} = require('../../backend/modules/fabrica-loja/TransferenciaEstoqueService');
const { salvarOrdem, planejarOrdem } = require('../../backend/modules/fabrica-loja/OrdemProducaoService');
const { executarProducao, iniciarProducao } = require('../../backend/modules/fabrica-loja/ProducaoExecucaoService');
const bootstrapFichas = require('../../backend/modules/fabrica-loja/migrations/002_fichas_tecnicas');
const bootstrapOrdens = require('../../backend/modules/fabrica-loja/migrations/005_ordens_producao');

const dir = path.join(os.tmpdir(), 'cds-fabrica-loja-testes');
fs.mkdirSync(dir, { recursive: true });
const arquivo = path.join(dir, 'transferencias.db');
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
function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

async function produto(db, id, nome, unidade, natureza) {
  await run(db, `
    INSERT INTO produtos (id, nome, unidade, estoque_atual, saldo_fiscal, saldo_nao_fiscal, natureza_cadastro, ativo, controlar_validade)
    VALUES (?, ?, ?, 0, 0, 0, ?, 1, 0)
  `, [id, nome, unidade, natureza]);
}

async function naFabrica(db, produtoId, quantidade) {
  await MotorEstoque.bootstrapMotorEstoqueSchema(db);
  await MotorEstoque.entrar(db, {
    produtoId, quantidadeBase: quantidade, origem: 'AJUSTE_MANUAL', local: 'FABRICA'
  });
}

async function rascunho(db, produtoId, quantidade, unidade) {
  return salvarTransferencia(db, {
    itens: [{ produto_id: produtoId, quantidade, unidade: unidade || 'UN' }]
  });
}

describe('Transferência Fábrica → Loja', () => {
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
    await produto(db, 5, 'Picolé de Morango', 'UN', 'PRODUZIDO');
    await produto(db, 6, 'Picolé de Uva', 'UN', 'PRODUZIDO');
    await produto(db, 9, 'Chocolate', 'KG', 'INSUMO');
    await produto(db, 1, 'Leite', 'L', 'INSUMO');
    await bootstrapFichas(db);
    await bootstrapOrdens(db);
  });

  after(() => db.close());

  it('1, 2 e 3: rascunho não movimenta estoque', async () => {
    const doc = await rascunho(db, 5, 100, 'UN');
    assert.equal(doc.origem_local, 'FABRICA');
    assert.equal(doc.destino_local, 'LOJA');
    assert.equal(doc.status, 'RASCUNHO');
    assert.match(doc.codigo, /^TRF-\d{4}-\d{6}$/);
    const tabela = await get(db, `SELECT name FROM sqlite_master WHERE name = 'estoque_movimentacoes'`);
    assert.equal(tabela, undefined);
  });

  it('4, 5, 6, 7, 19, 20 e 24: confirmação tira da fábrica e põe na loja', async () => {
    await naFabrica(db, 5, 500);
    const naturezaAntes = await get(db, 'SELECT natureza_cadastro FROM produtos WHERE id = 5');
    const doc = await rascunho(db, 5, 100, 'UN');
    const resultado = await confirmarTransferencia(db, doc.id, { correlation_id: 'trf-1' }, { usuario_nome: 'Ana' });
    const fabrica = await MotorEstoque.consultarSaldoLocal(db, 5, 'FABRICA');
    const loja = await MotorEstoque.consultarSaldoLocal(db, 5, 'LOJA');
    const movimentos = await all(db, `
      SELECT operacao, origem, referencia_id, referencia_tipo, produto_id
      FROM estoque_movimentacoes WHERE referencia_id = ?
    `, [doc.id]);
    assert.equal(resultado.transferencia.status, 'CONFIRMADA');
    assert.equal(fabrica.estoqueAtual, 400);
    assert.equal(loja.estoqueAtual, 100);
    assert.equal(movimentos.length, 2);
    assert.ok(movimentos.every((item) => item.referencia_id === doc.id && item.origem === 'TRANSFERENCIA' && item.produto_id === 5));
    assert.equal(movimentos.filter((item) => item.operacao === 'SAIDA').length, 1);
    assert.equal(movimentos.filter((item) => item.operacao === 'ENTRADA').length, 1);
    const natureza = await get(db, 'SELECT natureza_cadastro FROM produtos WHERE id = 5');
    assert.equal(natureza.natureza_cadastro, naturezaAntes.natureza_cadastro);
    assert.equal(resultado.transferencia.itens[0].produto_id, 5);
  });

  it('8 e 9: estoque insuficiente não baixa nenhum item', async () => {
    await naFabrica(db, 6, 1);
    const antes = await all(db, 'SELECT produto_id, local, estoque_atual FROM estoque_saldos_locais ORDER BY produto_id, local');
    const doc = await salvarTransferencia(db, {
      itens: [
        { produto_id: 5, quantidade: 10, unidade: 'UN' },
        { produto_id: 6, quantidade: 20, unidade: 'UN' }
      ]
    });
    await assert.rejects(() => confirmarTransferencia(db, doc.id, { correlation_id: 'trf-falta' }), (err) => {
      assert.equal(err.message, MENSAGEM_ESTOQUE);
      assert.equal(err.detalhes[0].disponivel != null, true);
      return true;
    });
    const depois = await all(db, 'SELECT produto_id, local, estoque_atual FROM estoque_saldos_locais ORDER BY produto_id, local');
    assert.deepEqual(depois, antes);
    const status = await get(db, 'SELECT status FROM transferencias_estoque WHERE id = ?', [doc.id]);
    assert.equal(status.status, 'RASCUNHO');
  });

  it('10: falha entre saída e entrada desfaz a transferência', async () => {
    const antes = await all(db, 'SELECT produto_id, local, estoque_atual FROM estoque_saldos_locais ORDER BY produto_id, local');
    const doc = await rascunho(db, 5, 50, 'UN');
    await assert.rejects(() => confirmarTransferencia(db, doc.id, { correlation_id: 'trf-quebra' }, {
      aposSaida() { throw new Error('falha simulada'); }
    }));
    const depois = await all(db, 'SELECT produto_id, local, estoque_atual FROM estoque_saldos_locais ORDER BY produto_id, local');
    const status = await get(db, 'SELECT status FROM transferencias_estoque WHERE id = ?', [doc.id]);
    assert.deepEqual(depois, antes);
    assert.equal(status.status, 'RASCUNHO');
  });

  it('11, 12 e 13: confirmada não repete nem cancela', async () => {
    const doc = await get(db, 'SELECT id FROM transferencias_estoque WHERE correlation_id = ?', ['trf-1']);
    const antes = await get(db, 'SELECT COUNT(*) AS total FROM estoque_movimentacoes');
    const repetida = await confirmarTransferencia(db, doc.id, { correlation_id: 'trf-1' });
    assert.equal(repetida.repetida, true);
    const depois = await get(db, 'SELECT COUNT(*) AS total FROM estoque_movimentacoes');
    assert.equal(depois.total, antes.total);
    await assert.rejects(() => confirmarTransferencia(db, doc.id, { correlation_id: 'trf-outra' }), (err) => err.message === MENSAGEM_CONFIRMADA);
    await assert.rejects(() => cancelarTransferencia(db, doc.id), (err) => err.message === MENSAGEM_CANCELAR);
  });

  it('14: rascunho pode ser cancelado', async () => {
    const doc = await rascunho(db, 5, 10, 'UN');
    const cancelada = await cancelarTransferencia(db, doc.id);
    assert.equal(cancelada.status, 'CANCELADA');
  });

  it('15, 16, 17 e 18: produto, quantidade e unidade inválidos', async () => {
    await assert.rejects(() => rascunho(db, 999, 1, 'UN'), (err) => err.message === 'O produto informado não existe.');
    await assert.rejects(() => rascunho(db, 5, 0, 'UN'), (err) => err.message === MENSAGEM_QUANTIDADE);
    await assert.rejects(() => rascunho(db, 5, -1, 'UN'), (err) => err.message === MENSAGEM_QUANTIDADE);
    await assert.rejects(() => rascunho(db, 5, 1, 'KG'), (err) => err.code === 'UNIDADE_INCOMPATIVEL');
  });

  it('21 e 22: não gera financeiro nem documento fiscal', async () => {
    const fonte = fs.readFileSync(path.join(__dirname, '../../backend/modules/fabrica-loja/TransferenciaEstoqueService.js'), 'utf8');
    const legado = fs.readFileSync(path.join(__dirname, '../../backend/lib/entradaProducaoPropria.js'), 'utf8');
    assert.equal(fonte.includes('MotorEstoque.sair'), true);
    assert.equal(fonte.includes('MotorEstoque.entrar'), true);
    assert.equal(fonte.includes('contas_receber'), false);
    assert.equal(fonte.includes('contas_pagar'), false);
    assert.equal(fonte.includes('nfce'), false);
    assert.equal(fonte.includes('nfe'), false);
    assert.equal(legado.includes('PRODUCAO_PROPRIA'), true);
  });

  it('23: insumo não pode ser transferido', async () => {
    await naFabrica(db, 9, 30);
    const fabricaAntes = await MotorEstoque.consultarSaldoLocal(db, 9, 'FABRICA');
    const lojaAntes = await MotorEstoque.consultarSaldoLocal(db, 9, 'LOJA');
    await assert.rejects(
      () => salvarTransferencia(db, { itens: [{ produto_id: 9, quantidade: 20, unidade: 'KG' }] }),
      (err) => err.message === MENSAGEM_NATUREZA && err.code === 'PRODUTO_NAO_TRANSFERIVEL'
    );
    const fabrica = await MotorEstoque.consultarSaldoLocal(db, 9, 'FABRICA');
    const loja = await MotorEstoque.consultarSaldoLocal(db, 9, 'LOJA');
    assert.equal(fabrica.estoqueAtual, fabricaAntes.estoqueAtual);
    assert.equal(loja.estoqueAtual, lojaAntes.estoqueAtual);
  });

  it('25: produção continua entrando na fábrica', async () => {
    await MotorEstoque.entrar(db, { produtoId: 1, quantidadeBase: 100, origem: 'COMPRA', local: 'FABRICA' });
    await run(db, `
      INSERT INTO fichas_tecnicas (id, codigo, nome, produto_id, rendimento_quantidade, rendimento_unidade, ativa)
      VALUES (1, 'FT-1', 'Picolé', 5, 100, 'UN', 1)
    `);
    await run(db, `
      INSERT INTO ficha_tecnica_componentes (ficha_id, ordem, produto_id, descricao, quantidade, unidade)
      VALUES (1, 1, 1, 'Leite', 20, 'L')
    `);
    const criada = await salvarOrdem(db, {
      origem: 'MANUAL',
      itens: [{ produto_id: 5, quantidade_planejada: 100, unidade: 'UN', ficha_tecnica_id: 1 }]
    });
    const ordem = await planejarOrdem(db, criada.id);
    const fabricaAntes = await MotorEstoque.consultarSaldoLocal(db, 5, 'FABRICA');
    await iniciarProducao(db, ordem.id);
    await executarProducao(db, ordem.id, { correlation_id: 'prod-trf', quantidade_produzida: 100, quantidade_perdida: 0 });
    const fabrica = await MotorEstoque.consultarSaldoLocal(db, 5, 'FABRICA');
    const leiteFabrica = await MotorEstoque.consultarSaldoLocal(db, 1, 'FABRICA');
    const leiteLoja = await MotorEstoque.consultarSaldoLocal(db, 1, 'LOJA');
    assert.equal(fabrica.estoqueAtual - fabricaAntes.estoqueAtual, 100);
    assert.equal(leiteFabrica.estoqueAtual, 80);
    assert.equal(leiteLoja.estoqueAtual, 0);
  });

  it('26: compra continua entrando na loja e o saldo legado permanece na loja', async () => {
    await produto(db, 12, 'Caixa pronta', 'UN', 'COMERCIAL');
    await run(db, 'UPDATE produtos SET estoque_atual = 40, saldo_fiscal = 40 WHERE id = 12');
    const herdado = await MotorEstoque.consultarSaldoLocal(db, 12, 'LOJA');
    const fabrica = await MotorEstoque.consultarSaldoLocal(db, 12, 'FABRICA');
    assert.equal(herdado.estoqueAtual, 40);
    assert.equal(herdado.herdado, true);
    assert.equal(fabrica.estoqueAtual, 0);
    await MotorEstoque.entrar(db, { produtoId: 12, quantidadeBase: 10, origem: 'COMPRA' });
    const loja = await MotorEstoque.consultarSaldoLocal(db, 12, 'LOJA');
    const oficial = await get(db, 'SELECT estoque_atual FROM produtos WHERE id = 12');
    assert.equal(loja.estoqueAtual, 50);
    assert.equal(oficial.estoque_atual, 50);
  });
});
