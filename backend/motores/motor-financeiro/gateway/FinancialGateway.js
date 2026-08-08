/**
 * MFE-05.2 — FinancialGateway
 *
 * Única porta pública oficial do Motor Financeiro Enterprise.
 * Valida → Normaliza → Enriquece contexto → Pipeline.
 *
 * Nunca executa regra financeira.
 * Nunca gera Ledger.
 * Nunca conhece Handlers.
 */

const {
  FinancialContext,
  FinancialStatus,
  OrigemFinanceira,
  MeioFinanceiro,
  isFinancialContextValido
} = require('../domain/enums');
const { criarTrilhaAuditoriaFinanceira } = require('../domain/FinancialAuditTrail');

/** Mapeamento canal → FinancialContext (Gateway resolve; módulos não definem) */
const CANAL_PARA_CONTEXTO = Object.freeze({
  VENDA: FinancialContext.PDV,
  SALE: FinancialContext.PDV,
  PDV: FinancialContext.PDV,
  PDV_AR: FinancialContext.PDV,
  PAGAMENTO: FinancialContext.FINANCEIRO,
  PAYMENT: FinancialContext.FINANCEIRO,
  RECEBIMENTO: FinancialContext.FINANCEIRO,
  CREDITO_COMERCIAL: FinancialContext.COMERCIAL,
  COMMERCIAL_CREDIT: FinancialContext.COMERCIAL,
  COMERCIAL: FinancialContext.COMERCIAL,
  COMERCIAL_AR: FinancialContext.COMERCIAL,
  CAIXA: FinancialContext.CAIXA,
  CASH: FinancialContext.CAIXA,
  PIX: FinancialContext.FINANCEIRO,
  TEF: FinancialContext.FINANCEIRO,
  COMPRA: FinancialContext.ERP,
  PURCHASE: FinancialContext.ERP,
  CONTA_RECEBER: FinancialContext.FINANCEIRO,
  AR: FinancialContext.FINANCEIRO,
  ACCOUNT_RECEIVABLE: FinancialContext.FINANCEIRO,
  CONTA_PAGAR: FinancialContext.FINANCEIRO,
  AP: FinancialContext.FINANCEIRO,
  ACCOUNT_PAYABLE: FinancialContext.FINANCEIRO,
  LIQUIDACAO: FinancialContext.FINANCEIRO,
  SETTLEMENT: FinancialContext.FINANCEIRO,
  DINHEIRO: FinancialContext.CAIXA,
  CARTAO: FinancialContext.FINANCEIRO,
  CARTAO_CREDITO: FinancialContext.FINANCEIRO,
  CARTAO_DEBITO: FinancialContext.FINANCEIRO,
  CHEQUE: FinancialContext.FINANCEIRO,
  BOLETO: FinancialContext.FINANCEIRO,
  TRANSFERENCIA: FinancialContext.FINANCEIRO,
  FISCAL: FinancialContext.FISCAL,
  ESTOQUE: FinancialContext.ESTOQUE,
  API: FinancialContext.API,
  ERP: FinancialContext.ERP
});

const ORIGEM_POR_CONTEXTO = Object.freeze({
  [FinancialContext.PDV]: OrigemFinanceira.PDV,
  [FinancialContext.CAIXA]: OrigemFinanceira.PDV,
  [FinancialContext.COMERCIAL]: OrigemFinanceira.COMERCIAL,
  [FinancialContext.FISCAL]: OrigemFinanceira.FISCAL,
  [FinancialContext.ESTOQUE]: OrigemFinanceira.ESTOQUE,
  [FinancialContext.ERP]: OrigemFinanceira.ERP,
  [FinancialContext.FINANCEIRO]: OrigemFinanceira.ERP,
  [FinancialContext.API]: OrigemFinanceira.API,
  [FinancialContext.IMPORTACAO]: OrigemFinanceira.IMPORTACAO,
  [FinancialContext.INTEGRACAO]: OrigemFinanceira.INTEGRACAO
});

class FinancialGateway {
  /**
   * @param {import('../application/MotorFinanceiro')} motor
   */
  constructor(motor) {
    this.motor = motor;
    this.nome = 'FinancialGateway';
  }

