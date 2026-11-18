'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const MotorEstoque = require('../../backend/motores/motor-estoque');
const {
  aplicarAjusteEstoqueProduto,
  produtoTemMovimentacoes
} = require('../../backend/services/ajusteEstoqueService');
const bootstrapFichas = require('../../backend/modules/fabrica-loja/migrations/002_fichas_tecnicas');
const bootstrapOrdens = require('../../backend/modules/fabrica-loja/migrations/005_ordens_producao');
const { consultarEstoqueInsumo } = require('../../backend/modules/fabrica-loja/InsumoEstoqueService');
const { salvarOrdem, planejarOrdem } = require('../../backend/modules/fabrica-loja/OrdemProducaoService');
const {
  executarProducao,
  previaProducao
} = require('../../backend/modules/fabrica-loja/ProducaoExecucaoService');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-ajuste-local-'));
const arquivo = path.join(dir, 'ajuste-local.db');

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
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function fechar(db) {
  return new Promise((resolve, reject) => {
    db.close((err) => (err ? reject(err) : resolve()));
  });
}

function ajustar(db, opcoes) {
  return new Promise((resolve, reject) => {
    aplicarAjusteEstoqueProduto(db, {
      motivo: 'Implantação de saldo por local',
      ...opcoes
    }, (err, resultado) => (err ? reject(err) : resolve(resultado)));
  });
}

