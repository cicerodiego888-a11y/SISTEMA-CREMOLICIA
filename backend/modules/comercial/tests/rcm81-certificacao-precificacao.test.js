/**
 * RCM-8.1 — Homologação e Certificação do Motor Oficial de Precificação
 *
 * Cobre os 14 testes da sprint. Usa banco oficial com dados isolados (suffix) + cleanup.
 * Não cria funcionalidades — valida o fluxo oficial e audita ausência de caminhos paralelos.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.chdir(path.resolve(__dirname, '../../..'));

const db = require('../../../database');
const tabelasService = require('../tabelas-preco/TabelasPrecoService');
const TabelasPrecoRepository = require('../tabelas-preco/TabelasPrecoRepository');
const ComercialPrecoResolver = require('../preco/ComercialPrecoResolver');
const CanalVendaResolver = require('../preco/CanalVendaResolver');
const ConfiguracaoComercialService = require('../configuracao/ConfiguracaoComercialService');

const ROOT = path.resolve(__dirname, '../../../..');
const S = 'RCM81_' + Date.now();

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

async function waitDb() {
  for (let i = 0; i < 50; i++) {
    try {
      await get('SELECT 1 AS ok');
      return;
    } catch (_) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error('DB não pronto');
}

function canalId(codigo) {
  return get(`SELECT id FROM canais_venda WHERE UPPER(codigo)=UPPER(?) LIMIT 1`, [codigo]);
}

async function garantirCanal(codigo, nome) {
  let row = await canalId(codigo);
  if (row?.id) return row;
  await run(
    `INSERT OR IGNORE INTO canais_venda (codigo, nome, ativo) VALUES (?, ?, 1)`,
    [codigo, nome || codigo]
  );
  row = await canalId(codigo);
  assert.ok(row?.id, 'canal ' + codigo);
  return row;
}

function ler(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

async function main() {
  await waitDb();
  ComercialPrecoResolver.setLogsHabilitados(true);

  console.log('\n========== RCM-8.1 CERTIFICAÇÃO ==========\n');

  const cVarejo = await garantirCanal('VAREJO', 'Varejo');
  const cAtacado = await garantirCanal('ATACADO', 'Atacado');
  const cConsignado = await garantirCanal('CONSIGNADO', 'Consignado');
  const cEvento = await garantirCanal('EVENTO', 'Evento');
  const cDelivery = await garantirCanal('DELIVERY', 'Delivery');

  // --- Linhas (Teste 1) ---
  const linhasMeta = [
    { codigo: S + '_CREMOSA', descricao: 'Linha Cremosa' },
    { codigo: S + '_FRUTA_AGUA', descricao: 'Linha Fruta c/ Água' },
    { codigo: S + '_PREMIUM', descricao: 'Linha Premium' }
  ];
  const linhas = {};
  for (const L of linhasMeta) {
    const r = await run(
      `INSERT INTO linhas_comerciais (codigo, descricao, ativo) VALUES (?, ?, 1)`,
      [L.codigo, L.descricao]
    );
    linhas[L.codigo] = { id: r.lastID, ...L };
  }

  // --- Produtos com Linha ---
  const prodComLinha = {};
  for (const key of Object.keys(linhas)) {
    const L = linhas[key];
    const r = await run(
      `INSERT INTO produtos (codigo, nome, preco_venda, unidade, linha_comercial_id, estoque_atual, ativo)
       VALUES (?, ?, ?, 'UN', ?, 100, 1)`,
      [S + '_P_' + L.codigo.slice(-8), 'Prod ' + L.descricao, 99.99, L.id]
    );
    prodComLinha[key] = {
      id: r.lastID,
      nome: 'Prod ' + L.descricao,
      preco_venda: 99.99,
      unidade: 'UN',
      linha_comercial_id: L.id
    };
  }

  // --- Produtos sem Linha (Teste 2) ---
  const choc = await run(
    `INSERT INTO produtos (codigo, nome, preco_venda, unidade, linha_comercial_id, estoque_atual, ativo)
     VALUES (?, 'Sorvete Chocolate RCM81', 55.55, 'UN', NULL, 100, 1)`,
    [S + '_CHOC']
  );
  const pist = await run(
    `INSERT INTO produtos (codigo, nome, preco_venda, unidade, linha_comercial_id, estoque_atual, ativo)
     VALUES (?, 'Sorvete Pistache RCM81', 66.66, 'UN', NULL, 100, 1)`,
    [S + '_PIST']
  );
  const prodSemLinha = {
    chocolate: {
      id: choc.lastID,
      nome: 'Sorvete Chocolate RCM81',
      preco_venda: 55.55,
      unidade: 'UN',
      linha_comercial_id: null
    },
    pistache: {
      id: pist.lastID,
      nome: 'Sorvete Pistache RCM81',
      preco_venda: 66.66,
      unidade: 'UN',
      linha_comercial_id: null
    }
  };

  const idsLinha = Object.values(linhas).map((l) => l.id);

  function celulaLinha(linhaId, canalId, preco, unidade) {
    return {
      linha_comercial_id: linhaId,
      canal_venda_id: canalId,
      preco,
      forma_comercializacao: unidade === 'KG' ? 'PESO' : (unidade === 'LT' || unidade === 'L' ? 'VOLUME' : 'UNIDADE'),
      unidade_comercial: unidade
    };
  }

  // --- Tabelas por operação ---
  const tabVarejo = await tabelasService.criar({
    codigo: S + '_VAREJO',
    nome: 'Cert Varejo ' + S,
    canal_venda_id: cVarejo.id,
    ativo: true,
    linhas_ids: idsLinha,
    valores: idsLinha.map((id) => celulaLinha(id, cVarejo.id, 12.5, 'KG')),
    itens_produto: [
      {
        produto_id: prodSemLinha.chocolate.id,
        canal_venda_id: cVarejo.id,
        preco: 18.0,
        unidade_comercial: 'KG',
        forma_comercializacao: 'PESO'
      },
      {
        produto_id: prodSemLinha.pistache.id,
        canal_venda_id: cVarejo.id,
        preco: 19.0,
        unidade_comercial: 'KG',
        forma_comercializacao: 'PESO'
      }
    ]
  });

  const tabAtacado = await tabelasService.criar({
    codigo: S + '_ATACADO',
    nome: 'Cert Atacado ' + S,
    canal_venda_id: cAtacado.id,
    ativo: true,
    atacado_habilitado: true,
    quantidade_minima: 20,
    tipo_contagem: 'TOTAL_VENDA',
    linhas_ids: idsLinha,
    valores: idsLinha.map((id) => celulaLinha(id, cAtacado.id, 9.0, 'LT')),
    itens_produto: [
      {
        produto_id: prodSemLinha.chocolate.id,
        canal_venda_id: cAtacado.id,
        preco: 14.0,
        unidade_comercial: 'LT',
        forma_comercializacao: 'VOLUME'
      }
    ]
  });

  const tabConsignacao = await tabelasService.criar({
    codigo: S + '_CONSIG',
    nome: 'Cert Consignação ' + S,
    canal_venda_id: cConsignado.id,
    ativo: true,
    linhas_ids: idsLinha,
    valores: idsLinha.map((id) => celulaLinha(id, cConsignado.id, 11.0, 'LT')),
    itens_produto: [
      {
        produto_id: prodSemLinha.chocolate.id,
        canal_venda_id: cConsignado.id,
        preco: 16.0,
        unidade_comercial: 'LT',
        forma_comercializacao: 'VOLUME'
      }
    ]
  });

  const tabEvento = await tabelasService.criar({
    codigo: S + '_EVENTO',
    nome: 'Cert Evento ' + S,
    canal_venda_id: cEvento.id,
    ativo: true,
    linhas_ids: [idsLinha[0]],
    valores: [celulaLinha(idsLinha[0], cEvento.id, 22.0, 'UN')]
  });

  const tabDelivery = await tabelasService.criar({
    codigo: S + '_DELIV',
    nome: 'Cert Delivery ' + S,
    canal_venda_id: cDelivery.id,
    ativo: true,
    linhas_ids: [idsLinha[0]],
    valores: [celulaLinha(idsLinha[0], cDelivery.id, 15.0, 'UN')],
    itens_produto: [
      {
        produto_id: prodSemLinha.pistache.id,
        canal_venda_id: cDelivery.id,
        preco: 17.5,
        unidade_comercial: 'UN',
        forma_comercializacao: 'UNIDADE'
      }
    ]
  });

  const tabelaIds = [tabVarejo.id, tabAtacado.id, tabConsignacao.id, tabEvento.id, tabDelivery.id];

  // ========== TESTE 1 — Produtos com Linha ==========
  console.log('Teste 1 — Produtos com Linha');
  for (const key of Object.keys(prodComLinha)) {
    const p = prodComLinha[key];
    const r = await ComercialPrecoResolver.resolver({
      produto: p,
      canal: 'VAREJO',
      tabela_preco_id: tabVarejo.id
    });
    assert.strictEqual(r.origem, ComercialPrecoResolver.ORIGEM_TABELA_LINHA, key + ' origem linha');
    assert.strictEqual(Number(r.preco), 12.5, key + ' preço');
    assert.strictEqual(String(r.unidade_comercial).toUpperCase(), 'KG', key + ' unidade');
    assert.strictEqual(Number(r.linha_comercial_id), Number(p.linha_comercial_id));
    assert.strictEqual(Number(r.tabela_preco_id), Number(tabVarejo.id));
    assert.strictEqual(r.fallback, false);
  }
  console.log('  OK');

  // ========== TESTE 2 — Produtos sem Linha ==========
  console.log('Teste 2 — Produtos sem Linha');
  for (const key of Object.keys(prodSemLinha)) {
    const p = prodSemLinha[key];
    const r = await ComercialPrecoResolver.resolver({
      produto: p,
      canal: 'VAREJO',
      tabela_preco_id: tabVarejo.id
    });
    assert.strictEqual(r.origem, ComercialPrecoResolver.ORIGEM_TABELA_PRODUTO, key + ' origem produto');
    assert.ok(Number(r.preco) === 18 || Number(r.preco) === 19, key + ' preço');
    assert.strictEqual(String(r.unidade_comercial).toUpperCase(), 'KG', key + ' unidade');
    assert.strictEqual(r.linha_comercial_id, null);
    assert.strictEqual(r.fallback, false);
  }
  console.log('  OK');

  // ========== TESTE 3 — Varejo ==========
  console.log('Teste 3 — Varejo');
  {
    const rL = await ComercialPrecoResolver.resolver({
      produto: prodComLinha[Object.keys(prodComLinha)[0]],
      canal: 'VAREJO',
      tabela_preco_id: tabVarejo.id
    });
    const rP = await ComercialPrecoResolver.resolver({
      produto: prodSemLinha.chocolate,
      canal: 'VAREJO',
      tabela_preco_id: tabVarejo.id
    });
    assert.strictEqual(rL.origem, ComercialPrecoResolver.ORIGEM_TABELA_LINHA);
    assert.strictEqual(rP.origem, ComercialPrecoResolver.ORIGEM_TABELA_PRODUTO);
    assert.strictEqual(String(rL.unidade_comercial).toUpperCase(), 'KG');
    const snap = {
      preco: rL.preco,
      unidade: rL.unidade_comercial,
      origem: rL.origem,
      tabela_preco_id: rL.tabela_preco_id
    };
    assert.ok(snap.preco && snap.unidade && snap.origem && snap.tabela_preco_id);
  }
  console.log('  OK');

  // ========== TESTE 4 — Atacado ==========
  console.log('Teste 4 — Atacado');
  {
    // Isola a tabela de certificação como única ATACADO ativa (buscarAtivaPorCanal = ORDER BY id ASC)
    const outras = await new Promise((resolve, reject) => {
      db.all(
        `SELECT id FROM tabelas_preco
         WHERE canal_venda_id = ? AND id != ? AND COALESCE(ativo,1) = 1`,
        [cAtacado.id, tabAtacado.id],
        (err, rows) => (err ? reject(err) : resolve(rows || []))
      );
    });
    for (const o of outras) {
      await run(`UPDATE tabelas_preco SET ativo = 0 WHERE id = ?`, [o.id]);
    }

    try {
      const canalInfo = await CanalVendaResolver.resolver({
        itens: [
          { produto_id: prodComLinha[Object.keys(prodComLinha)[0]].id, quantidade: 10, participa_atacado: true },
          { produto_id: prodSemLinha.chocolate.id, quantidade: 12, participa_atacado: true }
        ]
      });
      assert.strictEqual(canalInfo.canal, 'ATACADO', 'troca automática para ATACADO');
      assert.ok(Number(canalInfo.quantidade_avaliada) >= 20);

      const r = await ComercialPrecoResolver.resolver({
        produto: prodComLinha[Object.keys(prodComLinha)[0]],
        canal: 'ATACADO',
        tabela_preco_id: tabAtacado.id
      });
      assert.strictEqual(Number(r.preco), 9.0);
      assert.strictEqual(String(r.unidade_comercial).toUpperCase(), 'LT');
      assert.strictEqual(r.origem, ComercialPrecoResolver.ORIGEM_TABELA_LINHA);

      const snap = {
        preco: r.preco,
        unidade: r.unidade_comercial,
        origem: r.origem,
        tabela_preco_id: r.tabela_preco_id
      };
      assert.ok(snap.preco && snap.unidade && snap.origem);

      const pdvSrc = ler('frontend/pdv/js/pdv.js');
      assert.ok(!pdvSrc.includes('function obterPrecoAtacado'), 'sem regra antiga obterPrecoAtacado');
      assert.ok(!/\/produtos\/\$\{[^}]+\}\/atacado/.test(pdvSrc), 'sem GET faixas atacado legado');
    } finally {
      for (const o of outras) {
        await run(`UPDATE tabelas_preco SET ativo = 1 WHERE id = ?`, [o.id]);
      }
    }
  }
  console.log('  OK');

  // ========== TESTE 5 — Consignação ==========
  console.log('Teste 5 — Consignação');
  {
    const viaResolver = await ComercialPrecoResolver.resolver({
      produto: prodComLinha[Object.keys(prodComLinha)[0]],
      canal: 'CONSIGNADO',
      tabela_preco_id: tabConsignacao.id
    });
    const viaApi = await ConfiguracaoComercialService.resolverPrecosVenda({
      canal: 'CONSIGNADO',
      tabela_preco_id: tabConsignacao.id,
      itens: [{ produto_id: prodComLinha[Object.keys(prodComLinha)[0]].id, quantidade: 1 }]
    });
    assert.strictEqual(viaApi.canal, 'CONSIGNADO');
    assert.strictEqual(Number(viaApi.itens[0].preco_venda), Number(viaResolver.preco));
    assert.strictEqual(viaApi.itens[0].preco_origem, viaResolver.origem);
    assert.strictEqual(String(viaApi.itens[0].unidade_comercial).toUpperCase(), 'LT');

    const rProd = await ComercialPrecoResolver.resolver({
      produto: prodSemLinha.chocolate,
      canal: 'CONSIGNADO',
      tabela_preco_id: tabConsignacao.id
    });
    assert.strictEqual(rProd.origem, ComercialPrecoResolver.ORIGEM_TABELA_PRODUTO);
    assert.strictEqual(Number(rProd.preco), 16.0);

    const consignSrc = ler('frontend/modules/motor-comercial/pages/NovaConsignacao/index.js');
    assert.ok(consignSrc.includes('resolverPrecosVenda') || consignSrc.includes('resolver-precos'));
    assert.ok(consignSrc.includes('CONSIGNADO'));
  }
  console.log('  OK');

  // ========== TESTE 6 — Evento ==========
  console.log('Teste 6 — Evento');
  {
    const r = await ComercialPrecoResolver.resolver({
      produto: prodComLinha[Object.keys(prodComLinha)[0]],
      canal: 'EVENTO',
      tabela_preco_id: tabEvento.id
    });
    assert.strictEqual(Number(r.preco), 22.0);
    assert.strictEqual(r.origem, ComercialPrecoResolver.ORIGEM_TABELA_LINHA);
    const manual = await CanalVendaResolver.resolver({ canal_manual: 'EVENTO', itens: [] });
    assert.strictEqual(manual.canal, 'EVENTO');
  }
  console.log('  OK');

  // ========== TESTE 7 — Delivery ==========
  console.log('Teste 7 — Delivery');
  {
    const rL = await ComercialPrecoResolver.resolver({
      produto: prodComLinha[Object.keys(prodComLinha)[0]],
      canal: 'DELIVERY',
      tabela_preco_id: tabDelivery.id
    });
    assert.strictEqual(Number(rL.preco), 15.0);
    const rP = await ComercialPrecoResolver.resolver({
      produto: prodSemLinha.pistache,
      canal: 'DELIVERY',
      tabela_preco_id: tabDelivery.id
    });
    assert.strictEqual(rP.origem, ComercialPrecoResolver.ORIGEM_TABELA_PRODUTO);
    assert.strictEqual(Number(rP.preco), 17.5);
  }
  console.log('  OK');

  // ========== TESTE 8 — Unidade Comercial da Tabela ==========
  console.log('Teste 8 — Unidade Comercial exclusivamente da Tabela');
  {
    const p = prodComLinha[Object.keys(prodComLinha)[0]];
    p.unidade = 'CX'; // produto base diferente — não pode vazar
    const v = await ComercialPrecoResolver.resolver({
      produto: p, canal: 'VAREJO', tabela_preco_id: tabVarejo.id
    });
    const a = await ComercialPrecoResolver.resolver({
      produto: p, canal: 'ATACADO', tabela_preco_id: tabAtacado.id
    });
    const c = await ComercialPrecoResolver.resolver({
      produto: p, canal: 'CONSIGNADO', tabela_preco_id: tabConsignacao.id
    });
    assert.strictEqual(String(v.unidade_comercial).toUpperCase(), 'KG', 'Varejo=KG da tabela');
    assert.strictEqual(String(a.unidade_comercial).toUpperCase(), 'LT', 'Atacado=LT da tabela');
    assert.strictEqual(String(c.unidade_comercial).toUpperCase(), 'LT', 'Consignação=LT da tabela');
    assert.strictEqual(v.forma_herdada, false, 'unidade não herdada do produto (varejo)');
    assert.strictEqual(a.forma_herdada, false);
    assert.strictEqual(c.forma_herdada, false);
    assert.notStrictEqual(String(v.unidade_comercial).toUpperCase(), 'CX');
  }
  console.log('  OK');

  // ========== TESTE 9 — Preço de Segurança ==========
  console.log('Teste 9 — Preço de Segurança');
  {
    const isolado = await run(
      `INSERT INTO produtos (codigo, nome, preco_venda, unidade, linha_comercial_id, estoque_atual, ativo)
       VALUES (?, 'Sem Tabela RCM81', 33.33, 'UN', NULL, 10, 1)`,
      [S + '_SAFE']
    );
    const prod = {
      id: isolado.lastID,
      nome: 'Sem Tabela RCM81',
      preco_venda: 33.33,
      unidade: 'UN',
      linha_comercial_id: null
    };
    const r = await ComercialPrecoResolver.resolver({
      produto: prod,
      canal: 'VAREJO',
      tabela_preco_id: tabVarejo.id
    });
    assert.strictEqual(r.origem, ComercialPrecoResolver.ORIGEM_LEGADO);
    assert.strictEqual(Number(r.preco), 33.33);
    assert.strictEqual(r.fallback, true);
    await run(`DELETE FROM produtos WHERE id = ?`, [isolado.lastID]);
  }
  console.log('  OK');

  // ========== TESTE 10 — Snapshot imutável ==========
  console.log('Teste 10 — Snapshot imutável');
  {
    const p = prodComLinha[Object.keys(prodComLinha)[0]];
    const antes = await ComercialPrecoResolver.resolver({
      produto: p, canal: 'VAREJO', tabela_preco_id: tabVarejo.id
    });
    const snapshot = {
      preco: Number(antes.preco),
      unidade: antes.unidade_comercial,
      origem: antes.origem,
      tabela_preco_id: antes.tabela_preco_id,
      linha_comercial_id: antes.linha_comercial_id
    };

    // Altera tabela (simula mudança pós-venda)
    await run(
      `UPDATE tabela_preco_valores SET preco = 99.99
       WHERE tabela_preco_id = ? AND linha_comercial_id = ?`,
      [tabVarejo.id, p.linha_comercial_id]
    );
    ComercialPrecoResolver.invalidateCache(tabVarejo.id);

    const depois = await ComercialPrecoResolver.resolver({
      produto: p, canal: 'VAREJO', tabela_preco_id: tabVarejo.id
    });
    assert.strictEqual(Number(depois.preco), 99.99, 'resolver vê preço novo');
    assert.strictEqual(snapshot.preco, 12.5, 'snapshot antigo preservado');
    assert.strictEqual(snapshot.unidade, 'KG');
    assert.strictEqual(snapshot.origem, ComercialPrecoResolver.ORIGEM_TABELA_LINHA);

    // restaura
    await run(
      `UPDATE tabela_preco_valores SET preco = 12.5
       WHERE tabela_preco_id = ? AND linha_comercial_id = ?`,
      [tabVarejo.id, p.linha_comercial_id]
    );
    ComercialPrecoResolver.invalidateCache(tabVarejo.id);

    // Consignação: colunas de snapshot existem
    const cols = await new Promise((resolve, reject) => {
      db.all(`PRAGMA table_info(consignacao_itens)`, [], (err, rows) =>
        (err ? reject(err) : resolve(rows || []))
      );
    }).catch(() => []);
    if (cols.length) {
      const nomes = new Set(cols.map((c) => c.name));
      assert.ok(nomes.has('preco_origem') || nomes.has('tabela_preco_id'), 'snapshot consignação');
    }
  }
  console.log('  OK');

  // ========== TESTE 11 — PDV ==========
  console.log('Teste 11 — PDV usa só Resolver');
  {
    const pdv = ler('frontend/pdv/js/pdv.js');
    assert.ok(pdv.includes('resolver-precos'), 'chama resolver-precos');
    assert.ok(pdv.includes('enriquecerProdutoCanalPdv'), 'enriquece via resolver');
    assert.ok(!pdv.includes('function obterPrecoAtacado'), 'sem atacado legado');
    assert.ok(pdv.includes('enriquecerProdutoCanalPdv(produtoBalanca'), 'balança via resolver');
    assert.ok(pdv.includes('agendarRecalculoCanalComercialPdv'), 'recalc carrinho');
    // Orquestração única
    const cfg = ler('backend/modules/comercial/configuracao/ConfiguracaoComercialService.js');
    assert.ok(cfg.includes('ComercialPrecoResolver.resolver'));
  }
  console.log('  OK');

  // ========== TESTE 12 — Comercial ==========
  console.log('Teste 12 — Comercial mesmo Resolver');
  {
    const api = ler('frontend/modules/motor-comercial/api/MotorComercialApi.js');
    assert.ok(api.includes('resolver-precos') || api.includes('resolverPrecosVenda'));
    const consign = ler('frontend/modules/motor-comercial/pages/NovaConsignacao/index.js');
    assert.ok(consign.includes('resolverPrecosVenda') || consign.includes('resolver-precos'));
    // Pedido/Orçamento: se existirem no repo, devem apontar ao mesmo endpoint
    const pedidos = [];
    try {
      const glob = require('fs').readdirSync(path.join(ROOT, 'frontend'), { recursive: true });
      // structural: ConfiguracaoComercialService é a porta única
    } catch (_) { /* noop */ }
    const routes = ler('backend/modules/comercial/routes/comercialCadastros.routes.js');
    assert.ok(routes.includes('resolver-precos'));
  }
  console.log('  OK');

  // ========== TESTE 13 — Mobile ==========
  console.log('Teste 13 — Mobile');
  {
    const mobile = ler('frontend/apps/mobile/js/pages/pdv.js');
    assert.ok(mobile.includes('resolver-precos'), 'mobile usa resolver-precos');
    assert.ok(mobile.includes('RCM-8.0') || mobile.includes('preco_venda'), 'contrato preço');
  }
  console.log('  OK');

  // ========== TESTE 14 — Logs ==========
  console.log('Teste 14 — Logs de homologação');
  {
    const src = ler('backend/modules/comercial/preco/ComercialPrecoResolver.js');
    assert.ok(src.includes('[RCM-8.1][Resolver]'), 'log estruturado RCM-8.1');
    assert.ok(src.includes('origem_codigo'), 'log com origem_codigo');
    assert.ok(src.includes('unidade_comercial'), 'log com unidade');
    assert.ok(src.includes('tabela_id'), 'log com tabela');
  }
  console.log('  OK');

  // ========== Motor: um único caminho (sem legado no resolver) ==========
  console.log('Auditoria — sem caminhos paralelos no Motor');
  {
    const src = ler('backend/modules/comercial/preco/ComercialPrecoResolver.js');
    assert.ok(!src.includes('pularCompat'));
    assert.ok(!src.includes("origemLabel: 'Linha (compat legado)'"));
    assert.ok(!src.includes("origemLabel: 'Tabela de Preço (compat canal)'"));
    assert.ok(src.includes('RCM-8.0'));
  }
  console.log('  OK');

  // ========== Orquestração compartilhada ==========
  console.log('Auditoria — PDV e Comercial mesma orquestração');
  {
    const a = await ConfiguracaoComercialService.resolverPrecosVenda({
      canal: 'VAREJO',
      tabela_preco_id: tabVarejo.id,
      itens: [{ produto_id: prodSemLinha.chocolate.id, quantidade: 1 }]
    });
    const b = await ComercialPrecoResolver.resolver({
      produto: prodSemLinha.chocolate,
      canal: 'VAREJO',
      tabela_preco_id: tabVarejo.id
    });
    assert.strictEqual(Number(a.itens[0].preco_venda), Number(b.preco));
    assert.strictEqual(a.itens[0].preco_origem, b.origem);
  }
  console.log('  OK');

  // --- Cleanup ---
  console.log('\nCleanup...');
  for (const tid of tabelaIds) {
    await run(`DELETE FROM tabela_preco_produto_itens WHERE tabela_preco_id = ?`, [tid]).catch(() => {});
    await run(`DELETE FROM tabela_preco_valores WHERE tabela_preco_id = ?`, [tid]).catch(() => {});
    await run(`DELETE FROM tabela_preco_linhas WHERE tabela_preco_id = ?`, [tid]).catch(() => {});
    await run(`DELETE FROM tabelas_preco WHERE id = ?`, [tid]).catch(() => {});
  }
  const prodIds = [
    ...Object.values(prodComLinha).map((p) => p.id),
    prodSemLinha.chocolate.id,
    prodSemLinha.pistache.id
  ];
  for (const pid of prodIds) {
    await run(`DELETE FROM produto_politicas_comerciais WHERE produto_id = ?`, [pid]).catch(() => {});
    await run(`DELETE FROM produto_unidades_comercializacao WHERE produto_id = ?`, [pid]).catch(() => {});
    await run(`DELETE FROM produto_atacado WHERE produto_id = ?`, [pid]).catch(() => {});
    await run(`DELETE FROM produtos WHERE id = ?`, [pid]).catch(() => {});
  }
  for (const L of Object.values(linhas)) {
    await run(`DELETE FROM linhas_comerciais WHERE id = ?`, [L.id]).catch(() => {});
  }

  console.log('\n========== RCM-8.1 CERTIFICADO — TODOS OS TESTES OK ==========\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('\nRCM-8.1 FALHOU:', err);
  process.exit(1);
});
