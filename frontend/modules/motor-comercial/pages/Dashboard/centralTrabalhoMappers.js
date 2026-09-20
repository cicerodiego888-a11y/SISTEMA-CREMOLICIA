/**
 * Mapeadores da Central de Trabalho Comercial — UX-03 / UX-09 / UX-10.
 *
 * UX-10: máquina de estados operacionais (E1–E6).
 * Uma consignação = um card operacional (mesmo cliente pode ter várias).
 * Sem concorrência entre blocos para a MESMA consignação.
 *
 * @module frontend/modules/motor-comercial/pages/Dashboard/centralTrabalhoMappers
 */

const { mapConsignacaoView } = require('../../api/helpers');
const { mapPerfilListItem } = require('../PerfilComercial/perfilMappers');
const {
  findConsignacaoEmEntrega,
  findConsignacaoEmPrestacao
} = require('../PerfilComercial/centralOperacoesMappers');
const { buildViewFromPayload } = require('../Pendencias/pendenciasMappers');
const { normalizeTimelineEvents } = require('../PerfilComercial/cliente360Mappers');
const {
  podeAdicionarProdutoComplementar
} = require('../EntregaComplementar/entregaComplementarMappers');

/** Estados oficiais UX-10 */
const ESTADOS = {
  E1: 'E1',
  E2: 'E2',
  E3: 'E3',
  E4: 'E4',
  E5: 'E5',
  E6: 'E6',
  RISCO: 'RISCO'
};

/** Ordem da fila operacional (Trabalho Prioritário): E2 → E3 → E4 */
const ORDEM_FILA = { E2: 0, E3: 1, E4: 2, RISCO: -1 };

/** Status UX de prestação (nomenclatura da sprint) */
const PRESTACAO_STATUS = {
  EM_ANDAMENTO: 'EM_ANDAMENTO',
  PRONTO_PARA_FECHAR: 'PRONTO_PARA_FECHAR',
  ENCERRADA: 'ENCERRADA',
  NENHUMA: 'NENHUMA'
};

