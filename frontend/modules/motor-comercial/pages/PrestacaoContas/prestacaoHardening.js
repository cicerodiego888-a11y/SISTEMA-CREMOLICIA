/**
 * STAB-06.6.4 — Hardening operacional da Prestação (RC1).
 * Somente UX / mensagens / logs. Sem alterar regras, APIs ou ledger.
 *
 * @module frontend/modules/motor-comercial/pages/PrestacaoContas/prestacaoHardening
 */

const { MENSAGENS } = require('./prestacaoOperacionalConsolidacao');
const { auditarIntegridadeFinanceira, round2 } = require('./prestacaoFinanceiroSnapshot');

const MENSAGENS_HARDENING = Object.freeze({
  ...MENSAGENS,
  PRESTACAO_SALVA: '✓ Prestação salva.',
  PAGAMENTO_REGISTRADO: '✓ Pagamento registrado.',
  EMITINDO_NFCE: 'Emitindo NFC-e...',
  CRIANDO_VENDA: 'Criando Venda Oficial...',
  ENCERRANDO: 'Encerrando Prestação...',
  REGISTRANDO_PAGAMENTO: 'Registrando pagamento...',
  SALVANDO_ALTERACOES: 'Salvando alterações...',
  ERRO_CADASTRO_FISCAL:
    '⚠ O cadastro fiscal do produto precisa ser corrigido antes da emissão da NFC-e.',
  ERRO_SEFAZ:
    '⚠ A SEFAZ está indisponível no momento. Você pode tentar novamente sem duplicar a venda.',
  ERRO_TIMEOUT:
    '⚠ A operação demorou mais do que o esperado. Tente novamente.',
  ERRO_REDE:
    '⚠ Não foi possível conectar. Verifique a internet e tente novamente.',
  ERRO_GENERICO:
    '⚠ Não foi possível concluir a operação.\nTente novamente ou contate o suporte.',
  STATUS_VAZIO: '—',
  CAMPO_AUSENTE: '—',
  OPERACAO_EM_ANDAMENTO: 'Operação em andamento...'
});

const PLACEHOLDER_RE = /^(Produto|Cliente|Item)\s*#/i;

function safeText(value, fallback = MENSAGENS_HARDENING.CAMPO_AUSENTE) {
  if (value == null) return fallback;
  if (typeof value === 'number' && Number.isNaN(value)) return fallback;
  const text = String(value).trim();
  if (!text || text === 'null' || text === 'undefined' || text === 'NaN') return fallback;
  if (PLACEHOLDER_RE.test(text)) return '⚠ Informação não localizada';
  return text;
}

function safeMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return n;
}

/**
 * Converte erros técnicos em mensagem amigável + classificação.
 * @returns {{ mensagem: string, retryable: boolean, tipo: string, acaoSugerida: string|null }}
 */
