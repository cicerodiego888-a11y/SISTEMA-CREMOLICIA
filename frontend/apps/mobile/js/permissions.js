/**
 * CDS Mobile RC2.2 — Permissões (espelha access-control.js do ERP)
 */

const ROUTE_PAGE_KEY = {
  dashboard: 'dashboard',
  cadastros: null,
  clientes: 'clientes',
  fornecedores: 'fornecedores',
  produtos: 'produtos',
  categorias: 'categorias',
  usuarios: 'usuarios',
  estoque: 'estoque',
  compras: 'compras',
  'central-entradas': 'fiscal',
  comercial: 'comercial-consignacao-lista',
  financeiro: 'financeiro',
  fiscal: 'fiscal',
  caixas: 'caixa',
  auditoria: 'auditoria',
  pdv: 'pdv',
  perfil: null,
  configuracoes: null,
  equipamentos: null,
  relatorios: null,
  mais: null
};

const ACTION_KEYS = {
  abrir_caixa: 'abrir_caixa',
  sangria_caixa: 'sangria_caixa',
  suprimento_caixa: 'suprimento_caixa',
  fechar_caixa: 'caixa',
  pdv_venda: 'pdv',
  emitir_nfce: 'fiscal',
  cancelar_nfce: 'fiscal',
  ajuste_estoque: 'ajuste_estoque',
  financeiro_baixar: 'financeiro',
  financeiro_admin: 'financeiro'
};

function readUser() {
  try {
    return JSON.parse(localStorage.getItem('user') || '{}') || {};
  } catch (e) {
    return {};
  }
}

function normalizePerms(raw) {
  if (typeof raw === 'string') {
    return raw.split(',').map((p) => String(p || '').trim()).filter(Boolean);
  }
  return Array.isArray(raw) ? raw : [];
}

export function isAdmin() {
  const user = readUser();
  return (user.role || '') === 'admin' || String(user.perfil || '').toUpperCase() === 'SUPER_ADMIN';
}

function hasAnyComercial() {
  if (typeof window.usuarioTemPermissao !== 'function') return isAdmin();
  return (
    window.usuarioTemPermissao('comercial-dashboard') ||
    window.usuarioTemPermissao('comercial-clientes') ||
    window.usuarioTemPermissao('comercial-consignacao-lista') ||
    window.usuarioTemPermissao('comercial-consignacao-nova') ||
    window.usuarioTemPermissao('comercial-acertos') ||
    window.usuarioTemPermissao('comercial-conta-corrente') ||
    window.usuarioTemPermissao('comercial-relatorios')
  );
}

function hasCadastrosAccess() {
  return (
    canAccessRoute('clientes') ||
    canAccessRoute('fornecedores') ||
    canAccessRoute('produtos') ||
    canAccessRoute('categorias') ||
    canAccessRoute('usuarios')
  );
}

export function canAccessRoute(routeName) {
  const base = String(routeName || '').split('/')[0];

  if (!base) return false;
  if (base === 'perfil' || base === 'mais' || base === 'configuracoes') return true;
  if (base === 'cadastros') return hasCadastrosAccess();

  if (isAdmin()) return true;

  if (base === 'comercial') return hasAnyComercial();

  const pageKey = ROUTE_PAGE_KEY[base];
  if (pageKey === null) return true;
  if (!pageKey) return false;

  if (typeof window.usuarioTemPermissao !== 'function') {
    return false;
  }

  if (base === 'estoque') {
    return window.usuarioTemPermissao('produtos') || window.usuarioTemPermissao('estoque');
  }

  if (base === 'caixas') {
    return window.usuarioTemPermissao('caixa') || window.usuarioTemPermissao('caixas');
  }

  return window.usuarioTemPermissao(pageKey);
}

export function canDoAction(action) {
  if (isAdmin()) return true;
  const user = readUser();
  const perfil = String(user.perfil || '').toUpperCase();
  if (['SUPER_ADMIN', 'ADMIN'].includes(perfil)) return true;

  const key = ACTION_KEYS[action] || action;
  const perms = normalizePerms(user.permissoes);

  if (action === 'ajuste_estoque') {
    if (typeof window.podeAjustarEstoque === 'function') {
      return window.podeAjustarEstoque(user);
    }
    return ['SUPER_ADMIN', 'ADMIN'].includes(perfil) || (user.role || '') === 'admin';
  }

  if (action === 'abrir_caixa' || action === 'sangria_caixa' || action === 'suprimento_caixa') {
    return perms.includes(key) || perms.includes('caixa') || perms.includes('pdv');
  }

  if (action === 'fechar_caixa') {
    return perms.includes('caixa') || perms.includes('pdv') || canAccessRoute('pdv');
  }

  if (action === 'emitir_nfce' || action === 'cancelar_nfce') {
    return canAccessRoute('fiscal') || perms.includes('fiscal') || canAccessRoute('pdv');
  }

  if (action === 'financeiro_baixar' || action === 'financeiro_admin') {
    return canAccessRoute('financeiro');
  }

  if (typeof window.usuarioTemPermissao === 'function' && ROUTE_PAGE_KEY[key]) {
    return window.usuarioTemPermissao(ROUTE_PAGE_KEY[key]);
  }

  return perms.includes(key) || canAccessRoute(key);
}

export function listAllowedNavRoutes() {
  return ['dashboard', 'pdv', 'pdv/caixa', 'pdv/vendas', 'clientes', 'mais'].filter(canAccessRoute);
}

export function firstAllowedRoute() {
  const order = [
    'dashboard',
    'cadastros',
    'clientes',
    'produtos',
    'estoque',
    'compras',
    'comercial',
    'financeiro',
    'fiscal',
    'pdv',
    'mais',
    'perfil'
  ];
  return order.find(canAccessRoute) || 'perfil';
}

export function assertRouteAccess(routeName) {
  if (canAccessRoute(routeName)) return true;
  const err = new Error('Você não tem permissão para acessar este módulo.');
  err.code = 'FORBIDDEN';
  err.status = 403;
  throw err;
}

export function canCreateComercial() {
  if (isAdmin()) return true;
  if (typeof window.usuarioTemPermissao !== 'function') return false;
  return window.usuarioTemPermissao('comercial-consignacao-nova');
}

/** Paridade motor-comercial/utils/autorizacao.js — isOperadorAutorizado */
export function isOperadorComercial() {
  if (isAdmin()) return true;
  const user = readUser();
  const perfil = String(user.perfil || '').toUpperCase();
  if (['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR'].includes(perfil)) return true;
  if (user.role === 'admin' || user.role === 'supervisor') return true;
  const perms = normalizePerms(user.permissoes);
  return perms.includes('COMERCIAL_CONSIGNACAO') || perms.includes('COMERCIAL_ACERTO');
}

export function canComercialAcerto() {
  if (isAdmin()) return true;
  const perms = normalizePerms(readUser().permissoes);
  return perms.includes('COMERCIAL_ACERTO') || perms.includes('COMERCIAL_CONSIGNACAO');
}

export function canComercialContaCorrente() {
  if (isAdmin()) return true;
  if (typeof window.usuarioTemPermissao === 'function') {
    return window.usuarioTemPermissao('comercial-conta-corrente')
      || window.usuarioTemPermissao('comercial-clientes')
      || isOperadorComercial();
  }
  return isOperadorComercial();
}

export default {
  canAccessRoute,
  canDoAction,
  listAllowedNavRoutes,
  firstAllowedRoute,
  assertRouteAccess,
  canCreateComercial,
  isOperadorComercial,
  canComercialAcerto,
  canComercialContaCorrente,
  isAdmin
};
