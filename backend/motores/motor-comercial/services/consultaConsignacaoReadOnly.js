/**
 * RCM-8.0 — Consulta e reimpressão de consignação (somente leitura).
 *
 * Mapeia estados já persistidos. Não cria enumeração nova no banco.
 * Não consulta Resolver, Tabela de Preços ou MUC.
 */

function normalizarId(valor) {
  if (valor == null || valor === '') return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

/**
 * Quando há contexto de cliente, a consignação precisa pertencer a ele.
 * Sem clienteId, a consulta segue o escopo do token (listagens internas).
 */
function consignacaoPertenceAoCliente(consignacao, clienteId) {
  const esperado = normalizarId(clienteId);
  if (esperado == null) return true;
  if (!consignacao) return false;
  const atual = normalizarId(consignacao.clienteId ?? consignacao.cliente_id);
  return atual != null && atual === esperado;
}

/**
 * Labels de consulta — não são novos status de persistência.
 *
 * | Persistido                         | Label          |
 * | RASCUNHO                           | Em preparação  |
 * | ENTREGUE                           | Entregue       |
 * | pagamento parcial com saldo        | Parcial        |
 * | ACERTADA                           | Acertada       |
 * | ENCERRADA / prestação FECHADA      | Encerrada      |
 * | QUITADA                            | Quitada        |
 * | CANCELADA                          | Cancelada      |
 */
function mapStatusConsultaConsignacao(consignacao = {}) {
  const status = String(consignacao.status || '').toUpperCase();
  const prestacao = consignacao.prestacaoContasAtiva || consignacao.prestacaoContas || {};
  const prestacaoStatus = String(prestacao.status || consignacao.prestacaoStatus || '').toUpperCase();
  const saldo = Number(consignacao.saldoAberto ?? consignacao.saldo ?? 0);
  const pago = Number(consignacao.valorTotalPago ?? 0);
  const acertado = Number(consignacao.valorTotalAcertado ?? 0);

  if (status === 'CANCELADA') {
    return { codigo: status, label: 'Cancelada' };
  }
  if (status === 'RASCUNHO') {
    return { codigo: status, label: 'Em preparação' };
  }
  if (status === 'QUITADA') {
    return { codigo: status, label: 'Quitada' };
  }
  if (status === 'ENCERRADA' || status === 'FECHADA' || prestacaoStatus === 'FECHADA') {
    return {
      codigo: status === 'ENCERRADA' || status === 'FECHADA' ? status : (status || 'ENCERRADA'),
      label: 'Encerrada'
    };
  }
  if (status === 'ACERTADA') {
    return { codigo: status, label: saldo > 0 ? 'Parcial' : 'Acertada' };
  }
  if ((pago > 0 && saldo > 0) || (acertado > 0 && saldo > 0)) {
    return { codigo: status || 'ENTREGUE', label: 'Parcial' };
  }
  if (status === 'ENTREGUE') {
    return { codigo: status, label: 'Entregue' };
  }
  return { codigo: status || 'DESCONHECIDO', label: status || '—' };
}

function extrairCanalOperacao(consignacao = {}, itens = []) {
  const doHeader = consignacao.canalOperacao || consignacao.canalVenda;
  if (doHeader) return String(doHeader).toUpperCase();
  const itemComCanal = (itens || []).find((it) => it.canalVenda || it.canal_venda);
  if (itemComCanal) {
    return String(itemComCanal.canalVenda || itemComCanal.canal_venda).toUpperCase();
  }
  return 'CONSIGNADO';
}

function extrairTabelaPrecoId(consignacao = {}, itens = []) {
  if (consignacao.tabelaPrecoId != null) return consignacao.tabelaPrecoId;
  const item = (itens || []).find((it) => it.tabelaPrecoId != null || it.tabela_preco_id != null);
  return item ? (item.tabelaPrecoId ?? item.tabela_preco_id) : null;
}

function somarItensSnapshot(itens = []) {
  return (itens || []).reduce((acc, item) => {
    const qtd = Number(item.quantidadeEntregue ?? item.quantidade ?? 0);
    const preco = Number(item.precoUnitario ?? item.valorUnitario ?? item.preco ?? 0);
    const total = item.precoTotal != null
      ? Number(item.precoTotal)
      : (item.subtotalEntregue != null ? Number(item.subtotalEntregue) : qtd * preco);
    return acc + (Number.isFinite(total) ? total : 0);
  }, 0);
}

module.exports = {
  normalizarId,
  consignacaoPertenceAoCliente,
  mapStatusConsultaConsignacao,
  extrairCanalOperacao,
  extrairTabelaPrecoId,
  somarItensSnapshot
};
