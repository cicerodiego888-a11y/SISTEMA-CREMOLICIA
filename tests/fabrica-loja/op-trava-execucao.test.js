/**
 * OP 03 — a execução física da produção só acontece com a OP EM_PRODUCAO.
 * Serviço e rota POST /ordens-producao/:id/executar sobre banco temporário. Não usa o banco oficial.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const express = require('express');
const { salvarOrdem, planejarOrdem, cancelarOrdem, obterOrdem } = require('../../backend/modules/fabrica-loja/OrdemProducaoService');
const {
  iniciarProducao,
  executarProducao,
  MENSAGEM_NAO_INICIADA,
  MENSAGEM_CONCLUIDA
} = require('../../backend/modules/fabrica-loja/ProducaoExecucaoService');
const MotorEstoque = require('../../backend/motores/motor-estoque');
const bootstrapFichas = require('../../backend/modules/fabrica-loja/migrations/002_fichas_tecnicas');
const bootstrapOrdens = require('../../backend/modules/fabrica-loja/migrations/005_ordens_producao');
const bootstrapExecucoes = require('../../backend/modules/fabrica-loja/migrations/006_ordem_producao_execucoes');
const bootstrapInicio = require('../../backend/modules/fabrica-loja/migrations/009_ordem_producao_inicio');

const MENSAGEM_ESTADO = 'Esta ordem de produção não pode ser executada neste estado.';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-op-03-'));

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) { err ? reject(err) : resolve({ id: this.lastID }); });
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

async function fotografia(db) {
  const tabelas = await all(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  const foto = {};
  for (const { name } of tabelas) foto[name] = await all(db, `SELECT * FROM "${name}" ORDER BY rowid`);
  return JSON.stringify(foto);
}

async function montarBanco(arquivo) {
  const db = new sqlite3.Database(arquivo);
  await run(db, `
    CREATE TABLE produtos (
      id INTEGER PRIMARY KEY, nome TEXT, unidade TEXT, estoque_atual REAL DEFAULT 0,
      saldo_fiscal REAL DEFAULT 0, saldo_nao_fiscal REAL DEFAULT 0, natureza_cadastro TEXT,
      ativo INTEGER DEFAULT 1, controlar_validade INTEGER DEFAULT 0, updated_at TEXT, preco_compra REAL
    )
  `);
  await bootstrapFichas(db);
  await bootstrapOrdens(db);
  await bootstrapExecucoes(db);
  await bootstrapInicio(db);
  await MotorEstoque.bootstrapMotorEstoqueSchema(db);
  await run(db, `INSERT INTO produtos (id, nome, unidade, estoque_atual, saldo_fiscal, natureza_cadastro, preco_compra) VALUES
    (1, 'Leite', 'L', 1000, 1000, 'INSUMO', 2),
    (2, 'Açúcar', 'KG', 500, 500, 'INSUMO', 3),
    (5, 'Picolé de Morango', 'UN', 0, 0, 'PRODUZIDO', NULL)`);
  await run(db, `INSERT INTO estoque_saldos_locais (produto_id, local, saldo_fiscal, saldo_nao_fiscal, estoque_atual) VALUES
    (1, 'FABRICA', 1000, 0, 1000), (2, 'FABRICA', 500, 0, 500)`);
  await run(db, `INSERT INTO fichas_tecnicas (id, codigo, nome, produto_id, rendimento_quantidade, rendimento_unidade, ativa)
    VALUES (1, 'FT-001', 'Picolé de Morango', 5, 100, 'UN', 1)`);
  await run(db, `INSERT INTO ficha_tecnica_componentes (ficha_id, ordem, produto_id, descricao, quantidade, unidade) VALUES
    (1, 1, 1, 'Leite', 20, 'L'), (1, 2, 2, 'Açúcar', 5, 'KG')`);
  return db;
}

async function novaOrdem(db, quantidade = 100) {
  return salvarOrdem(db, {
    origem: 'MANUAL',
    itens: [{ produto_id: 5, quantidade_planejada: quantidade, unidade: 'UN', ficha_tecnica_id: 1 }]
  });
}

function recusa(codigo, mensagem) {
  return (err) => {
    assert.equal(err.code, codigo);
    assert.equal(err.message, mensagem);
    assert.equal(err.statusCode, 409);
    return true;
  };
}

describe('OP 03 — execução travada fora de EM_PRODUCAO (serviço)', () => {
  let db;
  const contexto = { usuario_id: 3, usuario_nome: 'Ana' };

  before(async () => { db = await montarBanco(path.join(dir, 'servico.db')); });
  after(async () => { await new Promise((resolve) => db.close(resolve)); });

  async function tentativaBloqueada(ordemId, chave, codigo, mensagem) {
    const antes = await fotografia(db);
    await assert.rejects(executarProducao(db, ordemId, { correlation_id: chave }, contexto), recusa(codigo, mensagem));
    assert.equal(await fotografia(db), antes, 'a tentativa bloqueada não pode alterar nenhum dado');
    assert.equal(await get(db, 'SELECT id FROM ordem_producao_execucoes WHERE correlation_id = ?', [chave]), undefined);
  }

  it('1, 6, 7 e 8. OP RASCUNHO não executa e não altera estoque, movimentação nem insumos', async () => {
    const ordem = await novaOrdem(db);
    await tentativaBloqueada(ordem.id, 'op03-rascunho', 'OP_NAO_PLANEJADA', MENSAGEM_ESTADO);
    assert.equal((await obterOrdem(db, ordem.id)).status, 'RASCUNHO');
  });

  it('2, 6, 7 e 8. OP PLANEJADA não executa: pede para iniciar a produção e não movimenta nada', async () => {
    const ordem = await planejarOrdem(db, (await novaOrdem(db)).id);
    const movimentosAntes = (await get(db, 'SELECT COUNT(*) AS total FROM estoque_movimentacoes')).total;
    const leiteAntes = await MotorEstoque.consultarSaldoLocal(db, 1, 'FABRICA');
    await tentativaBloqueada(ordem.id, 'op03-planejada', 'OP_NAO_INICIADA', MENSAGEM_NAO_INICIADA);
    assert.equal(MENSAGEM_NAO_INICIADA, 'É necessário iniciar a produção antes de executar esta ordem.');
    assert.equal((await get(db, 'SELECT COUNT(*) AS total FROM estoque_movimentacoes')).total, movimentosAntes);
    assert.deepEqual(await MotorEstoque.consultarSaldoLocal(db, 1, 'FABRICA'), leiteAntes);
    assert.equal((await get(db, 'SELECT estoque_atual FROM produtos WHERE id = 5')).estoque_atual, 0);
    assert.equal((await obterOrdem(db, ordem.id)).status, 'PLANEJADA');
  });

  it('3 e 9. OP EM_PRODUCAO executa normalmente: consome insumos, entra o produto e conclui', async () => {
    const ordem = await planejarOrdem(db, (await novaOrdem(db)).id);
    const iniciada = await iniciarProducao(db, ordem.id, contexto);
    assert.equal(iniciada.status, 'EM_PRODUCAO');
    const eventos = [];
    const resultado = await executarProducao(db, ordem.id, { correlation_id: 'op03-exec' }, {
      ...contexto,
      auditar(info) { eventos.push(info.acao); }
    });
    assert.equal(resultado.repetida, false);
    assert.equal(resultado.ordem.status, 'CONCLUIDA');
    assert.equal(resultado.execucao.quantidade_produzida, 100);
    assert.equal(resultado.execucao.iniciada_em, iniciada.producao_iniciada_em);
    assert.equal((await MotorEstoque.consultarSaldoLocal(db, 1, 'FABRICA')).estoqueAtual, 980);
    assert.equal((await MotorEstoque.consultarSaldoLocal(db, 2, 'FABRICA')).estoqueAtual, 495);
    assert.equal((await MotorEstoque.consultarSaldoLocal(db, 5, 'FABRICA')).estoqueAtual, 100);
    const movimentos = await all(db, 'SELECT operacao, origem FROM estoque_movimentacoes WHERE referencia_id = ? ORDER BY id', [resultado.execucao.id]);
    assert.deepEqual(movimentos.map((m) => m.operacao), ['SAIDA', 'SAIDA', 'ENTRADA']);
    assert.ok(movimentos.every((m) => m.origem === 'PRODUCAO'));
    assert.deepEqual(eventos, ['PRODUCAO_CONCLUIDA']);
    const repetida = await executarProducao(db, ordem.id, { correlation_id: 'op03-exec' }, contexto);
    assert.equal(repetida.repetida, true);
  });

  it('4. OP CONCLUÍDA não executa novamente', async () => {
    const concluida = await get(db, "SELECT id FROM ordens_producao WHERE status = 'CONCLUIDA' ORDER BY id LIMIT 1");
    await tentativaBloqueada(concluida.id, 'op03-de-novo', 'OP_CONCLUIDA', MENSAGEM_CONCLUIDA);
    assert.equal((await obterOrdem(db, concluida.id)).status, 'CONCLUIDA');
  });

  it('5. OP CANCELADA não executa (cancelada em RASCUNHO ou em PLANEJADA)', async () => {
    const deRascunho = await novaOrdem(db);
    await cancelarOrdem(db, deRascunho.id);
    const dePlanejada = await planejarOrdem(db, (await novaOrdem(db)).id);
    await cancelarOrdem(db, dePlanejada.id);
    for (const ordem of [deRascunho, dePlanejada]) {
      await tentativaBloqueada(ordem.id, `op03-cancelada-${ordem.id}`, 'OP_CANCELADA', MENSAGEM_ESTADO);
      assert.equal((await obterOrdem(db, ordem.id)).status, 'CANCELADA');
    }
  });

  it('OP PLANEJADA bloqueada continua seguindo o fluxo normal: iniciar e depois executar', async () => {
    const ordem = await planejarOrdem(db, (await novaOrdem(db, 50)).id);
    await assert.rejects(executarProducao(db, ordem.id, { correlation_id: 'op03-fluxo' }, contexto), recusa('OP_NAO_INICIADA', MENSAGEM_NAO_INICIADA));
    await iniciarProducao(db, ordem.id, contexto);
    const resultado = await executarProducao(db, ordem.id, { correlation_id: 'op03-fluxo' }, contexto);
    assert.equal(resultado.repetida, false);
    assert.equal(resultado.ordem.status, 'CONCLUIDA');
  });

  it('não existe segunda porta: a conclusão só aceita EM_PRODUCAO no próprio UPDATE', () => {
    const fonte = fs.readFileSync(path.join(__dirname, '../../backend/modules/fabrica-loja/ProducaoExecucaoService.js'), 'utf8');
    assert.match(fonte, /SET status = 'CONCLUIDA'[\s\S]*?WHERE id = \? AND status = 'EM_PRODUCAO'/);
    assert.doesNotMatch(fonte, /status IN \('PLANEJADA', 'EM_PRODUCAO'\)/);
  });
});

describe('OP 03 — rota POST /fabrica-loja/ordens-producao/:id/executar', () => {
  let db;
  let servidor;
  let porta;
  const caminhoDatabase = require.resolve('../../backend/database');
  const anterior = require.cache[caminhoDatabase];

  before(async () => {
    db = await montarBanco(path.join(dir, 'rota.db'));
    require.cache[caminhoDatabase] = { id: caminhoDatabase, filename: caminhoDatabase, loaded: true, exports: db };
    delete require.cache[require.resolve('../../backend/rotas/fabrica-loja')];
    const router = require('../../backend/rotas/fabrica-loja');
    const app = express();
    app.use(express.json());
    app.use('/api/fabrica-loja', router);
    servidor = app.listen(0);
    await new Promise((resolve) => servidor.once('listening', resolve));
    porta = servidor.address().port;
  });

  after(async () => {
    await new Promise((resolve) => servidor.close(resolve));
    delete require.cache[require.resolve('../../backend/rotas/fabrica-loja')];
    if (anterior) require.cache[caminhoDatabase] = anterior;
    else delete require.cache[caminhoDatabase];
    await new Promise((resolve) => db.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function post(caminho, corpo) {
    return new Promise((resolve, reject) => {
      const dados = JSON.stringify(corpo || {});
      const req = http.request({
        host: '127.0.0.1', port: porta, method: 'POST', path: '/api/fabrica-loja' + caminho,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(dados) }
      }, (res) => {
        let texto = '';
        res.on('data', (parte) => { texto += parte; });
        res.on('end', () => resolve({ status: res.statusCode, corpo: JSON.parse(texto) }));
      });
      req.on('error', reject);
      req.end(dados);
    });
  }

  it('PLANEJADA pela API: 409 com a mensagem para iniciar e nenhum dado alterado; depois de iniciar, executa', async () => {
    const ordem = await planejarOrdem(db, (await novaOrdem(db, 100)).id);
    const antes = await fotografia(db);
    const bloqueada = await post(`/ordens-producao/${ordem.id}/executar`, { correlation_id: 'rota-planejada' });
    assert.equal(bloqueada.status, 409);
    assert.deepEqual(bloqueada.corpo, {
      success: false,
      codigo: 'OP_NAO_INICIADA',
      error: 'É necessário iniciar a produção antes de executar esta ordem.',
      detalhes: null
    });
    assert.equal(await fotografia(db), antes);

    const iniciada = await post(`/ordens-producao/${ordem.id}/em-producao`);
    assert.equal(iniciada.status, 200);
    assert.equal(iniciada.corpo.ordem.status, 'EM_PRODUCAO');
    const executada = await post(`/ordens-producao/${ordem.id}/executar`, { correlation_id: 'rota-planejada' });
    assert.equal(executada.status, 201);
    assert.equal(executada.corpo.ordem.status, 'CONCLUIDA');
    assert.equal((await MotorEstoque.consultarSaldoLocal(db, 5, 'FABRICA')).estoqueAtual, 100);
  });

  it('RASCUNHO pela API: 409 controlado e nenhum dado alterado', async () => {
    const ordem = await novaOrdem(db, 10);
    const antes = await fotografia(db);
    const resposta = await post(`/ordens-producao/${ordem.id}/executar`, { correlation_id: 'rota-rascunho' });
    assert.equal(resposta.status, 409);
    assert.equal(resposta.corpo.success, false);
    assert.equal(resposta.corpo.codigo, 'OP_NAO_PLANEJADA');
    assert.equal(await fotografia(db), antes);
  });
});
