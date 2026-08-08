function inserir(db, row) {
  return new Promise((resolve, reject) => {
    db.run(
      `
      INSERT INTO financial_dead_letter (
        event_id, event_type, payload_json, correlation_id, idempotency_key, erro, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `,
      [
        row.eventId ?? null,
        row.eventType || null,
        row.payload ? JSON.stringify(row.payload) : (row.payloadJson || null),
        row.correlationId || null,
        row.idempotencyKey || null,
        row.erro || null
      ],
      function onInsert(err) {
        if (err) return reject(err);
        resolve({ id: this.lastID });
      }
    );
  });
}

module.exports = { inserir };
