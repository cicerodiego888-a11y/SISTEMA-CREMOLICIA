/**
 * CDS Mobile RC2.1 — Fluxo Configurações
 */
import { escapeHtml, errorHtml, sectionTitleHtml, asText, loadingHtml, bindGo, backBarHtml, bindBack } from '../ui.js';
import { showToast } from '../toast.js';
import { fieldHtml, formCardHtml, collectForm, confirmSheet } from '../forms.js';
import { isAdmin } from '../permissions.js';
import {
  CDS_MOBILE_VERSION_LABEL,
  CDS_MOBILE_VERSION,
  CDS_MOBILE_BUILD,
  CDS_MOBILE_STATUS
} from '../version.js';
import {
  getStoredTerminal,
  getClientMeta,
  isTerminalRegistered,
  startHeartbeat,
  disconnectTerminal
} from '../terminal.js';

const THEMES = [
  { id: 'classic', label: 'Claro' },
  { id: 'dark', label: 'Escuro' },
  { id: 'high-contrast', label: 'Alto contraste' }
];

function applyTheme(theme) {
  const next = THEMES.some((t) => t.id === theme) ? theme : 'classic';
  document.documentElement.setAttribute('data-theme', next);
  THEMES.forEach((t) => {
    document.documentElement.classList.toggle('theme-' + t.id, t.id === next);
  });
  try {
    localStorage.setItem('cds-ui-theme', next);
  } catch (e) { /* ignore */ }
  return next;
}

function readUser() {
  try {
    return JSON.parse(localStorage.getItem('user') || '{}') || {};
  } catch (e) {
    return {};
  }
}

function onlineLabel() {
  return navigator.onLine ? 'Online' : 'Offline';
}

async function runDiagnostico() {
  const lines = [];
  lines.push(`Conexão: ${onlineLabel()}`);
  lines.push(`API: ${window.CDSApi?.resolveApiBase?.() || '/api'}`);
  lines.push(`Terminal: ${isTerminalRegistered() ? 'registrado' : 'não registrado'}`);
  lines.push(`Service Worker: ${('serviceWorker' in navigator) ? 'suportado' : 'indisponível'}`);
  lines.push(`Câmera: ${navigator.mediaDevices?.getUserMedia ? 'disponível' : 'indisponível'}`);
  lines.push(`Share: ${navigator.share ? 'disponível' : 'fallback clipboard'}`);
  lines.push(`BarcodeDetector: ${typeof window.BarcodeDetector === 'function' ? 'disponível' : 'prompt'}`);

  try {
    const t0 = performance.now();
    await window.CDSApi.get('empresa').catch(() => window.CDSApi.get('configuracoes/empresa'));
    lines.push(`Ping API: ok (${Math.round(performance.now() - t0)} ms)`);
  } catch (err) {
    lines.push(`Ping API: falha (${err.message || err.status || 'erro'})`);
  }

  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      lines.push(`SW ativos: ${regs.length}`);
    }
  } catch (e) {
    lines.push('SW: erro ao consultar');
  }

  return lines;
}

