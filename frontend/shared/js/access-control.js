/**
 * Controle de acesso — fonte única de verdade (ERP + PDV).
 * Administrador → ERP (+ PDV via link)
 * Caixa → somente PDV
 */

const PERMISSOES_PAGINAS = {
    pdv: 'pdv',
    caixa: 'caixa',
    caixas: 'caixa',
    'fechamento-caixa': 'caixa',
    produtos: 'produtos',
    clientes: 'clientes',
    compras: 'compras',
    'central-entradas': 'compras',
    fornecedores: 'fornecedores',
    vendas: 'vendas',
    consulta: 'pdv',
    reimpressao: 'vendas',
    financeiro: 'financeiro',
    categorias: 'categorias',
    'canais-venda': 'produtos',
    'tipos-comerciais': 'clientes',
    'tabelas-preco': 'produtos',
    'venda-no-atacado': 'configuracoes',
    'configuracao-comercial': 'configuracoes',
    'diagnostico-comercial': 'produtos',
    fiscal: 'fiscal',
    configuracoes: 'configuracoes',
    equipamentos: 'configuracoes',
    'laboratorio-equipamentos': 'configuracoes',
    licenca: 'configuracoes',
    dashboard: 'relatorios',
    'comercial-dashboard': 'COMERCIAL_DASHBOARD',
    'comercial-clientes': 'COMERCIAL_VISUALIZAR',
    'comercial-consignacao-nova': 'COMERCIAL_CONSIGNACAO',
    'comercial-consignacao-lista': 'COMERCIAL_CONSIGNACAO',
    'comercial-acertos': 'COMERCIAL_ACERTO',
    'comercial-conta-corrente': 'COMERCIAL_VISUALIZAR',
    'comercial-perdas': 'COMERCIAL_PERDAS',
    'comercial-cortesias': 'COMERCIAL_CORTESIAS',
    'comercial-relatorios': 'COMERCIAL_VISUALIZAR',
    usuarios: 'usuarios',
    relatorios: 'relatorios',
    auditoria: 'auditoria',
    'diagnostico-instancia': 'auditoria',
    'configuracoes-avancadas': 'configuracoes',
    estoque: 'produtos'
};

/** Permissões que habilitam acesso à retaguarda (ERP). */
const PERMISSOES_RETAGUARDA = new Set([
    'produtos', 'clientes', 'compras', 'fornecedores', 'vendas',
    'financeiro', 'categorias', 'fiscal', 'configuracoes', 'equipamentos', 'usuarios',
    'relatorios', 'auditoria', 'caixa', 'caixas',
    'COMERCIAL_VISUALIZAR', 'COMERCIAL_CONSIGNACAO', 'COMERCIAL_ACERTO',
    'COMERCIAL_LIMITE', 'COMERCIAL_PERDAS', 'COMERCIAL_CORTESIAS', 'COMERCIAL_DASHBOARD'
]);

/** @deprecated Use PERMISSOES_RETAGUARDA — mantido para compatibilidade. */
const PERMISSOES_MODULO_ERP = PERMISSOES_RETAGUARDA;

const PERMISSOES_MODULO_PDV = new Set(['pdv', 'caixa', 'vendas', 'clientes', 'fiscal']);

function normalizarPermissoes(permissoes) {
    if (typeof permissoes === 'string') {
        return permissoes.split(',').map(p => String(p || '').trim()).filter(Boolean);
    }
    return Array.isArray(permissoes) ? permissoes : [];
}

function obterUsuarioLogado() {
    try {
        return JSON.parse(localStorage.getItem('user') || '{}');
    } catch (e) {
        return {};
    }
}

function obterPermissoesUsuario() {
    const user = obterUsuarioLogado();
    return {
        role: user.role || 'operador',
        perfil: String(user.perfil || 'USUARIO').toUpperCase(),
        permissoes: normalizarPermissoes(user.permissoes)
    };
}

