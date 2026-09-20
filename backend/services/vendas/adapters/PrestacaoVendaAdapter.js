/**
 * PrestacaoVendaAdapter — STAB-06 (temporário)
 *
 * Monta payload compatível com criarVenda() do PDV.
 * Sem regra de negócio além do Princípio da Integridade Comercial
 * (valorVenda = valorRecebido + saldoEmAberto) e montagem de payload.
 *
 * @module backend/services/vendas/adapters/PrestacaoVendaAdapter
 */

const POLITICA_ESTOQUE_JA_BAIXADO = 'JA_BAIXADO_CONSIGNACAO';
const ORIGEM_CONSIGNACAO = 'CONSIGNACAO';

/**
 * @param {number} valorVenda
 * @param {number} valorRecebido
 * @returns {{ valorVenda: number, valorRecebido: number, saldoEmAberto: number, situacaoFinanceira: string, integro: boolean }}
 */
function calcularIntegridadeComercial(valorVenda, valorRecebido) {
  const venda = round2(valorVenda);
  const recebido = round2(Math.min(Math.max(0, Number(valorRecebido) || 0), venda));
  const saldoEmAberto = round2(Math.max(0, venda - recebido));
  const integro = Math.abs(venda - (recebido + saldoEmAberto)) <= 0.01;

  let situacaoFinanceira = 'ABERTA';
  if (venda <= 0) situacaoFinanceira = 'SEM_VENDA';
  else if (saldoEmAberto <= 0.01) situacaoFinanceira = 'QUITADA';
  else if (recebido <= 0.01) situacaoFinanceira = 'EM_ABERTO';
  else situacaoFinanceira = 'PARCIALMENTE_RECEBIDA';

  return {
    valorVenda: venda,
    valorRecebido: recebido,
    saldoEmAberto,
    situacaoFinanceira,
    integro
  };
}

/**
 * Resumo oficial para UI (STAB-06).
 */
function buildResumoFinalPrestacao({
  totalVendido = 0,
  totalRecebido = 0,
  emitirFiscal = true,
  temItensFiscais = true
} = {}) {
  const integridade = calcularIntegridadeComercial(totalVendido, totalRecebido);
  const emitiraNfce = Boolean(emitirFiscal && temItensFiscais && integridade.valorVenda > 0);

  return {
    ...integridade,
    situacaoFinanceiraLabel: labelSituacao(integridade.situacaoFinanceira),
    avisos: [
      emitiraNfce
        ? `Será emitida NFC-e sobre ${formatBRL(integridade.valorVenda)}`
        : integridade.valorVenda > 0
          ? 'Venda oficial sem NFC-e (itens não fiscais ou emissão desligada)'
          : 'Sem valor de venda consignada nesta prestação',
      integridade.saldoEmAberto > 0.01
        ? `Será criado saldo financeiro de ${formatBRL(integridade.saldoEmAberto)}`
        : 'Sem saldo financeiro pendente'
    ],
    emitiraNfce
  };
}

/**
 * Mapper Prestação → payload criarVenda.
 *
 * @param {Object} entrada
 * @param {number|string} entrada.consignacaoId
 * @param {number|string} [entrada.prestacaoId]
 * @param {number|string} [entrada.grupoPrestacaoId]
 * @param {number|string} entrada.clienteId
 * @param {Array<{produtoId, quantidade, precoUnitario, quantidadeFiscal?, quantidadeNaoFiscal?}>} entrada.itensVendidos
 * @param {number} entrada.totalVendido
 * @param {number} entrada.totalRecebido
 * @param {boolean} [entrada.emitirFiscal]
 * @param {string} [entrada.formaPagamentoRecebido]
 * @param {string} [entrada.cpfCnpjNota]
 * @returns {Object} body compatível com criarVenda
 */