export async function renderConfiguracoes(root) {
  root.innerHTML = loadingHtml('Carregando configurações…');
  try {
    let current = 'classic';
    try {
      current = localStorage.getItem('cds-ui-theme') || 'classic';
    } catch (e) { /* ignore */ }

    const user = readUser();
    const meta = getClientMeta();
    const term = getStoredTerminal();
    let empresa = null;
    let fiscal = null;

    try {
      empresa = await window.CDSApi.get('empresa');
    } catch (e) {
      try {
        empresa = await window.CDSApi.get('configuracoes/empresa');
      } catch (e2) { /* ignore */ }
    }
    try {
      fiscal = await window.CDSApi.get('configuracoes/fiscal');
    } catch (e) {
      try {
        fiscal = await window.CDSApi.get('fiscal/config');
      } catch (e2) { /* ignore */ }
    }

    const empresaNome = asText(
      empresa?.razao_social || empresa?.nome_fantasia || empresa?.nome || empresa?.empresa?.nome,
      '—'
    );
    const modoFiscal = asText(
      fiscal?.modo || fiscal?.ambiente || fiscal?.modo_fiscal || fiscal?.emissao || 'Consulta',
      'Consulta'
    );

    if (isTerminalRegistered()) startHeartbeat();

    root.innerHTML = `
      ${sectionTitleHtml('Empresa')}
      <article class="cds-card">
        <div class="cds-row"><span>Empresa</span><strong>${escapeHtml(empresaNome)}</strong></div>
        <div class="cds-row"><span>CNPJ</span><strong>${escapeHtml(asText(empresa?.cnpj || empresa?.documento, '—'))}</strong></div>
      </article>

      ${sectionTitleHtml('Perfil')}
      <article class="cds-card">
        <div class="cds-row"><span>Usuário</span><strong>${escapeHtml(asText(user.nome || user.username, '—'))}</strong></div>
        <div class="cds-row"><span>Perfil</span><strong>${escapeHtml(asText(user.perfil || user.role, '—'))}</strong></div>
        <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" id="cfg-perfil" style="margin-top:10px;width:100%">Abrir perfil</button>
      </article>

      ${sectionTitleHtml('Servidor')}
      <article class="cds-card">
        <div class="cds-row"><span>API</span><strong class="cds-mobile-break">${escapeHtml(asText(window.CDSApi?.resolveApiBase?.() || '/api'))}</strong></div>
        <div class="cds-row"><span>Conexão</span><strong id="cfg-conn">${escapeHtml(onlineLabel())}</strong></div>
      </article>

      ${sectionTitleHtml('Terminal')}
      <article class="cds-card">
        <div class="cds-row"><span>Status</span><strong>${term.registered ? 'Registrado' : 'Não registrado'}</strong></div>
        <div class="cds-row"><span>Nome</span><strong>${escapeHtml(asText(term.nome, '—'))}</strong></div>
        <div class="cds-row"><span>Terminal ID</span><strong>${escapeHtml(asText(term.id, '—'))}</strong></div>
        <div class="cds-row"><span>Hostname</span><strong class="cds-mobile-break">${escapeHtml(asText(term.hostname || meta.hostname, '—'))}</strong></div>
        ${term.registered ? `
          <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" id="cfg-term-offline" style="margin-top:10px;width:100%">Desconectar heartbeat</button>
        ` : `
          <button type="button" class="cds-mobile-btn" id="cfg-term-pdv" style="margin-top:10px;width:100%">Registrar no PDV</button>
        `}
      </article>

      ${sectionTitleHtml('Modo fiscal')}
      <article class="cds-card">
        <div class="cds-row"><span>Modo</span><strong>${escapeHtml(modoFiscal)}</strong></div>
        <p class="cds-muted" style="margin-bottom:8px">Emissão/cancelamento via Motor Fiscal nas rotas oficiais (PDV / Comercial).</p>
        <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" data-go="fiscal/config" style="width:100%">Configuração fiscal completa</button>
      </article>

      ${sectionTitleHtml('Administração')}
      <div class="cds-quick-grid" style="grid-template-columns:1fr 1fr">
        <button type="button" class="cds-quick" data-go="configuracoes/midp">MIDP</button>
        <button type="button" class="cds-quick" data-go="configuracoes/tef">TEF</button>
        <button type="button" class="cds-quick" data-go="configuracoes/licenca">Licença</button>
        <button type="button" class="cds-quick" data-go="equipamentos">Equipamentos</button>
        <button type="button" class="cds-quick" data-go="central-entradas">Central NF</button>
        <button type="button" class="cds-quick" data-go="relatorios">Relatórios</button>
      </div>

      ${sectionTitleHtml('Tema')}
      <article class="cds-card">
        <div class="cds-stack">
          ${THEMES.map((t) => `
            <button type="button" class="cds-mobile-btn ${t.id === current ? '' : 'cds-mobile-btn--secondary'}" data-theme="${t.id}">
              ${escapeHtml(t.label)}
            </button>
          `).join('')}
        </div>
      </article>

      ${sectionTitleHtml('Sincronização')}
      <article class="cds-card">
        <p class="cds-muted">Atualiza cache do app e força nova busca na API (sem regras locais).</p>
        <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" id="cfg-sync" style="width:100%">Sincronizar agora</button>
      </article>

      ${sectionTitleHtml('Diagnóstico')}
      <article class="cds-card">
        <pre id="cfg-diag" class="cds-diag">Toque em Executar para gerar o relatório.</pre>
        <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" id="cfg-diag-run" style="width:100%;margin-top:10px">Executar diagnóstico</button>
      </article>

      ${sectionTitleHtml('Cliente da plataforma')}
      <article class="cds-card">
        <div class="cds-row"><span>Client ID</span><strong>${escapeHtml(meta.client_id)}</strong></div>
        <div class="cds-row"><span>Tipo</span><strong>${escapeHtml(meta.client_type)}</strong></div>
        <div class="cds-row"><span>Plataforma</span><strong>${escapeHtml(meta.platform)}</strong></div>
        <p class="cds-muted" style="margin-top:8px">Preferência de destino após o login:</p>
        <div class="cds-stack" style="margin-top:8px">
          <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" id="pref-mobile">Preferir CDS Mobile</button>
          <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" id="pref-desktop">Preferir Desktop (ERP/PDV)</button>
        </div>
      </article>

      ${sectionTitleHtml('Sobre')}
      <article class="cds-card">
        <div class="cds-row"><span>App</span><strong>${escapeHtml(CDS_MOBILE_VERSION_LABEL)}</strong></div>
        <div class="cds-row"><span>Versão</span><strong>${escapeHtml(CDS_MOBILE_VERSION)}</strong></div>
        <div class="cds-row"><span>Build</span><strong>${escapeHtml(CDS_MOBILE_BUILD)}</strong></div>
        <div class="cds-row"><span>Status</span><strong>${escapeHtml(CDS_MOBILE_STATUS)}</strong></div>
      </article>

      ${sectionTitleHtml('Sessão')}
      <article class="cds-card">
        <button type="button" class="cds-mobile-btn" id="cfg-logout" style="width:100%">Logout</button>
      </article>
    `;

    bindGo(root);

    root.querySelectorAll('[data-theme]').forEach((btn) => {
      btn.addEventListener('click', () => {
        applyTheme(btn.getAttribute('data-theme'));
        showToast('Tema atualizado.', 'success');
        window.CDSMobile?.navigate?.('configuracoes', { replace: true });
      });
    });

    root.querySelector('#cfg-perfil')?.addEventListener('click', () => {
      window.CDSMobile?.navigate?.('perfil');
    });

    root.querySelector('#cfg-term-pdv')?.addEventListener('click', () => {
      window.CDSMobile?.navigate?.('pdv');
    });

    root.querySelector('#cfg-term-offline')?.addEventListener('click', async () => {
      try {
        await disconnectTerminal();
        showToast('Heartbeat desconectado.', 'info');
      } catch (err) {
        showToast(err.message || 'Falha ao desconectar.', 'error');
      }
    });

    root.querySelector('#cfg-sync')?.addEventListener('click', async () => {
      try {
        if ('serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map((r) => r.update()));
        }
        if (window.caches) {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }
        showToast('Sincronização concluída. Recarregando…', 'success');
        setTimeout(() => window.location.reload(), 600);
      } catch (err) {
        showToast(err.message || 'Falha na sincronização', 'error');
      }
    });

    root.querySelector('#cfg-diag-run')?.addEventListener('click', async () => {
      const pre = root.querySelector('#cfg-diag');
      if (pre) pre.textContent = 'Executando…';
      const lines = await runDiagnostico();
      if (pre) pre.textContent = lines.join('\n');
      showToast('Diagnóstico gerado.', 'success');
    });

    root.querySelector('#pref-mobile')?.addEventListener('click', () => {
      window.CDSPlatform?.forcarCliente?.('mobile');
      showToast('Preferência salva: CDS Mobile.', 'success');
    });

    root.querySelector('#pref-desktop')?.addEventListener('click', () => {
      window.CDSPlatform?.forcarCliente?.('desktop');
      showToast('Preferência salva: Desktop.', 'success');
    });

    root.querySelector('#cfg-logout')?.addEventListener('click', () => {
      document.getElementById('btn-logout')?.click();
    });

    const conn = root.querySelector('#cfg-conn');
    const syncConn = () => {
      if (conn) conn.textContent = onlineLabel();
    };
    window.addEventListener('online', syncConn);
    window.addEventListener('offline', syncConn);
  } catch (err) {
    root.innerHTML = errorHtml(err.message || 'Erro ao carregar configurações.', err.status);
    showToast(err.message || 'Erro nas configurações', 'error');
  }
}

