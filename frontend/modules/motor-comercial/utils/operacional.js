/**
 * Utilitários operacionais — navegação, diálogos e feedback do fluxo.
 *
 * Sprint O-2: Fluxo Operacional da Consignação.
 *
 * @module frontend/modules/motor-comercial/utils/operacional
 */

const Modal = require('../components/navigation/Modal');
const Button = require('../components/base/Button');
const Input = require('../components/form/Input');
const toastContext = require('../contexts/ToastContext');
const loadingContext = require('../contexts/LoadingContext');
const { getUsuarioId, mapConsignacaoView } = require('../api/helpers');
const { isOperadorAutorizado, possuiPermissao, isAutorizacaoGerencial } = require('./autorizacao');
const { extrairValorInput } = require('./formField');

function getApiUrl() {
  if (typeof window !== 'undefined' && typeof window.API_URL === 'string') {
    return window.API_URL;
  }
  return `${window.location.origin}/api`;
}

function notify(message, variant = 'info') {
  if (typeof window !== 'undefined' && typeof window.showNotification === 'function') {
    const tipo = variant === 'error' ? 'danger' : variant;
    window.showNotification(message, tipo);
    return;
  }
  if (variant === 'success') toastContext.success(message);
  else if (variant === 'error') toastContext.error(message);
  else if (variant === 'warning') toastContext.warning(message);
  else toastContext.info(message);
}

function navigate(path, options = {}) {
  if (typeof window !== 'undefined' && window.MotorComercial) {
    return window.MotorComercial.navigate(path, options);
  }
  if (typeof navigateComercial === 'function') {
    return navigateComercial(path, options);
  }
  return Promise.resolve(null);
}

function openModal(backdrop) {
  requestAnimationFrame(() => {
    backdrop.classList.add('cds-modal-backdrop--open', 'is-open');
  });
  document.body.appendChild(backdrop);
}

function closeModal(backdrop) {
  backdrop.classList.remove('cds-modal-backdrop--open', 'is-open');
  setTimeout(() => backdrop.remove(), 250);
}

function confirmDialog(options = {}) {
  return new Promise((resolve) => {
    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.gap = '8px';
    footer.style.justifyContent = 'flex-end';

    const cancelBtn = Button.create({
      text: options.cancelLabel || 'Cancelar',
      variant: 'secondary',
      onClick: () => {
        closeModal(backdrop);
        resolve(false);
      }
    });

    const confirmBtn = Button.create({
      text: options.confirmLabel || 'Confirmar',
      variant: options.danger ? 'danger' : 'primary',
      onClick: () => {
        closeModal(backdrop);
        resolve(true);
      }
    });

    footer.appendChild(cancelBtn);
    footer.appendChild(confirmBtn);

    const content = document.createElement('div');
    content.style.whiteSpace = 'pre-wrap';
    content.textContent = options.message || 'Deseja continuar?';

    const backdrop = Modal.create({
      title: options.title || 'Confirmação',
      content,
      footer,
      open: false,
      onClose: () => {
        closeModal(backdrop);
        resolve(false);
      }
    });

    openModal(backdrop);
  });
}

function promptDialog(options = {}) {
  return new Promise((resolve) => {
    const body = document.createElement('div');
    const label = document.createElement('p');
    label.textContent = options.message || 'Informe o valor:';
    body.appendChild(label);

    const field = Input.create({
      type: options.inputType || 'text',
      placeholder: options.placeholder || '',
      value: options.defaultValue || ''
    });
    body.appendChild(field);

    const inputEl = field.querySelector('input, textarea, select') || field;

    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.gap = '8px';
    footer.style.justifyContent = 'flex-end';

    const finish = (value) => {
      closeModal(backdrop);
      resolve(value);
    };

    footer.appendChild(Button.create({
      text: 'Cancelar',
      variant: 'secondary',
      onClick: () => finish(null)
    }));

    footer.appendChild(Button.create({
      text: options.confirmLabel || 'Confirmar',
      variant: 'primary',
      onClick: () => finish(inputEl.value)
    }));

    const backdrop = Modal.create({
      title: options.title || 'Informação',
      content: body,
      footer,
      open: false,
      onClose: () => finish(null)
    });

    openModal(backdrop);
    if (inputEl.focus) inputEl.focus();
  });
}

