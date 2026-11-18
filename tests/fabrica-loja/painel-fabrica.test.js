/**
 * Painel operacional da fábrica. Banco temporário. Não usa o banco oficial.
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
const { salvarNecessidade } = require('../../backend/modules/fabrica-loja/NecessidadeProducaoService');
const { salvarOrdem, planejarOrdem, cancelarOrdem } = require('../../backend/modules/fabrica-loja/OrdemProducaoService');
const { executarProducao, iniciarProducao } = require('../../backend/modules/fabrica-loja/ProducaoExecucaoService');
const { salvarTransferencia, confirmarTransferencia } = require('../../backend/modules/fabrica-loja/TransferenciaEstoqueService');
const { consultarPainelFabrica } = require('../../backend/modules/fabrica-loja/PainelFabricaService');

const dir = path.join(os.tmpdir(), 'cds-fabrica-loja-testes');
fs.mkdirSync(dir, { recursive: true });
const arquivo = path.join(dir, 'painel-fabrica.db');
for (const sufixo of ['', '-wal', '-shm']) fs.rmSync(arquivo + sufixo, { force: true });

function abrir() { return new sqlite3.Database(arquivo); }
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

describe('Painel operacional da fábrica', () => {
  let db;
  const fichas = {};
  let movimentos = 0;

  before(async () => {
    db = abrir();
    await run(db, `
      CREATE TABLE produtos (
        id INTEGER PRIMARY KEY, nome TEXT, unidade TEXT,
        estoque_atual REAL DEFAULT 0, saldo_fiscal REAL DEFAULT 0, saldo_nao_fiscal REAL DEFAULT 0,
        natureza_cadastro TEXT, ativo INTEGER DEFAULT 1, controlar_validade INTEGER DEFAULT 0, updated_at TEXT
      )
    `);
    await run(db, `INSERT INTO produtos (id, nome, unidade, natureza_cadastro, estoque_atual) VALUES
      (1, 'Picolé Morango', 'UN', 'PRODUZIDO', 0),
      (2, 'Picolé Chocolate', 'UN', 'PRODUZIDO', 0),
      (3, 'Picolé Abacaxi', 'UN', 'PRODUZIDO', 0),
      (7, 'Picolé Loja', 'UN', 'PRODUZIDO', 0),
      (8, 'Picolé Global', 'UN', 'PRODUZIDO', 77),
      (9, 'Leite', 'UN', 'INSUMO', 0)`);
    await MotorEstoque.bootstrapMotorEstoqueSchema(db);
    await MotorEstoque.entrar(db, { produtoId: 9, quantidadeBase: 50000, origem: 'COMPRA', local: 'FABRICA' });
    await MotorEstoque.entrar(db, { produtoId: 7, quantidadeBase: 30, origem: 'AJUSTE_MANUAL', local: 'LOJA' });
    await run(db, `UPDATE produtos SET estoque_atual = 9999, saldo_fiscal = 9999 WHERE id = 9`);
    const contagem = await get(db, 'SELECT COUNT(*) AS total FROM estoque_movimentacoes');
    movimentos = Number(contagem.total);
    for (const [id, nome] of [[1, 'Morango'], [2, 'Chocolate'], [3, 'Abacaxi']]) {
      const ficha = await salvarFicha(db, {
        codigo: 'FT-PF-' + id,
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

  async function necessidade(descricao, produtoId, quantidade) {
    return salvarNecessidade(db, {
      origem: 'MANUAL',
      descricao,
      itens: [{
        produto_id: produtoId,
        descricao,
        quantidade,
        unidade: 'UN',
        ficha_tecnica_id: fichas[produtoId]
      }]
    });
  }

  async function produzir(necessidadeId, itemId, produtoId, planejada, produzida, perdida, chave) {
    const ordem = await salvarOrdem(db, {
      necessidade_id: necessidadeId,
      itens: [{
        necessidade_item_id: itemId,
        produto_id: produtoId,
        quantidade_planejada: planejada,
        unidade: 'UN',
        ficha_tecnica_id: fichas[produtoId]
      }]
    });
    await planejarOrdem(db, ordem.id);
    if (produzida == null) return ordem;
    await iniciarProducao(db, ordem.id);
    await executarProducao(db, ordem.id, {
      correlation_id: chave,
      quantidade_produzida: produzida,
      quantidade_perdida: perdida || 0
    });
    return ordem;
  }

  it('1 a 7. resumo, pendências, produção real e perda', async () => {
    const aberta = await necessidade('Aberta', 1, 500);
    const parcial = await necessidade('Parcial', 1, 100);
    const ordemParcial = await produzir(parcial.id, parcial.itens[0].id, 1, 100, 40, 60, 'pf-parcial');
    const atendida = await necessidade('Atendida', 2, 20);
    await produzir(atendida.id, atendida.itens[0].id, 2, 20, 20, 0, 'pf-atendida');
    const planejada = await necessidade('Planejada', 3, 80);
    const ordemPlanejada = await produzir(planejada.id, planejada.itens[0].id, 3, 80, null);
    const cancelada = await necessidade('Com OP cancelada', 3, 10);
    const ordemCancelada = await salvarOrdem(db, {
      necessidade_id: cancelada.id,
      itens: [{ necessidade_item_id: cancelada.itens[0].id, produto_id: 3, quantidade_planejada: 10, unidade: 'UN' }]
    });
    await planejarOrdem(db, ordemCancelada.id);
    await cancelarOrdem(db, ordemCancelada.id);

    const antes = await get(db, 'SELECT COUNT(*) AS total FROM estoque_movimentacoes');
    const painel = await consultarPainelFabrica(db, { periodo: 'hoje' });
    const depois = await get(db, 'SELECT COUNT(*) AS total FROM estoque_movimentacoes');
    assert.equal(Number(depois.total), Number(antes.total));

    assert.equal(painel.resumo.necessidades_abertas, 3);
    assert.equal(painel.resumo.necessidades_parciais, 1);
    assert.equal(painel.resumo.necessidades_atendidas, 1);
    assert.equal(painel.resumo.ops_planejadas, 1);
    assert.equal(painel.resumo.ops_em_producao, 0);
    assert.equal(painel.resumo.ops_canceladas, 1);
    assert.equal(painel.resumo.produzido, 60);
    assert.equal(painel.resumo.perdido, 60);
    assert.equal(painel.resumo.execucoes, 2);
    assert.equal(painel.resumo.ops_concluidas_periodo, 2);
    assert.notEqual(painel.resumo.produzido, 100);

    const codigos = painel.necessidades_pendentes.map((item) => item.codigo);
    assert.equal(codigos.includes(aberta.codigo), true);
    assert.equal(codigos.includes(parcial.codigo), true);
    assert.equal(codigos.includes(atendida.codigo), false);
    const abertaPainel = painel.necessidades_pendentes.find((item) => item.codigo === aberta.codigo);
    assert.equal(abertaPainel.produzido, 0);
    assert.equal(abertaPainel.restante, 500);
    assert.equal(abertaPainel.status, 'ABERTA');
    const parcialPainel = painel.necessidades_pendentes.find((item) => item.codigo === parcial.codigo);
    assert.equal(parcialPainel.produzido, 40);
    assert.equal(parcialPainel.restante, 60);
    assert.equal(parcialPainel.status, 'PARCIALMENTE_ATENDIDA');

    assert.equal(painel.ordens_pendentes.some((item) => item.codigo === ordemPlanejada.codigo), true);
    assert.equal(painel.ordens_pendentes.some((item) => item.codigo === ordemCancelada.codigo), false);
    const abaixo = painel.ordens_abaixo.find((item) => item.codigo === ordemParcial.codigo);
    assert.equal(abaixo.planejado, 100);
    assert.equal(abaixo.produzido, 40);
    assert.equal(abaixo.perdido, 60);
    assert.ok(movimentos > 0);
  });

  it('8. estoque usa o saldo local da fábrica', async () => {
    const painel = await consultarPainelFabrica(db, {});
    const leite = painel.estoque_fabrica.itens_insumo.find((item) => item.produto_id === 9);
    const local = await get(db, `SELECT estoque_atual FROM estoque_saldos_locais WHERE produto_id = 9 AND local = 'FABRICA'`);
    assert.equal(leite.quantidade, Number(local.estoque_atual));
    assert.notEqual(leite.quantidade, 9999);
    assert.equal(painel.estoque_fabrica.itens_insumo.some((item) => item.produto_id === 8), false);
    assert.equal(painel.estoque_fabrica.itens_produzido.some((item) => item.produto_id === 8), false);
    assert.equal(painel.estoque_fabrica.itens_produzido.some((item) => item.produto_id === 7), false);
    assert.equal(painel.estoque_fabrica.local, 'FABRICA');
    assert.ok(painel.estoque_fabrica.insumos >= 1);
    assert.ok(painel.estoque_fabrica.produzidos >= 1);
  });

  it('9. transferência em rascunho fica pendente', async () => {
    const rascunho = await salvarTransferencia(db, {
      itens: [{ produto_id: 2, quantidade: 5, unidade: 'UN' }]
    });
    const confirmada = await salvarTransferencia(db, {
      itens: [{ produto_id: 2, quantidade: 5, unidade: 'UN' }]
    });
    await confirmarTransferencia(db, confirmada.id, { correlation_id: 'pf-trf-1' });
    const painel = await consultarPainelFabrica(db, { periodo: 'hoje' });
    assert.equal(painel.transferencias_pendentes.some((item) => item.id === rascunho.id && item.status === 'RASCUNHO'), true);
    assert.equal(painel.transferencias_pendentes.some((item) => item.id === confirmada.id), false);
    assert.equal(painel.transferencias_recentes.some((item) => item.id === confirmada.id), true);
    assert.ok(painel.transferencias.rascunhos >= 1);
    assert.ok(painel.atencoes.some((item) => item.tipo === 'TRANSFERENCIA'));
  });

  it('10. a navegação aponta para as telas existentes', async () => {
    const painel = await consultarPainelFabrica(db, {});
    assert.deepEqual(painel.destinos, {
      necessidade: 'necessidades-producao',
      ordem: 'ordens-producao',
      transferencia: 'transferencias',
      estoque: 'produtos'
    });
    assert.equal(painel.necessidades_pendentes[0].destino, 'necessidades-producao');
    assert.equal(painel.ordens_pendentes[0].destino, 'ordens-producao');
    assert.equal(painel.transferencias_pendentes[0].destino, 'transferencias');
    const fonte = fs.readFileSync(path.join(__dirname, '../../frontend/erp/js/painel-fabrica.js'), 'utf8');
    assert.equal(fonte.includes("_npAbrirId"), true);
    assert.equal(fonte.includes("_opAbrirId"), true);
    assert.equal(fonte.includes("_trfAbrirId"), true);
    assert.equal(fonte.includes("pfIr('necessidades-producao')"), true);
    assert.equal(fonte.includes("pfIr('ordens-producao')"), true);
    assert.equal(fonte.includes("pfIr('transferencias')"), true);
    assert.equal(fonte.includes("pfIr('produtos')"), true);
  });

  it('11. produção de vários produtos soma cada execução', async () => {
    const criada = await salvarNecessidade(db, {
      origem: 'MANUAL',
      descricao: 'Dois produtos',
      itens: [
        { produto_id: 1, descricao: 'Picolé Morango', quantidade: 10, unidade: 'UN', ficha_tecnica_id: fichas[1] },
        { produto_id: 2, descricao: 'Picolé Chocolate', quantidade: 15, unidade: 'UN', ficha_tecnica_id: fichas[2] }
      ]
    });
    const ordem = await salvarOrdem(db, {
      necessidade_id: criada.id,
      itens: criada.itens.map((item) => ({
        necessidade_item_id: item.id,
        produto_id: item.produto_id,
        quantidade_planejada: item.quantidade,
        unidade: 'UN',
        ficha_tecnica_id: fichas[item.produto_id]
      }))
    });
    await planejarOrdem(db, ordem.id);
    await iniciarProducao(db, ordem.id);
    await executarProducao(db, ordem.id, { correlation_id: 'pf-multi' });
    const painel = await consultarPainelFabrica(db, { periodo: 'hoje' });
    const morango = painel.producao_produtos.find((item) => item.produto_id === 1);
    const chocolate = painel.producao_produtos.find((item) => item.produto_id === 2);
    assert.ok(morango.produzido >= 10);
    assert.ok(chocolate.produzido >= 15);
    assert.ok(painel.resumo.produzido >= 60 + 10 + 15);
  });

  it('recusa período inválido', async () => {
    await assert.rejects(
      () => consultarPainelFabrica(db, { periodo: 'ano' }),
      (err) => err.code === 'PERIODO_INVALIDO'
    );
  });
});
