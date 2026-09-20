/**
 * CDS Mobile — Mappers Comercial (paridade mapConsignacaoView / operacional Desktop)
 * Apenas normalização de exibição — sem regras de negócio / sem recalcular crédito.
 */

/**
 * Número da API sem inventar zero quando o campo não veio.
 * @param {*} v
 * @returns {number|null}
 */
export function numFromApi(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Igual Desktop Number(x ?? 0) — só quando a UI precisa de número.
 * @param {*} v
 * @param {number} [fallback=0]
 */
export function numOrZero(v, fallback = 0) {
  const n = numFromApi(v);
  return n == null ? fallback : n;
}

export function formatDocumento(documento, fallbackId) {
  if (!documento) {
    return fallbackId != null ? `Consignação #${fallbackId}` : '—';
  }
  if (typeof documento === 'string') return documento;
  if (documento.numero) return String(documento.numero);
  if (documento.serie && documento.sequencial != null) {
    return `${documento.serie}-${documento.sequencial}`;
  }
  return fallbackId != null ? `Consignação #${fallbackId}` : '—';
}

export function resolveClienteLabel(consignacao, extras = {}) {
  if (extras.clienteNome) return extras.clienteNome;
  if (consignacao?.clienteNome) return consignacao.clienteNome;
  if (consignacao?.cliente_nome) return consignacao.cliente_nome;
  if (consignacao?.nome_cliente) return consignacao.nome_cliente;
  if (consignacao?.nome) return consignacao.nome;
  if (consignacao?.razaoSocial) return consignacao.razaoSocial;
  if (consignacao?.nomeFantasia) return consignacao.nomeFantasia;
  const cliente = consignacao?.cliente;
  if (!cliente) {
    const id = consignacao?.clienteId ?? consignacao?.cliente_id ?? consignacao?.id;
    return id != null ? `Cliente #${id}` : '—';
  }
  if (typeof cliente === 'string') return cliente;
  if (typeof cliente === 'number') return String(cliente);
  return (
    cliente.nome ||
    cliente.razaoSocial ||
    cliente.nomeFantasia ||
    (consignacao?.clienteId != null ? `Cliente #${consignacao.clienteId}` : '—')
  );
}

export function unwrapProjection(payload) {
  if (!payload) return null;
  let data = payload;
  if (payload.data !== undefined && typeof payload.data === 'object') {
    data = payload.data;
  }
  // Algumas projeções ainda aninham { dados, totais, metadata }
  if (data && typeof data === 'object' && !Array.isArray(data) && data.dados != null) {
    if (typeof data.dados === 'object' && !Array.isArray(data.dados)) {
      return { ...data.dados, _totais: data.totais || null, _metadata: data.metadata || null };
    }
    return data;
  }
  return data;
}

/**
 * Espelha campos oficiais de GET /projections/situacao-cliente (SituacaoClienteDTO).
 * Não recalcula crédito — só lê a API.
 */
export function normalizeSituacaoCliente(raw) {
  const s = unwrapProjection(raw);
  if (!s || typeof s !== 'object') return null;
  return {
    clienteId: s.clienteId ?? null,
    perfil: s.perfil ?? null,
    limite: numFromApi(s.limite),
    limiteComercial: numFromApi(s.limiteComercial ?? s.limite),
    saldo: numFromApi(s.saldo),
    saldoDevedor: numFromApi(s.saldoDevedor ?? s.saldo),
    saldoCredor: numFromApi(s.saldoCredor),
    creditoDisponivel: numFromApi(s.creditoDisponivel ?? s.limiteDisponivel),
    limiteDisponivel: numFromApi(s.limiteDisponivel ?? s.creditoDisponivel),
    saldoEmAberto: numFromApi(s.saldoEmAberto ?? s.saldo),
    consignacoesAbertas: Array.isArray(s.consignacoesAbertas) ? s.consignacoesAbertas : [],
    prestacaoAtiva: s.prestacaoAtiva ?? null,
    ultimaMovimentacao: s.ultimaMovimentacao ?? null,
    ultimoPagamento: s.ultimoPagamento ?? null,
    statusGeral: s.statusGeral ?? s.situacao ?? null,
    clienteNome: s.clienteNome ?? s.nome ?? null,
    raw: s
  };
}

/**
 * Paridade Desktop NovaConsignacao._applyClientePerfil — montagem de exibição.
 * créditoDisponivel / saldo vêm de situacao (CreditoComercialService no backend).
 */
export function buildClienteProfileView(cliente, perfil, situacao) {
  const sit = situacao || {};
  const p = perfil || {};
  return {
    id: p.id ?? null,
    nome: p.clienteNome || cliente?.nome || resolveClienteLabel(cliente),
    documento: p.cpfCnpj || cliente?.cpf_cnpj || cliente?.documento || null,
    telefone: cliente?.telefone || p.telefone || null,
    cidade: cliente?.cidade || cliente?.municipio || null,
    perfilComercial: p.perfilTipo || p.tipo || null,
    perfilNome: p.nome || p.descricao || p.perfilTipo || null,
    limiteComercial: numOrZero(p.limiteComercial ?? sit.limiteComercial ?? p.limite),
    // STAB-02: crédito exclusivo da API — sem fallback local de cálculo
    limiteDisponivel: numOrZero(sit.creditoDisponivel ?? sit.limiteDisponivel),
    saldo: numOrZero(sit.saldoDevedor ?? sit.saldoEmAberto ?? sit.saldo ?? p.saldoAberto),
    saldoDevedor: numOrZero(sit.saldoDevedor ?? sit.saldo),
    saldoCredor: numOrZero(sit.saldoCredor),
    creditoDisponivel: numOrZero(sit.creditoDisponivel ?? sit.limiteDisponivel),
    creditoUtilizado: numOrZero(
      sit.saldoDevedor ?? sit.saldoEmAberto ?? sit.saldo ?? p.saldoAberto
    ),
    situacao: sit.statusGeral || sit.situacao || (p.bloqueado ? 'BLOQUEADO' : 'ATIVO'),
    consignacoesAbertas: sit.consignacoesAbertas || [],
    prestacaoAtiva: sit.prestacaoAtiva ?? null,
    ultimaMovimentacao: sit.ultimaMovimentacao ?? null,
    ultimoPagamento: sit.ultimoPagamento ?? null
  };
}

export function perfilLimiteOf(perfil) {
  return numFromApi(
    perfil?.limiteComercial ?? perfil?.limite ?? perfil?.limite_credito ?? perfil?.limiteCredito
  );
}

export function preferPerfilConsignado(perfis = []) {
  const items = Array.isArray(perfis) ? perfis : [];
  const consignado = items.find((p) => String(p.perfilTipo || p.tipo || '').toUpperCase() === 'CONSIGNADO');
  return consignado || items[0] || null;
}

export function mapConsignacaoView(consignacao, extras = {}) {
  if (!consignacao) return null;
  const itens = extras.itens || consignacao.itens || consignacao.items || [];
  const valorRaw =
    extras.valor ??
    consignacao.valorTotalEntregue ??
    consignacao.valor_total ??
    consignacao.valorTotal ??
    consignacao.total;
  const saldoRaw =
    extras.saldo ??
    consignacao.saldoAberto ??
    consignacao.saldo_aberto ??
    consignacao.saldo;
  return {
    ...consignacao,
    documentoLabel: formatDocumento(
      consignacao.numero_documento || consignacao.documento,
      consignacao.id
    ),
    clienteNome: resolveClienteLabel(consignacao, extras),
    valorExibido: numOrZero(valorRaw),
    saldoExibido: numOrZero(saldoRaw),
    itens,
    perfilNome:
      extras.perfilNome ||
      consignacao.consignado ||
      consignacao.perfilComercialNome ||
      consignacao.perfilComercialId
  };
}

export function normalizeResumoPrestacao(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw.data ?? raw.payload ?? raw;
  if (!data || typeof data !== 'object') return null;
  return {
    valorVendido: numFromApi(data.valorVendido ?? data.totalVendido ?? data.vendido),
    valorRecebido: numFromApi(data.valorRecebido ?? data.totalPago ?? data.valorPago ?? data.pago),
    saldoAtual: numFromApi(data.saldoAtual ?? data.saldo ?? data.saldoAberto),
    vendaId: data.vendaId ?? data.venda_id ?? null,
    situacaoFiscal: data.situacaoFiscal ?? data.situacao_fiscal ?? null,
    notaId: data.notaId ?? data.nota_id ?? data.nfceId ?? null,
    xmlAutorizado: data.xmlAutorizado ?? data.xml_autorizado ?? data.xml ?? null,
    itens: Array.isArray(data.itens) ? data.itens : [],
    raw: data
  };
}

export function normalizeConsignacaoStatus(c) {
  return String(c?.status || '').trim().toUpperCase();
}

/** Encerrada no domínio (prestação já fechada). */
export function isStatusConsignacaoFinalizada(st) {
  const s = String(st || '').trim().toUpperCase();
  return /^(ACERTADA|ENCERRADA|QUITADA|FINALIZADA|FECHADA)$/.test(s);
}

/**
 * Badge de lista — paridade Desktop (badges.js).
 * ACERTADA/ENCERRADA/QUITADA = FINALIZADA, não “pendente”.
 */
export function badgeStatusConsignacao(c) {
  const st = normalizeConsignacaoStatus(c);
  if (st === 'CANCELADA') return 'CANCELADA';
  if (isStatusConsignacaoFinalizada(st)) return 'FINALIZADA';
  if (st === 'ENTREGUE' || st === 'EM_PRESTACAO') {
    const prest = c?.prestacaoContasAtiva || c?.prestacao_contas_ativa;
    const prestAberta = String(prest?.status || '').toUpperCase() === 'ABERTA';
    if (prestAberta) return 'PRESTACAO_PENDENTE';
    return 'ENTREGUE';
  }
  if (!st || st === 'RASCUNHO' || st === 'DRAFT') return 'RASCUNHO';
  if (st === 'PREPARACAO' || st === 'PREPARAÇÃO') return 'PREPARACAO';
  return st;
}

export function isConsignacaoAbertaOperacional(c) {
  const st = normalizeConsignacaoStatus(c);
  if (!st || st === 'CANCELADA' || isStatusConsignacaoFinalizada(st)) return false;
  return (
    st === 'RASCUNHO'
    || st === 'DRAFT'
    || st === 'PREPARACAO'
    || st === 'PREPARAÇÃO'
    || st === 'EM_ENTREGA'
    || st === 'EM ENTREGA'
    || st === 'ENTREGUE'
    || st === 'EM_PRESTACAO'
  );
}

/** Fase operacional — alinhada a badges.js + PrestacaoContas Desktop. */
export function deriveComercialPhase(c, resumoPrest = null, resumoFinal = null) {
  const st = normalizeConsignacaoStatus(c) || String(c?.situacao || '').trim().toUpperCase();
  const isDraft = !st || st === 'RASCUNHO' || st === 'DRAFT' || st === 'PREPARACAO' || st === 'PREPARAÇÃO';
  const isCancelada = st === 'CANCELADA';
  const isEncerrada = isStatusConsignacaoFinalizada(st);
  const isEntregue = st === 'ENTREGUE' || st === 'EM_PRESTACAO';

  const saldo = numOrZero(
    resumoPrest?.saldoAtual ??
      resumoFinal?.saldoAtual ??
      resumoFinal?.saldo ??
      c?.saldoExibido ??
      c?.saldoAberto ??
      c?.saldo_aberto ??
      c?.saldo
  );

  const prestacaoAtiva = isEntregue && !isEncerrada && saldo > 0.01;
  const vendaId = resumoFinal?.vendaId ?? resumoPrest?.vendaId ?? c?.vendaId ?? c?.venda_id ?? null;
  const situacaoFiscal = String(
    resumoFinal?.situacaoFiscal ?? resumoPrest?.situacaoFiscal ?? ''
  ).toUpperCase();
  const fiscalAutorizada = situacaoFiscal === 'AUTORIZADA';

  return {
    st,
    isDraft,
    isCancelada,
    isEncerrada,
    isEntregue,
    prestacaoAtiva,
    saldo,
    vendaId: vendaId ? Number(vendaId) : null,
    fiscalAutorizada,
    situacaoFiscal
  };
}

export function historicoItems(raw) {
  const data = unwrapProjection(raw);
  if (!data) return [];
  if (Array.isArray(data)) return data;
  return data.movimentacoes || data.registros || data.eventos || data.items || [];
}

export function contaCorrenteItems(raw) {
  const data = unwrapProjection(raw);
  if (!data) return [];
  if (Array.isArray(data)) return data;
  return data.movimentos || data.lancamentos || data.items || data.registros || [];
}

export function contaCorrenteTotais(raw) {
  const data = unwrapProjection(raw);
  if (!data || typeof data !== 'object') return null;
  return data._totais || data.totais || null;
}

export function pendenciasItems(raw) {
  const data = unwrapProjection(raw);
  if (!data) return [];
  if (Array.isArray(data)) return data;
  return data.pendencias || data.items || data.alertas || data.registros || [];
}
