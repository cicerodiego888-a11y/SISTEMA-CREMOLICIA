/**
 * CDS Mobile RC2.4.2 — Cadastro de Produtos (paridade ERP Desktop)
 * Referência oficial: frontend/erp/js/produtos.js → saveProduto / showProdutoModal
 * Sem foto / mídia local — funcionalidade inexistente no ERP Desktop.
 */
import {
  escapeHtml,
  asText,
  formatMoney,
  formatNumber,
  formatDateTime,
  formatDate,
  loadingHtml,
  emptyHtml,
  errorHtml,
  searchBarHtml,
  listCardHtml,
  sectionTitleHtml,
  backBarHtml,
  bindBack,
  bindGo,
  debounce,
  countLabel
} from '../ui.js';
import {
  fieldHtml,
  formCardHtml,
  collectForm,
  fabHtml,
  actionBarHtml,
  confirmDanger,
  formSubmitActionsHtml,
  promptSheet
} from '../forms.js';
import { showToast } from '../toast.js';
import { scanBarcode, sharePayload } from '../native.js';

const PAGE_SIZE = 20;

const UNIDADES_DESKTOP = [
  { value: 'un', label: 'Unidade' },
  { value: 'kg', label: 'Quilograma' },
  { value: 'g', label: 'Grama' },
  { value: 'l', label: 'Litro' },
  { value: 'ml', label: 'Mililitro' },
  { value: 'mt', label: 'Metro' },
  { value: 'm2', label: 'Metro Quadrado' },
  { value: 'm3', label: 'Metro Cúbico' }
];

function estoqueValor(p) {
  const keys = ['estoque', 'estoque_exibido', 'estoque_atual', 'saldo_fiscal', 'quantidade'];
  for (const k of keys) {
    if (p[k] != null && p[k] !== '') return Number(p[k]);
  }
  return 0;
}

function unwrapList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.categorias)) return payload.categorias;
  if (Array.isArray(payload?.produtos)) return payload.produtos;
  return [];
}

function normalizeUnidade(u) {
  const raw = String(u || 'un').trim().toLowerCase();
  if (UNIDADES_DESKTOP.some((o) => o.value === raw)) return raw;
  if (raw === 'unid' || raw === 'unidade') return 'un';
  return 'un';
}

function produtoEhFracionado(p = {}) {
  return Number(p.produto_fracionado || 0) === 1 || Number(p.vendido_por_peso || 0) === 1;
}

/**
 * Payload idêntico ao ERP Desktop (saveProduto).
 * Não inclui campos exclusivos do Mobile (foto, ativo, estoque_atual legado isolado).
 */
export function buildProdutoPayload(raw = {}, { includeSaldosIniciais = false } = {}) {
  const preco_compra = Number(raw.preco_compra) || 0;
  const preco_venda = Number(raw.preco_venda) || 0;
  const lucro_percentual = (preco_compra > 0 && preco_venda > 0)
    ? Number((((preco_venda - preco_compra) / preco_compra) * 100).toFixed(2))
    : null;

  const fracionadoAtivo = !!(raw.produto_fracionado === true
    || raw.produto_fracionado === 1
    || raw.produto_fracionado === '1'
    || raw.produto_fracionado === 'on');
  const permiteVendaUnidade = fracionadoAtivo && !!(raw.permite_venda_unidade === true
    || raw.permite_venda_unidade === 1
    || raw.permite_venda_unidade === '1'
    || raw.permite_venda_unidade === 'on');
  const pesoMedioUnidade = Number(raw.peso_medio_unidade) || 0;
  const precoUnidadeVenda = Number(raw.preco_unidade) || 0;

  const saldo_fiscal_inicial = Number(raw.saldo_fiscal_inicial ?? raw.saldo_fiscal ?? 0) || 0;
  const saldo_nao_fiscal_inicial = Number(raw.saldo_nao_fiscal_inicial ?? raw.saldo_nao_fiscal ?? 0) || 0;

  const data = {
    codigo: String(raw.codigo || '').trim(),
    nome: String(raw.nome || '').trim(),
    categoria_id: raw.categoria_id ? String(raw.categoria_id) : null,
    subcategoria_id: raw.subcategoria_id ? String(raw.subcategoria_id) : null,
    unidade: normalizeUnidade(raw.unidade),
    preco_compra,
    preco_venda,
    lucro_percentual,
    estoque_minimo: Number(raw.estoque_minimo) || 0,
    fornecedor: String(raw.fornecedor || '').trim(),
    data_validade: String(raw.data_validade || '').trim() || null,
    lote: String(raw.lote || '').trim(),
    dias_alerta_validade: parseInt(raw.dias_alerta_validade, 10) || 30,
    controlar_validade: (raw.controlar_validade === true
      || raw.controlar_validade === 1
      || raw.controlar_validade === '1'
      || raw.controlar_validade === 'on') ? 1 : 0,
    ncm: String(raw.ncm || '').trim(),
    cfop: String(raw.cfop || '').trim(),
    csosn: String(raw.csosn || '').trim(),
    origem: raw.origem !== '' && raw.origem != null ? parseInt(raw.origem, 10) || 0 : 0,
    cest: String(raw.cest || '').trim(),
    codigo_barras: String(raw.codigo_barras || '').trim(),
    aliquota_icms: Number(raw.aliquota_icms) || 0,
    aliquota_pis: Number(raw.aliquota_pis) || 0,
    aliquota_cofins: Number(raw.aliquota_cofins) || 0,
    produto_fracionado: fracionadoAtivo ? 1 : 0,
    vendido_por_peso: fracionadoAtivo ? 1 : 0,
    permite_venda_unidade: permiteVendaUnidade ? 1 : 0,
    peso_medio_unidade: permiteVendaUnidade ? pesoMedioUnidade : 0,
    preco_unidade: permiteVendaUnidade ? precoUnidadeVenda : 0,
    // RCM-8.6.2 — faixas produto_atacado fora do cadastro
    venda_atacado: 0,
    data_validade_inicial: String(raw.data_validade_inicial || '').trim() || null
  };

  if (includeSaldosIniciais) {
    data.saldo_fiscal_inicial = saldo_fiscal_inicial;
    data.saldo_nao_fiscal_inicial = saldo_nao_fiscal_inicial;
  }

  // Mesma regra do Desktop: resolverItemFiscalParaSalvar
  if (includeSaldosIniciais
    && saldo_nao_fiscal_inicial > 0
    && saldo_fiscal_inicial === 0) {
    data.item_fiscal = 0;
  } else {
    data.item_fiscal = 1;
  }

  return data;
}

