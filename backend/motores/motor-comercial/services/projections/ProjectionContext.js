/**
 * ProjectionContext — Contexto compartilhado entre Projection Services.
 *
 * Sprint 2.4.4: leitura/projeção — sem regras de negócio.
 *
 * @class ProjectionContext
 */

class ProjectionContext {
  /**
   * @param {Object} [dados]
   */
  constructor(dados = {}) {
    this.clienteId = dados.clienteId ?? null;
    this.consignacaoId = dados.consignacaoId ?? null;
    this.perfilComercialId = dados.perfilComercialId ?? null;
    this.grupoPrestacaoContasId = dados.grupoPrestacaoContasId ?? null;
    this.documentoNumero = dados.documentoNumero ?? null;
    this.tipoMovimentacao = dados.tipoMovimentacao ?? null;
    this.usuarioId = dados.usuarioId ?? null;
    this.origem = dados.origem ?? null;
    this.correlationId = dados.correlationId ?? null;
    this.dataInicio = dados.dataInicio ?? null;
    this.dataFim = dados.dataFim ?? null;
    this.limite = dados.limite ?? null;
    this.offset = dados.offset ?? 0;
    this.ordenacao = dados.ordenacao ?? 'ASC';
    this.configuracoes = dados.configuracoes ?? {};
  }

  /**
   * @param {Object|null|undefined} plain
   * @returns {ProjectionContext}
   */
  static create(plain) {
    return new ProjectionContext(plain || {});
  }

  /**
   * @returns {Object}
   */
  toFiltrosComercial() {
    const filtros = {};
    // RCM-8.11 — com grupo, o ciclo é a unidade oficial (não AND com consignacaoId)
    if (this.grupoPrestacaoContasId) {
      filtros.grupoPrestacaoContasId = this.grupoPrestacaoContasId;
    } else if (this.consignacaoId != null) {
      filtros.consignacaoId = this.consignacaoId;
    }
    if (this.tipoMovimentacao) filtros.tipoMovimentacao = this.tipoMovimentacao;
    if (this.correlationId) filtros.correlationId = this.correlationId;
    if (this.dataInicio && this.dataFim) {
      filtros.dataInicio = this.dataInicio;
      filtros.dataFim = this.dataFim;
    }
    if (this.limite != null) filtros.limite = this.limite;
    if (this.offset) filtros.offset = this.offset;
    return filtros;
  }

  /**
   * @returns {Object}
   */
  toFiltrosPerfil() {
    const filtros = {};
    if (this.perfilComercialId != null) filtros.perfilComercialId = this.perfilComercialId;
    if (this.clienteId != null) filtros.clienteId = this.clienteId;
    if (this.tipoMovimentacao) filtros.tipoMovimentacao = this.tipoMovimentacao;
    if (this.correlationId) filtros.correlationId = this.correlationId;
    if (this.dataInicio && this.dataFim) {
      filtros.dataInicio = this.dataInicio;
      filtros.dataFim = this.dataFim;
    }
    if (this.limite != null) filtros.limite = this.limite;
    if (this.offset) filtros.offset = this.offset;
    return filtros;
  }

  /**
   * @returns {Object}
   */
  toFiltrosConsignacao() {
    const filtros = {};
    if (this.clienteId != null) filtros.clienteId = this.clienteId;
    if (this.perfilComercialId != null) filtros.perfilComercialId = this.perfilComercialId;
    if (this.documentoNumero) filtros.documentoNumero = this.documentoNumero;
    if (this.limite != null) filtros.limite = this.limite;
    if (this.offset) filtros.offset = this.offset;
    return filtros;
  }

  /**
   * @returns {Object}
   */
  toJSON() {
    return {
      clienteId: this.clienteId,
      consignacaoId: this.consignacaoId,
      perfilComercialId: this.perfilComercialId,
      grupoPrestacaoContasId: this.grupoPrestacaoContasId,
      documentoNumero: this.documentoNumero,
      tipoMovimentacao: this.tipoMovimentacao,
      usuarioId: this.usuarioId,
      origem: this.origem,
      correlationId: this.correlationId,
      dataInicio: this.dataInicio,
      dataFim: this.dataFim,
      limite: this.limite,
      offset: this.offset,
      ordenacao: this.ordenacao,
      configuracoes: this.configuracoes
    };
  }
}

module.exports = ProjectionContext;
