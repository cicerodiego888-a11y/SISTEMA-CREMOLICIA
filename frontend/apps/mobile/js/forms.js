/**
 * CDS Mobile RC2 — Formulários e sheets mobile
 * Copyright (c) 2026 CDS Sistemas
 * Helpers de UI sem regras de negócio.
 */

import { escapeHtml, asText } from './formatters.js';
import { icon } from './icons.js';

/** Aceita 1,5 e 1.5 (mesma regra do ERP Desktop). */
export function parseQty(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return NaN;
  if (s.includes(',') && s.includes('.')) {
    return Number(s.replace(/\./g, '').replace(',', '.'));
  }
  if (s.includes(',')) return Number(s.replace(',', '.'));
  return Number(s);
}

export function qtyControlHtml({
  name = 'quantidade',
  value = 1,
  min = 0.001,
  step = 1,
  id,
  enterkeyhint = 'done'
} = {}) {
  const inputId = id || `f-${escapeHtml(name)}`;
  return `
    <div class="cds-qty cds-qty--field" data-qty-control data-qty-min="${escapeHtml(min)}" data-qty-step="${escapeHtml(step)}">
      <button type="button" class="cds-qty__btn" data-qty-delta="-1" aria-label="Diminuir quantidade">−</button>
      <input class="cds-qty__input" type="text" inputmode="decimal"
        id="${inputId}" name="${escapeHtml(name)}" value="${escapeHtml(asText(value, '1'))}"
        autocomplete="off" aria-label="Quantidade"
        enterkeyhint="${escapeHtml(enterkeyhint)}">
      <button type="button" class="cds-qty__btn" data-qty-delta="1" aria-label="Aumentar quantidade">+</button>
    </div>
  `;
}

