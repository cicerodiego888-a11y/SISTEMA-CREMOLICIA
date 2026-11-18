/**
 * OP 04 — PRODUCAO_INICIADA é registrado quando a OP entra em EM_PRODUCAO, não na execução.
 * Rotas reais com a auditoria real (tabela auditoria) sobre banco temporário. Não usa o banco oficial.
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
const { salvarOrdem, planejarOrdem } = require('../../backend/modules/fabrica-loja/OrdemProducaoService');
const { iniciarProducao, executarProducao } = require('../../backend/modules/fabrica-loja/ProducaoExecucaoService');
const MotorEstoque = require('../../backend/motores/motor-estoque');
const bootstrapFichas = require('../../backend/modules/fabrica-loja/migrations/002_fichas_tecnicas');
const bootstrapOrdens = require('../../backend/modules/fabrica-loja/migrations/005_ordens_producao');
const bootstrapExecucoes = require('../../backend/modules/fabrica-loja/migrations/006_ordem_producao_execucoes');
const bootstrapInicio = require('../../backend/modules/fabrica-loja/migrations/009_ordem_producao_inicio');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-op-04-'));

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) { err ? reject(err) : resolve({ id: this.lastID }); });
  });
}
function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}
const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

after(() => fs.rmSync(dir, { recursive: true, force: true }));

async function fotografia(db, ignorar) {
  const tabelas = await all(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  const foto = {};
  for (const { name } of tabelas) {
    if (ignorar.includes(name)) continue;
    foto[name] = await all(db, `SELECT * FROM "${name}" ORDER BY rowid`);
  }
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
  await run(db, `
    CREATE TABLE auditoria (
      id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER, usuario_nome TEXT, modulo TEXT,
      acao TEXT NOT NULL, referencia_tipo TEXT, referencia_id INTEGER, detalhes TEXT, ip_requisicao TEXT,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
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

describe('OP 04 — histórico do início da produção pela rota (auditoria real)', () => {
  let db;
  let servidor;
  let porta;
  const modulosTrocados = ['../../backend/database', '../../backend/services/auditoria', '../../backend/rotas/fabrica-loja']
    .map((m) => require.resolve(m));
  const anteriores = new Map(modulosTrocados.map((m) => [m, require.cache[m]]));

  before(async () => {
    db = await montarBanco(path.join(dir, 'rota.db'));
    const [caminhoDatabase, caminhoAuditoria, caminhoRotas] = modulosTrocados;
    require.cache[caminhoDatabase] = { id: caminhoDatabase, filename: caminhoDatabase, loaded: true, exports: db };
    delete require.cache[caminhoAuditoria];
    delete require.cache[caminhoRotas];
    const router = require(caminhoRotas);
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: 7, username: 'ana.fabrica' }; next(); });
    app.use('/api/fabrica-loja', router);
    servidor = app.listen(0);
    await new Promise((resolve) => servidor.once('listening', resolve));
    porta = servidor.address().port;
  });

  after(async () => {
    await new Promise((resolve) => servidor.close(resolve));
    for (const m of modulosTrocados) {
      if (anteriores.get(m)) require.cache[m] = anteriores.get(m);
      else delete require.cache[m];
    }
    await new Promise((resolve) => db.close(resolve));
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

  const historico = (ordemId) => all(db, `
    SELECT id, acao, usuario_id, usuario_nome, modulo, referencia_tipo, referencia_id, detalhes, criado_em
    FROM auditoria WHERE referencia_id = ? AND referencia_tipo = 'ordem_producao' ORDER BY id
  `, [ordemId]);
  const acoes = async (ordemId) => (await historico(ordemId)).map((e) => e.acao);

  it('1 a 8. Criar e planejar não iniciam; Iniciar registra um único início antes da execução; executar e repetir não duplicam', async () => {
    const criada = await post('/ordens-producao', {
      origem: 'MANUAL',
      itens: [{ produto_id: 5, quantidade_planejada: 100, unidade: 'UN', ficha_tecnica_id: 1 }]
    });
    assert.equal(criada.status, 201);
    const id = criada.corpo.ordem.id;
    assert.deepEqual(await acoes(id), ['OP_CRIADA']);

    assert.equal((await post(`/ordens-producao/${id}/planejar`)).status, 200);
    assert.deepEqual(await acoes(id), ['OP_CRIADA', 'OP_PLANEJADA']);

    const antesDoInicio = await fotografia(db, ['ordens_producao', 'auditoria']);
    const iniciada = await post(`/ordens-producao/${id}/em-producao`);
    assert.equal(iniciada.status, 200);
    assert.equal(iniciada.corpo.ordem.status, 'EM_PRODUCAO');
    assert.deepEqual(await acoes(id), ['OP_CRIADA', 'OP_PLANEJADA', 'PRODUCAO_INICIADA']);
    const inicio = (await historico(id))[2];
    assert.equal(inicio.usuario_id, 7);
    assert.equal(inicio.usuario_nome, 'ana.fabrica');
    assert.equal(inicio.modulo, 'ordens-producao');
    assert.deepEqual(JSON.parse(inicio.detalhes), {
      codigo: iniciada.corpo.ordem.codigo,
      status: 'EM_PRODUCAO',
      iniciada_em: iniciada.corpo.ordem.producao_iniciada_em
    });
    assert.equal(await fotografia(db, ['ordens_producao', 'auditoria']), antesDoInicio, 'iniciar não movimenta estoque nem cria execução');

    const repetirInicio = await post(`/ordens-producao/${id}/em-producao`);
    assert.equal(repetirInicio.status, 409);
    assert.equal(repetirInicio.corpo.codigo, 'OP_JA_INICIADA');
    assert.deepEqual(await acoes(id), ['OP_CRIADA', 'OP_PLANEJADA', 'PRODUCAO_INICIADA']);

    await esperar(1100);
    const executada = await post(`/ordens-producao/${id}/executar`, { correlation_id: 'op04-exec' });
    assert.equal(executada.status, 201);
    assert.equal(executada.corpo.ordem.status, 'CONCLUIDA');
    assert.deepEqual(await acoes(id), ['OP_CRIADA', 'OP_PLANEJADA', 'PRODUCAO_INICIADA', 'PRODUCAO_CONCLUIDA']);
    const [, , iniciou, concluiu] = await historico(id);
    assert.ok(iniciou.criado_em < concluiu.criado_em, `início ${iniciou.criado_em} deve ser anterior à conclusão ${concluiu.criado_em}`);
    const conclusao = JSON.parse(concluiu.detalhes);
    assert.equal(conclusao.execucao_id, executada.corpo.execucao.id);
    assert.equal(conclusao.produzido, 100);
    assert.equal(conclusao.planejado, 100);
    assert.equal(executada.corpo.execucao.iniciada_em, iniciada.corpo.ordem.producao_iniciada_em);

    assert.equal((await MotorEstoque.consultarSaldoLocal(db, 1, 'FABRICA')).estoqueAtual, 980);
    assert.equal((await MotorEstoque.consultarSaldoLocal(db, 2, 'FABRICA')).estoqueAtual, 495);
    assert.equal((await MotorEstoque.consultarSaldoLocal(db, 5, 'FABRICA')).estoqueAtual, 100);
    const movimentos = await all(db, 'SELECT operacao, origem FROM estoque_movimentacoes WHERE referencia_id = ? ORDER BY id', [executada.corpo.execucao.id]);
    assert.deepEqual(movimentos.map((m) => [m.operacao, m.origem]), [['SAIDA', 'PRODUCAO'], ['SAIDA', 'PRODUCAO'], ['ENTRADA', 'PRODUCAO']]);

    const repetida = await post(`/ordens-producao/${id}/executar`, { correlation_id: 'op04-exec' });
    assert.equal(repetida.status, 200);
    assert.equal(repetida.corpo.repetida, true);
    const outraChave = await post(`/ordens-producao/${id}/executar`, { correlation_id: 'op04-outra' });
    assert.equal(outraChave.status, 409);
    assert.deepEqual(await acoes(id), ['OP_CRIADA', 'OP_PLANEJADA', 'PRODUCAO_INICIADA', 'PRODUCAO_CONCLUIDA']);
    assert.equal((await MotorEstoque.consultarSaldoLocal(db, 5, 'FABRICA')).estoqueAtual, 100);
  });

  it('Iniciar recusado (OP em RASCUNHO) não registra PRODUCAO_INICIADA', async () => {
    const criada = await post('/ordens-producao', {
      origem: 'MANUAL',
      itens: [{ produto_id: 5, quantidade_planejada: 10, unidade: 'UN', ficha_tecnica_id: 1 }]
    });
    const id = criada.corpo.ordem.id;
    const resposta = await post(`/ordens-producao/${id}/em-producao`);
    assert.equal(resposta.status, 409);
    assert.deepEqual(await acoes(id), ['OP_CRIADA']);
  });
});

describe('OP 04 — eventos entregues ao mecanismo de auditoria (serviço)', () => {
  let db;
  before(async () => { db = await montarBanco(path.join(dir, 'servico.db')); });
  after(async () => { await new Promise((resolve) => db.close(resolve)); });

  it('cada passo entrega só o seu evento, na ordem real das ações', async () => {
    const eventos = [];
    const contexto = { usuario_id: 9, usuario_nome: 'Bia', auditar(info) { eventos.push(info); } };
    const criada = await salvarOrdem(db, {
      origem: 'MANUAL',
      itens: [{ produto_id: 5, quantidade_planejada: 100, unidade: 'UN', ficha_tecnica_id: 1 }]
    }, null, contexto);
    await planejarOrdem(db, criada.id, contexto);
    assert.ok(!eventos.some((e) => e.acao === 'PRODUCAO_INICIADA'));

    const iniciada = await iniciarProducao(db, criada.id, contexto);
    const inicios = eventos.filter((e) => e.acao === 'PRODUCAO_INICIADA');
    assert.equal(inicios.length, 1);
    assert.equal(inicios[0].referencia_id, criada.id);
    assert.equal(inicios[0].detalhes.iniciada_em, iniciada.producao_iniciada_em);
    const execucoesAntes = await all(db, 'SELECT id FROM ordem_producao_execucoes WHERE ordem_id = ?', [criada.id]);
    assert.equal(execucoesAntes.length, 0);

    await executarProducao(db, criada.id, { correlation_id: 'op04-servico' }, contexto);
    await executarProducao(db, criada.id, { correlation_id: 'op04-servico' }, contexto);
    assert.deepEqual(eventos.map((e) => e.acao), ['OP_CRIADA', 'OP_PLANEJADA', 'PRODUCAO_INICIADA', 'PRODUCAO_CONCLUIDA']);
  });

  it('Iniciar sem mecanismo de auditoria continua funcionando', async () => {
    const criada = await salvarOrdem(db, {
      origem: 'MANUAL',
      itens: [{ produto_id: 5, quantidade_planejada: 10, unidade: 'UN', ficha_tecnica_id: 1 }]
    });
    await planejarOrdem(db, criada.id);
    assert.equal((await iniciarProducao(db, criada.id)).status, 'EM_PRODUCAO');
  });
});
