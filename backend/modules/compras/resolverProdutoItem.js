/**
 * Localiza o produto interno de um item de compra.
 * Não cria produto, não altera natureza e não movimenta estoque.
 *
 * DIGITAÇÃO É PESQUISA. SELEÇÃO É VÍNCULO.
 * O vínculo definitivo só existe com um produto_id confirmado e existente.
 * Código, código de barras e nome do item geram apenas sugestões, que o
 * usuário precisa confirmar.
 */

const CODIGO_PRODUTO_NAO_CADASTRADO = 'PRODUTO_NAO_CADASTRADO';
const MENSAGEM_PRODUTO_NAO_CADASTRADO = 'Existem itens da compra sem produto cadastrado. Cadastre ou vincule esses produtos antes de concluir a entrada.';
const MOTIVO_PRODUTO_INEXISTENTE = 'PRODUTO_INEXISTENTE';
const MOTIVO_PRODUTO_INATIVO = 'PRODUTO_INATIVO';
const MOTIVO_PRODUTO_NAO_INSUMO = 'PRODUTO_NAO_INSUMO';
const MOTIVO_PRODUTO_NAO_IDENTIFICADO = 'PRODUTO_NAO_IDENTIFICADO';
const MENSAGEM_PRODUTO_INEXISTENTE = 'Produto não encontrado.';
const MENSAGEM_PRODUTO_INATIVO = 'O produto inativo não pode ser utilizado em uma nova compra. Vincule outro produto ou reative o cadastro.';
const MENSAGEM_PRODUTO_NAO_INSUMO = 'Somente produtos ativos classificados como INSUMO podem ser incluídos em uma compra.';
const CODIGO_VINCULO_INVALIDO = 'VINCULO_PRODUTO_INVALIDO';
const MENSAGEM_VINCULO_INVALIDO_REVISAO = 'Existem itens sem vínculo ou com produto inválido para Compras (inexistente, inativo ou de natureza incompatível). Corrija os produtos antes de concluir a revisão.';
const LIMITE_SUGESTOES = 5;

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

function texto(valor) {
  return String(valor || '').trim();
}

function chavesBusca(item = {}) {
  const nome = texto(item.produto_nome || item.nome || item.descricao_produto);
  const barras = texto(item.codigo_barras);
  const codigo = texto(item.codigo || item.codigo_produto);
  return {
    nome,
    barras: /^\d{8,14}$/.test(barras) ? barras : '',
    codigo
  };
}

function pendente(item = {}, extras = {}) {
  const chaves = chavesBusca(item);
  return {
    situacao: CODIGO_PRODUTO_NAO_CADASTRADO,
    produtoId: null,
    natureza_cadastro: null,
    nome: null,
    codigo: chaves.codigo || null,
    codigo_barras: texto(item.codigo_barras) || null,
    unidade: texto(item.unidade) || null,
    produto_nome: chaves.nome || null,
    quantidade: item.quantidade == null ? null : Number(item.quantidade),
    sugestoes: [],
    ...extras
  };
}

function vinculado(row) {
  return {
    situacao: 'VINCULADO',
    produtoId: Number(row.id),
    natureza_cadastro: row.natureza_cadastro == null ? null : row.natureza_cadastro,
    nome: row.nome || null,
    codigo: row.codigo || null,
    codigo_barras: row.codigo_barras || null,
    unidade: row.unidade || null,
    produto_nome: row.nome || null,
    quantidade: null
  };
}

async function colunasProduto(db) {
  const rows = await all(db, 'PRAGMA table_info(produtos)');
  return new Set(rows.map((row) => row.name));
}

function selectProduto(colunas) {
  const natureza = colunas.has('natureza_cadastro') ? 'natureza_cadastro' : 'NULL AS natureza_cadastro';
  const ativo = colunas.has('ativo') ? 'COALESCE(ativo, 1) AS ativo' : '1 AS ativo';
  return `SELECT id, codigo, codigo_barras, nome, unidade, ${natureza}, ${ativo} FROM produtos`;
}

function filtroAtivo(colunas) {
  return colunas.has('ativo') ? 'COALESCE(ativo, 1) = 1' : '1 = 1';
}

function sugestao(row, motivo) {
  return {
    id: Number(row.id),
    nome: row.nome || '',
    codigo: row.codigo || '',
    codigo_barras: row.codigo_barras || '',
    unidade: row.unidade || '',
    natureza_cadastro: row.natureza_cadastro == null ? null : row.natureza_cadastro,
    motivo
  };
}

function palavrasBusca(nome) {
  return nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((palavra) => palavra.length >= 3)
    .slice(0, 4);
}

async function sugerirProdutosItemCompra(db, item = {}, limite = LIMITE_SUGESTOES) {
  const chaves = chavesBusca(item);
  if (!chaves.codigo && !chaves.barras && !chaves.nome) return [];

  const colunas = await colunasProduto(db);
  const base = `${selectProduto(colunas)} WHERE ${filtroAtivo(colunas)}`;
  const sugestoes = [];
  const incluir = (rows, motivo) => {
    rows.forEach((row) => {
      if (sugestoes.length >= limite) return;
      if (sugestoes.some((existente) => existente.id === Number(row.id))) return;
      sugestoes.push(sugestao(row, motivo));
    });
  };

  if (chaves.barras) {
    incluir(await all(db, `${base} AND codigo_barras = ? ORDER BY id LIMIT ?`, [chaves.barras, limite]), 'CODIGO_BARRAS');
  }
  if (chaves.codigo) {
    incluir(await all(db, `${base} AND codigo = ? ORDER BY id LIMIT ?`, [chaves.codigo, limite]), 'CODIGO');
  }

  const palavras = palavrasBusca(chaves.nome);
  if (palavras.length && sugestoes.length < limite) {
    const condicoes = palavras.map(() => 'LOWER(nome) LIKE ?').join(' OR ');
    const rows = await all(
      db,
      `${base} AND (${condicoes}) ORDER BY nome LIMIT 50`,
      palavras.map((palavra) => `%${palavra}%`)
    );
    const pontuados = rows
      .map((row) => {
        const nomeProduto = palavrasBusca(String(row.nome || '')).join(' ');
        const acertos = palavras.filter((palavra) => nomeProduto.includes(palavra)).length;
        return { row, acertos };
      })
      .filter(({ acertos }) => acertos > 0)
      .sort((a, b) => b.acertos - a.acertos);
    incluir(pontuados.map(({ row }) => row), 'NOME');
  }

  return sugestoes;
}