  /**
   * Porta genérica oficial — única entrada pública para o Pipeline.
   * @param {object} db
   * @param {object} entrada
   */
  async publicar(db, entrada = {}) {
    const started = Date.now();
    const validacao = this._validar(entrada);
    if (!validacao.ok) {
      await this._auditar(db, null, 'GATEWAY_INVALID', {
        erros: validacao.erros,
        durationMs: Date.now() - started
      });
      return { ok: false, error: validacao.erros.join('; '), gateway: this.nome };
    }

    const context = this._resolverContexto(entrada);
    const origem = this._resolverOrigem(entrada, context);
    const trail = criarTrilhaAuditoriaFinanceira({
      operationId: entrada.operationId,
      correlationId: entrada.correlationId,
      traceId: entrada.traceId,
      idempotencyKey: entrada.idempotencyKey
        || `gw:${entrada.canal || entrada.eventType || entrada.type || 'evt'}:${Date.now()}`
    });

    const evento = this._normalizar(entrada, { context, origem, trail });
    const resultado = await this.motor.pipeline.processar(db, evento);

    await this._auditar(db, evento, 'GATEWAY_PUBLISH', {
      handler: this.nome,
      context,
      origem,
      eventId: resultado?.event?.id || null,
      operationId: trail.operationId || trail.idempotencyKey,
      correlationId: trail.correlationId,
      traceId: trail.traceId,
      durationMs: Date.now() - started,
      ok: Boolean(resultado?.ok)
    });

    return {
      ok: Boolean(resultado?.ok),
      eventType: evento.type,
      context,
      origem,
      gateway: this.nome,
      resultado
    };
  }

  publicarVenda(db, operacao = {}) {
    return this.publicar(db, {
      ...operacao,
      canal: operacao.canal || 'VENDA',
      eventType: operacao.eventType || operacao.type || 'SALE_COMPLETED'
    });
  }

  publicarPagamento(db, operacao = {}) {
    return this.publicar(db, {
      ...operacao,
      canal: operacao.canal || 'PAGAMENTO',
      eventType: operacao.eventType || operacao.type || 'PAYMENT_RECEIVED'
    });
  }

  publicarRecebimento(db, operacao = {}) {
    return this.publicar(db, {
      ...operacao,
      canal: operacao.canal || 'RECEBIMENTO',
      eventType: operacao.eventType || operacao.type || 'PAYMENT_RECEIVED'
    });
  }

  publicarCreditoComercial(db, operacao = {}) {
    return this.publicar(db, {
      ...operacao,
      canal: operacao.canal || 'CREDITO_COMERCIAL',
      eventType: operacao.eventType || operacao.type || 'COMMERCIAL_CREDIT_GENERATED'
    });
  }

  publicarCaixa(db, operacao = {}) {
    return this.publicar(db, {
      ...operacao,
      canal: 'CAIXA',
      eventType: operacao.eventType || operacao.type || 'CASH_ADJUSTMENT'
    });
  }

  /**
   * MFE-07 — porta oficial de liquidação financeira.
   */
  publicarLiquidacao(db, operacao = {}) {
    return this.publicar(db, {
      ...operacao,
      canal: operacao.canal || 'LIQUIDACAO',
      eventType: operacao.eventType || operacao.type || 'PAYMENT_SETTLED',
      meioFinanceiro: operacao.meioFinanceiro || operacao.meio_financeiro || MeioFinanceiro.OUTRO
    });
  }

  publicarPix(db, operacao = {}) {
    return this.publicarLiquidacao(db, {
      ...operacao,
      canal: 'PIX',
      meioFinanceiro: MeioFinanceiro.PIX,
      eventType: operacao.eventType || operacao.type || 'PIX_SETTLED'
    });
  }

  publicarTef(db, operacao = {}) {
    return this.publicarLiquidacao(db, {
      ...operacao,
      canal: 'TEF',
      meioFinanceiro: MeioFinanceiro.TEF,
      eventType: operacao.eventType || operacao.type || 'TEF_SETTLED'
    });
  }

