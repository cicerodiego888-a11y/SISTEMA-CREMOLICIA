/**
 * STAB-06.6.3 — Consolidação operacional da Prestação (somente UX).
 *
 * Timeline, estados oficiais, labels, mensagens e auditorias de apresentação.
 * Não altera Motor Comercial / Fiscal / Ledger / APIs.
 *
 * @module frontend/modules/motor-comercial/pages/PrestacaoContas/prestacaoOperacionalConsolidacao
 */

const { formatDocumento } = require('../../api/helpers');
const {
  auditarIntegridadeFinanceira,
  assertMesmoFinanceiro,
  round2
} = require('./prestacaoFinanceiroSnapshot');

/** Estados operacionais oficiais da UI (não confundir com status do ledger). */
const ESTADO_PRESTACAO = Object.freeze({
  ABERTA: 'ABERTA',
  EM_ATENDIMENTO: 'EM_ATENDIMENTO',
  EMITINDO_NFCE: 'EMITINDO_NFCE',
  PENDENTE_REGULARIZACAO_FISCAL: 'PENDENTE_REGULARIZACAO_FISCAL',
  ENCERRADA: 'ENCERRADA'
});

const ESTADO_PRESTACAO_LABEL = Object.freeze({
  ABERTA: 'Aberta',
  EM_ATENDIMENTO: 'Em atendimento',
  EMITINDO_NFCE: 'Emitindo NFC-e',
  PENDENTE_REGULARIZACAO_FISCAL: 'Pendente de regularização fiscal',
  ENCERRADA: 'Encerrada'
});

/** Situação financeira — textos únicos do operador. */
const SITUACAO_FINANCEIRA_LABEL = Object.freeze({
  QUITADA: 'Quitada',
  PARCIAL: 'Parcial',
  PENDENTE: 'Pendente',
  // aliases internos → oficiais
  PARCIALMENTE_RECEBIDA: 'Parcial',
  EM_ABERTO: 'Em Aberto',
  SEM_VENDA: 'Sem Venda'
});

/** Situação fiscal — textos únicos do operador. */
const SITUACAO_FISCAL = Object.freeze({
  NAO_APLICAVEL: 'NAO_APLICAVEL',
  PENDENTE: 'PENDENTE',
  EMITINDO: 'EMITINDO',
  AUTORIZADA: 'AUTORIZADA',
  REJEITADA: 'REJEITADA',
  PENDENTE_REGULARIZACAO: 'PENDENTE_REGULARIZACAO'
});

const SITUACAO_FISCAL_LABEL = Object.freeze({
  NAO_APLICAVEL: 'Não Aplicável',
  PENDENTE: 'Pendente',
  EMITINDO: 'Emitindo',
  AUTORIZADA: 'Autorizada',
  REJEITADA: 'Rejeitada',
  PENDENTE_REGULARIZACAO: 'Pendente de Regularização'
});

const MENSAGENS = Object.freeze({
  PRESTACAO_QUITADA: '✓ Prestação totalmente quitada.',
  VENDA_OFICIAL_CRIADA: '✓ Venda Oficial criada.',
  NFCE_AUTORIZADA: '✓ NFC-e autorizada.',
  NFCE_PENDENTE_REGULARIZACAO: '⚠ NFC-e pendente de regularização.',
  PRESTACAO_ENCERRADA: '✓ Prestação encerrada.',
  SALDO_PENDENTE: 'Saldo pendente de recebimento.',
  EMISSAO_NAO_APLICAVEL: 'Emissão não aplicável.',
  EMITA_ANTES_ENCERRAR: 'NFC-e é opcional — você pode encerrar a prestação sem emitir.'
});

const TIMELINE_ETAPAS = Object.freeze([
  { key: 'entrega', label: 'Entrega' },
  { key: 'prestacao', label: 'Prestação' },
  { key: 'vendaOficial', label: 'Venda Oficial' },
  { key: 'nfce', label: 'NFC-e' },
  { key: 'encerramento', label: 'Encerramento' }
]);

