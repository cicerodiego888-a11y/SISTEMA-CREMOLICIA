/**
 * PDV — correspondência exata de produto na busca `/produtos/consulta-pdv/buscar`.
 * Exato = código de barras, código interno ou código de uma unidade comercial ativa.
 * O ID do produto nunca conta como correspondência exata; letras não são descartadas.
 * Mesma regra de `frontend/shared/js/pdvResolucaoProduto.js`.
 */

'use strict';

function prepararTermoIdentificacao(termo) {
  const texto = String(termo ?? '').trim();
  const numerico = /^\d+$/.test(texto);
  const semZeros = numerico ? (texto.replace(/^0+/, '') || '0') : null;
  return {
    texto,
    lower: texto.toLowerCase(),
    numerico,
    semZeros,
    idListagem: semZeros
  };
}

function sqlNumericoEquivalente(coluna) {
  return `(
    ? = 1
    AND TRIM(COALESCE(${coluna}, '')) <> ''
    AND TRIM(${coluna}) NOT GLOB '*[^0-9]*'
    AND (CASE WHEN LTRIM(TRIM(${coluna}), '0') = '' THEN '0' ELSE LTRIM(TRIM(${coluna}), '0') END) = ?
  )`;
}

function sqlMatchExatoProdutoPdv(alias = 'p') {
  return `CASE WHEN ? <> '' AND (
      LOWER(TRIM(COALESCE(${alias}.codigo_barras, ''))) = ?
      OR LOWER(TRIM(COALESCE(${alias}.codigo, ''))) = ?
      OR ${sqlNumericoEquivalente(`${alias}.codigo_barras`)}
      OR ${sqlNumericoEquivalente(`${alias}.codigo`)}
      OR EXISTS (
        SELECT 1 FROM produto_unidades pu_exato
        WHERE pu_exato.produto_id = ${alias}.id
          AND COALESCE(pu_exato.ativo, 1) = 1
          AND (
            LOWER(TRIM(COALESCE(pu_exato.codigo_barras, ''))) = ?
            OR LOWER(TRIM(COALESCE(pu_exato.codigo_auxiliar, ''))) = ?
          )
      )
    ) THEN 1 ELSE 0 END`;
}

function paramsMatchExatoProdutoPdv(termo) {
  const flag = termo.numerico ? 1 : 0;
  return [
    termo.lower,
    termo.lower,
    termo.lower,
    flag, termo.semZeros,
    flag, termo.semZeros,
    termo.lower,
    termo.lower
  ];
}

module.exports = {
  prepararTermoIdentificacao,
  sqlMatchExatoProdutoPdv,
  paramsMatchExatoProdutoPdv
};
