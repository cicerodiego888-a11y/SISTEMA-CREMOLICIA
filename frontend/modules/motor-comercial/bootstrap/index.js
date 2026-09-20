/**
 * Bootstrap — Inicialização oficial do Motor Comercial no ERP.
 *
 * Sprint O-1: Integração ERP ↔ Motor Comercial.
 * STAB-03: BuildInfo + guarda contra bundle desatualizado.
 *
 * @module frontend/modules/motor-comercial/bootstrap
 */

const { injectMotorComercialStyles } = require('../styles/inject');
const Router = require('../router/Router');
const Loading = require('../components/base/Loading');
const {
  publishBuildInfo,
  assertBuildInfoOrBlock
} = require('../../../shared/build/BuildInfo');

let buildMeta = null;
try {
  buildMeta = require('../build-meta.generated.js');
} catch (_err) {
  buildMeta = null;
}

const {
  themeContext,
  toastContext,
  modalContext,
  loadingContext,
  userContext
} = require('../contexts');

const {
  ApiClient,
  MotorComercialApi,
  ProjectionApi,
  HealthApi
} = require('../api');

const DashboardPage = require('../pages/Dashboard');
const ConsignacoesPage = require('../pages/Consignacoes');
const NovaConsignacaoPage = require('../pages/NovaConsignacao');
const EntregaConsignacaoPage = require('../pages/EntregaConsignacao');
const EntregaComplementarPage = require('../pages/EntregaComplementar');
const ComprovanteEntregaPage = require('../pages/ComprovanteEntrega');
const PrestacaoContasPage = require('../pages/PrestacaoContas');
const PrestacaoLocatorPage = require('../pages/PrestacaoLocator');
const PerfilComercialPage = require('../pages/PerfilComercial');
const ContaCorrentePage = require('../pages/ContaCorrente');
const RelatoriosPage = require('../pages/Relatorios');
const IndicadoresPage = require('../pages/Indicadores');
const PendenciasPage = require('../pages/Pendencias');
const RecomendacoesPage = require('../pages/Recomendacoes');
const PlaybooksPage = require('../pages/Playbooks');
const WorkflowCenterPage = require('../pages/WorkflowCenter');
const DetalhesConsignacaoPage = require('../pages/DetalhesConsignacao');
const HistoricoPrestacaoPage = require('../pages/HistoricoPrestacao');
const ConfiguracoesPage = require('../pages/Configuracoes');
const DesignSystemPage = require('../pages/DesignSystem');
const AuditoriaPage = require('../pages/Auditoria');
const { registerMotorComercialRecovery, listPendingMotorComercial } = require('../recovery');

const ERP_ROUTE_MAP = {
  'comercial-dashboard': { path: '/' },
  'comercial-clientes': { path: '/clientes' },
  'comercial-consignacao-nova': { path: '/consignacoes/nova' },
  'comercial-consignacao-lista': { path: '/consignacoes' },
  'comercial-pendencias': { path: '/pendencias' },
  'comercial-recomendacoes': { path: '/recomendacoes' },
  'comercial-playbooks': { path: '/playbooks' },
  'comercial-workflow': { path: '/workflow' },
  'comercial-acertos': { path: '/consignacoes' },
  'comercial-conta-corrente': { path: '/conta-corrente' },
  'comercial-prestacao': { path: '/prestacao' },
  'comercial-perdas': {
    empty: true,
    title: 'Perdas',
    description: 'O registro de perdas comerciais será disponibilizado em breve.'
  },
  'comercial-cortesias': {
    empty: true,
    title: 'Cortesias',
    description: 'O registro de cortesias comerciais será disponibilizado em breve.'
  },
  'comercial-relatorios': { path: '/relatorios' },
  'comercial-design-system': { path: '/design-system' },
};

