/**
 * MCC-01 — UnidadeComercial (domínio)
 * Representa uma unidade comercial resolvida para conversão.
 */

class UnidadeComercial {
  /**
   * @param {object} props
   * @param {string} props.codigo — ex.: CX, L, UN
   * @param {string} [props.descricao]
   * @param {string} props.tipo — TipoConversao / UC-01 tipo
   * @param {number} props.quantidade — fator em relação à unidade imediatamente inferior / base
   * @param {string} props.unidadeBase — SSOT do produto
   * @param {number} [props.id]
   * @param {boolean} [props.conversaoPorLote]
   */
  constructor(props = {}) {
    this.id = props.id != null ? Number(props.id) : null;
    this.codigo = String(props.codigo || props.unidade_comercial || '').trim().toUpperCase();
    this.descricao = String(props.descricao || this.codigo || '').trim();
    this.tipo = String(props.tipo || 'PADRAO').trim().toUpperCase();
    this.quantidade = Number(props.quantidade != null ? props.quantidade : 1);
    this.unidadeBase = String(props.unidadeBase || props.unidade_base || '').trim().toUpperCase();
    this.conversaoPorLote = Boolean(props.conversaoPorLote || props.conversao_por_lote);
  }

  get isPadrao() {
    return this.tipo === 'PADRAO' || this.codigo === this.unidadeBase;
  }

  static fromUc01Row(row, unidadeBaseProduto) {
    if (!row) return null;
    return new UnidadeComercial({
      id: row.id,
      codigo: row.unidade_comercial,
      descricao: row.descricao,
      tipo: row.tipo,
      quantidade: row.quantidade,
      unidadeBase: row.unidade_base || unidadeBaseProduto,
      conversaoPorLote: row.conversao_por_lote
    });
  }

  static base(unidadeBase) {
    const u = String(unidadeBase || 'UN').toUpperCase();
    return new UnidadeComercial({
      codigo: u,
      descricao: u,
      tipo: 'PADRAO',
      quantidade: 1,
      unidadeBase: u
    });
  }
}

module.exports = UnidadeComercial;
