/**
 * FinanceiroPlatformGateway — Integração real com módulo financeiro CDS.
 *
 * Sprint O-13
 *
 * @module motores/motor-comercial/bridges/platform/FinanceiroPlatformGateway
 */

const moment = require('moment');
const { dbGet, dbRun } = require('./dbHelpers');

function emitirEventoComercialArMfe(db, operacao) {
  try {
    const { publicarEventoComercialArMfe } = require('../../../motor-financeiro/adapters');
    Promise.resolve(publicarEventoComercialArMfe(db, operacao)).catch((err) => {
      console.error('[MFE-05.1] emitirEventoComercialArMfe:', err?.message || err);
    });
  } catch (err) {
    console.error('[MFE-05.1] bridge Comercial indisponível:', err?.message || err);
  }
}

class FinanceiroPlatformGateway {
  /**
   * @param {Object} deps
   * @param {Object} deps.db
   */
  constructor(deps = {}) {
    this._db = deps.db;
  }

  /**
   * @param {Object} dados
   * @returns {Promise<Object>}
   */
  async registrarReceitaConsignacao(dados) {
    const consignacao = await this._obterConsignacao(dados.consignacaoId);
    const valor = Number(dados.valor ?? 0);
    const dataMovimento = moment().format('YYYY-MM-DD');

    const financeiroId = await this._inserirMovimentacao({
      tipo: 'receita',
      descricao: `Receita consignação #${dados.consignacaoId}`,
      valor,
      data_movimento: dataMovimento,
      categoria: 'CONSIGNACAO',
      referencia_id: String(dados.consignacaoId),
      referencia_tipo: 'consignacao_venda',
      status: 'recebido',
      origem: 'motor-comercial',
      pessoa_nome: consignacao?.cliente_nome ?? null,
      observacao: dados.correlationId ? `correlationId=${dados.correlationId}` : null
    });

    emitirEventoComercialArMfe(this._db, {
      tipo: 'credito_gerado',
      eventType: 'COMMERCIAL_CREDIT_GENERATED',
      consignacao_id: dados.consignacaoId,
      cliente_id: consignacao?.cliente_id ?? null,
      valor,
      correlationId: dados.correlationId || null,
      persistirTitulo: false,
      idempotencyKey: `comercial-ar:credit-gen:${dados.consignacaoId}:${financeiroId}`
    });

    return {
      financeiroId,
      consignacaoId: dados.consignacaoId,
      valor,
      tipo: 'RECEITA_CONSIGNACAO',
      correlationId: dados.correlationId,
      origem: 'platform:financeiro'
    };
  }

  /**
   * @param {Object} dados
   * @returns {Promise<Object>}
   */
  async registrarRecebimento(dados) {
    const consignacao = await this._obterConsignacao(dados.consignacaoId);
    const valor = Number(dados.valor ?? 0);
    const dataMovimento = moment().format('YYYY-MM-DD');

    const financeiroId = await this._inserirMovimentacao({
      tipo: 'receita',
      descricao: `Pagamento prestação consignação #${dados.consignacaoId}`,
      valor,
      data_movimento: dataMovimento,
      categoria: 'CONSIGNACAO',
      referencia_id: String(dados.consignacaoId),
      referencia_tipo: 'consignacao_pagamento',
      status: 'recebido',
      origem: 'motor-comercial',
      pessoa_nome: consignacao?.cliente_nome ?? null,
      observacao: dados.correlationId ? `correlationId=${dados.correlationId}` : null
    });

    emitirEventoComercialArMfe(this._db, {
      tipo: 'credito_usado',
      eventType: 'COMMERCIAL_CREDIT_USED',
      consignacao_id: dados.consignacaoId,
      cliente_id: consignacao?.cliente_id ?? null,
      valor,
      correlationId: dados.correlationId || null,
      persistirTitulo: false,
      idempotencyKey: `comercial-ar:credit-used:${dados.consignacaoId}:${financeiroId}`
    });

    emitirEventoComercialArMfe(this._db, {
      tipo: 'pagamento_recebido',
      eventType: 'PAYMENT_RECEIVED',
      consignacao_id: dados.consignacaoId,
      cliente_id: consignacao?.cliente_id ?? null,
      valor,
      correlationId: dados.correlationId || null,
      persistirTitulo: false,
      idempotencyKey: `comercial-ar:pay:${dados.consignacaoId}:${financeiroId}`
    });

    return {
      financeiroId,
      consignacaoId: dados.consignacaoId,
      valor,
      tipo: 'RECEBIMENTO',
      correlationId: dados.correlationId,
      origem: 'platform:financeiro'
    };
  }

