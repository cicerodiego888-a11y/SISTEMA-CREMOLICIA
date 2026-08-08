/**
 * ComercialPrecoResolver — Fonte ÚNICA de preço (RCM-8.0)
 *
 * Fluxo oficial (único):
 *   Produto → possui Linha?
 *     SIM → Tabela da Operação → Linha → Unidade → Preço
 *     NÃO → Tabela da Operação → Produto → Unidade → Preço
 *   Sem célula → Preço de Segurança (produto.preco_venda)
 *
 * Retorno: preco, unidade_comercial, origem, tabela_preco_id (+ metadados).
 * Removidos: linha_comercial_valores, tabela×canal sem referência, compat opacos.
 */

const db = require('../../../database');
const {
  resolverFormaEfetiva,
  rotuloUnidadeComercial
} = require('./FormaComercializacao');

const ORIGEM_LEGADO = 'produto.preco_venda';
const ORIGEM_TABELA = 'tabela_preco';
const ORIGEM_TABELA_LINHA = 'tabela_preco_linha';
const ORIGEM_TABELA_PRODUTO = 'tabela_preco_produto';
const ORIGEM_LINHA = 'linha_comercial';
const CANAL_PADRAO = 'VAREJO';

/** @type {Map<string, object>} */
const cachePreco = new Map();

let logsHabilitados = process.env.COMERCIAL_PRECO_LOG !== '0';

function chaveCacheTabela(tabelaId, canalCodigo) {
  return `T:${Number(tabelaId)}::${String(canalCodigo || CANAL_PADRAO).toUpperCase()}`;
}

function chaveCacheTabelaLinha(tabelaId, linhaId, canalCodigo) {
  return `TL:${Number(tabelaId)}:${Number(linhaId)}::${String(canalCodigo || CANAL_PADRAO).toUpperCase()}`;
}

function chaveCacheLinha(linhaId, canalCodigo) {
  return `L:${Number(linhaId)}::${String(canalCodigo || CANAL_PADRAO).toUpperCase()}`;
}

/** Compat: chave antiga sem prefixo T: */
function chaveCacheLegada(tabelaId, canalCodigo) {
  return `${Number(tabelaId)}::${String(canalCodigo || CANAL_PADRAO).toUpperCase()}`;
}

function invalidateCache(tabelaId = null) {
  if (tabelaId == null) {
    cachePreco.clear();
    return;
  }
  const tid = Number(tabelaId);
  for (const key of cachePreco.keys()) {
    if (
      key.startsWith(`T:${tid}::`) ||
      key.startsWith(`${tid}::`) ||
      key.startsWith(`TL:${tid}:`)
    ) {
      cachePreco.delete(key);
    }
  }
}

function invalidateCacheLinha(linhaId = null) {
  if (linhaId == null) {
    for (const key of [...cachePreco.keys()]) {
      if (key.startsWith('L:') || key.startsWith('TL:')) cachePreco.delete(key);
    }
    return;
  }
  const prefix = `L:${Number(linhaId)}::`;
  const mid = `:${Number(linhaId)}::`;
  for (const key of cachePreco.keys()) {
    if (key.startsWith(prefix) || (key.startsWith('TL:') && key.includes(mid))) {
      cachePreco.delete(key);
    }
  }
}

function setCacheTabela(tabelaId, canalCodigo, preco, meta = {}) {
  const entry = {
    preco: Number(preco),
    tabela_nome: meta.tabela_nome || null,
    canal_id: meta.canal_id != null ? Number(meta.canal_id) : null,
    forma_comercializacao: meta.forma_comercializacao || null,
    unidade_comercial: meta.unidade_comercial || null
  };
  cachePreco.set(chaveCacheTabela(tabelaId, canalCodigo), entry);
  cachePreco.set(chaveCacheLegada(tabelaId, canalCodigo), entry);
}

function getCacheTabela(tabelaId, canalCodigo) {
  return (
    cachePreco.get(chaveCacheTabela(tabelaId, canalCodigo)) ||
    cachePreco.get(chaveCacheLegada(tabelaId, canalCodigo)) ||
    null
  );
}

function setCacheLinha(linhaId, canalCodigo, preco, meta = {}) {
  cachePreco.set(chaveCacheLinha(linhaId, canalCodigo), {
    preco: Number(preco),
    linha_codigo: meta.linha_codigo || null,
    linha_descricao: meta.linha_descricao || null,
    canal_id: meta.canal_id != null ? Number(meta.canal_id) : null,
    forma_comercializacao: meta.forma_comercializacao || null,
    unidade_comercial: meta.unidade_comercial || null
  });
}

function getCacheLinha(linhaId, canalCodigo) {
  return cachePreco.get(chaveCacheLinha(linhaId, canalCodigo)) || null;
}

