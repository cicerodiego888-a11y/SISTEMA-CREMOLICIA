/**
 * Mapeadores da Central de Operações do Cliente — Sprint UX-02.2
 *
 * Transforma dados existentes da API em ficha operacional.
 * Sem regras de negócio novas — apenas leitura e priorização visual.
 *
 * @module frontend/modules/motor-comercial/pages/PerfilComercial/centralOperacoesMappers
 */

const { extrairCapacidadesDosPerfis } = require('./capacidadesComerciais');
const { buildHistoricoUnificado, normalizeTimelineEvents } = require('./cliente360Mappers');
const { buildHistoricoConsignacoes } = require('./historicoConsignacoesMappers');

const STATUS_ABERTOS = new Set(['RASCUNHO', 'VALIDADA', 'ENTREGUE', 'EM_PRESTACAO']);

function normalizarStatus(perfil = {}, situacao = {}) {
  if (perfil.bloqueado || situacao.statusGeral === 'BLOQUEADO') return 'Bloqueado';
  if (perfil.ativo === false) return 'Inativo';
  if (situacao.statusGeral === 'EM_PRESTACAO') return 'Em prestação';
  if (situacao.statusGeral === 'EM_ABERTO') return 'Saldo em aberto';
  return 'Ativo';
}

function extrairCidade(perfil = {}) {
  const mestre = perfil.clienteMestre || (typeof perfil.cliente === 'object' ? perfil.cliente : {}) || {};
  return mestre.cidade || perfil.cidade || mestre.endereco?.cidade || '—';
}

function extrairUf(perfil = {}) {
  const mestre = perfil.clienteMestre || (typeof perfil.cliente === 'object' ? perfil.cliente : {}) || {};
  return mestre.uf || mestre.endereco?.uf || mestre.endereco?.estado || perfil.uf || '';
}

function extrairWhatsApp(perfil = {}) {
  const mestre = perfil.clienteMestre || {};
  const tel = String(perfil.telefone || mestre.telefone || '');
  if (!tel) return '—';
  const partes = tel.split('/').map((p) => p.trim()).filter(Boolean);
  return partes.length > 1 ? partes[partes.length - 1] : tel;
}

function contarConsignacoesAbertas(consignacoes = [], situacao = {}) {
  if (Array.isArray(situacao.consignacoesAbertas) && situacao.consignacoesAbertas.length) {
    return situacao.consignacoesAbertas.length;
  }
  if (typeof situacao.consignacoesAbertas === 'number') {
    return situacao.consignacoesAbertas;
  }
  return consignacoes.filter((c) => STATUS_ABERTOS.has(String(c.status || '').toUpperCase())).length;
}

function contarPendencias(pendencias = {}) {
  if (typeof pendencias.resumo?.pendentes === 'number') return pendencias.resumo.pendentes;
  if (Array.isArray(pendencias.alertas)) return pendencias.alertas.length;
  const listas = [
    ...(pendencias.operacionais || []),
    ...(pendencias.financeiras || []),
    ...(pendencias.comerciais || [])
  ];
  return listas.length;
}

function findConsignacaoEmEntrega(consignacoes = []) {
  return consignacoes.find((c) => ['RASCUNHO', 'VALIDADA'].includes(String(c.status || '').toUpperCase())) || null;
}

function findConsignacaoEmPrestacao(consignacoes = []) {
  return consignacoes.find((c) => {
    const status = String(c.status || '').toUpperCase();
    if (status === 'EM_PRESTACAO') return true;
    const prest = c.prestacaoContasAtiva;
    return prest && String(prest.status || '').toUpperCase() === 'ABERTA';
  }) || null;
}

function findConsignacaoPrestacaoPendente(consignacoes = [], situacao = {}) {
  const emPrestacao = findConsignacaoEmPrestacao(consignacoes);
  if (emPrestacao) return emPrestacao;

  const elegivel = consignacoes.find((c) =>
    ['ENTREGUE', 'ACERTADA'].includes(String(c.status || '').toUpperCase())
  );
  if (elegivel) return elegivel;

  if (situacao.prestacaoAtiva?.consignacaoId) {
    return consignacoes.find((c) => String(c.id) === String(situacao.prestacaoAtiva.consignacaoId)) || null;
  }
  return null;
}

