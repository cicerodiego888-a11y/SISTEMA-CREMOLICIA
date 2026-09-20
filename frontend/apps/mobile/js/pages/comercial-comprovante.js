/**
 * CDS Mobile — Resumo da entrega para enviar ao consignatário.
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

function unwrapComprovante(raw) {
  if (!raw || typeof raw !== 'object') return null;
  let c = raw;
  if (c.data && typeof c.data === 'object' && !Array.isArray(c.data)) c = c.data;
  if (c.dados && typeof c.dados === 'object' && !Array.isArray(c.dados)) c = c.dados;
  if (c.comprovante && typeof c.comprovante === 'object') c = c.comprovante;
  return c;
}

function montarTextoResumo(comprovante) {
  const snap = comprovante?.snapshot || comprovante || {};
  const existente = String(
    comprovante?.textoCompartilhavel || snap.textoCompartilhavel || ''
  ).trim();
  if (existente) return existente;

  const h = snap.cabecalho || {};
  const prod = snap.cards?.produtos || {};
  const sit = snap.cards?.situacaoComercial || {};
  const linhas = [
    '*COMPROVANTE DE ENTREGA*',
    h.empresaNome || 'CDS Sistemas',
    `Nº ${h.numeroComprovante || snap.numeroComprovante || '—'}`,
    `${h.data || ''} ${h.hora || ''}`.trim(),
    '',
    `*Cliente:* ${h.clienteNome || '—'}`,
    '',
    '*PRODUTOS*'
  ];
  (prod.itens || []).forEach((i) => {
    linhas.push(
      `• ${i.produto} — ${i.quantidade} ${i.unidade || 'UN'} = ${money(i.total)}`
    );
  });
  linhas.push(`Valor comercial: ${money(prod.valorComercial)}`);
  linhas.push(`Saldo atual: ${money(sit.saldoAtual)}`);
  linhas.push('');
  linhas.push('Enviado pelo CDS Sistemas');
  return linhas.filter((l, i, arr) => !(l === '' && arr[i - 1] === '')).join('\n');
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
    showToast('PDF indisponível. Use Copiar resumo ou WhatsApp.', 'warning');
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

async function carregarComprovante(id) {
  const raw = await window.CDSApi.get(
    `comercial/consignacoes/${id}/comprovante`,
    { _t: Date.now() },
    { timeoutMs: 60000 }
  );
  return unwrapComprovante(raw);
}

export async function renderComprovanteEntrega(root, id) {
  root.innerHTML = loadingHtml('Montando resumo para o consignatário…');
  let comprovante = null;
  let offline = false;

  try {
    comprovante = await carregarComprovante(id);
    if (comprovante) saveOffline(id, comprovante);
  } catch (err) {
    const cached = loadOffline(id);
    if (cached) {
      comprovante = cached;
      offline = true;
    } else {
      root.innerHTML = `
        ${backBarHtml('Comercial')}
        ${errorHtml(apiErrorMessage(err) || err.message || 'Falha ao carregar o resumo', err.status)}
        <button type="button" class="cds-mobile-btn" data-go="comercial/${escapeHtml(String(id))}" style="margin-top:12px">Voltar à consignação</button>
      `;
      bindBack(root);
      root.querySelector('[data-go]')?.addEventListener('click', () => {
        window.CDSMobile?.navigate?.(`comercial/${id}`);
      });
      return;
    }
  }

  if (!comprovante || typeof comprovante !== 'object') {
    root.innerHTML = errorHtml('Resumo da entrega indisponível.', 404);
    return;
  }

  const snap = comprovante.snapshot || comprovante;
  const h = snap.cabecalho || {};
  const prod = snap.cards?.produtos || {};
  const sit = snap.cards?.situacaoComercial || {};
  const hist = snap.cards?.historico || {};
  const obs = snap.cards?.observacoes || {};
  const texto = montarTextoResumo(comprovante);
  const pdf = comprovante.pdf || snap.pdf;
  const status = sit.statusComercial || snap.indicadores?.statusCredito || '—';
  const phone = String(h.clienteTelefone || '').replace(/\D/g, '');

  root.innerHTML = `
    ${backBarHtml('Comercial')}
    ${offline ? `<div class="cds-mobile-banner">${icon('warning')} <span>Modo offline — último resumo salvo.</span></div>` : ''}
    ${cardHtml('Resumo para o consignatário', `
      <p class="cds-muted" style="margin:0 0 8px">Revise e envie pelo WhatsApp ou copie o texto.</p>
      <pre class="cds-comprovante-texto" style="white-space:pre-wrap;word-break:break-word;font-size:13px;line-height:1.4;margin:0;font-family:inherit">${escapeHtml(texto)}</pre>
    `)}
    <div class="cds-card" style="display:grid;gap:8px;margin-bottom:12px">
      <button type="button" class="cds-mobile-btn" id="cmp-whatsapp">Enviar ao consignatário (WhatsApp)</button>
      <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" id="cmp-copiar">Copiar resumo</button>
      <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" id="cmp-pdf">Gerar PDF</button>
      <button type="button" class="cds-mobile-btn cds-mobile-btn--ghost" id="cmp-print">Imprimir</button>
    </div>
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
  `;

  bindBack(root);

  const enviarWhatsApp = async () => {
    if (!texto) {
      showToast('Não há texto de resumo para enviar.', 'warning');
      return;
    }
    await audit(id, 'whatsapp', comprovante);
    if (phone) openWhatsApp(phone, texto);
    else window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
    if (pdf?.base64) downloadPdf(pdf);
  };

  root.querySelector('#cmp-copiar')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(texto);
      await audit(id, 'resumo_copiado', comprovante);
      showToast('Resumo copiado. Cole no WhatsApp do consignatário.', 'success');
    } catch (_e) {
      showToast('Não foi possível copiar. Selecione o texto na tela.', 'error');
    }
  });

  root.querySelector('#cmp-whatsapp')?.addEventListener('click', enviarWhatsApp);

  root.querySelector('#cmp-pdf')?.addEventListener('click', async () => {
    await audit(id, 'pdf', comprovante);
    downloadPdf(pdf);
  });

  root.querySelector('#cmp-print')?.addEventListener('click', async () => {
    await audit(id, 'impressao', comprovante);
    const w = window.open('', '_blank');
    if (w && (pdf?.html || texto)) {
      w.document.write(pdf?.html || `<pre>${escapeHtml(texto)}</pre>`);
      w.document.close();
      setTimeout(() => w.print(), 250);
    }
  });
}

export default { renderComprovanteEntrega };
