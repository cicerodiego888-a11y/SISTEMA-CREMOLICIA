/**
 * Contratos públicos MFE — alteração exige ADR.
 */

class IFinancialLedger {
  async append(_entry) {
    throw new Error(`${this.constructor.name} deve implementar append()`);
  }

  async listar(_filtros) {
    throw new Error(`${this.constructor.name} deve implementar listar()`);
  }
}

class IFinancialEvent {
  validar() {
    throw new Error(`${this.constructor.name} deve implementar validar()`);
  }

  toJSON() {
    throw new Error(`${this.constructor.name} deve implementar toJSON()`);
  }
}

class IFinancialEventStore {
  async persistir(_evento) {
    throw new Error(`${this.constructor.name} deve implementar persistir()`);
  }

  async obterPorIdempotencyKey(_key) {
    throw new Error(`${this.constructor.name} deve implementar obterPorIdempotencyKey()`);
  }
}

class IFinancialPublisher {
  async publicar(_evento) {
    throw new Error(`${this.constructor.name} deve implementar publicar()`);
  }
}

class IFinancialConsumer {
  async consumir(_evento) {
    throw new Error(`${this.constructor.name} deve implementar consumir()`);
  }
}

class IFinancialAudit {
  async registrar(_registro) {
    throw new Error(`${this.constructor.name} deve implementar registrar()`);
  }
}

/** MFE-03 Modelo — contratos de domínio (SSOT) */
class IFinancialOperation {
  validar() {
    throw new Error(`${this.constructor.name} deve implementar validar()`);
  }

  toJSON() {
    throw new Error(`${this.constructor.name} deve implementar toJSON()`);
  }
}

class IFinancialEntry {
  validar() {
    throw new Error(`${this.constructor.name} deve implementar validar()`);
  }

  toJSON() {
    throw new Error(`${this.constructor.name} deve implementar toJSON()`);
  }
}

class IFinancialDocument {
  validar() {
    throw new Error(`${this.constructor.name} deve implementar validar()`);
  }

  toJSON() {
    throw new Error(`${this.constructor.name} deve implementar toJSON()`);
  }
}

class IFinancialAllocation {
  validar() {
    throw new Error(`${this.constructor.name} deve implementar validar()`);
  }

  toJSON() {
    throw new Error(`${this.constructor.name} deve implementar toJSON()`);
  }
}

module.exports = {
  IFinancialLedger,
  IFinancialEvent,
  IFinancialEventStore,
  IFinancialPublisher,
  IFinancialConsumer,
  IFinancialAudit,
  IFinancialOperation,
  IFinancialEntry,
  IFinancialDocument,
  IFinancialAllocation
};
