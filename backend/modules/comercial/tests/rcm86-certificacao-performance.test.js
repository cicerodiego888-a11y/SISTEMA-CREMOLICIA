/**
 * RCM-8.6 — Smoke de performance do Resolver (certificação; sem alterar arquitetura)
 */
const assert = require('assert');
const path = require('path');

process.chdir(path.resolve(__dirname, '../../..'));
const db = require('../../../database');
const cfg = require('../configuracao/ConfiguracaoComercialService');

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
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
      await get('SELECT 1');
      return;
    } catch (_) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error('DB não pronto');
}

async function medir(n, label) {
  const produtos = await all(
    `SELECT id, categoria_id FROM produtos WHERE COALESCE(ativo,1)=1 ORDER BY id LIMIT ?`,
    [n]
  );
  if (produtos.length < Math.min(n, 10)) {
    return { label, n: produtos.length, skipped: true, ms: 0 };
  }
  const itens = produtos.map((p) => ({
    produto_id: p.id,
    quantidade: 1,
    categoria_id: p.categoria_id
  }));
  const t0 = Date.now();
  const res = await cfg.resolverPrecosVenda({
    canal: 'VAREJO',
    documento: 'rcm86-perf',
    itens
  });
  const ms = Date.now() - t0;
  assert.ok((res.itens || []).length === itens.length);
  return { label, n: itens.length, ms, skipped: false };
}

async function main() {
  await waitDb();
  console.log('\nRCM-8.6 — Performance smoke\n');

  const resultados = [];
  for (const n of [100, 300, 1000]) {
    const r = await medir(n, n + ' itens');
    resultados.push(r);
    if (r.skipped) {
      console.log(`SKIP ${r.label} (apenas ${r.n} produtos ativos)`);
    } else {
      console.log(`OK ${r.label}: ${r.ms}ms`);
      // Limites de certificação (ambiente local SQLite)
      if (n <= 100) assert.ok(r.ms < 15000, '100 itens < 15s');
      if (n === 300) assert.ok(r.ms < 45000, '300 itens < 45s');
      if (n === 1000) assert.ok(r.ms < 120000, '1000 itens < 120s');
    }
  }

  // Troca de operação
  const amostra = await all(
    `SELECT id FROM produtos WHERE COALESCE(ativo,1)=1 ORDER BY id LIMIT 50`
  );
  const itens = amostra.map((p) => ({ produto_id: p.id, quantidade: 2 }));
  const tOp = Date.now();
  await cfg.resolverPrecosVenda({ canal: 'VAREJO', itens, documento: 'rcm86' });
  await cfg.resolverPrecosVenda({ canal: 'ATACADO', itens, documento: 'rcm86' });
  await cfg.resolverPrecosVenda({ canal: 'CONSIGNADO', itens, documento: 'rcm86' });
  const msOp = Date.now() - tOp;
  console.log(`OK troca operação (3×50): ${msOp}ms`);
  assert.ok(msOp < 30000);

  // Comparar tabelas
  if (amostra[0]) {
    const tC = Date.now();
    await cfg.compararTabelas({ produto_id: amostra[0].id });
    console.log(`OK comparar tabelas: ${Date.now() - tC}ms`);
  }

  console.log('\nRCM-8.6 PERF PASSOU\n');
  console.log(JSON.stringify({ resultados, msOp }, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
