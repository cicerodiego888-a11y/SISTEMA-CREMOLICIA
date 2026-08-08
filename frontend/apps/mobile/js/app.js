/**
 * CDS Mobile RC2.2 — App Shell & Router
 * Paridade operacional com ERP Desktop.
 */
import { escapeHtml, loadingHtml, errorHtml, offlineHtml, icon } from './ui.js';
import { showToast } from './toast.js';
import {
  canAccessRoute,
  listAllowedNavRoutes,
  firstAllowedRoute,
  assertRouteAccess
} from './permissions.js';
import {
  CDS_MOBILE_VERSION,
  CDS_MOBILE_VERSION_LABEL,
  CDS_MOBILE_BUILD
} from './version.js';
import * as CDSMobileTerminal from './terminal.js';

window.CDSMobileTerminal = CDSMobileTerminal;

const PAGE_LOADERS = {
  dashboard: () => import('./pages/dashboard.js'),
  cadastros: () => import('./pages/cadastros.js'),
  clientes: () => import('./pages/clientes.js'),
  fornecedores: () => import('./pages/fornecedores.js'),
  produtos: () => import('./pages/produtos.js'),
  categorias: () => import('./pages/categorias.js'),
  usuarios: () => import('./pages/usuarios.js'),
  estoque: () => import('./pages/estoque.js'),
  compras: () => import('./pages/compras.js'),
  'central-entradas': () => import('./pages/central-entradas.js'),
  comercial: () => import('./pages/comercial.js'),
  financeiro: () => import('./pages/financeiro.js'),
  fiscal: () => import('./pages/fiscal.js'),
  caixas: () => import('./pages/caixas.js'),
  auditoria: () => import('./pages/auditoria.js'),
  pdv: () => import('./pages/pdv.js'),
  perfil: () => import('./pages/perfil.js'),
  configuracoes: () => import('./pages/configuracoes.js'),
  equipamentos: () => import('./pages/equipamentos.js'),
  relatorios: () => import('./pages/relatorios.js'),
  mais: null
};

const META = {
  dashboard: { title: 'Início', subtitle: 'Seu dia', nav: 'dashboard' },
  cadastros: { title: 'Cadastros', subtitle: 'ERP', nav: 'mais' },
  clientes: { title: 'Clientes', subtitle: 'Cadastros', nav: 'clientes' },
  fornecedores: { title: 'Fornecedores', subtitle: 'Cadastros', nav: 'mais' },
  produtos: { title: 'Produtos', subtitle: 'Cadastros', nav: 'mais' },
  categorias: { title: 'Categorias', subtitle: 'Cadastros', nav: 'mais' },
  usuarios: { title: 'Usuários', subtitle: 'Cadastros', nav: 'mais' },
  estoque: { title: 'Estoque', subtitle: 'Operacional', nav: 'mais' },
  compras: { title: 'Compras', subtitle: 'Operações', nav: 'mais' },
  'central-entradas': { title: 'Central Entradas', subtitle: 'NF / MIIP', nav: 'mais' },
  comercial: { title: 'Comercial', subtitle: 'Motor Comercial', nav: 'mais' },
  financeiro: { title: 'Financeiro', subtitle: 'Operacional', nav: 'mais' },
  fiscal: { title: 'Fiscal', subtitle: 'Operacional', nav: 'mais' },
  caixas: { title: 'Caixas', subtitle: 'MultiCaixa', nav: 'mais' },
  auditoria: { title: 'Auditoria', subtitle: 'Sistema', nav: 'mais' },
  pdv: { title: 'Vender', subtitle: 'PDV Mobile', nav: 'pdv' },
  perfil: { title: 'Perfil', subtitle: 'Conta', nav: 'mais' },
  configuracoes: { title: 'Ajustes', subtitle: 'Preferências', nav: 'mais' },
  equipamentos: { title: 'Equipamentos', subtitle: 'Sistema', nav: 'mais' },
  relatorios: { title: 'Relatórios', subtitle: 'Análises', nav: 'mais' },
  mais: { title: 'Mais', subtitle: 'Módulos', nav: 'mais' }
};

