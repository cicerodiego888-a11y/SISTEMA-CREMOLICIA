/**
 * MCC-04 — Auditoria de movimentações de estoque (somente quantidade base).
 */

const MovimentacaoEstoque = require('../domain/MovimentacaoEstoque');
const { MOTOR_ESTOQUE_NOME } = require('../domain/enums');

function inserirMovimentacao(db, mov) {
  const m = mov instanceof MovimentacaoEstoque ? mov : MovimentacaoEstoque.criar(mov);
  const v = m.validar();
  if (!v.ok) {
    const err = new Error(v.erros.join(' '));
    err.status = 400;
    err.erros = v.erros;
    return Promise.reject(err);
  }

  return new Promise((resolve, reject) => {
    db.run(
      `
        INSERT INTO estoque_movimentacoes (
          produto_id, quantidade_base, quantidade_fiscal, quantidade_nao_fiscal,
          operacao, origem, lote_id,
          referencia_tipo, referencia_id,
          saldo_antes, saldo_depois,
          usuario_id, motivo, motor, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `,
      [
        m.produtoId,
        m.quantidadeBase,
        m.quantidadeFiscal,
        m.quantidadeNaoFiscal,
        m.operacao,
        m.origem,
        m.loteId,
        m.referenciaTipo,
        m.referenciaId,
        m.saldoAntes,
        m.saldoDepois,
        m.usuarioId,
        m.motivo,
        m.motor || MOTOR_ESTOQUE_NOME
      ],
      function onInsert(err) {
        if (err) return reject(err);
        m.id = this.lastID;
        m.createdAt = new Date().toISOString();
        resolve(m);
      }
    );
  });
}

function listarPorProduto(db, produtoId, { limit = 50 } = {}) {
  return new Promise((resolve, reject) => {
    db.all(
      `
        SELECT * FROM estoque_movimentacoes
        WHERE produto_id = ?
        ORDER BY id DESC
        LIMIT ?
      `,
      [produtoId, limit],
      (err, rows) => {
        if (err) return reject(err);
        resolve((rows || []).map((r) => MovimentacaoEstoque.criar(r)));
      }
    );
  });
}

module.exports = {
  inserirMovimentacao,
  listarPorProduto
};
