/**
 * CDS Mobile RCM-03 — Compras (paridade ERP Desktop)
 * Multi-item + MCC + conferência + devolução. APIs: /api/compras
 */
import {
  escapeHtml,
  asText,
  formatMoney,
  formatDate,
  loadingHtml,
  emptyHtml,
  errorHtml,
  listCardHtml,
  backBarHtml,
  bindBack,
  bindGo,
  sectionTitleHtml,
  countLabel,
  searchBarHtml,
  debounce
} from '../ui.js';
import {
  fieldHtml,
  formCardHtml,
  collectForm,
  fabHtml,
  actionBarHtml,
  confirmSheet,
  promptSheet,
  unwrapList,
  qtyControlHtml,
  parseQty,
  openBottomSheet,
  closeBottomSheet,
  cadastroSectionHtml
} from '../forms.js';
import { showToast } from '../toast.js';

const MODOS_MCC = [
  { value: 'PESO_POR_EMBALAGEM', label: 'Peso por embalagem' },
  { value: 'PESO_TOTAL', label: 'Peso total' },
  { value: 'VOLUME_TOTAL', label: 'Volume total' }
];

function cardCompra(c) {
  return listCardHtml({
    go: `compras/${c.id}`,
    title: asText(c.fornecedor || c.numero_nf || `Compra #${c.id}`, 'Compra'),
    value: formatMoney(c.total ?? c.valor_total_nota ?? 0),
    status: c.status || c.situacao,
    meta: [
      formatDate(c.data_compra || c.data_entrada || c.created_at),
      asText(c.numero_nf, '')
    ].filter((x) => x && x !== '—')
  });
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

async function buscarProdutos(termo) {
  const q = String(termo || '').trim();
  if (!q) return [];
  try {
    const payload = await window.CDSApi.get('produtos/search', { q, limite: 20 });
    return unwrapList(payload);
  } catch (e) {
    try {
      const payload = await window.CDSApi.get('produtos/consulta-pdv/buscar', { q, limite: 20 });
      return unwrapList(payload);
    } catch (e2) {
      return [];
    }
  }
}

async function carregarUnidadesComerciais(produtoId) {
  try {
    const raw = await window.CDSApi.get(`produtos/${produtoId}/unidades-comercializacao`);
    return unwrapList(raw);
  } catch (e) {
    return [];
  }
}

function itemSubtotal(item) {
  if (Number(item.valor_total_embalagem) > 0) return round2(item.valor_total_embalagem);
  return round2(Number(item.quantidade || 0) * Number(item.preco_unitario || 0));
}

function paintConferencia(root, itens, valorNota) {
  const el = root.querySelector('#compra-conferencia');
  if (!el) return;
  const totalItens = round2(itens.reduce((s, i) => s + itemSubtotal(i), 0));
  const frete = Number(root.querySelector('[name="valor_frete"]')?.value || 0);
  const desconto = Number(root.querySelector('[name="valor_desconto"]')?.value || 0);
  const outras = Number(root.querySelector('[name="valor_outras_despesas"]')?.value || 0);
  const calculado = round2(totalItens - desconto + frete + outras);
  const nota = Number(valorNota) > 0 ? round2(valorNota) : calculado;
  const diff = round2(nota - calculado);
  const ok = Math.abs(diff) < 0.02;
  el.innerHTML = `
    <article class="cds-card" style="${ok ? '' : 'border-color:var(--cds-danger,#c0392b)'}">
      <div class="cds-row"><span>Total itens</span><strong>${formatMoney(totalItens)}</strong></div>
      <div class="cds-row"><span>Total calculado</span><strong>${formatMoney(calculado)}</strong></div>
      <div class="cds-row"><span>Total nota</span><strong>${formatMoney(nota)}</strong></div>
      <div class="cds-row"><span>Diferença</span><strong>${formatMoney(diff)}</strong></div>
      <p class="cds-muted" style="margin:8px 0 0">${ok
        ? 'Conferência OK: total dos itens bate com o total da nota.'
        : 'Atenção: diferença entre XML/nota e itens. Verifique frete, desconto ou despesas.'}</p>
    </article>
  `;
  const totEl = root.querySelector('#compra-total-display');
  if (totEl) totEl.textContent = formatMoney(nota);
}

function paintItens(root, state) {
  const list = root.querySelector('#compra-itens');
  if (!list) return;
  list.innerHTML = state.itens.length
    ? state.itens.map((it, idx) => `
        <article class="cds-card">
          <div class="cds-row">
            <strong>${escapeHtml(it.produto_nome || `Produto ${it.produto_id}`)}</strong>
            <button type="button" class="cds-mobile-btn cds-mobile-btn--ghost cds-btn-sm" data-rm="${idx}">Remover</button>
          </div>
          <div class="cds-muted">${escapeHtml([
            it.unidade_comercial ? `UC ${it.unidade_comercial}` : null,
            it.modo_entrada_conversao || null,
            `Qtd ${it.quantidade}`,
            it.quantidade_fiscal != null ? `Fisc ${it.quantidade_fiscal}` : null,
            it.quantidade_nao_fiscal ? `NF ${it.quantidade_nao_fiscal}` : null
          ].filter(Boolean).join(' · '))}</div>
          <div class="cds-row"><span>Unit.</span><strong>${formatMoney(it.preco_unitario)}</strong></div>
          <div class="cds-row"><span>Subtotal</span><strong>${formatMoney(itemSubtotal(it))}</strong></div>
        </article>
      `).join('')
    : emptyHtml('Nenhum item', 'Busque um produto e adicione.');
  list.querySelectorAll('[data-rm]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.itens.splice(Number(btn.getAttribute('data-rm')), 1);
      paintItens(root, state);
      const nota = Number(root.querySelector('[name="valor_total_nota"]')?.value || 0);
      paintConferencia(root, state.itens, nota);
    });
  });
  paintConferencia(root, state.itens, Number(root.querySelector('[name="valor_total_nota"]')?.value || 0));
}

