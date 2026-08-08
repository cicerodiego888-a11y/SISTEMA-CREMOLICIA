const { IFinancialAudit } = require('../contracts');

class FinancialAuditService extends IFinancialAudit {
  constructor({ repository } = {}) {
    super();
    this.repository = repository;
  }

  async registrar(registro = {}) {
    const row = {
      acao: registro.acao || 'UNKNOWN',
      origem: registro.origem || null,
      operadorId: registro.operadorId ?? registro.operador ?? null,
      correlationId: registro.correlationId || null,
      causationId: registro.causationId || null,
      detalhe: registro.detalhe || registro.detalhes || null,
      timestamp: registro.timestamp || new Date().toISOString()
    };
    if (!this.repository) {
      return { ...row, id: null, persisted: false };
    }
    const saved = await this.repository.inserir(this.repository.db || registro.db, row);
    return { ...row, id: saved.id, persisted: true };
  }
}

module.exports = FinancialAuditService;