export function bindQtyControls(root, { min = 0.001, step = 1 } = {}) {
  if (!root) return;
  root.querySelectorAll('[data-qty-control]').forEach((wrap) => {
    if (wrap.dataset.qtyBound === '1') return;
    wrap.dataset.qtyBound = '1';
    const input = wrap.querySelector('input[name]');
    if (!input) return;
    const minVal = Number(wrap.getAttribute('data-qty-min') ?? min);
    const stepVal = Number(wrap.getAttribute('data-qty-step') ?? step);
    const applyDelta = (sign) => {
      const cur = parseQty(input.value);
      const base = Number.isFinite(cur) ? cur : 0;
      const next = Math.max(minVal, base + sign * stepVal);
      const rounded = Math.round(next * 1000) / 1000;
      input.value = String(rounded).replace('.', ',');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    wrap.querySelectorAll('[data-qty-delta]').forEach((btn) => {
      // click only — sem preventDefault/stopPropagation (não bloqueia scroll Android)
      btn.addEventListener('click', () => {
        applyDelta(Number(btn.getAttribute('data-qty-delta')));
      });
    });
  });
}

export function fieldHtml({
  name,
  label,
  type = 'text',
  value = '',
  placeholder = '',
  required = false,
  inputmode,
  autocomplete,
  rows
}) {
  const id = `f-${escapeHtml(name)}`;
  const common = `
    id="${id}"
    name="${escapeHtml(name)}"
    ${required ? 'required' : ''}
    ${inputmode ? `inputmode="${escapeHtml(inputmode)}"` : ''}
    ${autocomplete ? `autocomplete="${escapeHtml(autocomplete)}"` : ''}
  `;

  if (type === 'textarea') {
    return `
      <label class="cds-field" for="${id}">
        <span class="cds-field__label">${escapeHtml(label)}${required ? ' *' : ''}</span>
        <textarea class="cds-field__input" rows="${rows || 3}" ${common}
          placeholder="${escapeHtml(placeholder)}">${escapeHtml(asText(value, ''))}</textarea>
      </label>
    `;
  }

  if (type === 'select') {
    const options = Array.isArray(value) ? value : [];
    return `
      <label class="cds-field" for="${id}">
        <span class="cds-field__label">${escapeHtml(label)}${required ? ' *' : ''}</span>
        <select class="cds-field__input" ${common}>
          ${options.map((o) => `
            <option value="${escapeHtml(o.value)}" ${o.selected ? 'selected' : ''}>
              ${escapeHtml(o.label)}
            </option>
          `).join('')}
        </select>
      </label>
    `;
  }

  if (type === 'checkbox') {
    return `
      <label class="cds-field cds-field--check" for="${id}">
        <input type="checkbox" id="${id}" name="${escapeHtml(name)}" ${value ? 'checked' : ''}>
        <span>${escapeHtml(label)}</span>
      </label>
    `;
  }

  return `
    <label class="cds-field" for="${id}">
      <span class="cds-field__label">${escapeHtml(label)}${required ? ' *' : ''}</span>
      <input class="cds-field__input" type="${escapeHtml(type)}" value="${escapeHtml(asText(value, ''))}"
        placeholder="${escapeHtml(placeholder)}" ${common}>
    </label>
  `;
}

export function formCardHtml(title, fieldsHtml, actionsHtml = '') {
  return `
    <form class="cds-card cds-form cds-m-enter" id="cds-form" novalidate>
      ${title ? `<h3 class="cds-card__title">${escapeHtml(title)}</h3>` : ''}
      <div class="cds-form__fields">${fieldsHtml}</div>
      <div class="cds-form__actions">${actionsHtml}</div>
    </form>
  `;
}

export function collectForm(form) {
  const data = {};
  if (!form) return data;
  const fd = new FormData(form);
  fd.forEach((value, key) => {
    data[key] = typeof value === 'string' ? value.trim() : value;
  });
  form.querySelectorAll('input[type="checkbox"][name]').forEach((el) => {
    data[el.name] = el.checked;
  });
  return data;
}

export function fabHtml(label, goOrAction = 'create') {
  const isRoute = String(goOrAction).includes('/') || !['create', 'edit'].includes(goOrAction);
  const attr = isRoute ? `data-go="${escapeHtml(goOrAction)}"` : `data-action="${escapeHtml(goOrAction)}"`;
  return `
    <button type="button" class="cds-fab" ${attr} aria-label="${escapeHtml(label)}">
      ${icon('plus')} <span>${escapeHtml(label)}</span>
    </button>
  `;
}

export function actionBarHtml(buttons = []) {
  return `
    <div class="cds-action-bar">
      ${buttons.map((b) => `
        <button type="button"
          class="cds-mobile-btn ${b.variant ? `cds-mobile-btn--${escapeHtml(b.variant)}` : ''}"
          data-action="${escapeHtml(b.action)}"
          ${b.disabled ? 'disabled' : ''}>
          ${b.icon ? icon(b.icon) : ''} ${escapeHtml(b.label)}
        </button>
      `).join('')}
    </div>
  `;
}

/**
 * Confirmação nativa via Bottom Sheet (substitui window.confirm).
 * @returns {Promise<boolean>}
 */
export async function confirmDanger(message, options = {}) {
  return confirmSheet({
    title: options.title || 'Confirmar',
    message: asText(message, 'Confirmar ação?'),
    confirmLabel: options.confirmLabel || 'Confirmar',
    danger: true
  });
}

/**
 * Exibe texto longo em sheet (substitui window.alert).
 */
export function showTextSheet({ title = 'Detalhe', text = '' } = {}) {
  const body = escapeHtml(String(text || '').slice(0, 8000));
  return openBottomSheet({
    title,
    bodyHtml: `<pre class="cds-text-sheet">${body}</pre>`,
    actionsHtml: `<button type="button" class="cds-mobile-btn" data-sheet-close>Fechar</button>`
  });
}

/**
 * Feedback de botão ocupado durante await (UX nativa).
 */
export async function withBusy(btn, labelBusy, fn) {
  if (!btn || typeof fn !== 'function') return fn?.();
  const prev = btn.innerHTML;
  const prevDisabled = btn.disabled;
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  if (labelBusy) btn.textContent = labelBusy;
  try {
    return await fn();
  } finally {
    btn.disabled = prevDisabled;
    btn.removeAttribute('aria-busy');
    btn.innerHTML = prev;
  }
}

export function tabsHtml(tabs = [], activeId = '') {
  return `
    <div class="cds-tabs" role="tablist">
      ${(tabs || []).map((t) => `
        <button type="button"
          class="cds-tabs__item ${t.id === activeId ? 'is-active' : ''}"
          data-tab="${escapeHtml(t.id)}"
          ${t.go ? `data-go="${escapeHtml(t.go)}"` : ''}>
          ${escapeHtml(t.label)}
        </button>
      `).join('')}
    </div>
  `;
}

export function openBottomSheet({
  title = '',
  bodyHtml = '',
  actionsHtml = '',
  panelClass = '',
  closeMs = 180
} = {}) {
  closeBottomSheet({ immediate: true });
  const el = document.createElement('div');
  el.className = 'cds-sheet';
  el.id = 'cds-mobile-sheet';
  el.setAttribute('aria-hidden', 'false');
  el.dataset.closeMs = String(closeMs);
  el.innerHTML = `
    <div class="cds-sheet__backdrop" data-sheet-close></div>
    <div class="cds-sheet__panel cds-m-enter ${panelClass || ''}" role="dialog" aria-modal="true">
      <div class="cds-sheet__handle" aria-hidden="true"></div>
      ${title ? `<h3 class="cds-sheet__title">${escapeHtml(title)}</h3>` : ''}
      <div class="cds-sheet__body">${bodyHtml || ''}</div>
      ${actionsHtml ? `<div class="cds-sheet__actions">${actionsHtml}</div>` : ''}
    </div>
  `;
  document.body.appendChild(el);
  document.body.classList.add('is-overlay-open');
  requestAnimationFrame(() => el.classList.add('is-open'));
  el.querySelectorAll('[data-sheet-close]').forEach((btn) => {
    btn.addEventListener('click', () => closeBottomSheet());
  });
  return el;
}

export function closeBottomSheet({ immediate = false } = {}) {
  const el = document.getElementById('cds-mobile-sheet');
  if (!el) {
    if (!document.querySelector('.cds-mobile-drawer.is-open') && !document.querySelector('.cds-scan-overlay')) {
      document.body.classList.remove('is-overlay-open');
    }
    return;
  }
  // Libera o id na hora para o próximo sheet não competir no seletor #cds-mobile-sheet
  el.removeAttribute('id');
  if (immediate) {
    el.remove();
    if (!document.getElementById('cds-mobile-sheet')
      && !document.querySelector('.cds-mobile-drawer.is-open')
      && !document.querySelector('.cds-scan-overlay')) {
      document.body.classList.remove('is-overlay-open');
    }
    return;
  }
  const ms = Number(el.dataset.closeMs || 180);
  const panel = el.querySelector('.cds-sheet__panel');
  if (panel && Number.isFinite(ms) && ms !== 180) {
    panel.style.transitionDuration = `${ms}ms`;
  }
  el.classList.remove('is-open');
  el.setAttribute('aria-hidden', 'true');
  setTimeout(() => {
    el.remove();
    if (!document.getElementById('cds-mobile-sheet')
      && !document.querySelector('.cds-mobile-drawer.is-open')
      && !document.querySelector('.cds-scan-overlay')) {
      document.body.classList.remove('is-overlay-open');
    }
  }, Number.isFinite(ms) ? ms : 180);
}

export function confirmSheet({ title = 'Confirmar', message = '', confirmLabel = 'Confirmar', danger = false } = {}) {
  return new Promise((resolve) => {
    const sheet = openBottomSheet({
      title,
      bodyHtml: `<p class="cds-muted" style="margin:0">${escapeHtml(asText(message))}</p>`,
      actionsHtml: `
        <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" data-sheet-close data-cancel>Cancelar</button>
        <button type="button" class="cds-mobile-btn ${danger ? 'cds-mobile-btn--danger' : ''}" data-ok>
          ${escapeHtml(confirmLabel)}
        </button>
      `
    });
    sheet.querySelector('[data-cancel]')?.addEventListener('click', () => resolve(false));
    sheet.querySelector('[data-sheet-close]')?.addEventListener('click', () => resolve(false));
    sheet.querySelector('[data-ok]')?.addEventListener('click', () => {
      closeBottomSheet();
      resolve(true);
    });
  });
}

export function promptSheet({
  title = '',
  fieldsHtml = '',
  confirmLabel = 'Confirmar',
  collect = null
} = {}) {
  return new Promise((resolve) => {
    const sheet = openBottomSheet({
      title,
      bodyHtml: `<form id="cds-sheet-form" class="cds-form" novalidate>${fieldsHtml}</form>`,
      actionsHtml: `
        <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" data-sheet-close data-cancel>Cancelar</button>
        <button type="button" class="cds-mobile-btn" data-ok>${escapeHtml(confirmLabel)}</button>
      `
    });
    const finish = (value) => {
      closeBottomSheet();
      resolve(value);
    };
    bindQtyControls(sheet);
    sheet.querySelector('[data-cancel]')?.addEventListener('click', () => finish(null));
    sheet.querySelector('[data-sheet-close]')?.addEventListener('click', () => finish(null));
    sheet.querySelector('[data-ok]')?.addEventListener('click', () => {
      const form = sheet.querySelector('#cds-sheet-form');
      const data = typeof collect === 'function' ? collect(form) : collectForm(form);
      finish(data);
    });
    requestAnimationFrame(() => {
      sheet.querySelector('.cds-qty__input')?.focus();
      sheet.querySelector('.cds-qty__input')?.select();
    });
  });
}

export function currentUserId() {
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    return user.id || user.usuario_id || null;
  } catch (e) {
    return null;
  }
}