function resolveBottomNav(parsed) {
  const base = parsed.name;
  if (base === 'pdv') {
    const tab = parsed.parts?.[1];
    if (tab === 'caixa') return 'pdv/caixa';
    if (tab === 'vendas' || tab === 'venda') return 'pdv/vendas';
    return 'pdv';
  }
  if (base === 'clientes') return 'clientes';
  return (META[base] && META[base].nav) || 'mais';
}

const state = {
  path: 'dashboard',
  drawerOpen: false,
  /** Sequência de navegação: renders assíncronos obsoletos não sobrescrevem o DOM. */
  navSeq: 0,
  /** Posição de scroll por rota (listas) — restaura ao voltar. */
  scrollByPath: Object.create(null)
};

function isNavStale(seq) {
  return seq !== state.navSeq;
}

function saveScrollPosition(path) {
  try {
    state.scrollByPath[path || state.path] = window.scrollY || 0;
  } catch (e) { /* ignore */ }
}

function restoreScrollPosition(path, fromPop) {
  if (!fromPop) {
    window.scrollTo(0, 0);
    return;
  }
  const y = state.scrollByPath[path];
  if (y == null) {
    window.scrollTo(0, 0);
    return;
  }
  requestAnimationFrame(() => {
    window.scrollTo(0, y);
  });
}

function bindKeyboardInset() {
  const root = document.documentElement;
  const apply = () => {
    try {
      if (!window.visualViewport) {
        root.style.setProperty('--m-keyboard-inset', '0px');
        return;
      }
      const vv = window.visualViewport;
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      root.style.setProperty('--m-keyboard-inset', `${Math.round(inset)}px`);
    } catch (e) {
      root.style.setProperty('--m-keyboard-inset', '0px');
    }
  };
  apply();
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', apply);
    window.visualViewport.addEventListener('scroll', apply);
  }
  window.addEventListener('focusin', (e) => {
    const t = e.target;
    if (!t || !/INPUT|TEXTAREA|SELECT/.test(t.tagName)) return;
    setTimeout(() => {
      try {
        t.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } catch (err) { /* ignore */ }
    }, 80);
  });
}