function montarPayloadCriarVenda(entrada = {}) {
  const itensVendidos = (entrada.itensVendidos || []).filter(
    (i) => Number(i.quantidade || 0) > 0 && Number(i.produtoId || i.produto_id) > 0
  );

  if (!itensVendidos.length) {
    throw new Error('PrestacaoVendaAdapter: nenhum item vendido para gerar venda oficial.');
  }

  if (!entrada.clienteId) {
    throw new Error('PrestacaoVendaAdapter: clienteId é obrigatório.');
  }

  const totalCalculado = round2(
    itensVendidos.reduce(
      (s, i) => s + Number(i.quantidade) * Number(i.precoUnitario ?? i.preco_unitario ?? 0),
      0
    )
  );
  const totalVendido = round2(entrada.totalVendido != null ? entrada.totalVendido : totalCalculado);
  const integridade = calcularIntegridadeComercial(totalVendido, entrada.totalRecebido);

  if (!integridade.integro) {
    throw new Error('PrestacaoVendaAdapter: Integridade Comercial violada (Venda ≠ Recebido + Saldo).');
  }

  const emitirFiscal = entrada.emitirFiscal !== false;
  const itens = itensVendidos.map((i) => {
    const quantidade = Number(i.quantidade);
    const preco = Number(i.precoUnitario ?? i.preco_unitario ?? 0);
    const subtotal = round2(quantidade * preco);
    const item = {
      produto_id: Number(i.produtoId ?? i.produto_id),
      quantidade,
      preco_unitario: preco,
      subtotal,
      desconto_percentual: 0
    };
    if (i.quantidadeFiscal != null || i.quantidade_fiscal != null) {
      item.quantidade_fiscal = Number(i.quantidadeFiscal ?? i.quantidade_fiscal);
    }
    if (i.quantidadeNaoFiscal != null || i.quantidade_nao_fiscal != null) {
      item.quantidade_nao_fiscal = Number(i.quantidadeNaoFiscal ?? i.quantidade_nao_fiscal);
    }
    if (emitirFiscal && item.quantidade_fiscal == null && item.quantidade_nao_fiscal == null) {
      item.quantidade_fiscal = quantidade;
      item.quantidade_nao_fiscal = 0;
      item.valor_fiscal = subtotal;
      item.valor_nao_fiscal = 0;
      item.item_fiscal = 1;
    }
    return item;
  });

  const formaRecebido = String(entrada.formaPagamentoRecebido || 'dinheiro').toLowerCase();
  const pagamentos = [];
  if (integridade.valorRecebido > 0.01) {
    pagamentos.push({
      forma_pagamento: formaRecebido === 'prazo' ? 'dinheiro' : formaRecebido,
      valor: integridade.valorRecebido,
      tipo_recebimento: emitirFiscal ? 'fiscal' : 'nao_fiscal'
    });
  }
  if (integridade.saldoEmAberto > 0.01) {
    pagamentos.push({
      forma_pagamento: 'prazo',
      valor: integridade.saldoEmAberto
    });
  }
  if (!pagamentos.length) {
    pagamentos.push({
      forma_pagamento: 'dinheiro',
      valor: totalVendido,
      tipo_recebimento: emitirFiscal ? 'fiscal' : 'nao_fiscal'
    });
  }

  const forma_pagamento = pagamentos.length > 1
    ? 'misto'
    : (pagamentos[0].forma_pagamento === 'prazo' ? 'prazo' : pagamentos[0].forma_pagamento);

  return {
    cliente_id: Number(entrada.clienteId),
    total: totalVendido,
    desconto: 0,
    forma_pagamento,
    itens,
    pagamentos,
    emitir_fiscal: emitirFiscal,
    valor_recebido: integridade.valorRecebido,
    forcar: true,
    cpf_cnpj_nota: entrada.cpfCnpjNota || null,
    origem: ORIGEM_CONSIGNACAO,
    origem_pdv: 'CONSIGNACAO',
    canal_venda: 'CONSIGNACAO',
    metadata: {
      origem: ORIGEM_CONSIGNACAO,
      consignacaoId: Number(entrada.consignacaoId),
      prestacaoId: entrada.prestacaoId != null ? Number(entrada.prestacaoId) : null,
      grupoPrestacaoId: entrada.grupoPrestacaoId != null
        ? Number(entrada.grupoPrestacaoId)
        : (entrada.prestacaoId != null ? Number(entrada.prestacaoId) : null),
      politicaEstoque: POLITICA_ESTOQUE_JA_BAIXADO,
      valorRecebido: integridade.valorRecebido,
      saldoEmAberto: integridade.saldoEmAberto,
      situacaoFinanceira: integridade.situacaoFinanceira,
      stab: 'STAB-06'
    },
    politicaEstoque: POLITICA_ESTOQUE_JA_BAIXADO
  };
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function formatBRL(n) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(n) || 0);
}

function labelSituacao(codigo) {
  switch (codigo) {
    case 'QUITADA': return 'Quitada';
    case 'PARCIALMENTE_RECEBIDA': return 'Parcialmente Recebida';
    case 'EM_ABERTO': return 'Em Aberto';
    case 'SEM_VENDA': return 'Sem Venda';
    default: return codigo;
  }
}

module.exports = {
  POLITICA_ESTOQUE_JA_BAIXADO,
  ORIGEM_CONSIGNACAO,
  calcularIntegridadeComercial,
  buildResumoFinalPrestacao,
  montarPayloadCriarVenda,
  /** alias mapper */
  mapearPrestacaoParaVenda: montarPayloadCriarVenda
};