function extrairUltimaEntrega(consignacoes = [], timeline = []) {
  const entregues = consignacoes
    .filter((c) => ['ENTREGUE', 'EM_PRESTACAO', 'ACERTADA', 'ENCERRADA'].includes(String(c.status || '').toUpperCase()))
    .sort((a, b) => new Date(b.dataEntrega || b.updatedAt || 0) - new Date(a.dataEntrega || a.updatedAt || 0));
  if (entregues.length) {
    return entregues[0].dataEntrega || entregues[0].updatedAt || null;
  }

  const eventos = normalizeTimelineEvents(timeline);
  const entregaEv = eventos.find((e) => /ENTREGA/i.test(String(e.tipo || e.descricao || '')));
  return entregaEv?.data || null;
}

function extrairUltimaPrestacao(consignacoes = [], timeline = [], situacao = {}) {
  if (situacao.prestacaoAtiva?.dataFechamento) {
    return situacao.prestacaoAtiva.dataFechamento;
  }

  const eventos = normalizeTimelineEvents(timeline);
  const prestEv = eventos.find((e) => /PRESTAC.*FECH|FECH.*PRESTAC|ENCERR/i.test(`${e.tipo || ''} ${e.descricao || ''}`));
  if (prestEv?.data) return prestEv.data;

  const fechadas = consignacoes
    .filter((c) => ['ENCERRADA', 'ACERTADA'].includes(String(c.status || '').toUpperCase())
      || c.prestacaoContasAtiva?.dataFechamento)
    .sort((a, b) => new Date(b.prestacaoContasAtiva?.dataFechamento || b.updatedAt || 0)
      - new Date(a.prestacaoContasAtiva?.dataFechamento || a.updatedAt || 0));

  if (fechadas.length) {
    return fechadas[0].prestacaoContasAtiva?.dataFechamento || fechadas[0].updatedAt || null;
  }
  return null;
}

function extrairProximoAcerto(consignacoes = [], situacao = {}) {
  const alvo = findConsignacaoPrestacaoPendente(consignacoes, situacao)
    || findConsignacaoEmPrestacao(consignacoes);
  if (!alvo) return null;

  return {
    data: situacao.prestacaoAtiva?.dataPrevista
      || alvo.prestacaoContasAtiva?.dataPrevista
      || alvo.dataPrevistaAcerto
      || alvo.dataEntrega
      || null,
    documento: alvo.documento || (alvo.id ? `#${alvo.id}` : null),
    consignacaoId: alvo.id || null
  };
}

/**
 * Métricas de crédito comercial — regra oficial do Motor Comercial.
 *
 * Crédito Disponível = Limite Comercial - Crédito Utilizado
 *
 * Fontes:
 * - Limite: perfil.limiteComercial | situacao.limite
 * - Utilizado: situacao.limiteUtilizado | situacao.saldoConsumido | situacao.saldo
 *   (SituacaoClienteProjection expõe saldoEmAberto como `saldo`)
 *
 * Não confiar em situacao.limiteDisponivel / score.limiteDisponivel quando
 * ausentes ou zerados por default — o valor oficial é sempre derivado.
 */
function metricasLimite(perfil = {}, situacao = {}, resumo = {}) {
  const limite = Number(
    perfil.limiteComercial
    ?? situacao.limiteComercial
    ?? situacao.limite
    ?? resumo.limiteComercial
    ?? 0
  );

  // STAB-02: saldoDevedor / creditoDisponivel vêm exclusivamente da API (SSOT).
  // Nenhum mapper recalcula Limite − Utilizado.
  const utilizado = Number(
    situacao.saldoDevedor
    ?? situacao.limiteUtilizado
    ?? situacao.saldoConsumido
    ?? situacao.saldo
    ?? resumo.saldoUtilizado
    ?? perfil.saldoAberto
    ?? 0
  );

  const disponivel = situacao.creditoDisponivel != null
    ? Number(situacao.creditoDisponivel)
    : (situacao.limiteDisponivel != null
      ? Number(situacao.limiteDisponivel)
      : (resumo.saldoDisponivel != null ? Number(resumo.saldoDisponivel) : null));

  return { limite, utilizado, disponivel };
}

/**
 * Limite excedido somente quando há consumo real cobrindo ou ultrapassando o limite.
 * Cliente com utilizado = 0 nunca deve ser marcado como excedido.
 */
function limiteExcedido(perfil = {}, situacao = {}, resumo = {}) {
  const { limite, utilizado, disponivel } = metricasLimite(perfil, situacao, resumo);
  if (!(limite > 0)) return false;
  if (disponivel != null) return utilizado >= limite || disponivel <= 0;
  return utilizado >= limite;
}

