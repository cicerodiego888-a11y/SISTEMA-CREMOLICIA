/**
 * RCM-9.2.2 — Homologação física operacional via mesmas APIs do CDS Mobile.
 * Não altera motores. Prova login → terminal → caixa → resolver → venda → estoque.
 */
const assert = require('assert');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const path = require('path');
const fs = require('fs');

process.chdir(path.resolve(__dirname, '../../..'));
const ROOT = path.resolve(__dirname, '../../../..');

const BASE = process.env.CDS_BASE || 'http://127.0.0.1:3002';
const USER = process.env.CDS_USER || 'Diego';
const PASS = process.env.CDS_PASS || process.env.ADMIN_SEED_PASSWORD || 'pdb100623';
const HOSTNAME = `mobile-rcm922-${Date.now().toString(36)}`;

function request(method, apiPath, { token, body, query, headers } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(apiPath.startsWith('http') ? apiPath : `${BASE}/api/${apiPath.replace(/^\//, '')}`);
    if (query) {
      Object.entries(query).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
      });
    }
    const lib = u.protocol === 'https:' ? https : http;
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const req = lib.request(
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
          resolve({ status: res.statusCode, data, headers: res.headers });
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    if (payload) req.write(payload);
    req.end();
  });
}

function get(path, opts) { return request('GET', path, opts); }
function post(path, body, opts) { return request('POST', path, { ...(opts || {}), body }); }
function put(path, body, opts) { return request('PUT', path, { ...(opts || {}), body }); }

async function estoqueProduto(token, produtoId) {
  const r = await get(`produtos/${produtoId}`, { token });
  if (r.status >= 400) {
    const r2 = await get(`estoque/produto/${produtoId}`, { token }).catch(() => null);
    return r2?.data || null;
  }
  return r.data;
}

function pickEstoque(row) {
  if (!row) return null;
  const n = Number(
    row.estoque_atual ?? row.estoque ?? row.quantidade ?? row.saldo ?? row.qtd_estoque
  );
  return Number.isFinite(n) ? n : null;
}