function parsePath(raw) {
  const clean = String(raw || '')
    .replace(/^#\/?/, '')
    .replace(/^\//, '')
    .trim();
  const parts = clean.split('/').filter(Boolean);
  const name = parts[0] || 'dashboard';
  const id = parts[1] || null;
  return { name, id, parts, path: parts.join('/') || 'dashboard' };
}

function pathFromLocation() {
  if (history.state && history.state.cdsMobile && history.state.path) {
    return parsePath(history.state.path);
  }
  return parsePath(location.hash || 'dashboard');
}

function resolveLoader(parsed) {
  const { name } = parsed;
  if (name === 'mais') return { key: 'mais' };
  return { key: name };
}

function requireAuth() {
  const token = window.CDSApi?.getToken?.() || localStorage.getItem('token');
  if (!token || !String(token).trim()) {
    window.CDSApi?.clearSessionAndRedirectLogin?.() || window.location.replace('/login?client=mobile');
    return false;
  }
  return true;
}

async function verifySession() {
  if (!window.CDSApi || typeof window.CDSApi.post !== 'function') {
    return true;
  }
  const token = window.CDSApi.getToken?.();
  if (!token) return false;
  try {
    /* Timeout curto: nunca pode segurar o splash do app. */
    await window.CDSApi.post('auth/verificar', {}, null, { timeoutMs: 4000 });
    return true;
  } catch (err) {
    if (window.CDSApi.isSessionExpiredError?.(err) || err?.status === 401) {
      return false;
    }
    /* rede instável / timeout: segue com token local */
    return true;
  }
}

function revealShell(user) {
  try {
    const drawerName = document.getElementById('drawer-user-name');
    if (drawerName) {
      drawerName.textContent = (user && (user.nome || user.username)) || 'Usuário';
    }
  } catch (e) { /* ignore */ }

  const boot = document.getElementById('mobile-boot');
  const app = document.getElementById('mobile-app');
  if (boot) {
    boot.hidden = true;
    boot.setAttribute('hidden', '');
    boot.classList.add('is-done');
    boot.style.display = 'none';
  }
  if (app) {
    app.hidden = false;
    app.removeAttribute('hidden');
    app.style.display = '';
  }
}

function setDrawer(open) {
  state.drawerOpen = !!open;
  const drawer = document.getElementById('mobile-drawer');
  const backdrop = document.getElementById('drawer-backdrop');
  if (!drawer || !backdrop) return;
  drawer.classList.toggle('is-open', state.drawerOpen);
  drawer.setAttribute('aria-hidden', state.drawerOpen ? 'false' : 'true');
  backdrop.hidden = !state.drawerOpen;
  if (state.drawerOpen) {
    document.body.classList.add('is-overlay-open');
  } else if (!document.getElementById('cds-mobile-sheet') && !document.querySelector('.cds-scan-overlay')) {
    document.body.classList.remove('is-overlay-open');
  }
}

function applyNavPermissions() {
  const allowed = new Set(listAllowedNavRoutes());
  document.querySelectorAll('#mobile-bottom-nav [data-route]').forEach((btn) => {
    const route = btn.getAttribute('data-route');
    const ok = allowed.has(route);
    btn.hidden = !ok;
    btn.disabled = !ok;
    btn.setAttribute('aria-hidden', ok ? 'false' : 'true');
  });

  document.querySelectorAll('#mobile-drawer [data-route]').forEach((btn) => {
    const route = btn.getAttribute('data-route');
    const ok = canAccessRoute(route);
    btn.hidden = !ok;
    btn.disabled = !ok;
  });
}

function syncChrome(parsed) {
  const base = parsed.name;
  const meta = META[base] || META.dashboard;
  const title = document.getElementById('mobile-page-title');
  const subtitle = document.getElementById('mobile-page-subtitle');
  const deep = parsed.parts && parsed.parts.length > 1;
  if (title) {
    if (parsed.parts?.[1] === 'clientes' && (parsed.parts?.[2] === 'novo' || parsed.parts?.[2] === 'nova')) {
      title.textContent = 'Cliente Consignado';
    } else if (parsed.parts?.[1] === 'clientes' && parsed.parts?.[3] === 'editar') {
      title.textContent = 'Editar comercial';
    } else if (parsed.parts?.[1] === 'clientes' && parsed.parts?.[2]) {
      title.textContent = 'Cliente 360';
    } else if (parsed.parts?.[1] === 'clientes') {
      title.textContent = 'Clientes comerciais';
    } else if (parsed.parts?.[1] === 'prestacao') {
      title.textContent = 'Prestação de Contas';
    } else if (parsed.parts?.[1] === 'novo' || parsed.parts?.[1] === 'nova') {
      title.textContent = 'Novo';
    } else if (parsed.parts?.[2] === 'comprovante') title.textContent = 'Resumo da Entrega';
    else if (parsed.parts?.[2] === 'prestacao' && parsed.parts?.[3] === 'grade') {
      title.textContent = 'Grade de retornos';
    } else if (parsed.parts?.[2] === 'prestacao') title.textContent = 'Prestação';
    else if (parsed.parts?.[2] === 'editar') title.textContent = 'Editar';
    else if (deep) title.textContent = 'Detalhe';
    else title.textContent = meta.title;
  }
  if (subtitle) subtitle.textContent = deep ? meta.title : meta.subtitle;

  document.querySelectorAll('.cds-mobile-nav-item').forEach((btn) => {
    const route = btn.getAttribute('data-route');
    btn.classList.toggle('is-active', route === resolveBottomNav(parsed));
  });
  document.querySelectorAll('#mobile-drawer [data-route]').forEach((btn) => {
    const route = btn.getAttribute('data-route') || '';
    const full = parsed.path || base;
    btn.classList.toggle(
      'is-active',
      route === full || (route === base && !full.includes('/'))
    );
  });
}

async function renderMais(root) {
  const items = [
    { route: 'produtos', label: 'Produtos', ic: 'box', hint: 'Catálogo e consulta' },
    { route: 'cadastros', label: 'Cadastros', ic: 'users', hint: 'Clientes, produtos, usuários' },
    { route: 'comercial', label: 'Comercial', ic: 'store', hint: 'Consignação e prestações' },
    { route: 'financeiro', label: 'Financeiro', ic: 'coins', hint: 'Contas e baixas' },
    { route: 'estoque', label: 'Estoque', ic: 'warehouse', hint: 'Saldos, validade e ajustes' },
    { route: 'compras', label: 'Compras', ic: 'inbox', hint: 'Multi-item, MCC e devolução' },
    { route: 'central-entradas', label: 'Central Entradas', ic: 'inbox', hint: 'XML, sync, MIIP' },
    { route: 'fiscal', label: 'Fiscal', ic: 'receipt', hint: 'NFC-e, config, DANFE' },
    { route: 'relatorios', label: 'Relatórios', ic: 'id', hint: 'Comercial, financeiro, estoque' },
    { route: 'caixas', label: 'Caixas / Terminais', ic: 'coins', hint: 'MultiCaixa e terminais' },
    { route: 'pdv', label: 'PDV', ic: 'cart', hint: 'Caixa, venda e NFC-e' },
    { route: 'equipamentos', label: 'Equipamentos', ic: 'cog', hint: 'Config e diagnóstico' },
    { route: 'auditoria', label: 'Auditoria', ic: 'id', hint: 'Eventos do sistema' },
    { route: 'perfil', label: 'Perfil', ic: 'user', hint: 'Conta e sessão' },
    { route: 'configuracoes', label: 'Configurações', ic: 'cog', hint: 'Empresa, TEF, MIDP, licença' }
  ].filter((i) => canAccessRoute(i.route));

  if (!items.length) {
    root.innerHTML = emptyDenied();
    return;
  }

  root.innerHTML = `
    <section class="cds-m-enter">
      <p class="cds-muted" style="margin-top:0">Módulos disponíveis</p>
      <div class="cds-mais-list">
        ${items.map((i) => `
          <button type="button" class="cds-list-card" data-go="${escapeHtml(i.route)}">
            <span class="cds-mais-list__icon" aria-hidden="true">${icon(i.ic)}</span>
            <div class="cds-list-card__main">
              <h3 class="cds-list-card__title">${escapeHtml(i.label)}</h3>
              <p class="cds-list-card__subtitle">${escapeHtml(i.hint)}</p>
            </div>
            <div class="cds-list-card__side">
              ${icon('chevronRight', 'cds-list-card__chevron')}
            </div>
          </button>
        `).join('')}
      </div>
    </section>
  `;

  root.querySelectorAll('[data-go]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const go = btn.getAttribute('data-go');
      if (go) navigate(go);
    });
  });
}

