/**
 * Classificação livre do insumo.
 * Não altera natureza, estoque, custo, produção nem dados fiscais.
 */

const bootstrapGruposInsumos = require('./migrations/004_grupos_insumos');

const MENSAGEM_GRUPO_EM_USO = 'Não é possível excluir este grupo porque existem insumos vinculados a ele.';

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ changes: this.changes, id: this.lastID });
    });
  });
}

function erro(mensagem, codigo, statusCode) {
  const falha = new Error(mensagem);
  falha.code = codigo;
  falha.statusCode = statusCode;
  return falha;
}

function nomeGrupo(valor) {
  const nome = String(valor || '').trim();
  if (!nome) throw erro('Informe o nome do grupo.', 'NOME_OBRIGATORIO', 400);
  if (nome.length > 80) throw erro('O nome do grupo é longo demais.', 'NOME_INVALIDO', 400);
  return nome;
}

function mapear(row) {
  return {
    id: Number(row.id),
    nome: row.nome,
    quantidade: Number(row.quantidade || 0)
  };
}

function filtrarInsumosCatalogo(produtos, grupos, opcoes) {
  const dados = opcoes || {};
  const termo = String(dados.termo || '').trim().toLowerCase();
  const grupoFiltro = String(dados.grupoId || '');
  const mostrarInativos = !!dados.mostrarInativos;
  const nomeGrupo = (id) => {
    const grupo = (grupos || []).find((item) => String(item.id) === String(id || ''));
    return grupo ? grupo.nome : '';
  };
  return (produtos || []).filter((produto) => {
    if (String(produto && produto.natureza_cadastro || '').trim().toUpperCase() !== 'INSUMO') return false;
    const ativo = Number(produto && produto.ativo != null ? produto.ativo : 1) !== 0;
    if (!mostrarInativos && !ativo) return false;
    if (grupoFiltro === 'sem') {
      if (produto.grupo_insumo_id != null && produto.grupo_insumo_id !== '') return false;
    } else if (grupoFiltro && String(produto.grupo_insumo_id || '') !== grupoFiltro) {
      return false;
    }
    if (!termo) return true;
    const nome = String(produto.nome || '').toLowerCase();
    const codigo = String(produto.codigo || '').toLowerCase();
    const grupo = nomeGrupo(produto.grupo_insumo_id).toLowerCase();
    return nome.includes(termo) || codigo.includes(termo) || grupo.includes(termo);
  });
}

async function listarGruposInsumos(db) {
  await bootstrapGruposInsumos(db);
  const rows = await all(db, `
    SELECT g.id, g.nome,
      (SELECT COUNT(*) FROM produtos p WHERE p.grupo_insumo_id = g.id) AS quantidade
    FROM grupos_insumos g
    ORDER BY g.nome COLLATE NOCASE, g.id
  `);
  return rows.map(mapear);
}

async function obterGrupoInsumo(db, id) {
  await bootstrapGruposInsumos(db);
  const row = await get(db, 'SELECT id, nome FROM grupos_insumos WHERE id = ?', [Number(id)]);
  return row ? mapear(row) : null;
}

async function criarGrupoInsumo(db, dados) {
  await bootstrapGruposInsumos(db);
  const nome = nomeGrupo(dados && dados.nome);
  try {
    const criado = await run(db, 'INSERT INTO grupos_insumos (nome) VALUES (?)', [nome]);
    return obterGrupoInsumo(db, criado.id);
  } catch (err) {
    if (/unique/i.test(err.message || '')) {
      throw erro('Já existe um grupo com esse nome.', 'GRUPO_DUPLICADO', 409);
    }
    throw err;
  }
}

async function atualizarGrupoInsumo(db, id, dados) {
  await bootstrapGruposInsumos(db);
  const atual = await obterGrupoInsumo(db, id);
  if (!atual) throw erro('Grupo não encontrado.', 'GRUPO_NAO_ENCONTRADO', 404);
  const nome = nomeGrupo(dados && dados.nome);
  try {
    await run(db, `
      UPDATE grupos_insumos
      SET nome = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `, [nome, atual.id]);
  } catch (err) {
    if (/unique/i.test(err.message || '')) {
      throw erro('Já existe um grupo com esse nome.', 'GRUPO_DUPLICADO', 409);
    }
    throw err;
  }
  return obterGrupoInsumo(db, atual.id);
}

async function excluirGrupoInsumo(db, id) {
  await bootstrapGruposInsumos(db);
  const atual = await obterGrupoInsumo(db, id);
  if (!atual) throw erro('Grupo não encontrado.', 'GRUPO_NAO_ENCONTRADO', 404);
  const uso = await get(db, 'SELECT COUNT(*) AS total FROM produtos WHERE grupo_insumo_id = ?', [atual.id]);
  if (Number(uso && uso.total) > 0) {
    throw erro(MENSAGEM_GRUPO_EM_USO, 'GRUPO_EM_USO', 409);
  }
  await run(db, 'DELETE FROM grupos_insumos WHERE id = ?', [atual.id]);
  return { id: atual.id, excluido: true };
}

async function validarGrupoInsumoInformado(db, body) {
  if (!body || !Object.prototype.hasOwnProperty.call(body, 'grupo_insumo_id')) return null;
  const bruto = body.grupo_insumo_id;
  if (bruto === '' || bruto == null) return null;
  const id = Number(bruto);
  if (!Number.isFinite(id) || id <= 0) {
    throw erro('Grupo de insumo inválido.', 'GRUPO_INVALIDO', 400);
  }
  const grupo = await obterGrupoInsumo(db, id);
  if (!grupo) throw erro('Grupo de insumo não encontrado.', 'GRUPO_NAO_ENCONTRADO', 404);
  return grupo.id;
}

async function aplicarGrupoInsumo(db, produtoId, body) {
  if (!body || !Object.prototype.hasOwnProperty.call(body, 'grupo_insumo_id')) return false;
  await bootstrapGruposInsumos(db);
  const grupoId = await validarGrupoInsumoInformado(db, body);
  await run(db, 'UPDATE produtos SET grupo_insumo_id = ? WHERE id = ?', [grupoId, produtoId]);
  return true;
}

module.exports = {
  MENSAGEM_GRUPO_EM_USO,
  filtrarInsumosCatalogo,
  listarGruposInsumos,
  obterGrupoInsumo,
  criarGrupoInsumo,
  atualizarGrupoInsumo,
  excluirGrupoInsumo,
  validarGrupoInsumoInformado,
  aplicarGrupoInsumo
};
