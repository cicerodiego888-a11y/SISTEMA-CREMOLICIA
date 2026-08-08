/**
 * RA-6 — Aceite: tabela mono-canal + resolver por canal + regras atacado
 */
const assert = require('assert');
const path = require('path');

process.chdir(path.resolve(__dirname, '../../..'));

const db = require('../../../database');
const tabelasService = require('../tabelas-preco/TabelasPrecoService');
const ComercialPrecoResolver = require('../preco/ComercialPrecoResolver');
const CanalVendaResolver = require('../preco/CanalVendaResolver');

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
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
      await get('SELECT 1 AS ok');
      return;
    } catch (_) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error('DB não pronto');
}

async function main() {
  await waitDb();

  // Garante migration RA-6 mesmo se o processo não passou pelo bootstrap completo
  const migration016 = require('../migrations/016_tabela_mono_canal_ra6');
  await migration016(db);

  const cols = await new Promise((resolve, reject) => {
    db.all(`PRAGMA table_info(tabelas_preco)`, [], (err, rows) =>
      (err ? reject(err) : resolve(rows || []))
    );
  });
  const nomes = new Set(cols.map((c) => c.name));
  assert.ok(nomes.has('canal_venda_id'), 'coluna canal_venda_id');
  assert.ok(nomes.has('tipo_contagem'), 'coluna tipo_contagem');

  const varejo = await get(`SELECT id FROM canais_venda WHERE UPPER(codigo)='VAREJO' LIMIT 1`);
  const atacado = await get(`SELECT id FROM canais_venda WHERE UPPER(codigo)='ATACADO' LIMIT 1`);
  assert.ok(varejo?.id, 'canal VAREJO');
  assert.ok(atacado?.id, 'canal ATACADO');

  const linhaCodigo = 'RA6_L_' + Date.now();
  const linha = await run(
    `INSERT INTO linhas_comerciais (codigo, descricao, ativo)
     VALUES (?, 'Linha RA6 Teste', 1)`,
    [linhaCodigo]
  );

  const suffix = Date.now();
  const tabV = await tabelasService.criar({
    codigo: 'RA6_V_' + suffix,
    nome: 'Tabela Varejo RA6 ' + suffix,
    canal_venda_id: varejo.id,
    ativo: true,
    linhas_ids: [linha.lastID],
    valores: [{
      linha_comercial_id: linha.lastID,
      canal_venda_id: varejo.id,
      preco: 10,
      forma_comercializacao: 'UNIDADE',
      unidade_comercial: 'UN'
    }]
  });
  assert.strictEqual(Number(tabV.canal_venda_id), Number(varejo.id));
  assert.ok((tabV.valores || []).every((v) => Number(v.canal_venda_id) === Number(varejo.id)));

  const tabA = await tabelasService.criar({
    codigo: 'RA6_A_' + suffix,
    nome: 'Tabela Atacado RA6 ' + suffix,
    canal_venda_id: atacado.id,
    ativo: true,
    atacado_habilitado: true,
    quantidade_minima: 30,
    tipo_contagem: 'TOTAL_VENDA',
    linhas_ids: [linha.lastID],
    valores: [{
      linha_comercial_id: linha.lastID,
      canal_venda_id: atacado.id,
      preco: 7,
      forma_comercializacao: 'UNIDADE',
      unidade_comercial: 'UN'
    }]
  });
  assert.ok(tabA.atacado_habilitado);

  const produtoFake = {
    id: 0,
    nome: 'Fake',
    preco_venda: 99,
    linha_comercial_id: linha.lastID
  };

  const precoV = await ComercialPrecoResolver.resolver({
    produto: produtoFake,
    canal: 'VAREJO',
    tabela_preco_id: tabV.id
  });
  assert.strictEqual(Number(precoV.preco_venda), 10);
  assert.strictEqual(precoV.origem, ComercialPrecoResolver.ORIGEM_TABELA_LINHA);

  const precoA = await ComercialPrecoResolver.resolver({
    produto: produtoFake,
    canal: 'ATACADO',
    tabela_preco_id: tabA.id
  });
  assert.strictEqual(Number(precoA.preco_venda), 7);

  const porCanal = await require('../tabelas-preco/TabelasPrecoRepository')
    .buscarAtivaPorCanal(atacado.id);
  assert.ok(porCanal, 'buscarAtivaPorCanal ATACADO');
  assert.strictEqual(Number(porCanal.canal_venda_id), Number(atacado.id));

  const canalInfo = await CanalVendaResolver.resolver({
    itens: [
      { produto_id: 1, quantidade: 10, participa_atacado: true, linha_comercial_id: linha.lastID },
      { produto_id: 2, quantidade: 12, participa_atacado: true, linha_comercial_id: linha.lastID },
      { produto_id: 3, quantidade: 8, participa_atacado: true, linha_comercial_id: linha.lastID }
    ]
  });
  assert.strictEqual(canalInfo.canal, 'ATACADO');
  assert.ok(Number(canalInfo.quantidade_avaliada) >= 30);

  // cleanup
  await run('DELETE FROM tabela_preco_valores WHERE tabela_preco_id IN (?, ?)', [tabV.id, tabA.id]);
  await run('DELETE FROM tabela_preco_linhas WHERE tabela_preco_id IN (?, ?)', [tabV.id, tabA.id]);
  await run('DELETE FROM tabelas_preco WHERE id IN (?, ?)', [tabV.id, tabA.id]);
  await run('DELETE FROM linhas_comerciais WHERE id = ?', [linha.lastID]);

  console.log('RA-6 OK');
  process.exit(0);
}

main().catch((err) => {
  console.error('RA-6 FALHOU:', err);
  process.exit(1);
});
