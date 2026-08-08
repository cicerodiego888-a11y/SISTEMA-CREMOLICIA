/**
 * Router — Runtime router do Motor Comercial.
 *
 * Sprint O-1: Integração ERP — navegação SPA dentro do #page-content.
 *
 * @module frontend/modules/motor-comercial/router/Router
 */

const { routes } = require('../routes');
const EmptyState = require('../components/base/EmptyState');
const ErrorState = require('../components/base/ErrorState');
const Loading = require('../components/base/Loading');

class Router {
  /**
   * @param {Object} options
   * @param {Object} options.components - Mapa component -> factory
   * @param {string} [options.mountTarget='#page-content']
   * @param {Function} [options.onLoadingStart]
   * @param {Function} [options.onLoadingStop]
   * @param {Object} [options.emptyPages] - Páginas ERP sem implementação
   */
  constructor(options = {}) {
    this.routes = routes;
    this.components = options.components || {};
    this.mountTarget = options.mountTarget || '#page-content';
    this.onLoadingStart = options.onLoadingStart || (() => {});
    this.onLoadingStop = options.onLoadingStop || (() => {});
    this.emptyPages = options.emptyPages || {};
    this.history = [];
    this.historyIndex = -1;
    this.current = null;
    this._listeners = new Set();
  }

  /**
   * Navega para path ou página ERP.
   * @param {string} target - Path interno ou id ERP
   * @param {Object} [options]
   * @param {Object} [options.params]
   * @param {Object} [options.query]
   * @param {boolean} [options.replace=false]
   * @param {boolean} [options.silent=false]
   */
  async navigate(target, options = {}) {
    const resolved = this._resolveTarget(target, options);
    if (!resolved) {
      return this._mountError('Rota não encontrada', 'A página solicitada não existe no Motor Comercial.');
    }

    const { path, params, query, meta } = resolved;
    const previous = this.current;

    this.onLoadingStart(meta.title || 'Carregando...');

    try {
      const element = await this._createPageElement(meta, params, query);
      this._mount(element);

      const entry = { path, params, query, meta, target };
      if (options.replace && this.historyIndex >= 0) {
        this.history[this.historyIndex] = entry;
      } else if (!options.silent) {
        this.history = this.history.slice(0, this.historyIndex + 1);
        this.history.push(entry);
        this.historyIndex = this.history.length - 1;
      }

      this.current = entry;
      this._notify();
      return element;
    } catch (error) {
      this._mountError(
        'Não foi possível abrir esta tela',
        error && error.message
          ? error.message
          : 'Volte e tente novamente. Se o problema continuar, contate o suporte.',
        () => this.navigate(target, { ...options, replace: true })
      );
      if (previous) {
        this.current = previous;
      }
      return null;
    } finally {
      this.onLoadingStop();
    }
  }

  /**
   * Volta no histórico interno.
   */
  async back() {
    if (this.historyIndex <= 0) return null;
    this.historyIndex -= 1;
    const entry = this.history[this.historyIndex];
    return this._restoreEntry(entry);
  }

  /**
   * Avança no histórico interno.
   */
  async forward() {
    if (this.historyIndex >= this.history.length - 1) return null;
    this.historyIndex += 1;
    const entry = this.history[this.historyIndex];
    return this._restoreEntry(entry);
  }

  /**
   * Recarrega a rota atual.
   */
  async refresh() {
    if (!this.current) return null;
    const entry = this.current;
    return this.navigate(entry.target || entry.path, {
      params: entry.params,
      query: entry.query,
      replace: true
    });
  }

  /**
   * Obtém histórico de navegação.
   * @returns {Array}
   */
  getHistory() {
    return [...this.history];
  }

  /**
   * Inscreve listener de navegação.
   * @param {Function} listener
   * @returns {Function}
   */
  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  /**
   * @private
   */
  _notify() {
    this._listeners.forEach((listener) => listener(this.current));
  }