function setCacheTabelaLinha(tabelaId, linhaId, canalCodigo, preco, meta = {}) {
  cachePreco.set(chaveCacheTabelaLinha(tabelaId, linhaId, canalCodigo), {
    preco: Number(preco),
    tabela_nome: meta.tabela_nome || null,
    linha_codigo: meta.linha_codigo || null,
    linha_descricao: meta.linha_descricao || null,
    canal_id: meta.canal_id != null ? Number(meta.canal_id) : null,
    forma_comercializacao: meta.forma_comercializacao || null,
    unidade_comercial: meta.unidade_comercial || null
  });
}

function getCacheTabelaLinha(tabelaId, linhaId, canalCodigo) {
  return cachePreco.get(chaveCacheTabelaLinha(tabelaId, linhaId, canalCodigo)) || null;
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

function extrairTabelaId(opts = {}, _produto = {}) {
  // RA-6.4: apenas contexto da venda — produto.tabela_preco_id NÃO entra no fluxo oficial
  const raw = opts.tabela_preco_id ?? opts.tabelaId ?? null;
  if (raw === '' || raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Resolve tabela do contexto da venda (RA-6.4).
 * Oficial:
 *   1) opts.tabela_preco_id (fluxo da venda — PDV / consignação / evento)
 *   2) tabela ativa do Canal solicitado
 * Compat (sem produto.tabela_preco_id):
 *   3) configuracao_comercial.tabela_preco_padrao_id
 *   4) tabela PADRAO / primeira ativa
 *
 * produto.tabela_preco_id: NUNCA usado (somente legado histórico em leitura externa).
 */
async function resolverTabelaId(opts = {}, _produto = {}) {
  const fromOpts = opts.tabela_preco_id ?? opts.tabelaId ?? null;
  if (fromOpts != null && fromOpts !== '') {
    const n = Number(fromOpts);
    if (Number.isFinite(n) && n > 0) return n;
  }

  const canal = String(opts.canal || opts.canal_codigo || '').trim().toUpperCase();
  if (canal) {
    try {
      const tabelasPrecoRepository = require('../tabelas-preco/TabelasPrecoRepository');
      const porCanal = await tabelasPrecoRepository.buscarAtivaPorCanal(canal);
      if (porCanal?.id) return Number(porCanal.id);
    } catch (_) { /* ignore */ }
  }

  if (opts.canal_venda_id != null && Number(opts.canal_venda_id) > 0) {
    try {
      const tabelasPrecoRepository = require('../tabelas-preco/TabelasPrecoRepository');
      const porCanal = await tabelasPrecoRepository.buscarAtivaPorCanal(Number(opts.canal_venda_id));
      if (porCanal?.id) return Number(porCanal.id);
    } catch (_) { /* ignore */ }
  }

  try {
    const cfg = await dbGet(
      `SELECT tabela_preco_padrao_id FROM configuracao_comercial LIMIT 1`
    );
    const padrao = Number(cfg?.tabela_preco_padrao_id || 0);
    if (padrao > 0) return padrao;
  } catch (_) { /* coluna ainda não migrada */ }

  try {
    const row = await dbGet(
      `SELECT id FROM tabelas_preco
       WHERE COALESCE(ativo,1) = 1
       ORDER BY CASE WHEN UPPER(codigo)='PADRAO' THEN 0 ELSE 1 END, id ASC
       LIMIT 1`
    );
    const id = Number(row?.id || 0);
    return id > 0 ? id : null;
  } catch (_) {
    return null;
  }
}

