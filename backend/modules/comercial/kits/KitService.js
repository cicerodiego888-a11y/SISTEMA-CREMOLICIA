/**
 * KitService — cadastro de kits/combos (RCM-05.9)
 *
 * Kit nunca possui estoque próprio: vende via produto vinculado (forma KIT)
 * e baixa componentes no checkout (KitVendaService).
 */

const db = require('../../../database');
const KitItemService = require('./KitItemService');

const TIPOS_FORMACAO = new Set(['SOMA', 'FIXO']);
const MODOS_FISCAL = new Set(['KIT', 'ITENS']);

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

function normalizarTipoFormacao(v) {
  const t = String(v || 'FIXO').trim().toUpperCase();
  if (t === 'SOMA_ITENS' || t === 'SOMA_DOS_ITENS') return 'SOMA';
  if (t === 'PRECO_FIXO' || t === 'FIXO') return 'FIXO';
  return TIPOS_FORMACAO.has(t) ? t : 'FIXO';
}

function normalizarModoFiscal(v) {
  const m = String(v || 'KIT').trim().toUpperCase();
  if (m === 'PRODUTO_KIT' || m === 'KIT') return 'KIT';
  if (m === 'ITENS_SEPARADOS' || m === 'SEPARADOS' || m === 'ITENS') return 'ITENS';
  return MODOS_FISCAL.has(m) ? m : 'KIT';
}

function normalizar(row, itens = null) {
  if (!row) return null;
  return {
    id: row.id,
    codigo: row.codigo,
    descricao: row.descricao,
    categoria_id: row.categoria_id != null ? Number(row.categoria_id) : null,
    categoria_nome: row.categoria_nome || null,
    ativo: row.ativo === 1 || row.ativo === true,
    preco: Number(row.preco || 0),
    tipo_formacao: normalizarTipoFormacao(row.tipo_formacao),
    permite_alterar_itens: row.permite_alterar_itens === 1 || row.permite_alterar_itens === true,
    modo_fiscal: normalizarModoFiscal(row.modo_fiscal),
    produto_id: row.produto_id != null ? Number(row.produto_id) : null,
    itens: Array.isArray(itens) ? itens : undefined,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null
  };
}

async function sincronizarProdutoKit(kit) {
  const nome = String(kit.descricao || '').trim();
  const codigo = String(kit.codigo || '').trim().toUpperCase();
  const preco = Number(kit.preco || 0);
  const categoriaId = kit.categoria_id || null;
  const ativo = kit.ativo ? 1 : 0;

  if (kit.produto_id) {
    await dbRun(
      `UPDATE produtos
       SET nome = ?,
           codigo = ?,
           preco_venda = ?,
           categoria_id = ?,
           ativo = ?,
           forma_comercializacao = 'KIT',
           eh_kit = 1,
           estoque_atual = 0,
           unidade = COALESCE(unidade, 'UN')
       WHERE id = ?`,
      [nome, codigo, preco, categoriaId, ativo, kit.produto_id]
    );
    return kit.produto_id;
  }

  const porCodigo = await dbGet(
    `SELECT id, eh_kit, forma_comercializacao FROM produtos WHERE UPPER(COALESCE(codigo,'')) = ? LIMIT 1`,
    [codigo]
  );
  if (porCodigo) {
    const jaEhKit = Number(porCodigo.eh_kit) === 1
      || String(porCodigo.forma_comercializacao || '').toUpperCase() === 'KIT';
    if (!jaEhKit) {
      throw erro(
        `Código "${codigo}" já pertence a um produto comum. Use outro código para o kit.`,
        400,
        'CODIGO_PRODUTO_CONFLITO'
      );
    }
    await dbRun(
      `UPDATE produtos
       SET nome = ?,
           preco_venda = ?,
           categoria_id = ?,
           ativo = ?,
           forma_comercializacao = 'KIT',
           eh_kit = 1,
           estoque_atual = 0
       WHERE id = ?`,
      [nome, preco, categoriaId, ativo, porCodigo.id]
    );
    await dbRun(`UPDATE kits SET produto_id = ? WHERE id = ?`, [porCodigo.id, kit.id]);
    return porCodigo.id;
  }

  const result = await dbRun(
    `INSERT INTO produtos (
       nome, codigo, preco_venda, estoque_atual, categoria_id, ativo,
       forma_comercializacao, eh_kit, unidade, item_fiscal
     ) VALUES (?, ?, ?, 0, ?, ?, 'KIT', 1, 'UN', 1)`,
    [nome, codigo, preco, categoriaId, ativo]
  );
  await dbRun(`UPDATE kits SET produto_id = ? WHERE id = ?`, [result.lastID, kit.id]);
  return result.lastID;
}

