/**
 * RCM-04.B — Diagnóstico da Instância (Ajuda).
 */

let _ultimoDiagnostico = null;

function escapeHtmlDiag(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setDiagField(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  if (id === 'diag-instanceId' || id === 'diag-databaseHash') {
    el.innerHTML = `<code>${escapeHtmlDiag(value || '—')}</code>`;
    return;
  }
  el.textContent = value == null || value === '' ? '—' : String(value);
}

async function carregarDiagnosticoInstancia() {
  const status = document.getElementById('diag-status');
  const apiUrl = (typeof API_URL === 'string' && API_URL.trim() !== '')
    ? API_URL
    : `${window.location.origin}/api`;

  if (status) {
    status.className = 'alert alert-secondary';
    status.textContent = 'Carregando diagnóstico…';
  }

  try {
    const resp = await fetch(`${apiUrl}/sistema/diagnostico?_t=${Date.now()}`, {
      headers: {
        Authorization: 'Bearer ' + (localStorage.getItem('token') || ''),
        'X-CDS-Client': 'desktop',
        Accept: 'application/json'
      },
      cache: 'no-store'
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(body.error || body.message || `HTTP ${resp.status}`);
    }

    const d = body.data || body;
    _ultimoDiagnostico = d;

    setDiagField('diag-apiUrl', d.apiUrl);
    setDiagField('diag-dbPath', d.dbPath);
    setDiagField('diag-databaseHash', d.databaseHash);
    setDiagField('diag-instanceId', d.instanceId);
    setDiagField('diag-versaoSistema', d.versaoSistema);
    setDiagField('diag-versaoBanco', d.versaoBanco);
    setDiagField('diag-hostname', d.hostname);
    setDiagField('diag-ambiente', d.ambiente);
    setDiagField('diag-processId', d.processId ?? d.pid);
    setDiagField('diag-uptime', d.uptime);
    setDiagField('diag-startedAt', d.startedAt);
    setDiagField('diag-timestamp', d.timestampServidor);

    const jsonEl = document.getElementById('diag-json');
    if (jsonEl) {
      jsonEl.style.display = 'block';
      jsonEl.textContent = JSON.stringify(d, null, 2);
    }

    if (status) {
      status.className = 'alert alert-success';
      status.textContent = 'Instância carregada. Compare InstanceId, Database Hash e dbPath com o CDS Mobile.';
    }
  } catch (err) {
    console.error('Diagnóstico:', err);
    if (status) {
      status.className = 'alert alert-danger';
      status.textContent = err.message || 'Falha ao carregar diagnóstico';
    }
    if (typeof showNotification === 'function') {
      showNotification(err.message || 'Erro no diagnóstico', 'danger');
    }
  }
}

async function copiarDiagnosticoInstancia() {
  const payload = _ultimoDiagnostico
    ? JSON.stringify(_ultimoDiagnostico, null, 2)
    : (document.getElementById('diag-json')?.textContent || '');
  if (!payload) {
    if (typeof showNotification === 'function') {
      showNotification('Nenhum diagnóstico para copiar.', 'warning');
    }
    return;
  }
  try {
    await navigator.clipboard.writeText(payload);
    if (typeof showNotification === 'function') {
      showNotification('Diagnóstico copiado para a área de transferência.', 'success');
    }
  } catch (_e) {
    const ta = document.createElement('textarea');
    ta.value = payload;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    if (typeof showNotification === 'function') {
      showNotification('Diagnóstico copiado.', 'success');
    }
  }
}

function inicializarPaginaDiagnosticoInstancia() {
  document.getElementById('diag-atualizar')?.addEventListener('click', () => {
    carregarDiagnosticoInstancia();
  });
  document.getElementById('diag-copiar')?.addEventListener('click', () => {
    copiarDiagnosticoInstancia();
  });
  carregarDiagnosticoInstancia();
}

window.inicializarPaginaDiagnosticoInstancia = inicializarPaginaDiagnosticoInstancia;
window.carregarDiagnosticoInstancia = carregarDiagnosticoInstancia;