function extrairLinhaId(opts = {}, produto = {}) {
  const raw =
    opts.politica_comercial_id ??
    opts.linha_comercial_id ??
    produto.linha_comercial_id ??
    opts.linhaComercialId ??
    null;
  if (raw === '' || raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function extrairCategoriaId(opts = {}, produto = {}) {
  const raw = opts.categoria_id ?? produto.categoria_id ?? null;
  if (raw === '' || raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * A-1 — Resolve Linha de Precificação (entidade interna: linhas_comerciais):
 * 1) política explícita no opts/produto
 * 2) políticas N:N do produto (com valor no canal)
 * 3) legado categoria.linha_comercial_id (somente leitura; nunca cria)
 * Sem política explícita = todas habilitadas → null (fallback tabela/legado)
 */
async function resolverLinhaId(opts = {}, produto = {}) {
  let linhaId = extrairLinhaId(opts, produto);
  if (linhaId) return linhaId;

  try {
    const ProdutoPoliticas = require('../politicas/ProdutoPoliticasComerciaisService');
    const resolvida = await ProdutoPoliticas.resolverPoliticaParaPreco(produto, opts);
    if (resolvida) return resolvida;
  } catch (_) { /* noop */ }

  // Compat legado: categoria pode sugerir (nunca criar)
  const categoriaId = extrairCategoriaId(opts, produto);
  if (!categoriaId) return null;

  try {
    const row = await dbGet(
      `SELECT linha_comercial_id FROM categorias WHERE id = ?`,
      [categoriaId]
    );
    const n = Number(row?.linha_comercial_id || 0);
    return n > 0 ? n : null;
  } catch (_) {
    return null;
  }
}

function extrairPrecoLegado(opts = {}, produto = {}) {
  const bruto = produto.preco_venda ?? produto.precoVenda ?? opts.preco_venda ?? opts.preco ?? 0;
  const preco = Number(bruto);
  return Number.isFinite(preco) ? preco : 0;
}

function extrairCanal(opts = {}) {
  return String(opts.canal || opts.canal_codigo || CANAL_PADRAO).trim().toUpperCase() || CANAL_PADRAO;
}

function nomeProduto(produto = {}) {
  return produto.nome || produto.descricao || `#${produto.id || '?'}`;
}

function anexarForma(resultado, valorRegra, produto) {
  const forma = resolverFormaEfetiva(valorRegra, produto);
  return {
    ...resultado,
    formaComercializacao: forma.formaComercializacao,
    forma_comercializacao: forma.formaComercializacao,
    unidadeComercial: forma.unidadeComercial,
    unidade_comercial: forma.unidadeComercial,
    unidade_rotulo: rotuloUnidadeComercial(forma.unidadeComercial),
    forma_herdada: !!forma.herdado
  };
}

function logResolucao({
  produto,
  canal,
  origemLabel,
  fonteNome,
  preco,
  forma,
  unidade,
  tabelaId = null,
  tabelaNome = null,
  linhaId = null,
  linhaCodigo = null,
  origemCodigo = null,
  operacao = null
}) {
  if (!logsHabilitados) return;
  // RCM-8.1 — log estruturado para homologação / diagnóstico
  const registro = {
    operacao: operacao || canal || null,
    canal: canal || null,
    tabela_id: tabelaId != null ? Number(tabelaId) : null,
    tabela: tabelaNome || fonteNome || null,
    produto_id: produto && produto.id != null ? Number(produto.id) : null,
    produto: nomeProduto(produto),
    linha_id: linhaId != null ? Number(linhaId) : null,
    linha: linhaCodigo || null,
    unidade_comercial: unidade || null,
    forma: forma || null,
    preco: Number(preco),
    origem: origemLabel,
    origem_codigo: origemCodigo || null
  };
  console.log('[RCM-8.1][Resolver]', JSON.stringify(registro));
  console.log(
    `[Comercial]\nProduto: ${registro.produto}\nCanal: ${registro.canal}\nTabela: ${registro.tabela || '—'}\nLinha: ${registro.linha || '—'}\nPreço: ${Number(preco).toFixed(2)}\nUnidade: ${unidade || '—'}\nOrigem: ${origemLabel}`
  );
}

const MSG_SEM_PRECO_LINHA =
  'Nenhum preço encontrado para esta Linha de Precificação na Tabela selecionada.';

function montarResultado({
  preco,
  origem,
  canal,
  canalId,
  tabelaId = null,
  tabelaNome = null,
  linhaId = null,
  linhaCodigo = null,
  linhaDescricao = null,
  fallback = false,
  valorRegra = null,
  produto = {},
  aviso = null,
  erro = null
}) {
  const base = anexarForma(
    {
      preco_venda: preco,
      preco,
      origem,
      canal,
      canal_venda_id: canalId,
      tabela_preco_id: tabelaId,
      tabela_preco_nome: tabelaNome || null,
      linha_comercial_id: linhaId,
      linha_comercial_codigo: linhaCodigo || null,
      linha_comercial_descricao: linhaDescricao || null,
      linhaComercial: linhaId
        ? {
            id: linhaId,
            codigo: linhaCodigo || null,
            descricao: linhaDescricao || null
          }
        : null,
      fallback: !!fallback,
      aviso: aviso || null,
      erro: erro || null
    },
    valorRegra,
    produto
  );
  return base;
}

async function buscarPrecoLinha(linhaId, canalCodigo) {
  const cached = getCacheLinha(linhaId, canalCodigo);
  if (cached && Number.isFinite(cached.preco)) {
    return {
      preco: cached.preco,
      linha_codigo: cached.linha_codigo,
      linha_descricao: cached.linha_descricao,
      canal_id: cached.canal_id,
      forma_comercializacao: cached.forma_comercializacao,
      unidade_comercial: cached.unidade_comercial
    };
  }

  const row = await dbGet(
    `
    SELECT
      v.preco,
      v.canal_venda_id,
      v.forma_comercializacao,
      v.unidade_comercial,
      l.codigo AS linha_codigo,
      l.descricao AS linha_descricao,
      l.ativo AS linha_ativa,
      c.codigo AS canal_codigo,
      c.ativo AS canal_ativo
    FROM linha_comercial_valores v
    INNER JOIN linhas_comerciais l ON l.id = v.linha_id
    INNER JOIN canais_venda c ON c.id = v.canal_venda_id
    WHERE v.linha_id = ?
      AND UPPER(c.codigo) = UPPER(?)
    LIMIT 1
    `,
    [linhaId, canalCodigo]
  );

  if (!row) return null;
  if (Number(row.linha_ativa) === 0) return null;

  const preco = Number(row.preco);
  if (!Number.isFinite(preco) || preco < 0) return null;

  const forma = row.forma_comercializacao
    ? String(row.forma_comercializacao).toUpperCase()
    : null;
  const unidade = row.unidade_comercial
    ? String(row.unidade_comercial).toUpperCase()
    : null;

  setCacheLinha(linhaId, canalCodigo, preco, {
    linha_codigo: row.linha_codigo,
    linha_descricao: row.linha_descricao,
    canal_id: row.canal_venda_id,
    forma_comercializacao: forma,
    unidade_comercial: unidade
  });

  return {
    preco,
    linha_codigo: row.linha_codigo,
    linha_descricao: row.linha_descricao,
    canal_id: Number(row.canal_venda_id),
    forma_comercializacao: forma,
    unidade_comercial: unidade
  };
}

/**
 * RA-2 — Preço oficial: Tabela × Linha de Precificação × Canal
 * @returns {Promise<object|null>}
 */
async function buscarPrecoTabelaLinha(tabelaId, linhaId, canalCodigo) {
  const cached = getCacheTabelaLinha(tabelaId, linhaId, canalCodigo);
  if (cached && Number.isFinite(cached.preco)) {
    return {
      preco: cached.preco,
      tabela_nome: cached.tabela_nome,
      linha_codigo: cached.linha_codigo,
      linha_descricao: cached.linha_descricao,
      canal_id: cached.canal_id,
      forma_comercializacao: cached.forma_comercializacao,
      unidade_comercial: cached.unidade_comercial
    };
  }

  const row = await dbGet(
    `
    SELECT
      v.preco,
      v.canal_venda_id,
      v.forma_comercializacao,
      v.unidade_comercial,
      t.nome AS tabela_nome,
      t.ativo AS tabela_ativa,
      l.codigo AS linha_codigo,
      l.descricao AS linha_descricao,
      l.ativo AS linha_ativa,
      c.codigo AS canal_codigo,
      c.ativo AS canal_ativo
    FROM tabela_preco_valores v
    INNER JOIN tabelas_preco t ON t.id = v.tabela_preco_id
    INNER JOIN linhas_comerciais l ON l.id = v.linha_comercial_id
    INNER JOIN canais_venda c ON c.id = v.canal_venda_id
    WHERE v.tabela_preco_id = ?
      AND v.linha_comercial_id = ?
      AND UPPER(c.codigo) = UPPER(?)
      AND COALESCE(v.ativo, 1) = 1
    LIMIT 1
    `,
    [tabelaId, linhaId, canalCodigo]
  );

  if (!row) return null;
  if (Number(row.tabela_ativa) === 0 || Number(row.linha_ativa) === 0) return null;

  const preco = Number(row.preco);
  if (!Number.isFinite(preco) || preco < 0) return null;

  const forma = row.forma_comercializacao
    ? String(row.forma_comercializacao).toUpperCase()
    : null;
  const unidade = row.unidade_comercial
    ? String(row.unidade_comercial).toUpperCase()
    : null;

  setCacheTabelaLinha(tabelaId, linhaId, canalCodigo, preco, {
    tabela_nome: row.tabela_nome,
    linha_codigo: row.linha_codigo,
    linha_descricao: row.linha_descricao,
    canal_id: row.canal_venda_id,
    forma_comercializacao: forma,
    unidade_comercial: unidade
  });

  return {
    preco,
    tabela_nome: row.tabela_nome,
    linha_codigo: row.linha_codigo,
    linha_descricao: row.linha_descricao,
    canal_id: Number(row.canal_venda_id),
    forma_comercializacao: forma,
    unidade_comercial: unidade
  };
}

/**
 * Consulta preço + forma na tabela para o canal informado (compat sem linha).
 * @returns {Promise<object|null>}
 */
async function buscarPrecoTabela(tabelaId, canalCodigo) {
  const cached = getCacheTabela(tabelaId, canalCodigo);
  if (cached && Number.isFinite(cached.preco)) {
    return {
      preco: cached.preco,
      tabela_nome: cached.tabela_nome,
      canal_id: cached.canal_id,
      forma_comercializacao: cached.forma_comercializacao,
      unidade_comercial: cached.unidade_comercial
    };
  }

  const row = await dbGet(
    `
    SELECT
      v.preco,
      v.canal_venda_id,
      v.forma_comercializacao,
      v.unidade_comercial,
      t.nome AS tabela_nome,
      t.ativo AS tabela_ativa,
      c.codigo AS canal_codigo,
      c.ativo AS canal_ativo
    FROM tabela_preco_valores v
    INNER JOIN tabelas_preco t ON t.id = v.tabela_preco_id
    INNER JOIN canais_venda c ON c.id = v.canal_venda_id
    WHERE v.tabela_preco_id = ?
      AND UPPER(c.codigo) = UPPER(?)
    LIMIT 1
    `,
    [tabelaId, canalCodigo]
  );

  if (!row) return null;
  if (Number(row.tabela_ativa) === 0) return null;

  const preco = Number(row.preco);
  if (!Number.isFinite(preco) || preco < 0) return null;

  const formaTabela = row.forma_comercializacao
    ? String(row.forma_comercializacao).toUpperCase()
    : null;
  const unidadeTabela = row.unidade_comercial
    ? String(row.unidade_comercial).toUpperCase()
    : null;

  setCacheTabela(tabelaId, canalCodigo, preco, {
    tabela_nome: row.tabela_nome,
    canal_id: row.canal_venda_id,
    forma_comercializacao: formaTabela,
    unidade_comercial: unidadeTabela
  });

  return {
    preco,
    tabela_nome: row.tabela_nome,
    canal_id: Number(row.canal_venda_id),
    forma_comercializacao: formaTabela,
    unidade_comercial: unidadeTabela
  };
}

/**
 * Pré-aquece cache de preços do canal (tabelas + linhas).
 */
async function aquecerCacheCanal(canalCodigo = CANAL_PADRAO) {
  const rowsTabela = await dbAll(
    `
    SELECT
      v.tabela_preco_id,
      v.preco,
      v.canal_venda_id,
      v.forma_comercializacao,
      v.unidade_comercial,
      t.nome AS tabela_nome,
      c.codigo AS canal_codigo
    FROM tabela_preco_valores v
    INNER JOIN tabelas_preco t ON t.id = v.tabela_preco_id AND t.ativo = 1
    INNER JOIN canais_venda c ON c.id = v.canal_venda_id AND c.ativo = 1
    WHERE UPPER(c.codigo) = UPPER(?)
    `,
    [canalCodigo]
  );

  for (const row of rowsTabela) {
    setCacheTabela(row.tabela_preco_id, row.canal_codigo || canalCodigo, row.preco, {
      tabela_nome: row.tabela_nome,
      canal_id: row.canal_venda_id,
      forma_comercializacao: row.forma_comercializacao
        ? String(row.forma_comercializacao).toUpperCase()
        : null,
      unidade_comercial: row.unidade_comercial
        ? String(row.unidade_comercial).toUpperCase()
        : null
    });
  }

  let nLinhas = 0;
  try {
    const rowsLinha = await dbAll(
      `
      SELECT
        v.linha_id,
        v.preco,
        v.canal_venda_id,
        v.forma_comercializacao,
        v.unidade_comercial,
        l.codigo AS linha_codigo,
        l.descricao AS linha_descricao,
        c.codigo AS canal_codigo
      FROM linha_comercial_valores v
      INNER JOIN linhas_comerciais l ON l.id = v.linha_id AND l.ativo = 1
      INNER JOIN canais_venda c ON c.id = v.canal_venda_id AND c.ativo = 1
      WHERE UPPER(c.codigo) = UPPER(?)
      `,
      [canalCodigo]
    );
    for (const row of rowsLinha) {
      setCacheLinha(row.linha_id, row.canal_codigo || canalCodigo, row.preco, {
        linha_codigo: row.linha_codigo,
        linha_descricao: row.linha_descricao,
        canal_id: row.canal_venda_id,
        forma_comercializacao: row.forma_comercializacao
          ? String(row.forma_comercializacao).toUpperCase()
          : null,
        unidade_comercial: row.unidade_comercial
          ? String(row.unidade_comercial).toUpperCase()
          : null
      });
    }
    nLinhas = rowsLinha.length;
  } catch (_) {
    /* tabela linha ainda não existe em ambientes antigos */
  }

  return rowsTabela.length + nLinhas;
}

/**
 * RCM-8.0 — fluxo único:
 *   Com Linha  → Tabela → Linha → Unidade → Preço
 *   Sem Linha  → Tabela → Produto → Unidade → Preço
 *   Sem célula → Preço de Segurança
 */
async function resolver(opts = {}) {
  const produto = opts.produto || {};
  let canal = opts.canal || opts.canal_codigo || null;

  if (!canal && Array.isArray(opts.itens)) {
    try {
      const CanalVendaResolver = require('./CanalVendaResolver');
      const canalInfo = await CanalVendaResolver.resolver({ itens: opts.itens });
      canal = canalInfo.canal;
      opts = {
        ...opts,
        canal_venda_id: opts.canal_venda_id ?? canalInfo.canal_venda_id,
        tabela_preco_id: opts.tabela_preco_id ?? canalInfo.tabela_preco_id ?? null
      };
    } catch (_) {
      canal = CANAL_PADRAO;
    }
  }

  canal = String(canal || CANAL_PADRAO).trim().toUpperCase() || CANAL_PADRAO;
  const linhaId = await resolverLinhaId(opts, produto);
  const tabelaId = await resolverTabelaId({ ...opts, canal }, produto);
  const produtoId = Number(produto.id || opts.produto_id || 0);
  const legado = extrairPrecoLegado(opts, produto);
  let avisouSemCelula = false;

  // 1) Com Linha → Tabela × Linha (prioridade; não cai em Produto)
  if (tabelaId && linhaId) {
    try {
      const encontrado = await buscarPrecoTabelaLinha(tabelaId, linhaId, canal);
      if (encontrado) {
        const valorRegra = {
          forma_comercializacao: encontrado.forma_comercializacao,
          unidade_comercial: encontrado.unidade_comercial
        };
        const resultado = montarResultado({
          preco: encontrado.preco,
          origem: ORIGEM_TABELA_LINHA,
          canal,
          canalId: encontrado.canal_id,
          tabelaId,
          tabelaNome: encontrado.tabela_nome,
          linhaId,
          linhaCodigo: encontrado.linha_codigo,
          linhaDescricao: encontrado.linha_descricao,
          fallback: false,
          valorRegra,
          produto
        });
        logResolucao({
          produto,
          canal,
          operacao: canal,
          origemLabel: 'Tabela × Linha de Precificação',
          origemCodigo: ORIGEM_TABELA_LINHA,
          fonteNome: (encontrado.tabela_nome || 'Tabela') + ' / ' + (encontrado.linha_descricao || encontrado.linha_codigo || 'Linha'),
          preco: encontrado.preco,
          forma: resultado.formaComercializacao,
          unidade: resultado.unidadeComercial,
          tabelaId,
          tabelaNome: encontrado.tabela_nome,
          linhaId,
          linhaCodigo: encontrado.linha_codigo || encontrado.linha_descricao
        });
        return resultado;
      }
      avisouSemCelula = true;
    } catch (err) {
      console.error('[Comercial] Erro ao consultar tabela×linha:', err.message);
      avisouSemCelula = true;
    }
  }

  // 2) Sem Linha → Tabela × Produto (oficial)
  if (!linhaId && tabelaId && produtoId > 0) {
    try {
      const TabelaPrecoProdutoService = require('../tabelas-preco/TabelaPrecoProdutoService');
      const encontrado = await TabelaPrecoProdutoService.resolverPreco({
        tabelaId,
        produtoId,
        canal
      });
      if (encontrado) {
        const valorRegra = {
          forma_comercializacao: encontrado.forma_comercializacao,
          unidade_comercial: encontrado.unidade_comercial
        };
        const resultado = montarResultado({
          preco: encontrado.preco,
          origem: ORIGEM_TABELA_PRODUTO,
          canal,
          canalId: encontrado.canal_id,
          tabelaId,
          tabelaNome: encontrado.tabela_nome,
          linhaId: null,
          fallback: false,
          valorRegra,
          produto
        });
        logResolucao({
          produto,
          canal,
          operacao: canal,
          origemLabel: 'Tabela × Produto',
          origemCodigo: ORIGEM_TABELA_PRODUTO,
          fonteNome: encontrado.tabela_nome,
          preco: encontrado.preco,
          forma: resultado.formaComercializacao,
          unidade: resultado.unidadeComercial,
          tabelaId,
          tabelaNome: encontrado.tabela_nome,
          linhaId: null,
          linhaCodigo: null
        });
        return resultado;
      }
      avisouSemCelula = true;
    } catch (err) {
      console.error('[Comercial] Erro ao consultar tabela×produto:', err.message);
      avisouSemCelula = true;
    }
  }

  // 3) Preço de Segurança
  const temBase = Number.isFinite(Number(legado)) && Number(legado) > 0;
  const avisoCelula = linhaId ? MSG_SEM_PRECO_LINHA : 'Sem preço do produto na Tabela da operação.';
  const aviso = avisouSemCelula ? avisoCelula : null;
  const erro = !temBase && avisouSemCelula ? avisoCelula : null;

  const resultadoFallback = montarResultado({
    preco: temBase ? legado : Number(legado || 0),
    origem: ORIGEM_LEGADO,
    canal,
    canalId: opts.canal_venda_id != null ? Number(opts.canal_venda_id) : null,
    tabelaId,
    linhaId,
    fallback: true,
    valorRegra: null,
    produto,
    aviso,
    erro
  });
  logResolucao({
    produto,
    canal,
    operacao: canal,
    origemLabel: erro ? 'Sem preço (erro controlado)' : 'Preço de Segurança',
    origemCodigo: ORIGEM_LEGADO,
    fonteNome: null,
    preco: resultadoFallback.preco,
    forma: resultadoFallback.formaComercializacao,
    unidade: resultadoFallback.unidadeComercial,
    tabelaId,
    tabelaNome: null,
    linhaId,
    linhaCodigo: null
  });
  return resultadoFallback;
}

/**
 * Resolução síncrona: cache + fallback legado.
 * Preferir `resolver` (async) sempre que possível.
 * RA-6.4: não usa produto.tabela_preco_id.
 */
function resolverSync(opts = {}) {
  const produto = opts.produto || {};
  const canal = extrairCanal(opts);
  const linhaId = extrairLinhaId(opts, produto);
  const tabelaId = extrairTabelaId(opts, produto);
  const legado = extrairPrecoLegado(opts, produto);

  // RCM-8.0 sync: cache Tabela×Linha; preferir resolver() async para Produto
  if (tabelaId && linhaId) {
    const cachedTl = getCacheTabelaLinha(tabelaId, linhaId, canal);
    if (cachedTl && Number.isFinite(cachedTl.preco)) {
      return montarResultado({
        preco: cachedTl.preco,
        origem: ORIGEM_TABELA_LINHA,
        canal,
        canalId: cachedTl.canal_id,
        linhaId,
        linhaCodigo: cachedTl.linha_codigo,
        linhaDescricao: cachedTl.linha_descricao,
        tabelaId,
        tabelaNome: cachedTl.tabela_nome,
        fallback: false,
        valorRegra: {
          forma_comercializacao: cachedTl.forma_comercializacao,
          unidade_comercial: cachedTl.unidade_comercial
        },
        produto
      });
    }
  }

  const temBase = Number.isFinite(Number(legado)) && Number(legado) > 0;
  const avisou = !!(tabelaId && linhaId);
  return montarResultado({
    preco: temBase ? legado : Number(legado || 0),
    origem: ORIGEM_LEGADO,
    canal,
    canalId: null,
    tabelaId,
    linhaId,
    fallback: true,
    valorRegra: null,
    produto,
    aviso: avisou ? MSG_SEM_PRECO_LINHA : null,
    erro: !temBase && avisou ? MSG_SEM_PRECO_LINHA : null
  });
}

async function aplicarNoProduto(produto, ctx = {}) {
  if (!produto) return produto;
  const resolvido = await resolver({ ...ctx, produto });
  return {
    ...produto,
    preco_venda: resolvido.preco_venda,
    preco_origem: resolvido.origem,
    preco_canal: resolvido.canal,
    preco_tabela_id: resolvido.tabela_preco_id,
    preco_linha_id: resolvido.linha_comercial_id,
    preco_fallback: resolvido.fallback,
    forma_comercializacao: resolvido.forma_comercializacao,
    unidade_comercial: resolvido.unidade_comercial,
    unidade_rotulo: resolvido.unidade_rotulo,
    forma_herdada: resolvido.forma_herdada,
    linhaComercial: resolvido.linhaComercial
  };
}

function aplicarNoProdutoSync(produto, ctx = {}) {
  if (!produto) return produto;
  const resolvido = resolverSync({ ...ctx, produto });
  return {
    ...produto,
    preco_venda: resolvido.preco_venda,
    preco_origem: resolvido.origem,
    preco_canal: resolvido.canal,
    preco_tabela_id: resolvido.tabela_preco_id,
    preco_linha_id: resolvido.linha_comercial_id,
    preco_fallback: resolvido.fallback,
    forma_comercializacao: resolvido.forma_comercializacao,
    unidade_comercial: resolvido.unidade_comercial,
    unidade_rotulo: resolvido.unidade_rotulo,
    forma_herdada: resolvido.forma_herdada,
    linhaComercial: resolvido.linhaComercial
  };
}

function obterPrecoVenda(produtoOuOpts, ctx) {
  if (produtoOuOpts && typeof produtoOuOpts === 'object' && produtoOuOpts.produto && !produtoOuOpts.preco_venda) {
    return resolverSync(produtoOuOpts).preco_venda;
  }
  return resolverSync({ ...(ctx || {}), produto: produtoOuOpts || {} }).preco_venda;
}

async function obterPrecoVendaAsync(produtoOuOpts, ctx) {
  if (produtoOuOpts && typeof produtoOuOpts === 'object' && produtoOuOpts.produto && !produtoOuOpts.preco_venda) {
    return (await resolver(produtoOuOpts)).preco_venda;
  }
  return (await resolver({ ...(ctx || {}), produto: produtoOuOpts || {} })).preco_venda;
}

/**
 * Resolve preços de uma lista de produtos (async, com cache).
 */
async function resolverLista(produtos = [], ctx = {}) {
  const canal = extrairCanal(ctx);
  const idsTabela = [...new Set(
    (produtos || [])
      .map((p) => extrairTabelaId(ctx, p))
      .filter(Boolean)
  )];
  const idsLinha = [...new Set(
    (produtos || [])
      .map((p) => extrairLinhaId(ctx, p))
      .filter(Boolean)
  )];

  if (idsLinha.length) {
    const placeholders = idsLinha.map(() => '?').join(',');
    try {
      const rows = await dbAll(
        `
        SELECT
          v.linha_id,
          v.preco,
          v.canal_venda_id,
          v.forma_comercializacao,
          v.unidade_comercial,
          l.codigo AS linha_codigo,
          l.descricao AS linha_descricao,
          c.codigo AS canal_codigo
        FROM linha_comercial_valores v
        INNER JOIN linhas_comerciais l ON l.id = v.linha_id AND l.ativo = 1
        INNER JOIN canais_venda c ON c.id = v.canal_venda_id
        WHERE v.linha_id IN (${placeholders})
          AND UPPER(c.codigo) = UPPER(?)
        `,
        [...idsLinha, canal]
      );
      for (const row of rows) {
        setCacheLinha(row.linha_id, canal, row.preco, {
          linha_codigo: row.linha_codigo,
          linha_descricao: row.linha_descricao,
          canal_id: row.canal_venda_id,
          forma_comercializacao: row.forma_comercializacao
            ? String(row.forma_comercializacao).toUpperCase()
            : null,
          unidade_comercial: row.unidade_comercial
            ? String(row.unidade_comercial).toUpperCase()
            : null
        });
      }
    } catch (_) { /* noop */ }
  }

  if (idsTabela.length) {
    const placeholders = idsTabela.map(() => '?').join(',');
    const rows = await dbAll(
      `
      SELECT
        v.tabela_preco_id,
        v.preco,
        v.canal_venda_id,
        v.forma_comercializacao,
        v.unidade_comercial,
        t.nome AS tabela_nome,
        c.codigo AS canal_codigo
      FROM tabela_preco_valores v
      INNER JOIN tabelas_preco t ON t.id = v.tabela_preco_id AND t.ativo = 1
      INNER JOIN canais_venda c ON c.id = v.canal_venda_id
      WHERE v.tabela_preco_id IN (${placeholders})
        AND UPPER(c.codigo) = UPPER(?)
      `,
      [...idsTabela, canal]
    );
    for (const row of rows) {
      setCacheTabela(row.tabela_preco_id, canal, row.preco, {
        tabela_nome: row.tabela_nome,
        canal_id: row.canal_venda_id,
        forma_comercializacao: row.forma_comercializacao
          ? String(row.forma_comercializacao).toUpperCase()
          : null,
        unidade_comercial: row.unidade_comercial
          ? String(row.unidade_comercial).toUpperCase()
          : null
      });
    }
  }

  return Promise.all((produtos || []).map((p) => resolver({ ...ctx, produto: p, canal })));
}

function setLogsHabilitados(flag) {
  logsHabilitados = !!flag;
}

/**
 * Diagnóstico legível — Produto / Linha / Tabela / Canal / Preço / Forma / Unidade / Origem.
 */
async function diagnosticar(opts = {}) {
  const produto = opts.produto || {};
  const resolvido = await resolver(opts);
  let origemLabel = 'Fallback (Preço de Segurança)';
  if (resolvido.origem === ORIGEM_TABELA_LINHA) origemLabel = 'Tabela × Linha de Precificação';
  else if (resolvido.origem === ORIGEM_TABELA_PRODUTO) origemLabel = 'Tabela × Produto';

  return {
    produto_id: produto.id != null ? Number(produto.id) : null,
    produto: nomeProduto(produto),
    linha: resolvido.linha_comercial_descricao || resolvido.linha_comercial_codigo || null,
    linha_comercial_id: resolvido.linha_comercial_id,
    tabela: resolvido.tabela_preco_nome || null,
    tabela_preco_id: resolvido.tabela_preco_id,
    canal: resolvido.canal,
    preco: Number(resolvido.preco_venda),
    preco_formatado: Number(resolvido.preco_venda).toFixed(2),
    forma_comercializacao: resolvido.forma_comercializacao,
    unidade_comercial: resolvido.unidade_comercial,
    unidade_rotulo: resolvido.unidade_rotulo,
    forma_herdada: resolvido.forma_herdada,
    origem: origemLabel,
    origem_codigo: resolvido.origem,
    fallback: !!resolvido.fallback,
    aviso: resolvido.aviso || null,
    erro: resolvido.erro || null
  };
}

module.exports = {
  ORIGEM_LEGADO,
  ORIGEM_TABELA,
  ORIGEM_TABELA_LINHA,
  ORIGEM_TABELA_PRODUTO,
  ORIGEM_LINHA,
  CANAL_PADRAO,
  MSG_SEM_PRECO_LINHA,
  resolver,
  resolverSync,
  resolverLista,
  resolverTabelaId,
  aplicarNoProduto,
  aplicarNoProdutoSync,
  obterPrecoVenda,
  obterPrecoVendaAsync,
  aquecerCacheCanal,
  invalidateCache,
  invalidateCacheLinha,
  setLogsHabilitados,
  buscarPrecoTabela,
  buscarPrecoTabelaLinha,
  buscarPrecoLinha,
  diagnosticar
};