function choiceDialog(options = {}) {
  return new Promise((resolve) => {
    const body = document.createElement('p');
    body.textContent = options.message || 'Escolha uma opção:';

    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.flexWrap = 'wrap';
    footer.style.gap = '8px';
    footer.style.justifyContent = 'flex-end';

    (options.choices || []).forEach((choice) => {
      footer.appendChild(Button.create({
        text: choice.label,
        variant: choice.variant || 'secondary',
        onClick: () => {
          closeModal(backdrop);
          resolve(choice.value);
        }
      }));
    });

    const backdrop = Modal.create({
      title: options.title || 'Escolha',
      content: body,
      footer,
      open: false,
      onClose: () => {
        closeModal(backdrop);
        resolve(null);
      }
    });

    openModal(backdrop);
  });
}

async function fetchErp(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${getApiUrl()}${path}`, {
  ...options,
    headers
  });

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      message = body.message || body.error || message;
    } catch (_error) {
      // mantém mensagem HTTP
    }
    throw new Error(message);
  }

  return response.json();
}

async function buscarClientePorIdErp(clienteId) {
  const id = Number(clienteId);
  if (!Number.isFinite(id) || id <= 0) return null;
  try {
    const cliente = await fetchErp(`/clientes/${id}`);
    return cliente && cliente.id != null ? cliente : null;
  } catch (_error) {
    return null;
  }
}

function filtrarClientesLocal(lista, termo) {
  const q = String(termo).trim().toLowerCase();
  const qDigits = q.replace(/\D/g, '');

  return lista.filter((c) => {
    const nome = String(c.nome || '').toLowerCase();
    const doc = String(c.cpf_cnpj || c.documento || '');
    const docLower = doc.toLowerCase();
    const docDigits = doc.replace(/\D/g, '');
    const telDigits = String(c.telefone || '').replace(/\D/g, '');
    const idStr = String(c.id);

    const idMatch = idStr === q || idStr.includes(q);
    const nomeMatch = nome.includes(q);
    const docMatch = docLower.includes(q) || (qDigits && docDigits.includes(qDigits));
    const telMatch = qDigits.length >= 3 && telDigits.includes(qDigits);

    return idMatch || nomeMatch || docMatch || telMatch;
  }).slice(0, 20);
}

async function buscarClientesErp(termo = '') {
  const q = String(termo).trim();
  if (!q) {
    const clientes = await fetchErp('/clientes');
    const lista = Array.isArray(clientes) ? clientes : [];
    return lista.slice(0, 20);
  }

  if (/^\d+$/.test(q)) {
    const porId = await buscarClientePorIdErp(q);
    if (porId) return [porId];
  }

  try {
    const resultados = await fetchErp(`/clientes/buscar?termo=${encodeURIComponent(q)}`);
    if (Array.isArray(resultados) && resultados.length) {
      const enriquecidos = await Promise.all(
        resultados.map(async (parcial) => {
          if (parcial.telefone != null && parcial.cpf_cnpj != null) return parcial;
          const completo = await buscarClientePorIdErp(parcial.id);
          return completo || parcial;
        })
      );
      return enriquecidos.slice(0, 20);
    }
  } catch (_error) {
    // fallback para filtro local
  }

  const clientes = await fetchErp('/clientes');
  const lista = Array.isArray(clientes) ? clientes : [];
  return filtrarClientesLocal(lista, q);
}

function normalizarProdutoBusca(produto = {}) {
  return {
    ...produto,
    nome: produto.nome || produto.descricao || `Produto #${produto.id}`,
    preco_venda: Number(produto.preco_venda ?? produto.preco ?? 0)
  };
}

function filtrarProdutosLocal(lista, termo) {
  const q = String(termo).trim().toLowerCase();
  const qDigits = q.replace(/\D/g, '');

  return lista.filter((p) => {
    const nome = String(p.nome || p.descricao || '').toLowerCase();
    const codigo = String(p.codigo || '').toLowerCase();
    const barras = String(p.codigo_barras || '').toLowerCase();
    const idStr = String(p.id);

    const idMatch = idStr === q || idStr.includes(q);
    const nomeMatch = nome.includes(q);
    const codigoMatch = codigo.includes(q) || barras.includes(q);
    const barrasMatch = qDigits.length >= 3 && barras.replace(/\D/g, '').includes(qDigits);

    return idMatch || nomeMatch || codigoMatch || barrasMatch;
  }).map(normalizarProdutoBusca).slice(0, 20);
}

async function buscarProdutoPorIdErp(produtoId) {
  const id = Number(produtoId);
  if (!Number.isFinite(id) || id <= 0) return null;
  try {
    const produto = await fetchErp(`/produtos/${id}`);
    return produto && produto.id != null ? produto : null;
  } catch (_error) {
    return null;
  }
}

