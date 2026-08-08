/**
 * Mapeadores do Extrato — apenas campos da API (sem cálculo financeiro).
 *
 * Sprint O-6.
 *
 * @module frontend/modules/motor-comercial/pages/ContaCorrente/extratoMappers
 */

const FAVORITES_KEY = 'motor-comercial:extrato-filtros-favoritos';

const TIPO_LABELS = {
  ENTREGA: 'Entrega',
  VENDA_PRESTACAO: 'Venda',
  VENDA: 'Venda',
  DEVOLUCAO: 'Devolução',
  PERDA: 'Perda',
  CORTESIA: 'Cortesia',
  PAGAMENTO: 'Pagamento',
  ABERTURA_PRESTACAO: 'Fechamento iniciado',
  FECHAMENTO_PRESTACAO: 'Fechamento concluído',
  TRANSFERENCIA_SAIDA: 'Transferência',
  TRANSFERENCIA_ENTRADA: 'Transferência',
  LIBERACAO_GERENCIAL: 'Liberação Gerencial',
  ALTERACAO_LIMITE: 'Alteração Limite',
  REABERTURA_PRESTACAO: 'Fechamento reaberto',
  ENCERRAMENTO: 'Encerramento',
  CANCELAMENTO: 'Cancelamento',
  PERFIL_CRIADO: 'Perfil criado'
};

