/**
 * Helpers de Forma de Comercialização (RCM-04.3)
 */

const FORMAS = Object.freeze({
  UNIDADE: 'UNIDADE',
  PESO: 'PESO',
  VOLUME: 'VOLUME',
  CASQUINHA: 'CASQUINHA',
  KIT: 'KIT',
  PERSONALIZADA: 'PERSONALIZADA'
});

const FORMAS_VALIDAS = new Set(Object.values(FORMAS));

function normalizarForma(valor) {
  const forma = String(valor || '').trim().toUpperCase();
  return FORMAS_VALIDAS.has(forma) ? forma : FORMAS.UNIDADE;
}

/**
 * Infere forma a partir de flags/campos legados (produtos antigos).
 */
function inferirFormaComercializacao(produto = {}) {
  const gravada = String(produto.forma_comercializacao || '').trim().toUpperCase();
  if (FORMAS_VALIDAS.has(gravada) && gravada !== FORMAS.UNIDADE) {
    return gravada;
  }
  if (FORMAS_VALIDAS.has(gravada) && gravada === FORMAS.UNIDADE) {
    // pode ser default; checar fracionado
  }

  const fracionado = Number(produto.produto_fracionado ?? produto.vendido_por_peso ?? 0) === 1;
  if (!fracionado) {
    return FORMAS_VALIDAS.has(gravada) ? gravada : FORMAS.UNIDADE;
  }

  const unidade = String(produto.unidade || '').trim().toLowerCase();
  if (['l', 'ml', 'lt', 'litro', 'litros'].includes(unidade)) {
    return FORMAS.VOLUME;
  }
  return FORMAS.PESO;
}

/**
 * Deriva flags legadas (produto_fracionado / vendido_por_peso) a partir da forma.
 */
function flagsLegadasDaForma(forma) {
  const f = normalizarForma(forma);
  const fracionado = f === FORMAS.PESO || f === FORMAS.VOLUME ? 1 : 0;
  return {
    produto_fracionado: fracionado,
    vendido_por_peso: fracionado
  };
}

/**
 * Normaliza e valida payload de forma para persistência.
 * @throws {Error} com statusCode 400
 */
function normalizarPayloadForma(body = {}) {
  const forma = normalizarForma(body.forma_comercializacao);
  const flags = flagsLegadasDaForma(forma);

  const resultado = {
    forma_comercializacao: forma,
    unidade_venda: null,
    quantidade_bolas: 0,
    peso_medio_bola: 0,
    bolas_min: null,
    bolas_max: null,
    forma_personalizada_nome: null,
    forma_personalizada_unidade: null,
    ...flags
  };

  if (forma === FORMAS.PESO || forma === FORMAS.VOLUME) {
    const uv = String(body.unidade_venda || '').trim().toUpperCase();
    if (!uv) {
      const err = new Error('Unidade de Venda é obrigatória para forma Peso/Volume');
      err.statusCode = 400;
      throw err;
    }
    resultado.unidade_venda = uv;
  }

  if (forma === FORMAS.CASQUINHA) {
    const minRaw = body.bolas_min != null && body.bolas_min !== ''
      ? Number(body.bolas_min)
      : Number(body.quantidade_bolas);
    const maxRaw = body.bolas_max != null && body.bolas_max !== ''
      ? Number(body.bolas_max)
      : Number(body.quantidade_bolas);

    if (!Number.isFinite(minRaw) || minRaw < 1) {
      const err = new Error('Quantidade mínima de bolas é obrigatória (mínimo 1)');
      err.statusCode = 400;
      throw err;
    }
    if (!Number.isFinite(maxRaw) || maxRaw < minRaw) {
      const err = new Error('Quantidade máxima de bolas deve ser ≥ mínima');
      err.statusCode = 400;
      throw err;
    }

    const peso = Number(body.peso_medio_bola);
    resultado.bolas_min = Math.round(minRaw);
    resultado.bolas_max = Math.round(maxRaw);
    // Compat: quantidade_bolas = máximo (padrão legado)
    resultado.quantidade_bolas = resultado.bolas_max;
    resultado.peso_medio_bola = Number.isFinite(peso) && peso > 0 ? peso : 0;
  }

  if (forma === FORMAS.PERSONALIZADA) {
    const nome = String(body.forma_personalizada_nome || '').trim();
    const unidade = String(body.forma_personalizada_unidade || '').trim();
    if (!nome) {
      const err = new Error('Nome da Forma é obrigatório para forma Personalizada');
      err.statusCode = 400;
      throw err;
    }
    if (!unidade) {
      const err = new Error('Unidade é obrigatória para forma Personalizada');
      err.statusCode = 400;
      throw err;
    }
    resultado.forma_personalizada_nome = nome;
    resultado.forma_personalizada_unidade = unidade;
  }

  return resultado;
}