function selectOptions(list, selected) {
  return list.map((o) => ({
    value: o.value,
    label: o.label,
    selected: String(o.value) === String(selected ?? '')
  }));
}

function fieldsProduto(p = {}, { isNew = false, categorias = [], subcategorias = [] } = {}) {
  const un = normalizeUnidade(p.unidade);
  const catId = p.categoria_id != null ? String(p.categoria_id) : '';
  const subId = p.subcategoria_id != null ? String(p.subcategoria_id) : '';
  const fracionado = produtoEhFracionado(p);
  const permiteUnidade = Number(p.permite_venda_unidade || 0) === 1;
  const controlarValidade = Number(p.controlar_validade || 0) === 1;
  const permiteEditarSaldos = isNew || !p.tem_movimentacoes;

  const catOpts = [
    { value: '', label: 'Selecione', selected: !catId },
    ...categorias.map((c) => ({
      value: String(c.id),
      label: asText(c.nome, `Categoria #${c.id}`),
      selected: String(c.id) === catId
    }))
  ];
  const subOpts = [
    { value: '', label: catId ? 'Nenhuma' : 'Selecione uma categoria', selected: !subId },
    ...subcategorias.map((s) => ({
      value: String(s.id),
      label: asText(s.nome, `Sub #${s.id}`),
      selected: String(s.id) === subId
    }))
  ];

  return `
    ${sectionTitleHtml('Identificação')}
    ${fieldHtml({ name: 'codigo', label: 'Código', value: p.codigo })}
    ${fieldHtml({ name: 'nome', label: 'Nome', value: p.nome, required: true })}
    ${fieldHtml({ name: 'categoria_id', label: 'Categoria', type: 'select', value: catOpts })}
    ${fieldHtml({ name: 'subcategoria_id', label: 'Subcategoria', type: 'select', value: subOpts })}
    ${fieldHtml({
      name: 'unidade',
      label: 'Unidade',
      type: 'select',
      value: selectOptions(UNIDADES_DESKTOP, un)
    })}

    ${sectionTitleHtml('Código de barras (EAN/GTIN)')}
    <div class="cds-ean-row">
      ${fieldHtml({
        name: 'codigo_barras',
        label: 'Código de barras',
        value: p.codigo_barras,
        inputmode: 'numeric',
        placeholder: 'Digite ou escaneie'
      })}
      <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" id="prod-scan-ean">Escanear</button>
    </div>

    ${sectionTitleHtml('Preços')}
    ${fieldHtml({
      name: 'preco_compra',
      label: 'Preço de compra',
      value: p.preco_compra ?? 0,
      type: 'number',
      inputmode: 'decimal'
    })}
    ${fieldHtml({
      name: 'preco_venda',
      label: 'Preço de Segurança',
      value: p.preco_venda ?? p.preco ?? 0,
      type: 'number',
      inputmode: 'decimal',
      required: true
    })}

    ${sectionTitleHtml('Estoque')}
    ${permiteEditarSaldos
      ? `
        ${fieldHtml({
          name: 'saldo_fiscal_inicial',
          label: isNew ? 'Estoque fiscal inicial' : 'Estoque fiscal',
          value: p.saldo_fiscal ?? p.saldo_fiscal_inicial ?? 0,
          type: 'number',
          inputmode: 'decimal'
        })}
        ${fieldHtml({
          name: 'saldo_nao_fiscal_inicial',
          label: isNew ? 'Estoque não fiscal inicial' : 'Estoque não fiscal',
          value: p.saldo_nao_fiscal ?? p.saldo_nao_fiscal_inicial ?? 0,
          type: 'number',
          inputmode: 'decimal'
        })}
      `
      : `
        <div class="cds-row"><span>Estoque fiscal</span><strong>${escapeHtml(formatNumber(p.saldo_fiscal ?? 0, 2))}</strong></div>
        <div class="cds-row"><span>Estoque não fiscal</span><strong>${escapeHtml(formatNumber(p.saldo_nao_fiscal ?? 0, 2))}</strong></div>
        <p class="cds-muted cds-form-hint">Produto com movimentações — ajuste de saldo pelo fluxo de estoque.</p>
      `}
    ${fieldHtml({
      name: 'estoque_minimo',
      label: 'Estoque mínimo',
      value: p.estoque_minimo ?? 0,
      type: 'number',
      inputmode: 'decimal'
    })}

    ${sectionTitleHtml('Fornecedor')}
    ${fieldHtml({ name: 'fornecedor', label: 'Fornecedor', value: p.fornecedor })}

    ${sectionTitleHtml('Validade')}
    ${fieldHtml({
      name: 'controlar_validade',
      label: 'Controlar validade deste produto',
      type: 'checkbox',
      value: controlarValidade
    })}
    <div id="area-validade" class="${controlarValidade ? '' : 'is-hidden'}">
      ${fieldHtml({
        name: 'data_validade_inicial',
        label: 'Data validade',
        type: 'date',
        value: p.data_validade_inicial || p.data_validade || ''
      })}
      ${fieldHtml({
        name: 'dias_alerta_validade',
        label: 'Alertar (dias)',
        type: 'number',
        inputmode: 'numeric',
        value: p.dias_alerta_validade ?? 30
      })}
    </div>

    ${sectionTitleHtml('Peso / fracionado')}
    ${fieldHtml({
      name: 'produto_fracionado',
      label: 'Vendido por peso',
      type: 'checkbox',
      value: fracionado
    })}
    <div id="area-venda-unidade" class="${fracionado ? '' : 'is-hidden'}">
      ${fieldHtml({
        name: 'permite_venda_unidade',
        label: 'Permitir venda por unidade',
        type: 'checkbox',
        value: permiteUnidade
      })}
      <div id="area-peso-unidade" class="${fracionado && permiteUnidade ? '' : 'is-hidden'}">
        ${fieldHtml({
          name: 'peso_medio_unidade',
          label: 'Peso médio da unidade (KG)',
          type: 'number',
          inputmode: 'decimal',
          value: p.peso_medio_unidade ?? ''
        })}
        ${fieldHtml({
          name: 'preco_unidade',
          label: 'Preço por unidade (R$)',
          type: 'number',
          inputmode: 'decimal',
          value: p.preco_unidade ?? ''
        })}
      </div>
    </div>

    ${sectionTitleHtml('Fiscal')}
    ${fieldHtml({ name: 'ncm', label: 'NCM', value: p.ncm })}
    ${fieldHtml({ name: 'cfop', label: 'CFOP', value: p.cfop })}
    ${fieldHtml({ name: 'csosn', label: 'CSOSN', value: p.csosn || p.cst })}
    ${fieldHtml({
      name: 'origem',
      label: 'Origem',
      type: 'number',
      inputmode: 'numeric',
      value: p.origem ?? 0
    })}
    ${fieldHtml({ name: 'cest', label: 'CEST', value: p.cest })}
    ${fieldHtml({
      name: 'aliquota_icms',
      label: 'Alíquota ICMS',
      type: 'number',
      inputmode: 'decimal',
      value: p.aliquota_icms ?? 0
    })}
    ${fieldHtml({
      name: 'aliquota_pis',
      label: 'Alíquota PIS',
      type: 'number',
      inputmode: 'decimal',
      value: p.aliquota_pis ?? 0
    })}
    ${fieldHtml({
      name: 'aliquota_cofins',
      label: 'Alíquota COFINS',
      type: 'number',
      inputmode: 'decimal',
      value: p.aliquota_cofins ?? 0
    })}
  `;
}

