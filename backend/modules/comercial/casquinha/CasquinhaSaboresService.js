/**
 * Catálogo de sabores de casquinha (RCM-05.4 / RCM-05.8)
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
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function gerarCodigo(nome) {
  return String(nome || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'SABOR';
}

function normalizar(row) {
  if (!row) return null;
  return {
    id: row.id,
    codigo: row.codigo || null,
    nome: row.nome,
    descricao: row.descricao || row.nome,
    cor: row.cor || null,
    ativo: row.ativo === 1 || row.ativo === true,
    ordem: Number(row.ordem || 0)
  };
}

async function listar({ ativos } = {}) {
  let sql = `SELECT id, codigo, nome, descricao, cor, ativo, ordem FROM casquinha_sabores`;
  const params = [];
  if (ativos === true || ativos === '1' || ativos === 1) {
    sql += ` WHERE ativo = 1`;
  }
  sql += ` ORDER BY ordem ASC, nome COLLATE NOCASE ASC`;
  return (await dbAll(sql, params)).map(normalizar);
}

async function buscarPorId(id) {
  return normalizar(
    await dbGet(`SELECT * FROM casquinha_sabores WHERE id = ?`, [id])
  );
}

async function criar(body = {}) {
  const nome = String(body.nome || body.descricao || '').trim();
  if (!nome) {
    const err = new Error('Descrição/nome do sabor é obrigatório');
    err.statusCode = 400;
    throw err;
  }
  const codigo = String(body.codigo || gerarCodigo(nome)).trim().toUpperCase();
  const descricao = String(body.descricao || nome).trim();
  const cor = body.cor ? String(body.cor).trim() : null;
  const ordem = Number(body.ordem);
  const result = await dbRun(
    `INSERT INTO casquinha_sabores (codigo, nome, descricao, cor, ativo, ordem)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      codigo,
      nome,
      descricao,
      cor,
      body.ativo === false || body.ativo === 0 ? 0 : 1,
      Number.isFinite(ordem) ? ordem : 0
    ]
  );
  return buscarPorId(result.lastID);
}

async function atualizar(id, body = {}) {
  const existente = await buscarPorId(id);
  if (!existente) {
    const err = new Error('Sabor não encontrado');
    err.statusCode = 404;
    throw err;
  }
  const nome = body.nome !== undefined || body.descricao !== undefined
    ? String(body.nome || body.descricao || '').trim()
    : existente.nome;
  if (!nome) {
    const err = new Error('Descrição/nome do sabor é obrigatório');
    err.statusCode = 400;
    throw err;
  }
  await dbRun(
    `UPDATE casquinha_sabores
     SET codigo = ?, nome = ?, descricao = ?, cor = ?, ativo = ?, ordem = ?
     WHERE id = ?`,
    [
      body.codigo !== undefined
        ? String(body.codigo).trim().toUpperCase()
        : (existente.codigo || gerarCodigo(nome)),
      nome,
      body.descricao !== undefined ? String(body.descricao).trim() : (existente.descricao || nome),
      body.cor !== undefined ? (body.cor ? String(body.cor).trim() : null) : existente.cor,
      body.ativo !== undefined
        ? (body.ativo === false || body.ativo === 0 ? 0 : 1)
        : (existente.ativo ? 1 : 0),
      body.ordem !== undefined ? Number(body.ordem) || 0 : existente.ordem,
      id
    ]
  );
  return buscarPorId(id);
}

async function desativar(id) {
  const existente = await buscarPorId(id);
  if (!existente) {
    const err = new Error('Sabor não encontrado');
    err.statusCode = 404;
    throw err;
  }
  await dbRun(`UPDATE casquinha_sabores SET ativo = 0 WHERE id = ?`, [id]);
  return buscarPorId(id);
}

async function gravarSaboresDoItem(vendaItemId, sabores = []) {
  const lista = Array.isArray(sabores) ? sabores : [];
  await dbRun(`DELETE FROM venda_item_sabores WHERE venda_item_id = ?`, [vendaItemId]);
  let seq = 1;
  for (const s of lista) {
    const nome = String(s.nome || s || '').trim();
    if (!nome) continue;
    const saborId = s.id != null && Number(s.id) > 0 ? Number(s.id) : null;
    await dbRun(
      `INSERT INTO venda_item_sabores (venda_item_id, sabor_id, nome, sequencia)
       VALUES (?, ?, ?, ?)`,
      [vendaItemId, saborId, nome, seq]
    );
    seq += 1;
  }
}

async function listarSaboresDoItem(vendaItemId) {
  const rows = await dbAll(
    `SELECT id, sabor_id, nome, sequencia
     FROM venda_item_sabores
     WHERE venda_item_id = ?
     ORDER BY sequencia ASC, id ASC`,
    [vendaItemId]
  );
  return rows.map((r) => ({
    id: r.sabor_id,
    nome: r.nome,
    sequencia: r.sequencia
  }));
}

module.exports = {
  listar,
  buscarPorId,
  criar,
  atualizar,
  desativar,
  gravarSaboresDoItem,
  listarSaboresDoItem
};
