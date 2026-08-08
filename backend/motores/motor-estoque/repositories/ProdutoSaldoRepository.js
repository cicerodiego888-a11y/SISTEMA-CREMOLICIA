/**
 * MCC-04 — Persistência de saldos (somente quantidade base).
 */

function round3(n) {
  return Math.round(Number(n) * 1000) / 1000;
}

function buscarSaldo(db, produtoId) {
  return new Promise((resolve, reject) => {
    db.get(
      `
        SELECT id, unidade,
               COALESCE(saldo_fiscal, 0) AS saldo_fiscal,
               COALESCE(saldo_nao_fiscal, 0) AS saldo_nao_fiscal,
               COALESCE(estoque_atual, 0) AS estoque_atual,
               COALESCE(controlar_validade, 0) AS controlar_validade
        FROM produtos
        WHERE id = ?
      `,
      [produtoId],
      (err, row) => {
        if (err) return reject(err);
        if (!row) {
          const e = new Error(`Produto ${produtoId} não encontrado.`);
          e.status = 404;
          return reject(e);
        }
        resolve({
          produtoId: Number(row.id),
          unidadeBase: String(row.unidade || 'UN').toUpperCase(),
          saldoFiscal: Number(row.saldo_fiscal || 0),
          saldoNaoFiscal: Number(row.saldo_nao_fiscal || 0),
          estoqueAtual: Number(row.estoque_atual || 0),
          controlarValidade: Number(row.controlar_validade || 0) === 1
        });
      }
    );
  });
}

function aplicarDeltaSaldo(db, {
  produtoId,
  deltaFiscal,
  deltaNaoFiscal
}) {
  const dF = round3(deltaFiscal);
  const dNF = round3(deltaNaoFiscal);

  return new Promise((resolve, reject) => {
    db.run(
      `
        UPDATE produtos
        SET
          saldo_fiscal = COALESCE(saldo_fiscal, 0) + ?,
          saldo_nao_fiscal = COALESCE(saldo_nao_fiscal, 0) + ?,
          estoque_atual = (COALESCE(saldo_fiscal, 0) + ?) + (COALESCE(saldo_nao_fiscal, 0) + ?),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [dF, dNF, dF, dNF, produtoId],
      function onRun(err) {
        if (err) return reject(err);
        if (!this.changes) {
          const e = new Error(`Produto ${produtoId} não encontrado.`);
          e.status = 404;
          return reject(e);
        }
        buscarSaldo(db, produtoId).then(resolve).catch(reject);
      }
    );
  });
}

function definirSaldos(db, { produtoId, saldoFiscal, saldoNaoFiscal }) {
  const sf = round3(saldoFiscal);
  const snf = round3(saldoNaoFiscal);
  const total = round3(sf + snf);

  return new Promise((resolve, reject) => {
    db.run(
      `
        UPDATE produtos
        SET
          saldo_fiscal = ?,
          saldo_nao_fiscal = ?,
          estoque_atual = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [sf, snf, total, produtoId],
      function onRun(err) {
        if (err) return reject(err);
        if (!this.changes) {
          const e = new Error(`Produto ${produtoId} não encontrado.`);
          e.status = 404;
          return reject(e);
        }
        resolve({
          produtoId: Number(produtoId),
          saldoFiscal: sf,
          saldoNaoFiscal: snf,
          estoqueAtual: total
        });
      }
    );
  });
}

module.exports = {
  buscarSaldo,
  aplicarDeltaSaldo,
  definirSaldos,
  round3
};