async function buscarProdutosErp(termo = '') {
  const q = String(termo).trim();
  if (!q) return [];

  if (/^\d+$/.test(q)) {
    const porId = await buscarProdutoPorIdErp(q);
    if (porId) return [normalizarProdutoBusca(porId)];
  }

  try {
    const resultados = await fetchErp(
      `/produtos/consulta-pdv/buscar?q=${encodeURIComponent(q)}&limite=20`
    );
    if (Array.isArray(resultados) && resultados.length) {
      return resultados.map(normalizarProdutoBusca).slice(0, 20);
    }
  } catch (_error) {
    // fallback para listagem local
  }

  const produtos = await fetchErp('/produtos');
  const lista = Array.isArray(produtos) ? produtos : [];
  return filtrarProdutosLocal(lista, q);
}

function cacheItensConsignacao(consignacaoId, itens) {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.setItem(`motor-comercial:itens:${consignacaoId}`, JSON.stringify(itens));
}

function obterItensCacheConsignacao(consignacaoId) {
  if (typeof sessionStorage === 'undefined') return [];
  try {
    const raw = sessionStorage.getItem(`motor-comercial:itens:${consignacaoId}`);
    return raw ? JSON.parse(raw) : [];
  } catch (_error) {
    return [];
  }
}

/**
 * Itens do Recovery Framework (localStorage durável) — não depende de sessionStorage.
 */
function obterItensRecoveryConsignacao(consignacaoId) {
  try {
    const { obterItensRecovery } = require('../recovery');
    return obterItensRecovery(consignacaoId);
  } catch (_error) {
    return [];
  }
}

async function carregarConsignacaoCompleta(api, projectionApi, consignacaoId) {
  const consignacao = await api.obterConsignacao(consignacaoId);
  let perfil = null;
  let situacao = null;
  let resumo = null;

  // Ordem oficial RFC-03: API → Provider → Checkpoint → Cache auxiliar
  let itens = Array.isArray(consignacao.itens) && consignacao.itens.length
    ? consignacao.itens.slice()
    : [];

  // API oficial de itens (quando o GET cabeçalho ainda vier sem itens)
  if (!itens.length && typeof api.listarItensConsignacao === 'function') {
    try {
      const apiItens = await api.listarItensConsignacao(consignacaoId);
      if (Array.isArray(apiItens) && apiItens.length) itens = apiItens;
    } catch (_error) {
      /* segue fallback */
    }
  }

  try {
    if (consignacao.perfilComercialId) {
      perfil = await api.obterPerfil(consignacao.perfilComercialId);
    }
  } catch (_error) {
    perfil = null;
  }

  try {
    if (consignacao.clienteId) {
      situacao = await projectionApi.obterSituacaoCliente({ clienteId: consignacao.clienteId });
    }
  } catch (_error) {
    situacao = null;
  }

  // Provider (projeção)
  try {
    resumo = await projectionApi.obterResumoPrestacao({ consignacaoId });
    if (resumo?.itens?.length && !itens.length) itens = resumo.itens;
  } catch (_error) {
    resumo = null;
  }

  // Checkpoint Recovery
  if (!itens.length) {
    const recoveryItens = obterItensRecoveryConsignacao(consignacaoId);
    if (recoveryItens.length) itens = recoveryItens;
  }

  // Cache auxiliar (sessionStorage) — último recurso
  if (!itens.length) {
    itens = obterItensCacheConsignacao(consignacaoId);
  }

  return mapConsignacaoView(consignacao, {
    itens,
    clienteNome: situacao?.clienteNome,
    perfilNome: perfil?.perfilTipo,
    perfilStatus: perfil?.ativo && !perfil?.bloqueado ? 'ATIVO' : 'INATIVO',
    limite: situacao?.limiteDisponivel ?? perfil?.limiteComercial,
    saldo: resumo?.saldoAtual ?? situacao?.saldoEmAberto
  });
}

function withLoading(message, fn) {
  loadingContext.start(message);
  return Promise.resolve()
    .then(fn)
    .finally(() => loadingContext.stop());
}

module.exports = {
  notify,
  navigate,
  confirmDialog,
  promptDialog,
  choiceDialog,
  fetchErp,
  extrairValorInput,
  buscarClientePorIdErp,
  buscarClientesErp,
  buscarProdutoPorIdErp,
  buscarProdutosErp,
  normalizarProdutoBusca,
  cacheItensConsignacao,
  obterItensCacheConsignacao,
  carregarConsignacaoCompleta,
  withLoading,
  isOperadorAutorizado,
  possuiPermissao,
  isAutorizacaoGerencial,
  getUsuarioId
};