const TIMELINE_ESTADO = Object.freeze({
  CONCLUIDA: 'concluida',
  ATUAL: 'atual',
  PENDENTE: 'pendente',
  ATENCAO: 'atencao'
});

const TIMELINE_MARCA = Object.freeze({
  concluida: '✓',
  atual: '●',
  pendente: '○',
  atencao: '⚠'
});

const MOTIVO_CADASTRO_RE = /NCM|CFOP|CST|GTIN|cadastro|produto|tribut|EAN|CEST/i;

function labelSituacaoFinanceiraOficial(codigo) {
  const key = String(codigo || '').toUpperCase();
  return SITUACAO_FINANCEIRA_LABEL[key] || SITUACAO_FINANCEIRA_LABEL.PENDENTE;
}

function isRejeicaoCadastro(faturamento = {}) {
  const motivo = String(
    faturamento?.nfce?.motivo
    || faturamento?.motivo
    || faturamento?.mensagem
    || ''
  );
  return MOTIVO_CADASTRO_RE.test(motivo);
}

/**
 * Normaliza situação fiscal para os códigos oficiais da UI.
 */
function resolverSituacaoFiscal(faturamento = {}, { emitindo = false, valorVenda = 0 } = {}) {
  if (emitindo) {
    return {
      codigo: SITUACAO_FISCAL.EMITINDO,
      label: SITUACAO_FISCAL_LABEL.EMITINDO
    };
  }

  const raw = String(faturamento?.situacaoFiscal || '').toUpperCase();

  if (raw === 'AUTORIZADA') {
    return {
      codigo: SITUACAO_FISCAL.AUTORIZADA,
      label: SITUACAO_FISCAL_LABEL.AUTORIZADA
    };
  }

  if (raw === 'REJEITADA') {
    if (isRejeicaoCadastro(faturamento)) {
      return {
        codigo: SITUACAO_FISCAL.PENDENTE_REGULARIZACAO,
        label: '⚠ Pendente de Regularização Fiscal'
      };
    }
    return {
      codigo: SITUACAO_FISCAL.REJEITADA,
      label: SITUACAO_FISCAL_LABEL.REJEITADA
    };
  }

  if (raw === 'NAO_APLICAVEL') {
    return {
      codigo: SITUACAO_FISCAL.NAO_APLICAVEL,
      label: SITUACAO_FISCAL_LABEL.NAO_APLICAVEL
    };
  }

  // Sem status fiscal explícito e sem venda → não aplicável
  if (!raw && Number(valorVenda) <= 0.01 && !faturamento?.vendaId) {
    return {
      codigo: SITUACAO_FISCAL.NAO_APLICAVEL,
      label: SITUACAO_FISCAL_LABEL.NAO_APLICAVEL
    };
  }

  return {
    codigo: SITUACAO_FISCAL.PENDENTE,
    label: SITUACAO_FISCAL_LABEL.PENDENTE
  };
}

function resolverEstadoPrestacao({
  encerrado = false,
  emitindoNfce = false,
  faturamento = null,
  prestacaoAberta = false,
  currentStep = 0
} = {}) {
  if (encerrado) return ESTADO_PRESTACAO.ENCERRADA;
  if (emitindoNfce) return ESTADO_PRESTACAO.EMITINDO_NFCE;

  const fiscal = resolverSituacaoFiscal(faturamento || {});
  if (fiscal.codigo === SITUACAO_FISCAL.PENDENTE_REGULARIZACAO) {
    return ESTADO_PRESTACAO.PENDENTE_REGULARIZACAO_FISCAL;
  }

  if (prestacaoAberta || currentStep >= 0) {
    return ESTADO_PRESTACAO.EM_ATENDIMENTO;
  }

  return ESTADO_PRESTACAO.ABERTA;
}

function labelEstadoPrestacao(estado) {
  return ESTADO_PRESTACAO_LABEL[estado] || estado || '—';
}

