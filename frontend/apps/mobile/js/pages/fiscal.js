/**
 * CDS Mobile RC2.2 — Fiscal operacional (mesmo Motor Fiscal do ERP)
 */
import {
  escapeHtml,
  asText,
  formatMoney,
  formatDateTime,
  loadingHtml,
  emptyHtml,
  errorHtml,
  listCardHtml,
  searchBarHtml,
  sectionTitleHtml,
  statusBadgeHtml,
  backBarHtml,
  bindBack,
  bindGo,
  debounce,
  countLabel,
  icon
} from '../ui.js';
import { fieldHtml, formCardHtml, collectForm, promptSheet, actionBarHtml, cadastroSectionHtml } from '../forms.js';
import { showToast } from '../toast.js';
import { canDoAction, isAdmin } from '../permissions.js';
import { shareTextAsFile } from '../native.js';

function situacaoNota(n) {
  return asText(n.status || n.situacao || n.status_sefaz || n.resultado, '—');
}

function tipoNota(n) {
  const modelo = asText(n.modelo || n.tipo || n.modelo_nf, '');
  if (/55|nfe/i.test(modelo)) return 'NF-e';
  if (/65|nfce|nfc/i.test(modelo)) return 'NFC-e';
  return modelo || 'NFC-e';
}

export async function renderFiscal(root) {
  root.innerHTML = loadingHtml('Carregando fiscal…');
  try {
    let config = null;
    try {
      config = await window.CDSApi.get('fiscal/config');
    } catch (e) {
      try {
        config = await window.CDSApi.get('configuracoes/fiscal');
      } catch (e2) { /* ignore */ }
    }

    const notes = await window.CDSApi.get('fiscal/notas', { todas: 1 });
    const rows = Array.isArray(notes) ? notes : [];

    root.innerHTML = `
      <article class="cds-card cds-m-enter">
        <div style="display:flex;gap:10px;align-items:center">
          ${icon('receipt')}
          <div>
            <h3 class="cds-card__title" style="margin:0">Fiscal</h3>
            <p class="cds-muted" style="margin:4px 0 0">Motor Fiscal oficial · mesmas APIs do ERP</p>
          </div>
        </div>
        ${config ? `
          <div class="cds-row" style="margin-top:10px"><span>Ambiente</span><strong>${escapeHtml(asText(config.ambiente || config.modo || config.modo_fiscal, '—'))}</strong></div>
          <div class="cds-row"><span>Série NFC-e</span><strong>${escapeHtml(asText(config.serie_nfce || config.serie, '—'))}</strong></div>
        ` : ''}
        <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" data-go="fiscal/config" style="margin-top:10px;width:100%">Configuração fiscal</button>
      </article>

      ${canDoAction('emitir_nfce') ? `
        <div class="cds-stack" style="margin:12px 0">
          <button type="button" class="cds-mobile-btn" id="fis-emit">Emitir NFC-e por venda</button>
        </div>
      ` : ''}

      ${searchBarHtml('Filtrar por chave, número ou status', 'fiscal-search')}
      <p class="cds-muted" id="fiscal-count">${escapeHtml(countLabel(rows.length, 'nota', 'notas'))}</p>
      <div id="fiscal-list">
        ${rows.length
          ? rows.slice(0, 60).map((n) => listCardHtml({
              go: `fiscal/${n.id}`,
              title: `${tipoNota(n)} ${asText(n.numero || n.nNF || n.id)}`,
              subtitle: asText(n.chave || n.chave_acesso || n.venda_codigo),
              value: formatMoney(n.valor_total ?? n.total ?? n.venda_total ?? 0),
              status: situacaoNota(n),
              meta: [formatDateTime(n.created_at || n.data_emissao || n.emitida_em)].filter((x) => x !== '—')
            })).join('')
          : emptyHtml('Nenhuma nota encontrada')}
      </div>
    `;

    bindGo(root);

    root.querySelector('#fis-emit')?.addEventListener('click', async () => {
      const data = await promptSheet({
        title: 'Emitir NFC-e',
        confirmLabel: 'Emitir',
        fieldsHtml: fieldHtml({ name: 'vendaId', label: 'ID da venda', type: 'number', required: true, inputmode: 'numeric' })
      });
      if (!data?.vendaId) return;
      try {
        await window.CDSApi.post(`fiscal/emitir/venda/${data.vendaId}`, {});
        showToast('NFC-e solicitada.', 'success');
        window.CDSMobile?.navigate?.('fiscal', { replace: true });
      } catch (err) {
        showToast(err.message || 'Falha na emissão', 'error');
      }
    });

    const all = rows;
    root.querySelector('#fiscal-search')?.addEventListener('input', debounce((e) => {
      const q = String(e.target.value || '').toLowerCase().trim();
      const filtered = !q ? all : all.filter((n) => JSON.stringify(n).toLowerCase().includes(q));
      root.querySelector('#fiscal-count').textContent = countLabel(filtered.length, 'nota', 'notas');
      const list = root.querySelector('#fiscal-list');
      list.innerHTML = filtered.length
        ? filtered.slice(0, 60).map((n) => listCardHtml({
            go: `fiscal/${n.id}`,
            title: `${tipoNota(n)} ${asText(n.numero || n.nNF || n.id)}`,
            subtitle: asText(n.chave || n.chave_acesso || n.venda_codigo),
            value: formatMoney(n.valor_total ?? n.total ?? n.venda_total ?? 0),
            status: situacaoNota(n),
            meta: [formatDateTime(n.created_at || n.data_emissao)].filter((x) => x !== '—')
          })).join('')
        : emptyHtml('Nenhuma nota no filtro');
      bindGo(list);
    }, 200));
  } catch (err) {
    root.innerHTML = errorHtml(err.message || 'Erro ao carregar fiscal.', err.status);
    showToast(err.message || 'Erro fiscal', 'error');
  }
}

