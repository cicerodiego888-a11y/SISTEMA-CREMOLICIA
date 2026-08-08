/**
 * MFE-03 — Modelo Financeiro Unificado (SSOT)
 * Enums oficiais do domínio financeiro.
 *
 * Compat: mantém aliases MFE-01/02/03 (Ledger) — não quebra consumidores internos.
 */

const MOTOR_FINANCEIRO_NOME = 'MotorFinanceiro';
const MOTOR_FINANCEIRO_VERSAO = '1.3.0-mfe05-ar';
const MOTOR_FINANCEIRO_CODIGO = 'MFE';

/** Natureza contábil do lançamento */
const NaturezaLancamento = Object.freeze({
  CREDITO: 'CREDITO',
  DEBITO: 'DEBITO'
});

/**
 * @deprecated Use NaturezaLancamento — mantido para compat MFE-01/02
 */
const TipoLancamento = Object.freeze({
  DEBITO: NaturezaLancamento.DEBITO,
  CREDITO: NaturezaLancamento.CREDITO,
  COMPENSATORIO: 'COMPENSATORIO'
});

/**
 * Tipos de FinancialOperation (operação financeira unificada)
 * MFE-03 Modelo — domínio oficial.
 */
const FinancialOperationType = Object.freeze({
  VENDA: 'VENDA',
  DEVOLUCAO: 'DEVOLUCAO',
  PAGAMENTO: 'PAGAMENTO',
  RECEBIMENTO: 'RECEBIMENTO',
  TRANSFERENCIA: 'TRANSFERENCIA',
  AJUSTE: 'AJUSTE',
  ABERTURA_CAIXA: 'ABERTURA_CAIXA',
  FECHAMENTO_CAIXA: 'FECHAMENTO_CAIXA',
  PIX: 'PIX',
  TEF: 'TEF',
  DINHEIRO: 'DINHEIRO',
  CHEQUE: 'CHEQUE',
  BOLETO: 'BOLETO',
  CARTAO: 'CARTAO'
});

/** Tipos operacionais do lançamento (Ledger / FinancialEntry) — MFE-03 Ledger */
const TipoLancamentoOperacional = Object.freeze({
  RECEITA: 'RECEITA',
  DESPESA: 'DESPESA',
  TRANSFERENCIA: 'TRANSFERENCIA',
  ESTORNO: 'ESTORNO',
  AJUSTE: 'AJUSTE',
  PROVISAO: 'PROVISAO',
  ABERTURA_CAIXA: 'ABERTURA_CAIXA',
  FECHAMENTO_CAIXA: 'FECHAMENTO_CAIXA',
  SANGRIA: 'SANGRIA',
  SUPRIMENTO: 'SUPRIMENTO',
  PIX: 'PIX',
  TEF: 'TEF',
  BOLETO: 'BOLETO',
  CARTAO: 'CARTAO',
  DINHEIRO: 'DINHEIRO',
  OUTROS: 'OUTROS'
});

/**
 * Origens oficiais (catálogo unificado MFE-03 Modelo).
 * Aliases legados (COMPRA, TEF, PIX, SISTEMA, OUTROS) preservados.
 */
const OrigemFinanceira = Object.freeze({
  PDV: 'PDV',
  ERP: 'ERP',
  COMERCIAL: 'COMERCIAL',
  ESTOQUE: 'ESTOQUE',
  FISCAL: 'FISCAL',
  MFE: 'MFE',
  API: 'API',
  IMPORTACAO: 'IMPORTACAO',
  INTEGRACAO: 'INTEGRACAO',
  // Aliases / compat
  COMPRA: 'COMPRA',
  TEF: 'TEF',
  PIX: 'PIX',
  SISTEMA: 'SISTEMA',
  OUTROS: 'OUTROS'
});

/**
 * Meios financeiros oficiais — enum preparado, sem regras operacionais.
 */
const MeioFinanceiro = Object.freeze({
  DINHEIRO: 'DINHEIRO',
  PIX: 'PIX',
  TEF: 'TEF',
  CARTAO_CREDITO: 'CARTAO_CREDITO',
  CARTAO_DEBITO: 'CARTAO_DEBITO',
  BOLETO: 'BOLETO',
  CHEQUE: 'CHEQUE',
  TRANSFERENCIA: 'TRANSFERENCIA',
  CREDITO_COMERCIAL: 'CREDITO_COMERCIAL',
  OUTRO: 'OUTRO'
});

