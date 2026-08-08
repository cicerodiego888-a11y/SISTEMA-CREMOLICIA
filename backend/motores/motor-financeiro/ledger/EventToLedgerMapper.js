/**
 * MFE-03 — Mapeia FinancialEvent → propostas de LedgerEntry (sem caixa/AR/AP operacionais)
 */

const FinancialEventTypes = require('../events/FinancialEventTypes');
const {
  NaturezaLancamento,
  TipoLancamentoOperacional
} = require('../domain/enums');

const N = NaturezaLancamento;
const T = TipoLancamentoOperacional;
const E = FinancialEventTypes;
const { resolverTipoEventoParaPipeline } = FinancialEventTypes;

/** Defaults estruturais por tipo de evento */
const MAPA_EVENTO = Object.freeze({
  [E.VENDA_RECEBIDA]: { tipoLancamento: T.RECEITA, natureza: N.CREDITO, contaFinanceira: 'CAIXA', historico: 'Receita de venda' },
  [E.VENDA_CANCELADA]: { tipoLancamento: T.ESTORNO, natureza: N.DEBITO, contaFinanceira: 'CAIXA', historico: 'Estorno de venda' },
  [E.TITULO_AR_CRIADO]: { tipoLancamento: T.RECEITA, natureza: N.CREDITO, contaFinanceira: 'AR', historico: 'Título a receber criado' },
  [E.TITULO_AR_ATUALIZADO]: { tipoLancamento: T.AJUSTE, natureza: N.CREDITO, contaFinanceira: 'AR', historico: 'Título a receber atualizado', allowZero: true },
  [E.TITULO_AR_CANCELADO]: { tipoLancamento: T.ESTORNO, natureza: N.DEBITO, contaFinanceira: 'AR', historico: 'Título a receber cancelado' },
  [E.TITULO_AR_BAIXADO]: { tipoLancamento: T.RECEITA, natureza: N.CREDITO, contaFinanceira: 'CAIXA', historico: 'Baixa de título a receber' },
  [E.TITULO_AR_PARCIAL]: { tipoLancamento: T.RECEITA, natureza: N.CREDITO, contaFinanceira: 'CAIXA', historico: 'Baixa parcial de título a receber' },
  [E.TITULO_AR_VENCIDO]: { tipoLancamento: T.AJUSTE, natureza: N.DEBITO, contaFinanceira: 'AR', historico: 'Título a receber vencido', allowZero: true },
  [E.TITULO_AR_RENEGOCIADO]: { tipoLancamento: T.AJUSTE, natureza: N.CREDITO, contaFinanceira: 'AR', historico: 'Título a receber renegociado', allowZero: true },
  [E.TITULO_AP_CRIADO]: { tipoLancamento: T.DESPESA, natureza: N.DEBITO, contaFinanceira: 'AP', historico: 'Título a pagar criado' },
  [E.TITULO_AP_ATUALIZADO]: { tipoLancamento: T.AJUSTE, natureza: N.DEBITO, contaFinanceira: 'AP', historico: 'Título a pagar atualizado', allowZero: true },
  [E.TITULO_AP_CANCELADO]: { tipoLancamento: T.ESTORNO, natureza: N.CREDITO, contaFinanceira: 'AP', historico: 'Título a pagar cancelado' },
  [E.TITULO_AP_BAIXADO]: { tipoLancamento: T.DESPESA, natureza: N.DEBITO, contaFinanceira: 'BANCO', historico: 'Baixa de título a pagar' },
  [E.TITULO_AP_PARCIAL]: { tipoLancamento: T.DESPESA, natureza: N.DEBITO, contaFinanceira: 'BANCO', historico: 'Baixa parcial de título a pagar' },
  [E.TITULO_AP_VENCIDO]: { tipoLancamento: T.AJUSTE, natureza: N.DEBITO, contaFinanceira: 'AP', historico: 'Título a pagar vencido', allowZero: true },
  [E.TITULO_AP_RENEGOCIADO]: { tipoLancamento: T.AJUSTE, natureza: N.DEBITO, contaFinanceira: 'AP', historico: 'Título a pagar renegociado', allowZero: true },
  [E.CAIXA_ABERTO]: { tipoLancamento: T.ABERTURA_CAIXA, natureza: N.CREDITO, contaFinanceira: 'CAIXA', historico: 'Abertura de caixa', allowZero: true },
  [E.CAIXA_FECHADO]: { tipoLancamento: T.FECHAMENTO_CAIXA, natureza: N.DEBITO, contaFinanceira: 'CAIXA', historico: 'Fechamento de caixa', allowZero: true },
  [E.CAIXA_SANGRIA]: { tipoLancamento: T.SANGRIA, natureza: N.DEBITO, contaFinanceira: 'CAIXA', historico: 'Sangria de caixa' },
  [E.CAIXA_SUPRIMENTO]: { tipoLancamento: T.SUPRIMENTO, natureza: N.CREDITO, contaFinanceira: 'CAIXA', historico: 'Suprimento de caixa' },
  [E.CAIXA_AJUSTE]: { tipoLancamento: T.AJUSTE, natureza: N.CREDITO, contaFinanceira: 'CAIXA', historico: 'Ajuste de caixa' },
  [E.CAIXA_CONCILIACAO]: { tipoLancamento: T.AJUSTE, natureza: N.CREDITO, contaFinanceira: 'CAIXA', historico: 'Conciliação de caixa', allowZero: true },
  [E.PIX_RECEBIDO]: { tipoLancamento: T.PIX, natureza: N.CREDITO, contaFinanceira: 'BANCO', historico: 'PIX recebido' },
  [E.PIX_ESTORNADO]: { tipoLancamento: T.ESTORNO, natureza: N.DEBITO, contaFinanceira: 'BANCO', historico: 'PIX estornado' },
  [E.TEF_APROVADO]: { tipoLancamento: T.TEF, natureza: N.CREDITO, contaFinanceira: 'BANCO', historico: 'TEF aprovado' },
  [E.TEF_CANCELADO]: { tipoLancamento: T.ESTORNO, natureza: N.DEBITO, contaFinanceira: 'BANCO', historico: 'TEF cancelado' },
  [E.TRANSFERENCIA_BANCARIA]: { tipoLancamento: T.TRANSFERENCIA, natureza: N.DEBITO, contaFinanceira: 'BANCO', historico: 'Transferência bancária' },
  [E.AJUSTE_FINANCEIRO]: { tipoLancamento: T.AJUSTE, natureza: N.CREDITO, contaFinanceira: 'AJUSTES', historico: 'Ajuste financeiro' },
  [E.CONCILIACAO_REALIZADA]: { tipoLancamento: T.AJUSTE, natureza: N.CREDITO, contaFinanceira: 'CONCILIACAO', historico: 'Conciliação realizada', allowZero: true },
  [E.ESTORNO_FINANCEIRO]: { tipoLancamento: T.ESTORNO, natureza: N.DEBITO, contaFinanceira: 'CAIXA', historico: 'Estorno financeiro' },
  [E.PRESTACAO_RECEBIDA]: { tipoLancamento: T.RECEITA, natureza: N.CREDITO, contaFinanceira: 'CAIXA', historico: 'Prestação recebida' },
  /* MFE-07 — Liquidação */
  [E.LIQUIDACAO_REALIZADA]: { tipoLancamento: T.RECEITA, natureza: N.CREDITO, contaFinanceira: 'CAIXA', historico: 'Liquidação financeira' },
  [E.PIX_LIQUIDADO]: { tipoLancamento: T.PIX, natureza: N.CREDITO, contaFinanceira: 'BANCO', historico: 'Liquidação PIX' },
  [E.TEF_LIQUIDADO]: { tipoLancamento: T.TEF, natureza: N.CREDITO, contaFinanceira: 'BANCO', historico: 'Liquidação TEF' },
  [E.DINHEIRO_LIQUIDADO]: { tipoLancamento: T.DINHEIRO, natureza: N.CREDITO, contaFinanceira: 'CAIXA', historico: 'Liquidação em dinheiro' },
  [E.CARTAO_LIQUIDADO]: { tipoLancamento: T.CARTAO, natureza: N.CREDITO, contaFinanceira: 'BANCO', historico: 'Liquidação cartão' },
  [E.CHEQUE_LIQUIDADO]: { tipoLancamento: T.RECEITA, natureza: N.CREDITO, contaFinanceira: 'BANCO', historico: 'Liquidação cheque' },
  [E.TRANSFERENCIA_LIQUIDADA]: { tipoLancamento: T.TRANSFERENCIA, natureza: N.CREDITO, contaFinanceira: 'BANCO', historico: 'Liquidação transferência' },
  [E.BOLETO_LIQUIDADO]: { tipoLancamento: T.BOLETO, natureza: N.CREDITO, contaFinanceira: 'BANCO', historico: 'Liquidação boleto' },
  [E.LIQUIDACAO_ESTORNADA]: { tipoLancamento: T.ESTORNO, natureza: N.DEBITO, contaFinanceira: 'CAIXA', historico: 'Estorno de liquidação' },
  [E.LIQUIDACAO_FALHOU]: { tipoLancamento: T.AJUSTE, natureza: N.DEBITO, contaFinanceira: 'AJUSTES', historico: 'Liquidação falhou', allowZero: true }
});

