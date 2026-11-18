/**
 * Linha de Produtos (FABRICA-MODELO-02).
 * Agrupa produtos físicos por produtos.linha_produtos_id. Não é produto:
 * não tem estoque, preço, OP nem venda. Não confundir com Linha de Precificação.
 *
 * A estrutura vem da migration 010, que ainda não roda no bootstrap: sem ela,
 * a leitura responde vazio e a gravação é recusada.
 */

const MENSAGEM_LINHA_EM_USO = 'Não é possível excluir esta linha porque existem produtos vinculados a ela. Inative a linha.';
const MENSAGEM_ESTRUTURA_AUSENTE = 'A estrutura de Linha de Produtos não está instalada neste banco.';
const MENSAGEM_INSUMO_SEM_LINHA = 'Insumo não pertence a Linha de Produtos.';

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

async function estruturaInstalada(db) {
  const tabela = await get(db, "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'linhas_produtos'");
  if (!tabela) return false;
  const colunas = await all(db, 'PRAGMA table_info(produtos)');
  return colunas.some((coluna) => coluna.name === 'linha_produtos_id');
}

async function exigirEstrutura(db) {
  if (!(await estruturaInstalada(db))) throw erro(MENSAGEM_ESTRUTURA_AUSENTE, 'ESTRUTURA_NAO_INSTALADA', 409);
}

function texto(valor) {
  return String(valor == null ? '' : valor).trim();
}

function nomeLinha(valor) {
  const nome = texto(valor);
  if (!nome) throw erro('Informe o nome da linha.', 'NOME_OBRIGATORIO', 400);
  if (nome.length > 80) throw erro('O nome da linha é longo demais.', 'NOME_INVALIDO', 400);
  return nome;
}

function codigoLinha(valor) {
  const codigo = texto(valor);
  if (codigo.length > 30) throw erro('O código da linha é longo demais.', 'CODIGO_INVALIDO', 400);
  return codigo || null;
}

function idPositivo(valor, mensagem, codigo) {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) throw erro(mensagem, codigo, 400);
  return id;
}

function traduzirUnico(err) {
  const mensagem = String(err && err.message || '');
  if (/idx_linhas_produtos_codigo/i.test(mensagem) || (/unique/i.test(mensagem) && /codigo/i.test(mensagem))) {
    return erro('Já existe uma linha com esse código.', 'CODIGO_DUPLICADO', 409);
  }
  if (/unique/i.test(mensagem)) return erro('Já existe uma linha com esse nome.', 'NOME_DUPLICADO', 409);
  return err;
}

function mapearLinha(row) {
  return {
    id: Number(row.id),
    codigo: row.codigo || '',
    nome: row.nome,
    descricao: row.descricao || '',
    ativo: Number(row.ativo) === 1 ? 1 : 0,
    quantidade_produtos: Number(row.quantidade_produtos || 0),
    quantidade_produtos_ativos: Number(row.quantidade_produtos_ativos || 0),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null
  };
}

const SQL_LINHA = `
  SELECT l.*,
    (SELECT COUNT(*) FROM produtos p
      WHERE p.linha_produtos_id = l.id
        AND UPPER(TRIM(COALESCE(p.natureza_cadastro, ''))) <> 'INSUMO') AS quantidade_produtos,
    (SELECT COUNT(*) FROM produtos p
      WHERE p.linha_produtos_id = l.id AND COALESCE(p.ativo, 1) = 1
        AND UPPER(TRIM(COALESCE(p.natureza_cadastro, ''))) <> 'INSUMO') AS quantidade_produtos_ativos
  FROM linhas_produtos l
`;