function emptyDenied() {
  return errorHtml('Nenhum módulo adicional disponível para o seu perfil.', 403);
}

async function renderRoute(parsed, seq) {
  const root = document.getElementById('mobile-content');
  if (!root) return;

  try {
    assertRouteAccess(parsed.name);
  } catch (err) {
    if (isNavStale(seq)) return;
    showToast(err.message, 'error');
    root.innerHTML = errorHtml(err.message, 403);
    const fallback = firstAllowedRoute();
    if (fallback !== parsed.name) {
      setTimeout(() => navigate(fallback, { replace: true }), 400);
    }
    return;
  }

  if (isNavStale(seq)) return;

  const resolved = resolveLoader(parsed);
  syncChrome(parsed);
  root.innerHTML = loadingHtml(`Carregando…`);

  try {
    if (resolved.key === 'mais') {
      if (isNavStale(seq)) return;
      await renderMais(root);
      return;
    }

    const loader = PAGE_LOADERS[resolved.key] || PAGE_LOADERS[parsed.name];
    if (!loader) {
      if (isNavStale(seq)) return;
      root.innerHTML = errorHtml('Módulo não encontrado.', 404);
      return;
    }

    const mod = await loader();
    if (isNavStale(seq)) return;

    const page = mod.default || mod;

    if (typeof page.render === 'function') {
      await page.render(root, parsed);
      return;
    }

    if (parsed.id && typeof page.renderDetail === 'function') {
      await page.renderDetail(root, parsed.id, parsed);
      return;
    }

    if (isNavStale(seq)) return;
    root.innerHTML = errorHtml('Módulo sem renderização.', 404);
  } catch (err) {
    if (isNavStale(seq)) return;
    if (window.CDSApi?.isSessionExpiredError?.(err)) return;
    const status = err && err.status;
    root.innerHTML = errorHtml(err.message || 'Falha ao abrir módulo', status);
    if (status && status !== 401) showToast(err.message || 'Erro ao carregar', 'error');
  }
}