  /**
   * @param {Object} dados
   * @returns {Promise<Object>}
   */
  async registrarPerda(dados) {
    const consignacao = await this._obterConsignacao(dados.consignacaoId);
    const valor = Number(dados.valor ?? 0);
    const dataMovimento = moment().format('YYYY-MM-DD');

    const financeiroId = await this._inserirMovimentacao({
      tipo: 'despesa',
      descricao: `Perda consignação #${dados.consignacaoId}`,
      valor,
      data_movimento: dataMovimento,
      categoria: 'CONSIGNACAO_PERDA',
      referencia_id: String(dados.consignacaoId),
      referencia_tipo: 'consignacao_perda',
      status: 'pago',
      origem: 'motor-comercial',
      pessoa_nome: consignacao?.cliente_nome ?? null,
      observacao: dados.correlationId ? `correlationId=${dados.correlationId}` : null
    });

    return {
      financeiroId,
      consignacaoId: dados.consignacaoId,
      valor,
      tipo: 'PERDA',
      correlationId: dados.correlationId,
      origem: 'platform:financeiro'
    };
  }

  /**
   * @param {string|number} clienteId
   * @returns {Promise<Object>}
   */
  async consultarSaldo(clienteId) {
    const rows = await dbGet(this._db, `
      SELECT
        COALESCE(SUM(CASE WHEN status = 'aberto' THEN valor ELSE 0 END), 0) AS total_em_aberto
      FROM contas_receber
      WHERE cliente_id = ?
    `, [clienteId]);

    return {
      clienteId,
      saldoDevedor: Number(rows?.total_em_aberto ?? 0),
      origem: 'platform:contas_receber'
    };
  }

  /**
   * @private
   * @param {string|number} consignacaoId
   */
  async _obterConsignacao(consignacaoId) {
    return dbGet(this._db, `
      SELECT c.id, c.cliente_id, cl.nome AS cliente_nome
      FROM consignacoes c
      LEFT JOIN clientes cl ON cl.id = c.cliente_id
      WHERE c.id = ?
    `, [consignacaoId]);
  }

  /**
   * @private
   * @param {Object} data
   * @returns {Promise<number>}
   */
  async _inserirMovimentacao(data) {
    const status = data.status || (data.tipo === 'receita' ? 'recebido' : 'pago');
    const result = await dbRun(this._db, `
      INSERT INTO financeiro (
        tipo, descricao, valor, data_movimento, categoria, forma_pagamento,
        referencia_id, referencia_tipo, status, origem, documento, vencimento,
        numero_parcela, total_parcelas, compra_id, venda_id, pessoa_nome, observacao,
        baixado_em
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      data.tipo,
      data.descricao,
      data.valor,
      data.data_movimento,
      data.categoria || null,
      data.forma_pagamento || null,
      data.referencia_id || null,
      data.referencia_tipo || null,
      status,
      data.origem || 'motor-comercial',
      data.documento || null,
      data.vencimento || data.data_movimento,
      data.numero_parcela || null,
      data.total_parcelas || null,
      data.compra_id || null,
      data.venda_id || null,
      data.pessoa_nome || null,
      data.observacao || null,
      ['pago', 'recebido'].includes(status) ? data.data_movimento : null
    ]);

    return result.lastID;
  }
}

module.exports = FinanceiroPlatformGateway;