async function openAddItemSheet(root, state, produto) {
  const unidades = await carregarUnidadesComerciais(produto.id);
  const usaMcc = Number(produto.utiliza_conversao_fisica || 0) === 1 || unidades.length > 0;
  const ucOpts = unidades.map((u) => {
    const cod = u.codigo || u.unidade || u.sigla || u.unidade_comercial;
    const lab = u.descricao || u.nome || cod;
    return `<option value="${escapeHtml(cod)}">${escapeHtml(lab)}</option>`;
  }).join('');

  const body = `
    <form id="add-item-form" class="cds-form">
      <p><strong>${escapeHtml(produto.nome)}</strong></p>
      <p class="cds-muted">ID ${produto.id} · ${escapeHtml(produto.unidade || 'UN')}</p>
      ${usaMcc ? `
        ${cadastroSectionHtml('MCC / Unidade comercial')}
        <label class="cds-field"><span>Unidade comercial</span>
          <select name="unidade_comercial" class="cds-input">
            <option value="">— base —</option>
            ${ucOpts}
          </select>
        </label>
        <label class="cds-field"><span>Modo entrada</span>
          <select name="modo_entrada_conversao" class="cds-input">
            ${MODOS_MCC.map((m) => `<option value="${m.value}">${escapeHtml(m.label)}</option>`).join('')}
          </select>
        </label>
        ${fieldHtml({ name: 'quantidade_comercial', label: 'Qtd comercial', type: 'number', value: 1, inputmode: 'decimal' })}
        ${fieldHtml({ name: 'peso_embalagem', label: 'Peso embalagem (kg)', type: 'number', inputmode: 'decimal' })}
        ${fieldHtml({ name: 'peso_total', label: 'Peso total (kg)', type: 'number', inputmode: 'decimal' })}
        ${fieldHtml({ name: 'volume_total', label: 'Volume total', type: 'number', inputmode: 'decimal' })}
        ${fieldHtml({ name: 'valor_total_embalagem', label: 'Valor total embalagem', type: 'number', value: 0, inputmode: 'decimal' })}
      ` : `
        <label class="cds-field"><span>Quantidade</span>${qtyControlHtml({ name: 'quantidade', value: 1 })}</label>
        ${fieldHtml({
          name: 'preco_unitario',
          label: 'Preço unitário',
          type: 'number',
          value: produto.preco_compra || 0,
          inputmode: 'decimal',
          required: true
        })}
      `}
      ${cadastroSectionHtml('Distribuição fiscal')}
      ${fieldHtml({ name: 'quantidade_fiscal', label: 'Qtd fiscal', type: 'number', value: usaMcc ? '' : 1, inputmode: 'decimal' })}
      ${fieldHtml({ name: 'quantidade_nao_fiscal', label: 'Qtd não fiscal', type: 'number', value: 0, inputmode: 'decimal' })}
      ${fieldHtml({
        name: 'margem_lucro',
        label: 'Margem %',
        type: 'number',
        value: produto.lucro_percentual || 30,
        inputmode: 'decimal'
      })}
      ${fieldHtml({ name: 'data_validade', label: 'Validade', type: 'date' })}
      <label class="cds-check" style="display:flex;gap:8px;margin:8px 0">
        <input type="checkbox" name="atualizar_preco_venda" checked>
        Atualizar preço de venda
      </label>
    </form>
  `;

  return new Promise((resolve) => {
    const sheet = openBottomSheet({
      title: 'Adicionar item',
      bodyHtml: body,
      actionsHtml: `
        <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" data-sheet-close>Cancelar</button>
        <button type="button" class="cds-mobile-btn" data-ok>Adicionar</button>
      `
    });
    sheet.querySelector('[data-sheet-close]')?.addEventListener('click', () => resolve(null));
    sheet.querySelector('[data-ok]')?.addEventListener('click', () => {
      const form = sheet.querySelector('#add-item-form');
      const d = collectForm(form);
      const uc = d.unidade_comercial || '';
      const valorEmb = Number(d.valor_total_embalagem || 0);
      let qtd = parseQty(d.quantidade);
      let preco = Number(d.preco_unitario || 0);
      const qF = Number(d.quantidade_fiscal || 0);
      const qNf = Number(d.quantidade_nao_fiscal || 0);

      if (usaMcc && (uc || d.modo_entrada_conversao)) {
        const qCom = Number(d.quantidade_comercial || 0);
        const pesoT = Number(d.peso_total || 0);
        const pesoE = Number(d.peso_embalagem || 0);
        const vol = Number(d.volume_total || 0);
        if (d.modo_entrada_conversao === 'PESO_TOTAL' && pesoT > 0) qtd = pesoT;
        else if (d.modo_entrada_conversao === 'PESO_POR_EMBALAGEM' && qCom > 0 && pesoE > 0) qtd = qCom * pesoE;
        else if (d.modo_entrada_conversao === 'VOLUME_TOTAL' && vol > 0) qtd = vol;
        else if (qCom > 0) qtd = qCom;
        if (valorEmb > 0 && qtd > 0) preco = valorEmb / qtd;
        if (!(qtd > 0) || !(valorEmb > 0 || preco > 0)) {
          showToast('Informe quantidades/pesos e valor MCC.', 'warning');
          return;
        }
      } else if (!(qtd > 0) || !(preco >= 0)) {
        showToast('Informe quantidade e preço.', 'warning');
        return;
      }

      const subtotal = valorEmb > 0 ? round2(valorEmb) : round2(qtd * preco);
      const margem = Number(d.margem_lucro || 0);
      const item = {
        produto_id: Number(produto.id),
        produto_nome: produto.nome,
        codigo_barras: produto.codigo_barras || produto.codigo || '',
        unidade: produto.unidade || 'UN',
        ncm: produto.ncm || '',
        quantidade: qtd,
        quantidade_fiscal: qF > 0 || qNf > 0 ? qF : qtd,
        quantidade_nao_fiscal: qNf,
        preco_unitario: round2(preco),
        margem_lucro: margem,
        preco_venda_sugerido: round2(preco * (1 + margem / 100)),
        subtotal,
        data_validade: d.data_validade || null,
        produto_fracionado: Number(produto.vendido_por_peso || 0) === 1 ? 1 : 0,
        vendido_por_peso: Number(produto.vendido_por_peso || 0) === 1 ? 1 : 0,
        peso_total_compra: qtd,
        custo_por_kg: round2(preco),
        custo_unitario_final: round2(preco),
        valor_total_embalagem: valorEmb > 0 ? valorEmb : subtotal,
        atualizar_preco_venda: d.atualizar_preco_venda ? 1 : 0,
        mcc_entrada: usaMcc && (uc || d.modo_entrada_conversao) ? 1 : 0,
        utiliza_conversao_fisica: Number(produto.utiliza_conversao_fisica || 0),
        unidade_comercial: uc || null,
        quantidade_comercial: Number(d.quantidade_comercial || 0) || null,
        modo_entrada_conversao: uc || d.modo_entrada_conversao ? (d.modo_entrada_conversao || null) : null,
        peso_embalagem: d.peso_embalagem ? Number(d.peso_embalagem) : null,
        peso_total: d.peso_total ? Number(d.peso_total) : null,
        volume_total: d.volume_total ? Number(d.volume_total) : null
      };
      state.itens.push(item);
      paintItens(root, state);
      closeBottomSheet();
      resolve(item);
    });
  });
}

