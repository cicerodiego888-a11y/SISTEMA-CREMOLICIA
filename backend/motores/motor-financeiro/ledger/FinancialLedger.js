/**
 * MFE — FinancialLedger facade (append-only)
 * MFE-03: delega ao FinancialLedgerService
 */

const { IFinancialLedger } = require('../contracts');
const FinancialLedgerService = require('../services/FinancialLedgerService');

class FinancialLedger extends IFinancialLedger {
  constructor({ featureFlags, audit, ledgerService } = {}) {
    super();
    this.featureFlags = featureFlags;
    this.audit = audit;
    this.service = ledgerService || new FinancialLedgerService({ featureFlags, audit });
  }

  async append(db, entrada, opts = {}) {
    return this.service.criarLancamento(db, entrada, opts);
  }

  async listar(db, filtros = {}) {
    return this.service.consultarHistorico(db, filtros);
  }

  async update() {
    return this.service.update();
  }

  async delete() {
    return this.service.delete();
  }
}

module.exports = FinancialLedger;