function cardProduto(p, { estoqueMode = false } = {}) {
  const estoque = estoqueValor(p);
  const min = Number(p.estoque_minimo ?? p.minimo ?? 0);
  const baixo = Number.isFinite(min) && min > 0 && estoque <= min;
  const routeBase = estoqueMode ? 'estoque' : 'produtos';

  return listCardHtml({
    go: `${routeBase}/${p.id}`,
    title: asText(p.nome || p.descricao, 'Produto'),
    subtitle: asText(p.codigo || p.sku || p.codigo_barras || p.id),
    value: estoqueMode ? formatNumber(estoque, 2) : formatMoney(p.preco_venda ?? p.preco ?? 0),
    status: baixo ? 'Baixo' : null,
    meta: estoqueMode
      ? [
          `Fiscal ${formatNumber(p.saldo_fiscal ?? 0, 2)}`,
          `Não fiscal ${formatNumber(p.saldo_nao_fiscal ?? 0, 2)}`
        ]
      : [`Estoque ${formatNumber(estoque, 2)}`]
  });
}

async function buscarProdutos(term, offset = 0) {
  const q = String(term || '').trim();
  // Cadastro: listagem oficial = GET /produtos (mesmo do ERP Desktop).
  // NÃO usar frequentes=1 aqui — só retorna itens com venda nos últimos 30 dias
  // e deixa a tela vazia no celular quando não há histórico recente.
  if (!q) {
    if (offset > 0) return [];
    return window.CDSApi.get('produtos');
  }
  return window.CDSApi.get('produtos/search', { q, limite: PAGE_SIZE, offset });
}