function isNomeClienteFallback(nome) {
  const raw = String(nome || '').trim();
  if (!raw) return true;
  if (/^cliente\s*#\s*\d+$/i.test(raw)) return true;
  if (/^\d+$/.test(raw)) return true;
  return false;
}

function resolverNomeTrabalho(clienteId, { alerta = null, consignacoes = [], perfis = [] } = {}) {
  const id = String(clienteId);
  const perfil = perfis.find((p) => String(p.clienteId) === id);
  const consignacao = consignacoes.find((c) => String(c.clienteId) === id);
  const candidatos = [
    perfil?.clienteNome,
    perfil?.cliente,
    consignacao?.clienteNome,
    typeof consignacao?.cliente === 'string' ? consignacao.cliente : null,
    alerta?.cliente,
    alerta?.clienteNome
  ].filter((n) => n != null && String(n).trim() !== '');

  const real = candidatos.find((n) => !isNomeClienteFallback(n));
  if (real) return String(real).trim();
  if (candidatos.length) return String(candidatos[0]).trim();
  return clienteId ? `Cliente #${clienteId}` : 'Cliente';
}

function getOperadorNome() {
  try {
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    const nome = user?.nome || user?.username || 'Operador';
    return nome.split(' ')[0];
  } catch {
    return 'Operador';
  }
}

function buildSaudacao(resumoDia = [], consignadosPendentes = [], trabalhoPrioritario = []) {
  const now = new Date();
  const h = now.getHours();
  const periodo = h < 12 ? 'Bom dia' : (h < 18 ? 'Boa tarde' : 'Boa noite');
  const emoji = h < 12 ? '☀️' : (h < 18 ? '👋' : '🌙');
  const nome = getOperadorNome();
  const data = now.toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
  const hora = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  const fechamentos = resumoDia.find((i) => i.key === 'prestacoes')?.valor || 0;
  const saldoClientes = consignadosPendentes.length
    || resumoDia.find((i) => i.key === 'limite')?.valor
    || 0;
  const fila = trabalhoPrioritario.length;

  const destaques = [];
  if (fechamentos > 0) {
    destaques.push({
      tom: 'urgent',
      texto: `${fechamentos} atendimento${fechamentos === 1 ? '' : 's'} aguardando fechamento`
    });
  }
  if (saldoClientes > 0) {
    destaques.push({
      tom: 'ready',
      texto: `${saldoClientes} cliente${saldoClientes === 1 ? '' : 's'} com saldo para receber`
    });
  }
  if (!destaques.length && fila > 0) {
    destaques.push({
      tom: 'info',
      texto: `${fila} item${fila === 1 ? '' : 's'} na sua fila de trabalho`
    });
  }

  const recomendado = trabalhoPrioritario[0];
  let mensagem = 'Nenhuma urgência no momento. Bom trabalho.';
  if (recomendado?.clienteNome && recomendado?.acaoLabel) {
    const acao = String(recomendado.acaoLabel).toLowerCase();
    if (/fechar/i.test(acao)) {
      mensagem = `Seu próximo atendimento recomendado é finalizar a prestação de contas de ${recomendado.clienteNome}.`;
    } else if (/continuar entrega/i.test(acao)) {
      mensagem = `Seu próximo atendimento recomendado é continuar a entrega de ${recomendado.clienteNome}.`;
    } else if (/continuar atendimento/i.test(acao)) {
      mensagem = `Seu próximo atendimento recomendado é continuar o atendimento de ${recomendado.clienteNome}.`;
    } else {
      mensagem = `Próximo passo: ${recomendado.acaoLabel} — ${recomendado.clienteNome}.`;
    }
  } else if (destaques.length) {
    mensagem = 'Tudo pronto para começar.';
  }

  return {
    emoji,
    titulo: `${periodo}, ${nome}.`,
    operadorNome: nome,
    data: `Hoje é ${data} • ${hora}`,
    mensagem,
    destaques
  };
}

function readDashboardKpi(dashboard = {}, indicadores = {}, paths = []) {
  const kpis = { ...(dashboard.totais || {}), ...(dashboard.kpis || {}), ...indicadores };
  for (const path of paths) {
    const v = kpis[path];
    if (v !== undefined && v !== null) return Number(v) || 0;
  }
  return 0;
}

function buildResumoDia({ dashboard = {}, indicadores = {}, consignacoes = [], pendenciasView = {} } = {}) {
  const alertas = pendenciasView.alertas || [];
  const entregas = consignacoes.filter((c) =>
    ['RASCUNHO', 'VALIDADA'].includes(String(c.status || '').toUpperCase())
  ).length;
  const prestacoes = consignacoes.filter((c) => {
    const st = String(c.status || '').toUpperCase();
    if (st === 'EM_PRESTACAO') return true;
    if (st === 'ENTREGUE') return true;
    const prest = c.prestacaoContasAtiva;
    return Boolean(prest && String(prest.status || '').toUpperCase() === 'ABERTA');
  }).length;
  const clientesSaldoReceber = new Set(
    consignacoes.filter(isElegivelE5).map((c) => String(c.clienteId)).filter(Boolean)
  ).size;
  const limiteAlertas = alertas.filter((a) => /LIMITE|LIMITE_EXCEDIDO/i.test(`${a.tipo} ${a.descricao}`)).length
    || readDashboardKpi(dashboard, indicadores, ['clientesLimiteExcedido', 'quantidadeLimiteExcedido']);
  // Operador: saldo a receber (E5) é o alerta operacional; limite excedido permanece como reforço
  const saldoOuLimite = Math.max(clientesSaldoReceber, limiteAlertas);
  const cadastro = alertas.filter((a) => /CADASTRO|CLIENTE_SEM|PERFIL/i.test(`${a.tipo} ${a.descricao} ${a.categoria}`)).length;
  const abertas = consignacoes.filter((c) =>
    ['RASCUNHO', 'VALIDADA', 'ENTREGUE', 'EM_PRESTACAO'].includes(String(c.status || '').toUpperCase())
  ).length;

  const valorEntregas = entregas || readDashboardKpi(dashboard, indicadores, ['entregasPrevistas']);
  const valorPrestacoes = prestacoes || readDashboardKpi(dashboard, indicadores, ['prestacaoAberta', 'quantidadePrestacoesAbertas']);
  const valorAbertas = abertas || readDashboardKpi(dashboard, indicadores, ['consignacoesAbertas']);
  const saldoTotal = consignacoes
    .filter(isElegivelE5)
    .reduce((acc, c) => acc + saldoDevedorConsignacao(c), 0);

  const fmtMoeda = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v) || 0);

  return [
    {
      key: 'entregas',
      icone: '📦',
      tom: 'amber',
      label: 'Entregas Previstas',
      valor: valorEntregas,
      descricao: valorEntregas === 0
        ? 'Nenhuma entrega prevista.'
        : `${valorEntregas} entrega${valorEntregas === 1 ? '' : 's'} no pipeline.`
    },
    {
      key: 'prestacoes',
      icone: '📋',
      tom: 'rose',
      label: 'Fechamentos Pendentes',
      valor: valorPrestacoes,
      descricao: valorPrestacoes === 0
        ? 'Nenhum atendimento aguardando.'
        : `Existe${valorPrestacoes === 1 ? '' : 'm'} ${valorPrestacoes} atendimento${valorPrestacoes === 1 ? '' : 's'} aguardando.`
    },
    {
      key: 'limite',
      icone: '💰',
      tom: 'emerald',
      label: clientesSaldoReceber > 0 ? 'Clientes com saldo' : 'Clientes com limite',
      valor: saldoOuLimite,
      descricao: clientesSaldoReceber > 0
        ? (saldoTotal > 0
          ? `${fmtMoeda(saldoTotal)} aguardando recebimento.`
          : `${clientesSaldoReceber} cliente${clientesSaldoReceber === 1 ? '' : 's'} com saldo.`)
        : (saldoOuLimite === 0
          ? 'Nada a receber no momento.'
          : `${saldoOuLimite} alerta${saldoOuLimite === 1 ? '' : 's'} de limite.`)
    },
    {
      key: 'abertas',
      icone: '📦',
      tom: 'sky',
      label: 'Consignações abertas',
      valor: valorAbertas,
      descricao: valorAbertas === 0
        ? 'Nenhuma consignação em andamento.'
        : `${valorAbertas} atendimento${valorAbertas === 1 ? '' : 's'} em andamento.`
    },
    // Mantido no view-model para compatibilidade; a UI premium não destaca cadastro.
    { key: 'cadastro', icone: '🟢', tom: 'emerald', label: 'Clientes aguardando cadastro', valor: cadastro, descricao: '', oculto: true }
  ];
}

function statusConsignacao(c = {}) {
  return String(c.status || '').toUpperCase();
}

