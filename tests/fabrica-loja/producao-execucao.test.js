/**
 * Execução da ordem de produção. Banco temporário. Não usa o banco oficial.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const { salvarOrdem, planejarOrdem, cancelarOrdem } = require('../../backend/modules/fabrica-loja/OrdemProducaoService');
const { executarProducao, previaProducao, MENSAGEM_CONCLUIDA, MENSAGEM_PRODUTO, MENSAGEM_SEM_PRODUTO, MENSAGEM_NAO_INSUMO, MENSAGEM_RENDIMENTO, MENSAGEM_RESULTADO } = require('../../backend/modules/fabrica-loja/ProducaoExecucaoService');
const MotorEstoque = require('../../backend/motores/motor-estoque');
const bootstrapFichas = require('../../backend/modules/fabrica-loja/migrations/002_fichas_tecnicas');
const bootstrapOrdens = require('../../backend/modules/fabrica-loja/migrations/005_ordens_producao');

const dir = path.join(os.tmpdir(), 'cds-fabrica-loja-testes');
fs.mkdirSync(dir, { recursive: true });
const arquivo = path.join(dir, 'producao-execucao.db');
for (const sufixo of ['', '-wal', '-shm']) fs.rmSync(arquivo + sufixo, { force: true });

function abrir() {
  return new sqlite3.Database(arquivo);
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID });
    });
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

async function produto(db, id, nome, unidade, saldo, natureza) {
  await run(db, `
    INSERT INTO produtos (id, nome, unidade, estoque_atual, saldo_fiscal, saldo_nao_fiscal, natureza_cadastro, ativo, controlar_validade, preco_compra)
    VALUES (?, ?, ?, ?, ?, 0, ?, 1, 0, 2)
  `, [id, nome, unidade, saldo, saldo, natureza]);
}

async function ficha(db, id, produtoId, rendimento, ativa, componentes) {
  await run(db, `
    INSERT INTO fichas_tecnicas (id, codigo, nome, produto_id, rendimento_quantidade, rendimento_unidade, ativa)
    VALUES (?, ?, 'Ficha teste', ?, ?, 'UN', ?)
  `, [id, 'FT-' + id, produtoId, rendimento, ativa]);
  for (const componente of componentes) {
    await run(db, `
      INSERT INTO ficha_tecnica_componentes (ficha_id, ordem, produto_id, descricao, quantidade, unidade)
      VALUES (?, 1, ?, 'comp', ?, ?)
    `, [id, componente.produto_id, componente.quantidade, componente.unidade]);
  }
}

async function ordemPlanejada(db, produtoId, quantidade, fichaId) {
  const criada = await salvarOrdem(db, {
    origem: 'MANUAL',
    itens: [{ produto_id: produtoId, quantidade_planejada: quantidade, unidade: 'UN', ficha_tecnica_id: fichaId }]
  });
  return planejarOrdem(db, criada.id);
}

// Simula OP já iniciada cujos dados mudaram depois do início: aqui se testam as validações da execução.
async function ordemEmProducao(db, produtoId, quantidade, fichaId) {
  const planejada = await ordemPlanejada(db, produtoId, quantidade, fichaId);
  await run(db, "UPDATE ordens_producao SET status = 'EM_PRODUCAO' WHERE id = ? AND status = 'PLANEJADA'", [planejada.id]);
  return { ...planejada, status: 'EM_PRODUCAO' };
}

async function ordemAntiga(db, produtoId, quantidade, fichaId, nome) {
  const criada = await run(db, `
    INSERT INTO ordens_producao (codigo, status, origem, prioridade)
    VALUES (?, 'EM_PRODUCAO', 'MANUAL', 'NORMAL')
  `, [`OP-ANTIGA-${produtoId}-${fichaId}`]);
  await run(db, `
    INSERT INTO ordem_producao_itens (
      ordem_id, ordem, produto_id, produto_nome, quantidade_planejada, unidade, ficha_tecnica_id
    ) VALUES (?, 1, ?, ?, ?, 'UN', ?)
  `, [criada.id, produtoId, nome, quantidade, fichaId]);
  return { id: criada.id };
}

describe('Execução da ordem de produção', () => {
  let db;

  before(async () => {
    db = abrir();
    await run(db, `
      CREATE TABLE produtos (
        id INTEGER PRIMARY KEY,
        nome TEXT,
        unidade TEXT,
        estoque_atual REAL DEFAULT 0,
        saldo_fiscal REAL DEFAULT 0,
        saldo_nao_fiscal REAL DEFAULT 0,
        natureza_cadastro TEXT,
        ativo INTEGER DEFAULT 1,
        controlar_validade INTEGER DEFAULT 0,
        updated_at TEXT,
        preco_compra REAL
      )
    `);
    await bootstrapFichas(db);
    await bootstrapOrdens(db);
    await produto(db, 1, 'Leite', 'L', 100, 'INSUMO');
    await produto(db, 2, 'Açúcar', 'KG', 50, 'INSUMO');
    await produto(db, 3, 'Polpa', 'KG', 20, 'INSUMO');
    await produto(db, 4, 'Chocolate', 'KG', 10, 'INSUMO');
    await produto(db, 5, 'Picolé de Morango', 'UN', 0, 'PRODUZIDO');
    await produto(db, 6, 'Picolé comercial', 'UN', 0, 'COMERCIAL');
    await produto(db, 7, 'Picolé inativo', 'UN', 0, 'PRODUZIDO');
    await run(db, 'UPDATE produtos SET ativo = 0 WHERE id = 7');
    await produto(db, 8, 'Leite em ML', 'ML', 25000, 'INSUMO');
    await MotorEstoque.bootstrapMotorEstoqueSchema(db);
    const insumos = await all(db, `SELECT id, estoque_atual FROM produtos WHERE natureza_cadastro = 'INSUMO' AND estoque_atual > 0`);
    for (const insumo of insumos) {
      await run(db, `
        INSERT INTO estoque_saldos_locais (produto_id, local, saldo_fiscal, saldo_nao_fiscal, estoque_atual)
        VALUES (?, 'FABRICA', ?, 0, ?)
      `, [insumo.id, insumo.estoque_atual, insumo.estoque_atual]);
    }
    await ficha(db, 1, 5, 100, 1, [
      { produto_id: 1, quantidade: 20, unidade: 'L' },
      { produto_id: 2, quantidade: 5, unidade: 'KG' },
      { produto_id: 3, quantidade: 3, unidade: 'KG' }
    ]);
  });

  after(() => db.close());

  it('1 a 7 e 23: ordem planejada produz, baixa insumos e entra o produto', async () => {
    const ordem = await ordemEmProducao(db, 5, 500, 1);
    const previa = await previaProducao(db, ordem.id);
    assert.equal(previa.consumos.find((item) => item.produto_id === 1).quantidade, 100);
    const resultado = await executarProducao(db, ordem.id, { correlation_id: 'exec-1' }, { usuario_nome: 'Ana' });
    assert.equal(resultado.ordem.status, 'CONCLUIDA');
    assert.equal(resultado.execucao.snapshot.produzidos[0].quantidade_produzida, 500);
    assert.equal(resultado.execucao.snapshot.ficha ? false : resultado.execucao.snapshot.produzidos[0].ficha.componentes[0].quantidade, 20);
    const leite = await get(db, 'SELECT estoque_atual FROM produtos WHERE id = 1');
    const acucar = await get(db, 'SELECT estoque_atual FROM produtos WHERE id = 2');
    const polpa = await get(db, 'SELECT estoque_atual FROM produtos WHERE id = 3');
    const picole = await get(db, 'SELECT estoque_atual, natureza_cadastro FROM produtos WHERE id = 5');
    assert.equal(leite.estoque_atual, 0);
    assert.equal(acucar.estoque_atual, 25);
    assert.equal(polpa.estoque_atual, 5);
    assert.equal(picole.estoque_atual, 500);
    assert.equal(picole.natureza_cadastro, 'PRODUZIDO');
    const leiteFabrica = await get(db, `SELECT estoque_atual FROM estoque_saldos_locais WHERE produto_id = 1 AND local = 'FABRICA'`);
    const leiteLoja = await get(db, `SELECT estoque_atual FROM estoque_saldos_locais WHERE produto_id = 1 AND local = 'LOJA'`);
    const picoleFabrica = await get(db, `SELECT estoque_atual FROM estoque_saldos_locais WHERE produto_id = 5 AND local = 'FABRICA'`);
    assert.equal(leiteFabrica.estoque_atual, 0);
    assert.equal(leiteLoja, undefined);
    assert.equal(picoleFabrica.estoque_atual, 500);
    const movimentos = await all(db, 'SELECT motor, origem, operacao FROM estoque_movimentacoes');
    assert.ok(movimentos.length >= 4);
    assert.ok(movimentos.every((item) => item.motor === 'MotorEstoque' && item.origem === 'PRODUCAO'));
    assert.equal(movimentos.filter((item) => item.operacao === 'ENTRADA').length, 1);
    assert.equal(resultado.execucao.local, 'FABRICA');
    const transferencia = await get(db, `SELECT name FROM sqlite_master WHERE name = 'transferencias'`);
    assert.equal(transferencia, undefined);
  });

  it('3: alterar a ficha depois não muda o snapshot', async () => {
    await run(db, 'UPDATE ficha_tecnica_componentes SET quantidade = 99 WHERE ficha_id = 1 AND produto_id = 1');
    const ordem = await get(db, 'SELECT id FROM ordens_producao WHERE codigo IS NOT NULL ORDER BY id LIMIT 1');
    const execucao = await get(db, 'SELECT snapshot_json FROM ordem_producao_execucoes WHERE ordem_id = ?', [ordem.id]);
    const snapshot = JSON.parse(execucao.snapshot_json);
    assert.equal(snapshot.produzidos[0].ficha.componentes.find((item) => item.produto_id === 1).quantidade, 20);
    assert.equal(snapshot.consumos.find((item) => item.produto_id === 1).quantidade, 100);
    await run(db, 'UPDATE ficha_tecnica_componentes SET quantidade = 20 WHERE ficha_id = 1 AND produto_id = 1');
  });

  it('8 e 34: estoque insuficiente não baixa nenhum insumo', async () => {
    await run(db, 'UPDATE produtos SET estoque_atual = 1, saldo_fiscal = 1 WHERE id = 4');
    await run(db, `UPDATE estoque_saldos_locais SET saldo_fiscal = 1, estoque_atual = 1 WHERE produto_id = 4 AND local = 'FABRICA'`);
    await ficha(db, 2, 5, 100, 1, [
      { produto_id: 1, quantidade: 1, unidade: 'L' },
      { produto_id: 4, quantidade: 20, unidade: 'KG' }
    ]);
    const ordem = await ordemEmProducao(db, 5, 100, 2);
    const antes = await all(db, 'SELECT id, estoque_atual FROM produtos ORDER BY id');
    await assert.rejects(() => executarProducao(db, ordem.id, { correlation_id: 'exec-falta' }), (err) => {
      assert.match(err.message, /Estoque insuficiente de .+ na Fábrica para executar esta produção\./);
      const chocolate = err.detalhes.find((item) => item.produto === 'Chocolate');
      assert.equal(chocolate.necessario, 20);
      assert.equal(chocolate.disponivel, 1);
      assert.equal(chocolate.faltante, 19);
      return true;
    });
    const depois = await all(db, 'SELECT id, estoque_atual FROM produtos ORDER BY id');
    assert.deepEqual(depois, antes);
    const atual = await get(db, 'SELECT status FROM ordens_producao WHERE id = ?', [ordem.id]);
    assert.equal(atual.status, 'EM_PRODUCAO');
  });

  it('9, 10, 11, 12, 14, 15, 16 e 36: validações bloqueiam sem movimentar', async () => {
    const antes = await get(db, 'SELECT COUNT(*) AS total FROM estoque_movimentacoes');
    await ficha(db, 3, 6, 100, 1, [{ produto_id: 1, quantidade: 1, unidade: 'L' }]);
    const comercial = await ordemAntiga(db, 6, 100, 3, 'Picolé comercial');
    await assert.rejects(() => executarProducao(db, comercial.id, { correlation_id: 'exec-comercial' }), (err) => err.message === MENSAGEM_PRODUTO);

    await ficha(db, 4, 5, 100, 1, [{ produto_id: 5, quantidade: 1, unidade: 'UN' }]);
    const naoInsumo = await ordemEmProducao(db, 5, 100, 4);
    await assert.rejects(() => executarProducao(db, naoInsumo.id, { correlation_id: 'exec-nao-insumo' }), (err) => err.message === MENSAGEM_NAO_INSUMO);

    await ficha(db, 5, 5, 100, 1, [{ produto_id: null, quantidade: 1, unidade: 'L' }]);
    const semProduto = await ordemEmProducao(db, 5, 100, 5);
    await assert.rejects(() => executarProducao(db, semProduto.id, { correlation_id: 'exec-sem-produto' }), (err) => err.message === MENSAGEM_SEM_PRODUTO);

    await ficha(db, 6, 5, 0, 1, [{ produto_id: 1, quantidade: 1, unidade: 'L' }]);
    const rendimento = await ordemEmProducao(db, 5, 100, 6);
    await assert.rejects(() => executarProducao(db, rendimento.id, { correlation_id: 'exec-rendimento' }), (err) => err.message === MENSAGEM_RENDIMENTO);

    await ficha(db, 7, 5, 100, 0, [{ produto_id: 1, quantidade: 1, unidade: 'L' }]);
    const inativa = await ordemEmProducao(db, 5, 100, 7);
    await assert.rejects(() => executarProducao(db, inativa.id, { correlation_id: 'exec-inativa' }), (err) => err.message === 'A Ficha Técnica está inativa.');

    const rascunho = await salvarOrdem(db, { origem: 'MANUAL', itens: [{ produto_id: 5, quantidade_planejada: 10, unidade: 'UN', ficha_tecnica_id: 1 }] });
    await assert.rejects(() => executarProducao(db, rascunho.id, { correlation_id: 'exec-rascunho' }), (err) => err.message === 'Esta ordem de produção não pode ser executada neste estado.');

    const cancelada = await ordemPlanejada(db, 5, 10, 1);
    await cancelarOrdem(db, cancelada.id);
    await assert.rejects(() => executarProducao(db, cancelada.id, { correlation_id: 'exec-cancelada' }), (err) => err.message === 'Esta ordem de produção não pode ser executada neste estado.');

    await ficha(db, 8, 7, 100, 1, [{ produto_id: 1, quantidade: 1, unidade: 'L' }]);
    const inativo = await ordemAntiga(db, 7, 10, 8, 'Picolé inativo');
    await assert.rejects(() => executarProducao(db, inativo.id, { correlation_id: 'exec-produto-inativo' }), (err) => err.message === 'O produto da Ordem de Produção está inativo.');

    await ficha(db, 12, 5, 100, 1, []);
    const semComponentes = await ordemEmProducao(db, 5, 10, 12);
    await assert.rejects(() => executarProducao(db, semComponentes.id, { correlation_id: 'exec-sem-comp' }), (err) => err.message === 'A Ficha Técnica não possui componentes.');

    await ficha(db, 13, 5, 100, 1, [{ produto_id: 1, quantidade: 0, unidade: 'L' }]);
    const quantidade = await ordemEmProducao(db, 5, 10, 13);
    await assert.rejects(() => executarProducao(db, quantidade.id, { correlation_id: 'exec-qtd' }), (err) => err.message === 'A Ficha Técnica possui componente com quantidade inválida.');

    const semFicha = await ordemEmProducao(db, 5, 10, null);
    await assert.rejects(() => executarProducao(db, semFicha.id, { correlation_id: 'exec-sem-ficha' }), (err) => err.message === 'A ordem não possui ficha técnica para produção.');

    const depois = await get(db, 'SELECT COUNT(*) AS total FROM estoque_movimentacoes');
    assert.equal(depois.total, antes.total);
  });

  it('13: unidade incompatível bloqueia', async () => {
    await ficha(db, 9, 5, 100, 1, [{ produto_id: 2, quantidade: 1, unidade: 'UN' }]);
    const ordem = await ordemEmProducao(db, 5, 100, 9);
    const antes = await get(db, 'SELECT estoque_atual FROM produtos WHERE id = 2');
    await assert.rejects(() => executarProducao(db, ordem.id, { correlation_id: 'exec-unidade' }), (err) => err.code === 'UNIDADE_INCOMPATIVEL');
    const depois = await get(db, 'SELECT estoque_atual FROM produtos WHERE id = 2');
    assert.equal(depois.estoque_atual, antes.estoque_atual);
  });

  it('14 conversão oficial: litro da ficha baixa mililitro do estoque', async () => {
    await ficha(db, 10, 5, 100, 1, [{ produto_id: 8, quantidade: 1, unidade: 'L' }]);
    const ordem = await ordemEmProducao(db, 5, 100, 10);
    await executarProducao(db, ordem.id, { correlation_id: 'exec-ml' });
    const leite = await get(db, 'SELECT estoque_atual, unidade FROM produtos WHERE id = 8');
    assert.equal(leite.unidade, 'ML');
    assert.equal(leite.estoque_atual, 24000);
  });

  it('17 e 18: concluída e a mesma chave não produzem de novo', async () => {
    const ordem = await get(db, 'SELECT id FROM ordens_producao ORDER BY id LIMIT 1');
    const antes = await get(db, 'SELECT COUNT(*) AS total FROM estoque_movimentacoes');
    await assert.rejects(() => executarProducao(db, ordem.id, { correlation_id: 'exec-outra' }), (err) => err.message === MENSAGEM_CONCLUIDA);
    const repetida = await executarProducao(db, ordem.id, { correlation_id: 'exec-1' });
    assert.equal(repetida.repetida, true);
    const depois = await get(db, 'SELECT COUNT(*) AS total FROM estoque_movimentacoes');
    assert.equal(depois.total, antes.total);
    await assert.rejects(() => cancelarOrdem(db, ordem.id), (err) => err.message === 'A Ordem de Produção já foi concluída e não pode ser cancelada.');
  });

  it('19: falha no meio desfaz a baixa', async () => {
    await run(db, 'UPDATE produtos SET estoque_atual = 30, saldo_fiscal = 30 WHERE id = 1');
    await run(db, `UPDATE estoque_saldos_locais SET saldo_fiscal = 30, estoque_atual = 30 WHERE produto_id = 1 AND local = 'FABRICA'`);
    await ficha(db, 11, 5, 100, 1, [{ produto_id: 1, quantidade: 10, unidade: 'L' }]);
    const ordem = await ordemEmProducao(db, 5, 100, 11);
    const picoleAntes = await get(db, 'SELECT estoque_atual FROM produtos WHERE id = 5');
    await assert.rejects(() => executarProducao(db, ordem.id, { correlation_id: 'exec-quebra' }, {
      aposConsumo() { throw new Error('falha simulada'); }
    }));
    const leite = await get(db, 'SELECT estoque_atual FROM produtos WHERE id = 1');
    const picole = await get(db, 'SELECT estoque_atual FROM produtos WHERE id = 5');
    const atual = await get(db, 'SELECT status FROM ordens_producao WHERE id = ?', [ordem.id]);
    const execucao = await get(db, 'SELECT id FROM ordem_producao_execucoes WHERE correlation_id = ?', ['exec-quebra']);
    assert.equal(leite.estoque_atual, 30);
    const leiteFabrica = await get(db, `SELECT estoque_atual FROM estoque_saldos_locais WHERE produto_id = 1 AND local = 'FABRICA'`);
    assert.equal(leiteFabrica.estoque_atual, 30);
    assert.equal(picole.estoque_atual, picoleAntes.estoque_atual);
    assert.equal(atual.status, 'EM_PRODUCAO');
    assert.equal(execucao, undefined);
  });

  it('20, 21, 22 e 24: sem financeiro, na fábrica e sem produção parcial', async () => {
    const fonte = fs.readFileSync(path.join(__dirname, '../../backend/modules/fabrica-loja/ProducaoExecucaoService.js'), 'utf8');
    const legado = fs.readFileSync(path.join(__dirname, '../../backend/lib/entradaProducaoPropria.js'), 'utf8');
    assert.equal(fonte.includes('MotorEstoque.sair'), true);
    assert.equal(fonte.includes('MotorEstoque.entrar'), true);
    assert.equal(fonte.includes('consultarSaldoLocal'), true);
    assert.equal(fonte.includes("local: LOCAL_CONSUMO"), true);
    assert.equal(fonte.includes('consultarSaldo('), false);
    assert.equal(fonte.includes('UPDATE produtos SET estoque'), false);
    assert.equal(fonte.includes('contas_receber'), false);
    assert.equal(fonte.includes('contas_pagar'), false);
    assert.equal(legado.includes('PRODUCAO_PROPRIA'), true);
    const ordem = await ordemEmProducao(db, 5, 500, 1);
    await assert.rejects(() => executarProducao(db, ordem.id, { correlation_id: 'exec-parcial', quantidade_produzida: 300 }), (err) => err.message === MENSAGEM_RESULTADO);
    const atual = await get(db, 'SELECT status FROM ordens_producao WHERE id = ?', [ordem.id]);
    assert.equal(atual.status, 'EM_PRODUCAO');
  });
});