export async function renderMidp(root) {
  root.innerHTML = loadingHtml('MIDP…');
  try {
    let cfg = {};
    try {
      cfg = await window.CDSApi.get('configuracoes-avancadas') || {};
    } catch (e) {
      cfg = {};
    }
    const ativado = cfg.midp_ativado === true || cfg.midp_ativado === 1 || cfg.midp_ativado === 'true'
      || cfg.midpAtivado === true;

    root.innerHTML = `
      ${backBarHtml('Configurações')}
      <h2 class="cds-page-title" style="font-size:1.15rem;margin:8px 0">MIDP</h2>
      <p class="cds-muted">Mesma política do Desktop: On = PreservarDinheiro; Off = legado.</p>
      <article class="cds-card">
        <div class="cds-row"><span>Status</span><strong>${ativado ? 'Ativado' : 'Desativado'}</strong></div>
        <label class="cds-check" style="display:flex;gap:10px;align-items:center;margin:12px 0">
          <input type="checkbox" id="midp-on" ${ativado ? 'checked' : ''} ${isAdmin() ? '' : 'disabled'}>
          <span>MIDP ativado</span>
        </label>
        ${isAdmin()
          ? '<button type="button" class="cds-mobile-btn" id="midp-save" style="width:100%">Salvar</button>'
          : '<p class="cds-muted">Somente administrador pode alterar.</p>'}
      </article>
    `;
    bindBack(root);
    root.querySelector('#midp-save')?.addEventListener('click', async () => {
      const on = !!root.querySelector('#midp-on')?.checked;
      try {
        await window.CDSApi.post('configuracoes-avancadas', { ...cfg, midp_ativado: on });
        showToast('MIDP atualizado.', 'success');
      } catch (err) {
        showToast(err.message || 'Falha ao salvar MIDP', 'error');
      }
    });
  } catch (err) {
    root.innerHTML = `${backBarHtml('Configurações')}${errorHtml(err.message, err.status)}`;
    bindBack(root);
  }
}