function isPrestacaoEmAndamento(c = {}) {
  if (statusConsignacao(c) === 'EM_PRESTACAO') return true;
  const prest = c.prestacaoContasAtiva;
  return Boolean(prest && String(prest.status || '').toUpperCase() === 'ABERTA');
}

function isEntregaEmAndamento(c = {}) {
  return ['RASCUNHO', 'VALIDADA'].includes(statusConsignacao(c));
}

function isProntoParaFechar(c = {}) {
  return statusConsignacao(c) === 'ENTREGUE' && !isPrestacaoEmAndamento(c);
}

function isPrestacaoEncerrada(c = {}) {
  return ['ACERTADA', 'ENCERRADA', 'QUITADA'].includes(statusConsignacao(c));
}

function isQuitada(c = {}) {
  return statusConsignacao(c) === 'QUITADA';
}

/**
 * E5 oficial: prestação encerrada com dívida, nunca QUITADA.
 * ACERTADA | ENCERRADA + saldoDevedor > 0.
 */
function isElegivelE5(c = {}) {
  if (isQuitada(c)) return false;
  const st = statusConsignacao(c);
  if (!['ACERTADA', 'ENCERRADA'].includes(st)) return false;
  return saldoDevedorConsignacao(c) > 0;
}

function saldoDevedorConsignacao(c = {}) {
  return Number(c.saldo ?? c.saldoAberto ?? 0);
}

function saldoDevedorPerfil(perfil = {}) {
  return Number(perfil.saldoUtilizado ?? perfil.raw?.saldoAberto ?? perfil.saldoAberto ?? 0);
}

/**
 * Resolve o status UX de prestação e o estado operacional E1–E6
 * para resumo do cliente (precedência E2 > E4 > E3 > E5 > E6/E1).
 * A fila operacional NÃO usa mais este colapso — ver buildFilaOperacional.
 */
function resolveEstadoOperacionalCliente({ consignacoes = [], perfil = {} } = {}) {
  const emEntrega = consignacoes.find(isEntregaEmAndamento);
  if (emEntrega) {
    return {
      estado: ESTADOS.E2,
      prestacaoStatus: PRESTACAO_STATUS.NENHUMA,
      consignacao: emEntrega,
      saldoDevedor: saldoDevedorConsignacao(emEntrega)
    };
  }

  const emAndamento = consignacoes.find(isPrestacaoEmAndamento);
  if (emAndamento) {
    return {
      estado: ESTADOS.E4,
      prestacaoStatus: PRESTACAO_STATUS.EM_ANDAMENTO,
      consignacao: emAndamento,
      saldoDevedor: saldoDevedorConsignacao(emAndamento)
    };
  }

  const pronto = consignacoes.find(isProntoParaFechar);
  if (pronto) {
    return {
      estado: ESTADOS.E3,
      prestacaoStatus: PRESTACAO_STATUS.PRONTO_PARA_FECHAR,
      consignacao: pronto,
      saldoDevedor: saldoDevedorConsignacao(pronto)
    };
  }

  // E5 — somente máquina oficial (nunca QUITADA; nunca inventar dívida só pelo perfil)
  const elegiveisE5 = consignacoes
    .filter(isElegivelE5)
    .sort((a, b) => saldoDevedorConsignacao(b) - saldoDevedorConsignacao(a));

  if (elegiveisE5.length) {
    const alvo = elegiveisE5[0];
    return {
      estado: ESTADOS.E5,
      prestacaoStatus: PRESTACAO_STATUS.ENCERRADA,
      consignacao: alvo,
      saldoDevedor: saldoDevedorConsignacao(alvo)
    };
  }

  // E6 — quitado (QUITADA ou encerrada sem saldo). Perfil stale não mantém na fila.
  const quitadaOuZerada = consignacoes.find(
    (c) => isQuitada(c) || (['ACERTADA', 'ENCERRADA'].includes(statusConsignacao(c))
      && saldoDevedorConsignacao(c) <= 0)
  );
  if (quitadaOuZerada) {
    return {
      estado: ESTADOS.E6,
      prestacaoStatus: PRESTACAO_STATUS.ENCERRADA,
      consignacao: quitadaOuZerada,
      saldoDevedor: 0
    };
  }

  return {
    estado: ESTADOS.E1,
    prestacaoStatus: PRESTACAO_STATUS.NENHUMA,
    consignacao: null,
    saldoDevedor: 0
  };
}

function formatarTempoAguardando(dataRef) {
  if (!dataRef) return null;
  const t = new Date(dataRef).getTime();
  if (Number.isNaN(t)) return null;
  const mins = Math.max(0, Math.floor((Date.now() - t) / 60000));
  if (mins < 60) return `${mins} min`;
  const horas = Math.floor(mins / 60);
  if (horas < 24) return `${horas}h`;
  const dias = Math.floor(horas / 24);
  return `${dias}d`;
}

function enriquecerMetaConsignacao(consignacao = {}) {
  const dataRef = consignacao.updatedAt
    || consignacao.dataAbertura
    || consignacao.dataEntrega
    || consignacao.createdAt
    || consignacao.prestacaoContasAtiva?.dataAbertura;
  const qtd = Number(consignacao.quantidadeItens)
    || (Array.isArray(consignacao.itens) ? consignacao.itens.length : 0)
    || 0;
  const valor = Number(
    consignacao.valor
      ?? consignacao.valorTotal
      ?? consignacao.saldo
      ?? consignacao.saldoDevedor
      ?? 0
  ) || 0;
  return {
    valor,
    itens: qtd,
    tempoAguardando: formatarTempoAguardando(dataRef),
    documento: consignacao.documento || (consignacao.id ? `Consignação #${consignacao.id}` : '—')
  };
}

