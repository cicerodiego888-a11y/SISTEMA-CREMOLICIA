/**
 * MFE-02/03 — Handler base
 * MFE-03: sempre propõe lançamentos via EventToLedgerMapper (auto)
 */

const { proporLancamentosDoEvento } = require('../../ledger/EventToLedgerMapper');

class BaseFinancialEventHandler {
  constructor(eventType) {
    this.eventType = eventType;
    this.nome = this.constructor.name;
  }

  async handle(evento, ctx = {}) {
    void ctx;
    return {
      ok: true,
      lancamentos: this.proporLancamentos(evento)
    };
  }

  proporLancamentos(evento) {
    return proporLancamentosDoEvento(evento);
  }
}

module.exports = BaseFinancialEventHandler;