function _statusEntrega(consignacao = {}) {
  const st = String(consignacao.status || '').toUpperCase();
  if (consignacao.dataEntrega || ['ENTREGUE', 'EM_PRESTACAO', 'ACERTADA', 'QUITADA', 'ENCERRADA'].includes(st)) {
    return TIMELINE_ESTADO.CONCLUIDA;
  }
  return TIMELINE_ESTADO.PENDENTE;
}

/**
 * Timeline informativa (não altera fluxo).
 */
function buildTimelineOficial({
  consignacao = {},
  financeiro = {},
  faturamento = null,
  encerrado = false,
  emitindoNfce = false,
  currentStep = 1
} = {}) {
  const valorVenda = Number(financeiro.valorVenda || 0);
  const fiscal = resolverSituacaoFiscal(faturamento || {}, {
    emitindo: emitindoNfce,
    valorVenda
  });
  const vendaId = faturamento?.vendaId || null;
  const temVenda = Boolean(vendaId) || valorVenda > 0.01;

  const entrega = _statusEntrega(consignacao);

  let prestacao = TIMELINE_ESTADO.PENDENTE;
  if (encerrado) prestacao = TIMELINE_ESTADO.CONCLUIDA;
  else if (currentStep >= 0 && currentStep <= 3) prestacao = TIMELINE_ESTADO.ATUAL;

  let vendaOficial = TIMELINE_ESTADO.PENDENTE;
  if (vendaId || (encerrado && temVenda)) vendaOficial = TIMELINE_ESTADO.CONCLUIDA;
  else if (!temVenda && (encerrado || currentStep >= 3)) vendaOficial = TIMELINE_ESTADO.CONCLUIDA;
  else if (currentStep === 3 && temVenda && !vendaId) vendaOficial = TIMELINE_ESTADO.ATUAL;

  let nfce = TIMELINE_ESTADO.PENDENTE;
  if (fiscal.codigo === SITUACAO_FISCAL.AUTORIZADA || fiscal.codigo === SITUACAO_FISCAL.NAO_APLICAVEL) {
    nfce = TIMELINE_ESTADO.CONCLUIDA;
  } else if (fiscal.codigo === SITUACAO_FISCAL.PENDENTE_REGULARIZACAO
    || fiscal.codigo === SITUACAO_FISCAL.REJEITADA) {
    nfce = TIMELINE_ESTADO.ATENCAO;
  } else if (emitindoNfce || fiscal.codigo === SITUACAO_FISCAL.EMITINDO) {
    nfce = TIMELINE_ESTADO.ATUAL;
  } else if (currentStep === 3 && temVenda) {
    nfce = TIMELINE_ESTADO.ATUAL;
  }

  let encerramento = TIMELINE_ESTADO.PENDENTE;
  if (encerrado) encerramento = TIMELINE_ESTADO.CONCLUIDA;
  else if (currentStep === 4) encerramento = TIMELINE_ESTADO.ATUAL;

  // Se Prestação ainda "atual" e já avançou past step markers, só uma ● por vez (prioridade)
  const estados = {
    entrega,
    prestacao,
    vendaOficial,
    nfce,
    encerramento
  };

  if (encerrado) {
    Object.keys(estados).forEach((k) => {
      if (estados[k] === TIMELINE_ESTADO.ATUAL) estados[k] = TIMELINE_ESTADO.CONCLUIDA;
    });
    estados.encerramento = TIMELINE_ESTADO.CONCLUIDA;
  }

  return TIMELINE_ETAPAS.map((etapa) => {
    const estado = estados[etapa.key] || TIMELINE_ESTADO.PENDENTE;
    return {
      key: etapa.key,
      label: etapa.label,
      estado,
      marca: TIMELINE_MARCA[estado] || '○'
    };
  });
}

