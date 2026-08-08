/**
 * RCM-04.6 — Consolidação Comercialização V2 (resolver + diagnóstico + canal)
 */

const assert = require('assert');
const path = require('path');

const ComercialPrecoResolver = require(path.join(__dirname, '../preco/ComercialPrecoResolver'));
const CanalVendaResolver = require(path.join(__dirname, '../preco/CanalVendaResolver'));
const diagnosticoService = require(path.join(__dirname, '../diagnostico/DiagnosticoComercialService'));
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

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

async function run() {
  ComercialPrecoResolver.setLogsHabilitados(false);
  await whenReady();
  await bootstrapComercialV2Schema(db);

  const canais = await canaisService.listar({ ativos: '1' });
  const varejo = canais.find((c) => String(c.codigo).toUpperCase() === 'VAREJO');
  const atacado = canais.find((c) => String(c.codigo).toUpperCase() === 'ATACADO');
  assert.ok(varejo && atacado, 'canais VAREJO/ATACADO');

  const suffix = Date.now().toString(36).toUpperCase();
  const tabela = await tabelasService.criar({
    codigo: `RC46_${suffix}`,
    nome: `Tabela RC46 ${suffix}`,
    ativo: true,
    valores: [
      { canal_venda_id: varejo.id, preco: 5 },
      { canal_venda_id: atacado.id, preco: 3.5 }
    ]
  });

  // Produto com tabela
  const comTabela = await ComercialPrecoResolver.resolver({
    produto: { id: 1, nome: 'Picolé Chocolate', preco_venda: 9.99, tabela_preco_id: tabela.id },
    canal: 'VAREJO'
  });
  assert.strictEqual(comTabela.preco_venda, 5);
  assert.strictEqual(comTabela.origem, 'tabela_preco');
  assert.strictEqual(comTabela.fallback, false);

  // Produto sem tabela → fallback
  const semTabela = await ComercialPrecoResolver.resolver({
    produto: { nome: 'Sem Tabela', preco_venda: 2.5 }
  });
  assert.strictEqual(semTabela.preco_venda, 2.5);
  assert.strictEqual(semTabela.origem, 'produto.preco_venda');
  assert.strictEqual(semTabela.fallback, true);

  // Tabela sem preço no canal → fallback
  const tabelaVazia = await tabelasService.criar({
    codigo: `RC46V_${suffix}`,
    nome: `Tabela Vazia RC46 ${suffix}`,
    ativo: true,
    valores: []
  });
  const semCanal = await ComercialPrecoResolver.resolver({
    produto: { nome: 'Sem Canal', preco_venda: 8.8, tabela_preco_id: tabelaVazia.id },
    canal: 'VAREJO'
  });
  assert.strictEqual(semCanal.preco_venda, 8.8);
  assert.strictEqual(semCanal.fallback, true);

  // Diagnóstico
  const diag = await ComercialPrecoResolver.diagnosticar({
    produto: { id: 1, nome: 'Picolé Chocolate', preco_venda: 9.99, tabela_preco_id: tabela.id },
    canal: 'ATACADO'
  });
  assert.strictEqual(diag.canal, 'ATACADO');
  assert.strictEqual(diag.preco, 3.5);
  assert.strictEqual(diag.origem, 'Tabela de Preço');

  const diagFallback = await ComercialPrecoResolver.diagnosticar({
    produto: { nome: 'Legado', preco_venda: 1.11 }
  });
  assert.strictEqual(diagFallback.origem, 'Fallback (Legado)');

  // Canal resolver (desabilitado → VAREJO)
  await configuracaoService.salvar({
    atacado_habilitado: false,
    quantidade_minima: 30,
    tipo_contagem: 'TOTAL_VENDA',
    permitir_produtos_diferentes: true,
    permitir_categorias_diferentes: true,
    canal_atacado_id: atacado.id
  });
  const canalOff = await CanalVendaResolver.resolver({
    itens: [{ produto_id: 1, quantidade: 100 }]
  });
  assert.strictEqual(canalOff.canal, 'VAREJO');

  await configuracaoService.salvar({
    atacado_habilitado: true,
    quantidade_minima: 10,
    tipo_contagem: 'TOTAL_VENDA',
    permitir_produtos_diferentes: true,
    permitir_categorias_diferentes: true,
    canal_atacado_id: atacado.id
  });
  const canalOn = await CanalVendaResolver.resolver({
    itens: [{ produto_id: 1, quantidade: 15 }]
  });
  assert.strictEqual(canalOn.canal, 'ATACADO');

  // Preço via itens (CanalVendaResolver → ComercialPrecoResolver)
  const viaItens = await ComercialPrecoResolver.resolver({
    produto: { nome: 'Picolé Chocolate', preco_venda: 9.99, tabela_preco_id: tabela.id },
    itens: [{ produto_id: 1, quantidade: 15 }]
  });
  assert.strictEqual(viaItens.canal, 'ATACADO');
  assert.strictEqual(viaItens.preco_venda, 3.5);

  // Diagnóstico service (lista)
  const lista = await diagnosticoService.listar({ canal: 'VAREJO', limit: 5 });
  assert.ok(lista.itens);
  assert.strictEqual(lista.canal, 'VAREJO');

  // Produto real no banco (se existir)
  const prodDb = await dbGet('SELECT id, nome, preco_venda, tabela_preco_id FROM produtos LIMIT 1');
  if (prodDb) {
    const d = await diagnosticoService.diagnosticarProduto(prodDb.id, { canal: 'VAREJO' });
    assert.ok(d.produto);
    assert.ok(typeof d.preco === 'number');
    assert.ok(d.origem === 'Tabela de Preço' || d.origem === 'Fallback (Legado)');
  }

  // Restaura atacado desabilitado
  await configuracaoService.salvar({
    atacado_habilitado: false,
    quantidade_minima: 30,
    tipo_contagem: 'TOTAL_VENDA',
    permitir_produtos_diferentes: true,
    permitir_categorias_diferentes: true,
    canal_atacado_id: atacado.id
  });

  console.log('RCM-04.6 OK');
}

run().catch((err) => {
  console.error('RCM-04.6 FALHOU:', err);
  process.exit(1);
});
