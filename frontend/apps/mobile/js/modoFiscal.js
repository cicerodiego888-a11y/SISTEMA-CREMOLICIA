/**
 * RCM-9.2.5 — Modo Fiscal/Não Fiscal no CDS Mobile
 * Reutiliza o mesmo contrato do Desktop (F12):
 * - localStorage `pdv_modo_fiscal_ativo` ('1'|'0')
 * - GET/PUT /api/configuracoes/modo_dashboard_fiscal
 * Não cria Motor Fiscal nem nova API.
 */
import { escapeHtml } from './ui.js';
import { showToast } from './toast.js';

const KEY = 'pdv_modo_fiscal_ativo';
const KEY_ALIAS = 'modo_dashboard_fiscal';
const API_CHAVE = 'modo_dashboard_fiscal';

function normalizar(valor) {
  return valor === true || valor === 'true' || valor === 1 || valor === '1' ? '1' : '0';
}

export function isModoFiscalAtivo() {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch (_) {
    return false;
  }
}

export function getModoFiscalLocal() {
  return isModoFiscalAtivo() ? '1' : '0';
}

function aplicarLocal(valor) {
  const normalizado = normalizar(valor);
  try {
    localStorage.setItem(KEY, normalizado);
    localStorage.setItem(KEY_ALIAS, normalizado);
  } catch (_) { /* ignore */ }
  return normalizado;
}

async function salvarNoServidor(valor) {
  const normalizado = normalizar(valor);
  try {
    await window.CDSApi.put(`configuracoes/${API_CHAVE}`, { valor: normalizado });
  } catch (err) {
    console.warn('[Mobile] falha ao salvar modo fiscal no servidor', err);
  }
}

/**
 * Sincroniza com o servidor (mesmo endpoint do Desktop F12).
 * Se remoto falhar, mantém localStorage.
 */
export async function sincronizarModoFiscalDoServidor() {
  try {
    const row = await window.CDSApi.get(`configuracoes/${API_CHAVE}`);
    if (row && row.valor !== undefined && row.valor !== null) {
      aplicarLocal(row.valor);
      return getModoFiscalLocal();
    }
  } catch (err) {
    console.warn('[Mobile] falha ao ler modo fiscal do servidor', err);
  }
  if (localStorage.getItem(KEY) === null) {
    aplicarLocal('0');
  }
  return getModoFiscalLocal();
}

/**
 * Alterna modo (equivalente a F12 / alternarModoFiscalGlobal).
 */
export async function alternarModoFiscalMobile({ silent = false } = {}) {
  const novo = isModoFiscalAtivo() ? '0' : '1';
  aplicarLocal(novo);
  await salvarNoServidor(novo);
  if (!silent) {
    showToast(
      novo === '1' ? 'Modo FISCAL ativado.' : 'Modo NÃO FISCAL ativado.',
      novo === '1' ? 'success' : 'info'
    );
  }
  return novo === '1';
}

export function modoFiscalChipHtml() {
  const on = isModoFiscalAtivo();
  const label = on ? 'FISCAL' : 'NÃO FISCAL';
  const emoji = on ? '🟢' : '⚪';
  const cls = on ? 'cds-fiscal-chip cds-fiscal-chip--on' : 'cds-fiscal-chip cds-fiscal-chip--off';
  return `
    <button type="button" class="${cls}" id="pdv-fiscal-chip"
      aria-pressed="${on ? 'true' : 'false'}"
      aria-label="Modo ${label}. Toque para alternar."
      title="Alternar Fiscal / Não Fiscal (mesmo F12 do Desktop)">
      <span aria-hidden="true">${emoji}</span>
      <span class="cds-fiscal-chip__label">${escapeHtml(label)}</span>
    </button>
  `;
}

export function bindModoFiscalChip(root, { onChange } = {}) {
  const chip = root?.querySelector?.('#pdv-fiscal-chip');
  if (!chip) return;
  chip.addEventListener('click', async () => {
    if (chip.disabled) return;
    chip.disabled = true;
    try {
      await alternarModoFiscalMobile();
      if (typeof onChange === 'function') onChange(isModoFiscalAtivo());
      else {
        const host = chip.parentElement;
        if (host) {
          const wrap = document.createElement('div');
          wrap.innerHTML = modoFiscalChipHtml().trim();
          const next = wrap.firstElementChild;
          chip.replaceWith(next);
          bindModoFiscalChip(root, { onChange });
        }
      }
    } finally {
      const el = root?.querySelector?.('#pdv-fiscal-chip');
      if (el) el.disabled = false;
    }
  });
}

/** Valor a enviar em emitir_fiscal na venda (contrato Desktop). */
export function emitirFiscalDaVendaAtual() {
  return isModoFiscalAtivo();
}
