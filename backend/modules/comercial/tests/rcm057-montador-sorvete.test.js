/**
 * RCM-05.7 — Montador de Sorvete (Varejo × Atacado × Evento)
 *
 * Valida que o ComercialPrecoResolver determina forma/unidade/preço por canal
 * e que os cálculos de venda por peso/litro estão corretos.
 */

const assert = require('assert');
const path = require('path');

const ComercialPrecoResolver = require(path.join(__dirname, '../preco/ComercialPrecoResolver'));
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

function calcularTotal(qtd, preco) {
  return Number((Number(qtd) * Number(preco)).toFixed(2));
}

async function run() {
  await whenReady();
  await bootstrapComercialV2Schema(db);
  ComercialPrecoResolver.setLogsHabilitados(false);
  ComercialPrecoResolver.invalidateCache();

  const cols = await dbAll(`PRAGMA table_info(vendas_itens)`);
  assert.ok(
    cols.some((c) => c.name === 'forma_comercializacao'),
    'vendas_itens.forma_comercializacao'
  );

  const suffix = Date.now().toString(36);
  const nomeCat = `Sorvete Montador ${suffix}`;

  const insCat = await dbRun(
    `INSERT INTO categorias (nome, descricao, tipo, ativo) VALUES (?, ?, 'produto', 1)`,
    [nomeCat, 'rcm057']
  );
  const catId = insCat.lastID;

  // A-1: política independente (não criada pela categoria)
  const insPol = await dbRun(
    `INSERT INTO linhas_comerciais (codigo, descricao, ativo) VALUES (?, ?, 1)`,
    [`SORV_${suffix}`, nomeCat]
  );
  const polId = insPol.lastID;
  await dbRun(`UPDATE categorias SET linha_comercial_id = ? WHERE id = ?`, [polId, catId]);

  const canais = await dbAll(`SELECT id, codigo FROM canais_venda WHERE ativo = 1`);
  const idV = canais.find((c) => c.codigo === 'VAREJO')?.id;
  const idA = canais.find((c) => c.codigo === 'ATACADO')?.id;
  const idE = canais.find((c) => c.codigo === 'EVENTO')?.id;
  assert.ok(idV && idA && idE, 'canais VAREJO/ATACADO/EVENTO');

  await CategoriaLinha.salvarValoresComerciais(catId, [
    { canal_venda_id: idV, preco: 59.9, forma_comercializacao: 'PESO', unidade_comercial: 'KG' },
    { canal_venda_id: idA, preco: 30.0, forma_comercializacao: 'VOLUME', unidade_comercial: 'LITRO' },
    { canal_venda_id: idE, preco: 28.0, forma_comercializacao: 'VOLUME', unidade_comercial: 'LITRO' }
  ]);

  const produto = {
    id: 900057,
    nome: 'Sorvete de Abacaxi',
    preco_venda: 1,
    categoria_id: catId,
    linha_comercial_id: polId
  };

  // Varejo → Peso / KG
  const rV = await ComercialPrecoResolver.resolver({ produto, canal: 'VAREJO' });
  assert.strictEqual(rV.origem, ComercialPrecoResolver.ORIGEM_LINHA);
  assert.strictEqual(rV.formaComercializacao, 'PESO');
  assert.strictEqual(rV.unidadeComercial, 'KG');
  assert.strictEqual(Number(rV.preco), 59.9);
  const totalVarejo = calcularTotal(2.35, rV.preco);
  assert.strictEqual(totalVarejo, 140.77);

  // Atacado → Volume / Litro
  const rA = await ComercialPrecoResolver.resolver({ produto, canal: 'ATACADO' });
  assert.strictEqual(rA.formaComercializacao, 'VOLUME');
  assert.ok(['LITRO', 'L'].includes(rA.unidadeComercial));
  assert.strictEqual(Number(rA.preco), 30);
  assert.strictEqual(calcularTotal(5, rA.preco), 150);

  // Evento → Volume (config categoria)
  const rE = await ComercialPrecoResolver.resolver({ produto, canal: 'EVENTO' });
  assert.strictEqual(rE.formaComercializacao, 'VOLUME');
  assert.strictEqual(Number(rE.preco), 28);
  assert.strictEqual(calcularTotal(2, rE.preco), 56);

  // Impressão comprovante — peso
  const htmlPeso = comprovante.montarHtmlComprovanteVenda({
    nome_empresa: 'Teste',
    cupom: 'T57',
    total: 140.77,
    itens: [{
      nome: 'Sorvete de Abacaxi',
      quantidade: 2.35,
      preco_unitario: 59.9,
      subtotal: 140.77,
      forma_comercializacao: 'PESO',
      unidade_comercial: 'KG'
    }],
    pagamentos: [{ forma_pagamento: 'dinheiro', valor: 140.77 }]
  });
  assert.ok(htmlPeso.includes('2,350 KG') || htmlPeso.includes('2.350 KG'), 'impressão peso qty');
  assert.ok(htmlPeso.includes('59,90/KG'), 'impressão preço/KG');

  // Impressão — litros
  const htmlVol = comprovante.montarHtmlComprovanteVenda({
    nome_empresa: 'Teste',
    cupom: 'T57B',
    total: 150,
    itens: [{
      nome: 'Sorvete de Abacaxi',
      quantidade: 5,
      preco_unitario: 30,
      subtotal: 150,
      forma_comercializacao: 'VOLUME',
      unidade_comercial: 'LITRO'
    }],
    pagamentos: [{ forma_pagamento: 'dinheiro', valor: 150 }]
  });
  assert.ok(/5[,.]?0* L/.test(htmlVol) || htmlVol.includes('5 L'), 'impressão litros qty');
  assert.ok(htmlVol.includes('30,00/L'), 'impressão preço/L');

  // Persistência forma no item (smoke INSERT)
  const vendaIns = await dbRun(
    `INSERT INTO vendas (codigo, data_venda, total, status, canal_venda)
     VALUES (?, date('now'), 140.77, 'concluida', 'VAREJO')`,
    [`RCM057_${suffix}`]
  );
  await dbRun(
    `INSERT INTO produtos (nome, preco_venda, categoria_id, linha_comercial_id, ativo)
     VALUES (?, 1, ?, ?, 1)`,
    [`Prod Sorvete ${suffix}`, catId, polId]
  );
  const prodRow = await dbGet(
    `SELECT id FROM produtos WHERE nome = ?`,
    [`Prod Sorvete ${suffix}`]
  );
  await dbRun(
    `INSERT INTO vendas_itens (
      venda_id, produto_id, quantidade, preco_unitario, subtotal,
      tipo_venda, unidade_comercial, forma_comercializacao
    ) VALUES (?, ?, 2.35, 59.9, 140.77, 'PESO', 'KG', 'PESO')`,
    [vendaIns.lastID, prodRow.id]
  );
  const itemSalvo = await dbGet(
    `SELECT forma_comercializacao, unidade_comercial, quantidade, preco_unitario
     FROM vendas_itens WHERE venda_id = ?`,
    [vendaIns.lastID]
  );
  assert.strictEqual(itemSalvo.forma_comercializacao, 'PESO');
  assert.strictEqual(itemSalvo.unidade_comercial, 'KG');

  // Cleanup
  await dbRun(`DELETE FROM vendas_itens WHERE venda_id = ?`, [vendaIns.lastID]);
  await dbRun(`DELETE FROM vendas WHERE id = ?`, [vendaIns.lastID]);
  await dbRun(`DELETE FROM produtos WHERE id = ?`, [prodRow.id]);
  await dbRun(`DELETE FROM linha_comercial_valores WHERE linha_id = ?`, [polId]);
  await dbRun(`UPDATE categorias SET linha_comercial_id = NULL WHERE id = ?`, [catId]);
  await dbRun(`DELETE FROM linhas_comerciais WHERE id = ?`, [polId]);
  await dbRun(`DELETE FROM categorias WHERE id = ?`, [catId]);

  console.log('RCM-05.7 — Montador de Sorvete: OK');
}

run().catch((err) => {
  console.error('RCM-05.7 FALHOU:', err);
  process.exit(1);
});
