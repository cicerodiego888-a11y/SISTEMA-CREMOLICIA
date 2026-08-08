/**
 * DB fake compartilhado para testes MFE
 */

function criarDbFake() {
  const tables = {
    financial_ledger: [],
    financial_events: [],
    financial_outbox: [],
    financial_dead_letter: [],
    financial_idempotency: [],
    financial_audit: [],
    contas_receber: [],
    financeiro: []
  };
  const seq = {
    financial_ledger: 0,
    financial_events: 0,
    financial_outbox: 0,
    financial_audit: 0,
    financial_dead_letter: 0,
    contas_receber: 0,
    financeiro: 0
  };

  return {
    _tables: tables,
    run(sql, params, cb) {
      const done = typeof params === 'function' ? params : cb;
      const p = typeof params === 'function' ? [] : params || [];
      try {
        if (/CREATE TABLE|CREATE (UNIQUE )?INDEX|ALTER TABLE|UPDATE financial_ledger SET/i.test(sql)
          && !/INSERT INTO/i.test(sql)) {
          return done && done.call({ changes: 0 }, null);
        }
        if (/UPDATE financial_events SET status/i.test(sql)) {
          const row = tables.financial_events.find((r) => r.id === p[1]);
          if (row) row.status = p[0];
          return done && done.call({ changes: row ? 1 : 0 }, null);
        }
        if (/INSERT INTO financial_ledger/i.test(sql)) {
          // MFE-03 column layout
          const key = p.length >= 17 ? p[16] : p[10];
          if (tables.financial_ledger.some((r) => r.idempotency_key === key)) {
            return done && done(new Error('UNIQUE constraint failed'));
          }
          seq.financial_ledger += 1;
          const row = p.length >= 17
            ? {
              id: seq.financial_ledger,
              ledger_id: p[0],
              event_id: p[1],
              evento: p[2],
              origem: p[3],
              tipo: p[4],
              tipo_lancamento: p[5],
              natureza: p[6],
              valor: p[7],
              moeda: p[8],
              conta: p[9],
              conta_financeira: p[10],
              centro_custo: p[11],
              historico: p[12],
              operador: p[13],
              correlation_id: p[14],
              causation_id: p[15],
              idempotency_key: p[16],
              motor: p[17],
              detalhes_json: p[18],
              created_at: new Date().toISOString()
            }
            : {
              id: seq.financial_ledger,
              ledger_id: p[0],
              evento: p[1],
              origem: p[2],
              tipo: p[3],
              valor: p[4],
              conta: p[5],
              conta_financeira: p[5],
              centro_custo: p[6],
              operador: p[7],
              correlation_id: p[8],
              causation_id: p[9],
              idempotency_key: p[10],
              motor: p[11],
              detalhes_json: p[12],
              created_at: new Date().toISOString()
            };
          tables.financial_ledger.push(row);
          return done && done.call({ lastID: row.id, changes: 1 }, null);
        }
        if (/INSERT INTO financial_events/i.test(sql)) {
          if (tables.financial_events.some((r) => r.idempotency_key === p[5])) {
            return done && done(new Error('UNIQUE constraint failed'));
          }
          seq.financial_events += 1;
          tables.financial_events.push({
            id: seq.financial_events,
            type: p[0],
            origem: p[1],
            payload_json: p[2],
            correlation_id: p[3],
            causation_id: p[4],
            idempotency_key: p[5],
            operador_id: p[6],
            status: p[7],
            created_at: new Date().toISOString()
          });
          return done && done.call({ lastID: seq.financial_events, changes: 1 }, null);
        }
        if (/INSERT INTO financial_outbox/i.test(sql)) {
          seq.financial_outbox += 1;
          tables.financial_outbox.push({
            id: seq.financial_outbox,
            event_id: p[0],
            event_type: p[1],
            payload_json: p[2],
            correlation_id: p[3],
            idempotency_key: p[4],
            status: 'PENDING'
          });
          return done && done.call({ lastID: seq.financial_outbox, changes: 1 }, null);
        }
        if (/INSERT INTO financial_dead_letter/i.test(sql)) {
          seq.financial_dead_letter += 1;
          tables.financial_dead_letter.push({
            id: seq.financial_dead_letter,
            event_id: p[0],
            event_type: p[1],
            erro: p[5]
          });
          return done && done.call({ lastID: seq.financial_dead_letter, changes: 1 }, null);
        }
        if (/INSERT OR IGNORE INTO financial_idempotency/i.test(sql)) {
          const exists = tables.financial_idempotency.some((r) => r.idempotency_key === p[0]);
          if (!exists) {
            tables.financial_idempotency.push({ idempotency_key: p[0] });
            return done && done.call({ changes: 1 }, null);
          }
          return done && done.call({ changes: 0 }, null);
        }
        if (/INSERT INTO financial_audit/i.test(sql)) {
          seq.financial_audit += 1;
          tables.financial_audit.push({
            id: seq.financial_audit,
            acao: p[0],
            origem: p[1],
            detalhe_json: p[5]
          });
          return done && done.call({ lastID: seq.financial_audit, changes: 1 }, null);
        }
        if (/INSERT INTO contas_receber/i.test(sql)) {
          seq.contas_receber += 1;
          tables.contas_receber.push({
            id: seq.contas_receber,
            venda_id: p[0],
            cliente_id: p[1],
            numero_parcela: p[2],
            total_parcelas: p[3],
            valor_parcela: p[4],
            valor_restante: p[5],
            data_vencimento: p[6],
            status: 'aberto'
          });
          return done && done.call({ lastID: seq.contas_receber, changes: 1 }, null);
        }
        if (/INSERT INTO financeiro/i.test(sql)) {
          seq.financeiro += 1;
          tables.financeiro.push({
            id: seq.financeiro,
            tipo: p[0],
            descricao: p[1],
            valor: p[2],
            compra_id: p[14],
            numero_parcela: p[12],
            status: p[8]
          });
          return done && done.call({ lastID: seq.financeiro, changes: 1 }, null);
        }
        if (/DELETE FROM financeiro WHERE compra_id/i.test(sql)) {
          tables.financeiro = tables.financeiro.filter((r) => r.compra_id !== p[0]);
          return done && done.call({ changes: 1 }, null);
        }
        return done && done.call({ changes: 0 }, null);
      } catch (e) {
        return done && done(e);
      }
    },
    get(sql, params, cb) {
      if (/FROM financial_events WHERE idempotency_key/i.test(sql)) {
        return cb(null, tables.financial_events.find((r) => r.idempotency_key === params[0]) || null);
      }
      return cb(null, null);
    },
    all(sql, params, cb) {
      const done = typeof params === 'function' ? params : cb;
      const p = typeof params === 'function' ? [] : params || [];
      if (/PRAGMA table_info\(financial_ledger\)/i.test(sql)) {
        return done(null, [
          { name: 'id' },
          { name: 'ledger_id' },
          { name: 'evento' },
          { name: 'origem' },
          { name: 'tipo' },
          { name: 'valor' },
          { name: 'conta' },
          { name: 'centro_custo' },
          { name: 'operador' },
          { name: 'correlation_id' },
          { name: 'causation_id' },
          { name: 'idempotency_key' },
          { name: 'motor' },
          { name: 'detalhes_json' },
          { name: 'created_at' }
        ]);
      }
      if (!/FROM financial_ledger/i.test(sql)) return done(null, []);
      let rows = [...tables.financial_ledger];
      let i = 0;
      if (/ledger_id = \?/i.test(sql)) {
        rows = rows.filter((r) => r.ledger_id === p[i]);
        i += 1;
      }
      if (/event_id = \?/i.test(sql)) {
        rows = rows.filter((r) => r.event_id === p[i]);
        i += 1;
      }
      if (/correlation_id = \?/i.test(sql)) {
        rows = rows.filter((r) => r.correlation_id === p[i]);
        i += 1;
      }
      if (/conta_financeira = \?/i.test(sql)) {
        const c = p[i];
        rows = rows.filter((r) => (r.conta_financeira || r.conta) === c);
      }
      return done(null, rows);
    }
  };
}

module.exports = { criarDbFake };
