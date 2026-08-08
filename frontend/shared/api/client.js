/**
 * CDS Platform — cliente HTTP fino sobre as APIs existentes.
 * Sem regras de negócio. Apenas transporte + auth bearer.
 */
(function (global) {
  'use strict';

  function resolveApiBase() {
    if (typeof global.API_URL === 'string' && global.API_URL.trim() !== '') {
      return global.API_URL.replace(/\/$/, '');
    }
    var resolved = global.location.origin + '/api';
    global.API_URL = resolved;
    return resolved;
  }

  function getToken() {
    try {
      var raw = localStorage.getItem('token') || '';
      var t = String(raw).trim();
      if (!t || t === 'null' || t === 'undefined') return '';
      return t;
    } catch (e) {
      return '';
    }
  }

  /**
   * Paridade ERP Desktop (shared/js/core.js isErroSessaoExpirada):
   * backend retorna 403 (não 401) quando JWT é inválido/expirado.
   */
  function isSessionExpiredError(errOrStatus, body, message) {
    var status = typeof errOrStatus === 'object' ? errOrStatus.status : errOrStatus;
    var errBody = typeof errOrStatus === 'object' ? errOrStatus.body : body;
    var errMsg = typeof errOrStatus === 'object' ? errOrStatus.message : message;

    if (status === 401) return true;
    if (status !== 403) return false;

    var parts = [];
    if (errMsg) parts.push(String(errMsg).toLowerCase());
    if (errBody && typeof errBody === 'object') {
      if (typeof errBody.error === 'string') parts.push(errBody.error.toLowerCase());
      else if (errBody.error && typeof errBody.error === 'object') {
        parts.push(String(errBody.error.message || errBody.error.code || '').toLowerCase());
      }
      if (errBody.message) parts.push(String(errBody.message).toLowerCase());
      if (errBody.mensagem) parts.push(String(errBody.mensagem).toLowerCase());
    } else if (typeof errBody === 'string') {
      parts.push(errBody.toLowerCase());
    }

    var combined = parts.join(' ');
    return (
      combined.indexOf('token') >= 0 ||
      combined.indexOf('sessão') >= 0 ||
      combined.indexOf('sessao') >= 0 ||
      combined.indexOf('jwt') >= 0 ||
      combined.indexOf('expirad') >= 0 ||
      combined === 'acesso negado'
    );
  }

  function clearSessionAndRedirectLogin() {
    try {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    } catch (e) { /* ignore */ }
    if (typeof global.location !== 'undefined') {
      global.location.replace('/login?client=mobile');
    }
  }

  function buildUrl(path, query) {
    var base = resolveApiBase();
    var clean = String(path || '').replace(/^\//, '');
    var url = base + '/' + clean;
    if (query && typeof query === 'object') {
      var params = new URLSearchParams();
      Object.keys(query).forEach(function (key) {
        var value = query[key];
        if (value === undefined || value === null || value === '') return;
        params.set(key, String(value));
      });
      var qs = params.toString();
      if (qs) url += (url.indexOf('?') >= 0 ? '&' : '?') + qs;
    }
    return url;
  }

  function parseErrorMessage(res, body) {
    if (body && typeof body === 'object') {
      if (body.error && typeof body.error === 'object') {
        return body.error.message || body.error.code || ('HTTP ' + res.status);
      }
      if (typeof body.error === 'string') return body.error;
      return body.message || body.mensagem || ('HTTP ' + res.status);
    }
    if (typeof body === 'string' && body.trim()) return body;
    return 'HTTP ' + res.status;
  }

  function ApiError(message, status, body) {
    var err = new Error(message || 'Erro na API');
    err.name = 'ApiError';
    err.status = status || 0;
    err.body = body;
    err.isApiError = true;
    return err;
  }

  function platformClientHeaders() {
    var headers = {};
    try {
      if (typeof global.CDSMobileTerminal !== 'undefined' && global.CDSMobileTerminal && typeof global.CDSMobileTerminal.getClientHeaders === 'function') {
        return Object.assign(headers, global.CDSMobileTerminal.getClientHeaders() || {});
      }
    } catch (e) { /* ignore */ }
    try {
      var tid = global.terminalId || (global.__CDS_MOBILE_TERMINAL__ && global.__CDS_MOBILE_TERMINAL__.id);
      if (tid) headers['X-Terminal-Id'] = String(tid);
    } catch (e2) { /* ignore */ }
    try {
      if (String(global.location && global.location.pathname || '').indexOf('/apps/mobile') === 0) {
        headers['X-CDS-Client'] = headers['X-CDS-Client'] || 'mobile';
      } else if (String(global.location && global.location.pathname || '').indexOf('/erp') === 0
        || String(global.CDS_MODULE || '') === 'erp'
        || String(global.CDS_MODULE || '') === 'comercial') {
        headers['X-CDS-Client'] = headers['X-CDS-Client'] || 'desktop';
      }
    } catch (e3) { /* ignore */ }
    return headers;
  }

  async function request(method, path, options) {
    options = options || {};
    var token = getToken();
    var headers = Object.assign(
      {
        Accept: 'application/json'
      },
      platformClientHeaders(),
      options.headers || {}
    );
    if (token) {
      headers.Authorization = 'Bearer ' + token;
    }

    var init = {
      method: method,
      headers: headers,
      credentials: 'same-origin'
    };

    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    }

    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timeoutId = null;
    if (controller) {
      init.signal = controller.signal;
      timeoutId = setTimeout(function () {
        controller.abort();
      }, options.timeoutMs || 25000);
    }

    var res;
    try {
      res = await fetch(buildUrl(path, options.query), init);
    } catch (networkErr) {
      if (timeoutId) clearTimeout(timeoutId);
      if (networkErr && networkErr.name === 'AbortError') {
        throw ApiError('Tempo esgotado. Não foi possível conectar ao servidor.', 408, null);
      }
      var netMsg = String((networkErr && networkErr.message) || '');
      if (/Failed to fetch|NetworkError|ERR_CONNECTION|ECONNREFUSED/i.test(netMsg)) {
        throw ApiError('Servidor CDS não encontrado. Verifique a rede e o endereço do servidor.', 0, null);
      }
      throw ApiError('Não foi possível conectar ao servidor.', 0, null);
    }
    if (timeoutId) clearTimeout(timeoutId);

    var text = await res.text();
    var body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch (e) {
        body = text;
      }
    }

    if (res.status === 401 || isSessionExpiredError(res.status, body, parseErrorMessage(res, body))) {
      clearSessionAndRedirectLogin();
      throw ApiError('Sua sessão expirou. Entre novamente para continuar.', res.status === 401 ? 401 : 403, body);
    }

    if (!res.ok) {
      throw ApiError(parseErrorMessage(res, body), res.status, body);
    }

    return body;
  }

  var api = {
    get: function (path, query, options) {
      return request('GET', path, Object.assign({}, options || {}, { query: query }));
    },
    post: function (path, body, query, options) {
      return request('POST', path, Object.assign({}, options || {}, { body: body, query: query }));
    },
    put: function (path, body, query, options) {
      return request('PUT', path, Object.assign({}, options || {}, { body: body, query: query }));
    },
    patch: function (path, body, query, options) {
      return request('PATCH', path, Object.assign({}, options || {}, { body: body, query: query }));
    },
    del: function (path, query, options) {
      options = options || {};
      return request('DELETE', path, Object.assign({}, options, {
        query: query !== undefined ? query : options.query,
        body: options.body
      }));
    },
    resolveApiBase: resolveApiBase,
    getToken: getToken,
    isSessionExpiredError: isSessionExpiredError,
    clearSessionAndRedirectLogin: clearSessionAndRedirectLogin,
    ApiError: ApiError
  };

  global.CDSApi = api;
})(typeof window !== 'undefined' ? window : this);