export async function renderDetail(root, id) {
  root.innerHTML = loadingHtml();
  try {
    const n = await window.CDSApi.get(`fiscal/notas/${id}`);
    const vendaId = n.venda_id || n.vendaId;

    root.innerHTML = `
      ${backBarHtml('Fiscal')}
      <article class="cds-card cds-m-enter">
        <div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:8px">
          <h3 class="cds-card__title" style="margin:0">${escapeHtml(tipoNota(n))} ${escapeHtml(asText(n.numero || n.nNF || id))}</h3>
          ${statusBadgeHtml(situacaoNota(n))}
        </div>
        <div class="cds-row"><span>Chave</span><strong class="cds-mobile-break">${escapeHtml(asText(n.chave || n.chave_acesso))}</strong></div>
        <div class="cds-row"><span>Venda</span><strong>${escapeHtml(asText(n.venda_codigo || vendaId))}</strong></div>
        <div class="cds-row"><span>Total</span><strong>${escapeHtml(formatMoney(n.valor_total ?? n.total ?? n.venda_total ?? 0))}</strong></div>
        <div class="cds-row"><span>Modelo</span><strong>${escapeHtml(asText(n.modelo || n.tipo))}</strong></div>
        <div class="cds-row"><span>Emitida</span><strong>${escapeHtml(formatDateTime(n.created_at || n.data_emissao))}</strong></div>
        <div class="cds-row"><span>Protocolo</span><strong>${escapeHtml(asText(n.protocolo || n.nProt))}</strong></div>
      </article>
      ${actionBarHtml([
        ...(vendaId ? [{ action: 'danfe', label: 'DANFE', icon: 'receipt', variant: 'secondary' }] : []),
        ...(vendaId ? [{ action: 'share-danfe', label: 'Share DANFE', icon: 'share', variant: 'ghost' }] : []),
        { action: 'share-xml', label: 'Share XML', icon: 'share', variant: 'ghost' },
        ...(canDoAction('cancelar_nfce') ? [{ action: 'cancel', label: 'Cancelar NFC-e', icon: 'trash', variant: 'ghost' }] : []),
        ...(vendaId ? [{ action: 'venda', label: 'Abrir venda', icon: 'cart', variant: 'secondary' }] : [])
      ])}
    `;
    bindBack(root);

    root.querySelector('[data-action="danfe"]')?.addEventListener('click', async () => {
      try {
        const base = window.CDSApi?.resolveApiBase?.() || '/api';
        const res = await fetch(`${base}/fiscal/danfe/venda/${vendaId}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` }
        });
        if (!res.ok) throw new Error('DANFE indisponível');
        const html = await res.text();
        const w = window.open('', '_blank');
        if (w) {
          w.document.write(html);
          w.document.close();
        } else showToast('Permita pop-ups.', 'warning');
      } catch (err) {
        showToast(err.message || 'Falha DANFE', 'error');
      }
    });

    root.querySelector('[data-action="share-danfe"]')?.addEventListener('click', async () => {
      try {
        const base = window.CDSApi?.resolveApiBase?.() || '/api';
        const res = await fetch(`${base}/fiscal/danfe/venda/${vendaId}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` }
        });
        if (!res.ok) throw new Error('DANFE indisponível');
        await shareTextAsFile(`danfe-${id}.html`, await res.text(), 'text/html');
      } catch (err) {
        showToast(err.message || 'Falha ao compartilhar', 'error');
      }
    });

    root.querySelector('[data-action="share-xml"]')?.addEventListener('click', async () => {
      const xml = n.xml_autorizado || n.xml || n.xml_retorno || '';
      if (!xml) {
        showToast('XML não disponível nesta nota.', 'warning');
        return;
      }
      await shareTextAsFile(`nfce-${id}.xml`, xml, 'application/xml');
    });

    root.querySelector('[data-action="cancel"]')?.addEventListener('click', async () => {
      const data = await promptSheet({
        title: 'Cancelar NFC-e',
        confirmLabel: 'Cancelar',
        fieldsHtml: fieldHtml({
          name: 'justificativa',
          label: 'Justificativa (mín. 15 caracteres)',
          type: 'textarea',
          required: true
        })
      });
      if (!data?.justificativa) return;
      try {
        await window.CDSApi.post(`fiscal/notas/${id}/cancelar`, { justificativa: data.justificativa });
        showToast('Cancelamento enviado.', 'success');
        window.CDSMobile?.navigate?.(`fiscal/${id}`, { replace: true });
      } catch (err) {
        showToast(err.message || 'Falha ao cancelar', 'error');
      }
    });

    root.querySelector('[data-action="venda"]')?.addEventListener('click', () => {
      window.CDSMobile?.navigate?.(`pdv/venda/${vendaId}`);
    });
  } catch (err) {
    root.innerHTML = `${backBarHtml('Fiscal')}${errorHtml(err.message, err.status)}`;
    bindBack(root);
  }
}

