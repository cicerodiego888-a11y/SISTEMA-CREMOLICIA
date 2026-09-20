/**
 * Routes — Official Motor Comercial Routes
 *
 * Sprint 2.7: Arquitetura Frontend — estrutura de rotas.
 *
 * @module frontend/modules/motor-comercial/routes
 */

const routes = [
  // ============================================================================
  // DASHBOARD
  // ============================================================================
  {
    path: '/',
    name: 'dashboard',
    component: 'Dashboard',
    meta: {
      title: 'Central de Trabalho Comercial',
      requiresAuth: true
    }
  },

  // ============================================================================
  // CONSIGNAÇÕES
  // ============================================================================
  {
    path: '/consignacoes',
    name: 'consignacoes',
    component: 'Consignacoes',
    meta: {
      title: 'Consignações',
      requiresAuth: true
    }
  },
  {
    path: '/consignacoes/nova',
    name: 'nova-consignacao',
    component: 'NovaConsignacao',
    meta: {
      title: 'Preparar Entrega',
      requiresAuth: true
    }
  },
  {
    path: '/consignacoes/:id',
    name: 'detalhes-consignacao',
    component: 'DetalhesConsignacao',
    meta: {
      title: 'Detalhes da Consignação',
      requiresAuth: true
    }
  },
  {
    path: '/consignacoes/:id/entrega',
    name: 'entrega-consignacao',
    component: 'EntregaConsignacao',
    meta: {
      title: 'Entrega de Consignação',
      requiresAuth: true
    }
  },
  {
    path: '/consignacoes/:id/entrega-complementar',
    name: 'entrega-complementar',
    component: 'EntregaComplementar',
    meta: {
      title: 'Entrega Complementar',
      requiresAuth: true
    }
  },
  {
    path: '/consignacoes/:id/comprovante',
    name: 'comprovante-entrega',
    component: 'ComprovanteEntrega',
    meta: {
      title: 'Resumo Inteligente da Entrega',
      requiresAuth: true
    }
  },

  // ============================================================================
  // PRESTAÇÃO
  // ============================================================================
  {
    path: '/prestacao',
    name: 'prestacao-locator',
    component: 'PrestacaoLocator',
    meta: {
      title: 'Prestação de Contas',
      requiresAuth: true
    }
  },
  {
    path: '/consignacoes/:id/prestacao',
    name: 'prestacao',
    component: 'Prestacao',
    meta: {
      title: 'Prestação de Contas',
      requiresAuth: true
    }
  },
  {
    path: '/consignacoes/:id/prestacao/conta-corrente',
    name: 'conta-corrente',
    component: 'ContaCorrente',
    meta: {
      title: 'Conta Corrente',
      requiresAuth: true
    }
  },
  {
    path: '/consignacoes/:id/prestacao/historico',
    name: 'historico-prestacao',
    component: 'HistoricoPrestacao',
    meta: {
      title: 'Histórico do Atendimento',
      requiresAuth: true
    }
  },

  // ============================================================================
  // CLIENTES COMERCIAIS
  // ============================================================================
  {
    path: '/clientes/novo',
    name: 'novo-cliente',
    component: 'NovoCliente',
    meta: {
      title: 'Novo Cliente',
      requiresAuth: true
    }
  },
  {
    path: '/clientes/:id/editar',
    name: 'editar-cliente',
    component: 'EditarCliente',
    meta: {
      title: 'Editar Cliente',
      requiresAuth: true
    }
  },
  {
    path: '/clientes',
    name: 'clientes',
    component: 'Clientes',
    meta: {
      title: 'Central de Clientes',
      requiresAuth: true
    }
  },
  {
    path: '/clientes/:id',
    name: 'perfil-cliente',
    component: 'PerfilCliente',
    meta: {
      title: 'Central de Operações do Cliente',
      requiresAuth: true
    }
  },

  {
    path: '/design-system',
    name: 'design-system',
    component: 'DesignSystem',
    meta: {
      title: 'CDS Design System',
      requiresAuth: true
    }
  },

  // ============================================================================
  // INDICADORES
  // ============================================================================
  {
    path: '/indicadores',
    name: 'indicadores',
    component: 'Indicadores',
    meta: {
      title: 'Indicadores',
      requiresAuth: true
    }
  },

  // ============================================================================
  // RELATÓRIOS
  // ============================================================================
  {
    path: '/relatorios',
    name: 'relatorios',
    component: 'Relatorios',
    meta: {
      title: 'Relatórios',
      requiresAuth: true
    }
  },

  // ============================================================================
  // PENDÊNCIAS — Sprint O-8
  // ============================================================================
  {
    path: '/pendencias',
    name: 'pendencias',
    component: 'Pendencias',
    meta: {
      title: 'Central de Pendências',
      requiresAuth: true
    }
  },

  {
    path: '/recomendacoes',
    name: 'recomendacoes',
    component: 'Recomendacoes',
    meta: { title: 'Recomendações Comerciais', requiresAuth: true }
  },

  {
    path: '/playbooks',
    name: 'playbooks',
    component: 'Playbooks',
    meta: { title: 'Guias Operacionais', requiresAuth: true }
  },

  {
    path: '/workflow',
    name: 'workflow',
    component: 'WorkflowCenter',
    meta: { title: 'Central de Processos', requiresAuth: true }
  },

  // ============================================================================
  // PERFIL COMERCIAL
  // ============================================================================
  {
    path: '/perfis',
    name: 'perfis',
    component: 'Perfis',
    meta: {
      title: 'Perfis Comerciais',
      requiresAuth: true
    }
  },
  {
    path: '/perfis/:id',
    name: 'detalhes-perfil',
    component: 'DetalhesPerfil',
    meta: {
      title: 'Detalhes do Perfil',
      requiresAuth: true
    }
  },

  {
    path: '/conta-corrente',
    name: 'conta-corrente-geral',
    component: 'ContaCorrente',
    meta: {
      title: 'Conta Corrente Comercial',
      requiresAuth: true
    }
  },

  // ============================================================================
  // CONFIGURAÇÕES
  // ============================================================================
  {
    path: '/configuracoes',
    name: 'configuracoes',
    component: 'Configuracoes',
    meta: {
      title: 'Configurações',
      requiresAuth: true,
      requiresAdmin: true
    }
  },

  // ============================================================================
  // AUDITORIA
  // ============================================================================
  {
    path: '/auditoria',
    name: 'auditoria',
    component: 'Auditoria',
    meta: {
      title: 'Auditoria',
      requiresAuth: true,
      requiresAdmin: true
    }
  }
];

/**
 * Gets route by name.
 * @param {string} name - Route name
 * @returns {Object|null}
 */
function getRouteByName(name) {
  return routes.find(route => route.name === name) || null;
}

/**
 * Gets route by path.
 * @param {string} path - Route path
 * @returns {Object|null}
 */
function getRouteByPath(path) {
  return routes.find(route => {
    const routePattern = route.path.replace(/:([^/]+)/g, '[^/]+');
    const regex = new RegExp(`^${routePattern}$`);
    return regex.test(path);
  }) || null;
}

/**
 * Gets all routes.
 * @returns {Array}
 */
function getAllRoutes() {
  return [...routes];
}

/**
 * Gets navigation routes (routes that appear in navigation).
 * @returns {Array}
 */
function getNavigationRoutes() {
  return routes.filter(route => !route.path.includes(':'));
}

module.exports = {
  routes,
  getRouteByName,
  getRouteByPath,
  getAllRoutes,
  getNavigationRoutes
};