function humanizarErroOperacional(error, contexto = '') {
  const raw = String(error?.message || error || '');
  const upper = raw.toUpperCase();

  if (/NCM|CFOP|CST|GTIN|CEST|CADASTRO FISCAL|PRODUTO.*FISCAL/i.test(raw)) {
    return {
      mensagem: MENSAGENS_HARDENING.ERRO_CADASTRO_FISCAL,
      retryable: false,
      tipo: 'CADASTRO_FISCAL',
      acaoSugerida: 'Corrigir Cadastro'
    };
  }

  if (/SEFAZ|SERVICO.*INDISPONIVEL|SERVICE UNAVAILABLE|503|REJECT.*TIMEOUT/i.test(raw)
    || /indisponív/i.test(raw)) {
    return {
      mensagem: MENSAGENS_HARDENING.ERRO_SEFAZ,
      retryable: true,
      tipo: 'SEFAZ',
      acaoSugerida: 'Tentar novamente'
    };
  }

  if (/TIMEOUT|ETIMEDOUT|ECONNABORTED|TEMPO.*ESGOTADO/i.test(raw)
    || /timed?\s*out/i.test(raw)) {
    return {
      mensagem: MENSAGENS_HARDENING.ERRO_TIMEOUT,
      retryable: true,
      tipo: 'TIMEOUT',
      acaoSugerida: 'Tentar novamente'
    };
  }

  if (/NETWORK|ENOTFOUND|ECONNREFUSED|FAILED TO FETCH|INTERNET|OFFLINE/i.test(raw)) {
    return {
      mensagem: MENSAGENS_HARDENING.ERRO_REDE,
      retryable: true,
      tipo: 'REDE',
      acaoSugerida: 'Tentar novamente'
    };
  }

  if (contexto === 'pagamento' && /SALDO|PAGAMENTO/i.test(upper)) {
    return {
      mensagem: '⚠ Não foi possível registrar o pagamento.\nConfira o valor e o saldo em aberto.',
      retryable: false,
      tipo: 'PAGAMENTO',
      acaoSugerida: null
    };
  }

  // Evita vazar stack/códigos brutos
  if (/Error:|TypeError|at\s+\w+|SQLITE|SQL\s|HTTP\s*\d{3}/i.test(raw) || raw.length > 180) {
    return {
      mensagem: MENSAGENS_HARDENING.ERRO_GENERICO,
      retryable: true,
      tipo: 'GENERICO',
      acaoSugerida: 'Tentar novamente'
    };
  }

  if (!raw.trim()) {
    return {
      mensagem: MENSAGENS_HARDENING.ERRO_GENERICO,
      retryable: true,
      tipo: 'GENERICO',
      acaoSugerida: 'Tentar novamente'
    };
  }

  return {
    mensagem: raw.startsWith('⚠') ? raw : `⚠ ${raw}`,
    retryable: false,
    tipo: 'OPERACIONAL',
    acaoSugerida: null
  };
}

/**
 * Motivo amigável para botão desabilitado (tooltip).
 */
function motivoBotaoDesabilitado(acao, ctx = {}) {
  const {
    loading = false,
    emitindo = false,
    podeEncerrarPermissao = true,
    dirty = false,
    situacaoFiscal = '',
    salvando = false
  } = ctx;

  if (loading || emitindo) {
    if (acao === 'emitir') return MENSAGENS_HARDENING.EMITINDO_NFCE;
    if (acao === 'encerrar') return MENSAGENS_HARDENING.ENCERRANDO;
    return MENSAGENS_HARDENING.OPERACAO_EM_ANDAMENTO;
  }
  if (salvando) return MENSAGENS_HARDENING.SALVANDO_ALTERACOES;
  if (dirty && (acao === 'emitir' || acao === 'encerrar' || acao === 'continuar')) {
    return 'Existem alterações pendentes.';
  }
  if (!podeEncerrarPermissao && (acao === 'emitir' || acao === 'encerrar')) {
    return 'Você não tem permissão para esta ação.';
  }
  // NFC-e é opcional: não bloqueia Encerrar Prestação.
  if (acao === 'emitir' && String(situacaoFiscal || '').toUpperCase() === 'AUTORIZADA') {
    return 'A NFC-e já foi autorizada.';
  }
  if (acao === 'voltar' && dirty) {
    return 'Salve ou corrija as alterações pendentes antes de voltar.';
  }
  return '';
}

function aplicarTooltipDesabilitado(buttonEl, motivo) {
  if (!buttonEl) return buttonEl;
  if (motivo && buttonEl.disabled) {
    buttonEl.title = motivo;
    buttonEl.setAttribute('aria-description', motivo);
  } else {
    buttonEl.removeAttribute('title');
    buttonEl.removeAttribute('aria-description');
  }
  return buttonEl;
}

/**
 * Auditoria final RC1 — somente logs, não bloqueia.
 */
