function inserir(db, row) {
  return new Promise((resolve, reject) => {
    db.run(
      `
      INSERT INTO financial_outbox (
        event_id, event_type, payload_json, correlation_id, idempotency_key,
        status, attempts, created_at
      ) VALUES (?, ?, ?, ?, ?, 'PENDING', 0, CURRENT_TIMESTAMP)
      `,
      [
        row.eventId ?? null,
        row.eventType,
        row.payload ? JSON.stringify(row.payload) : null,
        row.correlationId || null,
        row.idempotencyKey
      ],
      function onInsert(err) {
        if (err) return reject(err);
        resolve({ id: this.lastID, status: 'PENDING' });
      }
    );
  });
}

module.exports = { inserir };
