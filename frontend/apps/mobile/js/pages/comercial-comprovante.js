/**
 * CDS Mobile — Resumo Inteligente da Entrega (RCM-04.4)
 * Renderiza exclusivamente o Snapshot do Motor de Comprovantes.
 */
import {
  escapeHtml,
  asText,
  formatMoney,
  loadingHtml,
  errorHtml,
  backBarHtml,
  bindBack,
  icon
} from '../ui.js';
import { showToast } from '../toast.js';
import { confirmSheet } from '../forms.js';
import { openWhatsApp } from '../native.js';
import { apiErrorMessage } from '../api-errors.js';

const CACHE_PREFIX = 'cds-comprovante-entrega:';

function money(v) {
  return formatMoney(v);
}

function cacheKey(id) {
  return `${CACHE_PREFIX}${id}`;
}

function saveOffline(id, snapshot) {
  try {
    sessionStorage.setItem(cacheKey(id), JSON.stringify({
      savedAt: Date.now(),
      snapshot
    }));
  } catch (_e) { /* ignore */ }
}

function loadOffline(id) {
  try {
    const raw = sessionStorage.getItem(cacheKey(id));
    if (!raw) return null;
    return JSON.parse(raw)?.snapshot || null;
  } catch (_e) {
    return null;
  }
}

async function audit(id, acao, comprovante) {
  try {
    await window.CDSApi.post(`comercial/consignacoes/${id}/comprovante/acoes`, {
      acao,
      comprovanteId: comprovante?.id,
      numeroComprovante: comprovante?.numeroComprovante
    });
  } catch (_e) { /* ignore */ }
}