function itemFromEstado(clienteId, clienteNome, resolved = {}, extras = {}) {
  const { estado, prestacaoStatus, consignacao, saldoDevedor } = resolved;
  const meta = enriquecerMetaConsignacao(consignacao || {});
  const base = {
    id: `cli-${clienteId}-${estado}`,
    clienteId,
    clienteNome,
    estado,
    prestacaoStatus,
    consignacaoId: consignacao?.id || null,
    saldoDevedor: Number(saldoDevedor) || 0,
    valor: meta.valor || Number(saldoDevedor) || 0,
    itens: meta.itens,
    tempoAguardando: meta.tempoAguardando,
    entregaLabel: meta.documento,
    ordemFila: ORDEM_FILA[estado] ?? 99,
    ...extras
  };

  if (estado === ESTADOS.E2) {
    return {
      ...base,
      situacao: 'Entrega em andamento',
      statusLabel: 'Entrega',
      icone: '🟠',
      nivel: 'warning',
      acaoLabel: 'Continuar Entrega',
      acaoTipo: 'entrega',
      prioridade: 1
    };
  }

  if (estado === ESTADOS.E3) {
    return {
      ...base,
      situacao: 'Pronto para fechar',
      statusLabel: 'Fechar',
      icone: '🔴',
      nivel: 'warning',
      acaoLabel: 'Fechar Atendimento',
      acaoTipo: 'prestacao',
      prioridade: 1
    };
  }

  if (estado === ESTADOS.E4) {
    return {
      ...base,
      situacao: 'Atendimento em andamento',
      statusLabel: 'Atendimento',
      icone: '🟠',
      nivel: 'warning',
      acaoLabel: 'Continuar Atendimento',
      acaoTipo: 'prestacao',
      prioridade: 1
    };
  }

  if (estado === ESTADOS.E5) {
    return {
      ...base,
      situacao: 'Saldo a receber — Conta Corrente',
      statusLabel: 'Receber',
      icone: '💰',
      nivel: 'info',
      acaoLabel: 'Receber',
      acaoTipo: 'receber-conta-corrente',
      prioridade: 2
    };
  }

  return null;
}

function workItemFromPendenciaRisco(alerta = {}, consignacoes = [], perfis = []) {
  const tipo = String(alerta.tipo || alerta.categoria || '').toUpperCase();
  const desc = String(alerta.descricao || alerta.motivo || '').toUpperCase();
  if (!/LIMITE|BLOQUEADO/.test(`${tipo} ${desc}`)) return null;

  return {
    id: `pend-${alerta.id}`,
    clienteId: alerta.clienteId,
    clienteNome: resolverNomeTrabalho(alerta.clienteId, { alerta, consignacoes, perfis }),
    situacao: alerta.descricao || alerta.motivo || 'Limite ou bloqueio',
    icone: '🔴',
    nivel: 'danger',
    acaoLabel: 'Consultar Conta Corrente',
    acaoTipo: 'conta-corrente',
    consignacaoId: alerta.consignacaoId || null,
    estado: ESTADOS.RISCO,
    prestacaoStatus: PRESTACAO_STATUS.NENHUMA,
    ordemFila: ORDEM_FILA.RISCO,
    prioridade: 0
  };
}

/**
 * Compat: pendências de entrega/prestação — só usadas se o estado operacional
 * já não classificou o cliente (evita rótulo genérico).
 */
function workItemFromPendencia(alerta = {}, consignacoes = [], perfis = []) {
  const risco = workItemFromPendenciaRisco(alerta, consignacoes, perfis);
  if (risco) return risco;

  const tipo = String(alerta.tipo || alerta.categoria || '').toUpperCase();
  const desc = String(alerta.descricao || alerta.motivo || '').toUpperCase();
  let acaoLabel = 'Abrir';
  let acaoTipo = 'abrir-cliente';
  let icone = '🟠';

  if (/PRESTAC/.test(`${tipo} ${desc}`)) {
    acaoLabel = 'Continuar Atendimento';
    acaoTipo = 'prestacao';
    icone = '🔴';
  } else if (/ENTREGA/.test(`${tipo} ${desc}`)) {
    acaoLabel = 'Continuar Entrega';
    acaoTipo = 'entrega';
  }

  let consignacaoId = alerta.consignacaoId || alerta.raw?.dados?.consignacaoId || null;
  if (!consignacaoId && alerta.clienteId) {
    const doCliente = consignacoes.filter((c) => String(c.clienteId) === String(alerta.clienteId));
    if (acaoTipo === 'prestacao') {
      consignacaoId = findConsignacaoEmPrestacao(doCliente)?.id || null;
    } else if (acaoTipo === 'entrega') {
      consignacaoId = findConsignacaoEmEntrega(doCliente)?.id || null;
    }
  }

  return {
    id: `pend-${alerta.id}`,
    clienteId: alerta.clienteId,
    clienteNome: resolverNomeTrabalho(alerta.clienteId, { alerta, consignacoes, perfis }),
    situacao: alerta.descricao || alerta.motivo || 'Ação necessária',
    icone,
    nivel: 'warning',
    acaoLabel,
    acaoTipo,
    consignacaoId,
    prioridade: 1
  };
}