export async function renderTef(root) {
  root.innerHTML = loadingHtml('TEF…');
  try {
    let cfg = {};
    let status = null;
    try { cfg = await window.CDSApi.get('tef/configuracao') || {}; } catch (e) { cfg = {}; }
    try { status = await window.CDSApi.get('tef/status'); } catch (e) { status = null; }

    root.innerHTML = `
      ${backBarHtml('Configurações')}
      <h2 class="cds-page-title" style="font-size:1.15rem;margin:8px 0">TEF</h2>
      <p class="cds-muted">Pinpad físico: ◐ limitação mobile — pagamento TEF via API quando disponível.</p>
      <article class="cds-card">
        <div class="cds-row"><span>Status</span><strong>${escapeHtml(asText(status?.status || status?.mensagem || '—'))}</strong></div>
      </article>
      ${formCardHtml('Configuração', [
        fieldHtml({ name: 'provedor', label: 'Provedor', value: cfg.provedor || cfg.provider || '' }),
        fieldHtml({ name: 'empresa', label: 'Empresa / código', value: cfg.empresa || cfg.codigo_empresa || '' }),
        fieldHtml({ name: 'terminal', label: 'Terminal', value: cfg.terminal || cfg.terminal_id || '' }),
        fieldHtml({ name: 'ativo', label: 'Ativo (1/0)', value: cfg.ativo ?? 1, inputmode: 'numeric' })
      ].join(''), isAdmin()
        ? `<button type="submit" class="cds-mobile-btn">Salvar</button>
           <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" id="tef-test" style="margin-top:8px;width:100%">Testar</button>`
        : '<p class="cds-muted">Somente admin.</p>')}
    `;
    bindBack(root);
    root.querySelector('#cds-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!isAdmin()) return;
      const d = collectForm(e.target);
      try {
        await window.CDSApi.put('tef/configuracao', d).catch(() =>
          window.CDSApi.post('tef/configuracao', d));
        showToast('TEF salvo.', 'success');
      } catch (err) {
        showToast(err.message || 'Falha TEF', 'error');
      }
    });
    root.querySelector('#tef-test')?.addEventListener('click', async () => {
      try {
        await window.CDSApi.post('tef/testar', {});
        showToast('Teste TEF OK.', 'success');
      } catch (err) {
        showToast(err.message || 'Falha no teste TEF', 'error');
      }
    });
  } catch (err) {
    root.innerHTML = `${backBarHtml('Configurações')}${errorHtml(err.message, err.status)}`;
    bindBack(root);
  }
}

export async function renderLicenca(root) {
  root.innerHTML = loadingHtml('Licença…');
  try {
    const [lic, hist] = await Promise.all([
      window.CDSApi.get('licenca').catch(() => null),
      window.CDSApi.get('licenca/historico').catch(() => [])
    ]);
    const historico = Array.isArray(hist) ? hist : (hist?.data || []);

    root.innerHTML = `
      ${backBarHtml('Configurações')}
      <h2 class="cds-page-title" style="font-size:1.15rem;margin:8px 0">Licenciamento</h2>
      <article class="cds-card">
        <div class="cds-row"><span>Status</span><strong>${escapeHtml(asText(lic?.status || lic?.situacao || '—'))}</strong></div>
        <div class="cds-row"><span>Plano</span><strong>${escapeHtml(asText(lic?.plano || lic?.produto || '—'))}</strong></div>
        <div class="cds-row"><span>Validade</span><strong>${escapeHtml(asText(lic?.validade || lic?.expira_em || '—'))}</strong></div>
      </article>
      ${isAdmin() ? formCardHtml('Ativar', [
        fieldHtml({ name: 'chave', label: 'Chave de licença', required: true })
      ].join(''), `<button type="submit" class="cds-mobile-btn">Ativar</button>`) : ''}
      ${sectionTitleHtml('Histórico')}
      <div>
        ${historico.length
          ? historico.slice(0, 20).map((h) => `
              <article class="cds-card">
                <strong>${escapeHtml(asText(h.acao || h.evento || 'Evento'))}</strong>
                <p class="cds-muted">${escapeHtml(asText(h.data || h.created_at || ''))}</p>
              </article>
            `).join('')
          : '<p class="cds-muted">Sem histórico</p>'}
      </div>
    `;
    bindBack(root);
    root.querySelector('#cds-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = collectForm(e.target);
      const ok = await confirmSheet({
        title: 'Ativar licença',
        message: 'Confirma ativação com esta chave?',
        confirmLabel: 'Ativar'
      });
      if (!ok) return;
      try {
        await window.CDSApi.post('licenca/ativar', d);
        showToast('Licença ativada.', 'success');
        renderLicenca(root);
      } catch (err) {
        showToast(err.message || 'Falha ao ativar', 'error');
      }
    });
  } catch (err) {
    root.innerHTML = `${backBarHtml('Configurações')}${errorHtml(err.message, err.status)}`;
    bindBack(root);
  }
}

export async function render(root, parsed) {
  const sub = parsed?.parts?.[1];
  if (sub === 'midp') return renderMidp(root);
  if (sub === 'tef') return renderTef(root);
  if (sub === 'licenca') return renderLicenca(root);
  return renderConfiguracoes(root);
}

export default { render, renderConfiguracoes, title: 'Configurações', subtitle: 'Preferências' };