function buildProximaAcao({
  perfil = {},
  situacao = {},
  resumo = {},
  consignacoes = [],
  pendencias = {}
} = {}) {
  const emEntrega = findConsignacaoEmEntrega(consignacoes);
  const emPrestacao = findConsignacaoEmPrestacao(consignacoes);
  const prestacaoPendente = findConsignacaoPrestacaoPendente(consignacoes, situacao);

  if (perfil.bloqueado || situacao.statusGeral === 'BLOQUEADO') {
    return {
      urgente: true,
      nivel: 'danger',
      icone: '🔴',
      titulo: 'Cliente bloqueado',
      descricao: 'Operações comerciais suspensas até regularização.',
      acaoLabel: 'Consultar Conta Corrente',
      acaoTipo: 'conta-corrente'
    };
  }

  if (limiteExcedido(perfil, situacao, resumo)) {
    return {
      urgente: true,
      nivel: 'danger',
      icone: '🔴',
      titulo: 'Limite comercial excedido',
      descricao: 'O cliente atingiu o limite disponível para novas operações.',
      acaoLabel: 'Consultar Conta Corrente',
      acaoTipo: 'conta-corrente'
    };
  }

  if (emEntrega) {
    return {
      urgente: true,
      nivel: 'warning',
      icone: '🟡',
      titulo: 'Entrega em andamento',
      descricao: `Consignação ${emEntrega.documento || emEntrega.id} aguarda conclusão.`,
      acaoLabel: 'Continuar Entrega',
      acaoTipo: 'entrega',
      consignacaoId: emEntrega.id
    };
  }

  if (emPrestacao) {
    return {
      urgente: true,
      nivel: 'warning',
      icone: '🟠',
      titulo: 'Fechamento em andamento',
      descricao: `Continue o fechamento da consignação ${emPrestacao.documento || emPrestacao.id}.`,
      acaoLabel: 'Fechar Atendimento',
      acaoTipo: 'prestacao',
      consignacaoId: emPrestacao.id
    };
  }

  const pendenciaOperacional = (pendencias.operacionais || [])[0]
    || (pendencias.financeiras || [])[0]
    || (pendencias.comerciais || [])[0];

  if (prestacaoPendente) {
    return {
      urgente: true,
      nivel: 'warning',
      icone: '🟠',
      titulo: 'Fechamento pendente',
      descricao: `A consignação ${prestacaoPendente.documento || prestacaoPendente.id} aguarda encerramento.`,
      acaoLabel: 'Fechar Atendimento',
      acaoTipo: 'prestacao',
      consignacaoId: prestacaoPendente.id
    };
  }

  if (pendenciaOperacional) {
    const isPrestacao = /PRESTAC/i.test(`${pendenciaOperacional.tipo} ${pendenciaOperacional.descricao}`);
    return {
      urgente: true,
      nivel: 'warning',
      icone: '🟠',
      titulo: pendenciaOperacional.descricao || pendenciaOperacional.motivo || 'Ação pendente',
      descricao: pendenciaOperacional.acaoRecomendada || 'Existe uma pendência que requer atenção.',
      acaoLabel: isPrestacao ? 'Fechar Atendimento' : 'Ver pendências',
      acaoTipo: isPrestacao ? 'prestacao' : 'pendencias',
      consignacaoId: pendenciaOperacional.consignacaoId || null
    };
  }

  return {
    urgente: false,
    nivel: 'success',
    icone: '🟢',
    titulo: 'Cliente disponível',
    descricao: 'Nenhuma operação urgente.',
    acaoLabel: 'Preparar Entrega',
    acaoTipo: 'nova-consignacao'
  };
}

/**
 * Ações fixas da ficha — sempre as mesmas, com destaque operacional.
 */
