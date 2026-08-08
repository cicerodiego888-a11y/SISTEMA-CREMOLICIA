/**
 * RCM-05.4 — Montador de Casquinha
 */

const assert = require('assert');
const path = require('path');

const Forma = require(path.join(__dirname, '../preco/FormaComercializacao'));
const casquinhaSabores = require(path.join(__dirname, '../casquinha/CasquinhaSaboresService'));
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

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
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

async function run() {
  await whenReady();
  await bootstrapComercialV2Schema(db);

  const cols = await dbAll(`PRAGMA table_info(produtos)`);
  assert.ok(cols.some((c) => c.name === 'bolas_min'), 'bolas_min');
  assert.ok(cols.some((c) => c.name === 'bolas_max'), 'bolas_max');

  const colsItens = await dbAll(`PRAGMA table_info(vendas_itens)`);
  assert.ok(colsItens.some((c) => c.name === 'quantidade_bolas'), 'vendas_itens.quantidade_bolas');

  const sabores = await casquinhaSabores.listar({ ativos: 1 });
  assert.ok(sabores.length >= 5, 'catálogo de sabores seed');
  assert.ok(sabores.some((s) => s.nome === 'Chocolate'));

  const payload = Forma.normalizarPayloadForma({
    forma_comercializacao: 'CASQUINHA',
    bolas_min: 1,
    bolas_max: 3,
    peso_medio_bola: 40
  });
  assert.strictEqual(payload.bolas_min, 1);
  assert.strictEqual(payload.bolas_max, 3);
  assert.strictEqual(payload.quantidade_bolas, 3);

  let bloqueou = false;
  try {
    Forma.normalizarPayloadForma({
      forma_comercializacao: 'CASQUINHA',
      bolas_min: 3,
      bolas_max: 1
    });
  } catch (_) {
    bloqueou = true;
  }
  assert.ok(bloqueou, 'max < min bloqueado');

  // Relacionamento item × sabores
  const suffix = Date.now().toString(36);
  await dbRun(
    `INSERT INTO vendas (codigo, data_venda, total, status) VALUES (?, date('now'), 10, 'concluida')`,
    [`RC54_${suffix}`]
  );
  const venda = (await dbAll(`SELECT id FROM vendas WHERE codigo = ?`, [`RC54_${suffix}`]))[0];
  await dbRun(
    `INSERT INTO vendas_itens (venda_id, produto_id, quantidade, preco_unitario, subtotal, quantidade_bolas)
     VALUES (?, 1, 1, 5, 5, 2)`,
    [venda.id]
  );
  const item = (await dbAll(
    `SELECT id FROM vendas_itens WHERE venda_id = ? ORDER BY id DESC LIMIT 1`,
    [venda.id]
  ))[0];

  await casquinhaSabores.gravarSaboresDoItem(item.id, [
    { id: sabores[0].id, nome: sabores[0].nome },
    { id: sabores[0].id, nome: sabores[0].nome }
  ]);

  const gravados = await casquinhaSabores.listarSaboresDoItem(item.id);
  assert.strictEqual(gravados.length, 2);
  assert.strictEqual(gravados[0].nome, sabores[0].nome);
  assert.strictEqual(gravados[1].nome, sabores[0].nome, 'permite sabor repetido');

  await dbRun(`DELETE FROM venda_item_sabores WHERE venda_item_id = ?`, [item.id]);
  await dbRun(`DELETE FROM vendas_itens WHERE id = ?`, [item.id]);
  await dbRun(`DELETE FROM vendas WHERE id = ?`, [venda.id]);

  console.log('✔ RCM-05.4 Montador de Casquinha — OK');
  process.exit(0);
}

run().catch((err) => {
  console.error('✖ RCM-05.4 falhou:', err);
  process.exit(1);
});
