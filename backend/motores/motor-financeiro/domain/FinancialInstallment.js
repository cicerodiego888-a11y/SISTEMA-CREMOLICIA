/**
 * MFE-05 — FinancialInstallment (Parcela)
 * Infraestrutura de parcelamento — sem regras complexas.
 */

const { FinancialStatus, MOEDA_PADRAO } = require('./enums');
const { FinancialValidationError } = require('./errors');

const InstallmentStatus = Object.freeze({
  ABERTO: 'ABERTO',
  PAGO: 'PAGO',
  PARCIAL: 'PARCIAL',
  CANCELADO: 'CANCELADO',
  VENCIDO: 'VENCIDO',
  RENEGOCIADO: 'RENEGOCIADO'
});

class FinancialInstallment {
  constructor(props = {}) {
    this.id = props.id ?? null;
    this.tituloId = props.tituloId || props.titulo_id || props.receivableId || null;
    this.numero = props.numero != null ? Number(props.numero) : null;
    this.totalParcelas = props.totalParcelas != null
      ? Number(props.totalParcelas)
      : (props.total_parcelas != null ? Number(props.total_parcelas) : null);
    this.valor = props.valor != null ? Number(props.valor) : null;
    this.saldo = props.saldo != null
      ? Number(props.saldo)
      : (props.valor_restante != null ? Number(props.valor_restante) : this.valor);
    this.vencimento = props.vencimento || props.data_vencimento || null;
    this.status = props.status || InstallmentStatus.ABERTO;
    this.moeda = props.moeda || MOEDA_PADRAO;
    this.metadata = props.metadata && typeof props.metadata === 'object' ? { ...props.metadata } : {};
  }

  static criar(props = {}) {
    return new FinancialInstallment(props);
  }

  /**
   * Gera N parcelas iguais (infraestrutura). Sem juros/regras.
   */
  static gerarParcelas({ valorTotal, quantidade, primeiroVencimento, tituloId } = {}) {
    const qtd = Number(quantidade || 0);
    const total = Number(valorTotal || 0);
    if (!(qtd > 0) || !(total >= 0)) return [];
    const base = Math.floor((total / qtd) * 100) / 100;
    const parcelas = [];
    let acumulado = 0;
    for (let i = 1; i <= qtd; i += 1) {
      const valor = i === qtd
        ? Math.round((total - acumulado) * 100) / 100
        : base;
      acumulado += valor;
      parcelas.push(FinancialInstallment.criar({
        tituloId: tituloId || null,
        numero: i,
        totalParcelas: qtd,
        valor,
        saldo: valor,
        vencimento: primeiroVencimento || null,
        status: InstallmentStatus.ABERTO
      }));
    }
    return parcelas;
  }

  validar() {
    const erros = [];
    if (!(this.numero > 0)) erros.push('numero da parcela inválido');
    if (this.valor == null || !Number.isFinite(this.valor) || this.valor < 0) {
      erros.push('valor inválido');
    }
    if (this.saldo == null || !Number.isFinite(this.saldo) || this.saldo < 0) {
      erros.push('saldo inválido');
    }
    if (!this.status) erros.push('status é obrigatório');
    return { ok: erros.length === 0, erros };
  }

  assertValid() {
    const v = this.validar();
    if (!v.ok) throw new FinancialValidationError(v.erros);
    return this;
  }

  toJSON() {
    return {
      id: this.id,
      tituloId: this.tituloId,
      numero: this.numero,
      totalParcelas: this.totalParcelas,
      valor: this.valor,
      saldo: this.saldo,
      vencimento: this.vencimento,
      status: this.status,
      moeda: this.moeda,
      metadata: this.metadata
    };
  }
}

FinancialInstallment.Status = InstallmentStatus;
FinancialInstallment.FinancialStatus = FinancialStatus;

module.exports = FinancialInstallment;