function isSuperAdminUser() {
    return obterPermissoesUsuario().perfil === 'SUPER_ADMIN';
}

/**
 * Gestão de usuários no ERP (módulo Usuários).
 * Comportamento legado: apenas role === 'admin'.
 */
function podeGerenciarUsuariosSistema(user) {
    const u = user || obterUsuarioLogado();
    return (u.role || 'operador') === 'admin';
}

/**
 * Usuário pode acessar o módulo ERP / retaguarda.
 */
function podeAbrirERP(user) {
    const u = user || obterUsuarioLogado();
    const role = u.role || 'operador';
    const perfil = String(u.perfil || 'USUARIO').toUpperCase();

    if (role === 'admin') return true;
    if (['SUPER_ADMIN', 'ADMIN'].includes(perfil)) return true;

    const permissoes = normalizarPermissoes(u.permissoes);
    return permissoes.some(p => PERMISSOES_RETAGUARDA.has(p) && p !== 'pdv');
}

/**
 * Usuário pode acessar o módulo PDV.
 */
function podeAbrirPDV(user) {
    const u = user || obterUsuarioLogado();

    if (podeAbrirERP(u)) return true;
    if (isUsuarioCaixa(u)) return true;

    const { role, permissoes } = obterPermissoesUsuario();
    if (role === 'admin') return true;
    return permissoes.includes('pdv') || permissoes.includes('caixa');
}

/**
 * Verifica permissão específica de retaguarda (chave do backend).
 * Admin, SUPER_ADMIN e ADMIN têm bypass.
 */
function temPermissaoRetaguarda(permissao, user) {
    const u = user || obterUsuarioLogado();
    const role = u.role || 'operador';
    const perfil = String(u.perfil || 'USUARIO').toUpperCase();
    const permissoes = normalizarPermissoes(u.permissoes);

    if (role === 'admin') return true;
    if (['SUPER_ADMIN', 'ADMIN'].includes(perfil)) return true;
    if (!permissao || !PERMISSOES_RETAGUARDA.has(permissao)) return false;
    return permissoes.includes(permissao);
}

function isUsuarioAdministrador(user) {
    return podeAbrirERP(user);
}

function isUsuarioCaixa(user) {
    const u = user || obterUsuarioLogado();
    if (podeAbrirERP(u)) return false;

    const perfil = String(u.perfil || 'USUARIO').toUpperCase();
    if (perfil === 'CAIXA') return true;

    const permissoes = normalizarPermissoes(u.permissoes);
    if (!permissoes.length) return false;

    return permissoes.every(p => PERMISSOES_MODULO_PDV.has(p));
}

function podeAcessarModulo(modulo) {
    if (!localStorage.getItem('token')) return false;

    if (modulo === 'erp') {
        return podeAbrirERP();
    }

    if (modulo === 'pdv') {
        return podeAbrirPDV();
    }

    return false;
}

/** Ajuste manual de estoque — ADMIN ou SUPER_ADMIN (role admin incluso). */
function podeAjustarEstoque(user) {
    const u = user || obterUsuarioLogado();
    const perfil = String(u.perfil || u.nivel || '').trim().toUpperCase();
    return u.role === 'admin' || perfil === 'SUPER_ADMIN' || perfil === 'ADMIN';
}

/** Ações administrativas no financeiro — role admin. */
function podeAdministrarFinanceiro(user) {
    const u = user || obterUsuarioLogado();
    return (u.role || 'operador') === 'admin';
}

/** Autorização de desconto / supervisor no PDV. */
function usuarioEhSupervisor(user) {
    const u = user || obterUsuarioLogado();
    const perfil = String(u.perfil || u.nivel || '').trim().toUpperCase();
    return u.role === 'admin' || ['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR'].includes(perfil);
}

