/**
 * PDV — produto comercializável.
 * Produto com natureza_cadastro = INSUMO tem estoque e produção normais,
 * mas não é listado, encontrado nem vendido pelo PDV (desktop e mobile).
 */

'use strict';

const NATUREZA_INSUMO = 'INSUMO';
const CODIGO_PRODUTO_INSUMO_PDV = 'PRODUTO_INSUMO_NAO_VENDAVEL';
const MENSAGEM_PRODUTO_INSUMO_PDV = 'Este produto é um insumo e não pode ser vendido pelo PDV.';
const ORIGENS_PDV = new Set(['PDV_DESKTOP', 'PDV_MOBILE']);

function produtoEhInsumo(produto) {
  return String(produto?.natureza_cadastro ?? '').trim().toUpperCase() === NATUREZA_INSUMO;
}

function sqlProdutoComercializavelPdv(alias = 'p') {
  return `UPPER(TRIM(COALESCE(${alias}.natureza_cadastro, ''))) <> '${NATUREZA_INSUMO}'`;
}

function contextoPdv(query = {}) {
  return String(query?.contexto || '').trim().toLowerCase() === 'pdv';
}

function origemEhPdv(origem) {
  return ORIGENS_PDV.has(String(origem || '').trim().toUpperCase());
}

function produtosTemNatureza(db) {
  return new Promise((resolve, reject) => {
    db.all('PRAGMA table_info(produtos)', [], (err, cols) => {
      if (err) return reject(err);
      resolve((cols || []).some((col) => col.name === 'natureza_cadastro'));
    });
  });
}

/** Produtos INSUMO entre os ids informados: [{ produto_id, nome }]. */
async function listarInsumosEntreProdutos(db, produtoIds = []) {
  const ids = [...new Set((produtoIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length || !(await produtosTemNatureza(db))) return [];
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT id, nome FROM produtos
        WHERE id IN (${ids.map(() => '?').join(',')})
          AND UPPER(TRIM(COALESCE(natureza_cadastro, ''))) = '${NATUREZA_INSUMO}'`,
      ids,
      (err, rows) => (err
        ? reject(err)
        : resolve((rows || []).map((row) => ({ produto_id: row.id, nome: row.nome }))))
    );
  });
}

function respostaInsumoPdv(insumos) {
  return {
    error: MENSAGEM_PRODUTO_INSUMO_PDV,
    codigo: CODIGO_PRODUTO_INSUMO_PDV,
    itens: insumos
  };
}

module.exports = {
  NATUREZA_INSUMO,
  CODIGO_PRODUTO_INSUMO_PDV,
  MENSAGEM_PRODUTO_INSUMO_PDV,
  produtoEhInsumo,
  sqlProdutoComercializavelPdv,
  contextoPdv,
  origemEhPdv,
  produtosTemNatureza,
  listarInsumosEntreProdutos,
  respostaInsumoPdv
};