async function navigate(rawPath, options = {}) {
  const { replace = false, fromPop = false } = options;
  const parsed = parsePath(rawPath);
  const seq = ++state.navSeq;

  if (!fromPop && !replace) {
    saveScrollPosition(state.path);
  }

  state.path = parsed.path;
  setDrawer(false);

  if (!fromPop) {
    const url = `#/${parsed.path}`;
    const histState = { cdsMobile: true, path: parsed.path };
    if (replace) history.replaceState(histState, '', url);
    else history.pushState(histState, '', url);
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    if (isNavStale(seq)) return;
    const root = document.getElementById('mobile-content');
    if (root) root.innerHTML = offlineHtml();
    showToast('Sem conexão.', 'warning');
    return;
  }

  await renderRoute(parsed, seq);
  if (!isNavStale(seq)) {
    restoreScrollPosition(parsed.path, fromPop);
  }
}

function logout() {
  try {
    CDSMobileTerminal.stopHeartbeat();
    CDSMobileTerminal.disconnectTerminal().catch(() => {});
  } catch (e) { /* ignore */ }
  try {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    sessionStorage.removeItem('cds-mobile-pdv-cart');
  } catch (e) { /* ignore */ }
  window.location.replace('/login?client=mobile');
}

function bindShell() {
  document.getElementById('btn-open-drawer')?.addEventListener('click', () => setDrawer(true));
  document.getElementById('drawer-backdrop')?.addEventListener('click', () => setDrawer(false));
  document.getElementById('btn-logout')?.addEventListener('click', logout);
  document.getElementById('btn-open-perfil')?.addEventListener('click', () => {
    if (canAccessRoute('perfil')) navigate('perfil');
  });

  document.querySelectorAll('#mobile-bottom-nav [data-route]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const route = btn.getAttribute('data-route');
      if (!canAccessRoute(route)) {
        showToast('Sem permissão para este módulo.', 'warning');
        return;
      }
      navigate(route);
    });
  });

  document.querySelectorAll('#mobile-drawer [data-route]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const route = btn.getAttribute('data-route');
      if (!canAccessRoute(route)) {
        showToast('Sem permissão para este módulo.', 'warning');
        return;
      }
      navigate(route);
    });
  });

  window.addEventListener('popstate', (event) => {
    if (event.state && event.state.cdsMobile && event.state.path) {
      navigate(event.state.path, { fromPop: true });
      return;
    }
    /* Impede sair imediatamente do app no primeiro "voltar". */
    const current = state.path || 'dashboard';
    history.pushState({ cdsMobile: true, path: current }, '', `#/${current}`);
    showToast('Use Sair no menu para encerrar o CDS Mobile.', 'info');
  });

  bindKeyboardInset();
}

function registerPwaStub() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/apps/mobile/sw.js?v=2.5.3-rcm923').catch(() => {});
}