function auditarFinalRC1({
  consignacao = {},
  financeiro = {},
  faturamento = null,
  historico = [],
  itens = []
} = {}) {
  const checks = [];
  const fat = faturamento || {};
  const valorVenda = safeMoney(financeiro.valorVenda);
  const vendaId = fat.vendaId || null;
  const situacaoFiscal = String(fat.situacaoFiscal || '').toUpperCase();

  checks.push({
    nome: 'Snapshot financeiro íntegro',
    ok: !auditarIntegridadeFinanceira(financeiro)
  });
  checks.push({
    nome: 'Financeiro íntegro (venda = recebido + saldo)',
    ok: Math.abs(
      round2(valorVenda)
      - round2(safeMoney(financeiro.valorRecebido) + safeMoney(financeiro.saldoEmAberto))
    ) <= 0.01
  });
  checks.push({
    nome: 'Venda Oficial existe (quando há venda)',
    ok: valorVenda <= 0.01 || Boolean(vendaId) || situacaoFiscal === 'NAO_APLICAVEL' || !situacaoFiscal
  });
  checks.push({
    nome: 'NFC-e consistente',
    ok: situacaoFiscal !== 'AUTORIZADA' || Boolean(fat.nfce?.numero || fat.nfce?.chave || vendaId)
  });
  checks.push({
    nome: 'Ledger acessível',
    ok: Array.isArray(historico)
  });
  checks.push({
    nome: 'Estoque (itens da consignação)',
    ok: Array.isArray(itens)
  });
  checks.push({
    nome: 'Prestação consistente',
    ok: Boolean(consignacao?.id)
  });

  const registro = {
    tipo: 'AUDITORIA_FINAL_RC1',
    consignacaoId: consignacao.id || null,
    vendaId,
    situacaoFiscal: situacaoFiscal || null,
    checks,
    todosOk: checks.every((c) => c.ok),
    em: new Date().toISOString()
  };

  return registro;
}

/**
 * Log operacional enriquecido (suporte).
 */
function registrarLogOperacional(evento, dados = {}) {
  const inicio = dados.inicioMs ? Number(dados.inicioMs) : null;
  const fim = Date.now();
  const log = {
    tipo: 'LOG_OPERACIONAL_RC1',
    evento,
    usuario: dados.usuario || _usuarioLocal(),
    consignacaoId: dados.consignacaoId || null,
    prestacao: dados.prestacao || dados.consignacaoId || null,
    vendaOficial: dados.vendaOficial || dados.vendaId || null,
    nfce: dados.nfce || null,
    resultado: dados.resultado || null,
    origem: dados.origem || 'prestacao-contas',
    tempoMs: inicio != null ? Math.max(0, fim - inicio) : null,
    dataHora: new Date().toISOString(),
    detalhes: dados.detalhes || null
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

function criarAlertaErroOperacional(Alert, humanizado, { onRetry = null, onClose = null } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'cds-prestacao-erro-operacional';

  wrap.appendChild(Alert.create({
    message: humanizado.mensagem,
    variant: humanizado.retryable ? 'warning' : 'error',
    dismissible: true
  }));

  const actions = document.createElement('div');
  actions.className = 'cds-prestacao-erro-operacional__acoes';

  if (humanizado.retryable && typeof onRetry === 'function') {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'cds-btn cds-btn--secondary';
    retry.textContent = humanizado.acaoSugerida || 'Tentar novamente';
    retry.addEventListener('click', onRetry);
    actions.appendChild(retry);
  } else if (humanizado.tipo === 'CADASTRO_FISCAL') {
    const info = document.createElement('button');
    info.type = 'button';
    info.className = 'cds-btn cds-btn--secondary';
    info.textContent = 'Corrigir Cadastro';
    info.title = 'Abra o cadastro do produto no ERP e corrija NCM/CFOP/CST/GTIN.';
    actions.appendChild(info);
  }

  if (typeof onClose === 'function') {
    const fechar = document.createElement('button');
    fechar.type = 'button';
    fechar.className = 'cds-btn cds-btn--ghost';
    fechar.textContent = 'Fechar';
    fechar.addEventListener('click', onClose);
    actions.appendChild(fechar);
  }

  if (actions.childNodes.length) wrap.appendChild(actions);
  return wrap;
}

module.exports = {
  MENSAGENS_HARDENING,
  safeText,
  safeMoney,
  humanizarErroOperacional,
  motivoBotaoDesabilitado,
  aplicarTooltipDesabilitado,
  auditarFinalRC1,
  registrarLogOperacional,
  criarAlertaErroOperacional,
  PLACEHOLDER_RE
};
