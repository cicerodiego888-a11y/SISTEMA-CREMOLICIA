/**
 * ProjectionApi — API Client alinhado às rotas oficiais de projeção.
 *
 * Sprint O-2: Fluxo Operacional da Consignação.
 *
 * @module frontend/modules/motor-comercial/api/ProjectionApi
 */

const ApiClient = require('./client');
const {
  unwrapData,
  normalizeTimeline,
  normalizeHistorico,
  normalizeResumoPrestacao
} = require('./helpers');

class ProjectionApi {
  constructor(options = {}) {
    this.client = new ApiClient(options);
  }

  async obterProjecaoDashboard(params = {}) {
    const response = await this.client.get('/projections/dashboard', { params });
    return unwrapData(response);
  }

  async obterProjecaoTimeline(params = {}) {
    const response = await this.client.get('/projections/timeline', { params });
    return normalizeTimeline(unwrapData(response));
  }

  async listarTimeline(params = {}) {
    try {
      return await this.obterProjecaoTimeline(params);
    } catch (_error) {
      return [];
    }
  }

  async obterProjecaoIndicadores(params = {}) {
    const response = await this.client.get('/projections/indicadores', { params });
    return unwrapData(response);
  }

  async obterProjecaoInsights(params = {}) {
    const response = await this.client.get('/projections/insights', { params });
    return unwrapData(response);
  }

  async obterProjecaoHistorico(params = {}) {
    const response = await this.client.get('/projections/historico', { params });
    return normalizeHistorico(unwrapData(response));
  }

  async listarMovimentacoes(params = {}) {
    return this.obterProjecaoHistorico(params);
  }

  async obterProjecaoResumoPrestacao(params = {}) {
    const response = await this.client.get('/projections/resumo-prestacao', {
      params: { ...params, _t: Date.now() }
    });
    return normalizeResumoPrestacao(unwrapData(response));
  }

  async obterResumoPrestacao(params = {}) {
    return this.obterProjecaoResumoPrestacao(params);
  }

  async obterProjecaoSaldos(params = {}) {
    const response = await this.client.get('/projections/saldos', { params });
    return unwrapData(response);
  }

  async obterProjecaoContaCorrente(params = {}) {
    const response = await this.client.get('/projections/conta-corrente', { params });
    return unwrapData(response);
  }

  async obterSituacaoCliente(params = {}) {
    const response = await this.client.get('/projections/situacao-cliente', { params });
    return unwrapData(response);
  }

  async obterProjecaoPendencias(params = {}) {
    const response = await this.client.get('/projections/pendencias', { params });
    return unwrapData(response);
  }

  async obterProjecaoRecomendacoes(params = {}) {
    const response = await this.client.get('/projections/recomendacoes', { params });
    return unwrapData(response);
  }

  async obterProjecaoPlaybooks(params = {}) {
    const response = await this.client.get('/projections/playbooks', { params });
    return unwrapData(response);
  }

  async obterProjecaoWorkflow(params = {}) {
    const response = await this.client.get('/projections/workflow', { params });
    return unwrapData(response);
  }
}

module.exports = ProjectionApi;
