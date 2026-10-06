/**
 * SincronizacaoResultadoDTO — Contrato de resultado da sincronização DF-e.
 *
 * @class SincronizacaoResultadoDTO
 */

class SincronizacaoResultadoDTO {
  /**
   * @param {Object} [dados]
   */
  constructor(dados = {}) {
    this.sucesso = dados.sucesso ?? false;
    this.notasNovas = dados.notasNovas ?? dados.notas_novas ?? 0;
    this.notasDuplicadas = dados.notasDuplicadas ?? dados.notas_duplicadas ?? 0;
    this.ignorados = dados.ignorados ?? 0;
    this.ultNsu = dados.ultNsu ?? dados.ult_nsu ?? null;
    this.maxNsu = dados.maxNsu ?? dados.max_nsu ?? null;
    this.iteracoes = dados.iteracoes ?? 0;
    this.cStat = dados.cStat ?? null;
    this.xMotivo = dados.xMotivo ?? dados.x_motivo ?? null;
    this.mensagem = dados.mensagem ?? null;
    this.ultimaSincronizacao = dados.ultimaSincronizacao ?? dados.ultima_sincronizacao ?? null;
    this.erros = dados.erros ?? [];
    this.erro = dados.erro ?? null;
    this.janelaSefaz = dados.janelaSefaz ?? null;
    this.proximaConsultaApos = dados.proximaConsultaApos ?? null;
    this.operacional = dados.operacional ?? Boolean(dados.erro?.operacional);
  }

  /**
   * @param {Object|null|undefined} plain
   * @returns {SincronizacaoResultadoDTO}
   */
  static create(plain) {
    return new SincronizacaoResultadoDTO(plain || {});
  }

  /**
   * @param {*} error
   * @returns {Object}
   */
  static fromError(error) {
    const { classificarErroSefaz } = require('../../../services/fiscal/sefazErroOperacional');
    const classificado = classificarErroSefaz(error);
    return SincronizacaoResultadoDTO.create({
      sucesso: false,
      notasNovas: 0,
      notasDuplicadas: 0,
      cStat: error?.cStat ?? null,
      xMotivo: error?.xMotivo ?? null,
      erros: [classificado.mensagem],
      mensagem: classificado.mensagem,
      erro: classificado,
      janelaSefaz: error?.janelaSefaz ?? null,
      operacional: classificado.operacional
    }).toJSON();
  }

  /**
   * @returns {Object}
   */
  toJSON() {
    return {
      sucesso: this.sucesso,
      notasNovas: this.notasNovas,
      notasDuplicadas: this.notasDuplicadas,
      ignorados: this.ignorados,
      ultNsu: this.ultNsu,
      maxNsu: this.maxNsu,
      iteracoes: this.iteracoes,
      cStat: this.cStat,
      xMotivo: this.xMotivo,
      mensagem: this.mensagem,
      ultimaSincronizacao: this.ultimaSincronizacao,
      erros: this.erros,
      erro: this.erro,
      janelaSefaz: this.janelaSefaz,
      proximaConsultaApos: this.proximaConsultaApos,
      operacional: this.operacional
    };
  }
}

module.exports = SincronizacaoResultadoDTO;