function paintShellIcons() {
  const map = {
    dashboard: 'home',
    cadastros: 'users',
    clientes: 'users',
    fornecedores: 'store',
    produtos: 'box',
    categorias: 'tag',
    usuarios: 'user',
    comercial: 'store',
    financeiro: 'coins',
    mais: 'more',
    estoque: 'warehouse',
    compras: 'inbox',
    'central-entradas': 'inbox',
    fiscal: 'receipt',
    caixas: 'coins',
    auditoria: 'id',
    pdv: 'cart',
    'pdv/caixa': 'coins',
    'pdv/vendas': 'receipt',
    perfil: 'user',
    configuracoes: 'cog',
    equipamentos: 'cog',
    relatorios: 'id'
  };

  document.querySelectorAll('#mobile-bottom-nav [data-route]').forEach((btn) => {
    const route = btn.getAttribute('data-route');
    const i = btn.querySelector('[data-icon]');
    if (i) i.innerHTML = icon(map[route] || 'box');
  });

  document.querySelectorAll('#mobile-drawer [data-route]').forEach((btn) => {
    const route = btn.getAttribute('data-route');
    const i = btn.querySelector('[data-icon]');
    if (i) i.innerHTML = icon(map[route] || 'box');
  });

  const menuBtn = document.querySelector('#btn-open-drawer [data-icon]');
  if (menuBtn) menuBtn.innerHTML = icon('menu');
  const perfilBtn = document.querySelector('#btn-open-perfil [data-icon]');
  if (perfilBtn) perfilBtn.innerHTML = icon('user');
  const logoutBtn = document.querySelector('#btn-logout [data-icon]');
  if (logoutBtn) logoutBtn.innerHTML = icon('logout');
}

async function boot() {
  const user = (() => {
    try { return JSON.parse(localStorage.getItem('user') || '{}'); }
    catch (e) { return {}; }
  })();

  try {
    if (!requireAuth()) return;

    /* Revelar shell antes de await de rede; boot overlay usa display:none. */
    revealShell(user);

    if (window.CDSPlatform?.forcarCliente) {
      try {
        if (!localStorage.getItem(window.CDSPlatform.CLIENT_KEY)) {
          window.CDSPlatform.forcarCliente('mobile');
        }
      } catch (e) { /* ignore */ }
    }

    paintShellIcons();
    applyNavPermissions();
    bindShell();
    registerPwaStub();

    const sessionOk = await verifySession();
    if (sessionOk === false) {
      window.CDSApi?.clearSessionAndRedirectLogin?.() || window.location.replace('/login?client=mobile');
      return;
    }

    if (CDSMobileTerminal.isTerminalRegistered()) {
      CDSMobileTerminal.startHeartbeat();
    }

    const initialParsed = pathFromLocation();
    let initial = initialParsed.path;
    if (!canAccessRoute(initialParsed.name)) {
      initial = firstAllowedRoute();
    }

    history.replaceState({ cdsMobile: true, path: initial }, '', `#/${initial}`);
    await navigate(initial, { replace: true, fromPop: true });
  } catch (err) {
    console.error('[CDS Mobile] falha no boot', err);
    revealShell(user);
    const root = document.getElementById('mobile-content');
    if (root) {
      root.innerHTML = errorHtml(
        (err && err.message) || 'Falha ao iniciar o CDS Mobile.',
        err && err.status
      );
    }
    try {
      showToast((err && err.message) || 'Falha ao iniciar o app.', 'error');
    } catch (e) { /* ignore */ }
  }
}

window.CDSMobile = {
  version: CDS_MOBILE_VERSION,
  versionLabel: CDS_MOBILE_VERSION_LABEL,
  build: CDS_MOBILE_BUILD,
  navigate,
  logout,
  canAccessRoute,
  showToast
};

boot().catch(function (err) {
  console.error('[CDS Mobile] boot fatal', err && err.stack ? err.stack : err);
  document.getElementById('mobile-boot')?.setAttribute('hidden', '');
  document.getElementById('mobile-boot')?.classList.add('is-done');
  if (document.getElementById('mobile-boot')) {
    document.getElementById('mobile-boot').style.display = 'none';
  }
  document.getElementById('mobile-app')?.removeAttribute('hidden');
});
