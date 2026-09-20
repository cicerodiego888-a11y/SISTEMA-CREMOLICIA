/**
 * API Client — HTTP Client for Motor Comercial API
 *
 * Sprint 2.7: Arquitetura Frontend — cliente HTTP.
 *
 * @module frontend/modules/motor-comercial/api/client
 */

const { extractErrorMessage } = require('./helpers');

function buildQueryString(params = {}) {
  const entries = Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (!entries.length) return '';
  return new URLSearchParams(Object.fromEntries(entries)).toString();
}

class ApiClient {
  constructor(options = {}) {
    const globalBase = (typeof window !== 'undefined' && window.MOTOR_COMERCIAL_API_BASE)
      ? window.MOTOR_COMERCIAL_API_BASE
      : null;
    this.baseURL = options.baseURL || globalBase || 'http://localhost:3000/api/comercial';
    this.timeout = options.timeout || 30000;
    this.defaultHeaders = options.defaultHeaders || {
      'Content-Type': 'application/json'
    };
  }

  /**
   * Performs GET request.
   * @param {string} endpoint - API endpoint
   * @param {Object} [options] - Request options
   * @returns {Promise}
   */
  async get(endpoint, options = {}) {
    return this._request('GET', endpoint, null, options);
  }

  /**
   * Performs POST request.
   * @param {string} endpoint - API endpoint
   * @param {Object} data - Request body
   * @param {Object} [options] - Request options
   * @returns {Promise}
   */
  async post(endpoint, data, options = {}) {
    return this._request('POST', endpoint, data, options);
  }

  /**
   * Performs PUT request.
   * @param {string} endpoint - API endpoint
   * @param {Object} data - Request body
   * @param {Object} [options] - Request options
   * @returns {Promise}
   */
  async put(endpoint, data, options = {}) {
    return this._request('PUT', endpoint, data, options);
  }

  /**
   * Performs PATCH request.
   * @param {string} endpoint - API endpoint
   * @param {Object} data - Request body
   * @param {Object} [options] - Request options
   * @returns {Promise}
   */
  async patch(endpoint, data, options = {}) {
    return this._request('PATCH', endpoint, data, options);
  }

  /**
   * Performs DELETE request.
   * @param {string} endpoint - API endpoint
   * @param {Object} [options] - Request options
   * @returns {Promise}
   */
  async delete(endpoint, data = null, options = {}) {
    return this._request('DELETE', endpoint, data, options);
  }

  /**
   * Performs HTTP request.
   * @private
   */
  async _request(method, endpoint, data, options = {}) {
    let url = `${this.baseURL}${endpoint}`;
    const headers = {
      ...this.defaultHeaders,
      ...options.headers
    };

    if (!headers.Authorization && typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      const token = localStorage.getItem('token');
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
    }

    const timeoutMs = options.timeout || this.timeout;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;

    const config = {
      method,
      headers
    };
    if (controller) {
      config.signal = controller.signal;
    }

    if (data && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      config.body = JSON.stringify(data);
    }

    if (options.params) {
      const queryString = buildQueryString(options.params);
      if (queryString) url = `${url}?${queryString}`;
    }

    try {
      const response = await fetch(url, config);

      if (!response.ok) {
        let errorBody = null;
        try {
          errorBody = await response.json();
        } catch (_parseError) {
          const httpErr = new Error(`HTTP ${response.status}`);
          httpErr.status = response.status;
          throw httpErr;
        }
        const err = new Error(extractErrorMessage(errorBody));
        err.status = response.status;
        err.body = errorBody;
        throw err;
      }

      return await response.json();
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error(`Tempo esgotado ao chamar ${method} ${endpoint} (${timeoutMs}ms)`);
      }
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Sets base URL.
   * @param {string} baseURL - Base URL
   */
  setBaseURL(baseURL) {
    this.baseURL = baseURL;
  }

  /**
   * Sets default header.
   * @param {string} key - Header key
   * @param {string} value - Header value
   */
  setDefaultHeader(key, value) {
    this.defaultHeaders[key] = value;
  }

  /**
   * Sets authorization token.
   * @param {string} token - Auth token
   */
  setAuthToken(token) {
    this.setDefaultHeader('Authorization', `Bearer ${token}`);
  }
}

module.exports = ApiClient;
