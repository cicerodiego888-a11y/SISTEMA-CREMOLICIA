/**
 * KitItemService — itens de kit/combo (RCM-05.9)
 */

const db = require('../../../database');

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
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

function erro(msg, status = 400, code = null) {
  const e = new Error(msg);
  e.statusCode = status;
  if (code) e.code = code;
  return e;
}

function normalizar(row) {
  if (!row) return null;
  return {
    id: row.id,
    kit_id: row.kit_id,
    produto_id: row.produto_id,
    produto_nome: row.produto_nome || null,
    produto_codigo: row.produto_codigo || null,
    quantidade: Number(row.quantidade || 0),
    obrigatorio: row.obrigatorio === 1 || row.obrigatorio === true,
    ordem: Number(row.ordem || 0),
    preco_individual: Number(row.preco_individual != null ? row.preco_individual : row.preco_venda || 0),
    subtotal_informativo: Number(
      (Number(row.quantidade || 0) *
        Number(row.preco_individual != null ? row.preco_individual : row.preco_venda || 0)).toFixed(2)
    )
  };
}

async function listarPorKit(kitId) {
  const rows = await dbAll(
    `SELECT ki.*,
            p.nome AS produto_nome,
            p.codigo AS produto_codigo,
            p.preco_venda AS preco_individual
     FROM kit_itens ki
     INNER JOIN produtos p ON p.id = ki.produto_id
     WHERE ki.kit_id = ?
     ORDER BY ki.ordem ASC, ki.id ASC`,
    [kitId]
  );
  return rows.map(normalizar);
}

async function buscarPorId(id) {
  const row = await dbGet(
    `SELECT ki.*,
            p.nome AS produto_nome,
            p.codigo AS produto_codigo,
            p.preco_venda AS preco_individual
     FROM kit_itens ki
     INNER JOIN produtos p ON p.id = ki.produto_id
     WHERE ki.id = ?`,
    [id]
  );
  return normalizar(row);
}

async function somarItens(kitId) {
  const row = await dbGet(
    `SELECT COALESCE(SUM(ki.quantidade * COALESCE(p.preco_venda, 0)), 0) AS total
     FROM kit_itens ki
     INNER JOIN produtos p ON p.id = ki.produto_id
     WHERE ki.kit_id = ?`,
    [kitId]
  );
  return Number(Number(row?.total || 0).toFixed(2));
}

async function adicionar(kitId, body = {}) {
  const produtoId = Number(body.produto_id);
  if (!Number.isFinite(produtoId) || produtoId <= 0) {
    throw erro('produto_id é obrigatório');
  }
  const produto = await dbGet(
    `SELECT id, nome, eh_kit, forma_comercializacao FROM produtos WHERE id = ?`,
    [produtoId]
  );
  if (!produto) throw erro('Produto do item não encontrado', 404);
  if (Number(produto.eh_kit) === 1 || String(produto.forma_comercializacao || '').toUpperCase() === 'KIT') {
    throw erro('Não é permitido incluir um kit como item de outro kit');
  }

  const quantidade = Number(body.quantidade);
  if (!Number.isFinite(quantidade) || quantidade <= 0) {
    throw erro('Quantidade do item deve ser > 0');
  }

  const obrigatorio = body.obrigatorio === false || body.obrigatorio === 0 ? 0 : 1;
  const ordem = Number.isFinite(Number(body.ordem)) ? Number(body.ordem) : 0;

  const existente = await dbGet(
    `SELECT id FROM kit_itens WHERE kit_id = ? AND produto_id = ?`,
    [kitId, produtoId]
  );
  if (existente) {
    await dbRun(
      `UPDATE kit_itens SET quantidade = ?, obrigatorio = ?, ordem = ? WHERE id = ?`,
      [quantidade, obrigatorio, ordem, existente.id]
    );
    return buscarPorId(existente.id);
  }

  const result = await dbRun(
    `INSERT INTO kit_itens (kit_id, produto_id, quantidade, obrigatorio, ordem)
     VALUES (?, ?, ?, ?, ?)`,
    [kitId, produtoId, quantidade, obrigatorio, ordem]
  );
  return buscarPorId(result.lastID);
}

async function atualizar(id, body = {}) {
  const item = await buscarPorId(id);
  if (!item) throw erro('Item do kit não encontrado', 404);

  const quantidade = body.quantidade !== undefined ? Number(body.quantidade) : item.quantidade;
  if (!Number.isFinite(quantidade) || quantidade <= 0) {
    throw erro('Quantidade do item deve ser > 0');
  }
  const obrigatorio = body.obrigatorio !== undefined
    ? (body.obrigatorio === false || body.obrigatorio === 0 ? 0 : 1)
    : (item.obrigatorio ? 1 : 0);
  const ordem = body.ordem !== undefined ? Number(body.ordem) : item.ordem;

  await dbRun(
    `UPDATE kit_itens SET quantidade = ?, obrigatorio = ?, ordem = ? WHERE id = ?`,
    [quantidade, obrigatorio, Number.isFinite(ordem) ? ordem : 0, id]
  );
  return buscarPorId(id);
}

async function remover(id) {
  const item = await buscarPorId(id);
  if (!item) throw erro('Item do kit não encontrado', 404);
  await dbRun(`DELETE FROM kit_itens WHERE id = ?`, [id]);
  return { ok: true };
}

async function substituirItens(kitId, itens = []) {
  await dbRun(`DELETE FROM kit_itens WHERE kit_id = ?`, [kitId]);
  const out = [];
  for (let i = 0; i < (itens || []).length; i += 1) {
    const raw = itens[i] || {};
    out.push(
      await adicionar(kitId, {
        ...raw,
        ordem: raw.ordem != null ? raw.ordem : i
      })
    );
  }
  return out;
}

module.exports = {
  listarPorKit,
  buscarPorId,
  somarItens,
  adicionar,
  atualizar,
  remover,
  substituirItens,
  normalizar
};