/**
 * Infere Forma a partir da Unidade Comercial (RA-6.6).
 * Forma permanece no schema por CASQUINHA/KIT/PERSONALIZADA; na grade oficial a Unidade é o SSOT.
 */
function inferirFormaDaUnidade(unidade, produto = {}) {
  const u = String(unidade || '').trim().toUpperCase();
  if (['KG', 'G', 'KILO', 'KILOS', 'GRAMA', 'GRAMAS'].includes(u)) return FORMAS.PESO;
  if (['L', 'LT', 'LITRO', 'LITROS', 'ML'].includes(u)) return FORMAS.VOLUME;
  return inferirFormaComercializacao(produto) || FORMAS.UNIDADE;
}

/**
 * Resolve forma + unidade efetiva (RA-6.6).
 *
 * Prioridade da Unidade Comercial:
 *   1) tabela_preco_valores.unidade_comercial (célula Tabela × Linha)
 *   2) Unidade Base do Produto (produto.unidade) — quando NULL na tabela
 *
 * Forma: se gravada na célula, usa; senão deriva da unidade (ou do produto).
 * CASQUINHA/KIT/PERSONALIZADA continuam sendo responsabilidade da Forma (não redundante com Unidade).
 *
 * @param {Object} [valorTabela] - row de tabela_preco_valores
 * @param {Object} [produto]
 * @returns {{ formaComercializacao: string, unidadeComercial: string|null, herdado: boolean }}
 */
function resolverFormaEfetiva(valorTabela = null, produto = {}) {
  const formaTabela = String(valorTabela?.forma_comercializacao || '').trim().toUpperCase();
  const unidadeTabela = String(valorTabela?.unidade_comercial || '').trim().toUpperCase() || null;
  const unidadeBase = String(produto.unidade || '').trim().toUpperCase() || null;

  // RA-6.6 — Unidade Comercial da Tabela tem prioridade absoluta
  if (unidadeTabela) {
    const forma = FORMAS_VALIDAS.has(formaTabela)
      ? formaTabela
      : inferirFormaDaUnidade(unidadeTabela, produto);
    return {
      formaComercializacao: forma,
      unidadeComercial: unidadeTabela,
      herdado: false
    };
  }

  // Unidade não configurada na Tabela → Unidade Base do Produto (RA-6.6)
  if (FORMAS_VALIDAS.has(formaTabela)) {
    return {
      formaComercializacao: formaTabela,
      unidadeComercial: unidadeBase || unidadePadraoDaForma(formaTabela, produto),
      herdado: true
    };
  }

  const formaProduto = inferirFormaComercializacao(produto);

  return {
    formaComercializacao: formaProduto,
    // Prioridade: Unidade Base de Estoque → demais campos legados → padrão da forma
    unidadeComercial:
      unidadeBase
      || String(produto.unidade_venda || produto.unidade_comercial || '').trim().toUpperCase()
      || unidadePadraoDaForma(formaProduto, produto),
    herdado: true
  };
}

function unidadePadraoDaForma(forma, produto = {}) {
  const f = normalizarForma(forma);
  if (f === FORMAS.PESO) return 'KG';
  if (f === FORMAS.VOLUME) return 'LITRO';
  if (f === FORMAS.KIT || f === FORMAS.CASQUINHA || f === FORMAS.UNIDADE) {
    return String(produto.unidade || 'UN').trim().toUpperCase() || 'UN';
  }
  return String(produto.unidade_venda || produto.unidade || '').trim().toUpperCase() || null;
}

function rotuloUnidadeComercial(unidade) {
  const u = String(unidade || '').trim().toUpperCase();
  if (!u) return '';
  if (u === 'KG' || u === 'KILO' || u === 'KILOS') return 'Kg';
  if (u === 'L' || u === 'LT' || u === 'LITRO' || u === 'LITROS') return 'Litro';
  return u;
}

module.exports = {
  FORMAS,
  FORMAS_VALIDAS,
  normalizarForma,
  inferirFormaComercializacao,
  inferirFormaDaUnidade,
  flagsLegadasDaForma,
  normalizarPayloadForma,
  resolverFormaEfetiva,
  unidadePadraoDaForma,
  rotuloUnidadeComercial
};