function obterDestinoPosLogin(user) {
    const moduloPreferido = (() => {
        try {
            const params = new URLSearchParams(window.location.search);
            const queryModulo = params.get('modulo');
            if (queryModulo) {
                localStorage.setItem('cds_app_modulo', queryModulo);
                return queryModulo;
            }
        } catch (e) { /* ignore */ }
        return localStorage.getItem('cds_app_modulo') || window.CDS_APP_MODULO || '';
    })();

    if (moduloPreferido === 'pdv' && podeAbrirPDV(user)) return '/pdv';
    if (moduloPreferido === 'erp' && podeAbrirERP(user)) return '/erp';
    if (moduloPreferido === 'mobile') {
        if (podeAbrirERP(user) || podeAbrirPDV(user)) {
            return (window.CDSPlatform && window.CDSPlatform.MOBILE_PATH) || '/apps/mobile/';
        }
    }

    /* CDS Mobile: dispositivo mobile / preferência explícita → shell mobile (não ERP reduzido). */
    const prefereMobile = typeof isClienteMobilePreferido === 'function'
        ? isClienteMobilePreferido()
        : !!(window.CDSPlatform && window.CDSPlatform.isClienteMobilePreferido && window.CDSPlatform.isClienteMobilePreferido());

    if (prefereMobile && (podeAbrirERP(user) || podeAbrirPDV(user))) {
        return (window.CDSPlatform && window.CDSPlatform.MOBILE_PATH) || '/apps/mobile/';
    }

    if (isUsuarioCaixa(user)) return '/pdv';
    if (podeAbrirERP(user)) return '/erp';
    if (podeAbrirPDV(user)) return '/pdv';
    return '/login';
}

function usuarioTemPermissao(page) {
    const { role, permissoes } = obterPermissoesUsuario();

    if (page === 'usuarios') {
        return podeGerenciarUsuariosSistema();
    }

    if (page === 'configuracoes-avancadas' || page === 'configuracao-rede' || page === 'nome-terminal-pdv') {
        return isSuperAdminUser();
    }

    if (role === 'admin') return true;

    const permissaoNecessaria = PERMISSOES_PAGINAS[page];
    if (!permissaoNecessaria) return false;

    return permissoes.includes(permissaoNecessaria);
}

function redirecionarSeModuloNegado(moduloAtual) {
    if (podeAcessarModulo(moduloAtual)) return false;

    if (moduloAtual === 'erp' && podeAbrirPDV()) {
        window.location.replace('/pdv');
        return true;
    }

    if (moduloAtual === 'pdv' && podeAbrirERP()) {
        window.location.replace('/erp');
        return true;
    }

    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.replace('/login');
    return true;
}

window.obterUsuarioLogado = obterUsuarioLogado;
window.PERMISSOES_PAGINAS = PERMISSOES_PAGINAS;
window.PERMISSOES_RETAGUARDA = PERMISSOES_RETAGUARDA;
window.PERMISSOES_MODULO_ERP = PERMISSOES_MODULO_ERP;
window.obterPermissoesUsuario = obterPermissoesUsuario;
window.isSuperAdminUser = isSuperAdminUser;
window.podeGerenciarUsuariosSistema = podeGerenciarUsuariosSistema;
window.podeAbrirERP = podeAbrirERP;
window.podeAbrirPDV = podeAbrirPDV;
window.temPermissaoRetaguarda = temPermissaoRetaguarda;
window.isUsuarioAdministrador = isUsuarioAdministrador;
window.isUsuarioCaixa = isUsuarioCaixa;
window.podeAcessarModulo = podeAcessarModulo;
window.podeAjustarEstoque = podeAjustarEstoque;
window.podeAdministrarFinanceiro = podeAdministrarFinanceiro;
window.usuarioEhSupervisor = usuarioEhSupervisor;
window.obterDestinoPosLogin = obterDestinoPosLogin;
window.usuarioTemPermissao = usuarioTemPermissao;
window.redirecionarSeModuloNegado = redirecionarSeModuloNegado;