export async function renderList(root) {
  root.innerHTML = `
    <div class="cds-quick-grid" style="grid-template-columns:1fr 1fr;margin-bottom:12px">
      <button type="button" class="cds-quick" data-go="central-entradas">Central NF</button>
      <button type="button" class="cds-quick" data-go="compras/nova">Nova compra</button>
    </div>
    ${searchBarHtml('Buscar fornecedor ou NF', 'compras-search')}
    <p class="cds-muted" id="compras-count">Carregando…</p>
    <div id="compras-list">${loadingHtml()}</div>
    ${fabHtml('Nova compra', 'compras/nova')}
  `;
  const list = root.querySelector('#compras-list');
  const count = root.querySelector('#compras-count');

  const load = async (busca = '') => {
    list.innerHTML = loadingHtml();
    try {
      let rows = unwrapList(await window.CDSApi.get('compras'));
      if (busca) {
        const q = busca.toLowerCase();
        rows = rows.filter((c) => JSON.stringify(c).toLowerCase().includes(q));
      }
      count.textContent = countLabel(rows.length, 'compra', 'compras');
      list.innerHTML = rows.length
        ? rows.slice(0, 50).map(cardCompra).join('')
        : emptyHtml('Nenhuma compra');
      bindGo(list);
    } catch (err) {
      list.innerHTML = errorHtml(err.message, err.status);
    }
  };

  bindGo(root);
  root.querySelector('#compras-search')?.addEventListener('input', debounce((e) => load(e.target.value), 280));
  await load();
}

