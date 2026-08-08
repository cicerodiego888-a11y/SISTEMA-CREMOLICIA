/**
 * Badges operacionais — Central de Operações Comerciais.
 *
 * Sprint O-3 + RCM-04.B (badges padronizados).
 *
 * @module frontend/modules/motor-comercial/pages/Consignacoes/badges
 */

const Badge = require('../../components/base/Badge');

/** Labels e cores oficiais RCM-04.B */
const STATUS_BADGES = {
  RASCUNHO: { variant: 'default', text: 'RASCUNHO' },
  PREPARACAO: { variant: 'info', text: 'PREPARAÇÃO' },
  EM_ENTREGA: { variant: 'info', text: 'EM ENTREGA' },
  ENTREGUE: { variant: 'primary', text: 'ENTREGUE' },
  PRESTACAO_PENDENTE: { variant: 'warning', text: 'PRESTAÇÃO PENDENTE' },
  PRESTACAO_ABERTA: { variant: 'warning', text: 'PRESTAÇÃO PENDENTE' },
  FINALIZADA: { variant: 'success', text: 'FINALIZADA' },
  ACERTADA: { variant: 'success', text: 'FINALIZADA' },
  ENCERRADA: { variant: 'success', text: 'FINALIZADA' },
  QUITADA: { variant: 'success', text: 'FINALIZADA' },
  CANCELADA: { variant: 'error', text: 'CANCELADA' },
  ATRASADA: { variant: 'error', text: 'PRESTAÇÃO PENDENTE' },
  URGENTE: { variant: 'error', text: 'PRESTAÇÃO PENDENTE' }
};

/**
 * Resolve badge visual padronizado a partir do status de domínio + flags.
 */
function resolveOperationalStatus(consignacao) {
  if (!consignacao) return 'RASCUNHO';
  const raw = String(consignacao.status || '').toUpperCase();

  if (raw === 'CANCELADA') return 'CANCELADA';
  if (raw === 'ACERTADA' || raw === 'ENCERRADA' || raw === 'QUITADA' || raw === 'FINALIZADA') {
    return 'FINALIZADA';
  }
  if (raw === 'EM_ENTREGA' || raw === 'EM ENTREGA') return 'EM_ENTREGA';
  if (raw === 'PREPARACAO' || raw === 'PREPARAÇÃO' || raw === 'PREPARACAO') return 'PREPARACAO';

  if (raw === 'ENTREGUE') {
    if (consignacao.prestacaoAberta || consignacao.prestacaoAtrasada || consignacao.urgente) {
      return 'PRESTACAO_PENDENTE';
    }
    return 'ENTREGUE';
  }

  if (raw === 'RASCUNHO') {
    const temItens = Number(consignacao.quantidadeItens || consignacao.itens?.length || 0) > 0;
    return temItens ? 'PREPARACAO' : 'RASCUNHO';
  }

  if (consignacao.operationalStatus) return consignacao.operationalStatus;
  return raw || 'RASCUNHO';
}

function createOperationalBadge(consignacao) {
  const status = resolveOperationalStatus(consignacao);
  const config = STATUS_BADGES[status] || { variant: 'default', text: status };
  return Badge.create({ text: config.text, variant: config.variant });
}

function enrichConsignacaoOperationalFlags(item, resumoMap = {}) {
  const resumo = resumoMap[item.id] || {};
  const status = String(item.status || '').toUpperCase();
  const isRascunho = status === 'RASCUNHO' || status === 'PREPARACAO' || status === 'PREPARAÇÃO';
  const saldo = isRascunho
    ? null
    : Number(resumo.saldoAtual ?? resumo.saldo ?? item.saldoAberto ?? 0);
  const entrega = item.dataEntrega ? new Date(item.dataEntrega) : null;
  const diasDesdeEntrega = entrega
    ? Math.floor((Date.now() - entrega.getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  const prestacaoAberta = status === 'ENTREGUE' && Number(saldo || 0) > 0;
  const prestacaoAtrasada = prestacaoAberta && diasDesdeEntrega > 30;
  const urgente = prestacaoAberta && diasDesdeEntrega > 45;

  // RCM-04.B — RASCUNHO/PREPARAÇÃO não exibem R$ 0,00; aguardam entrega
  const valor = isRascunho
    ? null
    : Number(
      resumo.valorConsignado
        ?? resumo.valorVendido
        ?? item.valorTotalEntregue
        ?? item.valor
        ?? 0
    );

  const enriched = {
    ...item,
    prestacaoAberta,
    prestacaoAtrasada,
    urgente,
    saldo: isRascunho ? null : saldo,
    valor,
    valorLabel: isRascunho ? 'Aguardando Entrega' : null,
    aguardandoEntrega: isRascunho,
    prestacaoStatus: isRascunho
      ? 'AGUARDANDO_ENTREGA'
      : (prestacaoAberta ? 'ABERTA' : (status === 'ACERTADA' || status === 'FINALIZADA' ? 'FECHADA' : '-'))
  };

  return {
    ...enriched,
    operationalStatus: resolveOperationalStatus(enriched)
  };
}

module.exports = {
  STATUS_BADGES,
  resolveOperationalStatus,
  createOperationalBadge,
  enrichConsignacaoOperationalFlags
};