async function carregarCategoriasProduto() {
  try {
    const payload = await window.CDSApi.get('categorias', { tipo: 'produto' });
    return unwrapList(payload);
  } catch (e) {
    return [];
  }
}

async function carregarSubcategorias(categoriaId) {
  if (!categoriaId) return [];
  try {
    let subs = unwrapList(await window.CDSApi.get(`subcategorias/categoria/${categoriaId}`));
    if (!subs.length) {
      subs = unwrapList(await window.CDSApi.get('subcategorias', { categoria_id: categoriaId }));
    }
    return subs;
  } catch (e) {
    return [];
  }
}

function bindFormDependencias(root, categorias) {
  const toggle = (sel, show) => {
    const el = root.querySelector(sel);
    if (!el) return;
    el.classList.toggle('is-hidden', !show);
  };

  const syncVisibilidade = () => {
    const fracionado = root.querySelector('[name="produto_fracionado"]')?.checked;
    const permite = root.querySelector('[name="permite_venda_unidade"]')?.checked;
    const validade = root.querySelector('[name="controlar_validade"]')?.checked;
    toggle('#area-venda-unidade', !!fracionado);
    toggle('#area-peso-unidade', !!(fracionado && permite));
    toggle('#area-validade', !!validade);
  };

  root.querySelector('[name="controlar_validade"]')?.addEventListener('change', syncVisibilidade);
  root.querySelector('[name="produto_fracionado"]')?.addEventListener('change', syncVisibilidade);
  root.querySelector('[name="permite_venda_unidade"]')?.addEventListener('change', syncVisibilidade);

  root.querySelector('[name="categoria_id"]')?.addEventListener('change', async (e) => {
    const catId = e.target.value;
    const subs = await carregarSubcategorias(catId);
    const sel = root.querySelector('[name="subcategoria_id"]');
    if (!sel) return;
    sel.innerHTML = `
      <option value="">${catId ? 'Nenhuma' : 'Selecione uma categoria'}</option>
      ${subs.map((s) => `<option value="${escapeHtml(String(s.id))}">${escapeHtml(asText(s.nome))}</option>`).join('')}
    `;
  });

  syncVisibilidade();
  void categorias;
}

function validarPayloadDesktop(data, { includeSaldosIniciais = false } = {}) {
  if (!data.nome) return 'Informe o nome do produto.';
  if (data.preco_venda <= 0) return 'Informe um preço de venda válido.';
  if (data.preco_compra < 0) return 'Preço de compra inválido.';
  if (data.estoque_minimo < 0) return 'Estoque mínimo inválido.';
  if (includeSaldosIniciais) {
    if (data.saldo_fiscal_inicial < 0 || data.saldo_nao_fiscal_inicial < 0) {
      return 'Saldos iniciais não podem ser negativos.';
    }
  }
  if (data.controlar_validade === 1) {
    const estoque = includeSaldosIniciais
      ? (Number(data.saldo_fiscal_inicial || 0) + Number(data.saldo_nao_fiscal_inicial || 0))
      : 0;
    if (includeSaldosIniciais && estoque > 0 && !data.data_validade_inicial) {
      return 'Para produtos com controle de validade e estoque, informe a data de validade.';
    }
  }
  if (data.produto_fracionado === 1 && data.permite_venda_unidade === 1) {
    if (data.peso_medio_unidade <= 0 || data.preco_unidade <= 0) {
      return 'Para venda por unidade, informe peso médio e preço por unidade.';
    }
  }
  return null;
}