function renderTimelineElement(timeline = [], { vertical = false } = {}) {
  const nav = document.createElement('nav');
  nav.className = vertical
    ? 'cds-prestacao-timeline cds-prestacao-timeline--vertical'
    : 'cds-prestacao-timeline';
  nav.setAttribute('aria-label', 'Linha do tempo da Prestação');
  nav.innerHTML = timeline.map((etapa, index) => `
    <div class="cds-prestacao-timeline__etapa cds-prestacao-timeline__etapa--${etapa.estado}" data-etapa="${etapa.key}">
      <span class="cds-prestacao-timeline__marca" aria-hidden="true">${etapa.marca}</span>
      <span class="cds-prestacao-timeline__label">${etapa.label}</span>
    </div>
    ${index < timeline.length - 1
      ? `<span class="cds-prestacao-timeline__seta" aria-hidden="true">${vertical ? '↓' : '→'}</span>`
      : ''}
  `).join('');
  return nav;
}

/**
 * Auditoria de integridade ao abrir Resumo Final.
 */
function auditarIntegridadeNoResumo(financeiro = {}, contexto = {}) {
  const registro = auditarIntegridadeFinanceira(financeiro, {
    ...contexto,
    origem: contexto.origem || 'resumo-final'
  });
  if (!registro) return null;

  const diferenca = round2(
    Number(financeiro.valorVenda || 0)
    - (Number(financeiro.valorRecebido || 0) + Number(financeiro.saldoEmAberto || 0))
  );
  return {
    ...registro,
    mensagem: 'Prestação inconsistente.',
    diferenca
  };
}

/**
 * Auditoria fiscal leve (somente log).
 */
function auditarCadeiaFiscal({ faturamento = null, financeiro = {}, historico = [] } = {}) {
  const issues = [];
  const valorVenda = Number(financeiro.valorVenda || 0);
  const fat = faturamento || {};
  const vendaId = fat.vendaId || null;
  const situacao = String(fat.situacaoFiscal || '').toUpperCase();

  if (valorVenda > 0.01 && !vendaId && situacao === 'AUTORIZADA') {
    issues.push('NFC-e autorizada sem vendaId no faturamento');
  }
  if (situacao === 'AUTORIZADA' && !fat.nfce?.chave && !fat.nfce?.numero) {
    issues.push('Situação AUTORIZADA sem número/chave NFC-e');
  }
  if (vendaId && situacao === 'PENDENTE' && Array.isArray(historico) && historico.length === 0) {
    issues.push('Venda Oficial presente sem histórico fiscal acessível');
  }

  if (!issues.length) return null;

  return {
    tipo: 'DIVERGENCIA_FISCAL_PRESTACAO',
    mensagem: 'Divergência na cadeia fiscal da Prestação.',
    issues,
    vendaId,
    situacaoFiscal: situacao,
    nfce: fat.nfce || null,
    em: new Date().toISOString()
  };
}

/**
 * Resumo operacional de fechamento — apenas campos oficiais.
 */
function buildPainelFechamentoOperacional({
  consignacao = {},
  clienteDetalhe = null,
  financeiro = {},
  faturamento = null,
  emitindoNfce = false
} = {}) {
  const cliente = clienteDetalhe?.nome
    || consignacao.clienteNome
    || (typeof consignacao.cliente === 'string' ? consignacao.cliente : consignacao.cliente?.nome)
    || '—';
  const documento = formatDocumento(consignacao.documento, consignacao.id);
  const fiscal = resolverSituacaoFiscal(faturamento || {}, {
    emitindo: emitindoNfce,
    valorVenda: financeiro.valorVenda
  });
  const nfce = faturamento?.nfce || {};

  return {
    cliente,
    documento,
    valorVenda: Number(financeiro.valorVenda || 0),
    valorRecebido: Number(financeiro.valorRecebido || 0),
    saldoEmAberto: Number(financeiro.saldoEmAberto || 0),
    situacaoFinanceira: financeiro.situacaoFinanceira,
    situacaoFinanceiraLabel: labelSituacaoFinanceiraOficial(financeiro.situacaoFinanceira),
    situacaoFiscal: fiscal.codigo,
    situacaoFiscalLabel: fiscal.label,
    vendaId: faturamento?.vendaId || null,
    nfceNumero: nfce.numero || null,
    nfceChave: nfce.chave || null,
    proximoPasso: _proximoPasso({ financeiro, fiscal, faturamento })
  };
}