export async function renderNova(root) {
  const state = { itens: [] };

  root.innerHTML = `
    ${backBarHtml('Compras')}
    <h2 class="cds-page-title" style="font-size:1.15rem;margin:8px 0">Nova compra</h2>
    <p class="cds-muted">Multi-item + MCC — mesmo POST /api/compras do Desktop.</p>
    ${formCardHtml('Cabeçalho', [
      fieldHtml({ name: 'fornecedor', label: 'Fornecedor', required: true }),
      fieldHtml({ name: 'fornecedor_cnpj', label: 'CNPJ fornecedor', inputmode: 'numeric' }),
      fieldHtml({ name: 'data_compra', label: 'Data compra', type: 'date', value: new Date().toISOString().slice(0, 10), required: true }),
      fieldHtml({ name: 'data_emissao', label: 'Data emissão', type: 'date', value: new Date().toISOString().slice(0, 10) }),
      fieldHtml({ name: 'data_entrada', label: 'Data entrada', type: 'date', value: new Date().toISOString().slice(0, 10) }),
      fieldHtml({ name: 'numero_nf', label: 'Número NF' }),
      fieldHtml({ name: 'serie_nf', label: 'Série', value: '1' }),
      fieldHtml({ name: 'modelo_nf', label: 'Modelo', value: '55' }),
      fieldHtml({ name: 'chave_acesso', label: 'Chave acesso (44)', inputmode: 'numeric' }),
      fieldHtml({ name: 'valor_desconto', label: 'Desconto', type: 'number', value: 0, inputmode: 'decimal' }),
      fieldHtml({ name: 'valor_frete', label: 'Frete', type: 'number', value: 0, inputmode: 'decimal' }),
      fieldHtml({ name: 'valor_outras_despesas', label: 'Outras despesas', type: 'number', value: 0, inputmode: 'decimal' }),
      fieldHtml({ name: 'valor_total_nota', label: 'Total nota (XML)', type: 'number', value: 0, inputmode: 'decimal' }),
      `<label class="cds-field"><span>Condição pagamento</span>
        <select name="condicao_pagamento" class="cds-field__input">
          <option value="avista">À vista</option>
          <option value="a_prazo">A prazo</option>
          <option value="entrada_parcelado">Entrada + parcelas</option>
        </select>
      </label>`,
      fieldHtml({ name: 'forma_pagamento', label: 'Forma pagamento', value: 'PIX' }),
      fieldHtml({ name: 'parcelas', label: 'Parcelas', type: 'number', value: 1, inputmode: 'numeric' }),
      fieldHtml({ name: 'data_vencimento', label: 'Vencimento', type: 'date' }),
      fieldHtml({ name: 'observacao', label: 'Observação', type: 'textarea' })
    ].join(''))}

    ${sectionTitleHtml('Itens')}
    ${searchBarHtml('Buscar produto / EAN', 'compra-prod-search')}
    <div id="compra-prod-hits"></div>
    <div id="compra-itens" class="cds-list" style="margin-top:8px"></div>

    ${sectionTitleHtml('Conferência')}
    <div id="compra-conferencia"></div>
    <p class="cds-muted">Total a gravar: <strong id="compra-total-display">R$ 0,00</strong></p>

    <div class="cds-action-bar" style="margin-top:12px">
      <button type="button" class="cds-mobile-btn" id="btn-salvar-compra">Salvar compra</button>
      <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" data-nav-back>Cancelar</button>
    </div>
  `;

  bindBack(root);
  paintItens(root, state);

  const refreshConf = () => {
    const nota = Number(root.querySelector('[name="valor_total_nota"]')?.value || 0);
    paintConferencia(root, state.itens, nota);
  };
  ['valor_frete', 'valor_desconto', 'valor_outras_despesas', 'valor_total_nota'].forEach((name) => {
    root.querySelector(`[name="${name}"]`)?.addEventListener('input', refreshConf);
  });

  const hits = root.querySelector('#compra-prod-hits');
  root.querySelector('#compra-prod-search')?.addEventListener('input', debounce(async (e) => {
    const q = e.target.value;
    if (!String(q || '').trim()) {
      hits.innerHTML = '';
      return;
    }
    hits.innerHTML = loadingHtml();
    const products = await buscarProdutos(q);
    if (!products.length) {
      hits.innerHTML = emptyHtml('Nenhum produto');
      return;
    }
    hits.innerHTML = products.slice(0, 12).map((p) => `
      <button type="button" class="cds-list-card" data-pid="${escapeHtml(p.id)}" style="width:100%;text-align:left;margin-bottom:6px">
        <div class="cds-list-card__main">
          <h3 class="cds-list-card__title">${escapeHtml(p.nome)}</h3>
          <p class="cds-list-card__subtitle">${escapeHtml(p.codigo_barras || p.codigo || '')} · ${formatMoney(p.preco_compra || 0)}</p>
        </div>
      </button>
    `).join('');
    hits.querySelectorAll('[data-pid]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.getAttribute('data-pid'));
        const p = products.find((x) => Number(x.id) === id);
        if (!p) return;
        await openAddItemSheet(root, state, p);
        hits.innerHTML = '';
        const search = root.querySelector('#compra-prod-search');
        if (search) search.value = '';
      });
    });
  }, 280));

  root.querySelector('#btn-salvar-compra')?.addEventListener('click', async () => {
    const cab = collectForm(root.querySelector('#cds-form'));
    if (!cab.fornecedor) {
      showToast('Informe o fornecedor.', 'warning');
      return;
    }
    if (!state.itens.length) {
      showToast('Adicione ao menos um item.', 'warning');
      return;
    }
    const chave = String(cab.chave_acesso || '').replace(/\D/g, '');
    if (chave && chave.length !== 44) {
      showToast('Chave de acesso deve ter 44 dígitos.', 'warning');
      return;
    }
    const valorProdutos = round2(state.itens.reduce((s, i) => s + itemSubtotal(i), 0));
    const frete = Number(cab.valor_frete || 0);
    const desconto = Number(cab.valor_desconto || 0);
    const outras = Number(cab.valor_outras_despesas || 0);
    const calculado = round2(valorProdutos - desconto + frete + outras);
    const totalNota = Number(cab.valor_total_nota) > 0 ? round2(cab.valor_total_nota) : calculado;
    const total = totalNota > 0 ? totalNota : calculado;

    const btn = root.querySelector('#btn-salvar-compra');
    if (btn) btn.setAttribute('aria-busy', 'true');
    try {
      const created = await window.CDSApi.post('compras', {
        data_compra: cab.data_compra,
        data_emissao: cab.data_emissao || cab.data_compra,
        data_entrada: cab.data_entrada || cab.data_compra,
        fornecedor: cab.fornecedor,
        fornecedor_cnpj: cab.fornecedor_cnpj || null,
        numero_nf: cab.numero_nf || null,
        serie_nf: cab.serie_nf || null,
        modelo_nf: cab.modelo_nf || '55',
        chave_acesso: chave || null,
        valor_produtos: valorProdutos,
        valor_desconto: desconto,
        valor_frete: frete,
        valor_outras_despesas: outras,
        valor_total_nota: total,
        total,
        itens: state.itens,
        condicao_pagamento: cab.condicao_pagamento || 'avista',
        forma_pagamento: cab.forma_pagamento || null,
        data_vencimento: cab.data_vencimento || null,
        parcelas: Number(cab.parcelas || 1),
        observacao: cab.observacao || null,
        nota_fiscal_avulsa: 0
      });
      showToast('Compra registrada.', 'success');
      window.CDSMobile?.navigate?.(`compras/${created.id || created?.compra_id}`, { replace: true });
    } catch (err) {
      showToast(err?.payload?.error || err.message || 'Falha ao criar compra', 'error');
    } finally {
      if (btn) btn.removeAttribute('aria-busy');
    }
  });
}