function resolverOperacaoConsignacao(c) {
  if (isEntregaEmAndamento(c)) {
    return {
      estado: ESTADOS.E2,
      prestacaoStatus: PRESTACAO_STATUS.NENHUMA,
      consignacao: c,
      saldoDevedor: saldoDevedorConsignacao(c)
    };
  }
  if (isPrestacaoEmAndamento(c)) {
    return {
      estado: ESTADOS.E4,
      prestacaoStatus: PRESTACAO_STATUS.EM_ANDAMENTO,
      consignacao: c,
      saldoDevedor: saldoDevedorConsignacao(c)
    };
  }
  if (isProntoParaFechar(c)) {
    return {
      estado: ESTADOS.E3,
      prestacaoStatus: PRESTACAO_STATUS.PRONTO_PARA_FECHAR,
      consignacao: c,
      saldoDevedor: saldoDevedorConsignacao(c)
    };
  }
  return null;
}

function montarOperacaoItem(c, clienteNome, perfil = {}) {
  const resolved = resolverOperacaoConsignacao(c);
  if (!resolved) return null;
  const item = itemFromEstado(c.clienteId, clienteNome, resolved, {
    id: `consig-${c.id}-${resolved.estado}`,
    documento: perfil.cpfCnpj && perfil.cpfCnpj !== '-' ? perfil.cpfCnpj : '—',
    documentoConsignacao: c.documento || `Consignação #${c.id}`
  });
  if (!item) return null;
  item.statusConsignacao = c.status || null;
  item.podeEntregaComplementar = podeAdicionarProdutoComplementar(c).elegivel === true;
  return item;
}

/**
 * Monta a fila: 1 cliente = 1 card visual; N consignações independentes dentro.
 * clienteId = agrupamento | consignacaoId = identidade operacional (RCM-8.10).
 */
function buildFilaOperacional({ pendenciasView = {}, consignacoes = [], perfis = [] } = {}) {
  const perfilPorCliente = new Map();
  perfis.forEach((p) => {
    if (p.clienteId == null) return;
    const key = String(p.clienteId);
    if (!perfilPorCliente.has(key)) perfilPorCliente.set(key, []);
    perfilPorCliente.get(key).push(p);
  });

  const consignacoesPorCliente = new Map();
  consignacoes.forEach((c) => {
    if (c.clienteId == null) return;
    const key = String(c.clienteId);
    if (!consignacoesPorCliente.has(key)) consignacoesPorCliente.set(key, []);
    consignacoesPorCliente.get(key).push(c);
  });

  const cardsPorCliente = new Map();
  const consignacaoIdsNaFila = new Set();

  consignacoesPorCliente.forEach((lista, key) => {
    const perfil = (perfilPorCliente.get(key) || [])[0] || {};
    const nome = resolverNomeTrabalho(key, {
      consignacoes: lista,
      perfis: perfilPorCliente.get(key) || []
    });

    const operacoes = lista
      .map((c) => montarOperacaoItem(c, nome, perfil))
      .filter(Boolean)
      .sort((a, b) => (a.ordemFila - b.ordemFila) || (a.prioridade - b.prioridade));

    if (!operacoes.length) return;

    operacoes.forEach((op) => consignacaoIdsNaFila.add(String(op.consignacaoId)));

    const valorTotal = operacoes.reduce((s, op) => s + Number(op.valor || 0), 0);
    const itensTotal = operacoes.reduce((s, op) => s + Number(op.itens || 0), 0);
    const principal = operacoes[0];
    const estadosUnicos = [...new Set(operacoes.map((op) => op.estado))];

    cardsPorCliente.set(key, {
      id: `cli-${key}`,
      clienteId: perfil.clienteId ?? key,
      clienteNome: nome,
      agrupado: true,
      documento: perfil.cpfCnpj && perfil.cpfCnpj !== '-' ? perfil.cpfCnpj : '—',
      valor: valorTotal,
      saldoDevedor: valorTotal,
      itens: itensTotal,
      quantidadeConsignacoes: operacoes.length,
      tempoAguardando: principal.tempoAguardando || '—',
      ordemFila: principal.ordemFila,
      prioridade: Math.min(...operacoes.map((op) => op.prioridade || 99)),
      nivel: principal.nivel || 'warning',
      icone: principal.icone || '🟠',
      // Header: não esconde estados — badge principal = prioridade; lista interna tem todos
      estado: principal.estado,
      estados: estadosUnicos,
      statusLabel: estadosUnicos.length > 1
        ? `${operacoes.length} operações`
        : (principal.statusLabel || principal.situacao),
      situacao: estadosUnicos.length > 1
        ? `${operacoes.length} consignações em aberto`
        : (principal.situacao || ''),
      // Compat buildAcaoPrincipal / navegação legado: aponta para a 1ª op ordenada
      consignacaoId: principal.consignacaoId,
      acaoTipo: principal.acaoTipo,
      acaoLabel: principal.acaoLabel,
      podeEntregaComplementar: operacoes.some((op) => op.podeEntregaComplementar),
      consignacoes: operacoes
    });
  });

  const clientesComOperacao = new Set(cardsPorCliente.keys());
  const riscos = [];
  (pendenciasView.criticas || []).concat(pendenciasView.importantes || [], pendenciasView.alertas || [])
    .forEach((alerta) => {
      if (alerta.clienteId == null) return;
      const key = String(alerta.clienteId);
      if (clientesComOperacao.has(key)) return;
      const risco = workItemFromPendenciaRisco(
        alerta,
        consignacoesPorCliente.get(key) || [],
        perfilPorCliente.get(key) || []
      );
      if (risco) {
        risco.agrupado = false;
        risco.consignacoes = [];
        riscos.push(risco);
      }
    });

  const trabalhoPrioritario = [...cardsPorCliente.values(), ...riscos]
    .filter((i) => {
      if (i.agrupado && Array.isArray(i.consignacoes) && i.consignacoes.length) return true;
      return [ESTADOS.RISCO].includes(i.estado);
    })
    .sort((a, b) => (a.ordemFila - b.ordemFila) || (a.prioridade - b.prioridade))
    .slice(0, 20);

  const consignadosPendentes = consignacoes
    .filter((c) => isElegivelE5(c) && !consignacaoIdsNaFila.has(String(c.id)))
    .map((c) => {
      const key = String(c.clienteId);
      const perfil = (perfilPorCliente.get(key) || [])[0] || {};
      const nome = resolverNomeTrabalho(key, {
        consignacoes: consignacoesPorCliente.get(key) || [c],
        perfis: perfilPorCliente.get(key) || []
      });
      return {
        id: `consig-${c.id}-E5`,
        clienteId: c.clienteId,
        clienteNome: nome,
        documento: perfil.cpfCnpj && perfil.cpfCnpj !== '-' ? perfil.cpfCnpj : '—',
        valorEmAberto: saldoDevedorConsignacao(c),
        consignacaoId: c.id,
        documentoConsignacao: c.documento || `Consignação #${c.id}`,
        statusConsignacao: c.status || null,
        acaoTipo: 'receber-conta-corrente',
        origemRecebimento: 'conta-corrente-comercial',
        estado: ESTADOS.E5,
        prestacaoStatus: PRESTACAO_STATUS.ENCERRADA,
        acaoLabel: 'Receber'
      };
    })
    .filter((i) => String(i.statusConsignacao || '').toUpperCase() !== 'QUITADA')
    .filter((i) => Number(i.valorEmAberto) > 0)
    .sort((a, b) => b.valorEmAberto - a.valorEmAberto)
    .slice(0, 20);

  return { trabalhoPrioritario, consignadosPendentes, porCliente: cardsPorCliente };
}

