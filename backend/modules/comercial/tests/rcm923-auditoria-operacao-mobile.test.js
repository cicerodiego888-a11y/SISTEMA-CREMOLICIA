/**
 * RCM-9.2.3 — Auditoria de operação real do CDS Mobile
 * Mesmas APIs do cliente Mobile: login → terminal → caixa → resolver →
 * venda → pagamento → estoque → listagem Desktop → reabertura → 2ª venda.
 * Não altera motores / Resolver / MUC / Contagem / arquitetura.
 */
const assert = require('assert');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const path = require('path');
const fs = require('fs');
const os = require('os');

process.chdir(path.resolve(__dirname, '../../..'));
const ROOT = path.resolve(__dirname, '../../../..');

const BASE = process.env.CDS_BASE || 'http://127.0.0.1:3002';
const USER = process.env.CDS_USER || 'Diego';
const PASS = process.env.CDS_PASS || process.env.ADMIN_SEED_PASSWORD || 'pdb100623';
const HOSTNAME = `mobile-rcm923-${Date.now().toString(36)}`;
const PICOLE = 3;
const SORVETE = 1185;

const evidence = {
  sprint: 'RCM-9.2.3',
  started_at: new Date().toISOString(),
  base: BASE,
  hostname_simulado: HOSTNAME,
  checks: {},
  vendas: {},
  estoque: {},
  problemas: [],
  correcoes: []
};

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
        timeout: 45000
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

function get(p, opts) { return request('GET', p, opts); }
function post(p, body, opts) { return request('POST', p, { ...(opts || {}), body }); }
function put(p, body, opts) { return request('PUT', p, { ...(opts || {}), body }); }

function unwrapCaixa(payload) {
  if (!payload) return null;
  if (payload.caixa && typeof payload.caixa === 'object') {
    return Object.assign({}, payload, payload.caixa);
  }
  return payload;
}

function pickEstoque(row) {
  if (!row) return null;
  const n = Number(row.estoque_atual ?? row.estoque ?? row.quantidade ?? row.saldo ?? row.qtd_estoque);
  return Number.isFinite(n) ? n : null;
}

async function estoqueProduto(token, produtoId) {
  const r = await get(`produtos/${produtoId}`, { token });
  if (r.status >= 400) {
    const r2 = await get(`estoque/produto/${produtoId}`, { token }).catch(() => null);
    return r2?.data || null;
  }
  return r.data;
}

async function detalheVenda(token, id) {
  const r = await get(`vendas/${id}`, { token });
  if (r.status < 400) return r.data;
  const r2 = await get(`vendas/${id}/detalhe`, { token }).catch(() => null);
  return r2?.data || null;
}

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
  await new Promise((r) => setTimeout(r, 1100));
  let venda = await post('vendas', {
    terminal_id: terminalId,
    itens: mapped,
    total,
    subtotal: total,
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
      subtotal: total,
      desconto: 0,
      forma_pagamento: forma,
      valor_recebido: total,
      emitir_fiscal: false,
      pagamentos: [{ forma_pagamento: forma, valor: total, tipo_recebimento: 'nao_fiscal' }]
    }, { token, headers });
  }
  return { venda, mapped, preview };
}

function mark(key, ok, detail) {
  evidence.checks[key] = { ok: !!ok, detail: detail || null };
  console.log(ok ? `OK — ${key}` : `FAIL — ${key}`, detail || '');
}

