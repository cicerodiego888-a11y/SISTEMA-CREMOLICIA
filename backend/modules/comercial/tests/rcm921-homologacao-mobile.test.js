/**
 * RCM-9.2.1 — Homologação final (DB + Motor Oficial, sem HTTP)
 * Valida contagem/canal/UC via Resolver — mesmos motores do Mobile.
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');

process.chdir(path.resolve(__dirname, '../../..'));
const ROOT = path.resolve(__dirname, '../../../..');
const db = require('../../../database');
const cfg = require('../configuracao/ConfiguracaoComercialService');
const { contribuicaoContagemAtacado } = require('../preco/CanalVendaResolver');

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}
function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}
async function waitDb() {
  for (let i = 0; i < 60; i++) {
    try {
      await get('SELECT 1');
      return;
    } catch (_) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error('DB não pronto');
}

function ler(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function contagem(itens) {
  return itens.reduce((a, i) => a + contribuicaoContagemAtacado(i), 0);
}

async function main() {
  await waitDb();
  console.log('\nRCM-9.2.1 — Homologação Motor Oficial (Mobile client)\n');

  const picole = await get(
    `SELECT id, nome, forma_comercializacao, unidade, unidade_venda
     FROM produtos
     WHERE COALESCE(ativo,1)=1
       AND (lower(nome) LIKE '%picol%' OR lower(nome) LIKE '%picole%')
     ORDER BY id LIMIT 1`
  );
  let pote = await get(
    `SELECT id, nome, forma_comercializacao, unidade, unidade_venda
     FROM produtos
     WHERE COALESCE(ativo,1)=1
       AND (lower(nome) LIKE '%250%' OR lower(nome) LIKE '%0,250%' OR lower(nome) LIKE '%0.250%')
       AND (lower(nome) LIKE '%sorvete%' OR lower(nome) LIKE '%pote%' OR lower(forma_comercializacao) LIKE '%peso%')
     ORDER BY id LIMIT 1`
  );
  if (!pote) {
    pote = await get(
      `SELECT id, nome, forma_comercializacao, unidade, unidade_venda
       FROM produtos
       WHERE COALESCE(ativo,1)=1
         AND upper(COALESCE(forma_comercializacao,'')) IN ('PESO','VOLUME')
         AND (lower(nome) LIKE '%sorvete%' OR lower(nome) LIKE '%pote%')
       ORDER BY id LIMIT 1`
    );
  }
  if (!pote) {
    pote = await get(
      `SELECT id, nome, forma_comercializacao, unidade, unidade_venda
       FROM produtos
       WHERE COALESCE(ativo,1)=1
         AND upper(COALESCE(forma_comercializacao,'')) = 'PESO'
       ORDER BY id LIMIT 1`
    );
  }

  assert.ok(picole, 'produto picolé encontrado no DB');
  assert.ok(pote, 'produto PESO/pote encontrado no DB');
  console.log('Produtos:', { picole: `${picole.id} ${picole.nome}`, pote: `${pote.id} ${pote.nome}` });

  // Contagem comercial (regra oficial — não alterar)
  assert.strictEqual(
    contagem([
      { forma_comercializacao: 'UNIDADE', quantidade: 29 },
      { forma_comercializacao: 'PESO', quantidade: 0.25 }
    ]),
    30,
    '29+pote = 30 itens comerciais'
  );
  assert.strictEqual(contagem([{ forma_comercializacao: 'UNIDADE', quantidade: 29 }]), 29);
  assert.strictEqual(contagem([{ forma_comercializacao: 'UNIDADE', quantidade: 30 }]), 30);
  console.log('OK 1 — Contagem 29 / 30 / 29+pote');

  // Resolver: 1 picolé → VAREJO
  const r1 = await cfg.resolverPrecosVenda({
    itens: [{ produto_id: picole.id, quantidade: 1 }]
  });
  assert.strictEqual(String(r1.canal).toUpperCase(), 'VAREJO', '1 UN → VAREJO');
  assert.ok(r1.itens?.[0] && !r1.itens[0].erro, 'preço varejo ok');
  assert.ok(Number(r1.itens[0].preco_venda) >= 0, 'preço lista via resolver');
  console.log('OK 2 — Varejo 1 picolé', {
    canal: r1.canal,
    preco: r1.itens[0].preco_venda,
    uc: r1.itens[0].unidade_comercial,
    origem: r1.itens[0].preco_origem || r1.itens[0].origem
  });

  // Resolver: 30 picolés → ATACADO
  const r30 = await cfg.resolverPrecosVenda({
    itens: [{ produto_id: picole.id, quantidade: 30 }]
  });
  assert.strictEqual(String(r30.canal).toUpperCase(), 'ATACADO', '30 UN → ATACADO');
  console.log('OK 3 — Atacado 30', {
    canal: r30.canal,
    qtd: r30.quantidade_avaliada,
    preco: r30.itens[0].preco_venda,
    uc: r30.itens[0].unidade_comercial
  });

  // Resolver: 29 + pote → ATACADO (30 itens)
  const rMix = await cfg.resolverPrecosVenda({
    itens: [
      { produto_id: picole.id, quantidade: 29 },
      { produto_id: pote.id, quantidade: 0.25, forma_comercializacao: 'PESO' }
    ]
  });
  assert.strictEqual(String(rMix.canal).toUpperCase(), 'ATACADO', '29+pote → ATACADO');
  assert.ok(Number(rMix.quantidade_avaliada) >= 30, 'quantidade_avaliada >= 30');
  console.log('OK 4 — 29+pote ATACADO', {
    canal: rMix.canal,
    qtd: rMix.quantidade_avaliada,
    itens: (rMix.itens || []).map((i) => ({
      id: i.produto_id,
      preco: i.preco_venda,
      uc: i.unidade_comercial,
      forma: i.forma_comercializacao
    }))
  });

  // 29 só → VAREJO
  const r29 = await cfg.resolverPrecosVenda({
    itens: [{ produto_id: picole.id, quantidade: 29 }]
  });
  assert.strictEqual(String(r29.canal).toUpperCase(), 'VAREJO', '29 UN → VAREJO');
  console.log('OK 5 — 29 VAREJO', { canal: r29.canal, qtd: r29.quantidade_avaliada });

  // Sorvete: VAREJO vs ATACADO unidade comercial
  const rSorvV = await cfg.resolverPrecosVenda({
    itens: [{ produto_id: pote.id, quantidade: 0.25, forma_comercializacao: 'PESO' }]
  });
  const rSorvA = await cfg.resolverPrecosVenda({
    itens: [
      { produto_id: picole.id, quantidade: 29 },
      { produto_id: pote.id, quantidade: 0.25, forma_comercializacao: 'PESO' }
    ]
  });
  const rowV = (rSorvV.itens || []).find((i) => Number(i.produto_id) === Number(pote.id));
  const rowA = (rSorvA.itens || []).find((i) => Number(i.produto_id) === Number(pote.id));
  console.log('OK 6 — Sorvete UC', {
    varejo: { canal: rSorvV.canal, uc: rowV?.unidade_comercial, forma: rowV?.forma_comercializacao },
    atacado: { canal: rSorvA.canal, uc: rowA?.unidade_comercial, forma: rowA?.forma_comercializacao }
  });
  assert.ok(rowV && !rowV.erro, 'sorvete varejo resolvido');
  assert.ok(rowA && !rowA.erro, 'sorvete atacado resolvido');

  // CONSIGNADO (manual canal)
  const rCons = await cfg.resolverPrecosVenda({
    itens: [{ produto_id: pote.id, quantidade: 1 }],
    canal: 'CONSIGNADO'
  });
  assert.strictEqual(String(rCons.canal).toUpperCase(), 'CONSIGNADO', 'canal consignado');
  console.log('OK 7 — Consignado', {
    canal: rCons.canal,
    preco: rCons.itens?.[0]?.preco_venda,
    uc: rCons.itens?.[0]?.unidade_comercial,
    tabela: rCons.itens?.[0]?.tabela_preco_nome || rCons.tabela_preco_id
  });

  // Mobile client contracts
  const pdv = ler('frontend/apps/mobile/js/pages/pdv.js');
  const terminal = ler('frontend/apps/mobile/js/terminal.js');
  const comercial = ler('frontend/apps/mobile/js/pages/comercial.js');
  assert.ok(!/canal:\s*['"]VAREJO['"]/.test(pdv), 'mobile sem forçar VAREJO');
  assert.ok(pdv.includes('recalcularCarrinhoViaResolver'), 'recalc');
  assert.ok(pdv.includes('quantidade_avaliada') || pdv.includes('itens_comerciais'), 'exibe contagem comercial');
  assert.ok(terminal.includes('getTerminalUiState'), 'estados terminal');
  assert.ok(comercial.includes("canal: 'CONSIGNADO'"), 'consignação via resolver');
  assert.ok(pdv.includes('carrinho foi preservado'), 'preserva carrinho');
  console.log('OK 8 — Contratos Mobile RCM-9.2.1');

  console.log('\nRCM-9.2.1 HOMOLOGAÇÃO MOTOR PASSOU\n');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nFALHA RCM-9.2.1:', err && err.message ? err.message : err);
    process.exit(1);
  });
