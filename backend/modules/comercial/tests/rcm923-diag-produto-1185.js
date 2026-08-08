/**
 * RCM-9.2.3 — Diagnóstico produto #1185 (sorvete) + conversões MUC
 */
const path = require('path');
process.chdir(path.resolve(__dirname, '../../..'));
const db = require('../../../database');

function all(sql, p = []) {
  return new Promise((res, rej) => db.all(sql, p, (e, r) => (e ? rej(e) : res(r || []))));
}
function get(sql, p = []) {
  return new Promise((res, rej) => db.get(sql, p, (e, r) => (e ? rej(e) : res(r || null))));
}
async function waitDb() {
  for (let i = 0; i < 60; i++) {
    try { await get('SELECT 1'); return; } catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  throw new Error('DB não pronto');
}

async function main() {
  await waitDb();
  const id = 1185;
  const prod = await get(`SELECT * FROM produtos WHERE id = ?`, [id]);
  console.log('\n=== PRODUTO ===');
  console.log(JSON.stringify({
    id: prod?.id,
    nome: prod?.nome,
    unidade: prod?.unidade,
    unidade_venda: prod?.unidade_venda,
    unidade_estoque: prod?.unidade_estoque,
    forma_comercializacao: prod?.forma_comercializacao,
    preco_venda: prod?.preco_venda,
    estoque_atual: prod?.estoque_atual,
    linha_comercial_id: prod?.linha_comercial_id,
    categoria_id: prod?.categoria_id
  }, null, 2));

  const cols = await all(`PRAGMA table_info(produtos)`);
  const names = cols.map((c) => c.name).filter((n) => /unidade|forma|convers|estoque|peso|volume|litro|kg/i.test(n));
  console.log('\n=== COLUNAS relevantes produtos ===', names);

  for (const table of [
    'produto_conversoes',
    'produto_unidades_comercializacao',
    'conversoes_fisicas_lotes',
    'produto_unidades',
    'unidades_produto'
  ]) {
    try {
      const rows = await all(`SELECT * FROM ${table} WHERE produto_id = ?`, [id]);
      console.log(`\n=== ${table} (${rows.length}) ===`);
      console.log(JSON.stringify(rows.slice(0, 20), null, 2));
    } catch (e) {
      console.log(`\n=== ${table} === SKIP: ${e.message}`);
    }
  }

  // Tabelas preço × linha / produto
  try {
    const linhas = await all(
      `SELECT tpl.*, tp.codigo AS tabela_codigo, tp.nome AS tabela_nome, cv.codigo AS canal
       FROM tabela_preco_linha tpl
       JOIN tabelas_preco tp ON tp.id = tpl.tabela_preco_id
       LEFT JOIN canais_venda cv ON cv.id = tp.canal_venda_id
       WHERE tpl.linha_comercial_id = ? OR tpl.produto_id = ?`,
      [prod?.linha_comercial_id, id]
    );
    console.log('\n=== precos linha/produto ===');
    console.log(JSON.stringify(linesSafe(linhas), null, 2));
  } catch (e) {
    console.log('precos linha fail', e.message);
  }

  try {
    const itens = await all(
      `SELECT tpi.*, tp.codigo, tp.nome, cv.codigo AS canal
       FROM tabela_preco_produto_itens tpi
       JOIN tabelas_preco tp ON tp.id = tpi.tabela_preco_id
       LEFT JOIN canais_venda cv ON cv.id = tp.canal_venda_id
       WHERE tpi.produto_id = ?`,
      [id]
    );
    console.log('\n=== tabela_preco_produto_itens ===');
    console.log(JSON.stringify(itens, null, 2));
  } catch (e) {
    console.log('tppi fail', e.message);
  }

  // Resolver official
  const cfg = require('../configuracao/ConfiguracaoComercialService');
  for (const [label, body] of [
    ['VAREJO', { itens: [{ produto_id: id, quantidade: 0.25 }] }],
    ['ATACADO_CTX', { itens: [{ produto_id: 3, quantidade: 29 }, { produto_id: id, quantidade: 0.25 }] }],
    ['CONSIGNADO', { itens: [{ produto_id: id, quantidade: 1 }], canal: 'CONSIGNADO' }]
  ]) {
    const r = await cfg.resolverPrecosVenda(body);
    const row = (r.itens || []).find((i) => Number(i.produto_id) === id) || r.itens?.[0];
    console.log(`\n=== RESOLVER ${label} ===`, {
      canal: r.canal,
      uc: row?.unidade_comercial,
      forma: row?.forma_comercializacao,
      preco: row?.preco_venda,
      origem: row?.preco_origem || row?.origem
    });
  }

  process.exit(0);
}

function linesSafe(rows) {
  return (rows || []).map((r) => ({
    tabela: r.tabela_codigo || r.codigo,
    canal: r.canal,
    unidade: r.unidade_comercial || r.unidade,
    preco: r.preco ?? r.preco_venda,
    linha_id: r.linha_comercial_id,
    produto_id: r.produto_id
  }));
}

main().catch((e) => { console.error(e); process.exit(1); });
