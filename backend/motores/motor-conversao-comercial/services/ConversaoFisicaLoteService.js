/**
 * MCC-02.1 — APIs de serviço: Conversão Física versionada
 *
 * Consultar Conversão Ativa
 * Consultar Histórico
 * Criar Nova Versão
 */

const repository = require('../repositories/ConversaoFisicaLoteRepository');
const ConversaoFisicaLote = require('../domain/ConversaoFisicaLote');
const { MotivoVersaoConversao, OrigemConversaoFisica } = require('../domain/enums');
const ConversaoFisicaObrigatoriaError = require('../domain/ConversaoFisicaObrigatoriaError');

function normalizarMotivo(motivo) {
  const m = String(motivo || MotivoVersaoConversao.OUTRO).trim().toUpperCase();
  if (!Object.values(MotivoVersaoConversao).includes(m)) {
    const err = new Error(`Motivo de versão inválido: ${motivo}`);
    err.status = 400;
    err.codigo = 'MCC_MOTIVO_VERSAO_INVALIDO';
    throw err;
  }
  return m;
}

async function consultarConversaoAtiva(db, loteId) {
  const id = Number(loteId);
  if (!Number.isFinite(id)) {
    const err = new Error('lote_id inválido.');
    err.status = 400;
    throw err;
  }
  const ativa = await repository.buscarAtivaPorLoteId(db, id);
  if (!ativa) {
    throw new ConversaoFisicaObrigatoriaError(undefined, { loteId: id });
  }
  return ativa.toJSON();
}

async function consultarHistorico(db, loteId) {
  const id = Number(loteId);
  if (!Number.isFinite(id)) {
    const err = new Error('lote_id inválido.');
    err.status = 400;
    throw err;
  }
  const lista = await repository.listarHistoricoPorLote(db, id);
  return {
    lote_id: id,
    total_versoes: lista.length,
    versoes: lista.map((v) => ({
      id: v.id,
      versao: v.versao,
      ativa: v.ativa ? 1 : 0,
      origem: v.origem,
      usuario_id: v.usuarioId,
      motivo: v.motivo,
      fator: v.fator,
      quantidade_base: v.quantidadeBase,
      quantidade_destino: v.quantidadeDestino,
      unidade_base: v.unidadeBase,
      unidade_destino: v.unidadeDestino,
      substitui_id: v.substituiId,
      created_at: v.createdAt
    }))
  };
}

/**
 * Primeira versão do lote (v1).
 */
async function criarVersaoInicial(db, dados = {}) {
  const entidade = ConversaoFisicaLote.criar({
    produtoId: dados.produtoId ?? dados.produto_id,
    loteId: dados.loteId ?? dados.lote_id,
    unidadeBase: dados.unidadeBase || dados.unidade_base,
    unidadeDestino: dados.unidadeDestino || dados.unidade_destino,
    quantidadeBase: dados.quantidadeBase ?? dados.quantidade_base,
    quantidadeDestino: dados.quantidadeDestino ?? dados.quantidade_destino,
    origem: dados.origem || OrigemConversaoFisica.CALCULADA,
    versao: 1,
    ativa: true,
    motivo: dados.motivo || null,
    usuarioId: dados.usuarioId ?? dados.usuario_id ?? null,
    loteCodigo: dados.loteCodigo || dados.lote_codigo || null
  });
  const salva = await repository.inserir(db, entidade);
  return salva.toJSON();
}

async function criarNovaVersao(db, loteId, body = {}) {
  const motivo = normalizarMotivo(body.motivo);
  const resultado = await repository.criarNovaVersao(db, {
    loteId: Number(loteId),
    quantidadeBase: body.quantidadeBase ?? body.quantidade_base,
    quantidadeDestino: body.quantidadeDestino ?? body.quantidade_destino,
    unidadeBase: body.unidadeBase || body.unidade_base,
    unidadeDestino: body.unidadeDestino || body.unidade_destino,
    origem: body.origem,
    motivo,
    usuarioId: body.usuarioId ?? body.usuario_id ?? null,
    produtoId: body.produtoId ?? body.produto_id
  });

  return {
    versao_anterior: resultado.versaoAnterior.toJSON(),
    versao_nova: resultado.versaoNova.toJSON(),
    auditoria: resultado.auditoria
  };
}

module.exports = {
  consultarConversaoAtiva,
  consultarHistorico,
  criarVersaoInicial,
  criarNovaVersao,
  normalizarMotivo
};