function _proximoPasso({ financeiro, fiscal, faturamento }) {
  if (fiscal.codigo === SITUACAO_FISCAL.PENDENTE_REGULARIZACAO) {
    return 'Regularize NCM/CFOP/CST/GTIN e tente emitir novamente.';
  }
  if (fiscal.codigo === SITUACAO_FISCAL.REJEITADA) {
    return 'Revise a rejeição e tente emitir a NFC-e novamente.';
  }
  if (fiscal.codigo === SITUACAO_FISCAL.PENDENTE && Number(financeiro.valorVenda || 0) > 0.01) {
    return 'NFC-e opcional — emita se quiser, ou encerre a prestação.';
  }
  if (Number(financeiro.saldoEmAberto || 0) > 0.01) {
    return 'Há saldo em aberto — pode encerrar; o saldo permanece na conta corrente.';
  }
  if (faturamento?.vendaId || fiscal.codigo === SITUACAO_FISCAL.NAO_APLICAVEL
    || fiscal.codigo === SITUACAO_FISCAL.AUTORIZADA) {
    return 'Encerrar a Prestação.';
  }
  return 'Continue o atendimento.';
}

/**
 * Log operacional ao encerrar (Centro de Auditoria futuro).
 */
function registrarLogEncerramento({
  consignacao = {},
  financeiro = {},
  faturamento = null,
  usuario = null
} = {}) {
  const fiscal = resolverSituacaoFiscal(faturamento || {}, {
    valorVenda: financeiro.valorVenda
  });
  const log = {
    tipo: 'PRESTACAO_ENCERRADA',
    evento: 'Prestação encerrada',
    consignacaoId: consignacao.id || null,
    documento: formatDocumento(consignacao.documento, consignacao.id),
    vendaOficial: faturamento?.vendaId || null,
    situacaoFinanceira: labelSituacaoFinanceiraOficial(financeiro.situacaoFinanceira),
    situacaoFiscal: fiscal.label,
    usuario: usuario || _usuarioLocal(),
    dataHora: new Date().toISOString(),
    valores: {
      valorVenda: Number(financeiro.valorVenda || 0),
      valorRecebido: Number(financeiro.valorRecebido || 0),
      saldoEmAberto: Number(financeiro.saldoEmAberto || 0)
    }
  };
  return log;
}

function _usuarioLocal() {
  if (typeof localStorage === 'undefined') return '—';
  try {
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    return user?.nome || user?.username || user?.name || '—';
  } catch (_e) {
    return '—';
  }
}

function mensagemNfceResultado(faturamento = {}) {
  const fiscal = resolverSituacaoFiscal(faturamento);
  if (fiscal.codigo === SITUACAO_FISCAL.AUTORIZADA) return MENSAGENS.NFCE_AUTORIZADA;
  if (fiscal.codigo === SITUACAO_FISCAL.PENDENTE_REGULARIZACAO) {
    return MENSAGENS.NFCE_PENDENTE_REGULARIZACAO;
  }
  if (fiscal.codigo === SITUACAO_FISCAL.NAO_APLICAVEL) return MENSAGENS.EMISSAO_NAO_APLICAVEL;
  return null;
}

module.exports = {
  ESTADO_PRESTACAO,
  ESTADO_PRESTACAO_LABEL,
  SITUACAO_FINANCEIRA_LABEL,
  SITUACAO_FISCAL,
  SITUACAO_FISCAL_LABEL,
  MENSAGENS,
  TIMELINE_ETAPAS,
  TIMELINE_ESTADO,
  TIMELINE_MARCA,
  labelSituacaoFinanceiraOficial,
  resolverSituacaoFiscal,
  resolverEstadoPrestacao,
  labelEstadoPrestacao,
  buildTimelineOficial,
  renderTimelineElement,
  auditarIntegridadeNoResumo,
  auditarCadeiaFiscal,
  buildPainelFechamentoOperacional,
  registrarLogEncerramento,
  mensagemNfceResultado,
  assertMesmoFinanceiro,
  isRejeicaoCadastro
};