function downloadPdf(pdf) {
  if (!pdf?.base64) {
    showToast('PDF indisponível no snapshot.', 'warning');
    return;
  }
  const bin = atob(pdf.base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: pdf.contentType || 'application/pdf' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = pdf.fileName || 'comprovante-entrega.pdf';
  a.click();
  URL.revokeObjectURL(a.href);
}

function cardHtml(title, body) {
  return `
    <section class="cds-card" style="margin-bottom:12px">
      <h3 style="margin:0 0 8px;font-size:15px">${escapeHtml(title)}</h3>
      ${body}
    </section>
  `;
}

export async function renderComprovanteEntrega(root, id) {
  root.innerHTML = loadingHtml('Carregando comprovante…');
  let comprovante = null;
  let offline = false;

  try {
    comprovante = await window.CDSApi.get(`comercial/consignacoes/${id}/comprovante`, { _t: Date.now() });
    if (comprovante?.data) comprovante = comprovante.data;
    saveOffline(id, comprovante);
  } catch (err) {
    const cached = loadOffline(id);
    if (cached) {
      comprovante = cached;
      offline = true;
    } else {
      root.innerHTML = errorHtml(apiErrorMessage(err) || err.message || 'Falha ao carregar comprovante', err.status);
      return;
    }
  }

  const snap = comprovante.snapshot || comprovante;
  const h = snap.cabecalho || {};
  const prod = snap.cards?.produtos || {};
  const sit = snap.cards?.situacaoComercial || {};
  const hist = snap.cards?.historico || {};
  const obs = snap.cards?.observacoes || {};
  const texto = comprovante.textoCompartilhavel || snap.textoCompartilhavel || '';
  const pdf = comprovante.pdf || snap.pdf;
  const status = sit.statusComercial || snap.indicadores?.statusCredito || '—';

  root.innerHTML = `
    ${backBarHtml('Comercial')}
    ${offline ? `<div class="cds-mobile-banner">${icon('warning')} <span>Modo offline — exibindo último snapshot.</span></div>` : ''}
    ${cardHtml('Comprovante de Entrega', `
      <p class="cds-muted" style="margin:0">${escapeHtml(h.empresaNome || '')}</p>
      <p style="margin:4px 0 0"><strong>${escapeHtml(h.numeroComprovante || snap.numeroComprovante || '')}</strong></p>
      <p class="cds-muted">${escapeHtml(h.data || '')} ${escapeHtml(h.hora || '')}</p>
      <span class="cds-badge cds-badge--${status === 'VERDE' ? 'ok' : status === 'AMARELO' ? 'warn' : status === 'VERMELHO' ? 'danger' : 'neutral'}">${escapeHtml(status)}</span>
    `)}
    ${cardHtml('Cliente', `
      <p style="margin:0"><strong>${escapeHtml(h.clienteNome || '—')}</strong></p>
      <p class="cds-muted">Código ${escapeHtml(h.clienteCodigo || '—')} · ${escapeHtml(h.clienteDocumento || '—')}</p>
    `)}
    ${cardHtml('Produtos', `
      ${(prod.itens || []).map((i) => `
        <div class="cds-row" style="justify-content:space-between;gap:8px">
          <span>${escapeHtml(i.produto)} · ${escapeHtml(i.quantidade)} ${escapeHtml(i.unidade || 'UN')}</span>
          <strong>${escapeHtml(money(i.total))}</strong>
        </div>`).join('') || '<p class="cds-muted">Sem itens</p>'}
      <div class="cds-row" style="margin-top:8px"><span>Valor comercial</span><strong>${escapeHtml(money(prod.valorComercial))}</strong></div>
      <div class="cds-row"><span>Volumes</span><strong>${escapeHtml(asText(prod.volumes))}</strong></div>
    `)}
    ${cardHtml('Situação Comercial', `
      <div class="cds-row"><span>Saldo anterior</span><strong>${escapeHtml(money(sit.saldoAnterior))}</strong></div>
      <div class="cds-row"><span>Nova remessa</span><strong>${escapeHtml(money(sit.novaRemessa))}</strong></div>
      <div class="cds-row"><span>Saldo atual</span><strong>${escapeHtml(money(sit.saldoAtual))}</strong></div>
      <div class="cds-row"><span>Limite</span><strong>${escapeHtml(money(sit.limite))}</strong></div>
      <div class="cds-row"><span>Crédito disponível</span><strong>${escapeHtml(money(sit.creditoDisponivel))}</strong></div>
      <div class="cds-row"><span>Valor em aberto</span><strong>${escapeHtml(money(sit.valorEmAberto))}</strong></div>
    `)}
    ${cardHtml('Histórico', `
      <div class="cds-row"><span>Última entrega</span><strong>${escapeHtml(hist.ultimaEntrega || '—')}</strong></div>
      <div class="cds-row"><span>Maior remessa</span><strong>${escapeHtml(money(hist.maiorRemessa))}</strong></div>
      <div class="cds-row"><span>Média remessas</span><strong>${escapeHtml(money(hist.mediaRemessas))}</strong></div>
      <div class="cds-row"><span>Índice perdas</span><strong>${escapeHtml(hist.indicePerdas != null ? `${hist.indicePerdas}%` : '—')}</strong></div>
    `)}
    ${cardHtml('Observações', `<p style="margin:0">${escapeHtml(obs.entrega || '—')}</p>`)}
    <div class="cds-card" style="display:grid;gap:8px">
      <button type="button" class="cds-mobile-btn" id="cmp-whatsapp">📱 Compartilhar via WhatsApp</button>
      <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" id="cmp-copiar">📋 Copiar Resumo</button>
      <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" id="cmp-pdf">📄 Gerar PDF</button>
      <button type="button" class="cds-mobile-btn cds-mobile-btn--ghost" id="cmp-print">🖨️ Imprimir</button>
    </div>
  `;

  bindBack(root);

  root.querySelector('#cmp-copiar')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(texto);
      await audit(id, 'resumo_copiado', comprovante);
      showToast('Resumo copiado com sucesso.', 'success');
      await afterShare(id);
    } catch (_e) {
      showToast('Não foi possível copiar.', 'error');
    }
  });

  root.querySelector('#cmp-whatsapp')?.addEventListener('click', async () => {
    await audit(id, 'whatsapp', comprovante);
    const phone = String(h.clienteTelefone || '').replace(/\D/g, '');
    if (phone) {
      openWhatsApp(phone, texto);
    } else {
      window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
    }
    if (pdf?.base64) downloadPdf(pdf);
    await afterShare(id);
  });

  root.querySelector('#cmp-pdf')?.addEventListener('click', async () => {
    await audit(id, 'pdf', comprovante);
    downloadPdf(pdf);
    showToast('PDF gerado a partir do snapshot oficial.', 'success');
    await afterShare(id);
  });

  root.querySelector('#cmp-print')?.addEventListener('click', async () => {
    await audit(id, 'impressao', comprovante);
    const w = window.open('', '_blank');
    if (w && pdf?.html) {
      w.document.write(pdf.html);
      w.document.close();
      setTimeout(() => w.print(), 250);
    }
    await afterShare(id);
  });
}

async function afterShare(id) {
  const ok = await confirmSheet({
    title: 'Finalizar atendimento?',
    message: 'Deseja finalizar este atendimento?',
    confirmLabel: 'Finalizar'
  });
  if (ok) {
    window.CDSMobile?.navigate?.('comercial', { replace: true });
  }
}

export default { renderComprovanteEntrega };