export async function renderProdutos(root) {
  root.innerHTML = `
    ${searchBarHtml('Buscar produto, código ou EAN', 'produtos-search')}
    <p class="cds-muted" id="produtos-count"></p>
    <div id="produtos-list">${loadingHtml('Listando produtos…')}</div>
    <div id="produtos-more" class="cds-mobile-more"></div>
    ${fabHtml('Novo produto', 'produtos/novo')}
  `;

  let offset = 0;
  let term = '';
  let items = [];
  let allCached = null;
  let hasMore = false;
  const LIST_CHUNK = PAGE_SIZE;

  const paint = () => {
    const list = root.querySelector('#produtos-list');
    const count = root.querySelector('#produtos-count');
    const moreWrap = root.querySelector('#produtos-more');
    count.textContent = countLabel(items.length, 'produto', 'produtos');
    list.innerHTML = items.length
      ? items.map((p) => cardProduto(p)).join('')
      : emptyHtml(term ? 'Nenhum produto encontrado' : 'Nenhum produto cadastrado');
    bindGo(list);
    moreWrap.innerHTML = hasMore
      ? `<button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" id="btn-more">Carregar mais</button>`
      : '';
    moreWrap.querySelector('#btn-more')?.addEventListener('click', () => loadMore());
  };

  const fetchPage = async (reset) => {
    const q = String(term || '').trim();

    // Lista completa (sem busca): carrega GET /produtos e pagina no cliente
    if (!q) {
      if (reset || !Array.isArray(allCached)) {
        const payload = await buscarProdutos('', 0);
        allCached = unwrapList(payload);
        offset = 0;
      }
      const next = allCached.slice(offset, offset + LIST_CHUNK);
      hasMore = offset + next.length < allCached.length;
      if (reset) {
        items = next;
        offset = next.length;
      } else {
        items = items.concat(next);
        offset += next.length;
      }
      paint();
      return;
    }

    allCached = null;
    const payload = await buscarProdutos(q, reset ? 0 : offset);
    const page = unwrapList(payload);
    hasMore = page.length >= PAGE_SIZE;
    if (reset) {
      items = page;
      offset = page.length;
    } else {
      items = items.concat(page);
      offset += page.length;
    }
    paint();
  };

  const loadMore = async () => {
    try {
      await fetchPage(false);
    } catch (err) {
      showToast(err.message || 'Erro ao carregar mais', 'error');
    }
  };

  bindGo(root);
  try {
    await fetchPage(true);
  } catch (err) {
    root.querySelector('#produtos-list').innerHTML = errorHtml(err.message, err.status);
  }

  root.querySelector('#produtos-search')?.addEventListener('input', debounce(async (e) => {
    term = e.target.value;
    offset = 0;
    try {
      await fetchPage(true);
    } catch (err) {
      showToast(err.message || 'Erro na busca', 'error');
    }
  }, 280));
}

export async function renderForm(root, id) {
  const isNew = !id;
  root.innerHTML = loadingHtml();
  try {
    let p = {};
    if (!isNew) p = await window.CDSApi.get(`produtos/${id}`);
    const categorias = await carregarCategoriasProduto();
    const subcategorias = await carregarSubcategorias(p.categoria_id);
    const includeSaldosIniciais = isNew || !p.tem_movimentacoes;

    root.innerHTML = `
      ${backBarHtml('Produtos')}
      ${formCardHtml(
        isNew ? 'Novo produto' : 'Editar produto',
        fieldsProduto(p, { isNew, categorias, subcategorias }),
        formSubmitActionsHtml(isNew ? 'Salvar' : 'Atualizar')
      )}
    `;
    bindBack(root);
    bindFormDependencias(root, categorias);

    root.querySelector('#prod-scan-ean')?.addEventListener('click', async () => {
      const code = await scanBarcode({
        title: 'Código de barras (EAN/GTIN)',
        current: root.querySelector('[name="codigo_barras"]')?.value || ''
      });
      if (code == null) return;
      const input = root.querySelector('[name="codigo_barras"]');
      if (input) input.value = code;
      showToast('Código capturado.', 'success');
    });

    root.querySelector('#cds-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const raw = collectForm(e.target);
      const body = buildProdutoPayload(raw, { includeSaldosIniciais });
      const erro = validarPayloadDesktop(body, { includeSaldosIniciais });
      if (erro) {
        showToast(erro, 'warning');
        return;
      }
      try {
        if (isNew) {
          const created = await window.CDSApi.post('produtos', body);
          showToast('Produto criado.', 'success');
          window.CDSMobile?.navigate?.(`produtos/${created.id || created?.data?.id}`, { replace: true });
        } else {
          await window.CDSApi.put(`produtos/${id}`, body);
          showToast('Produto atualizado.', 'success');
          window.CDSMobile?.navigate?.(`produtos/${id}`, { replace: true });
        }
      } catch (err) {
        showToast(err.message || 'Falha ao salvar produto', 'error');
      }
    });
  } catch (err) {
    root.innerHTML = `${backBarHtml('Produtos')}${errorHtml(err.message, err.status)}`;
    bindBack(root);
  }
}

