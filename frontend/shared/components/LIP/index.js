/**
 * LIP — Localizador Inteligente de Produtos
 *
 * Componente corporativo CDS Sistemas (Sprint S-6.2)
 *
 * @module frontend/shared/components/LIP
 */

const LipSearchService = require('./LipSearchService');
const { readRecent, saveRecent, DEFAULT_KEY } = require('./lipHistory');
const {
  highlightTerm,
  groupLipProducts,
  formatCurrency,
  normalizeLipProduct,
  filterActiveLipProducts
} = require('./lipMappers');

const STYLE_ID = 'cds-lip-styles';

const DEFAULT_CSS = `
.cds-lip { position: relative; width: 100%; font-family: inherit; }
.cds-lip__input-wrap { position: relative; }
.cds-lip__input {
  width: 100%; padding: 12px 16px 12px 40px; font-size: 15px;
  border: 2px solid var(--color-border, #e2e8f0); border-radius: 10px;
  background: var(--color-surface, #fff); transition: border-color .15s, box-shadow .15s;
}
.cds-lip__input:focus {
  outline: none; border-color: var(--color-primary, #2563eb);
  box-shadow: 0 0 0 3px rgba(37,99,235,.15);
}
.cds-lip__icon {
  position: absolute; left: 14px; top: 50%; transform: translateY(-50%);
  font-size: 16px; opacity: .55; pointer-events: none;
}
.cds-lip__panel {
  margin-top: 8px; max-height: 420px; overflow-y: auto;
  border: 1px solid var(--color-border, #e2e8f0); border-radius: 10px;
  background: var(--color-surface, #fff); box-shadow: 0 8px 24px rgba(15,23,42,.08);
}
.cds-lip__state {
  padding: 20px; text-align: center; color: var(--color-neutral-600, #64748b); font-size: 14px;
}
.cds-lip__state--error { color: var(--color-error, #dc2626); }
.cds-lip__section-title {
  padding: 10px 14px 6px; font-size: 11px; font-weight: 700;
  text-transform: uppercase; letter-spacing: .06em; color: var(--color-neutral-500, #94a3b8);
  background: var(--color-neutral-50, #f8fafc); border-bottom: 1px solid var(--color-border, #e2e8f0);
  position: sticky; top: 0; z-index: 1;
}
.cds-lip__subgroup-title {
  padding: 6px 14px 4px 20px; font-size: 12px; font-weight: 600;
  color: var(--color-neutral-600, #64748b);
}
.cds-lip__item {
  display: grid; grid-template-columns: 1fr auto; gap: 12px;
  padding: 12px 14px; border-bottom: 1px solid var(--color-border, #f1f5f9);
  cursor: pointer; transition: background .12s;
}
.cds-lip__item:hover, .cds-lip__item--active { background: var(--color-primary-50, #eff6ff); }
.cds-lip__item-name { font-size: 14px; font-weight: 600; color: var(--color-neutral-900, #0f172a); margin-bottom: 6px; }
.cds-lip__item-meta { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 4px 12px; font-size: 12px; color: var(--color-neutral-600, #64748b); }
.cds-lip__item-meta strong { color: var(--color-neutral-700, #334155); font-weight: 600; }
.cds-lip__item-actions { display: flex; flex-direction: column; align-items: flex-end; justify-content: center; gap: 6px; }
.cds-lip__price { font-size: 15px; font-weight: 700; color: var(--color-primary, #2563eb); white-space: nowrap; }
.cds-lip__btn-add {
  padding: 6px 12px; font-size: 12px; font-weight: 600; border: none; border-radius: 6px;
  background: var(--color-primary, #2563eb); color: #fff; cursor: pointer;
}
.cds-lip__btn-add:hover { filter: brightness(1.05); }
.cds-lip__history { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 14px; }
.cds-lip__chip {
  padding: 6px 10px; font-size: 12px; border-radius: 999px;
  border: 1px solid var(--color-border, #e2e8f0); background: #fff; cursor: pointer;
}
.cds-lip__chip:hover { border-color: var(--color-primary, #2563eb); color: var(--color-primary, #2563eb); }
.cds-lip__qty-bar {
  margin-top: 10px; padding: 12px 14px; border-radius: 10px;
  border: 1px solid var(--color-primary-200, #bfdbfe); background: var(--color-primary-50, #eff6ff);
  display: grid; grid-template-columns: 1fr auto auto auto; gap: 12px; align-items: center;
}
.cds-lip__qty-bar label { font-size: 12px; color: var(--color-neutral-600, #64748b); }
.cds-lip__qty-input {
  width: 72px; padding: 6px 8px; border: 1px solid var(--color-border, #cbd5e1); border-radius: 6px; text-align: center;
}
.lip-highlight { background: #fef08a; color: inherit; border-radius: 2px; padding: 0 1px; }
.cds-lip__warn-limit {
  grid-column: 1 / -1; margin-top: 4px; padding: 8px 10px; font-size: 12px; line-height: 1.4;
  color: #9a3412; background: #fff7ed; border: 1px solid #fdba74; border-radius: 8px;
}
.cds-lip__qty-bar--stacked { grid-template-columns: 1fr; gap: 8px; }
.cds-lip__load-more {
  display: block; width: 100%; padding: 10px; border: none; border-top: 1px solid var(--color-border, #e2e8f0);
  background: var(--color-neutral-50, #f8fafc); color: var(--color-primary, #2563eb);
  font-weight: 600; cursor: pointer;
}
`;

function injectStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = DEFAULT_CSS;
  document.head.appendChild(style);
}

class LIP {
  /**
   * @param {Object} options
   * @param {Function} options.onSelect - (produto, quantidade) => void
   * @param {Function} [options.onPreview] - (produto|null, quantidade) => void
   * @param {Function} [options.onLimitWarning] - (ultrapassa: boolean) => void
   * @param {number} [options.minChars=2]
   * @param {number} [options.debounceMs=280]
   * @param {boolean} [options.showHistory=true]
   * @param {boolean} [options.showFrequentes=true]
   * @param {string} [options.placeholder]
   * @param {string} [options.historyKey]
   */
  constructor(options = {}) {
    this.options = {
      minChars: 2,
      debounceMs: 280,
      showHistory: true,
      showFrequentes: true,
      placeholder: 'Pesquisar por nome, código, código de barras ou referência...',
      historyKey: DEFAULT_KEY,
      defaultQuantity: 1,
      ...options
    };
    this.searchService = new LipSearchService(options.searchServiceOptions || {});
    this.root = null;
    this.input = null;
    this.panel = null;
    this.qtyBar = null;
    this.qtyInput = null;
    this.debounceTimer = null;
    this.results = [];
    this.flatResults = [];
    this.activeIndex = -1;
    this.term = '';
    this.offset = 0;
    this.hasMore = false;
    this.state = 'idle';
    this.pendingProduct = null;
    this.warnLimitEl = null;
    this.destroyed = false;
  }

  /**
   * Monta o LIP em um container.
   * @param {HTMLElement} host
   * @returns {HTMLElement}
   */
  mount(host) {
    injectStyles();
    this.root = document.createElement('div');
    this.root.className = 'cds-lip';

    const inputWrap = document.createElement('div');
    inputWrap.className = 'cds-lip__input-wrap';

    const icon = document.createElement('span');
    icon.className = 'cds-lip__icon';
    icon.textContent = '🔍';
    inputWrap.appendChild(icon);

    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.className = 'cds-lip__input';
    this.input.placeholder = this.options.placeholder;
    this.input.autocomplete = 'off';
    this.input.setAttribute('aria-label', 'Localizador Inteligente de Produtos');
    inputWrap.appendChild(this.input);

    this.root.appendChild(inputWrap);

    this.panel = document.createElement('div');
    this.panel.className = 'cds-lip__panel';
    this.panel.hidden = true;
    this.root.appendChild(this.panel);

    this.qtyBar = document.createElement('div');
    this.qtyBar.className = 'cds-lip__qty-bar';
    this.qtyBar.hidden = true;
    this.root.appendChild(this.qtyBar);

    this._bindEvents();
    host.appendChild(this.root);

    if (this.options.showHistory || this.options.showFrequentes) {
      this._renderIdlePanel();
    }

    setTimeout(() => this.input?.focus(), 0);
    return this.root;
  }

