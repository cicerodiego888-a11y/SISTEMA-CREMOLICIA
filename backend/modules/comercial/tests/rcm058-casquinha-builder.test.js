/**
 * RCM-05.8 — Casquinha Builder (montagem × ComercialPrecoResolver)
 */

const assert = require('assert');
const path = require('path');

const ComercialPrecoResolver = require(path.join(__dirname, '../preco/ComercialPrecoResolver'));
const Builder = require(path.join(__dirname, '../casquinha/CasquinhaBuilderService'));
const saboresSvc = require(path.join(__dirname, '../casquinha/CasquinhaSaboresService'));
const CategoriaLinha = require(path.join(__dirname, '../categoria-linha/CategoriaLinhaComercialService'));
const comprovante = require(path.join(__dirname, '../../../services/comprovanteVendaService'));
const { bootstrapComercialV2Schema } = require(path.join(__dirname, '../index'));
const db = require(path.join(__dirname, '../../../database'));

function whenReady() {
  return new Promise((resolve, reject) => {
    if (typeof db.whenReady === 'function') {
      db.whenReady((err) => (err ? reject(err) : resolve()));
      return;
    }
    setTimeout(resolve, 500);
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

async function run() {
  await whenReady();
  await bootstrapComercialV2Schema(db);
  ComercialPrecoResolver.setLogsHabilitados(false);

  const colsSab = await dbAll(`PRAGMA table_info(casquinha_sabores)`);
  assert.ok(colsSab.some((c) => c.name === 'codigo'), 'codigo sabor');
  assert.ok(colsSab.some((c) => c.name === 'cor'), 'cor sabor');

  const colsCat = await dbAll(`PRAGMA table_info(categorias)`);
  assert.ok(colsCat.some((c) => c.name === 'casquinha_bolas_max'), 'casquinha_bolas_max');

  const sabores = await saboresSvc.listar({ ativos: 1 });
  assert.ok(sabores.length >= 5, 'catálogo sabores');
  assert.ok(sabores.some((s) => /chocolate/i.test(s.nome)));

  // 1..4 bolas
  for (const n of [1, 2, 3, 4]) {
    const lista = sabores.slice(0, n).map((s) => ({ id: s.id, nome: s.nome }));
    const ok = Builder.validarMontagem({
      quantidade_bolas: n,
      sabores: lista,
      bolas_min: 1,
      bolas_max: 4,
      permitir_repetir: true
    });
    assert.strictEqual(ok.quantidade_bolas, n);
    assert.strictEqual(ok.sabores.length, n);
  }

  // Repetição permitida
  const choc = sabores.find((s) => /chocolate/i.test(s.nome)) || sabores[0];
  const rep = Builder.validarMontagem({
    quantidade_bolas: 2,
    sabores: [
      { id: choc.id, nome: choc.nome },
      { id: choc.id, nome: choc.nome }
    ],
    bolas_min: 1,
    bolas_max: 4,
    permitir_repetir: true
  });
  assert.strictEqual(rep.sabores.length, 2);

  // Repetição bloqueada
  let bloqueou = false;
  try {
    Builder.validarMontagem({
      quantidade_bolas: 2,
      sabores: [
        { id: choc.id, nome: choc.nome },
        { id: choc.id, nome: choc.nome }
      ],
      permitir_repetir: false
    });
  } catch (_) {
    bloqueou = true;
  }
  assert.ok(bloqueou, 'repetição bloqueada');

  // Limite sabores
  let limite = false;
  try {
    Builder.validarMontagem({
      quantidade_bolas: 2,
      sabores: sabores.slice(0, 3).map((s) => ({ id: s.id, nome: s.nome })),
      bolas_max: 4
    });
  } catch (_) {
    limite = true;
  }
  assert.ok(limite, 'qtd sabores != bolas');

  // Resolver: preço casquinha via linha/categoria
  const suffix = Date.now().toString(36);
  const ins = await dbRun(
    `INSERT INTO categorias (nome, descricao, tipo, ativo, casquinha_bolas_min, casquinha_bolas_max, casquinha_permitir_repetir)
     VALUES (?, 'rcm058', 'produto', 1, 1, 4, 1)`,
    [`Casquinhas ${suffix}`]
  );
  const catId = ins.lastID;
  const insPol = await dbRun(
    `INSERT INTO linhas_comerciais (codigo, descricao, ativo) VALUES (?, ?, 1)`,
    [`CASQ_${suffix}`, `Casquinhas ${suffix}`]
  );
  const polId = insPol.lastID;
  await dbRun(`UPDATE categorias SET linha_comercial_id = ? WHERE id = ?`, [polId, catId]);
  const canais = await dbAll(`SELECT id, codigo FROM canais_venda WHERE ativo = 1`);
  const varejo = canais.find((c) => c.codigo === 'VAREJO');
  await CategoriaLinha.salvarValoresComerciais(catId, [
    {
      canal_venda_id: varejo.id,
      preco: 8,
      forma_comercializacao: 'CASQUINHA',
      unidade_comercial: 'UN'
    }
  ]);
  await CategoriaLinha.salvarConfigCasquinha(catId, {
    bolas_min: 1,
    bolas_max: 4,
    permitir_repetir: true
  });

  const r = await ComercialPrecoResolver.resolver({
    produto: {
      nome: 'Casquinha',
      preco_venda: 1,
      linha_comercial_id: polId,
      categoria_id: catId
    },
    canal: 'VAREJO'
  });
  assert.strictEqual(r.formaComercializacao, 'CASQUINHA');
  assert.strictEqual(Number(r.preco), 8);

  const html = comprovante.montarHtmlComprovanteVenda({
    nome_empresa: 'Teste',
    cupom: 'C58',
    total: 8,
    itens: [{
      nome: 'Casquinha',
      quantidade: 1,
      preco_unitario: 8,
      subtotal: 8,
      forma_comercializacao: 'CASQUINHA',
      unidade_comercial: 'UN',
      quantidade_bolas: 2,
      sabores: [{ nome: 'Chocolate' }, { nome: 'Morango' }]
    }],
    pagamentos: [{ forma_pagamento: 'dinheiro', valor: 8 }]
  });
  assert.ok(html.toUpperCase().includes('CASQUINHA') || html.includes('2'), 'impressão casquinha');
  assert.ok(html.includes('Chocolate') && html.includes('Morango'), 'impressão sabores');

  // Cleanup
  await dbRun(`DELETE FROM linha_comercial_valores WHERE linha_id = ?`, [polId]);
  await dbRun(`UPDATE categorias SET linha_comercial_id = NULL WHERE id = ?`, [catId]);
  await dbRun(`DELETE FROM linhas_comerciais WHERE id = ?`, [polId]);
  await dbRun(`DELETE FROM categorias WHERE id = ?`, [catId]);

  console.log('RCM-05.8 — Casquinha Builder: OK');
}

run().catch((err) => {
  console.error('RCM-05.8 FALHOU:', err);
  process.exit(1);
});
