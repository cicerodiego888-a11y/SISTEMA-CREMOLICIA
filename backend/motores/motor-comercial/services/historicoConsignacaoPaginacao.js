/**
 * RCM-8.5 — Paginação do histórico de consignações por cliente.
 * Não altera regras comerciais. Só limita o volume da consulta de leitura.
 */

const PAGE_SIZE_PADRAO = 20;
const PAGE_SIZE_MAX = 50;

function normalizarStatusIn(valor) {
  if (valor == null || valor === '') return null;
  const lista = Array.isArray(valor) ? valor : String(valor).split(',');
  const limpos = [...new Set(
    lista.map((s) => String(s || '').trim().toUpperCase()).filter(Boolean)
  )];
  return limpos.length ? limpos : null;
}

function resolverPaginacaoHistorico(query = {}) {
  const pageRaw = query.page ?? query.pagina;
  const sizeRaw = query.pageSize ?? query.limite ?? query.limit;
  const offsetRaw = query.offset;

  const solicitado = pageRaw != null || sizeRaw != null || offsetRaw != null;
  if (!solicitado) {
    return { paginado: false };
  }

  const pageSize = Math.min(
    PAGE_SIZE_MAX,
    Math.max(1, Number(sizeRaw) || PAGE_SIZE_PADRAO)
  );

  let page = Math.max(1, Math.floor(Number(pageRaw) || 1));
  let offset = Number(offsetRaw);
  if (!Number.isFinite(offset) || offset < 0) {
    offset = (page - 1) * pageSize;
  } else {
    offset = Math.floor(offset);
    page = Math.floor(offset / pageSize) + 1;
  }

  return {
    paginado: true,
    page,
    pageSize,
    limite: pageSize,
    offset
  };
}

function montarMetaPaginacao({ total, page, pageSize }) {
  const t = Number(total) || 0;
  const p = Math.max(1, Number(page) || 1);
  const size = Math.max(1, Number(pageSize) || PAGE_SIZE_PADRAO);
  return {
    total: t,
    page: p,
    pageSize: size,
    hasMore: p * size < t
  };
}

module.exports = {
  PAGE_SIZE_PADRAO,
  PAGE_SIZE_MAX,
  normalizarStatusIn,
  resolverPaginacaoHistorico,
  montarMetaPaginacao
};