async function listarLinhasProdutos(db, opcoes = {}) {
  if (!(await estruturaInstalada(db))) return { instalada: false, linhas: [] };
  const filtros = [];
  const params = [];
  if (!opcoes.incluirInativas) filtros.push('l.ativo = 1');
  const busca = texto(opcoes.busca).toLowerCase();
  if (busca) {
    filtros.push("(lower(l.nome) LIKE ? OR lower(COALESCE(l.codigo, '')) LIKE ?)");
    params.push(`%${busca}%`, `%${busca}%`);
  }
  const rows = await all(db, `${SQL_LINHA}
    ${filtros.length ? `WHERE ${filtros.join(' AND ')}` : ''}
    ORDER BY l.nome COLLATE NOCASE, l.id`, params);
  return { instalada: true, linhas: rows.map(mapearLinha) };
}

async function buscarLinha(db, id) {
  const row = await get(db, `${SQL_LINHA} WHERE l.id = ?`, [id]);
  return row ? mapearLinha(row) : null;
}

async function obterLinhaProdutos(db, id) {
  await exigirEstrutura(db);
  const linhaId = idPositivo(id, 'Linha de Produtos inválida.', 'LINHA_INVALIDA');
  const linha = await buscarLinha(db, linhaId);
  if (!linha) throw erro('Linha de Produtos não encontrada.', 'LINHA_NAO_ENCONTRADA', 404);
  const produtos = await all(db, `
    SELECT id, codigo, nome, unidade, COALESCE(ativo, 1) AS ativo, natureza_cadastro
    FROM produtos
    WHERE linha_produtos_id = ?
      AND UPPER(TRIM(COALESCE(natureza_cadastro, ''))) <> 'INSUMO'
    ORDER BY nome COLLATE NOCASE, id
  `, [linhaId]);
  return {
    ...linha,
    produtos: produtos.map((p) => ({
      id: Number(p.id),
      codigo: p.codigo || '',
      nome: p.nome || '',
      unidade: p.unidade || '',
      ativo: Number(p.ativo) === 1 ? 1 : 0,
      natureza_cadastro: p.natureza_cadastro || null
    }))
  };
}

async function criarLinhaProdutos(db, dados = {}) {
  await exigirEstrutura(db);
  const nome = nomeLinha(dados.nome);
  const codigo = codigoLinha(dados.codigo);
  const descricao = texto(dados.descricao) || null;
  const ativo = dados.ativo === 0 || dados.ativo === '0' || dados.ativo === false ? 0 : 1;
  try {
    const criado = await run(db, `
      INSERT INTO linhas_produtos (codigo, nome, descricao, ativo) VALUES (?, ?, ?, ?)
    `, [codigo, nome, descricao, ativo]);
    return obterLinhaProdutos(db, criado.id);
  } catch (err) {
    throw traduzirUnico(err);
  }
}

async function atualizarLinhaProdutos(db, id, dados = {}) {
  await exigirEstrutura(db);
  const atual = await obterLinhaProdutos(db, id);
  const nome = nomeLinha(dados.nome != null ? dados.nome : atual.nome);
  const codigo = Object.prototype.hasOwnProperty.call(dados, 'codigo') ? codigoLinha(dados.codigo) : (atual.codigo || null);
  const descricao = Object.prototype.hasOwnProperty.call(dados, 'descricao') ? (texto(dados.descricao) || null) : (atual.descricao || null);
  try {
    await run(db, `
      UPDATE linhas_produtos
      SET nome = ?, codigo = ?, descricao = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `, [nome, codigo, descricao, atual.id]);
  } catch (err) {
    throw traduzirUnico(err);
  }
  return obterLinhaProdutos(db, atual.id);
}

async function alterarStatusLinhaProdutos(db, id, ativo) {
  await exigirEstrutura(db);
  const atual = await obterLinhaProdutos(db, id);
  await run(db, `
    UPDATE linhas_produtos SET ativo = ?, updated_at = datetime('now', 'localtime') WHERE id = ?
  `, [ativo ? 1 : 0, atual.id]);
  return obterLinhaProdutos(db, atual.id);
}