const PAGE_COMPONENTS = {
  Dashboard: () => DashboardPage.create(),
  Consignacoes: (params, query) => ConsignacoesPage.create(params, query),
  NovaConsignacao: (params, query) => NovaConsignacaoPage.create(params, query),
  EntregaConsignacao: (params, query) => {
    if (!params || !params.id) {
      throw new Error('Informe o ID da consignação para acessar a entrega.');
    }
    return EntregaConsignacaoPage.create(params.id, query);
  },
  EntregaComplementar: (params, query) => {
    if (!params || !params.id) {
      throw new Error('Informe o ID da consignação para a entrega complementar.');
    }
    return EntregaComplementarPage.create(params.id, query);
  },
  ComprovanteEntrega: (params, query) => {
    if (!params || !params.id) {
      throw new Error('Informe o ID da consignação para acessar o comprovante.');
    }
    return ComprovanteEntregaPage.create(params.id, query);
  },
  PrestacaoLocator: (_params, query) => PrestacaoLocatorPage.create({}, query),
  Prestacao: (params, query) => {
    if (!params || !params.id) {
      throw new Error('Informe o ID da consignação para acessar a prestação.');
    }
    return PrestacaoContasPage.create(params.id, query);
  },
  PerfilCliente: (params) => PerfilComercialPage.create(params),
  DetalhesPerfil: (params) => PerfilComercialPage.create(params),
  Clientes: (params, query) => PerfilComercialPage.create(params, query),
  Perfis: (params, query) => PerfilComercialPage.create(params, query),
  NovoCliente: (params, query) => PerfilComercialPage.create({ cadastro: true }, query),
  EditarCliente: (params, query) => PerfilComercialPage.create({ id: params.id, cadastro: true }, query),
  ContaCorrente: (params, query) => ContaCorrentePage.create(params, query),
  Relatorios: (params, query) => RelatoriosPage.create(params, query),
  Indicadores: (params, query) => IndicadoresPage.create(params, query),
  Pendencias: (params, query) => PendenciasPage.create(params, query),
  Recomendacoes: (params, query) => RecomendacoesPage.create(params, query),
  Playbooks: (params, query) => PlaybooksPage.create(params, query),
  WorkflowCenter: (params, query) => WorkflowCenterPage.create(params, query),
  DetalhesConsignacao: (params, query) => {
    if (!params?.id) throw new Error('Informe o ID da consignação.');
    return DetalhesConsignacaoPage.create(params, query);
  },
  HistoricoPrestacao: (params, query) => {
    if (!params?.id) throw new Error('Informe o ID da consignação.');
    return HistoricoPrestacaoPage.create(params, query);
  },
  Configuracoes: () => ConfiguracoesPage.create(),
  Auditoria: () => AuditoriaPage.create(),
  DesignSystem: () => DesignSystemPage.create()
};

let initialized = false;
let router = null;
let api = null;
let loadingOverlay = null;

function resolveApiBaseURL(options = {}) {
  if (options.apiBaseURL) return options.apiBaseURL;
  if (typeof window !== 'undefined' && typeof window.API_URL === 'string') {
    return `${window.API_URL}/comercial`;
  }
  return 'http://localhost:3000/api/comercial';
}

function resolveAuthToken() {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return null;
  return localStorage.getItem('token');
}

function resolveUserFromStorage() {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem('user');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_error) {
    return null;
  }
}

function ensureLoadingOverlay() {
  if (loadingOverlay || typeof document === 'undefined') return loadingOverlay;

  loadingOverlay = document.createElement('div');
  loadingOverlay.id = 'motor-comercial-loading';
  loadingOverlay.setAttribute('aria-live', 'polite');
  loadingOverlay.setAttribute('aria-busy', 'false');
  document.body.appendChild(loadingOverlay);
  return loadingOverlay;
}

function showGlobalLoading(message) {
  const overlay = ensureLoadingOverlay();
  if (!overlay) return;
  overlay.innerHTML = '';
  overlay.appendChild(Loading.create({ size: 'lg', message, fullScreen: false }));
  overlay.classList.add('is-active');
  overlay.setAttribute('aria-busy', 'true');
  loadingContext.start(message);
}

function hideGlobalLoading() {
  if (!loadingOverlay) return;
  loadingOverlay.classList.remove('is-active');
  loadingOverlay.setAttribute('aria-busy', 'false');
  loadingContext.stop();
}

