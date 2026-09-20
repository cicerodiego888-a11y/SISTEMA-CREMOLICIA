/**
 * LIP — serviço de busca com debounce, cache e paginação
 *
 * @module frontend/shared/components/LIP/LipSearchService
 */

const { normalizeLipProduct, filterActiveLipProducts } = require('./lipMappers');

const CACHE_TTL_MS = 60000;

class LipSearchService {
  /**
   * @param {Object} options
   * @param {Function} [options.getApiUrl]
   * @param {Function} [options.getToken]
   * @param {number} [options.pageSize=20]
   */
  constructor(options = {}) {
    this.getApiUrl = options.getApiUrl || (() => {
      if (typeof window !== 'undefined' && window.API_URL) return window.API_URL;
      return `${window?.location?.origin || ''}/api`;
    });
    this.getToken = options.getToken || (() => {
      if (typeof localStorage === 'undefined') return null;
      return localStorage.getItem('token');
    });
    this.pageSize = options.pageSize || 20;
    this.cache = new Map();
    this.inflight = new Map();
    this.requestId = 0;
  }

  _cacheKey(term, offset, frequentes) {
    return `${frequentes ? 'freq' : 'q'}:${term}:${offset}`;
  }

  _getCached(key) {
    const hit = this.cache.get(key);
    if (!hit) return null;
    if (Date.now() - hit.ts > CACHE_TTL_MS) {
      this.cache.delete(key);
      return null;
    }
    return hit.data;
  }

  _setCache(key, data) {
    this.cache.set(key, { ts: Date.now(), data });
    if (this.cache.size > 80) {
      const first = this.cache.keys().next().value;
      this.cache.delete(first);
    }
  }

  /**
   * @param {string} term
   * @param {Object} [opts]
   * @returns {Promise<{ items: Array, hasMore: boolean }>}
   */
  async search(term = '', opts = {}) {
    const offset = Number(opts.offset || 0);
    const frequentes = Boolean(opts.frequentes);
    const q = String(term || '').trim();
    const cacheKey = this._cacheKey(q, offset, frequentes);
    const cached = this._getCached(cacheKey);
    if (cached) return cached;

    if (this.inflight.has(cacheKey)) {
      return this.inflight.get(cacheKey);
    }

    const reqId = ++this.requestId;
    const promise = this._fetch(q, offset, frequentes).then((data) => {
      if (reqId === this.requestId || offset > 0) {
        this._setCache(cacheKey, data);
      }
      this.inflight.delete(cacheKey);
      return data;
    }).catch((error) => {
      this.inflight.delete(cacheKey);
      throw error;
    });

    this.inflight.set(cacheKey, promise);
    return promise;
  }

  async _fetch(term, offset, frequentes) {
    const base = this.getApiUrl().replace(/\/$/, '');
    const params = new URLSearchParams();
    if (frequentes) {
      params.set('frequentes', '1');
    } else if (term) {
      params.set('q', term);
    }
    params.set('offset', String(offset));
    params.set('limite', String(this.pageSize));

    const headers = { 'Content-Type': 'application/json' };
    const token = this.getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(`${base}/produtos/search?${params}`, { headers });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.error || body.message || `HTTP ${response.status}`);
    }

    const items = filterActiveLipProducts(
      (body.items || body || []).map(normalizeLipProduct)
    );
    return {
      items,
      hasMore: Boolean(body.hasMore),
      total: body.total ?? items.length
    };
  }

  invalidate() {
    this.cache.clear();
    this.requestId += 1;
  }
}

module.exports = LipSearchService;
