/**
 * CDS Mobile RCM-03 — Central de Entradas NF + MIIP
 * Mesmas APIs do Desktop: /api/central-entradas + /api/miip
 */
import {
  escapeHtml,
  asText,
  formatMoney,
  formatDate,
  formatDateTime,
  loadingHtml,
  emptyHtml,
  errorHtml,
  listCardHtml,
  backBarHtml,
  bindBack,
  bindGo,
  sectionTitleHtml,
  searchBarHtml,
  countLabel,
  debounce,
  statusBadgeHtml,
  kpiHtml,
  formatNumber
} from '../ui.js';
import {
  fieldHtml,
  promptSheet,
  confirmSheet,
  unwrapList,
  actionBarHtml,
  currentUserId,
  openBottomSheet
} from '../forms.js';
import { showToast } from '../toast.js';
import { shareTextAsFile } from '../native.js';

function apiBase() {
  return window.CDSApi?.resolveApiBase?.() || '/api';
}

function authHeaders(json = true) {
  const h = { Authorization: `Bearer ${localStorage.getItem('token') || ''}` };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

async function ceFetch(path, options = {}) {
  const res = await fetch(`${apiBase()}/central-entradas${path}`, {
    ...options,
    headers: { ...authHeaders(!(options.body instanceof FormData)), ...(options.headers || {}) }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && !data.itens) {
    throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status, payload: data });
  }
  return data;
}

function docTitle(d) {
  return asText(d.numero || d.numero_nf || d.chave_acesso || `Doc #${d.id}`, 'Documento');
}

function docCard(d) {
  return listCardHtml({
    go: `central-entradas/${d.id}`,
    title: docTitle(d),
    subtitle: asText(d.fornecedor_nome || d.nome_emitente || d.emitente || d.cnpj_emitente),
    value: formatMoney(d.valor_total ?? d.valor ?? 0),
    status: d.status || d.situacao || d.status_processamento,
    meta: [formatDate(d.data_emissao || d.created_at || d.data_entrada)].filter((x) => x !== '—')
  });
}

