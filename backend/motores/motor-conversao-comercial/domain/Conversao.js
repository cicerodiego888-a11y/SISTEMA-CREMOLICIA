/**
 * MCC-02 — ResultadoConversao (ConversaoResult expandido)
 */

const { MOTOR_NOME, MOTOR_VERSAO } = require('./enums');

class ResultadoConversao {
  /**
   * @param {object} props
   */
  constructor(props = {}) {
    this.quantidadeOriginal = Number(
      props.quantidadeOriginal != null ? props.quantidadeOriginal : (props.quantidadeEntrada || 0)
    );
    this.unidadeOrigem = String(props.unidadeOrigem || props.origemConversao || '').toUpperCase();
    this.quantidadeConvertida = Number(props.quantidadeConvertida || 0);
    this.unidadeDestino = String(
      props.unidadeDestino || props.unidadeBase || ''
    ).toUpperCase();
    /** SSOT de estoque (pode diferir de unidadeDestino quando há física) */
    this.unidadeBase = String(props.unidadeBase || '').toUpperCase();
    this.tipoConversao = String(props.tipoConversao || props.tipo || '');
    this.tipo = this.tipoConversao;
    this.fatorAplicado = props.fatorAplicado != null ? Number(props.fatorAplicado) : null;
    this.loteUtilizado = props.loteUtilizado != null ? props.loteUtilizado : null;
    this.origemConversao = String(
      props.origemConversao
      || props.origemFisica
      || props.unidadeOrigem
      || ''
    );
    this.contexto = String(props.contexto || 'OUTROS');
    this.precisao = {
      casasDecimais: props.precisao?.casasDecimais ?? 6,
      arredondamento: props.precisao?.arredondamento ?? 'HALF_UP',
      precisaoComercial: props.precisao?.precisaoComercial ?? null,
      preparado: true,
      aplicado: Boolean(props.precisao?.aplicado)
    };
    this.auditoria = props.auditoria || null;
    this.cadeia = Array.isArray(props.cadeia) ? props.cadeia : [];
    this.motor = MOTOR_NOME;
    this.versao = MOTOR_VERSAO;
    this.cacheHit = Boolean(props.cacheHit);
  }

  static criarAuditoria({
    produtoId = null,
    loteId = null,
    loteCodigo = null,
    origem,
    destino,
    quantidadeEntrada,
    quantidadeConvertida,
    tipo,
    origemFisica = null,
    fator = null,
    contexto,
    passos = [],
    timestamp = null
  }) {
    return {
      produtoId: produtoId != null ? Number(produtoId) : null,
      loteId: loteId != null ? Number(loteId) : null,
      lote: loteCodigo || null,
      origem: String(origem || ''),
      destino: String(destino || ''),
      quantidadeOriginal: Number(quantidadeEntrada || 0),
      quantidadeEntrada: Number(quantidadeEntrada || 0),
      quantidadeConvertida: Number(quantidadeConvertida || 0),
      tipo: String(tipo || ''),
      origemConversao: origemFisica != null ? String(origemFisica) : null,
      fator: fator != null ? Number(fator) : null,
      motor: MOTOR_NOME,
      contexto: String(contexto || 'OUTROS'),
      timestamp: timestamp || new Date().toISOString(),
      passos,
      persistido: false
    };
  }

  toJSON() {
    return {
      quantidadeOriginal: this.quantidadeOriginal,
      unidadeOrigem: this.unidadeOrigem,
      quantidadeConvertida: this.quantidadeConvertida,
      unidadeDestino: this.unidadeDestino,
      unidadeBase: this.unidadeBase,
      tipoConversao: this.tipoConversao,
      tipo: this.tipo,
      fatorAplicado: this.fatorAplicado,
      loteUtilizado: this.loteUtilizado,
      origemConversao: this.origemConversao,
      contexto: this.contexto,
      precisao: this.precisao,
      auditoria: this.auditoria,
      cadeia: this.cadeia,
      motor: this.motor,
      versao: this.versao,
      cacheHit: this.cacheHit
    };
  }
}

module.exports = ResultadoConversao;