export async function renderDetail(root, id, parsed) {
  const fromEstoque = parsed?.name === 'estoque';
  root.innerHTML = loadingHtml();
  try {
    const p = await window.CDSApi.get(`produtos/${id}`);
    const estoque = estoqueValor(p);
    let historico = [];
    let histPrecos = [];
    try {
      historico = await window.CDSApi.get(`produtos/${id}/historico-estoque`);
      if (!Array.isArray(historico)) historico = [];
    } catch (e) {
      historico = [];
    }
    try {
      histPrecos = await window.CDSApi.get(`produtos/${id}/historico-precos`);
      if (!Array.isArray(histPrecos)) histPrecos = histPrecos?.data || [];
    } catch (e) {
      histPrecos = [];
    }

    let ucList = [];
    let mucList = [];
    let promos = [];
    try {
      ucList = unwrapList(await window.CDSApi.get(`produtos/${id}/unidades-comercializacao`));
    } catch (e) { ucList = []; }
    try {
      mucList = unwrapList(await window.CDSApi.get(`produtos/${id}/unidades`));
    } catch (e) { mucList = []; }
    try {
      const allPromo = unwrapList(await window.CDSApi.get('produtos/promocoes', { produto_id: id }));
      promos = allPromo.filter((x) => Number(x.produto_id || x.produtoId) === Number(id) || !x.produto_id);
    } catch (e) { promos = []; }

    const paint = () => {
      root.innerHTML = `
        ${backBarHtml(fromEstoque ? 'Estoque' : 'Produtos')}
        <article class="cds-card cds-m-enter">
          <h3 class="cds-card__title" style="margin:0 0 10px">${escapeHtml(asText(p.nome, 'Produto'))}</h3>
          <div class="cds-row"><span>Código</span><strong>${escapeHtml(asText(p.codigo))}</strong></div>
          <div class="cds-row"><span>Código de barras</span><strong>${escapeHtml(asText(p.codigo_barras))}</strong></div>
          <div class="cds-row"><span>Unidade</span><strong>${escapeHtml(asText(normalizeUnidade(p.unidade)).toUpperCase())}</strong></div>
          <div class="cds-row"><span>Categoria</span><strong>${escapeHtml(asText(p.categoria_nome || p.categoria || p.categoria_id))}</strong></div>
          <div class="cds-row"><span>Subcategoria</span><strong>${escapeHtml(asText(p.subcategoria_nome || p.subcategoria || p.subcategoria_id))}</strong></div>
          <div class="cds-row"><span>Preço de Segurança</span><strong>${escapeHtml(formatMoney(p.preco_venda ?? 0))}</strong></div>
          <div class="cds-row"><span>Preço compra</span><strong>${escapeHtml(formatMoney(p.preco_compra ?? 0))}</strong></div>
          <div class="cds-row"><span>Estoque</span><strong>${escapeHtml(formatNumber(estoque, 2))}</strong></div>
          <div class="cds-row"><span>Saldo fiscal</span><strong>${escapeHtml(formatNumber(p.saldo_fiscal ?? 0, 2))}</strong></div>
          <div class="cds-row"><span>Saldo não fiscal</span><strong>${escapeHtml(formatNumber(p.saldo_nao_fiscal ?? 0, 2))}</strong></div>
          <div class="cds-row"><span>NCM</span><strong>${escapeHtml(asText(p.ncm))}</strong></div>
          <div class="cds-row"><span>CEST</span><strong>${escapeHtml(asText(p.cest))}</strong></div>
          <div class="cds-row"><span>CFOP</span><strong>${escapeHtml(asText(p.cfop))}</strong></div>
          <div class="cds-row"><span>CSOSN</span><strong>${escapeHtml(asText(p.csosn))}</strong></div>
          <div class="cds-row"><span>Vendido por peso</span><strong>${produtoEhFracionado(p) ? 'Sim' : 'Não'}</strong></div>
          <div class="cds-row"><span>Validade</span><strong>${Number(p.controlar_validade || 0) === 1 ? 'Controlada' : 'Não'}</strong></div>
        </article>

        ${sectionTitleHtml('Histórico de estoque')}
        <div>
          ${historico.length
            ? historico.slice(0, 30).map((h) => listCardHtml({
                title: asText(h.motivo || h.tipo || h.observacao || 'Ajuste'),
                value: formatNumber(h.quantidade ?? h.delta ?? h.diferenca ?? 0, 2),
                meta: [formatDateTime(h.criado_em || h.created_at || h.data)].filter((x) => x !== '—')
              })).join('')
            : emptyHtml('Sem histórico de ajustes')}
        </div>

        ${sectionTitleHtml('Histórico de preços')}
        <div>
          ${histPrecos.length
            ? histPrecos.slice(0, 20).map((h) => listCardHtml({
                title: asText(h.motivo || 'Alteração de preço'),
                value: formatMoney(h.preco_venda ?? h.preco_novo ?? h.preco ?? 0),
                meta: [formatDateTime(h.criado_em || h.created_at || h.data)]
              })).join('')
            : emptyHtml('Sem histórico de preços')}
        </div>

        ${sectionTitleHtml('Unidades comerciais (UC)')}
        <div>
          ${ucList.length
            ? ucList.map((u) => listCardHtml({
                title: asText(u.descricao || u.nome || u.codigo || u.unidade),
                subtitle: asText(u.codigo || u.sigla || '', ''),
                meta: [u.principal || u.is_principal ? 'Principal' : '', u.fator ? `Fator ${u.fator}` : ''].filter(Boolean)
              })).join('')
            : emptyHtml('Sem UC cadastrada', 'Use o sheet abaixo para criar.')}
          <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" id="prod-uc-add" style="width:100%;margin-top:8px">Nova UC</button>
        </div>

        ${sectionTitleHtml('MUC')}
        <div>
          ${mucList.length
            ? mucList.map((u) => listCardHtml({
                title: asText(u.descricao || u.nome || u.codigo_barras || u.codigo),
                subtitle: asText(u.codigo_barras || u.barra || '', ''),
                meta: [u.principal ? 'Principal' : '', u.quantidade ? `Qtd ${u.quantidade}` : ''].filter(Boolean)
              })).join('')
            : emptyHtml('Sem unidades MUC')}
          <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" id="prod-muc-add" style="width:100%;margin-top:8px">Nova MUC</button>
        </div>

        ${sectionTitleHtml('Promoções')}
        <div>
          ${promos.length
            ? promos.slice(0, 15).map((pr) => listCardHtml({
                title: asText(pr.titulo || pr.nome || `Promo #${pr.id}`),
                value: formatMoney(pr.preco_promocional ?? pr.preco ?? 0),
                status: pr.status || (pr.ativa ? 'Ativa' : '—'),
                meta: [formatDate(pr.inicio || pr.data_inicio), formatDate(pr.fim || pr.data_fim)].filter((x) => x !== '—')
              })).join('')
            : emptyHtml('Sem promoções deste produto')}
          <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" id="prod-promo-add" style="width:100%;margin-top:8px">Criar promoção</button>
        </div>

        ${!fromEstoque ? actionBarHtml([
          { action: 'scan', label: 'EAN', icon: 'barcode', variant: 'ghost' },
          { action: 'estoque', label: 'Ajustar estoque', icon: 'warehouse', variant: 'secondary' },
          { action: 'share', label: 'Compartilhar', icon: 'share', variant: 'ghost' },
          { action: 'edit', label: 'Editar', icon: 'edit', variant: 'secondary' },
          { action: 'delete', label: 'Excluir', icon: 'trash', variant: 'ghost' }
        ]) : actionBarHtml([
          { action: 'produto', label: 'Abrir cadastro', icon: 'box', variant: 'secondary' }
        ])}
      `;
      bindBack(root);

      root.querySelector('#prod-uc-add')?.addEventListener('click', async () => {
        const data = await promptSheet({
          title: 'Nova unidade comercial',
          fieldsHtml: `
            ${fieldHtml({ name: 'codigo', label: 'Código / sigla', required: true })}
            ${fieldHtml({ name: 'descricao', label: 'Descrição', required: true })}
            ${fieldHtml({ name: 'fator', label: 'Fator conversão', type: 'number', value: 1, inputmode: 'decimal' })}
          `
        });
        if (!data?.codigo) return;
        try {
          await window.CDSApi.post(`produtos/${id}/unidades-comercializacao`, data);
          showToast('UC criada.', 'success');
          window.CDSMobile?.navigate?.(`produtos/${id}`, { replace: true });
        } catch (err) {
          showToast(err.message || 'Falha UC', 'error');
        }
      });

      root.querySelector('#prod-muc-add')?.addEventListener('click', async () => {
        const data = await promptSheet({
          title: 'Nova MUC',
          fieldsHtml: `
            ${fieldHtml({ name: 'descricao', label: 'Descrição', required: true })}
            ${fieldHtml({ name: 'codigo_barras', label: 'Código de barras', inputmode: 'numeric' })}
            ${fieldHtml({ name: 'quantidade', label: 'Quantidade', type: 'number', value: 1, inputmode: 'decimal' })}
          `
        });
        if (!data?.descricao) return;
        try {
          await window.CDSApi.post(`produtos/${id}/unidades`, data);
          showToast('MUC criada.', 'success');
          window.CDSMobile?.navigate?.(`produtos/${id}`, { replace: true });
        } catch (err) {
          showToast(err.message || 'Falha MUC', 'error');
        }
      });

      root.querySelector('#prod-promo-add')?.addEventListener('click', async () => {
        const hoje = new Date().toISOString().slice(0, 10);
        const data = await promptSheet({
          title: 'Nova promoção',
          fieldsHtml: `
            ${fieldHtml({ name: 'titulo', label: 'Título', required: true })}
            ${fieldHtml({ name: 'preco_promocional', label: 'Preço promocional', type: 'number', required: true, inputmode: 'decimal' })}
            ${fieldHtml({ name: 'inicio', label: 'Início', type: 'date', value: hoje })}
            ${fieldHtml({ name: 'fim', label: 'Fim', type: 'date' })}
          `
        });
        if (!data?.titulo) return;
        try {
          await window.CDSApi.post('produtos/promocoes', {
            ...data,
            produto_id: Number(id),
            preco_promocional: Number(data.preco_promocional)
          });
          showToast('Promoção criada.', 'success');
          window.CDSMobile?.navigate?.(`produtos/${id}`, { replace: true });
        } catch (err) {
          showToast(err.message || 'Falha promoção', 'error');
        }
      });

      root.querySelector('[data-action="scan"]')?.addEventListener('click', async () => {
        const code = await scanBarcode({
          title: 'Código de barras (EAN/GTIN)',
          current: p.codigo_barras || ''
        });
        if (!code) return;
        try {
          const body = buildProdutoPayload({
            ...p,
            codigo_barras: code,
            saldo_fiscal_inicial: p.saldo_fiscal,
            saldo_nao_fiscal_inicial: p.saldo_nao_fiscal
          }, { includeSaldosIniciais: false });
          await window.CDSApi.put(`produtos/${id}`, body);
          showToast('Código de barras atualizado.', 'success');
          window.CDSMobile?.navigate?.(`produtos/${id}`, { replace: true });
        } catch (err) {
          showToast(err.message || 'Falha ao salvar EAN', 'error');
        }
      });

      root.querySelector('[data-action="estoque"]')?.addEventListener('click', () => {
        window.CDSMobile?.navigate?.(`estoque/${id}`);
      });
      root.querySelector('[data-action="share"]')?.addEventListener('click', async () => {
        await sharePayload({
          title: asText(p.nome, 'Produto'),
          text: `${asText(p.nome)}\nCódigo: ${asText(p.codigo)}\nEAN: ${asText(p.codigo_barras)}\nPreço: ${formatMoney(p.preco_venda ?? 0)}\nEstoque: ${formatNumber(estoque, 2)}`
        });
      });
      root.querySelector('[data-action="edit"]')?.addEventListener('click', () => {
        window.CDSMobile?.navigate?.(`produtos/${id}/editar`);
      });
      root.querySelector('[data-action="produto"]')?.addEventListener('click', () => {
        window.CDSMobile?.navigate?.(`produtos/${id}`);
      });
      root.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
        const ok = await confirmDanger(`Excluir produto "${p.nome}"?`, { title: 'Excluir produto', confirmLabel: 'Excluir' });
        if (!ok) return;
        try {
          await window.CDSApi.del(`produtos/${id}`);
          showToast('Produto excluído.', 'success');
          window.CDSMobile?.navigate?.('produtos', { replace: true });
        } catch (err) {
          showToast(err.message || 'Não foi possível excluir', 'error');
        }
      });
    };

    paint();
  } catch (err) {
    root.innerHTML = `${backBarHtml('Voltar')}${errorHtml(err.message, err.status)}`;
    bindBack(root);
  }
}

export async function renderEstoque(root) {
  root.innerHTML = loadingHtml('Consultando estoque…');
  try {
    let baixo = [];
    try {
      baixo = await window.CDSApi.get('produtos/estoque/baixo');
      if (!Array.isArray(baixo)) baixo = [];
    } catch (e) {
      baixo = [];
    }

    root.innerHTML = `
      ${searchBarHtml('Buscar produto no estoque', 'estoque-search')}
      ${sectionTitleHtml('Alertas de estoque')}
      <p class="cds-muted" id="estoque-baixo-count">${escapeHtml(countLabel(baixo.length, 'alerta', 'alertas'))}</p>
      <div id="estoque-baixo-list">
        ${baixo.length
          ? baixo.slice(0, 40).map((p) => cardProduto(p, { estoqueMode: true })).join('')
          : emptyHtml('Nenhum alerta de estoque baixo')}
      </div>
      ${sectionTitleHtml('Consulta')}
      <div id="estoque-list">${emptyHtml('Digite para buscar no estoque')}</div>
    `;

    bindGo(root);

    root.querySelector('#estoque-search')?.addEventListener('input', debounce(async (e) => {
      const q = String(e.target.value || '').trim();
      const list = root.querySelector('#estoque-list');
      if (q.length < 2) {
        list.innerHTML = emptyHtml('Digite para buscar no estoque');
        return;
      }
      list.innerHTML = loadingHtml('Buscando…');
      try {
        const payload = await buscarProdutos(q, 0);
        const items = unwrapList(payload);
        list.innerHTML = items.length
          ? items.map((p) => cardProduto(p, { estoqueMode: true })).join('')
          : emptyHtml('Nenhum produto encontrado');
        bindGo(list);
      } catch (err) {
        list.innerHTML = errorHtml(err.message, err.status);
      }
    }, 280));
  } catch (err) {
    root.innerHTML = errorHtml(err.message || 'Erro ao consultar estoque.', err.status);
    showToast(err.message || 'Erro no estoque', 'error');
  }
}

export async function render(root, parsed) {
  const parts = parsed?.parts || [];
  if (parsed?.name === 'estoque') {
    if (parts[1]) return renderDetail(root, parts[1], parsed);
    return renderEstoque(root);
  }
  if (parts[1] === 'novo') return renderForm(root, null);
  if (parts[1] && parts[2] === 'editar') return renderForm(root, parts[1]);
  if (parts[1]) return renderDetail(root, parts[1], parsed);
  return renderProdutos(root);
}

export default {
  render,
  renderDetail,
  renderEstoque,
  buildProdutoPayload,
  title: 'Produtos',
  subtitle: 'Cadastros'
};
