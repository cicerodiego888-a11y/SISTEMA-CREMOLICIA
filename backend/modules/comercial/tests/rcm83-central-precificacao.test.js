/**
 * RCM-8.3 — Central de Precificação
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.chdir(path.resolve(__dirname, '../../..'));

const ROOT = path.resolve(__dirname, '../../../..');
const db = require('../../../database');
const central = require('../tabelas-preco/CentralPrecificacaoService');
const tabelasService = require('../tabelas-preco/TabelasPrecoService');

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
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

function ler(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

async function main() {
  await waitDb();
  console.log('\nRCM-8.3 — Central de Precificação\n');

  const ra6 = ler('frontend/erp/js/tabelas-preco-ra6.js');
  const page = ler('frontend/erp/pages/tabelas-preco.html');
  const ctrl = ler('backend/modules/comercial/tabelas-preco/TabelasPrecoController.js');
  const svc = ler('backend/modules/comercial/tabelas-preco/CentralPrecificacaoService.js');

  assert.ok(page.includes('Central de Precificação'), 'página Central');
  assert.ok(ra6.includes('Adicionar Registro'), 'add registro');
  assert.ok(ra6.includes('Como deseja formar o preço'), 'escolha Linha|Produto');
  assert.ok(ra6.includes('rcm83-painel'), 'painel inteligente');
  assert.ok(ra6.includes('Diagnosticar') || ra6.includes('diagnostico'), 'diagnóstico');
  assert.ok(ra6.includes('Cobertura') || ra6.includes('cobertura'), 'cobertura');
  assert.ok(ra6.includes('Simular') || ra6.includes('simular'), 'simulador');
  assert.ok(ra6.includes('Histórico') || ra6.includes('historico'), 'histórico');
  assert.ok(ra6.includes('ra6-status'), 'status ativo/inativo');
  assert.ok(ctrl.includes('duplicar') && ctrl.includes('simular'), 'APIs central');
  assert.ok(svc.includes('verificarCobertura') && svc.includes('simular'), 'service');
  console.log('OK 1 — UI + APIs Central');

  const S = 'RCM83_' + Date.now();
  const canal = await get(`SELECT id, codigo FROM canais_venda WHERE COALESCE(ativo,1)=1 ORDER BY id LIMIT 1`);
  assert.ok(canal, 'canal ativo');

  const linha = await run(
    `INSERT INTO linhas_comerciais (codigo, descricao, ativo) VALUES (?, ?, 1)`,
    [S + '_L', 'Linha Central']
  );
  const prodSem = await run(
    `INSERT INTO produtos (codigo, nome, preco_venda, unidade, linha_comercial_id, estoque_atual, ativo)
     VALUES (?, 'Prod Sem Linha', 9.9, 'un', NULL, 1, 1)`,
    [S + '_PS']
  );
  await run(
    `INSERT INTO produtos (codigo, nome, preco_venda, unidade, linha_comercial_id, estoque_atual, ativo)
     VALUES (?, 'Prod Com Linha', 5, 'un', ?, 1, 1)`,
    [S + '_PC', linha.lastID]
  );

  const tab = await tabelasService.criar({
    codigo: S + '_T',
    nome: 'Tabela Central ' + S,
    descricao: 'Teste RCM-8.3',
    ativo: true,
    canal_venda_id: canal.id,
    linhas_ids: [linha.lastID],
    valores: [{
      linha_comercial_id: linha.lastID,
      canal_venda_id: canal.id,
      preco: 12.5,
      unidade_comercial: 'UN',
      ativo: true
    }],
    itens_produto: [{
      produto_id: prodSem.lastID,
      canal_venda_id: canal.id,
      preco: 15,
      unidade_comercial: 'UN',
      ativo: true
    }]
  });
  assert.ok(tab.id);
  console.log('OK 2 — Linha + Produto na mesma tabela');

  const resumo = await central.resumo(tab.id);
  assert.ok(resumo.quantidade_total >= 2);
  assert.ok(Array.isArray(resumo.operacoes_utilizam));
  console.log('OK 3 — Resumo inteligente');

  const painelL = await central.produtosDaLinha(linha.lastID);
  assert.ok(painelL.total >= 1);
  const painelP = await central.painelProduto(prodSem.lastID);
  assert.ok(/apenas este produto/i.test(painelP.mensagem || ''));
  console.log('OK 4 — Painel inteligente');

  const buscaL = await central.pesquisarLinhas('Central');
  assert.ok(buscaL.some((x) => Number(x.id) === Number(linha.lastID)));
  const buscaP = await central.pesquisarProdutos(S + '_PS');
  assert.ok(buscaP.some((x) => Number(x.id) === Number(prodSem.lastID)));
  console.log('OK 5 — Pesquisa inteligente');

  const diag = await central.diagnosticarLinha(linha.lastID);
  assert.ok(diag.produtos_vinculados >= 1);
  assert.ok((diag.presente_em || []).length >= 1);
  console.log('OK 6 — Diagnóstico');

  const cob = await central.verificarCobertura(tab.id);
  assert.ok(cob.resumo);
  console.log('OK 7 — Cobertura');

  const sim = await central.simular({
    produto_id: prodSem.lastID,
    tabela_preco_id: tab.id,
    canal: canal.codigo,
    quantidade: 1
  });
  assert.ok(sim.preco != null);
  assert.ok(sim.origem);
  console.log('OK 8 — Simulador');

  await central.gravarDiffHistorico(
    tab.id,
    new Map([[`produto:${prodSem.lastID}`, { preco: 10, unidade: 'UN', tipo: 'produto', ref_id: prodSem.lastID }]]),
    'teste-rcm83',
    {}
  );
  // força mudança
  await tabelasService.atualizar(tab.id, {
    itens_produto: [{
      produto_id: prodSem.lastID,
      canal_venda_id: canal.id,
      preco: 18,
      unidade_comercial: 'UN',
      ativo: true
    }],
    valores: [{
      linha_comercial_id: linha.lastID,
      canal_venda_id: canal.id,
      preco: 12.5,
      unidade_comercial: 'UN',
      ativo: true
    }],
    linhas_ids: [linha.lastID]
  });
  const hist = await central.listarHistorico(tab.id);
  assert.ok(Array.isArray(hist));
  console.log('OK 9 — Histórico');

  const dup = await central.duplicarTabela(tab.id, {
    codigo: S + '_DUP',
    nome: 'Tabela Central Promoção'
  });
  assert.ok(dup.id && Number(dup.id) !== Number(tab.id));
  console.log('OK 10 — Duplicar tabela');

  // Performance smoke
  const t0 = Date.now();
  await central.pesquisarProdutos('a');
  await central.verificarCobertura(tab.id);
  await central.resumo(tab.id);
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 8000, 'performance smoke < 8s');
  console.log('OK 11 — Performance smoke (' + elapsed + 'ms)');

  // Cleanup
  await run(`DELETE FROM tabela_preco_historico WHERE tabela_preco_id IN (?, ?)`, [tab.id, dup.id]).catch(() => {});
  await run(`DELETE FROM tabela_preco_produto_itens WHERE tabela_preco_id IN (?, ?)`, [tab.id, dup.id]).catch(() => {});
  await run(`DELETE FROM tabela_preco_valores WHERE tabela_preco_id IN (?, ?)`, [tab.id, dup.id]).catch(() => {});
  await run(`DELETE FROM tabela_preco_linhas WHERE tabela_preco_id IN (?, ?)`, [tab.id, dup.id]).catch(() => {});
  await run(`DELETE FROM tabelas_preco WHERE id IN (?, ?)`, [tab.id, dup.id]).catch(() => {});
  await run(`DELETE FROM produtos WHERE codigo LIKE ?`, [S + '%']).catch(() => {});
  await run(`DELETE FROM linhas_comerciais WHERE codigo LIKE ?`, [S + '%']).catch(() => {});

  console.log('\nRCM-8.3 PASSOU\n');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