function buildTrabalhoPrioritario(opts = {}) {
  return buildFilaOperacional(opts).trabalhoPrioritario;
}

function buildConsignadosPendentes(opts = {}) {
  return buildFilaOperacional(opts).consignadosPendentes;
}

function buildAcaoPrincipal(trabalhoPrioritario = []) {
  const primeiro = trabalhoPrioritario[0];
  if (!primeiro) {
    return {
      icon: '📦',
      label: 'Preparar Entrega',
      acaoTipo: 'nova-consignacao',
      destaque: true
    };
  }

  return {
    icon: primeiro.icone || '📦',
    label: primeiro.acaoLabel || 'Abrir',
    ...primeiro,
    destaque: true
  };
}

/**
 * UX-10 — Ações Rápidas: somente atalhos gerais (nunca repetem Trabalho Prioritário).
 */
function buildAcoesRapidas() {
  return {
    atalhos: [
      { ativo: true, label: 'Nova Entrega', icon: '📦', acaoTipo: 'nova-consignacao' },
      { ativo: true, label: 'Novo Cliente', icon: '👤', acaoTipo: 'novo-cliente' },
      { ativo: true, label: 'Consultar Clientes', icon: '👥', acaoTipo: 'central-clientes' },
      { ativo: true, label: 'Relatórios', icon: '📊', acaoTipo: 'relatorios' }
    ]
  };
}

/**
 * Resolve consignação para recebimento Conta Corrente (E5).
 * Nunca retorna QUITADA.
 */
function resolverConsignacaoParaRecebimento(clienteId, consignacoes = []) {
  const doCliente = consignacoes.filter((c) => String(c.clienteId) === String(clienteId));
  if (!doCliente.length) return null;

  const elegiveis = doCliente
    .filter(isElegivelE5)
    .sort((a, b) => saldoDevedorConsignacao(b) - saldoDevedorConsignacao(a));
  if (elegiveis[0]) return elegiveis[0];

  return null;
}

function resolverNomeCliente(consignacao = {}, perfis = []) {
  if (consignacao.clienteNome) return consignacao.clienteNome;
  if (typeof consignacao.cliente === 'string') return consignacao.cliente;
  const perfil = perfis.find((p) => String(p.clienteId) === String(consignacao.clienteId));
  return perfil?.clienteNome || perfil?.cliente || `Cliente #${consignacao.clienteId || '—'}`;
}