export async function renderHub(root) {
  root.innerHTML = loadingHtml('Central de Entradas…');
  try {
    const [dash, lista, alertas] = await Promise.all([
      ceFetch('/dashboard').catch(() => null),
      ceFetch('/').catch(() => []),
      ceFetch('/alertas').catch(() => [])
    ]);
    const docs = unwrapList(lista?.data || lista?.documentos || lista?.items || lista);
    const alertList = unwrapList(alertas?.data || alertas?.items || alertas);
    const totais = dash?.totais || dash?.contadores || dash || {};

    root.innerHTML = `
      <div class="cds-quick-grid" style="grid-template-columns:1fr 1fr;margin-bottom:12px">
        <button type="button" class="cds-quick" id="ce-upload">Upload XML</button>
        <button type="button" class="cds-quick" id="ce-sync">Sincronizar</button>
      </div>
      <div class="cds-kpi-grid">
        ${kpiHtml({ id: 'pend', iconName: 'inbox', label: 'Docs', value: formatNumber(totais.total ?? docs.length ?? 0), tone: 'info', ok: true })}
        ${kpiHtml({ id: 'proc', iconName: 'warning', label: 'Pendentes', value: formatNumber(totais.pendentes ?? totais.aguardando ?? 0), tone: 'warning', ok: true })}
      </div>
      ${alertList.length ? `
        ${sectionTitleHtml('Alertas')}
        <div>${alertList.slice(0, 5).map((a) => listCardHtml({
          title: asText(a.titulo || a.mensagem || a.tipo || 'Alerta'),
          subtitle: asText(a.descricao || a.detalhe, '')
        })).join('')}</div>
      ` : ''}
      ${sectionTitleHtml('Documentos')}
      ${searchBarHtml('Filtrar chave / fornecedor', 'ce-search')}
      <p class="cds-muted" id="ce-count">${escapeHtml(countLabel(docs.length, 'documento', 'documentos'))}</p>
      <div id="ce-list">
        ${docs.length ? docs.slice(0, 60).map(docCard).join('') : emptyHtml('Nenhum documento')}
      </div>
      <div class="cds-stack" style="margin-top:12px">
        <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" data-go="compras">Ir para Compras</button>
      </div>
      <input type="file" id="ce-file" accept=".xml,text/xml,application/xml" multiple hidden>
    `;

    bindGo(root);
    const all = docs;
    root.querySelector('#ce-search')?.addEventListener('input', debounce((e) => {
      const q = String(e.target.value || '').toLowerCase().trim();
      const filtered = !q ? all : all.filter((d) => JSON.stringify(d).toLowerCase().includes(q));
      root.querySelector('#ce-count').textContent = countLabel(filtered.length, 'documento', 'documentos');
      const list = root.querySelector('#ce-list');
      list.innerHTML = filtered.length
        ? filtered.slice(0, 60).map(docCard).join('')
        : emptyHtml('Nenhum resultado');
      bindGo(list);
    }, 200));

    root.querySelector('#ce-upload')?.addEventListener('click', () => {
      root.querySelector('#ce-file')?.click();
    });
    root.querySelector('#ce-file')?.addEventListener('change', async (e) => {
      const files = [...(e.target.files || [])];
      if (!files.length) return;
      const fd = new FormData();
      files.forEach((f) => fd.append('xml', f));
      const uid = currentUserId();
      if (uid != null) fd.append('usuario_id', String(uid));
      try {
        showToast('Enviando XML…', 'info');
        const res = await ceFetch('/upload', { method: 'POST', body: fd, headers: authHeaders(false) });
        const ok = res.totalEnviados ?? res.itens?.filter?.((i) => i.sucesso)?.length ?? files.length;
        showToast(`${ok} arquivo(s) processado(s) no upload.`, 'success');
        renderHub(root);
      } catch (err) {
        showToast(err.message || 'Falha no upload', 'error');
      }
      e.target.value = '';
    });

    root.querySelector('#ce-sync')?.addEventListener('click', async () => {
      try {
        showToast('Sincronizando…', 'info');
        await ceFetch('/sincronizar', { method: 'POST', body: JSON.stringify({ usuario_id: currentUserId() }) });
        showToast('Sincronização concluída.', 'success');
        renderHub(root);
      } catch (err) {
        try {
          await ceFetch('/sincronizar-ao-abrir', {
            method: 'POST',
            body: JSON.stringify({ usuario_id: currentUserId() })
          });
          showToast('Sincronização ao abrir OK.', 'success');
          renderHub(root);
        } catch (err2) {
          showToast(err2.message || err.message || 'Falha ao sincronizar', 'error');
        }
      }
    });
  } catch (err) {
    root.innerHTML = errorHtml(err.message, err.status);
  }
}

async function identificarMiip(doc) {
  const itens = unwrapList(doc.itens || doc.items || doc.parse?.itens || []);
  if (!itens.length) {
    showToast('Sem itens para MIIP neste documento.', 'warning');
    return null;
  }
  const payload = {
    origem: 'CENTRAL_ENTRADAS',
    fornecedor_cnpj: doc.cnpj_emitente || doc.fornecedor_cnpj || doc.emitente_cnpj,
    itens: itens.map((it, indice) => ({
      indice,
      codigo: it.codigo || it.cProd || it.codigo_produto,
      ean: it.ean || it.cEAN || it.codigo_barras,
      descricao: it.descricao || it.xProd || it.produto_nome,
      ncm: it.ncm || it.NCM,
      quantidade: it.quantidade || it.qCom,
      unidade: it.unidade || it.uCom
    }))
  };
  return window.CDSApi.post('miip/identificar-lote', payload);
}