  publicarDinheiro(db, operacao = {}) {
    return this.publicarLiquidacao(db, {
      ...operacao,
      canal: 'DINHEIRO',
      meioFinanceiro: MeioFinanceiro.DINHEIRO,
      eventType: operacao.eventType || operacao.type || 'CASH_SETTLED'
    });
  }

  publicarCartaoCredito(db, operacao = {}) {
    return this.publicarLiquidacao(db, {
      ...operacao,
      canal: 'CARTAO_CREDITO',
      meioFinanceiro: MeioFinanceiro.CARTAO_CREDITO,
      eventType: operacao.eventType || operacao.type || 'CARD_SETTLED'
    });
  }

  publicarCartaoDebito(db, operacao = {}) {
    return this.publicarLiquidacao(db, {
      ...operacao,
      canal: 'CARTAO_DEBITO',
      meioFinanceiro: MeioFinanceiro.CARTAO_DEBITO,
      eventType: operacao.eventType || operacao.type || 'CARD_SETTLED'
    });
  }

  publicarCheque(db, operacao = {}) {
    return this.publicarLiquidacao(db, {
      ...operacao,
      canal: 'CHEQUE',
      meioFinanceiro: MeioFinanceiro.CHEQUE,
      eventType: operacao.eventType || operacao.type || 'CHECK_SETTLED'
    });
  }

  publicarBoleto(db, operacao = {}) {
    return this.publicarLiquidacao(db, {
      ...operacao,
      canal: 'BOLETO',
      meioFinanceiro: MeioFinanceiro.BOLETO,
      eventType: operacao.eventType || operacao.type || 'BOLETO_SETTLED'
    });
  }

  publicarTransferencia(db, operacao = {}) {
    return this.publicarLiquidacao(db, {
      ...operacao,
      canal: 'TRANSFERENCIA',
      meioFinanceiro: MeioFinanceiro.TRANSFERENCIA,
      eventType: operacao.eventType || operacao.type || 'BANK_TRANSFER_SETTLED'
    });
  }

  publicarCompra(db, operacao = {}) {
    return this.publicar(db, {
      ...operacao,
      canal: 'COMPRA',
      eventType: operacao.eventType || operacao.type || 'PURCHASE_CONFIRMED'
    });
  }

  publicarContaReceber(db, operacao = {}) {
    return this.publicar(db, {
      ...operacao,
      canal: 'CONTA_RECEBER',
      eventType: operacao.eventType || operacao.type || 'ACCOUNT_RECEIVABLE_CREATED'
    });
  }

  publicarContaPagar(db, operacao = {}) {
    return this.publicar(db, {
      ...operacao,
      canal: 'CONTA_PAGAR',
      eventType: operacao.eventType || operacao.type || 'ACCOUNT_PAYABLE_CREATED'
    });
  }

  /**
   * FinancialContext é resolvido exclusivamente pelo Gateway.
   * Campos `context` / `contexto` da entrada são ignorados (Regra 3.5).
   */
  _resolverContexto(entrada) {
    const canal = String(entrada.canal || entrada.channel || '').toUpperCase();
    if (canal && CANAL_PARA_CONTEXTO[canal]) {
      return CANAL_PARA_CONTEXTO[canal];
    }

    const origemHint = String(entrada.origem || entrada.origemHint || '').toUpperCase();
    if (origemHint === 'PDV') return FinancialContext.PDV;
    if (origemHint === 'COMERCIAL') return FinancialContext.COMERCIAL;
    if (origemHint === 'FISCAL') return FinancialContext.FISCAL;
    if (origemHint === 'ESTOQUE') return FinancialContext.ESTOQUE;
    if (origemHint === 'API') return FinancialContext.API;

    const type = String(entrada.eventType || entrada.type || '').toUpperCase();
    if (type.startsWith('CASH_') || type.startsWith('CAIXA_')) return FinancialContext.CAIXA;
    if (type.startsWith('SALE_') || type.startsWith('VENDA_')) return FinancialContext.PDV;
    if (type.startsWith('COMMERCIAL_') || type.includes('CREDIT')) return FinancialContext.COMERCIAL;
    if (type.startsWith('ACCOUNT_RECEIVABLE') || type.startsWith('TITULO_AR')) {
      return FinancialContext.FINANCEIRO;
    }
    if (type.startsWith('ACCOUNT_PAYABLE') || type.startsWith('TITULO_AP')) {
      return FinancialContext.FINANCEIRO;
    }
    if (type.startsWith('PIX_') || type.endsWith('_SETTLED') || type.includes('LIQUIDACAO') || type.includes('LIQUIDADO')) {
      return FinancialContext.FINANCEIRO;
    }
    if (type.startsWith('TEF_')) return FinancialContext.FINANCEIRO;
    if (type.startsWith('PURCHASE_') || type.includes('COMPRA')) return FinancialContext.ERP;

    return FinancialContext.FINANCEIRO;
  }

