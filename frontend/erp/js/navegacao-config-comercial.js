/**
 * Catálogo de navegação — Configurações → Comercial (RCM-04.8)
 *
 * Rotas (data-page) NÃO mudam. Apenas caminho visual / pesquisa / favoritos.
 */

window.ERP_NAV_CATALOG = window.ERP_NAV_CATALOG || {};

Object.assign(window.ERP_NAV_CATALOG, {
  'venda-no-atacado': {
    page: 'venda-no-atacado',
    titulo: 'Configuração Comercial',
    aliases: ['configuracao-comercial', 'venda-no-atacado', 'venda no atacado'],
    caminho: ['Configurações', 'Comercial', 'Configuração Comercial'],
    grupo: 'configuracoes-comercial'
  },
  'configuracao-comercial': {
    page: 'venda-no-atacado',
    titulo: 'Configuração Comercial',
    aliases: ['configuracao-comercial', 'venda-no-atacado'],
    caminho: ['Configurações', 'Comercial', 'Configuração Comercial'],
    grupo: 'configuracoes-comercial',
    redirectTo: 'venda-no-atacado'
  },
  'canais-venda': {
    page: 'canais-venda',
    titulo: 'Canais de Venda',
    aliases: ['canais-venda', 'canais de venda', 'canal de venda'],
    caminho: ['Configurações', 'Comercial', 'Canais de Venda'],
    grupo: 'configuracoes-comercial'
  },
  'tipos-comerciais': {
    page: 'tipos-comerciais',
    titulo: 'Tipos Comerciais',
    aliases: [
      'tipos-comerciais',
      'tipo comercial',
      'tipos comerciais',
      'tipo de cliente',
      'tipos de cliente'
    ],
    caminho: ['Configurações', 'Comercial', 'Tipos Comerciais'],
    grupo: 'configuracoes-comercial'
  },
  'tabelas-preco': {
    page: 'tabelas-preco',
    titulo: 'Central de Precificação',
    aliases: [
      'tabelas-preco',
      'tabela de preço',
      'tabelas de preço',
      'tabela de preco',
      'tabelas de precos',
      'lista de precos',
      'listas de precos',
      'lista de preços',
      'listas de preços',
      'central de precificação',
      'central de precificacao'
    ],
    caminho: ['Configurações', 'Comercial', 'Central de Precificação'],
    grupo: 'configuracoes-comercial'
  },
  'linhas-comerciais': {
    page: 'linhas-comerciais',
    titulo: 'Linhas de Precificação',
    aliases: [
      'linhas-comerciais',
      'linha comercial',
      'linhas comerciais',
      'linha de precificacao',
      'linhas de precificacao',
      'linha de precificação',
      'linhas de precificação',
      'politicas comerciais',
      'políticas comerciais',
      'politica comercial',
      'política comercial'
    ],
    caminho: ['Configurações', 'Comercial', 'Linhas de Precificação'],
    grupo: 'configuracoes-comercial'
  },
  'casquinha-sabores': {
    page: 'casquinha-sabores',
    titulo: 'Sabores de Casquinha',
    aliases: ['casquinha-sabores', 'sabores', 'sabores casquinha'],
    caminho: ['Configurações', 'Comercial', 'Sabores'],
    grupo: 'configuracoes-comercial'
  },
  'kits-combos': {
    page: 'kits-combos',
    titulo: 'Kits e Combos',
    aliases: ['kits-combos', 'kits', 'combos', 'kit', 'combo'],
    caminho: ['Configurações', 'Comercial', 'Kits e Combos'],
    grupo: 'configuracoes-comercial'
  },
  'diagnostico-comercial': {
    page: 'diagnostico-comercial',
    titulo: 'Diagnóstico Comercial',
    aliases: ['diagnostico-comercial', 'diagnóstico comercial'],
    caminho: ['Configurações', 'Comercial', 'Diagnóstico Comercial'],
    grupo: 'configuracoes-comercial'
  }
});

/**
 * Resolve página favorita/pesquisa legada → página canônica (sem mudar rota de API).
 */
function resolverPaginaErpNav(pageOrAlias) {
  const key = String(pageOrAlias || '').trim().toLowerCase();
  if (!key) return pageOrAlias;

  const catalog = window.ERP_NAV_CATALOG || {};
  if (catalog[key]) {
    return catalog[key].redirectTo || catalog[key].page || key;
  }

  for (const meta of Object.values(catalog)) {
    const aliases = meta.aliases || [];
    if (aliases.some((a) => String(a).toLowerCase() === key)) {
      return meta.redirectTo || meta.page;
    }
  }

  return pageOrAlias;
}