async function main() {
  console.log('\nRCM-9.2.3 — Auditoria operação real CDS Mobile\n');
  console.log('BASE', BASE);
  console.log('host', os.hostname());

  // Shell Mobile
  const mobilePage = await new Promise((resolve, reject) => {
    const u = new URL(`${BASE}/apps/mobile/`);
    http.get(u, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode, raw }));
    }).on('error', reject);
  });
  mark('mobile_shell', mobilePage.status === 200, { status: mobilePage.status });

  // 1) Login
  const login = await post('auth/login', { username: USER, password: PASS });
  const token = login.data?.token || login.data?.access_token;
  assert.ok(login.status < 400 && token, `login ${login.status}`);
  const user = login.data?.user || login.data?.usuario || {};
  mark('login', true, { user: user.username || USER, id: user.id });

  // 2) Terminal
  const termQ = {
    hostname: HOSTNAME,
    origem: 'mobile',
    cliente_tipo: 'mobile',
    nome: 'CDS Mobile RCM923',
    versao: '2.5.3-rcm923',
    plataforma: 'mobile'
  };
  const term1 = await get('terminais/auto', { token, query: termQ });
  assert.ok(term1.status < 400 && term1.data?.id, `terminal ${term1.status}`);
  const terminal = term1.data;
  mark('terminal', true, {
    id: terminal.id,
    nome: terminal.nome,
    caixa_id: terminal.caixa_id,
    ativo: terminal.ativo
  });

  let caixaId = Number(terminal.caixa_id || 0);
  if (!caixaId) {
    const caixas = await get('caixas', { token });
    const lista = Array.isArray(caixas.data) ? caixas.data : (caixas.data?.items || caixas.data?.data || []);
    const ativo = lista.find((c) => Number(c.ativo) !== 0) || lista[0];
    assert.ok(ativo?.id, 'caixa para vincular');
    const link = await put(`terminais/${terminal.id}`, { caixa_id: ativo.id, nome: terminal.nome }, { token });
    if (link.status >= 400) {
      await post(`terminais/${terminal.id}/vincular-caixa`, { caixa_id: ativo.id }, { token }).catch(() => null);
    }
    caixaId = Number(ativo.id);
  }
  mark('caixa_vinculado', caixaId > 0, { caixa_id: caixaId });

  const termHdr = { 'X-Terminal-Id': String(terminal.id) };

  // 3) Caixa aberto
  let abertoRaw = await get('caixa/aberto', { token, query: { terminal_id: terminal.id }, headers: termHdr });
  let aberto = unwrapCaixa(abertoRaw.data);
  if (!(aberto && (aberto.id || aberto.caixa_id || aberto.status === 'aberto'))) {
    const ab = await post('caixa/abrir', { valor_inicial: 0, terminal_id: terminal.id }, { token, headers: termHdr });
    assert.ok(ab.status < 400, `abrir caixa ${ab.status} ${JSON.stringify(ab.data)}`);
    abertoRaw = await get('caixa/aberto', { token, query: { terminal_id: terminal.id }, headers: termHdr });
    aberto = unwrapCaixa(abertoRaw.data);
  }
  const sessaoId = aberto?.id || aberto?.caixa_id;
  assert.ok(sessaoId, 'caixa aberto');
  mark('caixa_aberto', true, {
    sessao: sessaoId,
    operador: aberto.usuario_nome || aberto.operador || user.username,
    status_ui: 'CAIXA_ABERTO / 🟢'
  });
  evidence.terminal = { id: terminal.id, nome: terminal.nome, caixa_id: caixaId, sessao: sessaoId };

  const estPicBefore = pickEstoque(await estoqueProduto(token, PICOLE));
  const estSorBefore = pickEstoque(await estoqueProduto(token, SORVETE));
  evidence.estoque.before = { picole: estPicBefore, sorvete: estSorBefore };

  // 4) Venda Varejo 1 picolé
  const rV = await post('configuracao-comercial/resolver-precos', {
    itens: [{ produto_id: PICOLE, quantidade: 1 }]
  }, { token });
  assert.ok(rV.status < 400, 'resolver varejo');
  assert.strictEqual(String(rV.data.canal).toUpperCase(), 'VAREJO');
  assert.strictEqual(String(rV.data.itens[0].unidade_comercial).toUpperCase(), 'UN');
  const precoV = Number(rV.data.itens[0].preco_venda);
  mark('venda_varejo_resolver', true, {
    canal: rV.data.canal,
    preco: precoV,
    uc: rV.data.itens[0].unidade_comercial,
    qtd_avaliada: rV.data.quantidade_avaliada
  });

  const { venda: vendaV } = await finalizarComoMobile({
    token,
    terminalId: terminal.id,
    headers: termHdr,
    forma: 'dinheiro',
    total: precoV,
    itens: [{
      produto_id: PICOLE,
      quantidade: 1,
      preco_unitario: precoV,
      desconto_percentual: 0,
      forma_comercializacao: 'UNIDADE',
      unidade_comercial: 'UN'
    }]
  });
  assert.ok(vendaV.status < 400, `venda varejo ${vendaV.status} ${JSON.stringify(vendaV.data)}`);
  const vendaVarejoId = vendaV.data?.venda_id || vendaV.data?.id || vendaV.data?.venda?.id;
  assert.ok(vendaVarejoId, 'id varejo');
  evidence.vendas.varejo = { id: vendaVarejoId, total: precoV, forma: 'dinheiro', canal: 'VAREJO' };
  mark('venda_varejo', true, evidence.vendas.varejo);
  mark('pagamento_varejo', true, { forma: 'dinheiro', valor: precoV });

  // 5) Venda Atacado 29 + pote 0,25
  const rA = await post('configuracao-comercial/resolver-precos', {
    itens: [
      { produto_id: PICOLE, quantidade: 29 },
      { produto_id: SORVETE, quantidade: 0.25, forma_comercializacao: 'PESO' }
    ]
  }, { token });
  assert.ok(rA.status < 400, 'resolver atacado');
  assert.strictEqual(String(rA.data.canal).toUpperCase(), 'ATACADO');
  assert.ok(Number(rA.data.quantidade_avaliada) >= 30, '30 itens comerciais');
  const rowPic = rA.data.itens.find((i) => Number(i.produto_id) === PICOLE);
  const rowSor = rA.data.itens.find((i) => Number(i.produto_id) === SORVETE);
  assert.strictEqual(String(rowSor.unidade_comercial).toUpperCase(), 'LT');
  assert.strictEqual(String(rowPic.unidade_comercial).toUpperCase(), 'UN');
  const totalA = Number((Number(rowPic.preco_venda) * 29 + Number(rowSor.preco_venda) * 0.25).toFixed(2));
  mark('venda_atacado_resolver', true, {
    canal: rA.data.canal,
    itens_comerciais: rA.data.quantidade_avaliada,
    picole: { qtd: 29, uc: rowPic.unidade_comercial, preco: rowPic.preco_venda },
    pote: { qtd_estoque_kg: 0.25, uc: rowSor.unidade_comercial, preco: rowSor.preco_venda, item_comercial: 1 }
  });

  const { venda: vendaA } = await finalizarComoMobile({
    token,
    terminalId: terminal.id,
    headers: termHdr,
    forma: 'pix',
    total: totalA,
    itens: [
      {
        produto_id: PICOLE,
        quantidade: 29,
        preco_unitario: Number(rowPic.preco_venda),
        desconto_percentual: 0,
        forma_comercializacao: rowPic.forma_comercializacao || 'UNIDADE',
        unidade_comercial: rowPic.unidade_comercial || 'UN'
      },
      {
        produto_id: SORVETE,
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
  assert.ok(vendaAtacadoId, 'id atacado');
  evidence.vendas.atacado = {
    id: vendaAtacadoId,
    total: totalA,
    forma: 'pix',
    canal: 'ATACADO',
    itens_comerciais: rA.data.quantidade_avaliada
  };
  mark('venda_atacado', true, evidence.vendas.atacado);
  mark('pagamento_atacado', true, { forma: 'pix', valor: totalA });
  mark('contagem_30', Number(rA.data.quantidade_avaliada) >= 30, {
    quantidade_avaliada: rA.data.quantidade_avaliada
  });

  // 6) Estoque
  const estPicAfterAtac = pickEstoque(await estoqueProduto(token, PICOLE));
  const estSorAfterAtac = pickEstoque(await estoqueProduto(token, SORVETE));
  evidence.estoque.after_atacado = { picole: estPicAfterAtac, sorvete: estSorAfterAtac };
  if (estPicBefore != null && estPicAfterAtac != null) {
    const deltaPic = Number((estPicBefore - estPicAfterAtac).toFixed(3));
    // 1 varejo + 29 atacado = 30 UN
    const okPic = deltaPic >= 29.999 && deltaPic <= 30.001;
    mark('estoque_picole', okPic, { before: estPicBefore, after: estPicAfterAtac, delta: deltaPic, esperado: 30 });
    if (!okPic) evidence.problemas.push({ tipo: 'estoque', msg: `delta picolé ${deltaPic} ≠ 30` });
  } else {
    mark('estoque_picole', false, 'não legível via API');
    evidence.problemas.push({ tipo: 'estoque', msg: 'estoque picolé não legível' });
  }
  if (estSorBefore != null && estSorAfterAtac != null) {
    const deltaSor = Number((estSorBefore - estSorAfterAtac).toFixed(4));
    // Atacado: 0,25 KG comercial → baixa em L via MUC (0,25/0,58 ≈ 0,431) OU baixa 0,25 se base KG
    // Aceitar baixa de estoque coerente: ≥0,249 (KG direto) ou ≈0,431 (L via fator)
    const okSor = (deltaSor >= 0.249 && deltaSor <= 0.251) || (deltaSor >= 0.42 && deltaSor <= 0.45);
    mark('estoque_sorvete', okSor, {
      before: estSorBefore,
      after: estSorAfterAtac,
      delta: deltaSor,
      nota: '0,25 KG comercial ≠ 30 UN; baixa física via MUC'
    });
    if (!okSor) evidence.problemas.push({ tipo: 'estoque', msg: `delta sorvete ${deltaSor}` });
  } else {
    mark('estoque_sorvete', false, 'não legível via API');
  }

  // 7) Desktop / listagem + detalhe
  const lista = await get('vendas', { token, query: { limite: 30 } });
  const rows = Array.isArray(lista.data) ? lista.data : (lista.data?.data || lista.data?.vendas || []);
  const ids = new Set(rows.map((v) => Number(v.id)));
  mark('desktop_lista_varejo', ids.has(Number(vendaVarejoId)), { id: vendaVarejoId });
  mark('desktop_lista_atacado', ids.has(Number(vendaAtacadoId)), { id: vendaAtacadoId });

  const detV = await detalheVenda(token, vendaVarejoId);
  const detA = await detalheVenda(token, vendaAtacadoId);
  const totalDetV = Number(detV?.total ?? detV?.venda?.total ?? detV?.valor_total);
  const totalDetA = Number(detA?.total ?? detA?.venda?.total ?? detA?.valor_total);
  mark('dupla_verificacao_varejo', Number.isFinite(totalDetV) && Math.abs(totalDetV - precoV) < 0.02, {
    mobile_total: precoV,
    desktop_total: totalDetV,
    terminal: detV?.terminal_id || detV?.venda?.terminal_id,
    forma: detV?.forma_pagamento || detV?.venda?.forma_pagamento
  });
  mark('dupla_verificacao_atacado', Number.isFinite(totalDetA) && Math.abs(totalDetA - totalA) < 0.02, {
    mobile_total: totalA,
    desktop_total: totalDetA,
    canal_hint: detA?.canal || detA?.venda?.canal || 'ATACADO (resolver)'
  });
  evidence.vendas.varejo.desktop = { total: totalDetV, raw_keys: detV ? Object.keys(detV).slice(0, 12) : [] };
  evidence.vendas.atacado.desktop = { total: totalDetA, raw_keys: detA ? Object.keys(detA).slice(0, 12) : [] };

  // 8) Reabertura terminal/caixa
  const termReopen = await get('terminais/auto', { token, query: termQ });
  assert.strictEqual(Number(termReopen.data.id), Number(terminal.id));
  assert.ok(Number(termReopen.data.caixa_id) > 0);
  const aberto2 = unwrapCaixa((await get('caixa/aberto', {
    token,
    query: { terminal_id: terminal.id },
    headers: termHdr
  })).data);
  mark('reabertura_terminal', true, {
    id: termReopen.data.id,
    nome: termReopen.data.nome,
    caixa_id: termReopen.data.caixa_id
  });
  mark('reabertura_caixa', !!(aberto2?.id || aberto2?.caixa_id), {
    sessao: aberto2?.id || aberto2?.caixa_id
  });

  // 9) Segunda venda após reabertura
  const rV2 = await post('configuracao-comercial/resolver-precos', {
    itens: [{ produto_id: PICOLE, quantidade: 1 }]
  }, { token });
  const precoV2 = Number(rV2.data.itens[0].preco_venda);
  const { venda: venda2 } = await finalizarComoMobile({
    token,
    terminalId: terminal.id,
    headers: termHdr,
    forma: 'dinheiro',
    total: precoV2,
    itens: [{
      produto_id: PICOLE,
      quantidade: 1,
      preco_unitario: precoV2,
      desconto_percentual: 0,
      forma_comercializacao: 'UNIDADE',
      unidade_comercial: 'UN'
    }]
  });
  assert.ok(venda2.status < 400, `2ª venda ${venda2.status} ${JSON.stringify(venda2.data)}`);
  const venda2Id = venda2.data?.venda_id || venda2.data?.id || venda2.data?.venda?.id;
  evidence.vendas.segunda = { id: venda2Id, total: precoV2, forma: 'dinheiro' };
  mark('segunda_venda', !!venda2Id, evidence.vendas.segunda);

  // 10) Contratos Mobile UI (código — aparelho físico fica para operador)
  const pdv = fs.readFileSync(path.join(ROOT, 'frontend/apps/mobile/js/pages/pdv.js'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'frontend/apps/mobile/css/mobile.css'), 'utf8');
  const terminalJs = fs.readFileSync(path.join(ROOT, 'frontend/apps/mobile/js/terminal.js'), 'utf8');
  mark('ux_sticky_nowrap', /\.cds-pdv-sticky__total-label\s*\{[^}]*white-space:\s*nowrap/.test(css), 'RCM-9.2.2.2');
  mark('ux_sticky_coluna', /\.cds-pdv-sticky__bar\s*\{[^}]*flex-direction:\s*column/.test(css), 'full-width');
  mark('ux_pesquisa_limpa', pdv.includes('clearPdvSearchAfterAdd'), 'RCM-9.2.2.1');
  mark('ux_terminal_persist', terminalJs.includes('cds_mobile_terminal_caixa_id') && terminalJs.includes('persistTerminal'), 'localStorage');
  mark('ux_normalize_caixa', pdv.includes('normalizeCaixaPayload'), 'unwrap /caixa/aberto');
  mark('ux_subtotal', /subtotal/.test(pdv), 'payload venda');
  mark('ux_css_360', css.includes('360px'), null);
  mark('ux_css_390', css.includes('390px'), null);

  // Estoque final (após 2ª venda: +1 picolé)
  const estPicFinal = pickEstoque(await estoqueProduto(token, PICOLE));
  evidence.estoque.after_segunda = { picole: estPicFinal };
  if (estPicBefore != null && estPicFinal != null) {
    const deltaFinal = Number((estPicBefore - estPicFinal).toFixed(3));
    mark('estoque_picole_final', deltaFinal >= 30.999 && deltaFinal <= 31.001, {
      before: estPicBefore,
      after: estPicFinal,
      delta: deltaFinal,
      esperado: 31
    });
  }

  evidence.finished_at = new Date().toISOString();
  const failed = Object.entries(evidence.checks).filter(([, v]) => !v.ok);
  evidence.pass_api = failed.length === 0;
  evidence.pass_fisico_aparelho = null; // operador
  evidence.declaracao =
    evidence.pass_api
      ? 'API/ciclo operacional PASS — declaração plena no aparelho depende do checklist físico do operador'
      : 'API/ciclo operacional FAIL — ver problemas';

  const outJson = path.join(ROOT, 'docs/RCM923_AUDITORIA_RUNTIME.json');
  fs.writeFileSync(outJson, JSON.stringify(evidence, null, 2));

  console.log('\n--- RESUMO ---');
  console.log('Falhas:', failed.length ? failed.map(([k]) => k).join(', ') : 'nenhuma');
  console.log('Vendas:', evidence.vendas);
  console.log('JSON:', outJson);

  if (failed.length) {
    console.error('\nRCM-9.2.3 API AUDITORIA FALHOU\n');
    process.exit(1);
  }
  console.log('\nRCM-9.2.3 API AUDITORIA PASSOU\n');
}

main().catch((err) => {
  console.error(err);
  evidence.problemas.push({ tipo: 'runtime', msg: String(err && err.message || err) });
  try {
    fs.writeFileSync(
      path.join(ROOT, 'docs/RCM923_AUDITORIA_RUNTIME.json'),
      JSON.stringify(evidence, null, 2)
    );
  } catch (_) { /* ignore */ }
  process.exit(1);
});
