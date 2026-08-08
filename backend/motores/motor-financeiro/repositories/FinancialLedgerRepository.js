/**
 * MFE-03 — Persistência do Ledger Operacional
 */

const FinancialLedgerEntry = require('../domain/FinancialLedgerEntry');
const { LedgerImmutableError } = require('../domain/errors');

function inserir(db, entry) {
  const e = entry instanceof FinancialLedgerEntry ? entry : FinancialLedgerEntry.criar(entry);
  e.assertValid();

  return new Promise((resolve, reject) => {
    db.run(
      `
      INSERT INTO financial_ledger (
        ledger_id, event_id, evento, origem, tipo, tipo_lancamento, natureza,
        valor, moeda, conta, conta_financeira, centro_custo, historico,
        operador, correlation_id, causation_id, idempotency_key,
        motor, detalhes_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `,
      [
        e.ledgerId,
        e.eventId,
        e.evento,
        e.origem,
        e.natureza || e.tipo,
        e.tipoLancamento,
        e.natureza,
        e.valor,
        e.moeda,
        e.contaFinanceira,
        e.contaFinanceira,
        e.centroCusto,
        e.historico,
        e.operador,
        e.correlationId,
        e.causationId,
        e.idempotencyKey,
        e.motor,
        e.detalhes ? JSON.stringify(e.detalhes) : null
      ],
      function onInsert(err) {
        if (err) {
          if (String(err.message || '').includes('UNIQUE')) {
            return reject(Object.assign(new Error('idempotency_key duplicada no ledger'), {
              code: 'MFE_LEDGER_DUP',
              status: 409,
              cause: err
            }));
          }
          return reject(err);
        }
        e.id = this.lastID;
        e.createdAt = new Date().toISOString();
        resolve(e);
      }
    );
  });
}

function listar(db, filtros = {}) {
  const where = [];
  const params = [];
  if (filtros.ledgerId) {
    where.push('ledger_id = ?');
    params.push(filtros.ledgerId);
  }
  if (filtros.eventId != null) {
    where.push('event_id = ?');
    params.push(filtros.eventId);
  }
  if (filtros.correlationId) {
    where.push('correlation_id = ?');
    params.push(filtros.correlationId);
  }
  if (filtros.contaFinanceira || filtros.conta) {
    where.push('(conta_financeira = ? OR conta = ?)');
    const c = filtros.contaFinanceira || filtros.conta;
    params.push(c, c);
  }
  const sql = `
    SELECT * FROM financial_ledger
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY id ASC
    LIMIT ?
  `;
  params.push(Number(filtros.limit || 100));

  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve((rows || []).map(mapRow));
    });
  });
}

function mapRow(row) {
  return FinancialLedgerEntry.criar({
    id: row.id,
    ledgerId: row.ledger_id,
    eventId: row.event_id,
    evento: row.evento,
    origem: row.origem,
    tipo: row.natureza || row.tipo,
    tipoLancamento: row.tipo_lancamento,
    natureza: row.natureza || row.tipo,
    valor: row.valor,
    moeda: row.moeda,
    conta: row.conta_financeira || row.conta,
    contaFinanceira: row.conta_financeira || row.conta,
    centroCusto: row.centro_custo,
    historico: row.historico,
    operador: row.operador,
    correlationId: row.correlation_id,
    causationId: row.causation_id,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
    motor: row.motor,
    detalhes: row.detalhes_json ? JSON.parse(row.detalhes_json) : null
  });
}

function updateProibido() {
  return Promise.reject(new LedgerImmutableError());
}

function deleteProibido() {
  return Promise.reject(new LedgerImmutableError());
}

module.exports = {
  inserir,
  listar,
  updateProibido,
  deleteProibido,
  mapRow
};
