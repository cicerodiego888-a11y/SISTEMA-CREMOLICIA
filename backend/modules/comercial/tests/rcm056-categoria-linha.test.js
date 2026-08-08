/**
 * A-1 / RCM-05.6 — Categoria NAO cria Politica Comercial
 */

const assert = require('assert');
const path = require('path');

const ComercialPrecoResolver = require(path.join(__dirname, '../preco/ComercialPrecoResolver'));
const CategoriaLinha = require(path.join(__dirname, '../categoria-linha/CategoriaLinhaComercialService'));
const ProdutoPoliticas = require(path.join(__dirname, '../politicas/ProdutoPoliticasComerciaisService'));
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

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

async function run() {
  await whenReady();
  await bootstrapComercialV2Schema(db);
  ComercialPrecoResolver.setLogsHabilitados(false);
  ComercialPrecoResolver.invalidateCache();

  const colsPpc = await dbAll(`PRAGMA table_info(produto_politicas_comerciais)`);
  assert.ok(colsPpc.length > 0, 'tabela produto_politicas_comerciais existe');

  const suffix = Date.now().toString(36);
  const nome = `Cat A1 ${suffix}`;

  const ins = await dbRun(
    `INSERT INTO categorias (nome, descricao, tipo, ativo) VALUES (?, ?, 'produto', 1)`,
    [nome, 'teste a1']
  );
  const catId = ins.lastID;

  // A-1: sincronizarCategoria NAO cria politica
  const sync = await CategoriaLinha.sincronizarCategoria(catId);
  assert.strictEqual(sync, null, 'categoria nova nao cria politica');

  const cat = await dbGet(`SELECT * FROM categorias WHERE id = ?`, [catId]);
  assert.ok(!cat.linha_comercial_id, 'categoria sem linha_comercial_id automatico');

  const politicasAntes = await dbAll(
    `SELECT id FROM linhas_comerciais WHERE categoria_origem_id = ?`,
    [catId]
  );
  assert.strictEqual(politicasAntes.length, 0, 'nenhuma politica com categoria_origem');

  // Cadastro independente de Politica
  const pol = await dbRun(
    `INSERT INTO linhas_comerciais (codigo, descricao, ativo) VALUES (?, ?, 1)`,
    [`POL_${suffix}`, `Politica ${suffix}`]
  );
  const polId = pol.lastID;

  const canais = await dbAll(`SELECT id, codigo FROM canais_venda WHERE ativo = 1`);
  const varejo = canais.find((c) => c.codigo === 'VAREJO');
  assert.ok(varejo);

  await dbRun(
    `INSERT INTO linha_comercial_valores (linha_id, canal_venda_id, preco, forma_comercializacao, unidade_comercial)
     VALUES (?, ?, 15.5, 'UNIDADE', 'UN')`,
    [polId, varejo.id]
  );

  // Produto sem politica explicita = pode vender via legado/tabela (preco_venda)
  const rSem = await ComercialPrecoResolver.resolver({
    produto: { id: 0, nome: 'Prod Sem', preco_venda: 9.99, categoria_id: catId },
    canal: 'VAREJO'
  });
  assert.ok(Number(rSem.preco) > 0, 'produto antigo continua precificavel');

  // Produto com N:N
  const prod = await dbRun(
    `INSERT INTO produtos (nome, preco_venda, categoria_id, ativo) VALUES (?, 1, ?, 1)`,
    [`Prod A1 ${suffix}`, catId]
  );
  const prodId = prod.lastID;
  await ProdutoPoliticas.salvarPoliticasProduto(prodId, [polId]);

  const ids = await ProdutoPoliticas.listarIdsPoliticasProduto(prodId);
  assert.deepStrictEqual(ids, [polId]);

  const rPol = await ComercialPrecoResolver.resolver({
    produto: { id: prodId, nome: 'Prod A1', preco_venda: 1, categoria_id: catId },
    canal: 'VAREJO'
  });
  assert.strictEqual(rPol.origem, ComercialPrecoResolver.ORIGEM_LINHA);
  assert.strictEqual(Number(rPol.preco), 15.5);

  // Desativar categoria nao desativa politica
  await CategoriaLinha.desativarPorCategoria(catId);
  const polAtiva = await dbGet(`SELECT ativo FROM linhas_comerciais WHERE id = ?`, [polId]);
  assert.strictEqual(Number(polAtiva.ativo), 1, 'politica permanece ativa');

  const fix = await CategoriaLinha.corrigirAutomaticamente();
  assert.strictEqual(fix.sincronizados, 0);

  // Cleanup
  await dbRun(`DELETE FROM produto_politicas_comerciais WHERE produto_id = ?`, [prodId]);
  await dbRun(`DELETE FROM produtos WHERE id = ?`, [prodId]);
  await dbRun(`DELETE FROM linha_comercial_valores WHERE linha_id = ?`, [polId]);
  await dbRun(`DELETE FROM linhas_comerciais WHERE id = ?`, [polId]);
  await dbRun(`DELETE FROM categorias WHERE id = ?`, [catId]);

  console.log('A-1 — Desacoplamento Categoria x Politica Comercial: OK');
}

run().catch((err) => {
  console.error('A-1 / RCM-05.6 FALHOU:', err);
  process.exit(1);
});
