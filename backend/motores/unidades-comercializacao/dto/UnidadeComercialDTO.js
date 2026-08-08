/**
 * UC-01.1 — DTO / normalização de Unidade de Comercialização
 */

const {
  CANAIS_LISTA,
  CANAIS_DEFAULT,
  TIPOS_META
} = require('../constants');

function flag01(v, defaultVal = 0) {
  if (v === undefined || v === null || v === '') return defaultVal;
  return v === true || v === 1 || v === '1' || v === 'on' ? 1 : 0;
}

function parseCanais(raw, fallback = null) {
  let base = { ...CANAIS_DEFAULT };
  if (fallback && typeof fallback === 'object') {
    base = { ...base, ...fallback };
  }

  if (raw == null || raw === '') return base;

  let obj = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch (e) {
      return base;
    }
  }
  if (!obj || typeof obj !== 'object') return base;

  const out = { ...base };
  CANAIS_LISTA.forEach((k) => {
    if (obj[k] !== undefined) out[k] = flag01(obj[k], 0);
  });
  return out;
}

function canaisFromLegacyFlags(payload = {}) {
  const compra = flag01(payload.permite_compra, 1);
  const venda = flag01(payload.permite_venda, 1);
  const pdv = flag01(payload.permite_pdv, 1);
  return {
    compra,
    venda_erp: venda,
    venda_atacado: venda,
    venda_varejo: venda,
    pdv,
    nfce: pdv,
    nfe: venda,
    comercial: venda,
    orcamento: venda
  };
}

function syncLegacyFlagsFromCanais(canais) {
  return {
    permite_compra: flag01(canais.compra, 0),
    permite_venda: flag01(canais.venda_erp, 0) || flag01(canais.venda_atacado, 0) || flag01(canais.venda_varejo, 0) ? 1 : 0,
    permite_pdv: flag01(canais.pdv, 0)
  };
}

function toUnidadeComercialDTO(row) {
  if (!row) return null;
  const canais = parseCanais(
    row.canais_comercializacao,
    canaisFromLegacyFlags(row)
  );
  const tipo = String(row.tipo || '').toUpperCase();
  const meta = TIPOS_META[tipo] || { label: tipo, icone: '•', tooltip: '' };

  return {
    id: row.id,
    produto_id: row.produto_id,
    descricao: row.descricao,
    tipo,
    tipo_label: meta.label,
    tipo_icone: meta.icone,
    tipo_tooltip: meta.tooltip,
    unidade_comercial: row.unidade_comercial,
    quantidade: Number(row.quantidade),
    unidade_base: row.unidade_base,
    prioridade: Number(row.prioridade != null ? row.prioridade : 1),
    unidade_padrao: Number(row.unidade_padrao || 0) === 1 ? 1 : 0,
    conversao_por_lote: Number(row.conversao_por_lote || 0) === 1 ? 1 : 0,
    canais_comercializacao: canais,
    // Compat UC-01
    permite_compra: Number(row.permite_compra) === 1 ? 1 : flag01(canais.compra, 0),
    permite_venda: Number(row.permite_venda) === 1 ? 1 : syncLegacyFlagsFromCanais(canais).permite_venda,
    permite_pdv: Number(row.permite_pdv) === 1 ? 1 : flag01(canais.pdv, 0),
    ordem: Number(row.ordem || 0),
    ativo: Number(row.ativo) === 1 ? 1 : 0,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null
  };
}

module.exports = {
  flag01,
  parseCanais,
  canaisFromLegacyFlags,
  syncLegacyFlagsFromCanais,
  toUnidadeComercialDTO
};
