/**
 * FIS-01 — FiscalOperacionalService
 *
 * Adapter READ-ONLY: recupera da operação original (vendas_itens) a UC,
 * quantidade comercial e quantidade base já convertidas pelo MCC (PDV-01/COM-01).
 *
 * NUNCA chama Converter / nunca recalcula fator.
 *
 * Fluxo: Venda (já convertida) → este serviço → XML NF-e/NFC-e
 */

const { ContextoConversao, MOTOR_NOME } = require('../../domain/enums');

function round4(n) {
  return Math.round(Number(n) * 10000) / 10000;
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

class FiscalOperacionalService {
  /**
   * Indica se o item da venda usou Unidade Comercial (UC-01 / MCC).
   */
  itemTemUnidadeComercial(item = {}) {
    return Boolean(item.unidade_comercial_id || item.unidade_comercial);
  }

  /**
   * Unidade a gravar no documento (uCom / uTrib).
   * Preferência: UC da operação → unidade do produto (base) → UN.
   */
  obterUnidadeDocumento(item = {}) {
    const uc = String(item.unidade_comercial || '').trim();
    if (uc) return uc.toUpperCase();
    const base = String(item.unidade || item.produto_unidade || 'UN').trim();
    return (base || 'UN').toUpperCase();
  }

  /**
   * Quantidade comercial a emitir (qCom).
   * Com UC: quantidade da operação (comercial), rateada se misto fiscal/não-fiscal.
   * Sem UC (legado): quantidade_fiscal (já em base).
   */
  obterQuantidadeComercial(item = {}) {
    if (this.itemTemUnidadeComercial(item)) {
      const qCom = Number(item.quantidade || 0);
      const qFisc = Number(item.quantidade_fiscal || 0);
      const qNao = Number(item.quantidade_nao_fiscal || 0);
      const qBase = qFisc + qNao;
      if (qBase > 0 && qNao > 0) {
        return round4(qCom * (qFisc / qBase));
      }
      return round4(qCom);
    }
    return round4(Number(item.quantidade_fiscal ?? 0));
  }

  /**
   * Quantidade base SSOT (estoque) — apenas leitura/auditoria; não vai no XML como conversão.
   */
  obterQuantidadeBase(item = {}) {
    const qFisc = Number(item.quantidade_fiscal || 0);
    const qNao = Number(item.quantidade_nao_fiscal || 0);
    const soma = qFisc + qNao;
    if (soma > 0) return round4(soma);
    if (this.itemTemUnidadeComercial(item) && Number(item.fator_conversao) > 0) {
      // Snapshot auditável do fator MCC persistido na venda (não recalcula)
      return round4(Number(item.quantidade || 0) * Number(item.fator_conversao));
    }
    return round4(Number(item.quantidade || 0));
  }

  obterValorFiscal(item = {}) {
    return round2(Number(item.valor_fiscal ?? 0));
  }

  obterPrecoUnitarioComercial(item = {}) {
    if (this.itemTemUnidadeComercial(item)) {
      const preco = Number(item.preco_unitario || 0);
      if (preco > 0) return preco;
    }
    const quantidade = this.obterQuantidadeComercial(item);
    const valor = this.obterValorFiscal(item);
    if (quantidade > 0 && valor > 0) {
      return valor / quantidade;
    }
    return Number(item.preco_unitario || 0);
  }

  /**
   * Snapshot oficial para emissão — sem conversão.
   * @param {object} item — linha de vendas_itens (+ joins de produto)
   * @param {object} [meta]
   */
  mapearItemDocumento(item = {}, meta = {}) {
    const contexto = meta.contexto === 'NFE' || meta.contexto === ContextoConversao.NFE
      ? ContextoConversao.NFE
      : ContextoConversao.NFCE;

    const unidadeComercial = this.obterUnidadeDocumento(item);
    const quantidadeComercial = this.obterQuantidadeComercial(item);
    const quantidadeBase = this.obterQuantidadeBase(item);
    const valorFiscal = this.obterValorFiscal(item);
    const precoUnitario = this.obterPrecoUnitarioComercial(item);
    const fatorPersistido = item.fator_conversao != null
      ? Number(item.fator_conversao)
      : null;

    const auditoria = {
      motor: MOTOR_NOME,
      sprint: 'FIS-01',
      contexto,
      produtoId: item.produto_id ?? item.produtoId ?? null,
      unidadeComercial,
      unidadeComercialId: item.unidade_comercial_id ?? null,
      quantidadeComercial,
      quantidadeBase,
      fatorAplicado: fatorPersistido,
      valorFiscal,
      documentoTipo: contexto,
      origemOperacao: meta.origemOperacao || 'VENDA',
      vendaId: meta.vendaId ?? item.venda_id ?? null,
      operadorId: meta.operadorId ?? null,
      timestamp: new Date().toISOString(),
      recalculouConversao: false
    };

    return {
      ok: true,
      unidadeComercial,
      quantidadeComercial,
      quantidadeBase,
      precoUnitario,
      valorFiscal,
      fatorAplicado: fatorPersistido,
      temUnidadeComercial: this.itemTemUnidadeComercial(item),
      auditoria
    };
  }

  /**
   * Mapeia lista de itens da venda para emissão.
   */
  mapearItensDocumento(itens = [], meta = {}) {
    return (itens || []).map((item, idx) => this.mapearItemDocumento(item, {
      ...meta,
      indice: idx
    }));
  }
}

module.exports = FiscalOperacionalService;