async function recalcularPrecoSeSoma(kitId) {
  const kit = await dbGet(`SELECT * FROM kits WHERE id = ?`, [kitId]);
  if (!kit) return null;
  if (normalizarTipoFormacao(kit.tipo_formacao) !== 'SOMA') {
    return Number(kit.preco || 0);
  }
  const total = await KitItemService.somarItens(kitId);
  await dbRun(
    `UPDATE kits SET preco = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
    [total, kitId]
  );
  if (kit.produto_id) {
    await dbRun(`UPDATE produtos SET preco_venda = ? WHERE id = ?`, [total, kit.produto_id]);
  }
  return total;
}

async function buscarPorId(id, { comItens = true } = {}) {
  const row = await dbGet(
    `SELECT k.*, c.nome AS categoria_nome
     FROM kits k
     LEFT JOIN categorias c ON c.id = k.categoria_id
     WHERE k.id = ?`,
    [id]
  );
  if (!row) return null;
  const itens = comItens ? await KitItemService.listarPorKit(id) : null;
  return normalizar(row, itens);
}

async function buscarPorProdutoId(produtoId, { comItens = true } = {}) {
  const row = await dbGet(
    `SELECT k.*, c.nome AS categoria_nome
     FROM kits k
     LEFT JOIN categorias c ON c.id = k.categoria_id
     WHERE k.produto_id = ? AND k.ativo = 1
     LIMIT 1`,
    [produtoId]
  );
  if (!row) return null;
  const itens = comItens ? await KitItemService.listarPorKit(row.id) : null;
  return normalizar(row, itens);
}

async function listar({ ativos, q } = {}) {
  let sql = `
    SELECT k.*, c.nome AS categoria_nome
    FROM kits k
    LEFT JOIN categorias c ON c.id = k.categoria_id
    WHERE 1=1
  `;
  const params = [];
  if (ativos === true || ativos === '1' || ativos === 1) {
    sql += ` AND k.ativo = 1`;
  }
  if (q) {
    sql += ` AND (k.codigo LIKE ? OR k.descricao LIKE ?)`;
    const like = `%${String(q).trim()}%`;
    params.push(like, like);
  }
  sql += ` ORDER BY k.descricao COLLATE NOCASE ASC`;
  const rows = await dbAll(sql, params);
  const out = [];
  for (const row of rows) {
    const itens = await KitItemService.listarPorKit(row.id);
    out.push(normalizar(row, itens));
  }
  return out;
}

async function criar(body = {}) {
  const codigo = String(body.codigo || '').trim().toUpperCase();
  const descricao = String(body.descricao || '').trim();
  if (!codigo) throw erro('Código é obrigatório');
  if (!descricao) throw erro('Descrição é obrigatória');

  const tipo = normalizarTipoFormacao(body.tipo_formacao);
  const modoFiscal = normalizarModoFiscal(body.modo_fiscal);
  const permite = body.permite_alterar_itens === true || body.permite_alterar_itens === 1 ? 1 : 0;
  const ativo = body.ativo === false || body.ativo === 0 ? 0 : 1;
  const categoriaId = body.categoria_id != null && body.categoria_id !== ''
    ? Number(body.categoria_id)
    : null;
  let preco = Number(body.preco);
  if (!Number.isFinite(preco) || preco < 0) preco = 0;

  const dup = await dbGet(`SELECT id FROM kits WHERE UPPER(codigo) = ?`, [codigo]);
  if (dup) throw erro('Já existe kit com este código');

  const itensIniciais = Array.isArray(body.itens) ? body.itens : [];
  if (!itensIniciais.length) {
    throw erro('Kit deve ter ao menos um item');
  }

  const result = await dbRun(
    `INSERT INTO kits (
       codigo, descricao, categoria_id, ativo, preco, tipo_formacao,
       permite_alterar_itens, modo_fiscal
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [codigo, descricao, categoriaId, ativo, preco, tipo, permite, modoFiscal]
  );
  const kitId = result.lastID;

  await KitItemService.substituirItens(kitId, itensIniciais);

  if (tipo === 'SOMA') {
    await recalcularPrecoSeSoma(kitId);
  }

  let kit = await buscarPorId(kitId);
  const produtoId = await sincronizarProdutoKit(kit);
  kit = await buscarPorId(kitId);
  kit.produto_id = produtoId;
  return kit;
}

async function atualizar(id, body = {}) {
  const existente = await buscarPorId(id);
  if (!existente) throw erro('Kit não encontrado', 404);

  const codigo = body.codigo !== undefined
    ? String(body.codigo || '').trim().toUpperCase()
    : existente.codigo;
  const descricao = body.descricao !== undefined
    ? String(body.descricao || '').trim()
    : existente.descricao;
  if (!codigo) throw erro('Código é obrigatório');
  if (!descricao) throw erro('Descrição é obrigatória');

  const dup = await dbGet(
    `SELECT id FROM kits WHERE UPPER(codigo) = ? AND id <> ?`,
    [codigo, id]
  );
  if (dup) throw erro('Já existe kit com este código');

  const tipo = body.tipo_formacao !== undefined
    ? normalizarTipoFormacao(body.tipo_formacao)
    : existente.tipo_formacao;
  const modoFiscal = body.modo_fiscal !== undefined
    ? normalizarModoFiscal(body.modo_fiscal)
    : existente.modo_fiscal;
  const permite = body.permite_alterar_itens !== undefined
    ? (body.permite_alterar_itens === true || body.permite_alterar_itens === 1 ? 1 : 0)
    : (existente.permite_alterar_itens ? 1 : 0);
  const ativo = body.ativo !== undefined
    ? (body.ativo === false || body.ativo === 0 ? 0 : 1)
    : (existente.ativo ? 1 : 0);
  const categoriaId = body.categoria_id !== undefined
    ? (body.categoria_id != null && body.categoria_id !== '' ? Number(body.categoria_id) : null)
    : existente.categoria_id;
  let preco = body.preco !== undefined ? Number(body.preco) : existente.preco;
  if (!Number.isFinite(preco) || preco < 0) preco = 0;

  await dbRun(
    `UPDATE kits SET
       codigo = ?, descricao = ?, categoria_id = ?, ativo = ?, preco = ?,
       tipo_formacao = ?, permite_alterar_itens = ?, modo_fiscal = ?,
       updated_at = datetime('now','localtime')
     WHERE id = ?`,
    [codigo, descricao, categoriaId, ativo, preco, tipo, permite, modoFiscal, id]
  );

  if (Array.isArray(body.itens)) {
    await KitItemService.substituirItens(id, body.itens);
  }

  if (tipo === 'SOMA') {
    await recalcularPrecoSeSoma(id);
  }

  let kit = await buscarPorId(id);
  await sincronizarProdutoKit(kit);
  return buscarPorId(id);
}

async function desativar(id) {
  const kit = await buscarPorId(id);
  if (!kit) throw erro('Kit não encontrado', 404);
  await dbRun(
    `UPDATE kits SET ativo = 0, updated_at = datetime('now','localtime') WHERE id = ?`,
    [id]
  );
  if (kit.produto_id) {
    await dbRun(`UPDATE produtos SET ativo = 0 WHERE id = ?`, [kit.produto_id]);
  }
  return buscarPorId(id);
}

module.exports = {
  TIPOS_FORMACAO,
  MODOS_FISCAL,
  listar,
  buscarPorId,
  buscarPorProdutoId,
  criar,
  atualizar,
  desativar,
  recalcularPrecoSeSoma,
  sincronizarProdutoKit,
  normalizarTipoFormacao,
  normalizarModoFiscal
};
