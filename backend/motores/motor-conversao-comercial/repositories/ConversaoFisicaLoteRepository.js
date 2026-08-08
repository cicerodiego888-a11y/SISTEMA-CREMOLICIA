/**
 * MCC-02.1 — Repository ConversaoFisicaLote (versionado)
 *
 * - buscarPorLoteId → somente versão ATIVA
 * - histórico completo via listarHistoricoPorLote
 * - UPDATE de quantidade/fator BLOQUEADO
 * - DELETE BLOQUEADO
 * - desativar: apenas flag `ativa` ao criar nova versão
 */

const ConversaoFisicaLote = require('../domain/ConversaoFisicaLote');
const ConversaoFisicaImutavelError = require('../domain/ConversaoFisicaImutavelError');

function buscarPorId(db, id) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM conversoes_fisicas_lotes WHERE id = ?`,
      [id],
      (err, row) => (err ? reject(err) : resolve(ConversaoFisicaLote.fromRow(row)))
    );
  });
}

/** Sempre a versão ativa do lote (MCC usa somente esta). */
function buscarPorLoteId(db, loteId) {
  return buscarAtivaPorLoteId(db, loteId);
}

function buscarAtivaPorLoteId(db, loteId) {
  return new Promise((resolve, reject) => {
    db.get(
      `
        SELECT * FROM conversoes_fisicas_lotes
        WHERE lote_id = ?
          AND COALESCE(ativa, 0) = 1
        ORDER BY versao DESC
        LIMIT 1
      `,
      [loteId],
      (err, row) => (err ? reject(err) : resolve(ConversaoFisicaLote.fromRow(row)))
    );
  });
}

function listarHistoricoPorLote(db, loteId) {
  return new Promise((resolve, reject) => {
    db.all(
      `
        SELECT * FROM conversoes_fisicas_lotes
        WHERE lote_id = ?
        ORDER BY versao ASC, id ASC
      `,
      [loteId],
      (err, rows) => (
        err ? reject(err) : resolve((rows || []).map((r) => ConversaoFisicaLote.fromRow(r)))
      )
    );
  });
}

function listarPorProduto(db, produtoId) {
  return new Promise((resolve, reject) => {
    db.all(
      `
        SELECT * FROM conversoes_fisicas_lotes
        WHERE produto_id = ?
        ORDER BY lote_id ASC, versao ASC, id ASC
      `,
      [produtoId],
      (err, rows) => (
        err ? reject(err) : resolve((rows || []).map((r) => ConversaoFisicaLote.fromRow(r)))
      )
    );
  });
}

function proximaVersao(db, loteId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT COALESCE(MAX(versao), 0) AS max_versao FROM conversoes_fisicas_lotes WHERE lote_id = ?`,
      [loteId],
      (err, row) => (err ? reject(err) : resolve(Number(row?.max_versao || 0) + 1))
    );
  });
}

/**
 * Insere versão (default v1 ativa). Não sobrescreve registros existentes.
 */
function inserir(db, entidade) {
  const e = entidade instanceof ConversaoFisicaLote
    ? entidade
    : ConversaoFisicaLote.fromRow(entidade);
  if (e.versao == null || !Number.isFinite(e.versao)) e.versao = 1;
  if (e.ativa == null) e.ativa = true;
  const v = e.validar();
  if (!v.ok) {
    const err = new Error(v.erros.join(' '));
    err.status = 400;
    err.erros = v.erros;
    return Promise.reject(err);
  }

  return new Promise((resolve, reject) => {
    db.run(
      `
        INSERT INTO conversoes_fisicas_lotes (
          produto_id, lote_id, unidade_base, unidade_destino,
          quantidade_base, quantidade_destino, fator, origem,
          versao, ativa, substitui_id, motivo, usuario_id,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `,
      [
        e.produtoId,
        e.loteId,
        e.unidadeBase,
        e.unidadeDestino,
        e.quantidadeBase,
        e.quantidadeDestino,
        e.fator,
        e.origem,
        e.versao,
        e.ativa ? 1 : 0,
        e.substituiId,
        e.motivo,
        e.usuarioId
      ],
      function onInsert(err) {
        if (err) return reject(err);
        resolve(buscarPorId(db, this.lastID));
      }
    );
  });
}

/** Marca versão como inativa (único UPDATE permitido — não altera fator/quantidades). */
function desativarVersao(db, id) {
  return new Promise((resolve, reject) => {
    db.run(
      `
        UPDATE conversoes_fisicas_lotes
        SET ativa = 0, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [id],
      function onUpd(err) {
        if (err) return reject(err);
        resolve({ ok: true, changes: this.changes });
      }
    );
  });
}

/**
 * Cria nova versão a partir da ativa.
 * Desativa a anterior e insere a nova (transação lógica).
 */
async function criarNovaVersao(db, {
  loteId,
  quantidadeBase,
  quantidadeDestino,
  unidadeBase,
  unidadeDestino,
  origem,
  motivo,
  usuarioId,
  produtoId
} = {}) {
  const ativa = await buscarAtivaPorLoteId(db, loteId);
  if (!ativa) {
    const err = new Error(`Nenhuma conversão ativa encontrada para o lote ${loteId}.`);
    err.status = 404;
    err.codigo = 'MCC_CONVERSAO_ATIVA_NAO_ENCONTRADA';
    throw err;
  }

  const versao = await proximaVersao(db, loteId);
  const nova = ConversaoFisicaLote.criar({
    produtoId: produtoId != null ? produtoId : ativa.produtoId,
    loteId: ativa.loteId,
    unidadeBase: unidadeBase || ativa.unidadeBase,
    unidadeDestino: unidadeDestino || ativa.unidadeDestino,
    quantidadeBase,
    quantidadeDestino,
    origem: origem || ativa.origem,
    versao,
    ativa: true,
    substituiId: ativa.id,
    motivo,
    usuarioId,
    loteCodigo: ativa.loteCodigo
  });

  await desativarVersao(db, ativa.id);
  ativa.ativa = false;
  const salva = await inserir(db, nova);

  return {
    versaoAnterior: ativa,
    versaoNova: salva,
    auditoria: {
      loteId: ativa.loteId,
      versaoAnterior: ativa.versao,
      versaoAnteriorId: ativa.id,
      versaoNova: salva.versao,
      versaoNovaId: salva.id,
      motivo: salva.motivo,
      usuarioId: salva.usuarioId,
      fatorAnterior: ativa.fator,
      fatorNovo: salva.fator,
      timestamp: new Date().toISOString(),
      persistido: true
    }
  };
}

/** BLOQUEADO — versões históricas são imutáveis. */
function atualizar(db, id) {
  return Promise.reject(new ConversaoFisicaImutavelError(undefined, { conversaoId: id }));
}

/** BLOQUEADO — não permitir exclusão de versões. */
function excluir(db, id) {
  return Promise.reject(
    new ConversaoFisicaImutavelError(
      'Não é permitido excluir versões de Conversão Física. Histórico é permanente.',
      { conversaoId: id }
    )
  );
}

module.exports = {
  buscarPorId,
  buscarPorLoteId,
  buscarAtivaPorLoteId,
  listarHistoricoPorLote,
  listarPorProduto,
  proximaVersao,
  inserir,
  desativarVersao,
  criarNovaVersao,
  atualizar,
  excluir
};
