/**
 * RCM-8.9 — Serviço de conversões permanentes do produto
 */

const repo = require('../repositories/ProdutoConversaoRepository');
const {
  normalizarCodigoUnidade,
  resolverFatorConversao,
  arredondar
} = require('../converters/ConversorUnidades');

const TIPOS = new Set(['FIXA']);

function _norm(u) {
  return normalizarCodigoUnidade(u) || String(u || '').trim().toUpperCase();
}

function validarPayload(payload = {}, { partial = false } = {}) {
  const erros = [];
  const origemRaw = payload.origem != null ? String(payload.origem).trim().toUpperCase() : '';
  const destinoRaw = payload.destino != null ? String(payload.destino).trim().toUpperCase() : '';
  const fator = Number(payload.fator);
  const tipo = String(payload.tipo || 'FIXA').trim().toUpperCase() || 'FIXA';

  if (!partial || payload.origem !== undefined) {
    if (!origemRaw) erros.push('Informe a unidade de origem.');
  }
  if (!partial || payload.destino !== undefined) {
    if (!destinoRaw) erros.push('Informe a unidade de destino.');
  }
  if (origemRaw && destinoRaw && _norm(origemRaw) === _norm(destinoRaw)) {
    erros.push('Origem e destino devem ser diferentes.');
  }
  if (!partial || payload.fator !== undefined) {
    if (!Number.isFinite(fator) || fator <= 0) {
      erros.push('Fator deve ser um número maior que zero.');
    }
  }
  if (!TIPOS.has(tipo)) {
    erros.push('Tipo de conversão inválido. Use FIXA.');
  }

  if (erros.length) return { ok: false, erros };

  return {
    ok: true,
    dados: {
      origem: origemRaw,
      destino: destinoRaw,
      fator,
      tipo,
      ativo: payload.ativo === 0 || payload.ativo === false ? 0 : 1
    }
  };
}

/**
 * Resolve fator 1 origem = fator × destino a partir das linhas do produto (direto ou inverso).
 * @returns {{ fator: number, origem: string, destino: string, sentido: 'direto'|'inverso', id?: number }|null}
 */
function resolverFatorNasConversoes(conversoes, unidadeOrigem, unidadeDestino) {
  const o = _norm(unidadeOrigem);
  const d = _norm(unidadeDestino);
  if (!o || !d) return null;
  if (o === d) return { fator: 1, origem: o, destino: d, sentido: 'direto' };

  const lista = Array.isArray(conversoes) ? conversoes : [];
  for (const row of lista) {
    if (row && (row.ativo === 0 || row.ativo === false)) continue;
    const ro = _norm(row.origem);
    const rd = _norm(row.destino);
    const f = Number(row.fator);
    if (!Number.isFinite(f) || f <= 0) continue;
    if (ro === o && rd === d) {
      return { fator: f, origem: o, destino: d, sentido: 'direto', id: row.id };
    }
    if (ro === d && rd === o) {
      return { fator: 1 / f, origem: o, destino: d, sentido: 'inverso', id: row.id };
    }
  }
  return null;
}

async function listar(db, produtoId) {
  return repo.listarPorProduto(db, produtoId);
}

async function listarAtivas(db, produtoId) {
  return repo.listarAtivasPorProduto(db, produtoId);
}

async function criar(db, produtoId, payload) {
  const validacao = validarPayload(payload);
  if (!validacao.ok) {
    const error = new Error(validacao.erros.join(' '));
    error.status = 400;
    throw error;
  }
  try {
    const id = await repo.inserir(db, produtoId, validacao.dados);
    return repo.buscarPorId(db, id);
  } catch (err) {
    if (/UNIQUE/i.test(String(err.message || ''))) {
      const error = new Error('Já existe conversão com essa origem e destino neste produto.');
      error.status = 409;
      throw error;
    }
    throw err;
  }
}

