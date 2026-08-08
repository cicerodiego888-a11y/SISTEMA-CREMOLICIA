/**
 * UC-01.1 — Validador + auditorias de consistência
 */

const { TIPOS_LISTA, TIPOS_UNIDADE_COMERCIAL } = require('../constants');
const {
  flag01,
  parseCanais,
  canaisFromLegacyFlags,
  syncLegacyFlagsFromCanais
} = require('../dto/UnidadeComercialDTO');

function validarPayloadUnidadeComercial(payload = {}, { unidadeBaseProduto = '' } = {}) {
  const erros = [];
  const descricao = String(payload.descricao || '').trim();
  const tipo = String(payload.tipo || '').trim().toUpperCase();
  const unidade_comercial = String(payload.unidade_comercial || '').trim().toUpperCase();
  const unidade_base = String(payload.unidade_base || unidadeBaseProduto || '').trim().toUpperCase();
  const quantidade = Number(payload.quantidade);
  const prioridade = payload.prioridade != null && payload.prioridade !== ''
    ? parseInt(payload.prioridade, 10)
    : 1;

  if (!descricao) erros.push('Informe a descrição da unidade comercial.');
  if (!TIPOS_LISTA.includes(tipo)) {
    erros.push(`Tipo inválido. Use: ${TIPOS_LISTA.join(', ')}.`);
  }
  if (!unidade_comercial) erros.push('Informe a unidade comercial (ex.: CX, UN, L).');
  if (!unidade_base) erros.push('Informe a unidade base de estoque.');
  if (!Number.isFinite(quantidade) || quantidade <= 0) {
    erros.push('Quantidade deve ser um número maior que zero.');
  }
  if (!Number.isFinite(prioridade) || prioridade < 1) {
    erros.push('Prioridade deve ser um inteiro ≥ 1.');
  }

  // UC-01.1: Unidade Comercial = Base somente quando Tipo = PADRAO
  if (
    tipo
    && tipo !== TIPOS_UNIDADE_COMERCIAL.PADRAO
    && unidade_comercial
    && unidade_base
    && unidade_comercial === unidade_base
  ) {
    erros.push('Unidade Comercial não pode ser igual à Unidade Base quando o Tipo não é PADRÃO.');
  }

  if (tipo === TIPOS_UNIDADE_COMERCIAL.PADRAO && Number.isFinite(quantidade) && quantidade !== 1) {
    erros.push('Unidade do tipo PADRÃO deve ter quantidade = 1.');
  }

  const canais = payload.canais_comercializacao != null
    ? parseCanais(payload.canais_comercializacao)
    : canaisFromLegacyFlags(payload);

  const legado = syncLegacyFlagsFromCanais(canais);

  if (erros.length) {
    return { ok: false, erros };
  }

  return {
    ok: true,
    dados: {
      descricao,
      tipo,
      unidade_comercial,
      quantidade,
      unidade_base,
      prioridade,
      unidade_padrao: flag01(payload.unidade_padrao, 0),
      conversao_por_lote: flag01(payload.conversao_por_lote, 0),
      canais_comercializacao: canais,
      canais_json: JSON.stringify(canais),
      permite_compra: legado.permite_compra,
      permite_venda: legado.permite_venda,
      permite_pdv: legado.permite_pdv,
      ordem: payload.ordem != null && payload.ordem !== '' ? parseInt(payload.ordem, 10) || 0 : undefined,
      ativo: flag01(payload.ativo, 1)
    }
  };
}

/**
 * Auditorias de consistência no escopo do produto (após normalizar o payload).
 * @param {object[]} existentes — linhas atuais do produto
 * @param {object} candidato — dados normalizados
 * @param {number|null} excluindoId — id em edição
 */
function auditarConsistenciaProduto(existentes = [], candidato = {}, excluindoId = null) {
  const erros = [];
  const outros = (existentes || []).filter((u) => Number(u.id) !== Number(excluindoId || 0));

  // Unidade padrão: o service limpa a anterior automaticamente (somente uma permanece).
  // Aqui validamos prioridade única e quantidade.

  const prio = Number(candidato.prioridade);
  const mesmaPrio = outros.find((u) => Number(u.prioridade) === prio);
  if (mesmaPrio) {
    erros.push(`Prioridade ${prio} já utilizada por "${mesmaPrio.descricao}". Prioridades devem ser únicas no produto.`);
  }

  if (!(Number(candidato.quantidade) > 0)) {
    erros.push('Quantidade deve ser maior que zero.');
  }

  return { ok: erros.length === 0, erros };
}

module.exports = {
  validarPayloadUnidadeComercial,
  auditarConsistenciaProduto,
  flag01
};