  _resolverOrigem(entrada, context) {
    if (entrada.origem && OrigemFinanceira[String(entrada.origem).toUpperCase()]) {
      return OrigemFinanceira[String(entrada.origem).toUpperCase()] || entrada.origem;
    }
    if (entrada.origem) return entrada.origem;
    return ORIGEM_POR_CONTEXTO[context] || OrigemFinanceira.ERP;
  }

  _validar(entrada) {
    const erros = [];
    const type = entrada.eventType || entrada.type;
    if (!type || !String(type).trim()) {
      erros.push('eventType/type é obrigatório');
    }
    return { ok: erros.length === 0, erros };
  }

  _normalizar(entrada, { context, origem, trail }) {
    const type = entrada.eventType || entrada.type;
    const payloadBase = (entrada.payload && typeof entrada.payload === 'object')
      ? { ...entrada.payload }
      : {};

    const camposOperacionais = [
      'valor', 'valor_pago', 'valor_restante', 'valor_parcela',
      'titulo_id', 'titleId', 'conta_receber_id', 'conta_pagar_id', 'venda_id', 'cliente_id',
      'consignacao_id', 'compra_id', 'sessao_id', 'sessaoId',
      'caixa_id', 'caixaId', 'terminal_id', 'terminalId',
      'movimentacao_id', 'motivo', 'numero_parcela', 'total_parcelas',
      'data_vencimento', 'vencimento', 'parcelas', 'persistirTitulo',
      'bridge', 'operationId', 'meioFinanceiro', 'meio_financeiro',
      'settlementId', 'settlement_id', 'documentoOrigem', 'documento_origem',
      'empresa', 'empresa_id', 'data', 'dataLiquidacao'
    ];

    for (const key of camposOperacionais) {
      if (entrada[key] !== undefined && payloadBase[key] === undefined) {
        payloadBase[key] = entrada[key];
      }
    }

    if (payloadBase.valor != null) payloadBase.valor = Number(payloadBase.valor);
    payloadBase.operationId = trail.operationId || trail.idempotencyKey || payloadBase.operationId;
    payloadBase.gateway = this.nome;
    payloadBase.canal = entrada.canal || entrada.channel || null;

    return {
      type,
      origem,
      context,
      status: FinancialStatus.PENDING,
      operadorId: entrada.operadorId ?? entrada.usuario_id ?? null,
      correlationId: trail.correlationId,
      traceId: trail.traceId,
      idempotencyKey: trail.idempotencyKey,
      causationId: entrada.causationId || null,
      payload: payloadBase
    };
  }

  async _auditar(db, evento, acao, detalhe = {}) {
    if (!this.motor?.audit) return;
    try {
      await this.motor.audit.registrar({
        db,
        acao,
        origem: evento?.origem || detalhe.origem,
        operadorId: evento?.operadorId,
        correlationId: evento?.correlationId || detalhe.correlationId,
        detalhe: {
          gateway: this.nome,
          evento: evento?.type,
          eventId: evento?.id,
          ...detalhe
        }
      });
    } catch (_) {
      /* auditoria nunca quebra publicação */
    }
  }
}

FinancialGateway.CANAL_PARA_CONTEXTO = CANAL_PARA_CONTEXTO;
FinancialGateway.isFinancialContextValido = isFinancialContextValido;

module.exports = FinancialGateway;