function formatarHoraEntrega(dataRef) {
  if (!dataRef) return '—';
  const d = new Date(dataRef);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function acaoTimelineEntrega(status) {
  const st = String(status || '').toUpperCase();
  if (st === 'RASCUNHO') return 'Preparar';
  if (st === 'VALIDADA') return 'Entregar';
  return 'Acompanhar';
}

function buildProximasEntregas(consignacoes = [], perfis = []) {
  return consignacoes
    .filter((c) => isEntregaEmAndamento(c))
    .map((c) => {
      const data = c.dataAbertura || c.createdAt || c.data;
      return {
        id: c.id,
        clienteId: c.clienteId,
        cliente: resolverNomeCliente(c, perfis),
        documento: c.documento || `Consignação #${c.id}`,
        data,
        hora: formatarHoraEntrega(data),
        situacao: c.status || 'Pendente',
        acaoTimeline: acaoTimelineEntrega(c.status),
        consignacaoId: c.id
      };
    })
    .slice(0, 8);
}

function calcularDiasEmAberto(dataRef) {
  if (!dataRef) return '—';
  const diff = Math.floor((Date.now() - new Date(dataRef).getTime()) / 86400000);
  return diff >= 0 ? diff : 0;
}

/**
 * UX-10 — Próximos Fechamentos (E3 + E4 apenas; ACERTADA com saldo fica em E5).
 */
function buildProximasPrestacoes(consignacoes = [], perfis = []) {
  return consignacoes
    .filter((c) => isPrestacaoEmAndamento(c) || isProntoParaFechar(c))
    .map((c) => {
      const emAndamento = isPrestacaoEmAndamento(c);
      const dataRef = c.prestacaoContasAtiva?.dataAbertura || c.dataEntrega || c.updatedAt;
      return {
        id: c.id,
        clienteId: c.clienteId,
        cliente: resolverNomeCliente(c, perfis),
        documento: c.documento || `Consignação #${c.id}`,
        valor: Number(c.saldo ?? c.valor ?? 0),
        diasEmAberto: calcularDiasEmAberto(dataRef),
        consignacaoId: c.id,
        emAndamento,
        estado: emAndamento ? ESTADOS.E4 : ESTADOS.E3,
        prestacaoStatus: emAndamento
          ? PRESTACAO_STATUS.EM_ANDAMENTO
          : PRESTACAO_STATUS.PRONTO_PARA_FECHAR,
        acaoLabel: emAndamento ? 'Continuar Atendimento' : 'Fechar Atendimento'
      };
    })
    .slice(0, 8);
}

function formatarPeriodoRelativo(data) {
  if (!data) return '—';
  const d = new Date(data);
  if (Number.isNaN(d.getTime())) return '—';
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const ref = new Date(d);
  ref.setHours(0, 0, 0, 0);
  const diff = Math.round((hoje - ref) / 86400000);
  if (diff === 0) return 'Hoje';
  if (diff === 1) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function resolverClienteEvento(ev = {}) {
  return ev.clienteNome
    || ev.cliente
    || ev.nomeCliente
    || ev.raw?.clienteNome
    || null;
}

function humanizarEvento(ev = {}) {
  const tipo = String(ev.tipo || ev.tipoMovimentacao || '').toUpperCase();
  const desc = String(ev.descricao || ev.motivo || '').toLowerCase();
  const cliente = resolverClienteEvento(ev);
  const valor = ev.valor ?? ev.valorMovimento ?? ev.raw?.valor;
  const valorTxt = Number.isFinite(Number(valor)) && Number(valor) > 0
    ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(valor))
    : null;
  const quem = cliente ? String(cliente).split(' ')[0] : null;

  if (/PAGAMENTO|RECEB/i.test(`${tipo} ${desc}`)) {
    if (quem && valorTxt) return `${quem} recebeu ${valorTxt}`;
    if (quem) return `${quem} registrou recebimento`;
    return 'Recebimento registrado';
  }
  if (/PRESTAC.*FECH|FECH.*PRESTAC/i.test(`${tipo} ${desc}`)) {
    return quem ? `${quem} fechou atendimento` : 'Atendimento encerrado';
  }
  if (/PRESTAC.*ABERT|ABERT.*PRESTAC/i.test(`${tipo} ${desc}`)) {
    return quem ? `${quem} iniciou atendimento` : 'Fechamento iniciado';
  }
  if (/ENTREGA/i.test(`${tipo} ${desc}`)) {
    return quem ? `${quem} realizou entrega` : 'Entrega concluída';
  }
  if (/CONSIGN|NOVA/i.test(`${tipo} ${desc}`)) {
    return quem ? `${quem} iniciou atendimento` : 'Entrega preparada';
  }
  const base = ev.descricao || ev.motivo || ev.tipo || 'Operação comercial';
  return quem ? `${quem} — ${base}` : base;
}

function buildUltimasOperacoes(timeline = [], historico = []) {
  const eventos = [
    ...normalizeTimelineEvents(timeline),
    ...(Array.isArray(historico) ? historico : historico?.movimentacoes || [])
  ];

  const vistos = new Set();
  return eventos
    .sort((a, b) => new Date(b.data || b.dataMovimentacao || 0) - new Date(a.data || a.dataMovimentacao || 0))
    .filter((ev) => {
      const desc = humanizarEvento(ev);
      const chave = `${ev.data || ev.dataMovimentacao}-${desc}`;
      if (vistos.has(chave)) return false;
      vistos.add(chave);
      return true;
    })
    .slice(0, 10)
    .map((ev) => ({
      periodo: formatarPeriodoRelativo(ev.data || ev.dataMovimentacao),
      descricao: humanizarEvento(ev),
      icone: '✔',
      data: ev.data || ev.dataMovimentacao
    }));
}

/**
 * Auditoria automática UX-10 — exclusividade por consignação e nomenclatura por estado.
 * Mesmo cliente pode ter cards em blocos diferentes (ex.: E4 + E5 de consignações distintas).
 */
function auditarCentralEstados(viewModel = {}) {
  const erros = [];
  const prioritario = viewModel.trabalhoPrioritario || [];
  const pendentes = viewModel.consignadosPendentes || [];
  const idsPrioritarios = new Set(
    prioritario.map((i) => String(i.consignacaoId || i.id)).filter((id) => id && id !== 'null')
  );
  const idsPendentes = new Set(
    pendentes.map((i) => String(i.consignacaoId || i.id)).filter((id) => id && id !== 'null')
  );

  idsPrioritarios.forEach((id) => {
    if (idsPendentes.has(id)) {
      erros.push(`Consignação ${id} aparece em Trabalho Prioritário e Consignados Pendentes`);
    }
  });

  pendentes.forEach((item) => {
    if (item.estado && item.estado !== ESTADOS.E5) {
      erros.push(`Consignados Pendentes contém estado ${item.estado} (cliente ${item.clienteId})`);
    }
    if (item.prestacaoStatus && item.prestacaoStatus !== PRESTACAO_STATUS.ENCERRADA) {
      erros.push(`Receber sem prestação ENCERRADA (cliente ${item.clienteId})`);
    }
    if (!(Number(item.valorEmAberto) > 0)) {
      erros.push(`Cliente quitado ainda em Consignados Pendentes (${item.clienteId})`);
    }
    if (String(item.statusConsignacao || '').toUpperCase() === 'QUITADA') {
      erros.push(`QUITADA em Consignados Pendentes (cliente ${item.clienteId})`);
    }
  });

  prioritario.forEach((item) => {
    if (item.estado === ESTADOS.E4 && item.acaoLabel !== 'Continuar Atendimento') {
      erros.push(`E4 sem Continuar Atendimento (cliente ${item.clienteId})`);
    }
    if (item.estado === ESTADOS.E3 && item.acaoLabel !== 'Fechar Atendimento') {
      erros.push(`E3 sem Fechar Atendimento (cliente ${item.clienteId})`);
    }
    if (item.estado === ESTADOS.E2 && item.acaoLabel !== 'Continuar Entrega') {
      erros.push(`E2 sem Continuar Entrega (cliente ${item.clienteId})`);
    }
    if (item.acaoTipo === 'receber' || item.acaoTipo === 'receber-conta-corrente') {
      erros.push(`Receber no Trabalho Prioritário (cliente ${item.clienteId})`);
    }
  });

  const acoes = viewModel.acoesRapidas?.atalhos || [];
  const temFecharNasRapidas = acoes.some((a) =>
    /fechar atendimento/i.test(a.label || '') || a.acaoTipo === 'prestacao'
  );
  if (temFecharNasRapidas || viewModel.acoesRapidas?.fecharAtendimento?.ativo) {
    erros.push('Ações Rápidas repetem Fechar Atendimento / ação de Trabalho Prioritário');
  }

  return {
    ok: erros.length === 0,
    erros,
    contagens: {
      prioritario: prioritario.length,
      pendentes: pendentes.length,
      intersecao: [...idsPrioritarios].filter((id) => idsPendentes.has(id)).length
    }
  };
}

function buildCentralTrabalhoViewModel(payload = {}) {
  const consignacoes = (payload.consignacoes || []).map((c) => mapConsignacaoView(c));
  const consignacoesById = Object.fromEntries(consignacoes.map((c) => [String(c.id), c]));
  const perfis = (payload.perfis || []).map(mapPerfilListItem);
  const pendenciasView = buildViewFromPayload(payload.pendencias || {});

  const fila = buildFilaOperacional({ pendenciasView, consignacoes, perfis });
  const trabalhoPrioritario = fila.trabalhoPrioritario;
  const consignadosPendentes = fila.consignadosPendentes;
  const proximasPrestacoes = buildProximasPrestacoes(consignacoes, perfis);
  const acaoPrincipal = buildAcaoPrincipal(trabalhoPrioritario);
  const acoesRapidas = buildAcoesRapidas();

  const resumoDia = buildResumoDia({
    dashboard: payload.dashboard,
    indicadores: payload.indicadores,
    consignacoes,
    pendenciasView
  });

  const viewModel = {
    saudacao: buildSaudacao(resumoDia, consignadosPendentes, trabalhoPrioritario),
    resumoDia,
    acaoPrincipal,
    acoesRapidas,
    trabalhoPrioritario,
    consignadosPendentes,
    proximasEntregas: buildProximasEntregas(consignacoes, perfis),
    proximasPrestacoes,
    proximosFechamentos: proximasPrestacoes,
    ultimasOperacoes: buildUltimasOperacoes(payload.timeline, payload.historico),
    consignacoesById
  };

  viewModel.auditoriaEstados = auditarCentralEstados(viewModel);
  return viewModel;
}

module.exports = {
  ESTADOS,
  PRESTACAO_STATUS,
  buildSaudacao,
  buildResumoDia,
  buildFilaOperacional,
  buildTrabalhoPrioritario,
  buildAcaoPrincipal,
  buildAcoesRapidas,
  buildConsignadosPendentes,
  resolverConsignacaoParaRecebimento,
  resolveEstadoOperacionalCliente,
  buildProximasEntregas,
  buildProximasPrestacoes,
  buildUltimasOperacoes,
  buildCentralTrabalhoViewModel,
  auditarCentralEstados,
  workItemFromPendencia,
  resolverNomeTrabalho,
  isNomeClienteFallback,
  isPrestacaoEmAndamento,
  isProntoParaFechar,
  isPrestacaoEncerrada,
  isElegivelE5,
  isQuitada,
  podeAdicionarProdutoComplementar
};