export async function renderConfig(root) {
  root.innerHTML = loadingHtml('Configuração fiscal…');
  try {
    let config = {};
    try {
      config = await window.CDSApi.get('fiscal/config') || {};
    } catch (e) {
      config = await window.CDSApi.get('configuracoes/fiscal').catch(() => ({}));
    }

    root.innerHTML = `
      ${backBarHtml('Fiscal')}
      <h2 class="cds-page-title" style="font-size:1.15rem;margin:8px 0">Configuração fiscal</h2>
      <p class="cds-muted">PUT /api/fiscal/config — mesmas chaves do Desktop.</p>
      ${formCardHtml('Emissão', [
        cadastroSectionHtml('Ambiente e série'),
        `<label class="cds-field"><span>Ambiente</span>
          <select name="ambiente" class="cds-field__input">
            <option value="homologacao" ${(config.ambiente || config.modo) === 'homologacao' ? 'selected' : ''}>Homologação</option>
            <option value="producao" ${(config.ambiente || config.modo) === 'producao' ? 'selected' : ''}>Produção</option>
          </select>
        </label>`,
        fieldHtml({ name: 'serie_nfce', label: 'Série NFC-e', value: config.serie_nfce || config.serie || '1' }),
        fieldHtml({ name: 'serie_nfe', label: 'Série NF-e', value: config.serie_nfe || '' }),
        fieldHtml({ name: 'numero_nfce', label: 'Próximo nº NFC-e', value: config.numero_nfce || config.proximo_numero || '', inputmode: 'numeric' }),
        fieldHtml({ name: 'csc_id', label: 'CSC ID', value: config.csc_id || config.id_csc || '' }),
        fieldHtml({ name: 'csc', label: 'CSC', value: config.csc || config.csc_token || '', type: 'password' }),
        fieldHtml({ name: 'razao_social', label: 'Razão social emitente', value: config.razao_social || '' }),
        fieldHtml({ name: 'cnpj', label: 'CNPJ', value: config.cnpj || '', inputmode: 'numeric' }),
        fieldHtml({ name: 'ie', label: 'IE', value: config.ie || '' })
      ].join(''), isAdmin() || canDoAction('emitir_nfce')
        ? `<button type="submit" class="cds-mobile-btn">Salvar</button>`
        : '<p class="cds-muted">Sem permissão para editar.</p>')}

      ${sectionTitleHtml('Certificado A1')}
      <article class="cds-card">
        <p class="cds-muted">Upload multipart — POST /api/fiscal/certificado/upload</p>
        <input type="file" id="fis-cert" accept=".pfx,.p12,application/x-pkcs12" style="width:100%;margin:8px 0">
        ${fieldHtml({ name: 'senha_cert', label: 'Senha do certificado', type: 'password' })}
        <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" id="fis-cert-up" style="width:100%">Enviar certificado</button>
        <button type="button" class="cds-mobile-btn cds-mobile-btn--ghost" id="fis-cert-test" style="width:100%;margin-top:8px">Testar certificado</button>
      </article>
    `;
    bindBack(root);

    root.querySelector('#cds-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!isAdmin() && !canDoAction('emitir_nfce')) return;
      const d = collectForm(e.target);
      try {
        await window.CDSApi.put('fiscal/config', d);
        showToast('Configuração fiscal salva.', 'success');
      } catch (err) {
        showToast(err.message || 'Falha ao salvar', 'error');
      }
    });

    root.querySelector('#fis-cert-up')?.addEventListener('click', async () => {
      const file = root.querySelector('#fis-cert')?.files?.[0];
      const senha = root.querySelector('[name="senha_cert"]')?.value || '';
      if (!file) {
        showToast('Selecione o arquivo .pfx', 'warning');
        return;
      }
      const fd = new FormData();
      fd.append('certificado', file);
      fd.append('senha', senha);
      try {
        const base = window.CDSApi.resolveApiBase();
        const res = await fetch(`${base}/fiscal/certificado/upload`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
          body: fd
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || 'Upload falhou');
        showToast('Certificado enviado.', 'success');
      } catch (err) {
        showToast(err.message || 'Falha no upload', 'error');
      }
    });

    root.querySelector('#fis-cert-test')?.addEventListener('click', async () => {
      try {
        await window.CDSApi.post('fiscal/config/certificado/testar', {});
        showToast('Certificado OK.', 'success');
      } catch (err) {
        showToast(err.message || 'Falha no teste', 'error');
      }
    });
  } catch (err) {
    root.innerHTML = `${backBarHtml('Fiscal')}${errorHtml(err.message, err.status)}`;
    bindBack(root);
  }
}

export async function render(root, parsed) {
  const sub = parsed?.parts?.[1];
  if (sub === 'config') return renderConfig(root);
  if (sub) return renderDetail(root, sub);
  return renderFiscal(root);
}

export default { render, renderDetail, renderConfig, title: 'Fiscal', subtitle: 'Operacional' };