/** Tipos de documento de origem (FinancialDocument) */
const FinancialDocumentType = Object.freeze({
  VENDA: 'VENDA',
  COMPRA: 'COMPRA',
  NFCE: 'NFCE',
  NFE: 'NFE',
  CONSIGNACAO: 'CONSIGNACAO',
  OS: 'OS',
  PEDIDO: 'PEDIDO',
  RECEBIMENTO: 'RECEBIMENTO',
  PAGAMENTO: 'PAGAMENTO',
  OUTRO: 'OUTRO'
});

const FeatureFlag = Object.freeze({
  FINANCEIRO_V2: 'FINANCEIRO_V2',
  FIN_LEDGER: 'FIN_LEDGER',
  FIN_EVENTS: 'FIN_EVENTS',
  FIN_PIX: 'FIN_PIX',
  FIN_TEF: 'FIN_TEF',
  FIN_CONCILIACAO: 'FIN_CONCILIACAO',
  /** MFE-04 — piloto Caixa (default OFF) */
  FEATURE_MFE_CAIXA: 'FEATURE_MFE_CAIXA',
  /** MFE-05 — piloto Contas a Receber (default OFF) */
  FEATURE_MFE_AR: 'FEATURE_MFE_AR',
  /** MFE-05.1 — bridge PDV → AR (default OFF) */
  FEATURE_MFE_PDV_AR: 'FEATURE_MFE_PDV_AR',
  /** MFE-05.1 — bridge Comercial → AR (default OFF) */
  FEATURE_MFE_COMERCIAL_AR: 'FEATURE_MFE_COMERCIAL_AR',
  /** MFE-06 — piloto Contas a Pagar / Compras (default OFF) */
  FEATURE_MFE_AP: 'FEATURE_MFE_AP',
  /** MFE-07 — Liquidação Financeira (default OFF) */
  FEATURE_MFE_SETTLEMENT: 'FEATURE_MFE_SETTLEMENT'
});

/**
 * Contexto financeiro que acompanha eventos (MFE-04).
 */
const FinancialContext = Object.freeze({
  PDV: 'PDV',
  CAIXA: 'CAIXA',
  COMERCIAL: 'COMERCIAL',
  ESTOQUE: 'ESTOQUE',
  FISCAL: 'FISCAL',
  ERP: 'ERP',
  FINANCEIRO: 'FINANCEIRO',
  IMPORTACAO: 'IMPORTACAO',
  INTEGRACAO: 'INTEGRACAO',
  API: 'API'
});

/**
 * Status financeiro — preparação futura (sem regras operacionais).
 */
const FinancialStatus = Object.freeze({
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  ROLLED_BACK: 'ROLLED_BACK'
});

const MOEDA_PADRAO = 'BRL';

function isOrigemFinanceiraValida(origem) {
  return Object.prototype.hasOwnProperty.call(OrigemFinanceira, String(origem || ''));
}

function isMeioFinanceiroValido(meio) {
  return Object.prototype.hasOwnProperty.call(MeioFinanceiro, String(meio || ''));
}

function isFinancialOperationTypeValido(tipo) {
  return Object.prototype.hasOwnProperty.call(FinancialOperationType, String(tipo || ''));
}

function isFinancialContextValido(ctx) {
  return Object.prototype.hasOwnProperty.call(FinancialContext, String(ctx || ''));
}

function isFinancialStatusValido(status) {
  return Object.prototype.hasOwnProperty.call(FinancialStatus, String(status || ''));
}

module.exports = {
  MOTOR_FINANCEIRO_NOME,
  MOTOR_FINANCEIRO_VERSAO,
  MOTOR_FINANCEIRO_CODIGO,
  NaturezaLancamento,
  TipoLancamento,
  FinancialOperationType,
  TipoLancamentoOperacional,
  OrigemFinanceira,
  MeioFinanceiro,
  FinancialDocumentType,
  FeatureFlag,
  FinancialContext,
  FinancialStatus,
  MOEDA_PADRAO,
  isOrigemFinanceiraValida,
  isMeioFinanceiroValido,
  isFinancialOperationTypeValido,
  isFinancialContextValido,
  isFinancialStatusValido
};