export async function renderDetail(root, id) {
  root.innerHTML = loadingHtml();
  try {
    const c = await window.CDSApi.get(`compras/${id}`);
    const itens = Array.isArray(c.itens) ? c.itens : [];
    const fins = Array.isArray(c.financeiro) ? c.financeiro : [];
    const status = String(c.status || c.situacao || '').toUpperCase();
    const cancelada = /CANCEL/.test(status);

    root.innerHTML = `
      ${backBarHtml('Compras')}
      <article class="cds-card">
        <h3 class="cds-card__title">${escapeHtml(asText(c.fornecedor, `Compra #${id}`))}</h3>
        <div class="cds-row"><span>Data</span><strong>${escapeHtml(formatDate(c.data_compra))}</strong></div>
        <div class="cds-row"><span>NF</span><strong>${escapeHtml(asText(c.numero_nf))}</strong></div>
        <div class="cds-row"><span>Total</span><strong>${escapeHtml(formatMoney(c.total ?? 0))}</strong></div>
        <div class="cds-row"><span>Status</span><strong>${escapeHtml(asText(c.status || c.situacao))}</strong></div>
        <div class="cds-row"><span>Chave</span><strong class="cds-mobile-break">${escapeHtml(asText(c.chave_acesso))}</strong></div>
      </article>
      ${sectionTitleHtml(`Itens (${itens.length})`)}
      <div>
        ${itens.length
          ? itens.map((i) => listCardHtml({
              title: asText(i.produto_nome || i.descricao || `Produto ${i.produto_id}`),
              value: formatMoney(i.total ?? i.subtotal ?? 0),
              meta: [
                `Qtd ${i.quantidade}`,
                i.unidade_comercial ? `UC ${i.unidade_comercial}` : '',
                i.modo_entrada_conversao || ''
              ].filter(Boolean)
            })).join('')
          : emptyHtml('Sem itens')}
      </div>
      ${fins.length ? `
        ${sectionTitleHtml('Financeiro gerado')}
        <div>
          ${fins.map((f) => listCardHtml({
            title: asText(f.descricao || `Parcela ${f.numero_parcela || ''}`),
            value: formatMoney(f.valor ?? 0),
            meta: [formatDate(f.vencimento), asText(f.status, '')]
          })).join('')}
        </div>
      ` : ''}
      ${actionBarHtml([
        { action: 'chave', label: 'Alterar chave NF', icon: 'edit', variant: 'secondary' },
        ...(!cancelada ? [{ action: 'devolver', label: 'Devolver', icon: 'share', variant: 'secondary' }] : []),
        ...(!cancelada ? [{ action: 'cancel', label: 'Cancelar compra', icon: 'trash', variant: 'ghost' }] : [])
      ])}
    `;
    bindBack(root);
    root.querySelector('[data-action="chave"]')?.addEventListener('click', async () => {
      const data = await promptSheet({
        title: 'Chave NF-e fornecedor',
        confirmLabel: 'Salvar',
        fieldsHtml: fieldHtml({
          name: 'chave_acesso',
          label: 'Chave (44 dígitos)',
          value: c.chave_acesso || '',
          inputmode: 'numeric'
        })
      });
      if (data == null) return;
      try {
        await window.CDSApi.put(`compras/${id}/chave-nfe-fornecedor`, {
          chave_acesso: data.chave_acesso || ''
        });
        showToast('Chave atualizada.', 'success');
        window.CDSMobile?.navigate?.(`compras/${id}`, { replace: true });
      } catch (err) {
        showToast(err.message || 'Falha ao alterar chave', 'error');
      }
    });
    root.querySelector('[data-action="devolver"]')?.addEventListener('click', async () => {
      const data = await promptSheet({
        title: 'Devolução de compra',
        confirmLabel: 'Devolver',
        fieldsHtml: `
          ${fieldHtml({ name: 'motivo', label: 'Motivo', required: true })}
          <p class="cds-muted">Usa POST /api/compras/:id/devolver (mesmo fluxo Desktop). Emissão NF-e devolução SEFAZ disponível após devolução.</p>
        `
      });
      if (!data?.motivo) return;
      try {
        await window.CDSApi.post(`compras/${id}/devolver`, { motivo: data.motivo });
        showToast('Devolução registrada.', 'success');
        const emitir = await confirmSheet({
          title: 'Emitir NF-e devolução?',
          message: 'Solicitar emissão via SEFAZ (POST emitir-nfe-devolucao)?',
          confirmLabel: 'Emitir'
        });
        if (emitir) {
          await window.CDSApi.post(`compras/${id}/emitir-nfe-devolucao`, {});
          showToast('NF-e devolução solicitada.', 'success');
        }
        window.CDSMobile?.navigate?.(`compras/${id}`, { replace: true });
      } catch (err) {
        showToast(err?.payload?.error || err.message || 'Falha na devolução', 'error');
      }
    });
    root.querySelector('[data-action="cancel"]')?.addEventListener('click', async () => {
      const ok = await confirmSheet({
        title: 'Cancelar compra',
        message: 'Cancelar esta compra via Motor de Compras?',
        confirmLabel: 'Cancelar',
        danger: true
      });
      if (!ok) return;
      try {
        await window.CDSApi.post(`compras/${id}/cancelar`, {});
        showToast('Compra cancelada.', 'success');
        window.CDSMobile?.navigate?.('compras', { replace: true });
      } catch (err) {
        showToast(err.message || 'Falha ao cancelar', 'error');
      }
    });
  } catch (err) {
    root.innerHTML = `${backBarHtml('Compras')}${errorHtml(err.message, err.status)}`;
    bindBack(root);
  }
}

export async function render(root, parsed) {
  const parts = parsed?.parts || [];
  if (parts[1] === 'nova') return renderNova(root);
  if (parts[1]) return renderDetail(root, parts[1]);
  return renderList(root);
}

export default { render, title: 'Compras', subtitle: 'Operações' };
