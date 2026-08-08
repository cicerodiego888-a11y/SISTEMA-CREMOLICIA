/**
 * UC-01.1 — Service ProdutoUnidadeComercial
 * Cadastro + auditorias. Sem conversão / movimentação.
 */

const repo = require('../repositories/ProdutoUnidadeComercialRepository');
const {
  validarPayloadUnidadeComercial,
  auditarConsistenciaProduto
} = require('../validators/UnidadeComercializacaoValidator');
const { toUnidadeComercialDTO } = require('../dto/UnidadeComercialDTO');
const { CANAIS_LABELS, TIPOS_META, TIPOS_LISTA } = require('../constants');

function obterProduto(db, produtoId) {
  return new Promise((resolve, reject) => {
    db.get(
      `
        SELECT id, nome, unidade,
               COALESCE(utiliza_conversao_fisica, 0) AS utiliza_conversao_fisica,
               unidade_conversao_fisica
        FROM produtos
        WHERE id = ?
      `,
      [produtoId],
      (err, row) => (err ? reject(err) : resolve(row || null))
    );
  });
}

function metaCatalogo() {
  return {
    tipos: TIPOS_LISTA.map((t) => ({
      value: t,
      label: TIPOS_META[t]?.label || t,
      icone: TIPOS_META[t]?.icone || '',
      tooltip: TIPOS_META[t]?.tooltip || ''
    })),
    canais: Object.keys(CANAIS_LABELS).map((k) => ({
      key: k,
      label: CANAIS_LABELS[k]
    }))
  };
}

async function listar(db, produtoId) {
  const produto = await obterProduto(db, produtoId);
  if (!produto) {
    const error = new Error('Produto não encontrado.');
    error.status = 404;
    throw error;
  }
  const unidades = await repo.listarPorProduto(db, produtoId);
  return {
    produto_id: Number(produtoId),
    unidade_base: String(produto.unidade || 'UN').toUpperCase(),
    utiliza_conversao_fisica: Number(produto.utiliza_conversao_fisica || 0) === 1 ? 1 : 0,
    unidade_conversao_fisica: produto.unidade_conversao_fisica || null,
    catalogo: metaCatalogo(),
    items: unidades.map(toUnidadeComercialDTO)
  };
}

async function prepararEPersistir(db, produtoId, payload, { unidadeId = null, atual = null } = {}) {
  const produto = await obterProduto(db, produtoId);
  if (!produto) {
    const error = new Error('Produto não encontrado.');
    error.status = 404;
    throw error;
  }

  const unidadeBase = String(produto.unidade || 'UN').toUpperCase();
  const merge = atual ? { ...atual, ...payload } : payload;
  // canais vindos do body têm prioridade; se payload só tem permite_*, o validator deriva
  if (payload.canais_comercializacao != null) {
    merge.canais_comercializacao = payload.canais_comercializacao;
  }

  const validacao = validarPayloadUnidadeComercial(merge, { unidadeBaseProduto: unidadeBase });
  if (!validacao.ok) {
    const error = new Error(validacao.erros.join(' '));
    error.status = 400;
    throw error;
  }

  const dados = validacao.dados;
  dados.unidade_base = unidadeBase;

  if (dados.ordem === undefined) {
    dados.ordem = atual ? Number(atual.ordem || 0) : await repo.proximaOrdem(db, produtoId);
  }
  if (payload.prioridade === undefined || payload.prioridade === null || payload.prioridade === '') {
    dados.prioridade = atual
      ? Number(atual.prioridade != null ? atual.prioridade : 1)
      : await repo.proximaPrioridade(db, produtoId);
  }

  const existentes = await repo.listarPorProduto(db, produtoId);
  const audit = auditarConsistenciaProduto(existentes, dados, unidadeId);
  if (!audit.ok) {
    const error = new Error(audit.erros.join(' '));
    error.status = 400;
    throw error;
  }

  // Garante no máximo uma unidade padrão por produto
  if (Number(dados.unidade_padrao) === 1) {
    await repo.limparPadraoDoProduto(db, produtoId, unidadeId);
  }

  return dados;
}

async function criar(db, produtoId, payload) {
  const dados = await prepararEPersistir(db, produtoId, payload || {});
  const id = await repo.inserir(db, produtoId, dados);
  const row = await repo.buscarPorId(db, id);
  return toUnidadeComercialDTO(row);
}

async function atualizar(db, produtoId, unidadeId, payload) {
  const atual = await repo.buscarPorId(db, unidadeId);
  if (!atual || Number(atual.produto_id) !== Number(produtoId)) {
    const error = new Error('Unidade de comercialização não encontrada para este produto.');
    error.status = 404;
    throw error;
  }

  const dados = await prepararEPersistir(db, produtoId, payload || {}, { unidadeId, atual });
  await repo.atualizar(db, unidadeId, dados);
  const row = await repo.buscarPorId(db, unidadeId);
  return toUnidadeComercialDTO(row);
}

async function excluir(db, produtoId, unidadeId) {
  const atual = await repo.buscarPorId(db, unidadeId);
  if (!atual || Number(atual.produto_id) !== Number(produtoId)) {
    const error = new Error('Unidade de comercialização não encontrada para este produto.');
    error.status = 404;
    throw error;
  }
  await repo.remover(db, unidadeId);
  return { ok: true, id: unidadeId };
}

module.exports = {
  listar,
  criar,
  atualizar,
  excluir,
  obterProduto,
  metaCatalogo
};