  /**
   * @private
   */
  _resolveTarget(target, options = {}) {
    if (this.emptyPages[target]) {
      return {
        path: target,
        params: options.params || {},
        query: options.query || {},
        meta: {
          empty: true,
          title: this.emptyPages[target].title,
          description: this.emptyPages[target].description
        }
      };
    }

    let path = target;
    if (target && target.startsWith('comercial-')) {
      const mapped = this.erpRouteMap && this.erpRouteMap[target];
      if (!mapped) return null;
      if (mapped.empty) {
        return {
          path: target,
          params: {},
          query: {},
          meta: mapped
        };
      }
      path = mapped.path;
    }

    const [pathname, search = ''] = String(path).split('?');
    const query = { ...(options.query || {}), ...this._parseQuery(search) };
    const match = this._matchRoute(pathname);

    if (!match) return null;

    return {
      path: pathname,
      params: { ...match.params, ...(options.params || {}) },
      query,
      meta: { ...match.route.meta, component: match.route.component, title: match.route.meta.title }
    };
  }

  /**
   * @private
   */
  _matchRoute(pathname) {
    const normalized = pathname === '' ? '/' : pathname;

    for (const route of this.routes) {
      const paramNames = [];
      const pattern = route.path.replace(/:([^/]+)/g, (_, name) => {
        paramNames.push(name);
        return '([^/]+)';
      });
      const regex = new RegExp(`^${pattern}$`);
      const match = normalized.match(regex);
      if (!match) continue;

      const params = {};
      paramNames.forEach((name, index) => {
        params[name] = decodeURIComponent(match[index + 1]);
      });

      return { route, params };
    }

    return null;
  }

  /**
   * @private
   */
  _parseQuery(search) {
    const query = {};
    if (!search) return query;
    const normalized = search.startsWith('?') ? search.slice(1) : search;
    new URLSearchParams(normalized).forEach((value, key) => {
      query[key] = value;
    });
    return query;
  }

  /**
   * @private
   */
  async _createPageElement(meta, params, query) {
    if (meta.empty) {
      return this._wrapPage(EmptyState.create({
        title: meta.title,
        description: meta.description,
        icon: '<i class="fas fa-tools"></i>'
      }));
    }

    const factory = this.components[meta.component];
    if (!factory) {
      return this._wrapPage(EmptyState.create({
        title: meta.title || meta.component,
        description: 'Esta funcionalidade ainda não possui implementação.',
        icon: '<i class="fas fa-clipboard-list"></i>'
      }));
    }

    const element = await Promise.resolve(factory(params, query));
    if (!(element instanceof HTMLElement)) {
      throw new Error('A página retornou um elemento inválido.');
    }
    return this._wrapPage(element);
  }

  /**
   * @private
   */
  _wrapPage(element) {
    const wrapper = document.createElement('div');
    wrapper.className = 'motor-comercial-page';
    wrapper.appendChild(element);
    return wrapper;
  }

  /**
   * @private
   */
  _mount(element) {
    const target = document.querySelector(this.mountTarget);
    if (!target) {
      throw new Error(`Elemento de montagem não encontrado: ${this.mountTarget}`);
    }
    target.innerHTML = '';
    target.appendChild(element);
  }

  /**
   * @private
   */
  _mountError(title, description, onRetry) {
    const target = document.querySelector(this.mountTarget);
    if (!target) return;
    target.innerHTML = '';
    target.appendChild(this._wrapPage(ErrorState.create({ title, description, onRetry })));
  }

  /**
   * @private
   */
  async _restoreEntry(entry) {
    this.onLoadingStart(entry.meta.title || 'Carregando...');
    try {
      const element = await this._createPageElement(entry.meta, entry.params, entry.query);
      this._mount(element);
      this.current = entry;
      this._notify();
      return element;
    } catch (error) {
      this._mountError(
        'Não foi possível abrir esta tela',
        error && error.message
          ? error.message
          : 'Volte e tente novamente. Se o problema continuar, contate o suporte.',
        () => this.refresh()
      );
      return null;
    } finally {
      this.onLoadingStop();
    }
  }
}

module.exports = Router;
