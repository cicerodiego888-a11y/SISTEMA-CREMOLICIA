/**
 * Saneamento de cadastro duplicado (FABRICA-MODELO-03): zera o saldo sem histórico
 * de um produto inativo pelo Motor de Estoque oficial, sem reativar nem excluir.
 * Banco temporário via tests/pdv/_bancoIsolado.js. Executar: npm run test:saneamento-duplicado
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const TMP = path.resolve(os.tmpdir()).toLowerCase();
const DB_DIR = path.resolve(String(process.env.DB_DIR || '')).toLowerCase();
if (!process.env.DB_DIR || !DB_DIR.startsWith(TMP)) {
  console.error('Banco isolado ausente. Execute: node -r ./tests/pdv/_bancoIsolado.js --test tests/fabrica-loja/saneamento-produto-duplicado.test.js');
  process.exit(1);
}
for (const sufixo of ['', '-wal', '-shm']) {
  fs.rmSync(path.join(process.env.DB_DIR, 'mercadao.db' + sufixo), { force: true });
}

const express = require('express');
const db = require('../../backend/database');
const MotorEstoque = require('../../backend/motores/motor-estoque');
const { aplicarAjusteEstoqueProduto, registrarAjusteEstoque } = require('../../backend/services/ajusteEstoqueService');

const ORIGEM = 'AJUSTE_SANEAMENTO_CADASTRO_DUPLICADO';
const MOTIVO = `${ORIGEM} — cadastro duplicado inativo; saldo sem histórico zerado. Produto mantido inativo.`;

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}
function get(sql, params = []) {
  return new Promise((resolve, reject) => db.get(sql, params, (e, r) => (e ? reject(e) : resolve(r || null))));
}
function all(sql, params = []) {
  return new Promise((resolve, reject) => db.all(sql, params, (e, r) => (e ? reject(e) : resolve(r || []))));
}

async function criarProduto(dados) {
  const r = await run(
    `INSERT INTO produtos (codigo, nome, unidade, preco_venda, preco_compra, saldo_fiscal, saldo_nao_fiscal,
       estoque_atual, ativo, item_fiscal)
     VALUES (?, ?, 'UN', 2.5, 0, ?, ?, ?, ?, 1)`,
    [dados.codigo, dados.nome, dados.fiscal, dados.naoFiscal, dados.fiscal + dados.naoFiscal, dados.ativo]
  );
  return r.id;
}

async function sanear(produtoId) {
  const antes = await MotorEstoque.consultarSaldo(db, produtoId);
  const resultado = await MotorEstoque.ajustar(db, {
    produtoId,
    deltaFiscal: -antes.saldoFiscal,
    deltaNaoFiscal: -antes.saldoNaoFiscal,
    motivo: MOTIVO,
    origem: ORIGEM,
    usuarioId: null,
    referenciaTipo: 'ajuste_estoque'
  });
  await new Promise((resolve, reject) => registrarAjusteEstoque(db, {
    produto_id: produtoId,
    usuario_id: null,
    usuario_nome: 'SANEAMENTO',
    motivo: MOTIVO,
    ajuste_fiscal: -antes.saldoFiscal,
    ajuste_nao_fiscal: -antes.saldoNaoFiscal,
    saldo_fiscal_antes: antes.saldoFiscal,
    saldo_fiscal_depois: resultado.saldo_fiscal,
    saldo_nao_fiscal_antes: antes.saldoNaoFiscal,
    saldo_nao_fiscal_depois: resultado.saldo_nao_fiscal,
    estoque_total_antes: antes.estoqueAtual,
    estoque_total_depois: resultado.estoque_atual
  }, (e) => (e ? reject(e) : resolve())));
  return resultado;
}

const ids = {};
let servidor;
let base;

before(async () => {
  assert.ok(path.resolve(db.dbPath).toLowerCase().startsWith(TMP), `banco fora do temp: ${db.dbPath}`);
  await new Promise((resolve) => db.whenReady(() => resolve()));
  ids.original = await criarProduto({ codigo: '0051', nome: 'PICOLE LINHA ESPECIAL', fiscal: 11, naoFiscal: 482, ativo: 1 });
  ids.duplicado = await criarProduto({ codigo: '0055', nome: 'PICOLE LINHA ESPECIAL', fiscal: 50000, naoFiscal: 0, ativo: 0 });
  ids.outro = await criarProduto({ codigo: '0047', nome: 'PICOLE LINHA CREMOSA', fiscal: 7948, naoFiscal: 49560, ativo: 1 });

  const app = express();
  app.use(express.json());
  app.use('/api/produtos', require('../../backend/rotas/produtos'));
  servidor = http.createServer(app);
  await new Promise((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${servidor.address().port}/api`;
});

after(async () => {
  if (servidor) await new Promise((resolve) => servidor.close(resolve));
  await new Promise((resolve) => db.close(() => resolve()));
});

describe('Saneamento do cadastro duplicado', () => {
  let originalAntes;
  let outroAntes;
  let globalAntes;

  before(async () => {
    originalAntes = await get('SELECT * FROM produtos WHERE id = ?', [ids.original]);
    outroAntes = await get('SELECT * FROM produtos WHERE id = ?', [ids.outro]);
    globalAntes = (await get('SELECT SUM(estoque_atual) AS total FROM produtos')).total;
  });

  it('ANTES: duplicado inativo com 50.000 fiscais e nenhuma movimentação', async () => {
    const p = await get('SELECT saldo_fiscal, saldo_nao_fiscal, estoque_atual, ativo FROM produtos WHERE id = ?', [ids.duplicado]);
    assert.deepEqual(p, { saldo_fiscal: 50000, saldo_nao_fiscal: 0, estoque_atual: 50000, ativo: 0 });
    assert.equal((await get('SELECT COUNT(*) AS q FROM estoque_movimentacoes WHERE produto_id = ?', [ids.duplicado])).q, 0);
  });

  it('o ajuste da tela recusa produto inativo e não altera nada', async () => {
    const erro = await new Promise((resolve) => aplicarAjusteEstoqueProduto(db, {
      produtoId: ids.duplicado, ajusteFiscal: -50000, ajusteNaoFiscal: 0, motivo: MOTIVO
    }, (e) => resolve(e)));
    assert.match(String(erro && erro.message), /Produto desabilitado/);
    assert.equal((await get('SELECT estoque_atual FROM produtos WHERE id = ?', [ids.duplicado])).estoque_atual, 50000);
    assert.equal((await get('SELECT COUNT(*) AS q FROM estoque_movimentacoes WHERE produto_id = ?', [ids.duplicado])).q, 0);
  });

  it('EXECUÇÃO: ajuste oficial de −50.000 pelo Motor de Estoque', async () => {
    const r = await sanear(ids.duplicado);
    assert.equal(r.estoque_atual, 0);
    const movs = await all('SELECT * FROM estoque_movimentacoes WHERE produto_id = ?', [ids.duplicado]);
    assert.equal(movs.length, 1);
    assert.equal(movs[0].operacao, 'AJUSTE');
    assert.equal(movs[0].origem, ORIGEM);
    assert.equal(movs[0].quantidade_fiscal, -50000);
    assert.equal(movs[0].quantidade_nao_fiscal, 0);
    assert.equal(movs[0].saldo_antes, 50000);
    assert.equal(movs[0].saldo_depois, 0);
    assert.equal(movs[0].referencia_tipo, 'ajuste_estoque');
    assert.ok(movs[0].motivo.startsWith(ORIGEM));
  });

  it('DEPOIS: saldo = 0 e o produto permanece ativo = 0', async () => {
    const p = await get('SELECT saldo_fiscal, saldo_nao_fiscal, estoque_atual, ativo FROM produtos WHERE id = ?', [ids.duplicado]);
    assert.deepEqual(p, { saldo_fiscal: 0, saldo_nao_fiscal: 0, estoque_atual: 0, ativo: 0 });
    const local = await MotorEstoque.consultarSaldoLocal(db, ids.duplicado, MotorEstoque.LOCAL_LOJA);
    assert.equal(local.estoqueAtual, 0);
  });

  it('o histórico de ajustes do produto mostra o saneamento', async () => {
    const resposta = await fetch(`${base}/produtos/${ids.duplicado}/historico-estoque`);
    assert.equal(resposta.status, 200);
    const historico = await resposta.json();
    assert.equal(historico.length, 1);
    assert.equal(historico[0].ajuste_fiscal, -50000);
    assert.equal(historico[0].estoque_total_antes, 50000);
    assert.equal(historico[0].estoque_total_depois, 0);
    assert.ok(historico[0].motivo.startsWith(ORIGEM));
  });

  it('estoque global cai exatamente 50.000 e os demais produtos ficam intactos', async () => {
    const globalDepois = (await get('SELECT SUM(estoque_atual) AS total FROM produtos')).total;
    assert.equal(globalAntes - globalDepois, 50000);
    assert.deepEqual(await get('SELECT * FROM produtos WHERE id = ?', [ids.original]), originalAntes);
    assert.deepEqual(await get('SELECT * FROM produtos WHERE id = ?', [ids.outro]), outroAntes);
    assert.equal((await get('SELECT COUNT(*) AS q FROM estoque_movimentacoes WHERE produto_id <> ?', [ids.duplicado])).q, 0);
  });

  it('repetir o saneamento não gera saldo negativo nem nova movimentação', async () => {
    await assert.rejects(
      MotorEstoque.ajustar(db, { produtoId: ids.duplicado, deltaFiscal: -1, motivo: MOTIVO, origem: ORIGEM }),
      /saldo fiscal negativo/
    );
    assert.equal((await get('SELECT COUNT(*) AS q FROM estoque_movimentacoes WHERE produto_id = ?', [ids.duplicado])).q, 1);
    assert.equal((await get('SELECT ativo FROM produtos WHERE id = ?', [ids.duplicado])).ativo, 0);
  });
});