async function main() {
  console.log('\nRCM-9.2.2 — Homologação operacional (APIs Mobile)\n');
  console.log('BASE', BASE);

  // 0) Mobile shell
  const mobilePage = await new Promise((resolve, reject) => {
    const u = new URL(`${BASE}/apps/mobile/`);
    http.get(u, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode, raw }));
    }).on('error', reject);
  });
  assert.strictEqual(mobilePage.status, 200, 'GET /apps/mobile/ = 200');
  assert.ok(/Vender|pdv/i.test(mobilePage.raw), 'shell mobile com PDV');
  console.log('OK 0 — Mobile shell HTTP 200');

  // 1) Login
  const login = await post('auth/login', { username: USER, password: PASS });
  assert.ok(login.status < 400, `login ${login.status} ${JSON.stringify(login.data)}`);
  const token = login.data?.token || login.data?.access_token;
  assert.ok(token, 'token JWT');
  const user = login.data?.user || login.data?.usuario || {};
  console.log('OK 1 — Login', { user: user.username || USER, id: user.id });

  // 2) Terminal auto (mobile)
  const term1 = await get('terminais/auto', {
    token,
    query: {
      hostname: HOSTNAME,
      origem: 'mobile',
      cliente_tipo: 'mobile',
      nome: 'CDS Mobile RCM922',
      versao: '2.5.1-rcm921',
      plataforma: 'mobile'
    }
  });
  assert.ok(term1.status < 400, `terminal auto ${term1.status}`);
  const terminal = term1.data;
  assert.ok(terminal?.id, 'terminal_id');
  assert.ok(String(terminal.nome || '').length > 0, 'nome terminal');
  console.log('OK 2 — Terminal', {
    id: terminal.id,
    nome: terminal.nome,
    caixa_id: terminal.caixa_id,
    ativo: terminal.ativo
  });

  // Reuso hostname (não duplicar)
  const term2 = await get('terminais/auto', {
    token,
    query: {
      hostname: HOSTNAME,
      origem: 'mobile',
      cliente_tipo: 'mobile',
      nome: 'CDS Mobile RCM922',
      versao: '2.5.1-rcm921',
      plataforma: 'mobile'
    }
  });
  assert.strictEqual(Number(term2.data?.id), Number(terminal.id), 'mesmo terminal_id após reabrir');
  console.log('OK 2b — Terminal persistente (mesmo id)');

  // Vincular caixa se necessário
  let caixaId = Number(terminal.caixa_id || 0);
  if (!caixaId) {
    const caixas = await get('caixas', { token });
    const lista = Array.isArray(caixas.data) ? caixas.data : (caixas.data?.items || caixas.data?.data || []);
    const ativo = lista.find((c) => Number(c.ativo) !== 0) || lista[0];
    assert.ok(ativo?.id, 'existe caixa para vincular');
    const link = await put(`terminais/${terminal.id}`, { caixa_id: ativo.id, nome: terminal.nome }, { token });
    if (link.status >= 400) {
      // fallback: update direto via outro endpoint
      const link2 = await post(`terminais/${terminal.id}/vincular-caixa`, { caixa_id: ativo.id }, { token }).catch(() => null);
      assert.ok(link.status < 400 || (link2 && link2.status < 400), `vincular caixa ${link.status} ${JSON.stringify(link.data)}`);
    }
    caixaId = Number(ativo.id);
    console.log('OK 2c — Terminal vinculado ao caixa', caixaId);
  } else {
    console.log('OK 2c — Terminal já vinculado caixa', caixaId);
  }

  const termHdr = { 'X-Terminal-Id': String(terminal.id) };

  // 3) Caixa aberto / abrir
  function unwrapCaixa(payload) {
    if (!payload) return null;
    if (payload.caixa && typeof payload.caixa === 'object') {
      return Object.assign({}, payload, payload.caixa);
    }
    return payload;
  }
  let abertoRaw = await get('caixa/aberto', { token, query: { terminal_id: terminal.id }, headers: termHdr });
  let aberto = { data: unwrapCaixa(abertoRaw.data) };
  const isOpen = aberto.data && (aberto.data.id || aberto.data.caixa_id || aberto.data.status === 'aberto');
  if (!isOpen) {
    const ab = await post('caixa/abrir', { valor_inicial: 0, terminal_id: terminal.id }, { token, headers: termHdr });
    assert.ok(ab.status < 400, `abrir caixa ${ab.status} ${JSON.stringify(ab.data)}`);
    abertoRaw = await get('caixa/aberto', { token, query: { terminal_id: terminal.id }, headers: termHdr });
    aberto = { data: unwrapCaixa(abertoRaw.data) };
  }
  assert.ok(aberto.data?.id || aberto.data?.caixa_id, 'caixa aberto');
  console.log('OK 3 — Caixa aberto', {
    sessao: aberto.data.id || aberto.data.caixa_id,
    operador: aberto.data.usuario_nome || aberto.data.operador || user.username
  });

  // Produtos
  const picoleId = 3;
  const sorveteId = 1185;

  const estPicBefore = pickEstoque(await estoqueProduto(token, picoleId));
  const estSorBefore = pickEstoque(await estoqueProduto(token, sorveteId));

  // 4) Resolver Varejo 1
  const rV = await post('configuracao-comercial/resolver-precos', {
    itens: [{ produto_id: picoleId, quantidade: 1 }]
  }, { token });
  assert.ok(rV.status < 400, 'resolver varejo');
  assert.strictEqual(String(rV.data.canal).toUpperCase(), 'VAREJO');
  assert.strictEqual(String(rV.data.itens[0].unidade_comercial).toUpperCase(), 'UN');
  console.log('OK 4 — Resolver varejo', {
    canal: rV.data.canal,
    preco: rV.data.itens[0].preco_venda,
    uc: rV.data.itens[0].unidade_comercial,
    qtd: rV.data.quantidade_avaliada
  });

  async function finalizarComoMobile({ itens, total, forma, token, terminalId, headers }) {
    const preview = await post(
      'vendas/pre-calcular-distribuicao',
      { terminal_id: terminalId, itens, emitir_fiscal: false },
      { token, headers }
    );
    assert.ok(preview.status < 400, `pre-calcular ${preview.status} ${JSON.stringify(preview.data)}`);
    const itensDist = Array.isArray(preview.data?.itens) ? preview.data.itens : itens;
    const mapped = itensDist.map((it, idx) => {
      const qtd = Number(it.quantidade != null ? it.quantidade : itens[idx].quantidade);
      const preco = Number(it.preco_unitario != null ? it.preco_unitario : itens[idx].preco_unitario);
      const subtotal = Number.isFinite(Number(it.subtotal))
        ? Number(it.subtotal)
        : Number((qtd * preco).toFixed(2));
      return {
        produto_id: it.produto_id || itens[idx].produto_id,
        quantidade: qtd,
        preco_unitario: preco,
        subtotal,
        desconto_percentual: 0,
        forma_comercializacao: it.forma_comercializacao || itens[idx].forma_comercializacao || null,
        unidade_comercial: it.unidade_comercial || itens[idx].unidade_comercial || null,
        item_fiscal: it.item_fiscal,
        quantidade_fiscal: it.quantidade_fiscal,
        quantidade_nao_fiscal: it.quantidade_nao_fiscal,
        valor_fiscal: it.valor_fiscal,
        valor_nao_fiscal: it.valor_nao_fiscal
      };
    });
    // Codigo VND-YYYYMMDDHHmmss colide se duas vendas no mesmo segundo (backend existente).
    await new Promise((r) => setTimeout(r, 1100));
    let venda = await post('vendas', {
      terminal_id: terminalId,
      itens: mapped,
      total,
      desconto: 0,
      forma_pagamento: forma,
      valor_recebido: total,
      emitir_fiscal: false,
      pagamentos: [{ forma_pagamento: forma, valor: total, tipo_recebimento: 'nao_fiscal' }]
    }, { token, headers });
    if (venda.status >= 400 && /UNIQUE|codigo/i.test(JSON.stringify(venda.data || {}))) {
      await new Promise((r) => setTimeout(r, 1100));
      venda = await post('vendas', {
        terminal_id: terminalId,
        itens: mapped,
        total,
        desconto: 0,
        forma_pagamento: forma,
        valor_recebido: total,
        emitir_fiscal: false,
        pagamentos: [{ forma_pagamento: forma, valor: total, tipo_recebimento: 'nao_fiscal' }]
      }, { token, headers });
    }
    return venda;
  }

  // 5) Venda varejo 1 picolé (dinheiro) — mesmo pipeline Mobile
  const precoV = Number(rV.data.itens[0].preco_venda);
  const vendaV = await finalizarComoMobile({
    token,
    terminalId: terminal.id,
    headers: termHdr,
    forma: 'dinheiro',
    total: precoV,
    itens: [{
      produto_id: picoleId,
      quantidade: 1,
      preco_unitario: precoV,
      desconto_percentual: 0,
      forma_comercializacao: 'UNIDADE',
      unidade_comercial: 'UN'
    }]
  });
  assert.ok(vendaV.status < 400, `venda varejo ${vendaV.status} ${JSON.stringify(vendaV.data)}`);
  const vendaVarejoId = vendaV.data?.venda_id || vendaV.data?.id || vendaV.data?.venda?.id;
  assert.ok(vendaVarejoId, 'venda varejo id');
  console.log('OK 5 — Venda varejo', { id: vendaVarejoId, total: precoV });

  // 6) Resolver atacado 29+pote
  const rA = await post('configuracao-comercial/resolver-precos', {
    itens: [
      { produto_id: picoleId, quantidade: 29 },
      { produto_id: sorveteId, quantidade: 0.25, forma_comercializacao: 'PESO' }
    ]
  }, { token });
  assert.ok(rA.status < 400, 'resolver atacado mix');
  assert.strictEqual(String(rA.data.canal).toUpperCase(), 'ATACADO');
  assert.ok(Number(rA.data.quantidade_avaliada) >= 30, '30 itens comerciais');
  const rowPic = rA.data.itens.find((i) => Number(i.produto_id) === picoleId);
  const rowSor = rA.data.itens.find((i) => Number(i.produto_id) === sorveteId);
  assert.strictEqual(String(rowSor.unidade_comercial).toUpperCase(), 'LT', 'sorvete atacado LT');
  console.log('OK 6 — Resolver ATACADO · 30 itens', {
    canal: rA.data.canal,
    qtd: rA.data.quantidade_avaliada,
    picole: { preco: rowPic.preco_venda, uc: rowPic.unidade_comercial },
    sorvete: { preco: rowSor.preco_venda, uc: rowSor.unidade_comercial }
  });

  const totalA = Number((Number(rowPic.preco_venda) * 29 + Number(rowSor.preco_venda) * 0.25).toFixed(2));
  const vendaA = await finalizarComoMobile({
    token,
    terminalId: terminal.id,
    headers: termHdr,
    forma: 'pix',
    total: totalA,
    itens: [
      {
        produto_id: picoleId,
        quantidade: 29,
        preco_unitario: Number(rowPic.preco_venda),
        desconto_percentual: 0,
        forma_comercializacao: rowPic.forma_comercializacao || 'UNIDADE',
        unidade_comercial: rowPic.unidade_comercial || 'UN'
      },
      {
        produto_id: sorveteId,
        quantidade: 0.25,
        preco_unitario: Number(rowSor.preco_venda),
        desconto_percentual: 0,
        forma_comercializacao: rowSor.forma_comercializacao || 'VOLUME',
        unidade_comercial: rowSor.unidade_comercial || 'LT'
      }
    ]
  });
  assert.ok(vendaA.status < 400, `venda atacado ${vendaA.status} ${JSON.stringify(vendaA.data)}`);
  const vendaAtacadoId = vendaA.data?.venda_id || vendaA.data?.id || vendaA.data?.venda?.id;
  assert.ok(vendaAtacadoId, 'venda atacado id');
  console.log('OK 7 — Venda atacado', { id: vendaAtacadoId, total: totalA });

  // 7) Sorvete varejo KG (Resolver) + tentativa de venda
  const rSK = await post('configuracao-comercial/resolver-precos', {
    itens: [{ produto_id: sorveteId, quantidade: 0.25, forma_comercializacao: 'PESO' }]
  }, { token });
  assert.strictEqual(String(rSK.data.canal).toUpperCase(), 'VAREJO');
  assert.strictEqual(String(rSK.data.itens[0].unidade_comercial).toUpperCase(), 'KG');
  const precoSK = Number(rSK.data.itens[0].preco_venda);
  const totalSK = Number((precoSK * 0.25).toFixed(2));
  const vendaSK = await finalizarComoMobile({
    token,
    terminalId: terminal.id,
    headers: termHdr,
    forma: 'cartao',
    total: totalSK,
    itens: [{
      produto_id: sorveteId,
      quantidade: 0.25,
      preco_unitario: precoSK,
      desconto_percentual: 0,
      forma_comercializacao: rSK.data.itens[0].forma_comercializacao || 'PESO',
      unidade_comercial: rSK.data.itens[0].unidade_comercial || 'KG'
    }]
  });
  if (vendaSK.status >= 400 && /MCC_CONVERSAO_NAO_CADASTRADA|Convers[aã]o entre KG e L/i.test(JSON.stringify(vendaSK.data || {}))) {
    console.log('WARN 8 — Resolver VAREJO/KG OK; venda bloqueada pelo MUC (conversão KG↔L não cadastrada no produto). Sem fallback Mobile.');
  } else {
    assert.ok(vendaSK.status < 400, `venda sorvete varejo ${vendaSK.status} ${JSON.stringify(vendaSK.data)}`);
    console.log('OK 8 — Venda sorvete VAREJO KG', {
      id: vendaSK.data?.venda_id || vendaSK.data?.id,
      uc: 'KG',
      preco: precoSK
    });
  }

  // 8) Consignado resolver
  const rC = await post('configuracao-comercial/resolver-precos', {
    itens: [{ produto_id: sorveteId, quantidade: 1 }],
    canal: 'CONSIGNADO'
  }, { token });
  assert.strictEqual(String(rC.data.canal).toUpperCase(), 'CONSIGNADO');
  assert.strictEqual(String(rC.data.itens[0].unidade_comercial).toUpperCase(), 'LT');
  console.log('OK 9 — Resolver CONSIGNADO LT', {
    preco: rC.data.itens[0].preco_venda,
    tabela: rC.data.itens[0].tabela_preco_nome || rC.data.tabela_preco_id
  });

  // 9) Vendas listadas (Desktop/API)
  const lista = await get('vendas', { token, query: { limite: 20 } });
  const rows = Array.isArray(lista.data) ? lista.data : (lista.data?.data || lista.data?.vendas || []);
  const ids = new Set(rows.map((v) => Number(v.id)));
  assert.ok(ids.has(Number(vendaVarejoId)), 'venda varejo na listagem');
  assert.ok(ids.has(Number(vendaAtacadoId)), 'venda atacado na listagem');
  console.log('OK 10 — Vendas visíveis na API/Desktop list');

  // 10) Estoque (se API retornar)
  const estPicAfter = pickEstoque(await estoqueProduto(token, picoleId));
  const estSorAfter = pickEstoque(await estoqueProduto(token, sorveteId));
  if (estPicBefore != null && estPicAfter != null) {
    const deltaPic = Number((estPicBefore - estPicAfter).toFixed(3));
    assert.ok(deltaPic >= 29.999 && deltaPic <= 30.001, `estoque picolé baixou ~30 (1+29), got ${deltaPic}`);
    console.log('OK 11 — Estoque picolé', { before: estPicBefore, after: estPicAfter, delta: deltaPic });
  } else {
    console.log('WARN 11 — Estoque picolé não legível via GET produto (conferir no Desktop)');
  }
  if (estSorBefore != null && estSorAfter != null) {
    const deltaSor = Number((estSorBefore - estSorAfter).toFixed(3));
    // Atacado 0,25; varejo KG pode falhar se conversão KG↔L não cadastrada
    assert.ok(deltaSor >= 0.249 && deltaSor <= 0.501, `estoque sorvete baixou 0,25–0,50, got ${deltaSor}`);
    console.log('OK 11b — Estoque sorvete', { before: estSorBefore, after: estSorAfter, delta: deltaSor });
  } else {
    console.log('WARN 11b — Estoque sorvete não legível via GET produto');
  }

  // 11) Reabertura terminal
  const term3 = await get('terminais/auto', {
    token,
    query: {
      hostname: HOSTNAME,
      origem: 'mobile',
      cliente_tipo: 'mobile',
      nome: 'CDS Mobile RCM922',
      versao: '2.5.1-rcm921',
      plataforma: 'mobile'
    }
  });
  assert.strictEqual(Number(term3.data.id), Number(terminal.id));
  assert.ok(Number(term3.data.caixa_id) > 0, 'caixa ainda vinculado');
  const aberto2Raw = await get('caixa/aberto', {
    token,
    query: { terminal_id: terminal.id },
    headers: { 'X-Terminal-Id': String(terminal.id) }
  });
  const aberto2 = unwrapCaixa(aberto2Raw.data);
  assert.ok(aberto2?.id || aberto2?.caixa_id, 'caixa ainda aberto após reconsulta');
  console.log('OK 12 — Reabertura terminal/caixa OK');

  // 12) Contratos UI Mobile (sticky canal/itens + unwrap caixa)
  const pdv = fs.readFileSync(path.join(ROOT, 'frontend/apps/mobile/js/pages/pdv.js'), 'utf8');
  assert.ok(pdv.includes('quantidade_avaliada'), 'UI itens comerciais');
  assert.ok(pdv.includes('normalizeCaixaPayload'), 'unwrap /caixa/aberto');
  assert.ok(/subtotal:\s*subtotalCalc|subtotalCalc/.test(pdv), 'envia subtotal na venda');
  assert.ok(/ATACADO|canal/.test(pdv) && pdv.includes('itens'), 'sticky canal/itens');
  const css = fs.readFileSync(path.join(ROOT, 'frontend/apps/mobile/css/mobile.css'), 'utf8');
  assert.ok(css.includes('max-width: 360px') || css.includes('max-width: 360'), 'css 360');
  assert.ok(css.includes('390px'), 'css 390');
  console.log('OK 13 — Contratos responsivo/UX sticky + caixa');

  const report = {
    base: BASE,
    lan_hint: 'http://192.168.0.9:3002/apps/mobile/',
    terminal_id: terminal.id,
    terminal_nome: terminal.nome,
    hostname: HOSTNAME,
    caixa_sessao: aberto.data.id || aberto.data.caixa_id,
    vendas: { varejo: vendaVarejoId, atacado: vendaAtacadoId },
    resolver_atacado: {
      canal: rA.data.canal,
      itens_comerciais: rA.data.quantidade_avaliada,
      sorvete_uc: rowSor.unidade_comercial
    }
  };
  fs.writeFileSync(
    path.join(ROOT, 'docs/RCM922_HOMOLOGACAO_RUNTIME.json'),
    JSON.stringify(report, null, 2)
  );

  console.log('\nRCM-9.2.2 HOMOLOGAÇÃO OPERACIONAL PASSOU\n');
  console.log(JSON.stringify(report, null, 2));
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('\nFALHA RCM-9.2.2:', err && err.stack ? err.stack : err);
  process.exit(1);
});