function extrairValor(payload = {}, allowZero = false) {
  const bruto = Number(
    payload.valor
      ?? payload.valorTotal
      ?? payload.amount
      ?? (allowZero ? 0 : undefined)
  );
  if (!Number.isFinite(bruto)) return allowZero ? 0 : 0;
  return Math.abs(bruto);
}

/**
 * Gera automaticamente 1+ propostas de lançamento a partir do evento.
 * Prioriza `payload.ledgerEntries` se o produtor declarar; senão usa o mapa oficial.
 */
function proporLancamentosDoEvento(evento) {
  const payload = (evento && evento.payload) || {};
  if (Array.isArray(payload.ledgerEntries) && payload.ledgerEntries.length > 0) {
    return payload.ledgerEntries.map((item) => ({
      ...item,
      valor: Math.abs(Number(item.valor ?? 0)),
      contaFinanceira: item.contaFinanceira || item.conta,
      tipoLancamento: item.tipoLancamento || item.tipoOperacional || T.OUTROS,
      natureza: item.natureza
        || (item.tipo === 'DEBITO' ? N.DEBITO : N.CREDITO)
    }));
  }

  const def = MAPA_EVENTO[resolverTipoEventoParaPipeline(evento.type)] || MAPA_EVENTO[evento.type] || {
    tipoLancamento: T.OUTROS,
    natureza: N.CREDITO,
    contaFinanceira: 'GERAL',
    historico: `Evento ${evento.type}`,
    allowZero: true
  };

  const valor = extrairValor(payload, def.allowZero);
  // Garante geração automática mesmo sem valor no payload (marcador estrutural mínimo)
  const valorFinal = valor > 0 ? valor : (def.allowZero ? 0 : 0.01);

  return [{
    tipoLancamento: def.tipoLancamento,
    natureza: def.natureza,
    contaFinanceira: payload.contaFinanceira || payload.conta || def.contaFinanceira,
    centroCusto: payload.centroCusto || null,
    historico: payload.historico || def.historico,
    valor: valorFinal,
    moeda: payload.moeda || 'BRL'
  }];
}

module.exports = {
  MAPA_EVENTO,
  proporLancamentosDoEvento
};
