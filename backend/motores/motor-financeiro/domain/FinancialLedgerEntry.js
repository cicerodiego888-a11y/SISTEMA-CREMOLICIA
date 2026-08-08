/**
 * MFE-03 — Entidade oficial LedgerEntry (append-only)
 */

const {
  NaturezaLancamento,
  TipoLancamento,
  TipoLancamentoOperacional,
  MOTOR_FINANCEIRO_NOME,
  MOEDA_PADRAO
} = require('./enums');
const { FinancialValidationError } = require('./errors');

const TIPOS_OP = new Set(Object.values(TipoLancamentoOperacional));
const NATUREZAS = new Set(Object.values(NaturezaLancamento));
const TIPOS_ZERO_OK = new Set([
  TipoLancamentoOperacional.ABERTURA_CAIXA,
  TipoLancamentoOperacional.FECHAMENTO_CAIXA,
  TipoLancamentoOperacional.PROVISAO
]);

class FinancialLedgerEntry {
  constructor(props = {}) {
    this.id = props.id ?? null;
    this.ledgerId = props.ledgerId || props.ledger_id || 'default';
    this.eventId = props.eventId ?? props.event_id ?? null;
    this.evento = props.evento || props.eventType || props.event_type || null;
    this.origem = props.origem || null;

    // MFE-03: tipo operacional + natureza
    this.tipoLancamento = props.tipoLancamento
      || props.tipo_lancamento
      || props.tipoOperacional
      || null;
    this.natureza = props.natureza
      || (props.tipo === TipoLancamento.DEBITO || props.tipo === NaturezaLancamento.DEBITO
        ? NaturezaLancamento.DEBITO
        : props.tipo === TipoLancamento.CREDITO || props.tipo === NaturezaLancamento.CREDITO
          ? NaturezaLancamento.CREDITO
          : null);

    // Compat: `tipo` espelha natureza (DEBITO/CREDITO)
    this.tipo = this.natureza || props.tipo || NaturezaLancamento.CREDITO;

    this.valor = Number(props.valor ?? 0);
    this.moeda = props.moeda || MOEDA_PADRAO;
    this.contaFinanceira = props.contaFinanceira
      || props.conta_financeira
      || props.conta
      || null;
    this.conta = this.contaFinanceira;
    this.centroCusto = props.centroCusto || props.centro_custo || null;
    this.historico = props.historico || null;
    this.operador = props.operador ?? props.operadorId ?? props.operador_id ?? null;
    this.correlationId = props.correlationId || props.correlation_id || null;
    this.causationId = props.causationId || props.causation_id || null;
    this.idempotencyKey = props.idempotencyKey || props.idempotency_key || null;
    this.createdAt = props.createdAt || props.created_at || null;
    this.motor = props.motor || MOTOR_FINANCEIRO_NOME;
    this.detalhes = props.detalhes && typeof props.detalhes === 'object' ? { ...props.detalhes } : null;
  }

  static criar(props = {}) {
    return new FinancialLedgerEntry(props);
  }

  validar() {
    const erros = [];
    if (!this.ledgerId) erros.push('ledgerId é obrigatório');
    if (this.eventId == null && !this.evento) {
      erros.push('lançamento sem evento (eventId/evento obrigatório)');
    }
    if (!this.origem) erros.push('lançamento sem origem');
    if (!this.tipoLancamento || !TIPOS_OP.has(this.tipoLancamento)) {
      erros.push(`tipoLancamento inválido: ${this.tipoLancamento}`);
    }
    if (!this.natureza || !NATUREZAS.has(this.natureza)) {
      erros.push(`natureza inválida: ${this.natureza}`);
    }
    if (!Number.isFinite(this.valor)) {
      erros.push('valor deve ser numérico');
    } else if (this.valor < 0) {
      erros.push('valor negativo incompatível — use natureza DEBITO/CREDITO com valor absoluto');
    } else if (this.valor === 0 && !TIPOS_ZERO_OK.has(this.tipoLancamento)) {
      erros.push('valor deve ser maior que zero para este tipoLancamento');
    }
    if (!this.contaFinanceira) erros.push('contaFinanceira é obrigatória');
    if (!this.correlationId) erros.push('correlationId é obrigatório');
    if (!this.idempotencyKey) erros.push('idempotencyKey é obrigatória');
    if (!this.moeda) erros.push('moeda é obrigatória');
    return { ok: erros.length === 0, erros };
  }

  assertValid() {
    const v = this.validar();
    if (!v.ok) throw new FinancialValidationError(v.erros);
    return this;
  }

  /** Sinal lógico para saldo: CREDITO +, DEBITO - */
  get sinal() {
    return this.natureza === NaturezaLancamento.DEBITO ? -1 : 1;
  }

  get valorAssinado() {
    return this.sinal * Math.abs(this.valor);
  }

  toJSON() {
    return {
      id: this.id,
      ledgerId: this.ledgerId,
      eventId: this.eventId,
      evento: this.evento,
      tipoLancamento: this.tipoLancamento,
      natureza: this.natureza,
      tipo: this.tipo,
      valor: this.valor,
      moeda: this.moeda,
      contaFinanceira: this.contaFinanceira,
      conta: this.contaFinanceira,
      centroCusto: this.centroCusto,
      historico: this.historico,
      origem: this.origem,
      operador: this.operador,
      correlationId: this.correlationId,
      causationId: this.causationId,
      idempotencyKey: this.idempotencyKey,
      createdAt: this.createdAt,
      motor: this.motor,
      detalhes: this.detalhes
    };
  }
}

module.exports = FinancialLedgerEntry;
