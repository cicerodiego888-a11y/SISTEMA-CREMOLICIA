/**
 * MFE-06 — FinancialPayableHandler
 *
 * Consome eventos de Contas a Pagar APÓS o Ledger.
 * Nunca cria lançamentos financeiros diretamente.
 * Materializa projeção de título AP + parcelas (piloto).
 */

const {
  FeatureFlag,
  FinancialContext,
  FinancialStatus
} = require('../../domain/enums');
const { isEventoAp, resolverTipoEventoParaPipeline } = require('../FinancialEventTypes');
const FinancialInstallment = require('../../domain/FinancialInstallment');

function runAsync(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    if (!db || typeof db.run !== 'function') {
      resolve({ lastID: null, changes: 0, skipped: true });
      return;
    }
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

class FinancialPayableHandler {
  constructor(opts = {}) {
    this.nome = 'FinancialPayableHandler';
    this.featureFlags = opts.featureFlags || null;
    this.audit = opts.audit || null;
    /** @type {Map<string, object>} */
    this._titulos = new Map();
  }

  estaAtivo() {
    return Boolean(this.featureFlags && this.featureFlags.isEnabled(FeatureFlag.FEATURE_MFE_AP));
  }

  async consumir(evento, ctx = {}) {
    const started = Date.now();
    if (!this.estaAtivo()) {
      return { ok: true, skipped: true, reason: 'FEATURE_MFE_AP_OFF' };
    }
    if (!isEventoAp(evento?.type)) {
      return { ok: true, skipped: true, reason: 'NOT_AP_EVENT' };
    }

    const entries = Array.isArray(ctx.entries) ? ctx.entries : [];
    if (entries.length === 0) {
      const err = new Error('FinancialPayableHandler: evento AP sem LedgerEntry — proibido inventar lançamento');
      await this._auditar(ctx.db, evento, FinancialStatus.FAILED, started, { erro: err.message });
      throw err;
    }

    const tipoCanonico = resolverTipoEventoParaPipeline(evento.type);
    const key = String(evento.id || evento.idempotencyKey);
    if (this._titulos.has(key)) {
      await this._auditar(ctx.db, evento, FinancialStatus.COMPLETED, started, {
        idempotent: true,
        handler: this.nome
      });
      return { ok: true, idempotent: true, titulo: this._titulos.get(key) };
    }

    const payload = evento.payload || {};
    const valor = Number(payload.valor ?? payload.valor_parcela ?? entries[0]?.valor ?? 0);
    const parcelasPayload = Array.isArray(payload.parcelas) ? payload.parcelas : null;
    const parcelas = parcelasPayload
      ? parcelasPayload.map((p) => FinancialInstallment.criar(p).toJSON())
      : (payload.total_parcelas > 1
        ? FinancialInstallment.gerarParcelas({
          valorTotal: valor,
          quantidade: Number(payload.total_parcelas),
          primeiroVencimento: payload.data_vencimento || payload.vencimento,
          tituloId: payload.titulo_id || payload.conta_pagar_id || null
        }).map((p) => p.toJSON())
        : [FinancialInstallment.criar({
          tituloId: payload.titulo_id || payload.conta_pagar_id || null,
          numero: Number(payload.numero_parcela || 1),
          totalParcelas: Number(payload.total_parcelas || 1),
          valor,
          saldo: Number(payload.valor_restante ?? valor),
          vencimento: payload.data_vencimento || payload.vencimento || null,
          status: FinancialInstallment.Status.ABERTO
        }).toJSON()]);

    const titulo = {
      eventId: evento.id,
      operationId: payload.operationId || evento.idempotencyKey,
      correlationId: evento.correlationId,
      traceId: evento.traceId || evento.correlationId,
      context: evento.context || FinancialContext.ERP,
      status: this._statusPorTipo(tipoCanonico, evento.type),
      tipo: tipoCanonico,
      tipoOriginal: evento.type,
      tituloId: payload.titulo_id || payload.conta_pagar_id || null,
      compraId: payload.compra_id || null,
      fornecedor: payload.fornecedor || payload.pessoa_nome || null,
      valor,
      valorPago: Number(payload.valor_pago || 0),
      saldo: Number(payload.valor_restante ?? (valor - Number(payload.valor_pago || 0))),
      parcelas,
      ledgerEntryIds: entries.map((e) => e.id),
      ledgerCount: entries.length,
      processedAt: new Date().toISOString(),
      durationMs: 0,
      financeiroIds: []
    };

    if (payload.persistirTitulo && this.estaAtivo()) {
      titulo.financeiroIds = await this._persistirFinanceiro(ctx.db, titulo, payload);
      if (titulo.financeiroIds.length && !titulo.tituloId) {
        titulo.tituloId = titulo.financeiroIds[0];
      }
    }

    titulo.durationMs = Date.now() - started;
    this._titulos.set(key, titulo);

    await this._auditar(ctx.db, evento, FinancialStatus.COMPLETED, started, {
      handler: this.nome,
      context: titulo.context,
      FinancialContext: titulo.context,
      FinancialStatus: titulo.status,
      tituloId: titulo.tituloId,
      compraId: titulo.compraId,
      parcelas: titulo.parcelas.length,
      ledgerEntryIds: titulo.ledgerEntryIds,
      operationId: titulo.operationId,
      eventId: evento.id,
      traceId: titulo.traceId,
      correlationId: titulo.correlationId,
      origem: evento.origem,
      bridge: payload.bridge || null,
      financeiroIds: titulo.financeiroIds,
      durationMs: titulo.durationMs
    });

    return { ok: true, titulo };
  }

  async _persistirFinanceiro(db, titulo, payload) {
    const ids = [];
    const compraId = titulo.compraId || payload.compra_id;
    if (!compraId) return ids;

    const tipo = String(titulo.tipoOriginal || '');
    if (tipo === 'PURCHASE_CANCELLED' || tipo === 'ACCOUNT_PAYABLE_CANCELLED') {
      return ids;
    }

    const dataMovimento = payload.data_compra || payload.data_movimento || new Date().toISOString().slice(0, 10);
    const fornecedor = titulo.fornecedor || null;

    for (const parcela of titulo.parcelas || []) {
      const valorParcela = Number(parcela.valor ?? titulo.valor ?? 0);
      if (!(valorParcela > 0) && valorParcela !== 0) continue;
      const numero = Number(parcela.numero || 1);
      const total = Number(parcela.totalParcelas || titulo.parcelas.length || 1);
      const venc = parcela.vencimento || payload.data_vencimento || dataMovimento;
      const statusParcela = parcela.status === FinancialInstallment.Status.PAGO
        || payload.status === 'pago'
        ? 'pago'
        : 'pendente';

      const result = await runAsync(db, `
        INSERT INTO financeiro (
          tipo, descricao, valor, data_movimento, categoria, forma_pagamento,
          referencia_id, referencia_tipo, status, origem, documento, vencimento,
          numero_parcela, total_parcelas, compra_id, pessoa_nome, observacao, baixado_em
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        'despesa',
        payload.descricao || `Compra ${compraId} - Parcela ${numero}/${total}`,
        valorParcela,
        dataMovimento,
        'compras',
        payload.forma_pagamento || null,
        compraId,
        'compra',
        statusParcela,
        'compra',
        null,
        venc,
        numero,
        total,
        compraId,
        fornecedor,
        payload.observacao || null,
        statusParcela === 'pago' ? dataMovimento : null
      ]);
      if (result.lastID) ids.push(result.lastID);
    }
    return ids;
  }

  _statusPorTipo(tipo, tipoOriginal) {
    const t = String(tipoOriginal || tipo || '');
    if (t === 'PURCHASE_CANCELLED' || tipo === 'TITULO_AP_CANCELADO' || t === 'ACCOUNT_PAYABLE_CANCELLED') {
      return FinancialStatus.CANCELLED;
    }
    if (tipo === 'TITULO_AP_BAIXADO' || tipo === 'TITULO_AP_PARCIAL' || t === 'ACCOUNT_PAYABLE_SETTLED') {
      return FinancialStatus.COMPLETED;
    }
    return FinancialStatus.COMPLETED;
  }

  obterTitulo(eventIdOrKey) {
    return this._titulos.get(String(eventIdOrKey)) || null;
  }

  listarTitulos() {
    return [...this._titulos.values()];
  }

  async _auditar(db, evento, status, started, extra = {}) {
    if (!this.audit) return;
    await this.audit.registrar({
      db,
      acao: 'AP_HANDLER',
      origem: evento?.origem,
      operadorId: evento?.operadorId,
      correlationId: evento?.correlationId,
      detalhe: {
        evento: evento?.type,
        eventId: evento?.id,
        status,
        handler: this.nome,
        durationMs: Date.now() - started,
        context: evento?.context || FinancialContext.ERP,
        FinancialContext: evento?.context || FinancialContext.ERP,
        FinancialStatus: status,
        traceId: evento?.traceId || evento?.correlationId,
        idempotencyKey: evento?.idempotencyKey,
        ...extra
      }
    });
  }
}

module.exports = FinancialPayableHandler;
