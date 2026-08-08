/**
 * RCM-9.2.3 — Homologação sorvete #1185 após cadastro LT→KG 0,58
 * + regressão contagem Atacado (sem alterar Resolver).
 */
const assert = require('assert');
const http = require('http');
const { URL } = require('url');
const path = require('path');

process.chdir(path.resolve(__dirname, '../../..'));
const db = require('../../../database');
const cfg = require('../configuracao/ConfiguracaoComercialService');
const { contribuicaoContagemAtacado } = require('../preco/CanalVendaResolver');
const muc = require('../../../motores/muc');

const BASE = process.env.CDS_BASE || 'http://127.0.0.1:3002';
const USER = process.env.CDS_USER || 'Diego';
const PASS = process.env.CDS_PASS || process.env.ADMIN_SEED_PASSWORD || 'pdb100623';
const PICOLE = 3;
const SORVETE = 1185;

function getDb(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

async function waitDb() {
  for (let i = 0; i < 60; i++) {
    try {
      await getDb('SELECT 1');
      return;
    } catch (_) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error('DB não pronto');
}

function request(method, apiPath, { token, body, query, headers } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(`${BASE}/api/${apiPath.replace(/^\//, '')}`);
    if (query) {
      Object.entries(query).forEach(([k, v]) => {
        if (v != null && v !== '') u.searchParams.set(k, String(v));
      });
    }
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const req = http.request(
      {
        method,
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        headers: {
          Accept: 'application/json',
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'X-CDS-Client': 'mobile',
          ...(headers || {})
        },
        timeout: 30000
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => { raw += c; });
        res.on('end', () => {
          let data = null;
          try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
          resolve({ status: res.statusCode, data });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function unwrapCaixa(payload) {
  if (!payload) return null;
  if (payload.caixa && typeof payload.caixa === 'object') {
    return Object.assign({}, payload, payload.caixa);
  }
  return payload;
}

async function main() {
  await waitDb();
  console.log('\nRCM-9.2.3 — Homologação sorvete KG/LT + regressão\n');

  // —— Cadastro conversão ——
  const convs = await muc.listarConversoesAtivas(db, SORVETE);
  const tem = (convs || []).some((c) => {
    const o = String(c.origem || '').toUpperCase();
    const d = String(c.destino || '').toUpperCase();
    return (o === 'LT' || o === 'L') && d === 'KG' && Math.abs(Number(c.fator) - 0.58) < 1e-9;
  });
  assert.ok(tem, 'produto #1185 deve ter LT→KG 0,58 (RCM-8.9)');
  console.log('OK 1 — Cadastro LT→KG 0,58 presente');

  // —— Resolver (não alterar) ——
  const rV = await cfg.resolverPrecosVenda({
    itens: [{ produto_id: SORVETE, quantidade: 0.25 }]
  });
  assert.strictEqual(String(rV.canal).toUpperCase(), 'VAREJO');
  assert.strictEqual(String(rV.itens[0].unidade_comercial).toUpperCase(), 'KG');
  console.log('OK 2 — Resolver Varejo KG', { preco: rV.itens[0].preco_venda });

  const rA = await cfg.resolverPrecosVenda({
    itens: [
      { produto_id: PICOLE, quantidade: 29 },
      { produto_id: SORVETE, quantidade: 0.25 }
    ]
  });
  assert.strictEqual(String(rA.canal).toUpperCase(), 'ATACADO');
  assert.ok(Number(rA.quantidade_avaliada) >= 30);
  const rowSorA = rA.itens.find((i) => Number(i.produto_id) === SORVETE);
  assert.strictEqual(String(rowSorA.unidade_comercial).toUpperCase(), 'LT');
  console.log('OK 3 — Resolver Atacado LT · 30 itens');

  const rC = await cfg.resolverPrecosVenda({
    itens: [{ produto_id: SORVETE, quantidade: 1 }],
    canal: 'CONSIGNADO'
  });
  assert.strictEqual(String(rC.canal).toUpperCase(), 'CONSIGNADO');
  assert.strictEqual(String(rC.itens[0].unidade_comercial).toUpperCase(), 'LT');
  console.log('OK 4 — Resolver Consignado LT');

  // —— Regressão contagem ——
  assert.strictEqual(
    [{ forma_comercializacao: 'UNIDADE', quantidade: 30 }].reduce((a, i) => a + contribuicaoContagemAtacado(i), 0),
    30
  );
  assert.strictEqual(
    [
      { forma_comercializacao: 'UNIDADE', quantidade: 29 },
      { forma_comercializacao: 'PESO', quantidade: 0.25 }
    ].reduce((a, i) => a + contribuicaoContagemAtacado(i), 0),
    30
  );
  assert.strictEqual(
    [{ forma_comercializacao: 'UNIDADE', quantidade: 29 }].reduce((a, i) => a + contribuicaoContagemAtacado(i), 0),
    29
  );
  console.log('OK 5 — Regressão contagem 30 / 29+pote / 29');

  // —— Venda real via API Mobile (se servidor up) ——
  let serverUp = false;
  try {
    await new Promise((resolve, reject) => {
      const req = http.get(`${BASE}/apps/mobile/`, (res) => {
        res.resume();
        serverUp = res.statusCode === 200;
        resolve();
      });
      req.on('error', reject);
      req.setTimeout(3000, () => { req.destroy(new Error('timeout')); });
    });
  } catch (_) {
    serverUp = false;
  }

  if (!serverUp) {
    console.log('WARN — servidor HTTP off; venda física API adiada (cadastro+Resolver OK)');
    console.log('\nRCM-9.2.3 PARCIAL (sem HTTP)\n');
    process.exit(0);
  }

  const login = await request('POST', 'auth/login', { body: { username: USER, password: PASS } });
  assert.ok(login.status < 400, 'login');
  const token = login.data.token;
  const host = `mobile-rcm923-${Date.now().toString(36)}`;
  const term = await request('GET', 'terminais/auto', {
    token,
    query: {
      hostname: host,
      origem: 'mobile',
      cliente_tipo: 'mobile',
      nome: 'CDS Mobile RCM923',
      versao: '2.5.3-rcm923',
      plataforma: 'mobile'
    }
  });
  assert.ok(term.data?.id);
  if (!term.data.caixa_id) {
    const put = await request('PUT', `terminais/${term.data.id}`, {
      token,
      body: { caixa_id: 4, nome: term.data.nome }
    });
    assert.ok(put.status < 400, `vincular ${put.status}`);
  }
  const hdr = { 'X-Terminal-Id': String(term.data.id) };
  let aberto = unwrapCaixa((await request('GET', 'caixa/aberto', {
    token, query: { terminal_id: term.data.id }, headers: hdr
  })).data);
  if (!(aberto?.id || aberto?.caixa_id)) {
    const ab = await request('POST', 'caixa/abrir', {
      token, headers: hdr, body: { valor_inicial: 0, terminal_id: term.data.id }
    });
    assert.ok(ab.status < 400, `abrir ${ab.status} ${JSON.stringify(ab.data)}`);
    aberto = unwrapCaixa((await request('GET', 'caixa/aberto', {
      token, query: { terminal_id: term.data.id }, headers: hdr
    })).data);
  }
  assert.ok(aberto?.id || aberto?.caixa_id, 'caixa aberto');

  const estBefore = await getDb('SELECT estoque_atual FROM produtos WHERE id = ?', [SORVETE]);
  const before = Number(estBefore.estoque_atual);

  const preco = Number(rV.itens[0].preco_venda);
  const qtd = 0.25;
  const total = Number((preco * qtd).toFixed(2));
  const itens = [{
    produto_id: SORVETE,
    quantidade: qtd,
    preco_unitario: preco,
    subtotal: total,
    desconto_percentual: 0,
    forma_comercializacao: 'PESO',
    unidade_comercial: 'KG'
  }];

  await new Promise((r) => setTimeout(r, 1100));
  const preview = await request('POST', 'vendas/pre-calcular-distribuicao', {
    token, headers: hdr, body: { terminal_id: term.data.id, itens, emitir_fiscal: false }
  });
  assert.ok(preview.status < 400, `precalc ${preview.status} ${JSON.stringify(preview.data)}`);
  const mapped = (preview.data.itens || itens).map((it) => {
    const q = Number(it.quantidade != null ? it.quantidade : qtd);
    const p = Number(it.preco_unitario != null ? it.preco_unitario : preco);
    return {
      produto_id: SORVETE,
      quantidade: q,
      preco_unitario: p,
      subtotal: Number.isFinite(Number(it.subtotal)) ? Number(it.subtotal) : Number((q * p).toFixed(2)),
      desconto_percentual: 0,
      forma_comercializacao: it.forma_comercializacao || 'PESO',
      unidade_comercial: it.unidade_comercial || 'KG',
      item_fiscal: it.item_fiscal,
      quantidade_fiscal: it.quantidade_fiscal,
      quantidade_nao_fiscal: it.quantidade_nao_fiscal,
      valor_fiscal: it.valor_fiscal,
      valor_nao_fiscal: it.valor_nao_fiscal
    };
  });

  const venda = await request('POST', 'vendas', {
    token,
    headers: hdr,
    body: {
      terminal_id: term.data.id,
      itens: mapped,
      total,
      desconto: 0,
      forma_pagamento: 'dinheiro',
      valor_recebido: total,
      emitir_fiscal: false,
      pagamentos: [{ forma_pagamento: 'dinheiro', valor: total, tipo_recebimento: 'nao_fiscal' }]
    }
  });
  assert.ok(venda.status < 400, `venda KG ${venda.status} ${JSON.stringify(venda.data)}`);
  const vendaId = venda.data?.venda_id || venda.data?.id;
  console.log('OK 6 — Venda Varejo KG', { id: vendaId, total });

  const estAfter = await getDb('SELECT estoque_atual FROM produtos WHERE id = ?', [SORVETE]);
  const after = Number(estAfter.estoque_atual);
  const delta = Number((before - after).toFixed(6));
  const esperado = Number((0.25 / 0.58).toFixed(6));
  assert.ok(Math.abs(delta - esperado) < 1e-3, `estoque baixou ${esperado} L (0,25 KG / 0,58), got ${delta}`);
  console.log('OK 7 — Estoque', { before, after, delta, esperadoL: esperado });

  // Sticky contrato Mobile
  const fs = require('fs');
  const ROOT = path.resolve(__dirname, '../../../..');
  const pdv = fs.readFileSync(path.join(ROOT, 'frontend/apps/mobile/js/pages/pdv.js'), 'utf8');
  assert.ok(pdv.includes('quantidade_avaliada') && pdv.includes('normalizeCaixaPayload'));
  console.log('OK 8 — Contratos Mobile sticky/caixa');

  console.log('\nRCM-9.2.3 HOMOLOGAÇÃO PASSOU\n');
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('\nFALHA RCM-9.2.3:', err && err.stack ? err.stack : err);
  process.exit(1);
});