  _bindEvents() {
    this.input.addEventListener('input', () => this._onInput());
    this.input.addEventListener('keydown', (e) => this._onKeyDown(e));
    this.input.addEventListener('focus', () => {
      if (!this.term && this.panel.hidden) this._renderIdlePanel();
      else if (this.flatResults.length) this.panel.hidden = false;
    });
  }

  _onInput() {
    this.term = this.input.value.trim();
    clearTimeout(this.debounceTimer);

    if (this.term.length < this.options.minChars) {
      this.offset = 0;
      this.results = [];
      this.flatResults = [];
      this.activeIndex = -1;
      if (this.term.length === 0) this._renderIdlePanel();
      else {
        this.panel.hidden = false;
        this._renderState('Digite pelo menos ' + this.options.minChars + ' caracteres...');
      }
      return;
    }

    this.debounceTimer = setTimeout(() => this._runSearch(0), this.options.debounceMs);
  }

  async _runSearch(offset = 0) {
    const term = this.term;
    this.state = 'loading';
    if (offset === 0) {
      this.activeIndex = -1;
      this._renderState('Carregando...');
      this.panel.hidden = false;
    }

    try {
      const data = await this.searchService.search(term, { offset });
      if (this.destroyed || term !== this.term) return;

      if (offset === 0) {
        this.results = data.items;
      } else {
        this.results = [...this.results, ...data.items];
      }
      this.offset = offset;
      this.hasMore = data.hasMore;
      this.state = 'ready';

      if (!this.results.length) {
        this._renderState('Nenhum produto encontrado.');
        return;
      }

      this._renderResults();
    } catch (error) {
      if (this.destroyed || term !== this.term) return;
      this.state = 'error';
      this._renderState(error.message || 'Erro na pesquisa.', true);
    }
  }

  async _renderIdlePanel() {
    this.panel.hidden = false;
    this.panel.innerHTML = '';

    if (this.options.showHistory) {
      const recent = filterActiveLipProducts(
        readRecent(this.options.historyKey).map(normalizeLipProduct)
      );
      if (recent.length) {
        this.panel.appendChild(this._sectionTitle('Últimos produtos utilizados'));
        const chips = document.createElement('div');
        chips.className = 'cds-lip__history';
        recent.forEach((product) => {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'cds-lip__chip';
          chip.textContent = product.nome;
          chip.addEventListener('click', () => this._selectProduct(product));
          chips.appendChild(chip);
        });
        this.panel.appendChild(chips);
      }
    }

    if (this.options.showFrequentes) {
      try {
        const data = await this.searchService.search('', { frequentes: true });
        if (this.destroyed || this.term) return;
        if (data.items?.length) {
          this.panel.appendChild(this._sectionTitle('Produtos mais utilizados'));
          this.results = data.items;
          this._renderResults();
        }
      } catch (_error) {
        // silencioso
      }
    }

    if (!this.panel.childElementCount) {
      this._renderState('Pesquisar...');
    }
  }

  _sectionTitle(text) {
    const el = document.createElement('div');
    el.className = 'cds-lip__section-title';
    el.textContent = text;
    return el;
  }