export async function renderDetail(root, id) {
  root.innerHTML = loadingHtml('Documento…');
  try {
    const [doc, hist] = await Promise.all([
      ceFetch(`/${id}`),
      ceFetch(`/${id}/historico`).catch(() => [])
    ]);
    const historico = unwrapList(hist?.data || hist?.eventos || hist?.items || hist);
    const itens = unwrapList(doc.itens || doc.items || []);

    root.innerHTML = `
      ${backBarHtml('Central')}
      <article class="cds-card">
        <h3 class="cds-card__title">${escapeHtml(docTitle(doc))}</h3>
        <div class="cds-row"><span>Status</span><strong>${statusBadgeHtml(doc.status || doc.situacao)}</strong></div>
        <div class="cds-row"><span>Emitente</span><strong>${escapeHtml(asText(doc.fornecedor_nome || doc.nome_emitente || doc.emitente))}</strong></div>
        <div class="cds-row"><span>CNPJ</span><strong>${escapeHtml(asText(doc.cnpj_emitente || doc.fornecedor_cnpj))}</strong></div>
        <div class="cds-row"><span>Valor</span><strong>${escapeHtml(formatMoney(doc.valor_total ?? doc.valor ?? 0))}</strong></div>
        <div class="cds-row"><span>Chave</span><strong class="cds-mobile-break">${escapeHtml(asText(doc.chave_acesso || doc.chave))}</strong></div>
        <div class="cds-row"><span>Emissão</span><strong>${escapeHtml(formatDate(doc.data_emissao || doc.created_at))}</strong></div>
      </article>

      ${sectionTitleHtml(`Itens (${itens.length})`)}
      <div>
        ${itens.length
          ? itens.slice(0, 40).map((i) => listCardHtml({
              title: asText(i.descricao || i.xProd || i.produto_nome || i.codigo),
              value: formatMoney(i.valor_total ?? i.vProd ?? 0),
              meta: [`Qtd ${i.quantidade || i.qCom || '—'}`, asText(i.produto_id ? `Prod ${i.produto_id}` : '', '')]
            })).join('')
          : emptyHtml('Itens no parse — use Processar / MIIP')}
      </div>

      ${sectionTitleHtml('Histórico')}
      <div>
        ${historico.length
          ? historico.slice(0, 20).map((h) => listCardHtml({
              title: asText(h.acao || h.evento || h.tipo || 'Evento'),
              subtitle: asText(h.descricao || h.mensagem || h.motivo, ''),
              meta: [formatDateTime(h.created_at || h.data || h.timestamp)]
            })).join('')
          : emptyHtml('Sem histórico')}
      </div>

      ${actionBarHtml([
        { action: 'processar', label: 'Processar', icon: 'inbox', variant: 'secondary' },
        { action: 'miip', label: 'MIIP', icon: 'search', variant: 'secondary' },
        { action: 'revisar', label: 'Concluir revisão', icon: 'check', variant: 'secondary' },
        { action: 'compra', label: 'Abrir compra', icon: 'cart', variant: 'secondary' },
        { action: 'xml', label: 'Share XML', icon: 'share', variant: 'ghost' },
        { action: 'parse', label: 'Ver parse', icon: 'id', variant: 'ghost' }
      ])}
    `;
    bindBack(root);

    root.querySelector('[data-action="processar"]')?.addEventListener('click', async () => {
      try {
        await ceFetch(`/${id}/processar`, {
          method: 'POST',
          body: JSON.stringify({ usuario_id: currentUserId() })
        });
        showToast('Documento processado.', 'success');
        renderDetail(root, id);
      } catch (err) {
        showToast(err.message || 'Falha ao processar', 'error');
      }
    });

    root.querySelector('[data-action="miip"]')?.addEventListener('click', async () => {
      try {
        showToast('Identificando lotes MIIP…', 'info');
        let docFull = doc;
        try {
          docFull = { ...doc, ...(await ceFetch(`/${id}/parse`)) };
        } catch (e) { /* use doc */ }
        const res = await identificarMiip(docFull);
        const sugestoes = unwrapList(res?.itens || res?.sugestoes || res?.data || res);
        openBottomSheet({
          title: 'Sugestões MIIP',
          bodyHtml: sugestoes.length
            ? `<div class="cds-list">${sugestoes.slice(0, 30).map((s) => `
                <article class="cds-card">
                  <div class="cds-row"><strong>${escapeHtml(asText(s.descricao || s.produto_nome || `Item ${s.indice}`))}</strong></div>
                  <div class="cds-muted">Produto sugerido: ${escapeHtml(asText(s.produto_id || s.produtoId || s.nome_produto || '—'))}</div>
                  <div class="cds-muted">Score: ${escapeHtml(asText(s.score ?? s.confianca, '—'))}</div>
                </article>
              `).join('')}</div>`
            : emptyHtml('Sem sugestões'),
          actionsHtml: `<button type="button" class="cds-mobile-btn" data-sheet-close>Fechar</button>`
        });
        if (sugestoes.length) {
          const ok = await confirmSheet({
            title: 'Confirmar feedback MIIP?',
            message: 'Enviar confirmações das sugestões como feedback de aprendizado.',
            confirmLabel: 'Enviar feedback'
          });
          if (ok) {
            await window.CDSApi.post('miip/feedback', {
              origem: 'CENTRAL_ENTRADAS',
              documento_id: id,
              itens: sugestoes
            });
            showToast('Feedback MIIP enviado.', 'success');
          }
        }
      } catch (err) {
        showToast(err.message || 'Falha MIIP', 'error');
      }
    });

    root.querySelector('[data-action="revisar"]')?.addEventListener('click', async () => {
      try {
        await ceFetch(`/${id}/revisar/concluir`, {
          method: 'POST',
          body: JSON.stringify({ usuario_id: currentUserId() })
        });
        showToast('Revisão concluída.', 'success');
        renderDetail(root, id);
      } catch (err) {
        showToast(err.message || 'Falha na revisão', 'error');
      }
    });

    root.querySelector('[data-action="compra"]')?.addEventListener('click', async () => {
      try {
        await ceFetch(`/${id}/abrir-compra`, {
          method: 'POST',
          body: JSON.stringify({ usuario_id: currentUserId() })
        });
        showToast('Compra vinculada / aberta.', 'success');
        window.CDSMobile?.navigate?.('compras/nova');
      } catch (err) {
        try {
          await ceFetch(`/${id}/payload-compra`);
          showToast('Payload disponível — abra Nova compra e complete a entrada.', 'info');
          window.CDSMobile?.navigate?.('compras/nova');
        } catch (err2) {
          showToast(err.message || 'Não foi possível abrir compra', 'error');
        }
      }
    });

    root.querySelector('[data-action="xml"]')?.addEventListener('click', async () => {
      try {
        const xmlRes = await ceFetch(`/${id}/xml`);
        const xml = typeof xmlRes === 'string' ? xmlRes : (xmlRes.xml || xmlRes.conteudo || xmlRes.data || '');
        if (!xml) {
          showToast('XML indisponível.', 'warning');
          return;
        }
        await shareTextAsFile(`nfe-${id}.xml`, typeof xml === 'string' ? xml : JSON.stringify(xml), 'application/xml');
      } catch (err) {
        showToast(err.message || 'Falha ao obter XML', 'error');
      }
    });

    root.querySelector('[data-action="parse"]')?.addEventListener('click', async () => {
      try {
        const parse = await ceFetch(`/${id}/parse`);
        openBottomSheet({
          title: 'Parse do documento',
          bodyHtml: `<pre class="cds-diag" style="max-height:50vh;overflow:auto;white-space:pre-wrap">${escapeHtml(JSON.stringify(parse, null, 2).slice(0, 8000))}</pre>`,
          actionsHtml: `<button type="button" class="cds-mobile-btn" data-sheet-close>Fechar</button>`
        });
      } catch (err) {
        showToast(err.message || 'Parse indisponível', 'error');
      }
    });
  } catch (err) {
    root.innerHTML = `${backBarHtml('Central')}${errorHtml(err.message, err.status)}`;
    bindBack(root);
  }
}

export async function render(root, parsed) {
  const id = parsed?.parts?.[1];
  if (id && id !== 'upload') return renderDetail(root, id);
  return renderHub(root);
}

export default { render, title: 'Central Entradas', subtitle: 'Fiscal' };
