/**
 * RCM-05.3 — Gerenciador de Canais de Venda
 */

const assert = require('assert');
const path = require('path');

const CanalVendaResolver = require(path.join(__dirname, '../preco/CanalVendaResolver'));
const ComercialPrecoResolver = require(path.join(__dirname, '../preco/ComercialPrecoResolver'));
const configuracaoService = require(path.join(__dirname, '../configuracao/ConfiguracaoComercialService'));
const tabelasService = require(path.join(__dirname, '../tabelas-preco/TabelasPrecoService'));
const canaisService = require(path.join(__dirname, '../canais/CanaisVendaService'));
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

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
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

async function run() {
  ComercialPrecoResolver.setLogsHabilitados(false);
  await whenReady();
  await bootstrapComercialV2Schema(db);

  const colsProd = await dbAll(`PRAGMA table_info(produtos)`);
  assert.ok(colsProd.some((c) => c.name === 'participa_atacado'), 'coluna participa_atacado');

  const colsVendas = await dbAll(`PRAGMA table_info(vendas)`);
  assert.ok(colsVendas.some((c) => c.name === 'canal_venda'), 'coluna vendas.canal_venda');

  const suffix = Date.now().toString(36).toUpperCase();
  const canais = await canaisService.listar({ ativos: '1' });
  const varejo = canais.find((c) => String(c.codigo).toUpperCase() === 'VAREJO');
  const atacado = canais.find((c) => String(c.codigo).toUpperCase() === 'ATACADO');
  const evento = canais.find((c) => String(c.codigo).toUpperCase() === 'EVENTO');
  assert.ok(varejo && atacado && evento, 'canais oficiais');

  await configuracaoService.salvar({
    atacado_habilitado: true,
    quantidade_minima: 30,
    tipo_contagem: 'TOTAL_VENDA',
    permitir_produtos_diferentes: true,
    permitir_categorias_diferentes: true,
    canal_atacado_id: atacado.id
  });

  const tabela = await tabelasService.criar({
    codigo: `RC53_${suffix}`,
    nome: `Tabela RC53 ${suffix}`,
    ativo: true,
    valores: [
      { canal_venda_id: varejo.id, preco: 2.5 },
      { canal_venda_id: atacado.id, preco: 2.0 },
      { canal_venda_id: evento.id, preco: 1.8 }
    ]
  });

  // Produtos mock via itens (participa_atacado no item)
  const itensMisto = [
    { produto_id: 1, quantidade: 5, participa_atacado: 1 },
    { produto_id: 2, quantidade: 8, participa_atacado: 1 },
    { produto_id: 3, quantidade: 6, participa_atacado: 1 },
    { produto_id: 4, quantidade: 11, participa_atacado: 1 }
  ];
  // 5+8+6+11 = 30 → ATACADO
  const autoAtacado = await CanalVendaResolver.resolver({ itens: itensMisto });
  assert.strictEqual(autoAtacado.canal, 'ATACADO');
  assert.strictEqual(autoAtacado.quantidade_avaliada, 30);
  assert.strictEqual(autoAtacado.canal_manual, false);

  // Abaixo do mínimo → VAREJO
  const abaixo = await CanalVendaResolver.resolver({
    itens: [{ produto_id: 1, quantidade: 10, participa_atacado: 1 }]
  });
  assert.strictEqual(abaixo.canal, 'VAREJO');

  // Não elegíveis não contam
  const soInelegiveis = await CanalVendaResolver.resolver({
    itens: [
      { produto_id: 10, quantidade: 50, participa_atacado: 0 },
      { produto_id: 11, quantidade: 50, participa_atacado: 0 }
    ]
  });
  assert.strictEqual(soInelegiveis.canal, 'VAREJO');
  assert.strictEqual(soInelegiveis.motivo, 'sem_itens_elegiveis_atacado');

  // Elegíveis + inelegíveis: só elegíveis somam
  const parcial = await CanalVendaResolver.resolver({
    itens: [
      { produto_id: 1, quantidade: 20, participa_atacado: 1 },
      { produto_id: 2, quantidade: 20, participa_atacado: 0 }
    ]
  });
  assert.strictEqual(parcial.canal, 'VAREJO');
  assert.strictEqual(parcial.quantidade_avaliada, 20);

  // EVENTO manual
  const manual = await CanalVendaResolver.resolver({
    itens: itensMisto,
    canal_manual: 'EVENTO'
  });
  assert.strictEqual(manual.canal, 'EVENTO');
  assert.strictEqual(manual.canal_manual, true);
  assert.strictEqual(manual.motivo, 'canal_manual');

  // Preços via ComercialPrecoResolver por canal
  await dbRun(
    `INSERT INTO produtos (nome, preco_venda, tabela_preco_id, participa_atacado, ativo)
     VALUES (?, ?, ?, 1, 1)`,
    [`Picole RC53 ${suffix}`, 9.99, tabela.id]
  );
  const produtoId = (await dbGet(`SELECT id FROM produtos WHERE nome = ?`, [`Picole RC53 ${suffix}`])).id;

  const rVarejo = await ComercialPrecoResolver.resolver({
    produto: { id: produtoId, nome: 'x', preco_venda: 9.99, tabela_preco_id: tabela.id },
    canal: 'VAREJO'
  });
  const rAtacado = await ComercialPrecoResolver.resolver({
    produto: { id: produtoId, nome: 'x', preco_venda: 9.99, tabela_preco_id: tabela.id },
    canal: 'ATACADO'
  });
  const rEvento = await ComercialPrecoResolver.resolver({
    produto: { id: produtoId, nome: 'x', preco_venda: 9.99, tabela_preco_id: tabela.id },
    canal: 'EVENTO'
  });
  assert.strictEqual(rVarejo.preco_venda, 2.5);
  assert.strictEqual(rAtacado.preco_venda, 2.0);
  assert.strictEqual(rEvento.preco_venda, 1.8);

  const lote = await configuracaoService.resolverPrecosVenda({
    itens: [{ produto_id: produtoId, quantidade: 30, participa_atacado: 1 }],
    canal: 'EVENTO'
  });
  assert.strictEqual(lote.canal, 'EVENTO');
  assert.strictEqual(lote.canal_manual, true);
  assert.strictEqual(lote.itens[0].preco_venda, 1.8);

  // Gravação canal_venda em vendas (smoke schema)
  await dbRun(
    `INSERT INTO vendas (codigo, data_venda, total, canal_venda, status)
     VALUES (?, date('now'), 10, 'EVENTO', 'concluida')`,
    [`RC53V_${suffix}`]
  );
  const venda = await dbGet(`SELECT canal_venda FROM vendas WHERE codigo = ?`, [`RC53V_${suffix}`]);
  assert.strictEqual(venda.canal_venda, 'EVENTO');

  await dbRun(`DELETE FROM vendas WHERE codigo = ?`, [`RC53V_${suffix}`]);
  await dbRun(`DELETE FROM produtos WHERE id = ?`, [produtoId]);
  await tabelasService.excluir(tabela.id);

  console.log('✔ RCM-05.3 Gerenciador de Canais de Venda — OK');
  process.exit(0);
}

run().catch((err) => {
  console.error('✖ RCM-05.3 falhou:', err);
  process.exit(1);
});
