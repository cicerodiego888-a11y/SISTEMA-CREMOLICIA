'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, describe, it } = require('node:test');
const assert = require('node:assert/strict');

const diretorioTemporario = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-compras-processamento-'));
process.env.DB_DIR = diretorioTemporario;

const express = require('express');
const db = require('../../backend/database');
const MotorEstoque = require('../../backend/motores/motor-estoque');

const executar = (sql, parametros = []) => new Promise((resolve, reject) => {
  db.run(sql, parametros, function aoExecutar(err) {
    if (err) reject(err);
    else resolve(this);
  });
});

const consultar = (sql, parametros = []) => new Promise((resolve, reject) => {
  db.all(sql, parametros, (err, rows) => (err ? reject(err) : resolve(rows || [])));
});

const esperarBanco = () => new Promise((resolve, reject) => {
  db.whenReady((err) => (err ? reject(err) : resolve()));
});

describe('Compras — conclusão única do processamento e da transação', () => {
  let servidor;
  let baseUrl;
  let produtoIds;
  const chamadasJson = [];
  let modoUnidades = 'normal';
  let sequenciaChave = 0;

  before(async () => {
    await esperarBanco();
    const produtoAtivo = await executar(`
      INSERT INTO produtos (
        nome, unidade, natureza_cadastro, ativo, controlar_validade,
        estoque_atual, saldo_fiscal, saldo_nao_fiscal, preco_venda
      ) VALUES ('Insumo processamento compra', 'L', 'INSUMO', 1, 0, 0, 0, 0, 3)
    `);
    const segundoProduto = await executar(`
      INSERT INTO produtos (
        nome, unidade, natureza_cadastro, ativo, controlar_validade,
        estoque_atual, saldo_fiscal, saldo_nao_fiscal, preco_venda
      ) VALUES ('Insumo processamento compra 2', 'KG', 'INSUMO', 1, 0, 0, 0, 0, 3)
    `);
    produtoIds = [produtoAtivo.lastID, segundoProduto.lastID];

    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      const responderJson = res.json.bind(res);
      res.json = (payload) => {
        chamadasJson.push({ path: req.path, status: res.statusCode });
        return responderJson(payload);
      };
      next();
    });
    app.use('/', require('../../backend/rotas/compras'));
    servidor = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => servidor.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${servidor.address().port}/`;

    const dbAll = db.all.bind(db);
    db.all = function interceptarConsultaUnidades(sql, parametros, callback) {
      if (modoUnidades === 'repetido' && /FROM unidades_negocio WHERE COALESCE\(ativa, 1\) = 1/.test(sql)) {
        return dbAll(sql, parametros, (err, rows) => {
          setTimeout(() => callback(err, rows), 20);
          setTimeout(() => callback(err, rows), 100);
        });
      }
      return dbAll(sql, parametros, callback);
    };
  });

  after(async () => {
    if (servidor) await new Promise((resolve) => servidor.close(resolve));
    await new Promise((resolve, reject) => db.close((err) => (err ? reject(err) : resolve())));
    fs.rmSync(diretorioTemporario, { recursive: true, force: true });
  });

  function payloadCompra(itens, fornecedor, extras = {}) {
    const total = itens.reduce((soma, item) => soma + item.subtotal, 0);
    return {
      data_compra: '2026-10-27',
      fornecedor,
      total,
      valor_produtos: total,
      valor_total_nota: total,
      condicao_pagamento: 'avista',
      tipo_entrada: 'COMPRA_FORNECEDOR',
      itens,
      ...extras
    };
  }

  function item(produtoId, nome, destino, quantidade, fiscal, naoFiscal, unidade) {
    return {
      produto_id: produtoId,
      produto_nome: nome,
      unidade,
      quantidade,
      quantidade_fiscal: fiscal,
      quantidade_nao_fiscal: naoFiscal,
      item_fiscal: fiscal > 0 ? 1 : 0,
      preco_unitario: 2,
      subtotal: quantidade * 2,
      destino_estoque: destino
    };
  }

  async function requisitarCompra(fornecedor, itens, chave, extras = {}) {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(chave ? { 'Idempotency-Key': chave } : {})
      },
      body: JSON.stringify(payloadCompra(itens, fornecedor, extras))
    });
    const body = await response.json();
    return { status: response.status, body };
  }

  async function postarCompra(fornecedor, itens, chave = `teste-${++sequenciaChave}`, extras = {}) {
    const chamadasAntes = chamadasJson.length;
    const resposta = await requisitarCompra(fornecedor, itens, chave, extras);
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal(chamadasJson.length - chamadasAntes, 1, 'a rota deve responder uma única vez');
    return resposta;
  }

  async function estadoCompra(fornecedor) {
    return {
      compras: await consultar('SELECT id FROM compras WHERE fornecedor = ?', [fornecedor]),
      itens: await consultar(`
        SELECT compra_id, produto_id, quantidade, quantidade_fiscal, quantidade_nao_fiscal, destino_estoque
        FROM compras_itens WHERE compra_id IN (SELECT id FROM compras WHERE fornecedor = ?)
        ORDER BY id
      `, [fornecedor]),
      financeiro: await consultar(`
        SELECT compra_id, COUNT(*) AS quantidade
        FROM financeiro WHERE compra_id IN (SELECT id FROM compras WHERE fornecedor = ?)
        GROUP BY compra_id
      `, [fornecedor]),
      movimentacoes: await consultar(`
        SELECT referencia_id, produto_id, local, quantidade_base, quantidade_fiscal, quantidade_nao_fiscal
        FROM estoque_movimentacoes
        WHERE referencia_tipo = 'compra'
          AND referencia_id IN (SELECT id FROM compras WHERE fornecedor = ?)
        ORDER BY id
      `, [fornecedor]),
      auditoria: await consultar(`
        SELECT referencia_id, COUNT(*) AS quantidade
        FROM auditoria
        WHERE modulo = 'compras' AND acao = 'criar_compra'
          AND referencia_id IN (SELECT id FROM compras WHERE fornecedor = ?)
        GROUP BY referencia_id
      `, [fornecedor])
    };
  }

  async function saldoProduto(produtoId) {
    return {
      produto: await consultar(`
        SELECT estoque_atual, saldo_fiscal, saldo_nao_fiscal
        FROM produtos WHERE id = ?
      `, [produtoId]),
      locais: await consultar(`
        SELECT local, estoque_atual, saldo_fiscal, saldo_nao_fiscal
        FROM estoque_saldos_locais WHERE produto_id = ? ORDER BY local
      `, [produtoId])
    };
  }

  it('grava um item, estoque, financeiro e auditoria antes do HTTP 200', async () => {
    const fornecedor = 'Teste compra um item';
    const resposta = await postarCompra(fornecedor, [
      item(produtoIds[0], 'Insumo processamento compra', 'FABRICA', 10, 7, 3, 'L')
    ]);

    assert.equal(resposta.status, 200);
    const estado = await estadoCompra(fornecedor);
    assert.equal(estado.compras.length, 1);
    assert.equal(estado.itens.length, 1);
    assert.equal(estado.financeiro.length, 1);
    assert.equal(estado.movimentacoes.length, 1);
    assert.equal(estado.auditoria.length, 1);
    assert.equal(Number(estado.itens[0].quantidade_fiscal), 7);
    assert.equal(Number(estado.itens[0].quantidade_nao_fiscal), 3);
    assert.equal(estado.movimentacoes[0].local, 'FABRICA');
    assert.equal(Number(estado.movimentacoes[0].quantidade_fiscal), 7);
    assert.equal(Number(estado.movimentacoes[0].quantidade_nao_fiscal), 3);
    const indices = await consultar('PRAGMA index_list(compras)');
    assert.ok(indices.some((indice) => (
      indice.name === 'idx_compras_idempotency_key' && Number(indice.unique) === 1
    )));
  });

  it('reenvio após perda da resposta retorna a compra existente sem repetir efeitos', async () => {
    const fornecedor = 'Teste reenvio mesma chave';
    const chave = 'retry-compra-001';
    const itens = [item(produtoIds[0], 'Insumo processamento compra', 'FABRICA', 10, 7, 3, 'L')];
    const primeira = await postarCompra(fornecedor, itens, chave);
    const estadoInicial = await estadoCompra(fornecedor);
    const saldoInicial = await saldoProduto(produtoIds[0]);

    const repetida = await postarCompra(fornecedor, itens, chave);
    const estadoFinal = await estadoCompra(fornecedor);
    const saldoFinal = await saldoProduto(produtoIds[0]);

    assert.equal(primeira.status, 200);
    assert.equal(repetida.status, 200);
    assert.deepEqual(repetida.body, primeira.body);
    assert.equal(estadoFinal.compras.length, 1);
    assert.equal(estadoFinal.itens.length, 1);
    assert.equal(estadoFinal.financeiro.length, 1);
    assert.equal(estadoFinal.movimentacoes.length, 1);
    assert.equal(estadoFinal.auditoria.length, 1);
    assert.deepEqual(saldoFinal, saldoInicial);
    assert.equal((await consultar(
      'SELECT idempotency_payload_hash FROM compras WHERE idempotency_key = ?',
      [chave]
    )).length, 1);
  });

  it('duas solicitações simultâneas com a mesma chave criam uma única compra', async () => {
    const fornecedor = 'Teste concorrencia mesma chave';
    const chave = 'retry-compra-concorrente';
    const itens = [item(produtoIds[1], 'Insumo processamento compra 2', 'LOJA', 8, 5, 3, 'KG')];
    const chamadasAntes = chamadasJson.length;
    const respostas = await Promise.all([
      requisitarCompra(fornecedor, itens, chave),
      requisitarCompra(fornecedor, itens, chave)
    ]);
    await new Promise((resolve) => setTimeout(resolve, 120));

    assert.deepEqual(respostas.map((resposta) => resposta.status), [200, 200]);
    assert.equal(respostas[0].body.id, respostas[1].body.id);
    assert.equal(chamadasJson.length - chamadasAntes, 2);
    const estado = await estadoCompra(fornecedor);
    assert.equal(estado.compras.length, 1);
    assert.equal(estado.itens.length, 1);
    assert.equal(estado.financeiro.length, 1);
    assert.equal(estado.movimentacoes.length, 1);
    assert.equal(estado.auditoria.length, 1);
  });

  it('recusa conteúdo diferente com a mesma chave e aceita nova chave legítima', async () => {
    const fornecedor = 'Teste conteúdo da chave';
    const chave = 'retry-compra-conteudo';
    const itemOriginal = item(produtoIds[0], 'Insumo processamento compra', 'FABRICA', 2, 2, 0, 'L');
    const primeira = await postarCompra(fornecedor, [itemOriginal], chave);
    const saldoDepoisPrimeira = await saldoProduto(produtoIds[0]);
    const itemAlterado = { ...itemOriginal, quantidade: 3, quantidade_fiscal: 3, subtotal: 6 };

    const conflito = await postarCompra(fornecedor, [itemAlterado], chave);
    assert.equal(conflito.status, 409);
    assert.match(conflito.body.error, /conteúdo diferente/i);
    assert.deepEqual(await saldoProduto(produtoIds[0]), saldoDepoisPrimeira);
    assert.equal((await estadoCompra(fornecedor)).compras.length, 1);

    const novaCompra = await postarCompra(fornecedor, [itemAlterado], 'retry-compra-nova');
    assert.equal(novaCompra.status, 200);
    assert.notEqual(novaCompra.body.id, primeira.body.id);
    const estado = await estadoCompra(fornecedor);
    assert.equal(estado.compras.length, 2);
    assert.equal(estado.itens.length, 2);
    assert.equal(estado.financeiro.length, 2);
    assert.equal(estado.movimentacoes.length, 2);
    assert.equal(estado.auditoria.length, 2);
  });

  it('mantém a proteção por chave de acesso no fluxo com NF-e', async () => {
    const fornecedor = 'Teste fluxo NF-e idempotência';
    const chaveAcesso = '12345678901234567890123456789012345678901234';
    const itens = [item(produtoIds[1], 'Insumo processamento compra 2', 'LOJA', 3, 3, 0, 'KG')];
    const primeira = await postarCompra(fornecedor, itens, 'header-nao-aplica-nfe', {
      chave_acesso: chaveAcesso
    });
    const repetida = await postarCompra(fornecedor, itens, 'header-nao-aplica-nfe', {
      chave_acesso: chaveAcesso
    });

    assert.equal(primeira.status, 200);
    assert.equal(repetida.status, 400);
    assert.match(repetida.body.error, /chave de acesso duas vezes/i);
    assert.equal((await estadoCompra(fornecedor)).compras.length, 1);
    assert.equal((await consultar(
      'SELECT id FROM compras WHERE chave_acesso = ? AND idempotency_key IS NULL',
      [chaveAcesso]
    )).length, 1);
  });

  it('exige chave de idempotência para compra manual sem NF-e', async () => {
    const resposta = await requisitarCompra(
      'Teste chave obrigatoria',
      [item(produtoIds[0], 'Insumo processamento compra', 'FABRICA', 1, 1, 0, 'L')],
      null
    );

    assert.equal(resposta.status, 400);
    assert.match(resposta.body.error, /chave de idempotência/i);
    assert.equal((await estadoCompra('Teste chave obrigatoria')).compras.length, 0);
  });

  it('conclui todos os itens em destinos diferentes antes do HTTP 200', async () => {
    const fornecedor = 'Teste compra varios itens';
    const resposta = await postarCompra(fornecedor, [
      item(produtoIds[0], 'Insumo processamento compra', 'FABRICA', 4, 4, 0, 'L'),
      item(produtoIds[1], 'Insumo processamento compra 2', 'LOJA', 6, 2, 4, 'KG')
    ]);

    assert.equal(resposta.status, 200);
    const estado = await estadoCompra(fornecedor);
    assert.equal(estado.compras.length, 1);
    assert.equal(estado.itens.length, 2);
    assert.equal(estado.financeiro.length, 1);
    assert.equal(estado.movimentacoes.length, 2);
    assert.equal(estado.auditoria.length, 1);
    assert.deepEqual(estado.movimentacoes.map((movimento) => movimento.local), ['FABRICA', 'LOJA']);
    assert.deepEqual(estado.movimentacoes.map((movimento) => [
      Number(movimento.quantidade_fiscal),
      Number(movimento.quantidade_nao_fiscal)
    ]), [[4, 0], [2, 4]]);
  });

  it('ignora callback de unidades repetido e tardio sem repetir a conclusão', async () => {
    const fornecedor = 'Teste callback repetido';
    modoUnidades = 'repetido';
    try {
      const resposta = await postarCompra(fornecedor, [
        item(produtoIds[0], 'Insumo processamento compra', 'FABRICA', 5, 5, 0, 'L')
      ]);
      assert.equal(resposta.status, 200);
      const estado = await estadoCompra(fornecedor);
      assert.equal(estado.compras.length, 1);
      assert.equal(estado.itens.length, 1);
      assert.equal(estado.financeiro.length, 1);
      assert.equal(estado.movimentacoes.length, 1);
      assert.equal(estado.auditoria.length, 1);
    } finally {
      modoUnidades = 'normal';
    }
  });

  it('falha ao iniciar a transação sem gravar a compra', async () => {
    const fornecedor = 'Teste falha begin';
    const chave = 'retry-compra-begin-falha';
    const runOriginal = db.run;
    db.run = function falharBegin(sql, ...argumentos) {
      if (String(sql).trim().toUpperCase() === 'BEGIN IMMEDIATE') {
        const callback = argumentos[argumentos.length - 1];
        process.nextTick(() => callback.call({}, new Error('Falha simulada no BEGIN.')));
        return this;
      }
      return runOriginal.call(this, sql, ...argumentos);
    };
    try {
      const resposta = await postarCompra(fornecedor, [
        item(produtoIds[0], 'Insumo processamento compra', 'FABRICA', 5, 5, 0, 'L')
      ], chave);
      assert.equal(resposta.status, 500);
      assert.match(resposta.body.error, /Falha simulada no BEGIN/);
    } finally {
      db.run = runOriginal;
    }

    const estado = await estadoCompra(fornecedor);
    assert.equal(estado.compras.length, 0);
    assert.equal(estado.itens.length, 0);
    assert.equal(estado.financeiro.length, 0);
    assert.equal(estado.movimentacoes.length, 0);
    assert.equal(estado.auditoria.length, 0);
    assert.equal((await consultar('SELECT id FROM compras WHERE idempotency_key = ?', [chave])).length, 0);
  });

  it('falha antes do COMMIT sem responder sucesso nem persistir compra', async () => {
    const fornecedor = 'Teste falha estoque';
    const chave = 'retry-compra-estoque-falha';
    const entrarOriginal = MotorEstoque.entrar;
    MotorEstoque.entrar = async () => {
      throw new Error('Falha simulada no Motor de Estoque.');
    };
    try {
      const resposta = await postarCompra(fornecedor, [
        item(produtoIds[0], 'Insumo processamento compra', 'FABRICA', 5, 5, 0, 'L')
      ], chave);
      assert.equal(resposta.status, 500);
      assert.match(resposta.body.error, /Falha simulada/);
      const estado = await estadoCompra(fornecedor);
      assert.equal(estado.compras.length, 0);
      assert.equal(estado.itens.length, 0);
      assert.equal(estado.financeiro.length, 0);
      assert.equal(estado.movimentacoes.length, 0);
      assert.equal(estado.auditoria.length, 0);
      assert.equal((await consultar('SELECT id FROM compras WHERE idempotency_key = ?', [chave])).length, 0);
    } finally {
      MotorEstoque.entrar = entrarOriginal;
    }
  });

  it('falha no COMMIT, desfaz a transação e não responde sucesso', async () => {
    const fornecedor = 'Teste falha commit';
    const chave = 'retry-compra-commit-falha';
    const runOriginal = db.run;
    db.run = function falharCommit(sql, ...argumentos) {
      if (String(sql).trim().toUpperCase() === 'COMMIT') {
        const callback = argumentos[argumentos.length - 1];
        process.nextTick(() => callback.call({}, new Error('Falha simulada no COMMIT.')));
        return this;
      }
      return runOriginal.call(this, sql, ...argumentos);
    };
    try {
      const resposta = await postarCompra(fornecedor, [
        item(produtoIds[0], 'Insumo processamento compra', 'FABRICA', 5, 5, 0, 'L')
      ], chave);
      assert.equal(resposta.status, 500);
      assert.match(resposta.body.error, /Falha simulada no COMMIT/);
    } finally {
      db.run = runOriginal;
    }

    const estado = await estadoCompra(fornecedor);
    assert.equal(estado.compras.length, 0);
    assert.equal(estado.itens.length, 0);
    assert.equal(estado.financeiro.length, 0);
    assert.equal(estado.movimentacoes.length, 0);
    assert.equal(estado.auditoria.length, 0);
    assert.equal((await consultar('SELECT id FROM compras WHERE idempotency_key = ?', [chave])).length, 0);
  });
});