function buildAcoesPrincipais(proximaAcao = {}, consignacoes = []) {
  const emEntrega = findConsignacaoEmEntrega(consignacoes);
  const emPrestacao = findConsignacaoEmPrestacao(consignacoes);
  const prestacaoPendente = findConsignacaoPrestacaoPendente(consignacoes);

  let entrega = {
    id: 'nova-consignacao',
    icon: '📦',
    label: 'Preparar Entrega',
    destaque: true,
    acaoTipo: 'nova-consignacao'
  };

  if (emEntrega) {
    entrega = {
      id: 'entrega-destaque',
      icon: '📦',
      label: 'Continuar Entrega',
      destaque: true,
      acaoTipo: 'entrega',
      consignacaoId: emEntrega.id
    };
  }

  let fechar = {
    id: 'prestacao',
    icon: '💰',
    label: 'Fechar Atendimento',
    destaque: false,
    acaoTipo: 'prestacao'
  };

  if (emPrestacao || prestacaoPendente) {
    const alvo = emPrestacao || prestacaoPendente;
    fechar = {
      id: 'prestacao-destaque',
      icon: '💰',
      label: 'Fechar Atendimento',
      destaque: !emEntrega,
      acaoTipo: 'prestacao',
      consignacaoId: alvo.id
    };
    if (!emEntrega) entrega.destaque = false;
  }

  return [
    entrega,
    fechar,
    { id: 'conta-corrente', icon: '📄', label: 'Conta Corrente', destaque: false, acaoTipo: 'conta-corrente' },
    { id: 'historico', icon: '🕘', label: 'Histórico', destaque: false, acaoTipo: 'historico' },
    { id: 'dados-cliente', icon: '⚙', label: 'Dados do Cliente', destaque: false, acaoTipo: 'dados-cliente' }
  ];
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

function humanizarEvento(ev = {}) {
  const tipo = String(ev.tipo || ev.tipoMovimentacao || ev.operacao || '').toUpperCase();
  const desc = String(ev.descricao || ev.motivo || '').toLowerCase();

  if (/PRESTAC.*FECH|FECH.*PRESTAC/i.test(`${tipo} ${desc}`)) return 'Atendimento encerrado';
  if (/PRESTAC.*ABERT|ABERT.*PRESTAC/i.test(`${tipo} ${desc}`)) return 'Fechamento iniciado';
  if (/ENTREGA/i.test(`${tipo} ${desc}`)) return 'Entrega realizada';
  if (/CONSIGN|NOVA/i.test(`${tipo} ${desc}`)) return 'Nova consignação';
  if (/PAGAMENTO|RECEB/i.test(`${tipo} ${desc}`)) return 'Recebimento registrado';
  if (/PERFIL.*CRIAD|CADASTRO|CLIENTE.*CRIAD/i.test(`${tipo} ${desc}`)) return 'Cadastro do cliente';
  if (/BLOQUE/i.test(`${tipo} ${desc}`)) return 'Cliente bloqueado';
  if (/DESBLOQUE/i.test(`${tipo} ${desc}`)) return 'Cliente desbloqueado';

  return ev.descricao || ev.motivo || ev.tipo || 'Movimentação comercial';
}

function buildHistoricoSimplificado(historico = [], timeline = [], perfil = {}) {
  const eventos = [
    ...buildHistoricoUnificado(historico, []),
    ...normalizeTimelineEvents(timeline)
  ];

  const vistos = new Set();
  const itens = [];

  eventos
    .sort((a, b) => new Date(b.data || 0) - new Date(a.data || 0))
    .forEach((ev) => {
      const descricao = humanizarEvento(ev);
      const chave = `${ev.data}-${descricao}`;
      if (vistos.has(chave)) return;
      vistos.add(chave);
      itens.push({
        periodo: formatarPeriodoRelativo(ev.data),
        descricao,
        data: ev.data
      });
    });

  if (!itens.length && perfil.createdAt) {
    itens.push({
      periodo: formatarPeriodoRelativo(perfil.createdAt),
      descricao: 'Cadastro do cliente',
      data: perfil.createdAt
    });
  }

  return itens.slice(0, 8);
}

function buildDocumentos(consignacoes = []) {
  return [...consignacoes]
    .sort((a, b) => new Date(b.createdAt || b.data || 0) - new Date(a.createdAt || a.data || 0))
    .slice(0, 10)
    .map((c) => ({
      id: c.id,
      numero: c.documento || `Consignação #${c.id}`,
      tipo: 'Consignação',
      data: c.dataEntrega || c.dataAbertura || c.createdAt,
      status: c.status || '—'
    }));
}

function buildIdentificacao({
  perfil = {},
  perfis = [],
  situacao = {},
  resumo = {},
  contaCorrente = {},
  consignacoes = [],
  timeline = []
} = {}) {
  const saldoAtual = Number(
    contaCorrente.saldoAtual
    ?? contaCorrente.saldo
    ?? situacao.saldo
    ?? resumo.saldoUtilizado
    ?? 0
  );

  const cidade = extrairCidade(perfil);
  const uf = extrairUf(perfil);
  const cidadeUf = cidade !== '—' && uf ? `${cidade}/${uf}` : cidade;

  return {
    nome: perfil.clienteNome || perfil.cliente || '—',
    documento: perfil.cpfCnpj || '—',
    telefone: perfil.telefone || '—',
    whatsapp: extrairWhatsApp(perfil),
    cidade: cidadeUf,
    status: normalizarStatus(perfil, situacao),
    capacidades: extrairCapacidadesDosPerfis(perfis.length ? perfis : [perfil]),
    saldoAtual,
    consignacoesAbertas: contarConsignacoesAbertas(consignacoes, situacao),
    ultimaPrestacao: extrairUltimaPrestacao(consignacoes, timeline, situacao),
    ultimaEntrega: extrairUltimaEntrega(consignacoes, timeline)
  };
}

function buildSituacaoCliente({
  perfil = {},
  situacao = {},
  resumo = {},
  consignacoes = [],
  pendencias = {},
  timeline = [],
  identificacao = {}
} = {}) {
  const { limite, utilizado, disponivel } = metricasLimite(perfil, situacao, resumo);
  const proximoAcerto = extrairProximoAcerto(consignacoes, situacao);

  return {
    limiteComercial: limite,
    creditoUtilizado: utilizado,
    creditoDisponivel: disponivel,
    consignacoesAbertas: identificacao.consignacoesAbertas
      ?? contarConsignacoesAbertas(consignacoes, situacao),
    pendencias: contarPendencias(pendencias),
    proximoAcerto,
    ultimaEntrega: identificacao.ultimaEntrega
      ?? extrairUltimaEntrega(consignacoes, timeline),
    ultimoAcerto: identificacao.ultimaPrestacao
      ?? extrairUltimaPrestacao(consignacoes, timeline, situacao)
  };
}

function buildResumoOperacional({
  identificacao = {},
  resumo = {},
  situacao = {}
} = {}) {
  return {
    saldoAtual: identificacao.saldoAtual,
    consignacoesAbertas: identificacao.consignacoesAbertas,
    valorEmAberto: Number(situacao.saldo ?? resumo.saldoUtilizado ?? identificacao.saldoAtual ?? 0),
    ultimaEntrega: identificacao.ultimaEntrega,
    ultimaPrestacao: identificacao.ultimaPrestacao
  };
}

function buildCentralOperacoesViewModel(payload = {}) {
  const {
    perfil,
    perfis = [],
    situacao = {},
    resumo = {},
    contaCorrente = {},
    consignacoes = [],
    pendencias = {},
    historico = [],
    timeline = [],
    consignacoesHistorico = null,
    historicoPaginacao = null
  } = payload;

  const identificacao = buildIdentificacao({
    perfil, perfis, situacao, resumo, contaCorrente, consignacoes, timeline
  });

  const proximaAcao = buildProximaAcao({
    perfil, situacao, resumo, consignacoes, pendencias
  });

  const situacaoCliente = buildSituacaoCliente({
    perfil, situacao, resumo, consignacoes, pendencias, timeline, identificacao
  });

  return {
    identificacao,
    proximaAcao,
    acoesPrincipais: buildAcoesPrincipais(proximaAcao, consignacoes),
    situacaoCliente,
    resumoComercial: buildResumoOperacional({ identificacao, resumo, situacao }),
    situacaoFinanceira: {
      saldoAtual: identificacao.saldoAtual,
      lancamentos: (contaCorrente.lancamentos || contaCorrente.movimentacoes || []).slice(0, 5)
    },
    historico: buildHistoricoSimplificado(historico, timeline, perfil),
    consignacoesHistorico: Array.isArray(consignacoesHistorico)
      ? consignacoesHistorico
      : buildHistoricoConsignacoes(consignacoes, perfil?.clienteId),
    historicoPaginacao,
    documentos: buildDocumentos(consignacoes)
  };
}

module.exports = {
  buildCentralOperacoesViewModel,
  buildProximaAcao,
  buildAcoesPrincipais,
  buildHistoricoSimplificado,
  buildIdentificacao,
  buildSituacaoCliente,
  metricasLimite,
  limiteExcedido,
  findConsignacaoEmEntrega,
  findConsignacaoEmPrestacao,
  findConsignacaoPrestacaoPendente,
  buildHistoricoConsignacoes
};