function initializeApi(options = {}) {
  const baseURL = resolveApiBaseURL(options);
  const token = resolveAuthToken();
  const clientOptions = { baseURL };

  const apiClient = new ApiClient(clientOptions);
  if (token) {
    apiClient.setAuthToken(token);
  }

  api = {
    client: apiClient,
    motor: new MotorComercialApi({ baseURL, defaultHeaders: apiClient.defaultHeaders }),
    projection: new ProjectionApi({ baseURL, defaultHeaders: apiClient.defaultHeaders }),
    health: new HealthApi({ baseURL, defaultHeaders: apiClient.defaultHeaders })
  };

  return api;
}

function initializeContexts() {
  const user = resolveUserFromStorage();
  if (user) {
    userContext.setUser(user);
  }
  return {
    theme: themeContext,
    toast: toastContext,
    modal: modalContext,
    loading: loadingContext,
    user: userContext
  };
}

function initializeRouter(options = {}) {
  router = new Router({
    mountTarget: options.mountTarget || '#page-content',
    components: PAGE_COMPONENTS,
    onLoadingStart: showGlobalLoading,
    onLoadingStop: hideGlobalLoading
  });
  router.erpRouteMap = ERP_ROUTE_MAP;
  return router;
}

/**
 * Bootstrap oficial do Motor Comercial.
 * @param {Object} [options]
 * @returns {Object}
 */
function bootstrap(options = {}) {
  if (initialized) {
    return getPublicApi();
  }

  // STAB-03 — nunca iniciar silenciosamente com bundle antigo
  const runtimeBuild = (typeof window !== 'undefined' && window.CDS_BUILD)
    ? window.CDS_BUILD
    : buildMeta;

  if (runtimeBuild) {
    publishBuildInfo(runtimeBuild);
  }

  assertBuildInfoOrBlock(
    (typeof window !== 'undefined' && window.CDS_BUILD) || runtimeBuild,
    { requiredSprint: 'UX-10', throwOnError: true }
  );

  injectMotorComercialStyles();
  registerMotorComercialRecovery();
  const contexts = initializeContexts();
  const apiClients = initializeApi(options);
  if (typeof window !== 'undefined') {
    window.MOTOR_COMERCIAL_API_BASE = resolveApiBaseURL(options);
  }
  const runtimeRouter = initializeRouter(options);

  initialized = true;

  return {
    ...getPublicApi(),
    contexts,
    api: apiClients,
    router: runtimeRouter
  };
}

function getPublicApi() {
  return {
    bootstrap,
    router,
    api,
    contexts: {
      theme: themeContext,
      toast: toastContext,
      modal: modalContext,
      loading: loadingContext,
      user: userContext
    },
    /** Central de Trabalho — suporte interno (sem UI nesta fase) */
    recovery: {
      listPending: (filter) => {
        registerMotorComercialRecovery();
        if (filter?.module) {
          const { RecoveryManager } = require('../../../shared/recovery');
          return RecoveryManager.listPending(filter);
        }
        return listPendingMotorComercial();
      }
    },
    abrirTela,
    voltar,
    avancar,
    refresh,
    navigate,
    get history() {
      return router ? router.getHistory() : [];
    },
    isInitialized: () => initialized
  };
}

function ensureReady() {
  if (!initialized) {
    bootstrap();
  }
  if (!router) {
    throw new Error('Router do Motor Comercial não inicializado.');
  }
}

function abrirTela(target, options = {}) {
  ensureReady();
  return router.navigate(target, options);
}

function navigate(path, options = {}) {
  return abrirTela(path, options);
}

function voltar() {
  ensureReady();
  return router.back();
}

function avancar() {
  ensureReady();
  return router.forward();
}

function refresh() {
  ensureReady();
  return router.refresh();
}

const publicApi = getPublicApi();

if (typeof window !== 'undefined') {
  window.MotorComercial = publicApi;

  // Banner imediato se o footer do bundle já publicou CDS_BUILD
  if (window.CDS_BUILD) {
    try {
      publishBuildInfo(window.CDS_BUILD);
    } catch (_e) {
      /* ignore */
    }
  }
}

module.exports = publicApi;
