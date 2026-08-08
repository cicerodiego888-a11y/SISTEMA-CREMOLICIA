/**
 * CDS Mobile RC1 — Formatters
 * Copyright (c) 2026 CDS Sistemas
 * Nunca renderizar objetos crus (evita [object Object]).
 */

export function asText(value, fallback = '—') {
  if (value == null || value === '') return fallback;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toLocaleString('pt-BR');
  }
  if (Array.isArray(value)) {
    return value.map((v) => asText(v, '')).filter(Boolean).join(', ') || fallback;
  }
  if (typeof value === 'object') {
    const prefer = [
      value.nome,
      value.name,
      value.razao_social,
      value.descricao,
      value.label,
      value.titulo,
      value.title,
      value.numero_documento,
      value.documento,
      value.codigo,
      value.username,
      value.login,
      value.id != null ? `#${value.id}` : null
    ];
    for (const p of prefer) {
      if (p != null && p !== '' && typeof p !== 'object') return String(p);
    }
    return fallback;
  }
  return fallback;
}

export function escapeHtml(value) {
  return asText(value, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatMoney(value) {
  const n = Number(value);
  const safe = Number.isFinite(n) ? n : 0;
  return safe.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatNumber(value, digits = 0) {
  const n = Number(value);
  const safe = Number.isFinite(n) ? n : 0;
  return safe.toLocaleString('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

export function formatDate(value) {
  if (value == null || value === '') return '—';
  if (typeof value === 'object' && !(value instanceof Date)) {
    return asText(value);
  }
  const raw = String(value);
  const d = new Date(raw.includes('T') || raw.includes(' ') ? raw : raw + 'T12:00:00');
  if (Number.isNaN(d.getTime())) {
    return raw.slice(0, 10);
  }
  return d.toLocaleDateString('pt-BR');
}

export function formatDateTime(value) {
  if (value == null || value === '') return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return asText(value);
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function normalizeText(value) {
  return asText(value, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * @returns {{ key: string, label: string, tone: string, icon: string }}
 */
export function resolveStatus(status) {
  const raw = asText(status, '');
  const s = raw.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // RCM-04.B — badges comerciais padronizados (ordem específica antes dos genéricos)
  if (/CANCEL/.test(s)) return { key: 'cancelada', label: 'CANCELADA', tone: 'danger', icon: 'warning' };
  if (/FINALIZ|ACERTAD|QUITAD|ENCERRAD/.test(s) && !/PREST/.test(s)) {
    return { key: 'finalizada', label: 'FINALIZADA', tone: 'ok', icon: 'check' };
  }
  if (/PRESTACAO.?PEND|PRESTACAO.?ABERT|FECHAMENTO.?EM.?ABERT/.test(s)) {
    return { key: 'prestacao_pendente', label: 'PRESTAÇÃO PENDENTE', tone: 'warn', icon: 'warning' };
  }
  if (/^ENTREGUE$|STATUS.?ENTREGUE/.test(s) || s === 'ENTREGUE') {
    return { key: 'entregue', label: 'ENTREGUE', tone: 'primary', icon: 'check' };
  }
  if (/EM.?ENTREGA/.test(s)) {
    return { key: 'em_entrega', label: 'EM ENTREGA', tone: 'primary', icon: 'truck' };
  }
  if (/PREPARAC/.test(s)) {
    return { key: 'preparacao', label: 'PREPARAÇÃO', tone: 'primary', icon: 'box' };
  }
  if (/RASCUNH/.test(s)) {
    return { key: 'rascunho', label: 'RASCUNHO', tone: 'neutral', icon: 'more' };
  }

  if (/QUIT|PAGO|RECEBID|LIQUID/.test(s)) return { key: 'quitada', label: raw || 'Quitada', tone: 'ok', icon: 'check' };
  if (/FECH|ENCERR|CONCLU|FINAL/.test(s)) {
    return { key: 'encerrada', label: raw || 'Encerrada', tone: 'ok', icon: 'check' };
  }
  if (/ATIVO|ATIVA|OK/.test(s)) return { key: 'ativa', label: raw || 'Ativa', tone: 'ok', icon: 'check' };
  if (/BAIXO|CRITICO/.test(s)) {
    return { key: 'baixo', label: raw || 'Baixo', tone: 'warn', icon: 'warning' };
  }
  if (/PEND|ABERT|ANDAMENT|AGUARD|EM_/.test(s)) {
    return { key: 'pendente', label: raw || 'Pendente', tone: 'warn', icon: 'warning' };
  }
  if (/ATRAS|VENCID|CRIT|BLOQ/.test(s)) {
    return { key: 'atrasada', label: raw || 'Em atraso', tone: 'danger', icon: 'warning' };
  }
  if (!raw) return { key: 'indefinido', label: '—', tone: 'neutral', icon: 'more' };
  return { key: 'outro', label: raw, tone: 'neutral', icon: 'more' };
}

export function entityName(entity, fallback = '—') {
  if (entity == null) return fallback;
  if (typeof entity !== 'object') return asText(entity, fallback);
  return asText(
    entity.nome ||
      entity.name ||
      entity.razao_social ||
      entity.cliente_nome ||
      entity.nome_cliente ||
      entity.produto_nome ||
      entity.descricao,
    fallback
  );
}

export function greetingForNow() {
  const h = new Date().getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

export function currentUserName() {
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    return asText(user.nome || user.name || user.username, 'Usuário');
  } catch (e) {
    return 'Usuário';
  }
}

export function currentCompanyName() {
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const fromUser = asText(user.empresa || user.empresa_nome || user.razao_social || user.filial, '');
    if (fromUser && fromUser !== '—') return fromUser;
  } catch (e) { /* ignore */ }
  try {
    const cfg = localStorage.getItem('cds_empresa_nome');
    if (cfg) return asText(cfg, 'CDS Sistemas');
  } catch (e) { /* ignore */ }
  return 'CDS Sistemas';
}
