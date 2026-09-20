/**
 * CDS Mobile RC1.1 / RCM-9.2 — Terminal do Cliente Oficial
 * Persiste terminal_id no dispositivo e reutiliza o motor /api/terminais.
 */
import {
  CDS_MOBILE_VERSION,
  CDS_MOBILE_VERSION_LABEL
} from './version.js';

const KEYS = {
  id: 'cds_mobile_terminal_id',
  hostname: 'cds_mobile_terminal_hostname',
  nome: 'cds_mobile_terminal_nome',
  registered: 'cds_mobile_terminal_registered',
  caixaId: 'cds_mobile_terminal_caixa_id',
  caixaNome: 'cds_mobile_terminal_caixa_nome',
  ativo: 'cds_mobile_terminal_ativo'
};

const HEARTBEAT_MS = 2 * 60 * 1000;
let heartbeatTimer = null;

function readUser() {
  try {
    return JSON.parse(localStorage.getItem('user') || '{}') || {};
  } catch (e) {
    return {};
  }
}

function suggestedName() {
  const user = readUser();
  const first = String(user.nome || user.username || 'Mobile')
    .trim()
    .split(/\s+/)[0] || 'Mobile';
  return `CDS Mobile ${first}`;
}

function detectPlatform() {
  const ua = String(navigator.userAgent || '').toLowerCase();
  if (/ipad|tablet/.test(ua)) return 'tablet';
  if (/mobi|android|iphone/.test(ua)) return 'mobile';
  return 'web';
}

