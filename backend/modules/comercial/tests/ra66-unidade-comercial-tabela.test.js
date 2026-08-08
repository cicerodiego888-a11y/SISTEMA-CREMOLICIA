/**
 * RA-6.6 — Unidade de Comercialização por Tabela de Preços
 *
 * Mesma Linha, unidades diferentes por Tabela (canal).
 * Resolver retorna Preço + Unidade Comercial.
 * Sem unidade na célula → Unidade Base do Produto.
 */
const assert = require('assert');
const path = require('path');

process.chdir(path.resolve(__dirname, '../../..'));

const db = require('../../../database');
const tabelasService = require('../tabelas-preco/TabelasPrecoService');
const ComercialPrecoResolver = require('../preco/ComercialPrecoResolver');
const { resolverFormaEfetiva, inferirFormaDaUnidade } = require('../preco/FormaComercializacao');

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

async function main() {
  await waitDb();
  ComercialPrecoResolver.setLogsHabilitados(false);

  const migration016 = require('../migrations/016_tabela_mono_canal_ra6');
  await migration016(db);

  const varejo = await get(`SELECT id FROM canais_venda WHERE UPPER(codigo)='VAREJO' LIMIT 1`);
  const atacado = await get(`SELECT id FROM canais_venda WHERE UPPER(codigo)='ATACADO' LIMIT 1`);
  const consignado = await get(`SELECT id FROM canais_venda WHERE UPPER(codigo)='CONSIGNADO' LIMIT 1`);
  assert.ok(varejo?.id && atacado?.id, 'canais VAREJO/ATACADO');

  const suffix = Date.now();
  const linha = await run(
    `INSERT INTO linhas_comerciais (codigo, descricao, ativo) VALUES (?, ?, 1)`,
    ['RA66_L_' + suffix, 'SORVETES RA66']
  );

  // Tabela Varejo — KG / 58
  const tabV = await tabelasService.criar({
    codigo: 'RA66_V_' + suffix,
    nome: 'Tab Varejo RA66 ' + suffix,
    canal_venda_id: varejo.id,
    ativo: true,
    linhas_ids: [linha.lastID],
    valores: [{
      linha_comercial_id: linha.lastID,
      canal_venda_id: varejo.id,
      preco: 58,
      unidade_comercial: 'KG'
      // forma omitida → inferida
    }]
  });

  // Tabela Atacado — LITRO / 28
  const tabA = await tabelasService.criar({
    codigo: 'RA66_A_' + suffix,
    nome: 'Tab Atacado RA66 ' + suffix,
    canal_venda_id: atacado.id,
    ativo: true,
    atacado_habilitado: true,
    quantidade_minima: 1,
    tipo_contagem: 'TOTAL_VENDA',
    linhas_ids: [linha.lastID],
    valores: [{
      linha_comercial_id: linha.lastID,
      canal_venda_id: atacado.id,
      preco: 28,
      unidade_comercial: 'LITRO'
    }]
  });

  let tabC = null;
  if (consignado?.id) {
    tabC = await tabelasService.criar({
      codigo: 'RA66_C_' + suffix,
      nome: 'Tab Consignado RA66 ' + suffix,
      canal_venda_id: consignado.id,
      ativo: true,
      linhas_ids: [linha.lastID],
      valores: [{
        linha_comercial_id: linha.lastID,
        canal_venda_id: consignado.id,
        preco: 26,
        unidade_comercial: 'LITRO'
      }]
    });
  }

  // Tabela sem unidade comercial → herda base do produto
  const tabSemUn = await tabelasService.criar({
    codigo: 'RA66_SU_' + suffix,
    nome: 'Tab Sem Unidade RA66 ' + suffix,
    canal_venda_id: varejo.id,
    ativo: true,
    linhas_ids: [linha.lastID],
    valores: [{
      linha_comercial_id: linha.lastID,
      canal_venda_id: varejo.id,
      preco: 50,
      unidade_comercial: null,
      forma_comercializacao: null
    }]
  });

  const prod = await run(
    `INSERT INTO produtos (nome, codigo, unidade, preco_venda, linha_comercial_id, ativo)
     VALUES (?, ?, 'KG', 40, ?, 1)`,
    ['Sorvete Chocolate RA66 ' + suffix, 'RA66_P_' + suffix, linha.lastID]
  );

  const produto = await get(`SELECT * FROM produtos WHERE id = ?`, [prod.lastID]);
  assert.strictEqual(String(produto.unidade).toUpperCase(), 'KG');

  // --- Inferência Forma ← Unidade
  assert.strictEqual(inferirFormaDaUnidade('KG'), 'PESO');
  assert.strictEqual(inferirFormaDaUnidade('LITRO'), 'VOLUME');

  // --- Varejo: 58 / KG
  const rV = await ComercialPrecoResolver.resolver({
    produto,
    canal: 'VAREJO',
    tabela_preco_id: tabV.id
  });
  assert.strictEqual(Number(rV.preco_venda), 58, 'preço varejo');
  assert.strictEqual(String(rV.unidade_comercial).toUpperCase(), 'KG', 'unidade varejo KG');
  assert.ok(rV.unidade_rotulo, 'rótulo unidade');

  // --- Atacado: 28 / LITRO
  const rA = await ComercialPrecoResolver.resolver({
    produto,
    canal: 'ATACADO',
    tabela_preco_id: tabA.id
  });
  assert.strictEqual(Number(rA.preco_venda), 28, 'preço atacado');
  assert.strictEqual(String(rA.unidade_comercial).toUpperCase(), 'LITRO', 'unidade atacado LITRO');

  // --- Consignado: 26 / LITRO
  if (tabC && consignado?.id) {
    const rC = await ComercialPrecoResolver.resolver({
      produto,
      canal: 'CONSIGNADO',
      tabela_preco_id: tabC.id
    });
    assert.strictEqual(Number(rC.preco_venda), 26, 'preço consignado');
    assert.strictEqual(String(rC.unidade_comercial).toUpperCase(), 'LITRO', 'unidade consignado LITRO');
  }

  // --- Sem unidade na tabela → Unidade Base (KG)
  const rSu = await ComercialPrecoResolver.resolver({
    produto,
    canal: 'VAREJO',
    tabela_preco_id: tabSemUn.id
  });
  assert.strictEqual(Number(rSu.preco_venda), 50, 'preço sem unidade');
  assert.strictEqual(String(rSu.unidade_comercial).toUpperCase(), 'KG', 'herda unidade base KG');
  assert.strictEqual(rSu.forma_herdada, true, 'marca herança');

  // --- resolverFormaEfetiva direto
  const efetiva = resolverFormaEfetiva(
    { unidade_comercial: 'LITRO', forma_comercializacao: null },
    { unidade: 'KG' }
  );
  assert.strictEqual(efetiva.unidadeComercial, 'LITRO');
  assert.strictEqual(efetiva.formaComercializacao, 'VOLUME');
  assert.strictEqual(efetiva.herdado, false);

  const herdada = resolverFormaEfetiva(
    { unidade_comercial: null, forma_comercializacao: null },
    { unidade: 'KG' }
  );
  assert.strictEqual(herdada.unidadeComercial, 'KG');
  assert.strictEqual(herdada.herdado, true);

  // --- Diagnóstico inclui preço + unidade
  const diag = await ComercialPrecoResolver.diagnosticar({
    produto,
    canal: 'ATACADO',
    tabela_preco_id: tabA.id
  });
  assert.strictEqual(Number(diag.preco), 28);
  assert.strictEqual(String(diag.unidade_comercial).toUpperCase(), 'LITRO');

  // Persistência: forma inferida na grade ao criar com só unidade
  const valsV = await get(
    `SELECT forma_comercializacao, unidade_comercial FROM tabela_preco_valores
     WHERE tabela_preco_id = ? AND linha_comercial_id = ? LIMIT 1`,
    [tabV.id, linha.lastID]
  );
  assert.strictEqual(String(valsV.unidade_comercial).toUpperCase(), 'KG');
  assert.strictEqual(String(valsV.forma_comercializacao).toUpperCase(), 'PESO');

  console.log('RA-6.6 OK — unidade comercial por tabela (KG/LITRO + herança base)');
  process.exit(0);
}

main().catch((err) => {
  console.error('RA-6.6 FALHOU:', err);
  process.exit(1);
});
