/**
 * PDV — INSUMO não é comercializável.
 * Lista, busca, código, EAN, nome e MUC não oferecem INSUMO; a venda do PDV
 * com produto_id de INSUMO é rejeitada sem criar venda nem mover estoque.
 * PRODUZIDO continua vendável.
 * Banco temporário via tests/pdv/_bancoIsolado.js. Executar: npm run test:pdv-insumo
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
  console.error('Banco isolado ausente. Execute: node -r ./tests/pdv/_bancoIsolado.js --test tests/pdv/pdv-insumo-bloqueio.test.js');
  process.exit(1);
}
for (const sufixo of ['', '-wal', '-shm']) {
  fs.rmSync(path.join(process.env.DB_DIR, 'mercadao.db' + sufixo), { force: true });
}

const express = require('express');
const db = require('../../backend/database');
const {
  MENSAGEM_PRODUTO_INSUMO_PDV,
  CODIGO_PRODUTO_INSUMO_PDV,
  listarInsumosEntreProdutos,
  sqlProdutoComercializavelPdv
} = require('../../backend/services/pdv/produtoComercializavelPdv');

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

const ids = {};
let servidor;
let base;

async function criarProduto(dados) {
  const r = await run(
    `INSERT INTO produtos (codigo, codigo_barras, nome, unidade, preco_venda, preco_compra,
       saldo_fiscal, saldo_nao_fiscal, estoque_atual, ativo, natureza_cadastro, item_fiscal)
     VALUES (?, ?, ?, 'UN', ?, 1, 0, 50, 50, 1, ?, 0)`,
    [dados.codigo, dados.codigo_barras || null, dados.nome, dados.preco || 10, dados.natureza]
  );
  return r.id;
}

function chamarServico(fn, body, headers = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); return this; }
    };
    fn({ body, headers, query: {}, user: { id: 1 } }, res);
  });
}

async function getJson(rota) {
  const resposta = await fetch(base + rota);
  return { status: resposta.status, body: await resposta.json().catch(() => null) };
}

before(async () => {
  assert.ok(path.resolve(db.dbPath).toLowerCase().startsWith(TMP), `banco fora do temp: ${db.dbPath}`);
  await new Promise((resolve) => db.whenReady(() => resolve()));

  await run(`CREATE TABLE IF NOT EXISTS produto_unidades (
    id INTEGER PRIMARY KEY AUTOINCREMENT, produto_id INTEGER NOT NULL, unidade TEXT NOT NULL,
    descricao TEXT, fator_conversao REAL NOT NULL DEFAULT 1, preco REAL DEFAULT 0,
    codigo_barras TEXT, codigo_auxiliar TEXT, principal INTEGER DEFAULT 0, ativo INTEGER DEFAULT 1,
    ordem INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);

  ids.insumo = await criarProduto({ codigo: 'INS-LEITE', codigo_barras: '7891000100103', nome: 'Leite em pó insumo', natureza: 'INSUMO' });
  ids.produzido = await criarProduto({ codigo: 'PRD-POTE', codigo_barras: '7891000200209', nome: 'Pote sorvete produzido', natureza: 'PRODUZIDO' });
  ids.comercial = await criarProduto({ codigo: 'COM-AGUA', nome: 'Água comercial', natureza: 'COMERCIAL' });
  await run(
    `INSERT INTO produto_unidades (produto_id, unidade, fator_conversao, codigo_barras, ativo)
     VALUES (?, 'CX', 12, '17891000100100', 1)`,
    [ids.insumo]
  );

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

describe('Lista e busca do PDV (backend)', () => {
  it('TESTE A — GET /produtos?contexto=pdv não traz INSUMO; sem contexto o ERP continua vendo', async () => {
    const pdv = await getJson('/produtos?modo_fiscal=0&contexto=pdv');
    assert.equal(pdv.status, 200);
    const idsPdv = pdv.body.map((p) => p.id);
    assert.ok(!idsPdv.includes(ids.insumo));
    assert.ok(idsPdv.includes(ids.produzido));
    assert.ok(idsPdv.includes(ids.comercial));

    const erp = await getJson('/produtos?modo_fiscal=0');
    assert.ok(erp.body.map((p) => p.id).includes(ids.insumo));
  });

  it('TESTE B — código do INSUMO não retorna candidato na consulta do PDV', async () => {
    const r = await getJson('/produtos/consulta-pdv/buscar?q=INS-LEITE&modo_fiscal=0');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, []);
  });

  it('TESTE C — EAN do INSUMO não retorna candidato', async () => {
    const r = await getJson('/produtos/consulta-pdv/buscar?q=7891000100103&modo_fiscal=0');
    assert.deepEqual(r.body, []);
  });

  it('TESTE D — nome do INSUMO não aparece (consulta PDV e /search com contexto=pdv)', async () => {
    const consulta = await getJson('/produtos/consulta-pdv/buscar?q=leite&modo_fiscal=0');
    assert.ok(!consulta.body.some((p) => p.id === ids.insumo));
    const lip = await getJson('/produtos/search?q=leite&contexto=pdv');
    assert.ok(!lip.body.items.some((p) => p.id === ids.insumo));
  });

  it('/produtos/search sem contexto=pdv continua listando INSUMO (Ficha Técnica, Transferências)', async () => {
    const lip = await getJson('/produtos/search?q=leite');
    assert.ok(lip.body.items.some((p) => p.id === ids.insumo));
  });

  it('TESTE E — código de barras da unidade (MUC) do INSUMO é bloqueado', async () => {
    const consulta = await getJson('/produtos/consulta-pdv/buscar?q=17891000100100&modo_fiscal=0');
    assert.ok(!consulta.body.some((p) => p.id === ids.insumo));
    const muc = await getJson('/produtos/muc/barras/17891000100100?contexto=pdv');
    assert.equal(muc.status, 409);
    assert.equal(muc.body.error, MENSAGEM_PRODUTO_INSUMO_PDV);
    assert.equal(muc.body.codigo, CODIGO_PRODUTO_INSUMO_PDV);
  });

  it('TESTE G — PRODUZIDO continua disponível por código, EAN e nome', async () => {
    const codigo = await getJson('/produtos/consulta-pdv/buscar?q=PRD-POTE&modo_fiscal=0');
    assert.equal(codigo.body.length, 1);
    assert.equal(codigo.body[0].id, ids.produzido);
    assert.equal(codigo.body[0].match_exato, 1);
    const ean = await getJson('/produtos/consulta-pdv/buscar?q=7891000200209&modo_fiscal=0');
    assert.equal(ean.body[0].id, ids.produzido);
    const nome = await getJson('/produtos/search?q=pote&contexto=pdv');
    assert.ok(nome.body.items.some((p) => p.id === ids.produzido));
  });
});

describe('Salvamento da venda (backend)', () => {
  const VendaPagamentoService = require('../../backend/services/vendas/VendaPagamentoService');

  function corpoVenda(produtoId, extra = {}) {
    return {
      total: 10,
      forma_pagamento: 'dinheiro',
      itens: [{ produto_id: produtoId, quantidade: 1, preco_unitario: 10, subtotal: 10 }],
      pagamentos: [{ forma: 'dinheiro', valor: 10 }],
      valor_recebido: 10,
      emitir_fiscal: false,
      ...extra
    };
  }

  it('TESTE F — venda do PDV com produto_id de INSUMO é rejeitada sem criar venda nem mover estoque', async () => {
    const vendasAntes = (await get('SELECT COUNT(*) AS n FROM vendas')).n;
    const saldoAntes = await get('SELECT saldo_fiscal, saldo_nao_fiscal, estoque_atual FROM produtos WHERE id = ?', [ids.insumo]);

    for (const origem of [undefined, 'PDV_DESKTOP', 'PDV_MOBILE']) {
      const r = await chamarServico(VendaPagamentoService.criarVenda, corpoVenda(ids.insumo, origem ? { origem_pdv: origem } : {}));
      assert.equal(r.status, 409, `origem ${origem}`);
      assert.equal(r.body.error, MENSAGEM_PRODUTO_INSUMO_PDV);
      assert.equal(r.body.codigo, CODIGO_PRODUTO_INSUMO_PDV);
      assert.deepEqual(r.body.itens.map((i) => i.produto_id), [ids.insumo]);
    }

    const mobile = await chamarServico(VendaPagamentoService.criarVenda, corpoVenda(ids.insumo), { 'x-cds-client': 'mobile' });
    assert.equal(mobile.status, 409);

    assert.equal((await get('SELECT COUNT(*) AS n FROM vendas')).n, vendasAntes);
    assert.deepEqual(
      await get('SELECT saldo_fiscal, saldo_nao_fiscal, estoque_atual FROM produtos WHERE id = ?', [ids.insumo]),
      saldoAntes
    );
  });

  it('TESTE F — INSUMO misturado com PRODUZIDO também rejeita a venda inteira', async () => {
    const corpo = corpoVenda(ids.produzido);
    corpo.total = 20;
    corpo.pagamentos = [{ forma: 'dinheiro', valor: 20 }];
    corpo.itens.push({ produto_id: ids.insumo, quantidade: 1, preco_unitario: 10, subtotal: 10 });
    const r = await chamarServico(VendaPagamentoService.criarVenda, corpo);
    assert.equal(r.status, 409);
    assert.deepEqual(r.body.itens.map((i) => i.produto_id), [ids.insumo]);
  });

  it('pré-cálculo do PDV também rejeita INSUMO', async () => {
    const r = await chamarServico(VendaPagamentoService.preCalcularDistribuicao, {
      itens: [{ produto_id: ids.insumo, quantidade: 1, preco_unitario: 10 }],
      emitir_fiscal: false
    });
    assert.equal(r.status, 409);
    assert.equal(r.body.error, MENSAGEM_PRODUTO_INSUMO_PDV);
  });

  it('TESTE H — venda do PDV com PRODUZIDO é gravada normalmente', async () => {
    const vendasAntes = (await get('SELECT COUNT(*) AS n FROM vendas')).n;
    const r = await chamarServico(VendaPagamentoService.criarVenda, corpoVenda(ids.produzido, { origem_pdv: 'PDV_DESKTOP' }));
    assert.ok(r.status < 300, `status ${r.status}: ${JSON.stringify(r.body)}`);
    assert.equal((await get('SELECT COUNT(*) AS n FROM vendas')).n, vendasAntes + 1);
    const item = await get('SELECT produto_id FROM vendas_itens ORDER BY id DESC LIMIT 1');
    assert.equal(item.produto_id, ids.produzido);
  });
});

describe('Regra SQL e consulta de insumos', () => {
  it('listarInsumosEntreProdutos devolve só INSUMO', async () => {
    const r = await listarInsumosEntreProdutos(db, [ids.insumo, ids.produzido, ids.comercial, 999999]);
    assert.deepEqual(r.map((i) => i.produto_id), [ids.insumo]);
  });

  it('filtro SQL aceita natureza em minúsculas/espaços e natureza vazia', async () => {
    await run(`UPDATE produtos SET natureza_cadastro = ' insumo ' WHERE id = ?`, [ids.insumo]);
    await run(`UPDATE produtos SET natureza_cadastro = NULL WHERE id = ?`, [ids.comercial]);
    const linhas = await all(`SELECT p.id FROM produtos p WHERE ${sqlProdutoComercializavelPdv('p')} AND p.id IN (?, ?, ?)`,
      [ids.insumo, ids.produzido, ids.comercial]);
    assert.deepEqual(linhas.map((l) => l.id).sort((a, b) => a - b), [ids.produzido, ids.comercial].sort((a, b) => a - b));
    await run(`UPDATE produtos SET natureza_cadastro = 'INSUMO' WHERE id = ?`, [ids.insumo]);
    await run(`UPDATE produtos SET natureza_cadastro = 'COMERCIAL' WHERE id = ?`, [ids.comercial]);
  });
});