async function atualizar(db, produtoId, conversaoId, payload) {
  const atual = await repo.buscarPorId(db, conversaoId);
  if (!atual || Number(atual.produto_id) !== Number(produtoId)) {
    const error = new Error('Conversão não encontrada para este produto.');
    error.status = 404;
    throw error;
  }
  const validacao = validarPayload({ ...atual, ...payload });
  if (!validacao.ok) {
    const error = new Error(validacao.erros.join(' '));
    error.status = 400;
    throw error;
  }
  await repo.atualizar(db, conversaoId, validacao.dados);
  return repo.buscarPorId(db, conversaoId);
}

async function excluir(db, produtoId, conversaoId) {
  const atual = await repo.buscarPorId(db, conversaoId);
  if (!atual || Number(atual.produto_id) !== Number(produtoId)) {
    const error = new Error('Conversão não encontrada para este produto.');
    error.status = 404;
    throw error;
  }
  await repo.excluir(db, conversaoId);
  return { ok: true, id: conversaoId };
}

/**
 * Simula conversão quantidade origem → destino (via base do produto + MUC).
 * Não altera preço.
 */
async function simular(db, produtoId, entrada = {}) {
  const produto = await new Promise((resolve, reject) => {
    db.get(
      `SELECT id, nome, unidade FROM produtos WHERE id = ?`,
      [produtoId],
      (err, row) => (err ? reject(err) : resolve(row || null))
    );
  });
  if (!produto) {
    const error = new Error('Produto não encontrado.');
    error.status = 404;
    throw error;
  }

  const quantidade = Number(entrada.quantidade);
  if (!Number.isFinite(quantidade) || quantidade < 0) {
    const error = new Error('Informe uma quantidade válida.');
    error.status = 400;
    throw error;
  }

  const origem = String(entrada.origem || '').trim().toUpperCase();
  const destino = String(entrada.destino || '').trim().toUpperCase();
  if (!origem || !destino) {
    const error = new Error('Informe origem e destino.');
    error.status = 400;
    throw error;
  }

  const conversoes = await repo.listarAtivasPorProduto(db, produtoId);
  const produtoCtx = {
    ...produto,
    unidade_base: produto.unidade,
    conversoes,
    unidades_comercializacao: []
  };

  const { resolverUnidadeComercialOficial } = require('../../motor-conversao-comercial/services/resolverUnidadeComercialOficial');
  const base = String(produto.unidade || 'UN').trim().toUpperCase();

  let uOrig;
  let uDest;
  try {
    uOrig = resolverUnidadeComercialOficial({ produto: produtoCtx, codigo: origem, unidadeBase: base });
    uDest = resolverUnidadeComercialOficial({ produto: produtoCtx, codigo: destino, unidadeBase: base });
  } catch (e) {
    const error = new Error(e.message || 'Conversão não cadastrada.');
    error.status = e.status || 422;
    error.codigo = e.codigo || 'MCC_CONVERSAO_NAO_CADASTRADA';
    throw error;
  }

  const qBase = arredondar(quantidade * Number(uOrig.quantidade || 1), 6);
  const qDest = arredondar(qBase / Number(uDest.quantidade || 1), 6);
  const fatorEfetivo = quantidade > 0 ? arredondar(qDest / quantidade, 8) : 0;

  let fonte = 'canonica';
  const prod = resolverFatorNasConversoes(conversoes, origem, destino);
  if (prod) fonte = 'produto';
  else if (_norm(origem) === _norm(destino)) fonte = 'identidade';
  else if (resolverFatorConversao(origem, destino)) fonte = 'canonica';
  else if (resolverFatorNasConversoes(conversoes, origem, base)
    || resolverFatorNasConversoes(conversoes, destino, base)) {
    fonte = 'produto';
  }

  return {
    ok: true,
    produto_id: produtoId,
    quantidade_origem: quantidade,
    unidade_origem: origem,
    quantidade_base: qBase,
    unidade_base: base,
    quantidade_destino: qDest,
    unidade_destino: destino,
    fator: fatorEfetivo,
    fonte,
    tipo: 'FIXA'
  };
}

module.exports = {
  TIPOS,
  validarPayload,
  resolverFatorNasConversoes,
  listar,
  listarAtivas,
  criar,
  atualizar,
  excluir,
  simular
};
