/**
 * RCM-05.15 / RA-6.7 — Arquitetura Tabelas de Preços × Linha de Precificação
 * Atualizado na limpeza de legado: nomenclatura oficial RA-6.6.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../../../..');
const migPath = path.join(root, 'backend/modules/comercial/migrations/012_tabela_preco_linha.js');
const idxPath = path.join(root, 'backend/modules/comercial/migrations/index.js');
const repoPath = path.join(root, 'backend/modules/comercial/tabelas-preco/TabelasPrecoRepository.js');
const svcPath = path.join(root, 'backend/modules/comercial/tabelas-preco/TabelasPrecoService.js');
const ctrlPath = path.join(root, 'backend/modules/comercial/tabelas-preco/TabelasPrecoController.js');
const routesPath = path.join(root, 'backend/modules/comercial/routes/comercialCadastros.routes.js');
const resolverPath = path.join(root, 'backend/modules/comercial/preco/ComercialPrecoResolver.js');
const erpJs = path.join(root, 'frontend/erp/js/tabelas-preco.js');
const erpRa6 = path.join(root, 'frontend/erp/js/tabelas-preco-ra6.js');
const erpHtml = path.join(root, 'frontend/erp/pages/tabelas-preco.html');
const indexHtml = path.join(root, 'frontend/erp/index.html');

function run() {
  const mig = fs.readFileSync(migPath, 'utf8');
  const idx = fs.readFileSync(idxPath, 'utf8');
  const repo = fs.readFileSync(repoPath, 'utf8');
  const svc = fs.readFileSync(svcPath, 'utf8');
  const ctrl = fs.readFileSync(ctrlPath, 'utf8');
  const routes = fs.readFileSync(routesPath, 'utf8');
  const resolver = fs.readFileSync(resolverPath, 'utf8');
  const ui = fs.readFileSync(erpJs, 'utf8');
  const uiRa6 = fs.readFileSync(erpRa6, 'utf8');
  const html = fs.readFileSync(erpHtml, 'utf8');
  const index = fs.readFileSync(indexHtml, 'utf8');

  // Migração
  assert.ok(mig.includes('tabela_preco_linhas'), 'junction tabela_preco_linhas');
  assert.ok(mig.includes('linha_comercial_id'), 'coluna linha_comercial_id');
  assert.ok(mig.includes('backfill') || mig.includes('INSERT OR IGNORE INTO tabela_preco_linhas'), 'backfill');
  assert.ok(idx.includes('012_tabela_preco_linha'), 'migration registrada');

  // Seleção de linha + grade
  assert.ok(repo.includes('montarGradePorLinhas'), 'grade por linhas');
  assert.ok(repo.includes('substituirLinhas'), 'vínculo N:N');
  assert.ok(repo.includes('linha_comercial_valores'), 'compat LCV no COALESCE');
  assert.ok(svc.includes('Linha de Precificação'), 'nomenclatura oficial no service');
  assert.ok(svc.includes('gradePorLinhas'), 'service gradePorLinhas');
  assert.ok(ctrl.includes('gradePorLinhas'), 'controller');
  assert.ok(routes.includes('grade-por-linhas'), 'rota');

  // Herança forma/unidade via COALESCE com linha (compat)
  assert.ok(repo.includes('COALESCE(tpv.forma_comercializacao, lcv.forma_comercializacao)'), 'herda forma');
  assert.ok(repo.includes('COALESCE(tpv.unidade_comercial, lcv.unidade_comercial)'), 'herda unidade');

  // ERP oficial RA-6 — UX ativa
  assert.ok(index.includes('tabelas-preco-ra6.js'), 'ra6 carregado no index');
  assert.ok(!index.includes('tabelas-preco-ra11.js'), 'ra11 não carregado');
  assert.ok(!index.includes('tabelas-preco-ra2.js'), 'ra2 não carregado');
  assert.ok(uiRa6.includes('Unidade de Comercialização'), 'grade RA-6.6');
  assert.ok(uiRa6.includes('Linha de Precificação'), 'linha na grade');
  assert.ok(ui.includes('linhas_ids') || uiRa6.includes('linhas_ids'), 'payload linhas_ids');
  assert.ok(html.includes('Tabelas de Preços'), 'página oficial');
  assert.ok(html.includes('Linha') || html.includes('Linhas'), 'coluna/linhas na lista');

  // Resolver oficial
  assert.ok(resolver.includes('tabela_preco_valores') || resolver.includes('buscarPrecoTabelaLinha'), 'SSOT tabela×linha');
  assert.ok(
    resolver.includes('Tabela de Preço') || resolver.includes('Tabela de Preços') || resolver.includes('Linha de Precificação'),
    'cadeia resolução'
  );

  // Sem regressão de APIs principais
  assert.ok(svc.includes('async criar') && svc.includes('async atualizar'), 'CRUD');
  assert.ok(repo.includes('salvarCompleto'), 'salvarCompleto');

  // Código morto removido (RA-6.7)
  assert.ok(!fs.existsSync(path.join(root, 'frontend/erp/js/tabelas-preco-ra11.js')), 'ra11 removido');
  assert.ok(!fs.existsSync(path.join(root, 'frontend/erp/js/tabelas-preco-ra2.js')), 'ra2 removido');
  assert.ok(!repo.includes('async upsertValores(tabelaPrecoId'), 'alias morto upsertValores removido');

  console.log('RCM-05.15/RA-6.7 OK — Tabelas de Preços × Linha de Precificação');
}

run();
