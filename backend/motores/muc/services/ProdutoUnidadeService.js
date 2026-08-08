const repo = require('../repositories/ProdutoUnidadeRepository');
const { validarPayloadUnidade } = require('../validators/UnidadeComercialValidator');
const {
  paraBase,
  deBase,
  resolverBaixaEstoque,
  resolverEntradaEstoque
} = require('../converters/ConversorUnidades');
const ComercialPrecoResolver = require('../../../modules/comercial/preco/ComercialPrecoResolver');

/**
 * Garante a unidade comercial base (fator 1) a partir do cadastro legado do produto.
 */
async function garantirUnidadeBase(db, produto) {
  if (!produto || !produto.id) {
    throw new Error('Produto inválido para garantir unidade base.');
  }

  const existente = await repo.produtoJaTemUnidades(db, produto.id);
  if (existente) {
    return repo.listarPorProduto(db, produto.id);
  }

  const unidade = String(produto.unidade || 'UN').trim().toUpperCase() || 'UN';
  await repo.inserir(db, produto.id, {
    unidade,
    descricao: unidade,
    fator_conversao: 1,
    preco: ComercialPrecoResolver.obterPrecoVenda(produto),
    codigo_barras: String(produto.codigo_barras || '').trim() || null,
    codigo_auxiliar: String(produto.codigo || '').trim() || null,
    principal: 1,
    ativo: 1,
    ordem: 0
  });

  return repo.listarPorProduto(db, produto.id);
}

async function listar(db, produtoId) {
  await garantirUnidadeBaseSeNecessario(db, produtoId);
  return repo.listarPorProduto(db, produtoId);
}

async function garantirUnidadeBaseSeNecessario(db, produtoId) {
  const tem = await repo.produtoJaTemUnidades(db, produtoId);
  if (tem) return;

  const produto = await new Promise((resolve, reject) => {
    db.get(
      `SELECT id, unidade, preco_venda, tabela_preco_id, codigo_barras, codigo FROM produtos WHERE id = ?`,
      [produtoId],
      (err, row) => (err ? reject(err) : resolve(row || null))
    );
  });

  if (!produto) {
    throw new Error('Produto não encontrado.');
  }

  await garantirUnidadeBase(db, produto);
}

async function criar(db, produtoId, payload) {
  await garantirUnidadeBaseSeNecessario(db, produtoId);

  const validacao = validarPayloadUnidade(payload);
  if (!validacao.ok) {
    const error = new Error(validacao.erros.join(' '));
    error.status = 400;
    throw error;
  }

  const dados = validacao.dados;
  if (dados.principal) {
    await repo.limparPrincipalDoProduto(db, produtoId);
  }

  const id = await repo.inserir(db, produtoId, dados);
  return repo.buscarPorId(db, id);
}

async function atualizar(db, produtoId, unidadeId, payload) {
  const atual = await repo.buscarPorId(db, unidadeId);
  if (!atual || Number(atual.produto_id) !== Number(produtoId)) {
    const error = new Error('Unidade comercial não encontrada para este produto.');
    error.status = 404;
    throw error;
  }

  const validacao = validarPayloadUnidade({ ...atual, ...payload });
  if (!validacao.ok) {
    const error = new Error(validacao.erros.join(' '));
    error.status = 400;
    throw error;
  }

  const dados = validacao.dados;
  if (dados.principal) {
    await repo.limparPrincipalDoProduto(db, produtoId, unidadeId);
  } else if (Number(atual.principal) === 1) {
    // Impede remover a marcação principal sem substituir
    dados.principal = 1;
  }

  await repo.atualizar(db, unidadeId, dados);
  return repo.buscarPorId(db, unidadeId);
}

async function excluir(db, produtoId, unidadeId) {
  const atual = await repo.buscarPorId(db, unidadeId);
  if (!atual || Number(atual.produto_id) !== Number(produtoId)) {
    const error = new Error('Unidade comercial não encontrada para este produto.');
    error.status = 404;
    throw error;
  }

  const total = await repo.contarAtivas(db, produtoId);
  if (Number(atual.principal) === 1 || total <= 1) {
    const error = new Error('Não é permitido excluir a unidade principal/base. Cadastre outra como principal antes.');
    error.status = 400;
    throw error;
  }

  await repo.remover(db, unidadeId);
  return { ok: true };
}

async function marcarPrincipal(db, produtoId, unidadeId) {
  const atual = await repo.buscarPorId(db, unidadeId);
  if (!atual || Number(atual.produto_id) !== Number(produtoId)) {
    const error = new Error('Unidade comercial não encontrada para este produto.');
    error.status = 404;
    throw error;
  }

  await repo.limparPrincipalDoProduto(db, produtoId);
  await repo.atualizar(db, unidadeId, {
    unidade: atual.unidade,
    descricao: atual.descricao,
    fator_conversao: atual.fator_conversao,
    preco: atual.preco,
    codigo_barras: atual.codigo_barras,
    codigo_auxiliar: atual.codigo_auxiliar,
    principal: 1,
    ativo: 1,
    ordem: atual.ordem || 0
  });

  return repo.buscarPorId(db, unidadeId);
}

async function resolverPorBarras(db, codigoBarras) {
  return repo.buscarPorCodigoBarras(db, codigoBarras);
}

async function obterUnidadeVenda(db, produtoId, unidadeComercialId = null) {
  await garantirUnidadeBaseSeNecessario(db, produtoId);

  if (unidadeComercialId) {
    const unidade = await repo.buscarPorId(db, unidadeComercialId);
    if (!unidade || Number(unidade.produto_id) !== Number(produtoId)) {
      const error = new Error('Unidade comercial inválida para o produto.');
      error.status = 400;
      throw error;
    }
    if (Number(unidade.ativo) === 0) {
      const error = new Error('Unidade comercial inativa.');
      error.status = 400;
      throw error;
    }
    return unidade;
  }

  const principal = await repo.buscarPrincipal(db, produtoId);
  if (principal) return principal;

  const ativas = await repo.listarAtivasPorProduto(db, produtoId);
  return ativas[0] || null;
}

function montarPayloadVenda({ produto, unidade, quantidadeComercial }) {
  const fator = Number(unidade.fator_conversao || 1);
  const baixa = resolverBaixaEstoque({
    quantidadeComercial,
    fatorConversao: fator
  });

  const preco = Number(
    unidade.preco != null
      ? unidade.preco
      : ComercialPrecoResolver.obterPrecoVenda(produto)
  ) || 0;

  return {
    produto_id: produto.id,
    unidade_comercial_id: unidade.id,
    unidade_comercial: unidade.unidade,
    fator_conversao: fator,
    codigo_barras_comercial: unidade.codigo_barras || produto.codigo_barras || null,
    quantidade: baixa.quantidade_comercial,
    quantidade_estoque: baixa.quantidade_base,
    preco_unitario: preco,
    subtotal: Number((baixa.quantidade_comercial * preco).toFixed(2))
  };
}

module.exports = {
  listar,
  criar,
  atualizar,
  excluir,
  marcarPrincipal,
  garantirUnidadeBase,
  garantirUnidadeBaseSeNecessario,
  resolverPorBarras,
  obterUnidadeVenda,
  montarPayloadVenda,
  paraBase,
  deBase,
  resolverBaixaEstoque,
  resolverEntradaEstoque
};
