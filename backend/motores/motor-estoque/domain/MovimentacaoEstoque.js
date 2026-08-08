/**
 * MCC-04 — Movimentação de estoque (somente quantidade base).
 */

const { OperacaoEstoque, OrigemEstoque, MOTOR_ESTOQUE_NOME } = require('./enums');

class MovimentacaoEstoque {
  constructor(props = {}) {
    this.id = props.id != null ? Number(props.id) : null;
    this.produtoId = Number(props.produtoId ?? props.produto_id);
    this.quantidadeBase = Number(props.quantidadeBase ?? props.quantidade_base);
    this.quantidadeFiscal = Number(props.quantidadeFiscal ?? props.quantidade_fiscal ?? 0);
    this.quantidadeNaoFiscal = Number(
      props.quantidadeNaoFiscal ?? props.quantidade_nao_fiscal ?? 0
    );
    this.operacao = String(props.operacao || '').toUpperCase();
    this.origem = String(props.origem || OrigemEstoque.OUTROS).toUpperCase();
    this.loteId = props.loteId != null
      ? Number(props.loteId)
      : (props.lote_id != null ? Number(props.lote_id) : null);
    this.referenciaTipo = props.referenciaTipo || props.referencia_tipo || null;
    this.referenciaId = props.referenciaId != null
      ? Number(props.referenciaId)
      : (props.referencia_id != null ? Number(props.referencia_id) : null);
    this.saldoAntes = props.saldoAntes != null
      ? Number(props.saldoAntes)
      : (props.saldo_antes != null ? Number(props.saldo_antes) : null);
    this.saldoDepois = props.saldoDepois != null
      ? Number(props.saldoDepois)
      : (props.saldo_depois != null ? Number(props.saldo_depois) : null);
    this.usuarioId = props.usuarioId != null
      ? Number(props.usuarioId)
      : (props.usuario_id != null ? Number(props.usuario_id) : null);
    this.motivo = props.motivo != null ? String(props.motivo) : null;
    this.motor = props.motor || MOTOR_ESTOQUE_NOME;
    this.createdAt = props.createdAt || props.created_at || null;
  }

  static criar(props) {
    return new MovimentacaoEstoque(props);
  }

  validar() {
    const erros = [];
    if (!Number.isFinite(this.produtoId)) erros.push('produtoId obrigatório.');
    if (!Number.isFinite(this.quantidadeBase)) erros.push('quantidadeBase obrigatória.');
    if (!Object.values(OperacaoEstoque).includes(this.operacao)) {
      erros.push(`operacao inválida: ${this.operacao}`);
    }
    if (!Object.values(OrigemEstoque).includes(this.origem)
      && this.origem !== OrigemEstoque.OUTROS) {
      // origem custom permitida via OUTROS / string livre normalizada
    }
    return { ok: erros.length === 0, erros };
  }

  toJSON() {
    return {
      id: this.id,
      produto_id: this.produtoId,
      quantidade_base: this.quantidadeBase,
      quantidade_fiscal: this.quantidadeFiscal,
      quantidade_nao_fiscal: this.quantidadeNaoFiscal,
      operacao: this.operacao,
      origem: this.origem,
      lote_id: this.loteId,
      referencia_tipo: this.referenciaTipo,
      referencia_id: this.referenciaId,
      saldo_antes: this.saldoAntes,
      saldo_depois: this.saldoDepois,
      usuario_id: this.usuarioId,
      motivo: this.motivo,
      motor: this.motor,
      created_at: this.createdAt
    };
  }
}

module.exports = MovimentacaoEstoque;
