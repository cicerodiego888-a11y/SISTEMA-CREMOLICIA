function registrar(db, key, meta = {}) {
  return new Promise((resolve, reject) => {
    db.run(
      `
      INSERT OR IGNORE INTO financial_idempotency (
        idempotency_key, event_type, correlation_id, result_ref, created_at
      ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      `,
      [key, meta.eventType || null, meta.correlationId || null, meta.resultRef || null],
      function onInsert(err) {
        if (err) return reject(err);
        resolve({ idempotencyKey: key, inserted: this.changes > 0 });
      }
    );
  });
}

function existe(db, key) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT idempotency_key FROM financial_idempotency WHERE idempotency_key = ?`,
      [key],
      (err, row) => {
        if (err) return reject(err);
        resolve(Boolean(row));
      }
    );
  });
}

module.exports = { registrar, existe };