export function unwrapList(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.results)) return payload.results;
  return [];
}

/** Seção padronizada dos cadastros (paridade visual RC2.4.2). */
export function cadastroSectionHtml(title) {
  return `
    <div class="cds-section-head">
      <h4 class="cds-section-head__title">${escapeHtml(title)}</h4>
    </div>
  `;
}

/** Ações padronizadas: Salvar + Cancelar. */
export function formSubmitActionsHtml(submitLabel = 'Salvar') {
  return `
    <button type="submit" class="cds-mobile-btn">${escapeHtml(submitLabel)}</button>
    <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" data-nav-back>Cancelar</button>
  `;
}

/** Máscara CPF/CNPJ — mesma regra do ERP Desktop (core.js). */
export function formatCpfCnpjInput(input) {
  if (!input) return;
  let value = String(input.value || '').replace(/\D/g, '').slice(0, 14);
  if (value.length <= 11) {
    value = value.replace(/(\d{3})(\d)/, '$1.$2');
    value = value.replace(/(\d{3})(\d)/, '$1.$2');
    value = value.replace(/(\d{3})(\d)/, '$1-$2');
  } else {
    value = value.replace(/(\d{2})(\d)/, '$1.$2');
    value = value.replace(/(\d{3})(\d)/, '$1.$2');
    value = value.replace(/(\d{3})(\d)/, '$1\/$2');
    value = value.replace(/(\d{4})(\d)/, '$1-$2');
  }
  input.value = value;
}

