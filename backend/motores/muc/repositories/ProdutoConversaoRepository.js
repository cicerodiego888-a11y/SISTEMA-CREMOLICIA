/**
 * RCM-8.9 — Repositório produto_conversoes
 */

function listarPorProduto(db, produtoId) {
  return new Promise((resolve, reject) => {
    db.all(
      `
        SELECT *
        FROM produto_conversoes
        WHERE produto_id = ?
        ORDER BY id ASC
      `,
      [produtoId],
      (err, rows) => (err ? reject(err) : resolve(rows || []))
    );
  });
}

function listarAtivasPorProduto(db, produtoId) {
  return new Promise((resolve, reject) => {
    db.all(
      `
        SELECT *
        FROM produto_conversoes
        WHERE produto_id = ? AND COALESCE(ativo, 1) = 1
        ORDER BY id ASC
      `,
      [produtoId],
      (err, rows) => (err ? reject(err) : resolve(rows || []))
    );
  });
}

function buscarPorId(db, id) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM produto_conversoes WHERE id = ?`,
      [id],
      (err, row) => (err ? reject(err) : resolve(row || null))
    );
  });
}

function inserir(db, produtoId, dados) {
  return new Promise((resolve, reject) => {
    db.run(
      `
        INSERT INTO produto_conversoes (
          produto_id, origem, destino, fator, tipo, ativo, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `,
      [
        produtoId,
        dados.origem,
        dados.destino,
        dados.fator,
        dados.tipo || 'FIXA',
        dados.ativo != null ? (dados.ativo ? 1 : 0) : 1
      ],
      function onRun(err) {
        if (err) return reject(err);
        resolve(this.lastID);
      }
    );
  });
}

function atualizar(db, id, dados) {
  return new Promise((resolve, reject) => {
    db.run(
      `
        UPDATE produto_conversoes SET
          origem = ?,
          destino = ?,
          fator = ?,
          tipo = ?,
          ativo = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [
        dados.origem,
        dados.destino,
        dados.fator,
        dados.tipo || 'FIXA',
        dados.ativo != null ? (dados.ativo ? 1 : 0) : 1,
        id
      ],
      function onRun(err) {
        if (err) return reject(err);
        resolve(this.changes);
      }
    );
  });
}

function excluir(db, id) {
  return new Promise((resolve, reject) => {
    db.run(
      `DELETE FROM produto_conversoes WHERE id = ?`,
      [id],
      function onRun(err) {
        if (err) return reject(err);
        resolve(this.changes);
      }
    );
  });
}

module.exports = {
  listarPorProduto,
  listarAtivasPorProduto,
  buscarPorId,
  inserir,
  atualizar,
  excluir
};