async function resolverProdutoItemCompra(db, item = {}) {
  const produtoId = Number(item.produto_id);
  if (Number.isFinite(produtoId) && produtoId > 0) {
    const colunas = await colunasProduto(db);
    const row = await get(db, `${selectProduto(colunas)} WHERE id = ?`, [produtoId]);
    if (!row) {
      return pendente(item, { motivo: MOTIVO_PRODUTO_INEXISTENTE, mensagem: MENSAGEM_PRODUTO_INEXISTENTE, produto_id_recusado: produtoId });
    }
    if (Number(row.ativo) !== 1) {
      return pendente(item, {
        motivo: MOTIVO_PRODUTO_INATIVO,
        mensagem: MENSAGEM_PRODUTO_INATIVO,
        produto_id_recusado: produtoId,
        nome: row.nome || null
      });
    }
    return vinculado(row);
  }

  return pendente(item, { sugestoes: await sugerirProdutosItemCompra(db, item) });
}

async function validarProdutosVinculadosCompra(db, itens = []) {
  const problemas = [];
  for (let indice = 0; indice < itens.length; indice += 1) {
    const item = itens[indice] || {};
    if (item.produto_id == null || item.produto_id === '') continue;
    const resultado = await resolverProdutoItemCompra(db, item);
    if (itemPodeEntrarEstoque(resultado)) continue;
    problemas.push({
      indice,
      produto_id: item.produto_id,
      produto_nome: texto(item.produto_nome || item.nome || item.descricao_produto) || null,
      motivo: resultado.motivo || MOTIVO_PRODUTO_INEXISTENTE,
      mensagem: resultado.mensagem || MENSAGEM_PRODUTO_INEXISTENTE
    });
  }
  return problemas;
}

async function validarProdutosIdentificadosCompra(db, itens = []) {
  const problemas = [];
  for (let indice = 0; indice < itens.length; indice += 1) {
    const item = itens[indice] || {};
    if (item.produto_id == null || String(item.produto_id).trim() === '') {
      problemas.push({
        indice,
        produto_id: null,
        produto_nome: texto(item.produto_nome || item.nome || item.descricao_produto) || null,
        motivo: MOTIVO_PRODUTO_NAO_IDENTIFICADO,
        mensagem: MENSAGEM_PRODUTO_NAO_CADASTRADO
      });
      continue;
    }

    const resultado = await resolverProdutoItemCompra(db, item);
    if (produtoPodeSerInsumoCompra(resultado)) continue;
    const produtoAtivoVinculado = itemPodeEntrarEstoque(resultado);
    problemas.push({
      indice,
      produto_id: item.produto_id,
      produto_nome: texto(item.produto_nome || item.nome || item.descricao_produto) || null,
      motivo: resultado.motivo || (produtoAtivoVinculado ? MOTIVO_PRODUTO_NAO_INSUMO : MOTIVO_PRODUTO_INEXISTENTE),
      mensagem: resultado.mensagem || (produtoAtivoVinculado ? MENSAGEM_PRODUTO_NAO_INSUMO : MENSAGEM_PRODUTO_INEXISTENTE)
    });
  }
  return problemas;
}

async function resolverItensCompra(db, itens = []) {
  const resultados = [];
  for (const item of itens) {
    resultados.push(await resolverProdutoItemCompra(db, item));
  }
  return {
    resultados,
    pendentes: resultados.filter((item) => item.situacao === CODIGO_PRODUTO_NAO_CADASTRADO)
  };
}

function itemPodeEntrarEstoque(resultado) {
  return Boolean(resultado && resultado.situacao === 'VINCULADO' && Number(resultado.produtoId) > 0);
}

function produtoPodeSerInsumoCompra(resultado) {
  return itemPodeEntrarEstoque(resultado)
    && String(resultado.natureza_cadastro || '').trim().toUpperCase() === 'INSUMO';
}

module.exports = {
  CODIGO_PRODUTO_NAO_CADASTRADO,
  MENSAGEM_PRODUTO_NAO_CADASTRADO,
  MOTIVO_PRODUTO_INEXISTENTE,
  MOTIVO_PRODUTO_INATIVO,
  MOTIVO_PRODUTO_NAO_INSUMO,
  MOTIVO_PRODUTO_NAO_IDENTIFICADO,
  MENSAGEM_PRODUTO_INEXISTENTE,
  MENSAGEM_PRODUTO_INATIVO,
  MENSAGEM_PRODUTO_NAO_INSUMO,
  CODIGO_VINCULO_INVALIDO,
  MENSAGEM_VINCULO_INVALIDO_REVISAO,
  resolverProdutoItemCompra,
  resolverItensCompra,
  sugerirProdutosItemCompra,
  validarProdutosVinculadosCompra,
  validarProdutosIdentificadosCompra,
  itemPodeEntrarEstoque,
  produtoPodeSerInsumoCompra
};
