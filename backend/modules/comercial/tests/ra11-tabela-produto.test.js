/**
 * RA-1.1 — Tabela × Produto × Canal (sem depender de Política)
 */

const assert = require('assert');
const path = require('path');

const ComercialPrecoResolver = require(path.join(__dirname, '../preco/ComercialPrecoResolver'));
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
    db.run(sql, params, function onRun(err) {
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

async function run() {
  await whenReady();
  await bootstrapComercialV2Schema(db);
  ComercialPrecoResolver.setLogsHabilitados(false);
  ComercialPrecoResolver.invalidateCache();

  const cols = await new Promise((resolve, reject) => {
    db.all(`PRAGMA table_info(tabela_preco_produto_itens)`, [], (err, rows) =>
      (err ? reject(err) : resolve(rows || []))
    );
  });
  assert.ok(cols.length > 0, 'tabela_preco_produto_itens existe');

  const suffix = Date.now().toString(36);
  const canais = await canaisService.listar({ ativos: '1' });
  const varejo = canais.find((c) => String(c.codigo).toUpperCase() === 'VAREJO');
  assert.ok(varejo, 'canal VAREJO');

  const prod = await dbRun(
    `INSERT INTO produtos (nome, codigo, preco_venda, ativo) VALUES (?, ?, 1, 1)`,
    [`Prod RA11 ${suffix}`, `RA11_${suffix}`]
  );
  const produtoId = prod.lastID;

  // Criar tabela SEM política — só itens produto
  const tabela = await tabelasService.criar({
    codigo: `T_RA11_${suffix}`,
    nome: `Tabela RA11 ${suffix}`,
    ativo: true,
    itens: [
      {
        produto_id: produtoId,
        canal_venda_id: varejo.id,
        preco: 17.5,
        forma_comercializacao: 'UNIDADE',
        unidade_comercial: 'UN'
      }
    ]
  });

  assert.ok(tabela.id, 'tabela criada');
  assert.ok(Array.isArray(tabela.itens) && tabela.itens.length >= 1, 'itens salvos');

  await dbRun(`UPDATE produtos SET tabela_preco_id = ? WHERE id = ?`, [tabela.id, produtoId]);

  const r = await ComercialPrecoResolver.resolver({
    produto: { id: produtoId, nome: 'Prod', preco_venda: 1, tabela_preco_id: tabela.id },
    canal: 'VAREJO'
  });

  assert.strictEqual(r.origem, ComercialPrecoResolver.ORIGEM_TABELA_PRODUTO);
  assert.strictEqual(Number(r.preco), 17.5);
  assert.strictEqual(r.formaComercializacao, 'UNIDADE');

  // Compat: valores canal espelhados
  const compat = await dbGet(
    `SELECT preco FROM tabela_preco_valores
     WHERE tabela_preco_id = ? AND canal_venda_id = ?
       AND (linha_comercial_id IS NULL OR linha_comercial_id = 0)`,
    [tabela.id, varejo.id]
  );
  assert.ok(compat, 'compat tabela_preco_valores');
  assert.strictEqual(Number(compat.preco), 17.5);

  // Cleanup
  await dbRun(`DELETE FROM tabela_preco_produto_itens WHERE tabela_preco_id = ?`, [tabela.id]);
  await dbRun(`DELETE FROM tabela_preco_valores WHERE tabela_preco_id = ?`, [tabela.id]);
  await dbRun(`DELETE FROM tabela_preco_linhas WHERE tabela_preco_id = ?`, [tabela.id]);
  await dbRun(`DELETE FROM tabelas_preco WHERE id = ?`, [tabela.id]);
  await dbRun(`DELETE FROM produtos WHERE id = ?`, [produtoId]);

  console.log('RA-1.1 — Tabela × Produto × Canal: OK');
}

run().catch((err) => {
  console.error('RA-1.1 FALHOU:', err);
  process.exit(1);
});
