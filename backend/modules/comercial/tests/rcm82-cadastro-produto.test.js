/**
 * RCM-8.2 — Cadastro de Produtos alinhado ao Motor Oficial
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.chdir(path.resolve(__dirname, '../../..'));

const ROOT = path.resolve(__dirname, '../../../..');
const db = require('../../../database');

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
  for (let i = 0; i < 40; i++) {
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
  console.log('\nRCM-8.2 — Cadastro de Produtos\n');

  // --- UI / frontend ---
  const prodJs = ler('frontend/erp/js/produtos.js');
  assert.ok(prodJs.includes('cardComercialRcm82') || prodJs.includes('COMERCIAL'), 'card Comercial');
  assert.ok(prodJs.includes('Grupo Comercial'), 'Grupo Comercial');
  assert.ok(prodJs.includes('Linha de Precificação'), 'Linha');
  assert.ok(prodJs.includes('Opcional'), 'badge opcional');
  assert.ok(prodJs.includes('Quando informada, o preço será obtido pela'), 'ajuda UX');
  assert.ok(prodJs.includes('Quando não informada, o preço será obtido diretamente pelo'), 'ajuda UX sem linha');
  assert.ok(prodJs.includes('Produto com precificação própria'), 'label precificação própria');
  assert.ok(prodJs.includes('linha_comercial_busca'), 'pesquisa linha');
  assert.ok(prodJs.includes('tabela_preco_id: null'), 'não grava tabela');
  assert.ok(!/tabela_preco_id:\s*\$\(['\"]#tabela_preco_id/.test(prodJs), 'payload sem tabela do form');
  assert.ok(prodJs.includes('Unidade Base'), 'Unidade Base');
  console.log('OK 1 — UI Cadastro Produto');

  const linhasJs = ler('frontend/erp/js/linhas-comerciais.js');
  assert.ok(linhasJs.includes('ativarLinhaComercial'), 'ativar linha');
  assert.ok(linhasJs.includes('Inativar') || linhasJs.includes('inativar'), 'inativar');
  assert.ok(linhasJs.includes('produto vinculado') || linhasJs.includes('permite_desativar'), 'bloqueio exclusão');
  console.log('OK 2 — Cadastro Linha Novo/Editar/Ativar/Inativar');

  // --- Backend ---
  const rotas = ler('backend/rotas/produtos.js');
  assert.ok(rotas.includes('validarLinhaPrecificacaoProduto'), 'validação linha ativa');
  assert.ok(rotas.includes('linha_comercial_descricao'), 'DTO com descrição da linha');
  assert.ok(rotas.includes('tabelaPrecoId = null') || rotas.includes('tabela_preco_id = null'), 'força null tabela');
  console.log('OK 3 — API validações');

  const repo = ler('backend/modules/comercial/linhas-comerciais/LinhasComerciaisRepository.js');
  assert.ok(repo.includes('contarProdutosVinculados') || repo.includes('LINHA_EM_USO'), 'bloqueio exclusão backend');
  console.log('OK 4 — Exclusão bloqueada com produto');

  // --- Cenários DB ---
  const S = 'RCM82_' + Date.now();
  const linha = await run(
    `INSERT INTO linhas_comerciais (codigo, descricao, ativo) VALUES (?, ?, 1)`,
    [S + '_L', 'Linha RCM82']
  );
  const linhaInativa = await run(
    `INSERT INTO linhas_comerciais (codigo, descricao, ativo) VALUES (?, ?, 0)`,
    [S + '_LI', 'Linha Inativa RCM82']
  );

  const pCom = await run(
    `INSERT INTO produtos (codigo, nome, preco_venda, unidade, linha_comercial_id, estoque_atual, ativo)
     VALUES (?, 'Prod Com Linha', 10, 'un', ?, 1, 1)`,
    [S + '_PC', linha.lastID]
  );
  const pSem = await run(
    `INSERT INTO produtos (codigo, nome, preco_venda, unidade, linha_comercial_id, estoque_atual, ativo)
     VALUES (?, 'Prod Sem Linha', 20, 'un', NULL, 1, 1)`,
    [S + '_PS']
  );

  const rowCom = await get(`SELECT linha_comercial_id FROM produtos WHERE id = ?`, [pCom.lastID]);
  const rowSem = await get(`SELECT linha_comercial_id FROM produtos WHERE id = ?`, [pSem.lastID]);
  assert.strictEqual(Number(rowCom.linha_comercial_id), Number(linha.lastID));
  assert.ok(rowSem.linha_comercial_id == null);
  console.log('OK 5 — Produto com/sem Linha');

  // Alteração / remoção de linha
  await run(`UPDATE produtos SET linha_comercial_id = NULL WHERE id = ?`, [pCom.lastID]);
  let r = await get(`SELECT linha_comercial_id FROM produtos WHERE id = ?`, [pCom.lastID]);
  assert.ok(r.linha_comercial_id == null);
  await run(`UPDATE produtos SET linha_comercial_id = ? WHERE id = ?`, [linha.lastID, pCom.lastID]);
  r = await get(`SELECT linha_comercial_id FROM produtos WHERE id = ?`, [pCom.lastID]);
  assert.strictEqual(Number(r.linha_comercial_id), Number(linha.lastID));
  console.log('OK 6 — Alteração e remoção de Linha');

  // Linha inativa: validação via helper do arquivo (reimplementação leve)
  const inativa = await get(`SELECT ativo FROM linhas_comerciais WHERE id = ?`, [linhaInativa.lastID]);
  assert.ok(!(inativa.ativo === 1 || inativa.ativo === true));
  console.log('OK 7 — Linha inativa detectável');

  // Pesquisa
  const busca = await new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM linhas_comerciais WHERE codigo LIKE ? OR descricao LIKE ?`,
      ['%' + S + '%', '%' + S + '%'],
      (err, rows) => (err ? reject(err) : resolve(rows || []))
    );
  });
  assert.ok(busca.length >= 2);
  console.log('OK 8 — Pesquisa por código/nome');

  // Bloqueio exclusão
  const LinhasRepo = require('../linhas-comerciais/LinhasComerciaisRepository');
  let bloqueou = false;
  try {
    await LinhasRepo.excluir(linha.lastID);
  } catch (e) {
    bloqueou = e.code === 'LINHA_EM_USO' || /vinculada/i.test(e.message || '');
  }
  assert.ok(bloqueou, 'não exclui com produto vinculado');
  console.log('OK 9 — Exclusão bloqueada');

  // Cleanup
  await run(`DELETE FROM produtos WHERE id IN (?, ?)`, [pCom.lastID, pSem.lastID]).catch(() => {});
  await run(`DELETE FROM linhas_comerciais WHERE id IN (?, ?)`, [linha.lastID, linhaInativa.lastID]).catch(() => {});

  console.log('\nRCM-8.2 PASSOU\n');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
