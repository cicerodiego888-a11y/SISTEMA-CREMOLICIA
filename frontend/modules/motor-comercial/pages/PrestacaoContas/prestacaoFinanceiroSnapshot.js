/**
 * STAB-06.6.2 — SSOT financeiro da Prestação (somente apresentação).
 *
 * Consolida aliases do resumo/projeção em um único objeto.
 * Componentes NÃO devem recalcular valorVenda / valorRecebido / saldoEmAberto.
 *
 * @module frontend/modules/motor-comercial/pages/PrestacaoContas/prestacaoFinanceiroSnapshot
 */

const SITUACAO = Object.freeze({
  SEM_VENDA: 'SEM_VENDA',
  QUITADA: 'QUITADA',
  EM_ABERTO: 'EM_ABERTO',
  PARCIALMENTE_RECEBIDA: 'PARCIALMENTE_RECEBIDA'
});

const SITUACAO_LABEL = Object.freeze({
  SEM_VENDA: 'Sem Venda',
  QUITADA: 'Quitada',
  EM_ABERTO: 'Em Aberto',
  PARCIALMENTE_RECEBIDA: 'Parcial'
});

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Normaliza uma única vez os totais já vindos da projeção/ledger.
 * Não soma itens — apenas unifica nomes.
 *
 * @param {Object} resumo
 * @returns {{ valorVenda: number, valorRecebido: number, saldoEmAberto: number, situacaoFinanceira: string }}
 */
function buildFinanceiroFromResumo(resumo = {}) {
  const valorVenda = round2(
    resumo.valorVenda
      ?? resumo.valorVendido
      ?? resumo.totalVendido
      ?? 0
  );
  const valorRecebido = round2(
    resumo.valorRecebido
      ?? resumo.totalPago
      ?? resumo.valorPago
      ?? resumo.recebimentos
      ?? 0
  );
  const saldoEmAberto = round2(Math.max(0, valorVenda - valorRecebido));

  let situacaoFinanceira = SITUACAO.SEM_VENDA;
  if (valorVenda > 0.01) {
    if (saldoEmAberto <= 0.01) situacaoFinanceira = SITUACAO.QUITADA;
    else if (valorRecebido <= 0.01) situacaoFinanceira = SITUACAO.EM_ABERTO;
    else situacaoFinanceira = SITUACAO.PARCIALMENTE_RECEBIDA;
  }

  return {
    valorVenda,
    valorRecebido,
    saldoEmAberto,
    situacaoFinanceira
  };
}

/**
 * Histórico de pagamentos a partir do ledger/projeção (somente leitura).
 */
function buildPagamentosHistorico(historico = []) {
  const movs = Array.isArray(historico)
    ? historico
    : (historico?.movimentacoes || historico?.items || historico?.registros || []);

  return movs
    .filter((mov) => {
      const tipo = String(mov.tipoMovimentacao || mov.tipo || '').toUpperCase();
      return tipo === 'PAGAMENTO';
    })
    .map((mov) => {
      const snap = mov.snapshot || {};
      return {
        id: mov.id || null,
        data: mov.createdAt || mov.dataHora || mov.data || snap.dataHora || null,
        forma: mov.formaPagamento
          || snap.formaPagamento
          || snap.operacaoMeta?.formaPagamento
          || snap.meta?.formaPagamento
          || '—',
        valor: round2(mov.valor ?? snap.valor ?? snap.operacaoMeta?.valor ?? 0),
        operador: mov.usuarioNome
          || mov.operador
          || mov.usuario
          || snap.usuarioNome
          || snap.operador
          || snap.usuario
          || '—',
        observacao: mov.observacao
          || snap.observacao
          || snap.observacoes
          || mov.observacoes
          || ''
      };
    })
    .sort((a, b) => {
      const ta = a.data ? new Date(a.data).getTime() : 0;
      const tb = b.data ? new Date(b.data).getTime() : 0;
      return tb - ta;
    });
}

/**
 * SSOT oficial da Prestação (STAB-07.1 / 07.2).
 * Financeiro sempre derivado do resumo/projeção do servidor — nunca do formulário.
 */
function buildPrestacaoSnapshot(resumo = {}, contexto = {}) {
  const financeiro = buildFinanceiroFromResumo(resumo);
  const auditoria = auditarIntegridadeFinanceira(financeiro, {
    ...contexto,
    origem: contexto.origem || 'resumoPrestacao'
  });
  return {
    financeiro,
    itens: Array.isArray(contexto.itens)
      ? contexto.itens
      : (Array.isArray(resumo.itens) ? resumo.itens : []),
    fiscal: contexto.fiscal || null,
    vendaOficial: contexto.vendaOficial || null,
    statusOperacional: contexto.statusOperacional || null,
    pagamentos: Array.isArray(contexto.pagamentos) ? contexto.pagamentos : [],
    timeline: Array.isArray(contexto.timeline) ? contexto.timeline : [],
    logOperacional: Array.isArray(contexto.logOperacional) ? contexto.logOperacional : [],
    auditoria
  };
}

/**
 * Integridade Comercial (apresentação):
 * valorVenda = valorRecebido + saldoEmAberto
 * Não bloqueia o operador — só registra.
 *
 * @param {Object} financeiro
 * @param {Object} [contexto]
 * @returns {Object|null}
 */
function auditarIntegridadeFinanceira(financeiro = {}, contexto = {}) {
  const valorVenda = round2(financeiro.valorVenda);
  const valorRecebido = round2(financeiro.valorRecebido);
  const saldoEmAberto = round2(financeiro.saldoEmAberto);
  const soma = round2(valorRecebido + saldoEmAberto);
  const integro = Math.abs(valorVenda - soma) <= 0.01;

  if (integro) return null;

  const registro = {
    tipo: 'INCONSISTENCIA_FINANCEIRA_PRESTACAO',
    mensagem: 'Inconsistência financeira da Prestação.',
    documento: contexto.documento ?? null,
    cliente: contexto.cliente ?? null,
    clienteId: contexto.clienteId ?? null,
    consignacaoId: contexto.consignacaoId ?? null,
    valores: { valorVenda, valorRecebido, saldoEmAberto, soma },
    origem: contexto.origem || 'snapshot.financeiro',
    em: new Date().toISOString()
  };

  return registro;
}

function labelSituacaoFinanceira(situacaoFinanceira) {
  return SITUACAO_LABEL[situacaoFinanceira] || situacaoFinanceira || '—';
}

/**
 * Garante que um objeto exibido bate com o snapshot (sem recalcular).
 * @returns {boolean}
 */
function assertMesmoFinanceiro(a = {}, b = {}) {
  return round2(a.valorVenda) === round2(b.valorVenda)
    && round2(a.valorRecebido) === round2(b.valorRecebido)
    && round2(a.saldoEmAberto) === round2(b.saldoEmAberto)
    && String(a.situacaoFinanceira || '') === String(b.situacaoFinanceira || '');
}

module.exports = {
  SITUACAO,
  SITUACAO_LABEL,
  round2,
  buildFinanceiroFromResumo,
  buildPagamentosHistorico,
  buildPrestacaoSnapshot,
  auditarIntegridadeFinanceira,
  labelSituacaoFinanceira,
  assertMesmoFinanceiro
};
