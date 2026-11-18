/**
 * Produto-linha legado convertido (FABRICA-CONVERSAO-03).
 *
 * Regra única: produto identificado em `linhas_produtos_legado` que já tem conversão
 * CONCLUIDA em `conversoes_estoque_linha`. O estoque dele foi para os sabores; ele não
 * entra em nova venda, pedido ou consignação. Histórico (vendas, NFC-e, consignações
 * antigas, devolução e acerto delas) continua funcionando normalmente.
 *
 * Sem a estrutura da migration 011 nenhum produto é considerado convertido.
 */

'use strict';

const CODIGO_PRODUTO_LINHA_CONVERTIDO = 'PRODUTO_LINHA_CONVERTIDO';
const MENSAGEM_PRODUTO_LINHA_CONVERTIDO = 'Este produto-linha foi convertido para produtos individuais e não pode mais ser vendido diretamente. Selecione os produtos individuais correspondentes e informe a quantidade de cada item.';

function estruturaConversaoPresente(db) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT COUNT(*) AS q FROM sqlite_master
        WHERE type = 'table' AND name IN ('linhas_produtos_legado', 'conversoes_estoque_linha')`,
      [],
      (err, row) => (err ? reject(err) : resolve(Number(row && row.q) === 2))
    );
  });
}

/** Trecho SQL (sem AND) que é verdadeiro quando o produto do alias NÃO é produto-linha convertido. */
function sqlProdutoNaoConvertido(alias = 'p') {
  return `NOT EXISTS (
    SELECT 1 FROM linhas_produtos_legado lpl
    JOIN conversoes_estoque_linha cel ON cel.produto_origem_id = lpl.produto_id AND cel.status = 'CONCLUIDA'
    WHERE lpl.produto_id = ${alias}.id
  )`;
}

/** Produtos-linha convertidos entre os ids informados: [{ produto_id, nome, correlation_id }]. */
async function listarProdutosLinhaConvertidos(db, produtoIds = []) {
  const ids = [...new Set((produtoIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length || !(await estruturaConversaoPresente(db))) return [];
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT p.id, p.nome, MIN(cel.correlation_id) AS correlation_id
         FROM produtos p
         JOIN linhas_produtos_legado lpl ON lpl.produto_id = p.id
         JOIN conversoes_estoque_linha cel ON cel.produto_origem_id = p.id AND cel.status = 'CONCLUIDA'
        WHERE p.id IN (${ids.map(() => '?').join(',')})
        GROUP BY p.id, p.nome
        ORDER BY p.id`,
      ids,
      (err, rows) => (err
        ? reject(err)
        : resolve((rows || []).map((row) => ({ produto_id: row.id, nome: row.nome, correlation_id: row.correlation_id }))))
    );
  });
}

function respostaProdutoLinhaConvertido(itens) {
  return {
    error: MENSAGEM_PRODUTO_LINHA_CONVERTIDO,
    codigo: CODIGO_PRODUTO_LINHA_CONVERTIDO,
    itens
  };
}

module.exports = {
  CODIGO_PRODUTO_LINHA_CONVERTIDO,
  MENSAGEM_PRODUTO_LINHA_CONVERTIDO,
  estruturaConversaoPresente,
  sqlProdutoNaoConvertido,
  listarProdutosLinhaConvertidos,
  respostaProdutoLinhaConvertido
};
