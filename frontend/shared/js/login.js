const API_URL = (() => {
  if (typeof window.API_URL === 'string' && window.API_URL.trim() !== '') {
    return window.API_URL;
  }

  const resolved = `${window.location.origin}/api`;
  window.API_URL = resolved;
  return resolved;
})();

const LOGIN_CREDENCIAIS_KEY = 'cds-login-credenciais';

function salvarUltimasCredenciaisLogin(username, password) {
  try {
    localStorage.setItem(
      LOGIN_CREDENCIAIS_KEY,
      JSON.stringify({
        username: String(username || ''),
        password: String(password || '')
      })
    );
  } catch (e) { /* ignore quota / private mode */ }
}

function carregarUltimasCredenciaisLogin() {
  try {
    const raw = localStorage.getItem(LOGIN_CREDENCIAIS_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    return {
      username: String(data.username || ''),
      password: String(data.password || '')
    };
  } catch (e) {
    return null;
  }
}

function preencherCredenciaisSalvas() {
  const salvas = carregarUltimasCredenciaisLogin();
  if (!salvas) return;

  if (salvas.username) {
    $('#username').val(salvas.username);
  }
  if (salvas.password) {
    $('#password').val(salvas.password);
  }
}

(function redirectIfLoggedIn() {
  const token = localStorage.getItem('token');
  if (!token) return;

  const user = (() => {
    try {
      return JSON.parse(localStorage.getItem('user') || '{}');
    } catch (e) {
      return {};
    }
  })();

  const destino = typeof obterDestinoPosLogin === 'function'
    ? obterDestinoPosLogin(user)
    : '/erp';

  window.location.replace(destino);
})();

function setLoginLoading(isLoading) {
  const $btn = $('#btn-entrar');
  $btn.prop('disabled', isLoading);
  $btn.toggleClass('is-loading', isLoading);
  $btn.attr('aria-busy', isLoading ? 'true' : 'false');
}

function showLoginError(message) {
  const $err = $('#login-error');
  $err.addClass('is-visible').text(message);
}

function hideLoginError() {
  $('#login-error').removeClass('is-visible').text('');
}

$('#loginForm').on('submit', function(e) {
  e.preventDefault();
  const username = $('#username').val().trim();
  const password = $('#password').val();

  // Sempre lembrar o último usuário e senha digitados (mesmo se o login falhar)
  salvarUltimasCredenciaisLogin(username, password);

  hideLoginError();
  setLoginLoading(true);

  $.ajax({
    url: `${API_URL}/auth/login`,
    method: 'POST',
    contentType: 'application/json',
    data: JSON.stringify({ username, password }),
    success: function(data) {
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      salvarUltimasCredenciaisLogin(username, password);

      const destino = typeof obterDestinoPosLogin === 'function'
        ? obterDestinoPosLogin(data.user)
        : '/erp';

      try {
        console.log('[CDS Mobile BOOT]', 'LOGIN OK');
        console.log('[CDS Mobile BOOT]', 'TOKEN RECEBIDO', data.token ? 'sim' : 'não');
        console.log('[CDS Mobile BOOT]', 'TOKEN SALVO');
        console.log('[CDS Mobile BOOT]', 'REDIRECIONANDO', destino);
      } catch (e) { /* ignore */ }

      window.location.replace(destino);
    },
    error: function(xhr) {
      const msg = xhr.responseJSON && xhr.responseJSON.error
        ? xhr.responseJSON.error
        : 'Não foi possível entrar. Verifique o servidor.';
      showLoginError(msg);
    },
    complete: function() {
      setLoginLoading(false);
    }
  });
});

$(document).ready(function() {
  $('.modal-backdrop').remove();
  $('body').removeClass('modal-open').css('overflow', '').css('padding-right', '');
  document.body.classList.remove('pdv-mode', 'menu-open');
  $('*').css('pointer-events', '');
  $('body, html').css('pointer-events', 'auto');

  preencherCredenciaisSalvas();

  const campoUsername = $('#username');
  const campoPassword = $('#password');
  if (campoUsername.length > 0 && campoUsername.val()) {
    // Já tem usuário salvo: foca na senha (ou no botão se a senha também veio preenchida)
    if (campoPassword.length > 0 && !campoPassword.val()) {
      campoPassword[0].focus();
    } else if (campoPassword.length > 0 && campoPassword.val()) {
      $('#btn-entrar').trigger('focus');
    }
  } else if (campoUsername.length > 0 && !campoPassword.is(':focus')) {
    campoUsername[0].focus();
  }

  setTimeout(() => {
    if (window.electronAPI && window.electronAPI.forcarReflow) {
      window.electronAPI.forcarReflow();
    }
  }, 100);
});