/**
 * ViaCEP no blur/input — mesma fonte do ERP Desktop.
 * @param {HTMLElement} root
 * @param {{ cep?: string, rua?: string, bairro?: string, cidade?: string, uf?: string }} names
 */
export function bindCadastroCep(root, names = {}) {
  const cepName = names.cep || 'cep';
  const cepEl = root.querySelector(`[name="${cepName}"]`);
  if (!cepEl) return;

  let ultimo = '';
  const aplicar = async () => {
    const cep = String(cepEl.value || '').replace(/\D/g, '').slice(0, 8);
    if (cep.length === 5 || cep.length === 8) {
      cepEl.value = cep.length > 5 ? `${cep.slice(0, 5)}-${cep.slice(5)}` : cep;
    }
    if (cep.length !== 8 || cep === ultimo) return;
    ultimo = cep;
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const data = await res.json();
      if (data?.erro) {
        ultimo = '';
        return;
      }
      const set = (name, val) => {
        const el = root.querySelector(`[name="${name}"]`);
        if (el && val != null) el.value = val;
      };
      set(names.rua || 'rua', data.logradouro || '');
      set(names.bairro || 'bairro', data.bairro || '');
      set(names.cidade || 'cidade', data.localidade || '');
      set(names.uf || 'uf', String(data.uf || '').toUpperCase());
    } catch (e) {
      ultimo = '';
    }
  };

  cepEl.addEventListener('input', () => {
    const digits = String(cepEl.value || '').replace(/\D/g, '').slice(0, 8);
    cepEl.value = digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
    if (digits.length === 8) aplicar();
  });
  cepEl.addEventListener('blur', aplicar);
}

export function bindCpfCnpjMask(root, name = 'cpf_cnpj') {
  const el = root.querySelector(`[name="${name}"]`);
  if (!el) return;
  el.setAttribute('maxlength', '18');
  el.addEventListener('input', () => formatCpfCnpjInput(el));
}
