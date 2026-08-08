const FinancialEvent = require('../domain/FinancialEvent');

function inserir(db, evento) {
  const ev = evento instanceof FinancialEvent ? evento : FinancialEvent.criar(evento);
  ev.assertValid();

  return new Promise((resolve, reject) => {
    db.run(
      `
      INSERT INTO financial_events (
        type, origem, payload_json, correlation_id, causation_id,
        idempotency_key, operador_id, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `,
      [
        ev.type,
        ev.origem,
        JSON.stringify(ev.payload || {}),
        ev.correlationId,
        ev.causationId,
        ev.idempotencyKey,
        ev.operadorId,
        ev.status || 'RECEIVED'
      ],
      function onInsert(err) {
        if (err) {
          if (String(err.message || '').includes('UNIQUE')) {
            return reject(Object.assign(new Error('idempotency_key duplicada no event store'), {
              code: 'MFE_EVENT_DUP',
              status: 409,
              cause: err
            }));
          }
          return reject(err);
        }
        ev.id = this.lastID;
        ev.timestamp = new Date().toISOString();
        resolve(ev);
      }
    );
  });
}

function obterPorIdempotencyKey(db, key) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM financial_events WHERE idempotency_key = ? LIMIT 1`,
      [key],
      (err, row) => {
        if (err) return reject(err);
        if (!row) return resolve(null);
        resolve(
          FinancialEvent.criar({
            id: row.id,
            type: row.type,
            origem: row.origem,
            payload: row.payload_json ? JSON.parse(row.payload_json) : {},
            correlationId: row.correlation_id,
            causationId: row.causation_id,
            idempotencyKey: row.idempotency_key,
            operadorId: row.operador_id,
            status: row.status,
            timestamp: row.created_at
          })
        );
      }
    );
  });
}

/**
 * Atualiza apenas status operacional (payload permanece imutável).
 */
function atualizarStatus(db, eventId, status) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE financial_events SET status = ? WHERE id = ?`,
      [status, eventId],
      function onUpdate(err) {
        if (err) return reject(err);
        resolve({ id: eventId, status, changes: this.changes });
      }
    );
  });
}

module.exports = { inserir, obterPorIdempotencyKey, atualizarStatus };
