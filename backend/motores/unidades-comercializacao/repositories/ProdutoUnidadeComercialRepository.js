/**
 * UC-01 / UC-01.1 — Repository ProdutoUnidadeComercial
 */

function listarPorProduto(db, produtoId) {
  return new Promise((resolve, reject) => {
    db.all(
      `
        SELECT *
        FROM produto_unidades_comercializacao
        WHERE produto_id = ?
        ORDER BY
          COALESCE(prioridade, 9999) ASC,
          COALESCE(unidade_padrao, 0) DESC,
          ordem ASC,
          id ASC
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
        FROM produto_unidades_comercializacao
        WHERE produto_id = ?
          AND COALESCE(ativo, 1) = 1
        ORDER BY
          COALESCE(prioridade, 9999) ASC,
          COALESCE(unidade_padrao, 0) DESC,
          ordem ASC,
          id ASC
      `,
      [produtoId],
      (err, rows) => (err ? reject(err) : resolve(rows || []))
    );
  });
}

function buscarPorId(db, id) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM produto_unidades_comercializacao WHERE id = ?`,
      [id],
      (err, row) => (err ? reject(err) : resolve(row || null))
    );
  });
}

function inserir(db, produtoId, dados) {
  return new Promise((resolve, reject) => {
    db.run(
      `
        INSERT INTO produto_unidades_comercializacao (
          produto_id, descricao, tipo, unidade_comercial, quantidade, unidade_base,
          permite_compra, permite_venda, permite_pdv,
          prioridade, unidade_padrao, conversao_por_lote, canais_comercializacao,
          ordem, ativo,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `,
      [
        produtoId,
        dados.descricao,
        dados.tipo,
        dados.unidade_comercial,
        dados.quantidade,
        dados.unidade_base,
        dados.permite_compra,
        dados.permite_venda,
        dados.permite_pdv,
        dados.prioridade,
        dados.unidade_padrao,
        dados.conversao_por_lote,
        dados.canais_json,
        dados.ordem,
        dados.ativo
      ],
      function (err) {
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
        UPDATE produto_unidades_comercializacao SET
          descricao = ?,
          tipo = ?,
          unidade_comercial = ?,
          quantidade = ?,
          unidade_base = ?,
          permite_compra = ?,
          permite_venda = ?,
          permite_pdv = ?,
          prioridade = ?,
          unidade_padrao = ?,
          conversao_por_lote = ?,
          canais_comercializacao = ?,
          ordem = ?,
          ativo = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [
        dados.descricao,
        dados.tipo,
        dados.unidade_comercial,
        dados.quantidade,
        dados.unidade_base,
        dados.permite_compra,
        dados.permite_venda,
        dados.permite_pdv,
        dados.prioridade,
        dados.unidade_padrao,
        dados.conversao_por_lote,
        dados.canais_json,
        dados.ordem,
        dados.ativo,
        id
      ],
      function (err) {
        if (err) return reject(err);
        resolve(this.changes || 0);
      }
    );
  });
}

function remover(db, id) {
  return new Promise((resolve, reject) => {
    db.run(
      `DELETE FROM produto_unidades_comercializacao WHERE id = ?`,
      [id],
      function (err) {
        if (err) return reject(err);
        resolve(this.changes || 0);
      }
    );
  });
}

function limparPadraoDoProduto(db, produtoId, excetoId = null) {
  return new Promise((resolve, reject) => {
    const params = [produtoId];
    let sql = `
      UPDATE produto_unidades_comercializacao
      SET unidade_padrao = 0, updated_at = CURRENT_TIMESTAMP
      WHERE produto_id = ?
    `;
    if (excetoId) {
      sql += ` AND id != ?`;
      params.push(excetoId);
    }
    db.run(sql, params, (err) => (err ? reject(err) : resolve()));
  });
}

function proximaOrdem(db, produtoId) {
  return new Promise((resolve, reject) => {
    db.get(
      `
        SELECT COALESCE(MAX(ordem), -1) + 1 AS proxima
        FROM produto_unidades_comercializacao
        WHERE produto_id = ?
      `,
      [produtoId],
      (err, row) => (err ? reject(err) : resolve(Number(row?.proxima || 0)))
    );
  });
}

function proximaPrioridade(db, produtoId) {
  return new Promise((resolve, reject) => {
    db.get(
      `
        SELECT COALESCE(MAX(prioridade), 0) + 1 AS proxima
        FROM produto_unidades_comercializacao
        WHERE produto_id = ?
      `,
      [produtoId],
      (err, row) => (err ? reject(err) : resolve(Number(row?.proxima || 1)))
    );
  });
}

module.exports = {
  listarPorProduto,
  listarAtivasPorProduto,
  buscarPorId,
  inserir,
  atualizar,
  remover,
  limparPadraoDoProduto,
  proximaOrdem,
  proximaPrioridade
};
