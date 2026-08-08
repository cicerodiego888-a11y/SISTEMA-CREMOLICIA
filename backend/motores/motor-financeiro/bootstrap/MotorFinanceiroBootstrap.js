/**
 * MFE-01 — Bootstrap oficial do Motor Financeiro
 */

const { bootstrapMotorFinanceiroSchema } = require('../migrations/001_mfe_fundacao');
const { bootstrapLedgerOperacionalSchema } = require('../migrations/002_ledger_operacional');
const MotorFinanceiro = require('../application/MotorFinanceiro');
const {
  MOTOR_FINANCEIRO_NOME,
  MOTOR_FINANCEIRO_VERSAO
} = require('../domain/enums');

let instancia = null;

function obterMotor(opts = {}) {
  if (!instancia || opts.forceNew) {
    instancia = new MotorFinanceiro(opts);
  }
  return instancia;
}

async function bootstrapMotorFinanceiro(db, opts = {}) {
  await bootstrapMotorFinanceiroSchema(db);
  await bootstrapLedgerOperacionalSchema(db);
  const motor = obterMotor(opts);
  return {
    motor,
    FinancialLedger: motor.ledger,
    FinancialLedgerService: motor.ledgerService,
    FinancialEventDispatcher: motor.dispatcher,
    FinancialEventStore: motor.eventStore,
    FinancialAudit: motor.audit,
    FeatureFlags: motor.featureFlags,
    meta: {
      nome: MOTOR_FINANCEIRO_NOME,
      versao: MOTOR_FINANCEIRO_VERSAO,
      sprint: 'MFE-03'
    }
  };
}

function resetMotorParaTestes() {
  instancia = null;
}

module.exports = {
  bootstrapMotorFinanceiro,
  obterMotor,
  resetMotorParaTestes,
  bootstrapMotorFinanceiroSchema: async (db) => {
    await bootstrapMotorFinanceiroSchema(db);
    await bootstrapLedgerOperacionalSchema(db);
  }
};