  _renderState(message, isError = false) {
    this.panel.hidden = false;
    this.panel.innerHTML = '';
    const state = document.createElement('div');
    state.className = 'cds-lip__state' + (isError ? ' cds-lip__state--error' : '');
    state.textContent = message;
    this.panel.appendChild(state);
    this.flatResults = [];
  }

  _renderResults() {
    this.panel.innerHTML = '';
    this.flatResults = [];
    const groups = groupLipProducts(this.results);

    groups.forEach((group) => {
      this.panel.appendChild(this._sectionTitle(group.label));
      group.subgroups.forEach((sub) => {
        if (group.subgroups.length > 1) {
          const subTitle = document.createElement('div');
          subTitle.className = 'cds-lip__subgroup-title';
          subTitle.textContent = sub.label;
          this.panel.appendChild(subTitle);
        }
        sub.items.forEach((product) => {
          const index = this.flatResults.length;
          this.flatResults.push(product);
          this.panel.appendChild(this._renderItem(product, index));
        });
      });
    });

    if (this.hasMore) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'cds-lip__load-more';
      more.textContent = 'Carregar mais resultados...';
      more.addEventListener('click', () => this._runSearch(this.offset + this.searchService.pageSize));
      this.panel.appendChild(more);
    }

    this._syncActiveItem();
  }

  _renderItem(product, index) {
    const row = document.createElement('div');
    row.className = 'cds-lip__item';
    row.dataset.index = String(index);
    if (index === this.activeIndex) row.classList.add('cds-lip__item--active');

    const main = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'cds-lip__item-name';
    name.innerHTML = '💡 ' + highlightTerm(product.nome, this.term);
    main.appendChild(name);

    const meta = document.createElement('div');
    meta.className = 'cds-lip__item-meta';
    meta.innerHTML = `
      <span><strong>Código:</strong> ${highlightTerm(product.codigo || '-', this.term)}</span>
      <span><strong>Categoria:</strong> ${product.categoria || '-'}</span>
      <span><strong>Marca:</strong> ${product.marca || '-'}</span>
      <span><strong>Estoque:</strong> ${product.estoque}</span>
    `;
    main.appendChild(meta);
    row.appendChild(main);

    const actions = document.createElement('div');
    actions.className = 'cds-lip__item-actions';
    const price = document.createElement('div');
    price.className = 'cds-lip__price';
    price.textContent = formatCurrency(product.preco);
    actions.appendChild(price);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cds-lip__btn-add';
    btn.textContent = this.options.addButtonLabel || 'Adicionar';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._selectProduct(product);
    });
    actions.appendChild(btn);
    row.appendChild(actions);

    row.addEventListener('click', () => {
      this.activeIndex = index;
      this._syncActiveItem();
    });
    row.addEventListener('dblclick', () => this._selectProduct(product));

    return row;
  }

  _syncActiveItem() {
    this.panel.querySelectorAll('.cds-lip__item').forEach((el) => {
      const idx = Number(el.dataset.index);
      el.classList.toggle('cds-lip__item--active', idx === this.activeIndex);
      if (idx === this.activeIndex) el.scrollIntoView({ block: 'nearest' });
    });
  }

  _onKeyDown(event) {
    if (event.key === 'Escape') {
      this.panel.hidden = true;
      this._hideQtyBar();
      return;
    }

    if (event.key === 'Tab') {
      this.panel.hidden = true;
      return;
    }

    if (!this.flatResults.length) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.activeIndex = Math.min(this.activeIndex + 1, this.flatResults.length - 1);
      this._syncActiveItem();
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.activeIndex = Math.max(this.activeIndex - 1, 0);
      this._syncActiveItem();
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      if (this.qtyBar && !this.qtyBar.hidden) {
        this._confirmQuantity();
        return;
      }
      const product = this.flatResults[this.activeIndex >= 0 ? this.activeIndex : 0];
      if (product) this._selectProduct(product);
    }
  }

  _selectProduct(product) {
    if (!product) return;
    this.pendingProduct = product;
    this._showQtyBar(product);
  }

  _showQtyBar(product) {
    this.qtyBar.hidden = false;
    this.qtyBar.className = 'cds-lip__qty-bar cds-lip__qty-bar--stacked';
    this.qtyBar.innerHTML = '';

    const info = document.createElement('div');
    info.innerHTML = `<strong>${product.nome}</strong><br><label>Preço: ${formatCurrency(product.preco)}</label>`;
    this.qtyBar.appendChild(info);

    const row = document.createElement('div');
    row.style.display = 'grid';
    row.style.gridTemplateColumns = '1fr auto auto auto';
    row.style.gap = '12px';
    row.style.alignItems = 'center';

    const qtyWrap = document.createElement('div');
    qtyWrap.innerHTML = '<label>Qtd</label>';
    this.qtyInput = document.createElement('input');
    this.qtyInput.type = 'number';
    this.qtyInput.min = '1';
    this.qtyInput.step = '1';
    this.qtyInput.value = String(this.options.defaultQuantity || 1);
    this.qtyInput.className = 'cds-lip__qty-input';
    this.qtyInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this._confirmQuantity();
      }
    });
    qtyWrap.appendChild(this.qtyInput);
    row.appendChild(qtyWrap);

    const subtotal = document.createElement('div');
    subtotal.className = 'cds-lip__price';
    const updateSub = () => {
      const q = Math.max(1, Number(this.qtyInput.value) || 1);
      subtotal.textContent = formatCurrency(q * product.preco);
      this._notifyPreview();
    };
    this.qtyInput.addEventListener('input', updateSub);
    row.appendChild(subtotal);

    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'cds-lip__btn-add';
    confirm.textContent = 'Adicionar';
    confirm.addEventListener('click', () => this._confirmQuantity());
    row.appendChild(confirm);

    this.qtyBar.appendChild(row);

    this.warnLimitEl = document.createElement('div');
    this.warnLimitEl.className = 'cds-lip__warn-limit';
    this.warnLimitEl.hidden = true;
    this.warnLimitEl.textContent = 'Esta inclusão fará a entrega ultrapassar o limite comercial.';
    this.qtyBar.appendChild(this.warnLimitEl);

    updateSub();
    this._notifyPreview();
    this.qtyInput.focus();
    this.qtyInput.select();
  }

  _notifyPreview() {
    if (typeof this.options.onPreview !== 'function') return;
    if (!this.pendingProduct) {
      this.options.onPreview(null, 0);
      return;
    }
    const quantidade = Math.max(1, Number(this.qtyInput?.value) || 1);
    this.options.onPreview(this.pendingProduct, quantidade);
  }

  setInclusionWarning(visible) {
    if (this.warnLimitEl) this.warnLimitEl.hidden = !visible;
  }

  _hideQtyBar() {
    if (this.qtyBar) this.qtyBar.hidden = true;
    this.pendingProduct = null;
    this.qtyInput = null;
    this.warnLimitEl = null;
    if (typeof this.options.onPreview === 'function') {
      this.options.onPreview(null, 0);
    }
  }

  _confirmQuantity() {
    const product = this.pendingProduct;
    if (!product) return;
    const quantidade = Math.max(1, Number(this.qtyInput?.value) || 1);

    saveRecent(product, this.options.historyKey);
    if (typeof this.options.onSelect === 'function') {
      this.options.onSelect(product, quantidade);
    }

    this._hideQtyBar();
    this.input.value = '';
    this.term = '';
    this.results = [];
    this.flatResults = [];
    this.activeIndex = -1;
    this._renderIdlePanel();
    this.input.focus();
  }

  focus() {
    this.input?.focus();
  }

  destroy() {
    this.destroyed = true;
    clearTimeout(this.debounceTimer);
    this.root?.remove();
    this.root = null;
  }

  static create(options = {}) {
    const lip = new LIP(options);
    return lip;
  }
}

module.exports = LIP;
