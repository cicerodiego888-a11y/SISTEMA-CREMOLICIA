function inserir(db, row) {
  return new Promise((resolve, reject) => {
    db.run(
      `
      INSERT INTO financial_audit (
        acao, origem, operador_id, correlation_id, causation_id, detalhe_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `,
      [
        row.acao,
        row.origem || null,
        row.operadorId ?? null,
        row.correlationId || null,
        row.causationId || null,
        row.detalhe ? JSON.stringify(row.detalhe) : null
      ],
      function onInsert(err) {
        if (err) return reject(err);
        resolve({ id: this.lastID });
      }
    );
  });
}

module.exports = { inserir };