function pick(obj, path) {
  if (!obj || !path) return undefined;
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function readValue(sources, paths) {
  for (const source of sources) {
    for (const path of paths) {
      const v = pick(source, path) ?? source?.[path];
      if (v !== undefined && v !== null) return v;
    }
  }
  return null;
}

/**
 * Saldo do cabeçalho = quanto o cliente deve (SSOT CreditoComercial).
 * Prefere situacao/conta-corrente.saldoDevedor; saldoEmAberto (só AR) vem por último.
 */
function buildResumoFinanceiro(contaCorrente = {}, saldos = {}, situacao = {}) {
  const sources = [situacao, contaCorrente, contaCorrente.totais || {}, saldos];
  return {
    saldoInicial: readValue(sources, ['saldoInicial']),
    entradas: readValue(sources, ['entradas', 'vendas', 'totalEntradas', 'entregas']),
    saidas: readValue(sources, ['saidas', 'totalSaidas']),
    recebimentos: readValue(sources, ['pagamentos', 'recebimentos', 'valorRecebido', 'saldoRecebido']),
    perdas: readValue(sources, ['perdas', 'valorPerdido', 'saldoPerdido']),
    cortesias: readValue(sources, ['cortesias', 'valorCortesia', 'saldoCortesia']),
    devolucoes: readValue(sources, ['devolucoes', 'saldoDevolvido', 'valorDevolvido']),
    saldoAtual: readValue(sources, ['saldoDevedor', 'saldoAtual', 'saldo', 'saldoEmAberto']),
    limiteComercial: readValue(sources, ['limiteComercial', 'limite']),
    limiteUtilizado: readValue(sources, ['limiteUtilizado', 'limiteConsumido']),
    limiteDisponivel: readValue(sources, ['limiteDisponivel', 'creditoDisponivel'])
  };
}

function mapExtratoRow(mov) {
  const tipo = mov.tipo || mov.tipoMovimentacao || '-';
  const descricao = mov.descricao
    || mov.descricaoResumo
    || mov.motivo
    || mov.observacao
    || TIPO_LABELS[tipo]
    || '-';
  return {
    id: mov.id,
    data: mov.data || mov.dataMovimentacao,
    documento: mov.documento || mov.documentoNumero
      || (mov.consignacaoId != null ? `Consignação #${mov.consignacaoId}` : '-'),
    tipo,
    tipoLabel: TIPO_LABELS[tipo] || tipo,
    descricao,
    entrada: mov.entrada ?? mov.valorEntrada ?? (mov.direcao === 'ENTRADA' ? mov.valor : null),
    saida: mov.saida ?? mov.valorSaida ?? (mov.direcao === 'SAIDA' ? mov.valor : null),
    valor: mov.valor,
    saldoProjetado: mov.saldoProjetado ?? mov.saldoApos ?? mov.saldoAcumulado ?? null,
    operador: mov.usuarioId || mov.usuario || mov.operador || '-',
    origem: mov.origem || mov.ledger || 'Sistema',
    status: mov.status || mov.situacao || 'CONFIRMADO',
    correlationId: mov.correlationId || '-',
    requestId: mov.requestId || '-',
    raw: mov
  };
}

/**
 * Extrato oficial: lançamentos da Conta Corrente (geraContaCorrente).
 * Histórico completo só como fallback (sem ruído de perfil / abertura).
 */
function buildExtrato(contaCorrente = {}, historico = {}) {
  const lancamentos = contaCorrente.lancamentos || [];
  if (lancamentos.length) {
    return lancamentos.map(mapExtratoRow);
  }

  const movimentacoes = Array.isArray(historico)
    ? historico
    : (historico.movimentacoes || historico.registros || historico.items || []);

  const TIPOS_EXTRATO = new Set([
    'ENTREGA', 'DEVOLUCAO', 'VENDA_PRESTACAO', 'VENDA',
    'PERDA', 'CORTESIA', 'PAGAMENTO',
    'TRANSFERENCIA_SAIDA', 'TRANSFERENCIA_ENTRADA',
    'FECHAMENTO_PRESTACAO', 'REABERTURA_PRESTACAO',
    'ENCERRAMENTO', 'CANCELAMENTO', 'AJUSTE_VALOR', 'ESTORNO'
  ]);

  return movimentacoes
    .filter((m) => {
      const tipo = m.tipo || m.tipoMovimentacao;
      if (m.ledger === 'PERFIL') return false;
      return TIPOS_EXTRATO.has(tipo);
    })
    .map(mapExtratoRow);
}

function buildIndicadores(indicadores = {}, contaCorrente = {}, saldos = {}) {
  const merged = { ...indicadores, ...saldos, ...contaCorrente };
  return [
    { label: 'Recebimentos', value: merged.pagamentos ?? merged.valorRecebido, format: 'currency' },
    { label: 'Saldo Médio', value: merged.saldoMedio, format: 'currency' },
    { label: 'Tempo Médio Recebimento', value: merged.tempoMedioRecebimento, format: 'days' },
    { label: 'Maior Recebimento', value: merged.maiorRecebimento, format: 'currency' },
    { label: 'Maior Perda', value: merged.maiorPerda, format: 'currency' },
    { label: 'Maior Cortesia', value: merged.maiorCortesia, format: 'currency' },
    { label: 'Maior Saldo', value: merged.maiorSaldo, format: 'currency' },
    { label: 'Evolução Financeira', value: merged.evolucaoFinanceira ?? merged.evolucao, format: 'text' }
  ];
}

function buildGraficos(indicadores = {}, contaCorrente = {}) {
  const graficos = indicadores.graficos || contaCorrente.graficos || {};
  return {
    entradasSaidas: graficos.entradasSaidas || [],
    saldoPorPeriodo: graficos.saldoPorPeriodo || [],
    recebimentos: graficos.recebimentos || [],
    perdas: graficos.perdas || [],
    cortesias: graficos.cortesias || [],
    evolucaoDiaria: graficos.evolucaoDiaria || indicadores.evolucaoDiaria || []
  };
}

function buildAlertas(dashboard = {}, insights = {}, situacao = {}) {
  const alertas = [
    ...(dashboard.alertas || []),
    ...(situacao.alertas || []),
    ...(insights.alertas || [])
  ];
  return alertas.map((a, i) => ({
    id: a.id || a.codigo || `alerta-${i}`,
    tipo: a.tipo || 'ALERTA',
    severidade: a.severidade || 'INFO',
    mensagem: a.mensagem || a.message || a.titulo || ''
  }));
}

function buildPendencias(dashboard = {}, extrato = []) {
  const pendencias = dashboard.pendencias || [];
  if (pendencias.length) return pendencias;
  return extrato
    .filter((row) => row.status && row.status !== 'CONFIRMADO')
    .slice(0, 5);
}

function applyExtratoFilters(rows, filters = {}) {
  let result = [...rows];
  const q = (filters.search || '').toLowerCase();

  if (q) {
    result = result.filter((row) => {
      const blob = [row.documento, row.descricao, row.operador, row.tipo, row.tipoLabel, row.correlationId]
        .map((v) => String(v || '').toLowerCase()).join(' ');
      return blob.includes(q);
    });
  }

  if (filters.tipo) {
    result = result.filter((row) => row.tipo === filters.tipo);
  }
  if (filters.documento) {
    const term = filters.documento.toLowerCase();
    result = result.filter((row) => String(row.documento).toLowerCase().includes(term));
  }
  if (filters.operador) {
    const term = filters.operador.toLowerCase();
    result = result.filter((row) => String(row.operador).toLowerCase().includes(term));
  }
  if (filters.status) {
    result = result.filter((row) => row.status === filters.status);
  }
  if (filters.valorMin != null && filters.valorMin !== '') {
    result = result.filter((row) => Number(row.valor || row.entrada || row.saida || 0) >= Number(filters.valorMin));
  }
  if (filters.valorMax != null && filters.valorMax !== '') {
    result = result.filter((row) => Number(row.valor || row.entrada || row.saida || 0) <= Number(filters.valorMax));
  }

  return result;
}

function saveFilterFavorite(nome, filters) {
  const favorites = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
  favorites.push({ nome, filters, savedAt: new Date().toISOString() });
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
}

function loadFilterFavorites() {
  try {
    return JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
  } catch {
    return [];
  }
}

module.exports = {
  TIPO_LABELS,
  buildResumoFinanceiro,
  buildExtrato,
  buildIndicadores,
  buildGraficos,
  buildAlertas,
  buildPendencias,
  applyExtratoFilters,
  saveFilterFavorite,
  loadFilterFavorites,
  mapExtratoRow
};