describe('Ajuste de estoque por local', () => {
  let db;

  before(async () => {
    db = abrir();
    await run(db, `
      CREATE TABLE categorias (id INTEGER PRIMARY KEY, ativo INTEGER DEFAULT 1)
    `);
    await run(db, `
      CREATE TABLE produtos (
        id INTEGER PRIMARY KEY,
        nome TEXT NOT NULL,
        unidade TEXT NOT NULL,
        natureza_cadastro TEXT,
        ativo INTEGER DEFAULT 1,
        controlar_validade INTEGER DEFAULT 0,
        categoria_id INTEGER,
        preco_compra REAL DEFAULT 0,
        custo_medio REAL,
        estoque_atual REAL DEFAULT 0,
        saldo_fiscal REAL DEFAULT 0,
        saldo_nao_fiscal REAL DEFAULT 0,
        updated_at TEXT
      )
    `);
    await run(db, `
      CREATE TABLE produtos_ajustes_estoque (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        produto_id INTEGER,
        usuario_id INTEGER,
        usuario_nome TEXT,
        motivo TEXT,
        ajuste_fiscal REAL,
        ajuste_nao_fiscal REAL,
        saldo_fiscal_antes REAL,
        saldo_fiscal_depois REAL,
        saldo_nao_fiscal_antes REAL,
        saldo_nao_fiscal_depois REAL,
        estoque_total_antes REAL,
        estoque_total_depois REAL
      )
    `);
    await run(db, 'CREATE TABLE compras_itens (produto_id INTEGER)');
    await run(db, 'CREATE TABLE vendas_itens (produto_id INTEGER)');
    await run(db, 'CREATE TABLE compras_devolucoes (produto_id INTEGER)');
    await run(db, 'CREATE TABLE produtos_lotes (produto_id INTEGER, origem TEXT)');
    await run(db, `
      INSERT INTO produtos (id, nome, unidade, natureza_cadastro) VALUES
      (1, 'Leite UHT integral 1L', 'L', 'INSUMO'),
      (2, 'Insumo somente fiscal', 'L', 'INSUMO'),
      (3, 'Insumo somente não fiscal', 'L', 'INSUMO'),
      (4, 'Insumo Loja', 'L', 'INSUMO'),
      (5, 'Produto produzido', 'UN', 'PRODUZIDO'),
      (6, 'Insumo sem saldo', 'L', 'INSUMO')
    `);

    await MotorEstoque.bootstrapMotorEstoqueSchema(db);
    await bootstrapFichas(db);
    await bootstrapOrdens(db);
    await run(db, `
      INSERT INTO fichas_tecnicas
        (id, codigo, nome, produto_id, rendimento_quantidade, rendimento_unidade, ativa)
      VALUES (1, 'FT-1', 'Produto teste', 5, 1, 'UN', 1)
    `);
    await run(db, `
      INSERT INTO ficha_tecnica_componentes
        (ficha_id, ordem, produto_id, descricao, quantidade, unidade)
      VALUES (1, 1, 1, 'Leite UHT integral 1L', 6, 'L')
    `);
  });

  after(async () => {
    await fechar(db);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('registra somente fiscal na Fábrica', async () => {
    const resultado = await ajustar(db, {
      produtoId: 2,
      ajusteFiscal: 9,
      ajusteNaoFiscal: 0,
      local: 'FABRICA'
    });
    const saldo = await MotorEstoque.consultarSaldoLocal(db, 2, 'FABRICA');
    const loja = await MotorEstoque.consultarSaldoLocal(db, 2, 'LOJA');

    assert.equal(saldo.saldoFiscal, 9);
    assert.equal(saldo.saldoNaoFiscal, 0);
    assert.equal(saldo.estoqueAtual, 9);
    assert.equal(loja.estoqueAtual, 0);
    assert.equal(resultado.movimentacao.local, 'FABRICA');
  });

  it('registra somente não fiscal na Fábrica', async () => {
    const resultado = await ajustar(db, {
      produtoId: 3,
      ajusteFiscal: 0,
      ajusteNaoFiscal: 8,
      local: 'FABRICA'
    });
    const saldo = await MotorEstoque.consultarSaldoLocal(db, 3, 'FABRICA');

    assert.equal(saldo.saldoFiscal, 0);
    assert.equal(saldo.saldoNaoFiscal, 8);
    assert.equal(saldo.estoqueAtual, 8);
    assert.equal(resultado.movimentacao.quantidade_nao_fiscal, 8);
  });

  it('registra as duas parcelas na Fábrica sem alterar a Loja', async () => {
    const opcoes = {
      produtoId: 1,
      ajusteFiscal: 50,
      ajusteNaoFiscal: 20,
      local: 'FABRICA',
      referenciaId: 202601170001,
      usuarioId: 17,
      usuarioNome: 'Operador'
    };
    const [resultado, repeticao] = await Promise.all([
      ajustar(db, opcoes),
      ajustar(db, opcoes)
    ]);
    const fabrica = await MotorEstoque.consultarSaldoLocal(db, 1, 'FABRICA');
    const loja = await MotorEstoque.consultarSaldoLocal(db, 1, 'LOJA');
    const movimento = await get(db, `
      SELECT produto_id, operacao, origem, local, quantidade_fiscal, quantidade_nao_fiscal
      FROM estoque_movimentacoes
      WHERE produto_id = 1 AND operacao = 'AJUSTE'
    `);
    const auditoria = await get(db, `
      SELECT produto_id, ajuste_fiscal, ajuste_nao_fiscal, motivo
      FROM produtos_ajustes_estoque WHERE produto_id = 1
    `);
    const contagem = await get(db, `
      SELECT
        (SELECT COUNT(*) FROM estoque_movimentacoes WHERE produto_id = 1 AND operacao = 'AJUSTE') AS movimentos,
        (SELECT COUNT(*) FROM produtos_ajustes_estoque WHERE produto_id = 1) AS auditorias
    `);

    assert.equal(repeticao.repetida, true);
    assert.equal(fabrica.saldoFiscal, 50);
    assert.equal(fabrica.saldoNaoFiscal, 20);
    assert.equal(fabrica.estoqueAtual, 70);
    assert.equal(loja.estoqueAtual, 0);
    assert.deepEqual(movimento, {
      produto_id: 1,
      operacao: 'AJUSTE',
      origem: 'AJUSTE_MANUAL',
      local: 'FABRICA',
      quantidade_fiscal: 50,
      quantidade_nao_fiscal: 20
    });
    assert.equal(auditoria.produto_id, 1);
    assert.equal(auditoria.ajuste_fiscal, 50);
    assert.equal(auditoria.ajuste_nao_fiscal, 20);
    assert.equal(resultado.local, 'FABRICA');
    assert.equal(resultado.saldo_local.estoqueAtual, 70);
    assert.equal(contagem.movimentos, 1);
    assert.equal(contagem.auditorias, 1);
  });

  it('registra ajuste na Loja sem alterar a Fábrica', async () => {
    await ajustar(db, {
      produtoId: 4,
      ajusteFiscal: 12,
      ajusteNaoFiscal: 3,
      local: 'LOJA'
    });
    const loja = await MotorEstoque.consultarSaldoLocal(db, 4, 'LOJA');
    const fabrica = await MotorEstoque.consultarSaldoLocal(db, 4, 'FABRICA');

    assert.equal(loja.saldoFiscal, 12);
    assert.equal(loja.saldoNaoFiscal, 3);
    assert.equal(loja.estoqueAtual, 15);
    assert.equal(fabrica.estoqueAtual, 0);
  });

  it('consulta no cadastro os saldos fiscais e não fiscais de cada local', async () => {
    const fabrica = await consultarEstoqueInsumo(db, 1);
    const loja = await consultarEstoqueInsumo(db, 4);
    const novo = await consultarEstoqueInsumo(db, 6);

    assert.deepEqual(fabrica.fabrica, { saldo_fiscal: 50, saldo_nao_fiscal: 20, total: 70 });
    assert.deepEqual(fabrica.loja, { saldo_fiscal: 0, saldo_nao_fiscal: 0, total: 0 });
    assert.deepEqual(loja.fabrica, { saldo_fiscal: 0, saldo_nao_fiscal: 0, total: 0 });
    assert.deepEqual(loja.loja, { saldo_fiscal: 12, saldo_nao_fiscal: 3, total: 15 });
    assert.deepEqual(novo.fabrica, { saldo_fiscal: 0, saldo_nao_fiscal: 0, total: 0 });
    assert.deepEqual(novo.loja, { saldo_fiscal: 0, saldo_nao_fiscal: 0, total: 0 });
  });

  it('a produção consome as seis unidades da Fábrica preservando a composição fiscal', async () => {
    const criada = await salvarOrdem(db, {
      origem: 'MANUAL',
      itens: [{
        produto_id: 5,
        quantidade_planejada: 1,
        unidade: 'UN',
        ficha_tecnica_id: 1
      }]
    });
    const planejada = await planejarOrdem(db, criada.id);
    await run(db, `
      UPDATE ordens_producao SET status = 'EM_PRODUCAO' WHERE id = ?
    `, [planejada.id]);

    const previa = await previaProducao(db, planejada.id, {});
    assert.equal(previa.insumos[0].disponivel_fabrica, 70);

    await executarProducao(db, planejada.id, {
      correlation_id: 'ajuste-local-producao-1',
      quantidade_produzida: 1,
      quantidade_perdida: 0
    });

    const fabrica = await MotorEstoque.consultarSaldoLocal(db, 1, 'FABRICA');
    const loja = await MotorEstoque.consultarSaldoLocal(db, 1, 'LOJA');
    const movimentos = await all(db, `
      SELECT produto_id, operacao, local, quantidade_fiscal, quantidade_nao_fiscal
      FROM estoque_movimentacoes
      WHERE produto_id = 1 ORDER BY id
    `);

    assert.equal(fabrica.saldoFiscal, 44);
    assert.equal(fabrica.saldoNaoFiscal, 20);
    assert.equal(fabrica.estoqueAtual, 64);
    assert.equal(loja.estoqueAtual, 0);
    assert.deepEqual(movimentos.map((mov) => mov.produto_id), [1, 1]);
    assert.equal(movimentos[0].local, 'FABRICA');
    assert.equal(movimentos[0].quantidade_fiscal, 50);
    assert.equal(movimentos[0].quantidade_nao_fiscal, 20);
    assert.equal(movimentos[1].operacao, 'SAIDA');
    assert.equal(movimentos[1].quantidade_fiscal, -6);
    assert.equal(movimentos[1].quantidade_nao_fiscal, 0);
  });

  it('considera movimentações do Motor ao bloquear alteração de saldo inicial', async () => {
    await MotorEstoque.entrar(db, {
      produtoId: 2,
      quantidadeBase: 1,
      origem: 'COMPRA',
      local: 'LOJA'
    });
    const temMovimentacoes = await new Promise((resolve, reject) => {
      produtoTemMovimentacoes(db, 2, (err, tem) => (err ? reject(err) : resolve(tem)));
    });

    assert.equal(temMovimentacoes, true);
  });

  it('impede o duplo clique na confirmação do ajuste da interface', () => {
    const tela = fs.readFileSync(
      path.join(__dirname, '../../frontend/erp/js/produtos.js'),
      'utf8'
    );
    assert.match(tela, /if \(confirmar && confirmar\.disabled\) return;/);
    assert.match(tela, /if \(confirmar\) confirmar\.disabled = true;/);
    assert.match(tela, /local,\s*referencia_id: Number\(\$\('#ajuste_referencia_id'\)\.val\(\)\),\s*unidade_origem: unidadeOrigem/);
    assert.match(tela, /referencia_id: Number\(\$\('#ajuste_referencia_id'\)\.val\(\)\)/);
  });

  it('integra o cadastro de Insumos ao formulário existente e atualiza os saldos ao salvar', () => {
    const telaInsumos = fs.readFileSync(
      path.join(__dirname, '../../frontend/erp/js/insumos.js'),
      'utf8'
    );
    const telaProdutos = fs.readFileSync(
      path.join(__dirname, '../../frontend/erp/js/produtos.js'),
      'utf8'
    );
    const rota = fs.readFileSync(
      path.join(__dirname, '../../backend/rotas/fabrica-loja.js'),
      'utf8'
    );

    assert.match(telaInsumos, /data-ins-ajustar="\$\{Number\(atual\.id\)\}"/);
    assert.match(telaInsumos, /window\.abrirModalAjustarEstoque\(produtoId,\s*\{\s*onSaved:/);
    assert.match(telaInsumos, /ins-estoque-fabrica-fiscal/);
    assert.match(telaInsumos, /ins-estoque-loja-nao-fiscal/);
    assert.match(telaProdutos, /if \(typeof onSaved === 'function'\) onSaved\(\);\s*else loadProdutos\(\);/);
    assert.match(rota, /router\.get\('\/insumos\/:id\/estoque'/);
  });
});