/**
 * Pesquisa no catálogo de Configurações → Comercial (e extensível).
 * @param {string} termo
 * @returns {Array<{page:string,titulo:string,caminho:string[]}>}
 */
function pesquisarNavErp(termo) {
  const q = String(termo || '').trim().toLowerCase();
  if (!q) return [];
  const catalog = window.ERP_NAV_CATALOG || {};
  const seen = new Set();
  const out = [];

  Object.values(catalog).forEach((meta) => {
    const page = meta.redirectTo || meta.page;
    if (seen.has(page)) return;
    const hay = [meta.titulo, ...(meta.aliases || []), ...(meta.caminho || [])]
      .join(' ')
      .toLowerCase();
    if (hay.includes(q)) {
      seen.add(page);
      out.push({
        page,
        titulo: meta.titulo,
        caminho: meta.caminho || []
      });
    }
  });

  return out;
}

/**
 * Expande submenu Configurações → Comercial ao abrir páginas do grupo.
 */
function destacarNavConfigComercial(page) {
  const meta = (window.ERP_NAV_CATALOG || {})[page];
  if (!meta || meta.grupo !== 'configuracoes-comercial') return;

  const cfg = document.getElementById('submenu-configuracoes');
  const com = document.getElementById('submenu-config-comercial');
  if (cfg && window.bootstrap) {
    bootstrap.Collapse.getOrCreateInstance(cfg, { toggle: false }).show();
  } else if (cfg) {
    cfg.classList.add('show');
  }
  if (com && window.bootstrap) {
    bootstrap.Collapse.getOrCreateInstance(com, { toggle: false }).show();
  } else if (com) {
    com.classList.add('show');
  }
}

window.resolverPaginaErpNav = resolverPaginaErpNav;
window.pesquisarNavErp = pesquisarNavErp;
window.destacarNavConfigComercial = destacarNavConfigComercial;

/**
 * Pesquisa global do menu (sidebar) — RCM-04.8
 * Resultados de Configurações → Comercial usam o caminho atualizado.
 */
function inicializarPesquisaNavErp() {
  const input = document.getElementById('erp-nav-search');
  const box = document.getElementById('erp-nav-search-results');
  if (!input || !box) return;

  function limpar() {
    box.innerHTML = '';
    box.classList.add('d-none');
  }

  function render(termo) {
    const q = String(termo || '').trim().toLowerCase();
    if (q.length < 2) {
      limpar();
      return;
    }

    const catalogHits = typeof pesquisarNavErp === 'function' ? pesquisarNavErp(q) : [];
    const linkHits = [];
    document.querySelectorAll('#sidebar-nav a.nav-link[data-page]').forEach((a) => {
      const page = a.getAttribute('data-page');
      const label = (a.getAttribute('title') || a.textContent || '').trim();
      if (!page || !label) return;
      if (label.toLowerCase().includes(q) || page.toLowerCase().includes(q)) {
        if (!catalogHits.some((h) => h.page === page) && !linkHits.some((h) => h.page === page)) {
          linkHits.push({ page, titulo: label, caminho: [] });
        }
      }
    });

    const hits = [...catalogHits, ...linkHits].slice(0, 12);
    if (!hits.length) {
      box.innerHTML = '<div class="list-group-item list-group-item-dark small text-muted">Nenhum resultado</div>';
      box.classList.remove('d-none');
      return;
    }

    box.innerHTML = hits.map((h) => {
      const path = (h.caminho && h.caminho.length)
        ? h.caminho.join(' › ')
        : h.titulo;
      return `<button type="button" class="list-group-item list-group-item-action list-group-item-dark py-2 px-2" data-goto="${h.page}">
        <div class="small fw-semibold">${h.titulo}</div>
        <div class="text-muted" style="font-size:11px;">${path}</div>
      </button>`;
    }).join('');
    box.classList.remove('d-none');
  }

  input.addEventListener('input', () => render(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      input.value = '';
      limpar();
    }
  });
  box.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-goto]');
    if (!btn) return;
    const page = btn.getAttribute('data-goto');
    if (typeof loadPage === 'function') loadPage(page);
    input.value = '';
    limpar();
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inicializarPesquisaNavErp);
  } else {
    inicializarPesquisaNavErp();
  }
}

window.inicializarPesquisaNavErp = inicializarPesquisaNavErp;