async function excluirLinhaProdutos(db, id) {
  await exigirEstrutura(db);
  const linhaId = idPositivo(id, 'Linha de Produtos inválida.', 'LINHA_INVALIDA');
  const atual = await get(db, 'SELECT id FROM linhas_produtos WHERE id = ?', [linhaId]);
  if (!atual) throw erro('Linha de Produtos não encontrada.', 'LINHA_NAO_ENCONTRADA', 404);
  const uso = await get(db, 'SELECT COUNT(*) AS total FROM produtos WHERE linha_produtos_id = ?', [linhaId]);
  if (Number(uso && uso.total) > 0) throw erro(MENSAGEM_LINHA_EM_USO, 'LINHA_EM_USO', 409);
  await run(db, 'DELETE FROM linhas_produtos WHERE id = ?', [linhaId]);
  return { id: linhaId, excluido: true };
}

/**
 * Valida o linha_produtos_id enviado no cadastro de produto.
 * Retorna undefined quando o campo não deve ser gravado (ausente ou estrutura não instalada com valor vazio).
 * `atual` é o produto antes da alteração (null na criação).
 */
async function validarLinhaProdutosInformada(db, body, atual = null) {
  const informado = !!body && Object.prototype.hasOwnProperty.call(body, 'linha_produtos_id');
  const naturezaFinal = texto(
    body && Object.prototype.hasOwnProperty.call(body, 'natureza_cadastro') ? body.natureza_cadastro : (atual && atual.natureza_cadastro)
  ).toUpperCase();
  const instalada = await estruturaInstalada(db);

  if (!informado) {
    if (instalada && naturezaFinal === 'INSUMO' && atual && atual.linha_produtos_id != null) {
      throw erro(MENSAGEM_INSUMO_SEM_LINHA, 'INSUMO_SEM_LINHA', 400);
    }
    return undefined;
  }

  const bruto = body.linha_produtos_id;
  if (bruto === '' || bruto == null) return instalada ? null : undefined;
  if (!instalada) throw erro(MENSAGEM_ESTRUTURA_AUSENTE, 'ESTRUTURA_NAO_INSTALADA', 409);

  const linhaId = idPositivo(bruto, 'Linha de Produtos inválida.', 'LINHA_INVALIDA');
  const linha = await get(db, 'SELECT id, ativo FROM linhas_produtos WHERE id = ?', [linhaId]);
  if (!linha) throw erro('Linha de Produtos não encontrada.', 'LINHA_NAO_ENCONTRADA', 404);
  if (naturezaFinal === 'INSUMO') throw erro(MENSAGEM_INSUMO_SEM_LINHA, 'INSUMO_SEM_LINHA', 400);
  const mantendo = atual && Number(atual.linha_produtos_id) === linhaId;
  if (Number(linha.ativo) !== 1 && !mantendo) {
    throw erro('Esta Linha de Produtos está inativa.', 'LINHA_INATIVA', 400);
  }
  return linhaId;
}

async function aplicarLinhaProdutos(db, produtoId, body) {
  const atual = await get(db, 'SELECT * FROM produtos WHERE id = ?', [produtoId]);
  if (!atual) throw erro('Produto não encontrado.', 'PRODUTO_NAO_ENCONTRADO', 404);
  const linhaId = await validarLinhaProdutosInformada(db, body, { ...atual, linha_produtos_id: null });
  if (linhaId === undefined) return false;
  await run(db, 'UPDATE produtos SET linha_produtos_id = ? WHERE id = ?', [linhaId, produtoId]);
  return true;
}

module.exports = {
  MENSAGEM_LINHA_EM_USO,
  MENSAGEM_ESTRUTURA_AUSENTE,
  MENSAGEM_INSUMO_SEM_LINHA,
  estruturaInstalada,
  listarLinhasProdutos,
  obterLinhaProdutos,
  criarLinhaProdutos,
  atualizarLinhaProdutos,
  alterarStatusLinhaProdutos,
  excluirLinhaProdutos,
  validarLinhaProdutosInformada,
  aplicarLinhaProdutos
};