function toPositiveInt(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function getStoredTerminal() {
  try {
    const id = toPositiveInt(localStorage.getItem(KEYS.id));
    const hostname = localStorage.getItem(KEYS.hostname) || '';
    const nome = localStorage.getItem(KEYS.nome) || '';
    const registered = localStorage.getItem(KEYS.registered) === '1';
    const caixaId = toPositiveInt(localStorage.getItem(KEYS.caixaId));
    const caixaNome = localStorage.getItem(KEYS.caixaNome) || '';
    const ativoRaw = localStorage.getItem(KEYS.ativo);
    const ativo = ativoRaw == null || ativoRaw === '' ? true : !(ativoRaw === '0' || ativoRaw === 'false');
    return {
      id,
      hostname,
      nome,
      registered: registered && !!id,
      caixaId,
      caixaNome,
      ativo
    };
  } catch (e) {
    return {
      id: null, hostname: '', nome: '', registered: false,
      caixaId: null, caixaNome: '', ativo: true
    };
  }
}

export function isTerminalRegistered() {
  return getStoredTerminal().registered === true;
}

function persistTerminal(terminal) {
  if (!terminal || !terminal.id) return;
  try {
    localStorage.setItem(KEYS.id, String(terminal.id));
    localStorage.setItem(KEYS.hostname, String(terminal.hostname || ''));
    localStorage.setItem(KEYS.nome, String(terminal.nome || terminal.hostname || ''));
    localStorage.setItem(KEYS.registered, '1');
    const caixaId = toPositiveInt(terminal.caixa_id ?? terminal.caixaId);
    if (caixaId) localStorage.setItem(KEYS.caixaId, String(caixaId));
    else localStorage.removeItem(KEYS.caixaId);
    const caixaNome = terminal.caixa_nome || terminal.caixaNome || '';
    if (caixaNome) localStorage.setItem(KEYS.caixaNome, String(caixaNome));
    else localStorage.removeItem(KEYS.caixaNome);
    const ativo = terminal.ativo == null ? 1 : (Number(terminal.ativo) === 0 ? 0 : 1);
    localStorage.setItem(KEYS.ativo, String(ativo));
    window.terminalId = Number(terminal.id);
    window.__CDS_MOBILE_TERMINAL__ = {
      id: Number(terminal.id),
      hostname: terminal.hostname,
      nome: terminal.nome,
      caixa_id: caixaId,
      caixa_nome: caixaNome || null,
      ativo: ativo === 1,
      cliente_tipo: 'mobile'
    };
  } catch (e) { /* ignore */ }
}

export function ensureHostname() {
  const stored = getStoredTerminal();
  if (stored.hostname) return stored.hostname;
  try {
    let host = localStorage.getItem(KEYS.hostname);
    if (!host) {
      host = `mobile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      localStorage.setItem(KEYS.hostname, host);
    }
    return host;
  } catch (e) {
    return `mobile-${Date.now().toString(36)}`;
  }
}

export function getClientHeaders() {
  const t = getStoredTerminal();
  const headers = {
    'X-CDS-Client': 'mobile',
    'X-CDS-Client-Version': CDS_MOBILE_VERSION,
    'X-CDS-Client-Platform': detectPlatform()
  };
  if (t.id) headers['X-Terminal-Id'] = String(t.id);
  return headers;
}

export function getTerminalRequestBody(body) {
  const next = Object.assign({}, body || {});
  const t = getStoredTerminal();
  if (t.id) next.terminal_id = t.id;
  next.origem_pdv = 'PDV_MOBILE';
  next.origem = next.origem || 'PDV_MOBILE';
  return next;
}

/**
 * Estado operacional do terminal/caixa para UX (RCM-9.2).
 * @param {{ caixaAberto?: boolean }} [opts]
 */
export function getTerminalUiState(opts = {}) {
  const t = getStoredTerminal();
  if (!t.registered || !t.id) {
    return {
      code: 'NAO_REGISTRADO',
      tone: 'warn',
      emoji: '🟡',
      title: 'Terminal não registrado',
      message: 'Registre este dispositivo para vender.'
    };
  }
  if (t.ativo === false) {
    return {
      code: 'INATIVO',
      tone: 'danger',
      emoji: '🔴',
      title: 'Terminal inativo',
      message: 'Ative o terminal no ERP em Gerenciar Caixas.'
    };
  }
  if (!t.caixaId) {
    return {
      code: 'SEM_CAIXA',
      tone: 'warn',
      emoji: '🟠',
      title: 'Sem caixa vinculado',
      message: 'Este terminal ainda não está vinculado a um caixa. Vincule o terminal no ERP em Gerenciar Caixas.'
    };
  }
  if (!opts.caixaAberto) {
    return {
      code: 'CAIXA_FECHADO',
      tone: 'warn',
      emoji: '🟡',
      title: 'Caixa fechado',
      message: 'Abra o caixa neste terminal para vender.'
    };
  }
  return {
    code: 'CAIXA_ABERTO',
    tone: 'ok',
    emoji: '🟢',
    title: 'Pronto para vender',
    message: t.caixaNome
      ? `Caixa ${t.caixaNome} aberto neste terminal.`
      : 'Caixa aberto neste terminal.'
  };
}

export async function heartbeatTerminal(opts) {
  opts = opts || {};
  if (!window.CDSApi || typeof window.CDSApi.get !== 'function') {
    throw new Error('API indisponível');
  }
  const hostname = ensureHostname();
  const user = readUser();
  const nome = String(opts.nome || getStoredTerminal().nome || suggestedName()).trim();

  const terminal = await window.CDSApi.get('terminais/auto', {
    hostname,
    origem: 'mobile',
    cliente_tipo: 'mobile',
    nome,
    versao: CDS_MOBILE_VERSION,
    plataforma: detectPlatform(),
    usuario_id: user.id || user.usuario_id || undefined,
    usuario_nome: user.nome || user.username || undefined
  });

  persistTerminal(terminal);

  try {
    if (terminal?.id && !terminal.caixa_nome && terminal.caixa_id) {
      const lista = await window.CDSApi.get('terminais');
      const rows = Array.isArray(lista) ? lista : (lista?.items || lista?.data || []);
      const row = rows.find((r) => Number(r.id) === Number(terminal.id));
      if (row) persistTerminal({ ...terminal, ...row });
    }
  } catch (_e) { /* lista pode exigir multiCaixa — heartbeat já basta */ }

  return getStoredTerminal();
}

export async function registerTerminal(nome) {
  const label = String(nome || suggestedName()).trim();
  if (!label) throw new Error('Informe um nome para o terminal.');
  try {
    localStorage.setItem(KEYS.nome, label);
  } catch (e) { /* ignore */ }
  const terminal = await heartbeatTerminal({ nome: label });
  startHeartbeat();
  return terminal;
}

/** Recarrega identidade do servidor (nome/caixa_id/ativo) sem recriar hostname. */
export async function syncTerminalFromServer() {
  if (!isTerminalRegistered()) return getStoredTerminal();
  return heartbeatTerminal();
}

export function startHeartbeat() {
  if (heartbeatTimer) return;
  if (!isTerminalRegistered()) return;
  heartbeatTimer = setInterval(() => {
    heartbeatTerminal().catch(() => {});
  }, HEARTBEAT_MS);
  heartbeatTerminal().catch(() => {});
}

export function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

export async function disconnectTerminal() {
  const t = getStoredTerminal();
  stopHeartbeat();
  if (!t.hostname || !window.CDSApi) return;
  try {
    await window.CDSApi.get('terminais/auto/offline', {
      hostname: t.hostname,
      origem: 'mobile'
    });
  } catch (e) { /* ignore */ }
}

export function clearTerminalLocal() {
  stopHeartbeat();
  try {
    Object.values(KEYS).forEach((k) => localStorage.removeItem(k));
  } catch (e) { /* ignore */ }
  window.terminalId = null;
  window.__CDS_MOBILE_TERMINAL__ = null;
}

export function getSuggestedTerminalName() {
  return suggestedName();
}

export function getClientMeta() {
  const t = getStoredTerminal();
  return {
    client_id: 'cds-mobile',
    client_type: 'mobile',
    client_label: CDS_MOBILE_VERSION_LABEL,
    version: CDS_MOBILE_VERSION,
    platform: detectPlatform(),
    terminal_id: t.id,
    terminal_nome: t.nome,
    hostname: t.hostname || ensureHostname(),
    caixa_id: t.caixaId
  };
}

export default {
  getStoredTerminal,
  isTerminalRegistered,
  ensureHostname,
  getClientHeaders,
  getTerminalRequestBody,
  getTerminalUiState,
  heartbeatTerminal,
  registerTerminal,
  syncTerminalFromServer,
  startHeartbeat,
  stopHeartbeat,
  disconnectTerminal,
  clearTerminalLocal,
  getSuggestedTerminalName,
  getClientMeta
};
