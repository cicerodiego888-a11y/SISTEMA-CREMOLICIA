/**
 * MFE-05 / MFE-05.1 — FinancialReceivableHandler
 *
 * Consome eventos de Contas a Receber APÓS o Ledger.
 * Nunca cria lançamentos financeiros diretamente.
 * Materializa projeção de título/parcelas (piloto).
 * Com bridge ON + persistirTitulo: grava contas_receber (criação oficial MFE).
 */

const {
  FeatureFlag,
  FinancialContext,
  FinancialStatus
} = require('../../domain/enums');
const { isEventoAr, resolverTipoEventoParaPipeline } = require('../FinancialEventTypes');
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

class FinancialReceivableHandler {
  constructor(opts = {}) {
    this.nome = 'FinancialReceivableHandler';
    this.featureFlags = opts.featureFlags || null;
    this.audit = opts.audit || null;
    /** @type {Map<string, object>} */
    this._titulos = new Map();
  }

  estaAtivo() {
    if (!this.featureFlags) return false;
    return this.featureFlags.isEnabled(FeatureFlag.FEATURE_MFE_AR)
      || this.featureFlags.isEnabled(FeatureFlag.FEATURE_MFE_PDV_AR)
      || this.featureFlags.isEnabled(FeatureFlag.FEATURE_MFE_COMERCIAL_AR);
  }

  async consumir(evento, ctx = {}) {
    const started = Date.now();
    if (!this.estaAtivo()) {
      return { ok: true, skipped: true, reason: 'FEATURE_MFE_AR_OFF' };
    }
    if (!isEventoAr(evento?.type)) {
      return { ok: true, skipped: true, reason: 'NOT_AR_EVENT' };
    }

    const entries = Array.isArray(ctx.entries) ? ctx.entries : [];
    if (entries.length === 0) {
      const err = new Error('FinancialReceivableHandler: evento AR sem LedgerEntry — proibido inventar lançamento');
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
          tituloId: payload.titulo_id || payload.conta_receber_id || null
        }).map((p) => p.toJSON())
        : [FinancialInstallment.criar({
          tituloId: payload.titulo_id || payload.conta_receber_id || null,
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
      context: evento.context || FinancialContext.FINANCEIRO,
      status: this._statusPorTipo(tipoCanonico, evento.type),
      tipo: tipoCanonico,
      tipoOriginal: evento.type,
      tituloId: payload.titulo_id || payload.conta_receber_id || null,
      vendaId: payload.venda_id || null,
      clienteId: payload.cliente_id || null,
      valor,
      valorPago: Number(payload.valor_pago || 0),
      saldo: Number(payload.valor_restante ?? (valor - Number(payload.valor_pago || 0))),
      parcelas,
      ledgerEntryIds: entries.map((e) => e.id),
      ledgerCount: entries.length,
      processedAt: new Date().toISOString(),
      durationMs: 0,
      contasReceberIds: []
    };

    if (payload.persistirTitulo && this._devePersistirTitulo(evento)) {
      titulo.contasReceberIds = await this._persistirContasReceber(ctx.db, titulo, payload);
      if (titulo.contasReceberIds.length && !titulo.tituloId) {
        titulo.tituloId = titulo.contasReceberIds[0];
      }
    }

    titulo.durationMs = Date.now() - started;
    this._titulos.set(key, titulo);

    await this._auditar(ctx.db, evento, FinancialStatus.COMPLETED, started, {
      handler: this.nome,
      context: titulo.context,
      tituloId: titulo.tituloId,
      parcelas: titulo.parcelas.length,
      ledgerEntryIds: titulo.ledgerEntryIds,
      operationId: titulo.operationId,
      eventId: evento.id,
      traceId: titulo.traceId,
      correlationId: titulo.correlationId,
      origem: evento.origem,
      bridge: payload.bridge || null,
      contasReceberIds: titulo.contasReceberIds
    });

    return { ok: true, titulo };
  }

  _devePersistirTitulo(evento) {
    if (!this.featureFlags) return false;
    const ctx = evento?.context;
    if (ctx === FinancialContext.PDV) {
      return this.featureFlags.isEnabled(FeatureFlag.FEATURE_MFE_PDV_AR);
    }
    if (ctx === FinancialContext.COMERCIAL) {
      return this.featureFlags.isEnabled(FeatureFlag.FEATURE_MFE_COMERCIAL_AR);
    }
    return this.featureFlags.isEnabled(FeatureFlag.FEATURE_MFE_PDV_AR)
      || this.featureFlags.isEnabled(FeatureFlag.FEATURE_MFE_COMERCIAL_AR);
  }

  async _persistirContasReceber(db, titulo, payload) {
    const ids = [];
    const clienteId = titulo.clienteId || payload.cliente_id;
    const vendaId = titulo.vendaId || payload.venda_id;
    if (!clienteId || !vendaId) return ids;

    const tipo = String(titulo.tipoOriginal || '');
    if (tipo === 'SALE_CANCELLED' || tipo === 'VENDA_CANCELADA') {
      return ids;
    }

    for (const parcela of titulo.parcelas || []) {
      const valorParcela = Number(parcela.valor ?? parcela.valor_parcela ?? titulo.valor ?? 0);
      if (!(valorParcela > 0)) continue;
      const venc = parcela.vencimento || parcela.data_vencimento || payload.data_vencimento || null;
      const numero = Number(parcela.numero || parcela.numero_parcela || 1);
      const total = Number(parcela.totalParcelas || parcela.total_parcelas || titulo.parcelas.length || 1);
      const result = await runAsync(db, `
        INSERT INTO contas_receber (
          venda_id, cliente_id, numero_parcela, total_parcelas,
          valor_parcela, valor_restante, data_vencimento, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'aberto')
      `, [
        vendaId,
        clienteId,
        numero,
        total,
        valorParcela,
        Number(parcela.saldo ?? parcela.valor_restante ?? valorParcela),
        venc
      ]);
      if (result.lastID) ids.push(result.lastID);
    }
    return ids;
  }

  _statusPorTipo(tipo, tipoOriginal) {
    const t = String(tipoOriginal || tipo || '');
    if (t === 'SALE_CANCELLED' || t === 'VENDA_CANCELADA' || tipo === 'TITULO_AR_CANCELADO') {
      return FinancialStatus.CANCELLED;
    }
    if (tipo === 'TITULO_AR_BAIXADO' || tipo === 'TITULO_AR_PARCIAL' || t === 'PAYMENT_RECEIVED') {
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
      acao: 'AR_HANDLER',
      origem: evento?.origem,
      operadorId: evento?.operadorId,
      correlationId: evento?.correlationId,
      detalhe: {
        evento: evento?.type,
        eventId: evento?.id,
        status,
        handler: this.nome,
        durationMs: Date.now() - started,
        context: evento?.context || FinancialContext.FINANCEIRO,
        traceId: evento?.traceId || evento?.correlationId,
        idempotencyKey: evento?.idempotencyKey,
        ...extra
      }
    });
  }
}

module.exports = FinancialReceivableHandler;
