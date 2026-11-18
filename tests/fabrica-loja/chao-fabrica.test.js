/**
 * P3.1 — chão de fábrica. Banco temporário. Não usa o banco oficial.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const MotorEstoque = require('../../backend/motores/motor-estoque');
const { bootstrapFabricaLojaSchema } = require('../../backend/modules/fabrica-loja');
const { salvarFicha } = require('../../backend/modules/fabrica-loja/FichaTecnicaService');
const { salvarNecessidade, obterNecessidade } = require('../../backend/modules/fabrica-loja/NecessidadeProducaoService');
const { salvarOrdem, planejarOrdem, cancelarOrdem, obterOrdem } = require('../../backend/modules/fabrica-loja/OrdemProducaoService');
const {
  iniciarProducao,
  executarProducao,
  MENSAGEM_JA_INICIADA
} = require('../../backend/modules/fabrica-loja/ProducaoExecucaoService');
const { consultarPainelFabrica } = require('../../backend/modules/fabrica-loja/PainelFabricaService');

const dir = path.join(os.tmpdir(), 'cds-fabrica-loja-testes');
fs.mkdirSync(dir, { recursive: true });
const arquivo = path.join(dir, 'chao-fabrica.db');
for (const sufixo of ['', '-wal', '-shm']) fs.rmSync(arquivo + sufixo, { force: true });

function abrir() {
  const db = new sqlite3.Database(arquivo);
  db.configure('busyTimeout', 8000);
  return db;
}
function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) { err ? reject(err) : resolve(this); });
  });
}
function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}
function fechar(db) {
  return new Promise((resolve, reject) => db.close((err) => (err ? reject(err) : resolve())));
}

describe('P3.1 chão de fábrica', () => {
  let db;
  const fichas = {};

  before(async () => {
    db = abrir();
    await run(db, 'PRAGMA journal_mode = WAL');
    await run(db, `
      CREATE TABLE produtos (
        id INTEGER PRIMARY KEY, nome TEXT, unidade TEXT,
        estoque_atual REAL DEFAULT 0, saldo_fiscal REAL DEFAULT 0, saldo_nao_fiscal REAL DEFAULT 0,
        natureza_cadastro TEXT, ativo INTEGER DEFAULT 1, controlar_validade INTEGER DEFAULT 0,
        updated_at TEXT, preco_compra REAL
      )
    `);
    await run(db, `INSERT INTO produtos (id, nome, unidade, natureza_cadastro) VALUES
      (1, 'Leite', 'L', 'INSUMO'),
      (2, 'Chocolate', 'KG', 'INSUMO'),
      (3, 'Palito', 'UN', 'INSUMO'),
      (4, 'Picolé Chocolate', 'UN', 'PRODUZIDO'),
      (5, 'Picolé Morango', 'UN', 'PRODUZIDO'),
      (6, 'Picolé Abacaxi', 'UN', 'PRODUZIDO'),
      (7, 'Leite escasso', 'L', 'INSUMO'),
      (8, 'Picolé sem estoque', 'UN', 'PRODUZIDO')`);
    await bootstrapFabricaLojaSchema(db);
    await MotorEstoque.bootstrapMotorEstoqueSchema(db);
    await MotorEstoque.entrar(db, { produtoId: 1, quantidadeBase: 10000, origem: 'COMPRA', local: 'FABRICA' });
    await MotorEstoque.entrar(db, { produtoId: 2, quantidadeBase: 10000, origem: 'COMPRA', local: 'FABRICA' });
    await MotorEstoque.entrar(db, { produtoId: 3, quantidadeBase: 10000, origem: 'COMPRA', local: 'FABRICA' });
    await MotorEstoque.entrar(db, { produtoId: 7, quantidadeBase: 5, origem: 'COMPRA', local: 'FABRICA' });
    await MotorEstoque.entrar(db, { produtoId: 1, quantidadeBase: 40, origem: 'AJUSTE_MANUAL', local: 'LOJA' });
    for (const item of [
      [4, 'Chocolate', [{ produto_id: 1, quantidade: 20, unidade: 'L' }, { produto_id: 2, quantidade: 5, unidade: 'KG' }, { produto_id: 3, quantidade: 100, unidade: 'UN' }]],
      [5, 'Morango', [{ produto_id: 1, quantidade: 20, unidade: 'L' }]],
      [6, 'Abacaxi', [{ produto_id: 1, quantidade: 10, unidade: 'L' }]],
      [8, 'Sem estoque', [{ produto_id: 7, quantidade: 20, unidade: 'L' }]]
    ]) {
      const ficha = await salvarFicha(db, {
        codigo: 'FT-P31-' + item[0],
        nome: 'Ficha ' + item[1],
        produto_id: item[0],
        rendimento_quantidade: 100,
        rendimento_unidade: 'UN',
        componentes: item[2]
      });
      fichas[item[0]] = ficha.id;
    }
  });

  after(() => db && db.close());

  async function movimentos() {
    const row = await get(db, 'SELECT COUNT(*) AS total FROM estoque_movimentacoes');
    return Number(row.total);
  }

  async function planejada(produtoId, quantidade) {
    const criada = await salvarOrdem(db, {
      origem: 'MANUAL',
      itens: [{ produto_id: produtoId, quantidade_planejada: quantidade, unidade: 'UN', ficha_tecnica_id: fichas[produtoId] }]
    });
    return planejarOrdem(db, criada.id);
  }

  it('1. iniciar produção não movimenta estoque', async () => {
    const ordem = await planejada(4, 500);
    const antes = await movimentos();
    const iniciada = await iniciarProducao(db, ordem.id, { usuario_nome: 'Operador' });
    assert.equal(iniciada.status, 'EM_PRODUCAO');
    assert.ok(iniciada.producao_iniciada_em);
    assert.equal(iniciada.producao_usuario_nome, 'Operador');
    assert.equal(await movimentos(), antes);
    const execucoes = await get(db, 'SELECT COUNT(*) AS total FROM ordem_producao_execucoes WHERE ordem_id = ?', [ordem.id]);
    assert.equal(Number(execucoes.total), 0);
  });

  it('2. rascunho não inicia', async () => {
    const criada = await salvarOrdem(db, {
      origem: 'MANUAL',
      itens: [{ produto_id: 4, quantidade_planejada: 10, unidade: 'UN', ficha_tecnica_id: fichas[4] }]
    });
    await assert.rejects(() => iniciarProducao(db, criada.id), (err) => err.message === 'Esta ordem de produção não pode ser executada neste estado.');
  });

  it('3. cancelada não inicia', async () => {
    const ordem = await planejada(4, 10);
    await cancelarOrdem(db, ordem.id);
    await assert.rejects(() => iniciarProducao(db, ordem.id), (err) => err.message === 'Esta ordem de produção não pode ser executada neste estado.');
  });

  it('4. finalizar em produção consome, produz, perde e conclui', async () => {
    const ordem = await planejada(4, 100);
    await iniciarProducao(db, ordem.id);
    const leiteAntes = await MotorEstoque.consultarSaldoLocal(db, 1, 'FABRICA');
    const resultado = await executarProducao(db, ordem.id, {
      correlation_id: 'p31-finalizar-100',
      quantidade_produzida: 90,
      quantidade_perdida: 10,
      motivo_perda: 'Falha no processo'
    });
    assert.equal(resultado.ordem.status, 'CONCLUIDA');
    assert.equal(resultado.execucao.quantidade_produzida, 90);
    assert.equal(resultado.execucao.quantidade_perdida, 10);
    const leite = await MotorEstoque.consultarSaldoLocal(db, 1, 'FABRICA');
    const produto = await MotorEstoque.consultarSaldoLocal(db, 4, 'FABRICA');
    assert.equal(leite.estoqueAtual, leiteAntes.estoqueAtual - 20);
    assert.equal(produto.estoqueAtual, 90);
  });

  it('5. estoque insuficiente não movimenta nem conclui', async () => {
    const bloqueada = await planejada(8, 100);
    const antes = await movimentos();
    await assert.rejects(() => iniciarProducao(db, bloqueada.id), (err) => /Estoque insuficiente de Leite escasso/.test(err.message));
    assert.equal((await obterOrdem(db, bloqueada.id)).status, 'PLANEJADA');
    assert.equal(await movimentos(), antes);

    const ordem = await planejada(4, 100);
    await iniciarProducao(db, ordem.id);
    await run(db, `UPDATE estoque_saldos_locais SET estoque_atual = 0, saldo_fiscal = 0 WHERE produto_id = 1 AND local = 'FABRICA'`);
    const noMeio = await movimentos();
    await assert.rejects(() => executarProducao(db, ordem.id, { correlation_id: 'p31-sem-estoque' }), (err) => /Estoque insuficiente de Leite/.test(err.message));
    assert.equal((await obterOrdem(db, ordem.id)).status, 'EM_PRODUCAO');
    assert.equal(await movimentos(), noMeio);
    await run(db, `UPDATE estoque_saldos_locais SET estoque_atual = 9000, saldo_fiscal = 9000 WHERE produto_id = 1 AND local = 'FABRICA'`);
    await run(db, `UPDATE produtos SET estoque_atual = 9000, saldo_fiscal = 9000 WHERE id = 1`);
  });

  it('6. dois inícios simultâneos: somente um efetiva', async () => {
    const ordem = await planejada(4, 50);
    const a = abrir();
    const b = abrir();
    const resultados = await Promise.allSettled([
      iniciarProducao(a, ordem.id),
      iniciarProducao(b, ordem.id)
    ]);
    await fechar(a);
    await fechar(b);
    const ok = resultados.filter((item) => item.status === 'fulfilled');
    const falha = resultados.filter((item) => item.status === 'rejected');
    assert.equal(ok.length, 1);
    assert.equal(falha.length, 1);
    assert.equal(falha[0].reason.message, MENSAGEM_JA_INICIADA);
    assert.equal((await obterOrdem(db, ordem.id)).status, 'EM_PRODUCAO');
  });

  it('7. duas finalizações simultâneas movimentam o estoque uma vez', async () => {
    const ordem = await planejada(4, 50);
    await iniciarProducao(db, ordem.id);
    const antes = await movimentos();
    const a = abrir();
    const b = abrir();
    const resultados = await Promise.allSettled([
      executarProducao(a, ordem.id, { correlation_id: 'p31-corrida-a', quantidade_produzida: 50, quantidade_perdida: 0 }),
      executarProducao(b, ordem.id, { correlation_id: 'p31-corrida-b', quantidade_produzida: 50, quantidade_perdida: 0 })
    ]);
    await fechar(a);
    await fechar(b);
    const ok = resultados.filter((item) => item.status === 'fulfilled');
    assert.equal(ok.length, 1);
    assert.equal(resultados.filter((item) => item.status === 'rejected').length, 1);
    const depois = await movimentos();
    assert.ok(depois > antes);
    const entradas = await get(db, `
      SELECT COALESCE(SUM(quantidade_base), 0) AS total
      FROM estoque_movimentacoes
      WHERE produto_id = 4 AND operacao = 'ENTRADA' AND origem = 'PRODUCAO' AND referencia_id = ?
    `, [ok[0].value.execucao.id]);
    assert.equal(Number(entradas.total), 50);
  });

  it('8. a mesma chave de execução não duplica movimentação', async () => {
    const ordem = await planejada(4, 20);
    await iniciarProducao(db, ordem.id);
    const primeira = await executarProducao(db, ordem.id, { correlation_id: 'p31-idem-20', quantidade_produzida: 20, quantidade_perdida: 0 });
    const antes = await movimentos();
    const segunda = await executarProducao(db, ordem.id, { correlation_id: 'p31-idem-20', quantidade_produzida: 20, quantidade_perdida: 0 });
    assert.equal(segunda.repetida, true);
    assert.equal(segunda.execucao.id, primeira.execucao.id);
    assert.equal(await movimentos(), antes);
  });

  it('9. ordem em produção permanece após reabrir o banco', async () => {
    const ordem = await planejada(4, 15);
    const iniciada = await iniciarProducao(db, ordem.id);
    await fechar(db);
    db = abrir();
    const reaberta = await obterOrdem(db, ordem.id);
    assert.equal(reaberta.status, 'EM_PRODUCAO');
    assert.equal(reaberta.producao_iniciada_em, iniciada.producao_iniciada_em);
    const execucoes = await get(db, 'SELECT COUNT(*) AS total FROM ordem_producao_execucoes WHERE ordem_id = ?', [ordem.id]);
    assert.equal(Number(execucoes.total), 0);
  });

  it('10. produção parcial calcula rendimento de 94%', async () => {
    const ordem = await planejada(4, 500);
    await iniciarProducao(db, ordem.id);
    const resultado = await executarProducao(db, ordem.id, {
      correlation_id: 'p31-rendimento-500',
      quantidade_produzida: 470,
      quantidade_perdida: 30,
      motivo_perda: 'Falha no processo',
      observacao_perda: 'Lote apresentou problema de textura.'
    });
    assert.equal(resultado.ordem.status, 'CONCLUIDA');
    assert.equal(resultado.execucao.rendimento_real, 94);
    assert.equal(resultado.execucao.quantidade_produzida, 470);
    assert.equal(resultado.execucao.quantidade_perdida, 30);
    const produto = await MotorEstoque.consultarSaldoLocal(db, 4, 'FABRICA');
    assert.ok(produto.estoqueAtual >= 470);
  });

  it('11. produção zero consome insumo e não entra produto', async () => {
    const ordem = await planejada(4, 10);
    await iniciarProducao(db, ordem.id);
    const antes = await MotorEstoque.consultarSaldoLocal(db, 4, 'FABRICA');
    const resultado = await executarProducao(db, ordem.id, {
      correlation_id: 'p31-zero',
      quantidade_produzida: 0,
      quantidade_perdida: 10,
      motivo_perda: 'Perda total'
    });
    assert.equal(resultado.ordem.status, 'CONCLUIDA');
    assert.equal(resultado.execucao.quantidade_produzida, 0);
    const depois = await MotorEstoque.consultarSaldoLocal(db, 4, 'FABRICA');
    assert.equal(depois.estoqueAtual, antes.estoqueAtual);
    const entrada = await get(db, `
      SELECT COUNT(*) AS total FROM estoque_movimentacoes
      WHERE produto_id = 4 AND referencia_id = ? AND operacao = 'ENTRADA'
    `, [resultado.execucao.id]);
    assert.equal(Number(entrada.total), 0);
  });

  it('12. produção multi-item registra cada produto', async () => {
    const criada = await salvarOrdem(db, {
      origem: 'MANUAL',
      itens: [
        { produto_id: 5, quantidade_planejada: 500, unidade: 'UN', ficha_tecnica_id: fichas[5] },
        { produto_id: 4, quantidade_planejada: 300, unidade: 'UN', ficha_tecnica_id: fichas[4] },
        { produto_id: 6, quantidade_planejada: 200, unidade: 'UN', ficha_tecnica_id: fichas[6] }
      ]
    });
    const ordem = await planejarOrdem(db, criada.id);
    await iniciarProducao(db, ordem.id);
    const resultado = await executarProducao(db, ordem.id, {
      correlation_id: 'p31-multi',
      itens: [
        { produto_id: 5, quantidade_produzida: 480, quantidade_perdida: 20 },
        { produto_id: 4, quantidade_produzida: 300, quantidade_perdida: 0 },
        { produto_id: 6, quantidade_produzida: 190, quantidade_perdida: 10 }
      ]
    });
    const produzidos = resultado.execucao.snapshot.produzidos;
    assert.equal(produzidos.find((item) => item.produto_id === 5).quantidade_produzida, 480);
    assert.equal(produzidos.find((item) => item.produto_id === 4).quantidade_produzida, 300);
    assert.equal(produzidos.find((item) => item.produto_id === 6).quantidade_produzida, 190);
    const produzido = produzidos.reduce((soma, item) => soma + item.quantidade_produzida, 0);
    const perdido = produzidos.reduce((soma, item) => soma + item.quantidade_perdida, 0);
    assert.equal(produzido, 970);
    assert.equal(perdido, 30);
  });

  it('13. consumo multi-item consolida o mesmo insumo', async () => {
    const criada = await salvarOrdem(db, {
      origem: 'MANUAL',
      itens: [
        { produto_id: 5, quantidade_planejada: 500, unidade: 'UN', ficha_tecnica_id: fichas[5] },
        { produto_id: 6, quantidade_planejada: 300, unidade: 'UN', ficha_tecnica_id: fichas[6] }
      ]
    });
    const ordem = await planejarOrdem(db, criada.id);
    const leiteAntes = await MotorEstoque.consultarSaldoLocal(db, 1, 'FABRICA');
    await iniciarProducao(db, ordem.id);
    await executarProducao(db, ordem.id, { correlation_id: 'p31-consumo-multi' });
    const leite = await MotorEstoque.consultarSaldoLocal(db, 1, 'FABRICA');
    assert.equal(leite.estoqueAtual, leiteAntes.estoqueAtual - 130);
  });

  it('14. execução usa a fábrica e não a loja', async () => {
    const ordem = await planejada(6, 100);
    const lojaAntes = await MotorEstoque.consultarSaldoLocal(db, 1, 'LOJA');
    const fabricaAntes = await MotorEstoque.consultarSaldoLocal(db, 1, 'FABRICA');
    const produtoAntes = await MotorEstoque.consultarSaldoLocal(db, 6, 'FABRICA');
    await iniciarProducao(db, ordem.id);
    await executarProducao(db, ordem.id, { correlation_id: 'p31-local', quantidade_produzida: 100, quantidade_perdida: 0 });
    const loja = await MotorEstoque.consultarSaldoLocal(db, 1, 'LOJA');
    const fabrica = await MotorEstoque.consultarSaldoLocal(db, 6, 'FABRICA');
    const fabricaInsumo = await MotorEstoque.consultarSaldoLocal(db, 1, 'FABRICA');
    assert.equal(loja.estoqueAtual, lojaAntes.estoqueAtual);
    assert.equal(fabrica.estoqueAtual, produtoAntes.estoqueAtual + 100);
    assert.equal(fabricaInsumo.estoqueAtual, fabricaAntes.estoqueAtual - 10);
  });

  it('15. necessidade só conta produção efetiva', async () => {
    const necessidade = await salvarNecessidade(db, {
      origem: 'MANUAL',
      descricao: 'P3.1',
      itens: [{ produto_id: 6, descricao: 'Picolé Abacaxi', quantidade: 1000, unidade: 'UN' }]
    });
    const criada = await salvarOrdem(db, {
      origem: 'MANUAL',
      necessidade_id: necessidade.id,
      itens: [{
        necessidade_item_id: necessidade.itens[0].id,
        produto_id: 6,
        quantidade_planejada: 500,
        unidade: 'UN',
        ficha_tecnica_id: fichas[6]
      }]
    });
    const ordem = await planejarOrdem(db, criada.id);
    await iniciarProducao(db, ordem.id);
    const andamento = await obterNecessidade(db, necessidade.id);
    assert.equal(andamento.status, 'ABERTA');
    assert.equal(andamento.atendimento.itens[0].produzido, 0);
    assert.equal(andamento.atendimento.itens[0].planejado, 500);
    await executarProducao(db, ordem.id, {
      correlation_id: 'p31-necessidade',
      quantidade_produzida: 470,
      quantidade_perdida: 30
    });
    const atendida = await obterNecessidade(db, necessidade.id);
    assert.equal(atendida.atendimento.itens[0].produzido, 470);
    assert.equal(atendida.atendimento.itens[0].restante, 530);
    assert.equal(atendida.status, 'PARCIALMENTE_ATENDIDA');
  });

  it('16. finalizar produção não cria transferência', async () => {
    const antes = await get(db, 'SELECT COUNT(*) AS total FROM transferencias_estoque');
    const ordem = await planejada(6, 20);
    await iniciarProducao(db, ordem.id);
    await executarProducao(db, ordem.id, { correlation_id: 'p31-sem-transferencia', quantidade_produzida: 20, quantidade_perdida: 0 });
    const depois = await get(db, 'SELECT COUNT(*) AS total FROM transferencias_estoque');
    assert.equal(Number(depois.total), Number(antes.total));
  });

  it('17. ordem em produção aparece no painel', async () => {
    const ordem = await planejada(5, 40);
    await iniciarProducao(db, ordem.id);
    const painel = await consultarPainelFabrica(db, { periodo: 'hoje' });
    assert.ok(painel.resumo.ops_em_producao >= 1);
    assert.ok(painel.ordens_pendentes.some((item) => item.status === 'EM_PRODUCAO'));
  });
});
