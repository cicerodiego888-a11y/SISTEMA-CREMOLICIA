/**
 * CDS Mobile — exibição de cupom fiscal / não fiscal na tela do celular.
 * Sem regras de negócio: só UI + fetch do DANFE oficial.
 */
import { escapeHtml } from './formatters.js';
import { shareTextAsFile } from './native.js';
import { showToast } from './toast.js';

export async function fetchDanfeHtml(vendaId) {
  const base = window.CDSApi.resolveApiBase();
  const token = window.CDSApi.getToken();
  const res = await fetch(`${base}/fiscal/danfe/venda/${vendaId}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'text/html' }
  });
  if (!res.ok) throw new Error(`DANFE HTTP ${res.status}`);
  return res.text();
}

function escapeCupomText(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function montarHtmlCupomNaoFiscal(vendaId, venda = {}) {
  const dataHora = venda.data_venda || venda.created_at
    ? new Date(venda.data_venda || venda.created_at).toLocaleString('pt-BR')
    : new Date().toLocaleString('pt-BR');
  const total = Number(venda.valor_nao_fiscal || venda.total || venda.valor_total || 0);
  const desconto = Number(venda.desconto || 0);
  const forma = venda.forma_pagamento || venda.formaPagamento || '—';
  const cliente = venda.cliente_nome || venda.clienteNome || '';
  const itens = Array.isArray(venda.itens) ? venda.itens : [];
  const itensHtml = itens.map((item) => {
    const nome = String(item.produto_nome || item.nome || item.produtoNome || 'Item').slice(0, 18).padEnd(18, ' ');
    const qtd = Number(item.quantidade_nao_fiscal ?? item.quantidade ?? 0);
    const preco = Number(item.preco_unitario ?? item.precoUnitario ?? item.preco ?? 0);
    const sub = Number(item.valor_nao_fiscal ?? item.subtotal ?? (qtd * preco));
    return `${escapeCupomText(nome)} ${qtd.toFixed(3).padStart(6)} ${preco.toFixed(2).padStart(7)} ${sub.toFixed(2).padStart(7)}`;
  }).join('\n');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cupom não fiscal</title>
<style>body{margin:0;padding:12px;background:#fff;color:#111;font-family:ui-monospace,monospace}
pre{white-space:pre-wrap;word-break:break-word;font-size:13px;line-height:1.35;margin:0}</style></head><body><pre>
${escapeCupomText(venda.nome_empresa || 'CDS Sistemas')}
${escapeCupomText(venda.endereco || '')}

COMPROVANTE NÃO FISCAL
Venda #${escapeCupomText(vendaId)}
${escapeCupomText(dataHora)}

------------------------------------------------
Item                 Qtd Vl.Unit Total
${itensHtml || '(sem itens)'}
------------------------------------------------
Total: R$ ${total.toFixed(2).replace('.', ',')}
Desconto: R$ ${desconto.toFixed(2).replace('.', ',')}
Forma pag.: ${escapeCupomText(forma)}
${cliente ? `Cliente: ${escapeCupomText(cliente)}` : ''}
------------------------------------------------
ESTE COMPROVANTE NÃO POSSUI VALOR FISCAL
OBRIGADO PELA PREFERÊNCIA!
</pre></body></html>`;
}

export function mostrarCupomNoCelular(html, { title = 'Cupom', fileName = 'cupom.html' } = {}) {
  return new Promise((resolve) => {
    document.getElementById('cds-cupom-overlay')?.remove();
    const el = document.createElement('div');
    el.id = 'cds-cupom-overlay';
    el.className = 'cds-cupom-overlay';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', title);
    el.innerHTML = `
      <div class="cds-cupom-overlay__bar">
        <strong class="cds-cupom-overlay__title">${escapeHtml(title)}</strong>
        <button type="button" class="cds-cupom-overlay__x" data-cupom-close aria-label="Fechar">×</button>
      </div>
      <div class="cds-cupom-overlay__body">
        <iframe class="cds-cupom-overlay__frame" id="cds-cupom-frame" title="${escapeHtml(title)}"></iframe>
      </div>
      <div class="cds-cupom-overlay__actions">
        <button type="button" class="cds-mobile-btn cds-mobile-btn--secondary" data-cupom-share>Compartilhar</button>
        <button type="button" class="cds-mobile-btn" data-cupom-close>Fechar</button>
      </div>
    `;
    document.body.appendChild(el);
    document.body.classList.add('is-overlay-open');

    const frame = el.querySelector('#cds-cupom-frame');
    try {
      const doc = frame.contentDocument || frame.contentWindow?.document;
      doc.open();
      doc.write(html);
      doc.close();
    } catch (e) {
      frame.srcdoc = html;
    }

    const finish = () => {
      el.remove();
      if (!document.querySelector('.cds-mobile-drawer.is-open') && !document.getElementById('cds-mobile-sheet')) {
        document.body.classList.remove('is-overlay-open');
      }
      resolve();
    };
    el.querySelectorAll('[data-cupom-close]').forEach((btn) => {
      btn.addEventListener('click', finish);
    });
    el.querySelector('[data-cupom-share]')?.addEventListener('click', async () => {
      try {
        await shareTextAsFile(fileName, html, 'text/html');
      } catch (err) {
        showToast(err?.message || 'Falha ao compartilhar', 'error');
      }
    });
  });
}

function unwrapEmitPayload(raw) {
  const data = raw?.data && typeof raw.data === 'object' && !Array.isArray(raw.data)
    ? { ...raw, ...raw.data }
    : (raw || {});
  const faturamento = data.faturamento && typeof data.faturamento === 'object'
    ? data.faturamento
    : {};
  const nested = data.fiscal && typeof data.fiscal === 'object' ? data.fiscal : {};
  const fiscal = {
    ...data,
    ...nested,
    danfeHtml: nested.danfeHtml || data.danfeHtml || nested.danfe_html || data.danfe_html,
    status: nested.status || data.status || nested.situacao || data.situacao,
    vendaId: nested.vendaId || nested.venda_id || data.vendaId || data.venda_id
  };
  return {
    data,
    faturamento,
    fiscal,
    vendaId: Number(
      faturamento.vendaId
      || fiscal.vendaId
      || data.vendaId
      || data.venda_id
      || 0
    ) || null,
    situacao: String(
      faturamento.situacaoFiscal || fiscal.status || fiscal.situacao || data.status || ''
    ).toUpperCase()
  };
}

async function carregarVenda(vendaId) {
  try {
    const raw = await window.CDSApi.get(`vendas/${vendaId}`);
    const venda = (raw?.data && !Array.isArray(raw.data) ? (raw.data.venda || raw.data) : null)
      || raw?.venda
      || raw;
    if (!venda || typeof venda !== 'object') return null;
    if (!Array.isArray(venda.itens) || !venda.itens.length) {
      try {
        const itensRaw = await window.CDSApi.get(`vendas/${vendaId}/itens`);
        const list = Array.isArray(itensRaw) ? itensRaw : itensRaw?.data || itensRaw?.items || [];
        venda.itens = Array.isArray(list) ? list : [];
      } catch (e) { /* ignore */ }
    }
    return venda;
  } catch (e) {
    return null;
  }
}

/**
 * Após emitir NFC-e: mostra DANFE fiscal ou cupom não fiscal na tela.
 */
export async function mostrarCupomAposEmissao(raw, { vendaIdFallback = null, clienteNome = '' } = {}) {
  const { faturamento, fiscal, vendaId: vid, situacao } = unwrapEmitPayload(raw);
  const vendaId = vid || (vendaIdFallback != null ? Number(vendaIdFallback) : null);
  const sit = situacao || String(faturamento.situacaoFiscal || '').toUpperCase();

  if (fiscal?.danfeHtml || sit === 'AUTORIZADA') {
    let html = fiscal?.danfeHtml || null;
    if (!html && vendaId) {
      try { html = await fetchDanfeHtml(vendaId); } catch (e) { html = null; }
    }
    if (html) {
      showToast('NFC-e autorizada.', 'success');
      await mostrarCupomNoCelular(html, {
        title: 'Cupom fiscal (DANFE NFC-e)',
        fileName: `danfe-venda-${vendaId || 'nfce'}.html`
      });
      return { tipo: 'fiscal', vendaId };
    }
  }

  if ((sit === 'NAO_APLICAVEL' || sit === 'SEM_VENDA' || fiscal?.status === 'sem_venda') && !vendaId) {
    showToast(raw?.mensagem || faturamento.nfceMotivo || 'Emissão não aplicável.', 'info');
    return { tipo: 'nao_aplicavel', vendaId: null };
  }

  if (vendaId) {
    const venda = await carregarVenda(vendaId);
    if (venda) {
      if (clienteNome && !venda.cliente_nome) venda.cliente_nome = clienteNome;
      // Se existir DANFE, prioriza fiscal
      try {
        const danfe = await fetchDanfeHtml(vendaId);
        if (danfe && /html|danfe|nfc/i.test(danfe)) {
          showToast('Cupom fiscal disponível.', 'success');
          await mostrarCupomNoCelular(danfe, {
            title: 'Cupom fiscal (DANFE NFC-e)',
            fileName: `danfe-venda-${vendaId}.html`
          });
          return { tipo: 'fiscal', vendaId };
        }
      } catch (e) { /* cai no não fiscal */ }

      const html = montarHtmlCupomNaoFiscal(vendaId, venda);
      showToast('Comprovante não fiscal.', 'success');
      await mostrarCupomNoCelular(html, {
        title: 'Cupom não fiscal',
        fileName: `cupom-nao-fiscal-${vendaId}.html`
      });
      return { tipo: 'nao_fiscal', vendaId };
    }
  }

  if (/REJEIT|PENDENTE|DENEG/.test(sit)) {
    showToast(faturamento?.nfce?.motivo || fiscal?.motivo || 'NFC-e não autorizada.', 'warning');
    return { tipo: 'rejeitada', vendaId };
  }

  showToast('Emissão concluída, mas o cupom não está disponível.', 'warning');
  return { tipo: 'indisponivel', vendaId };
}

/** Após gravar a venda no PDV Mobile: DANFE se houver, senão comprovante na tela. */
export async function mostrarCupomAposVenda(vendaId, emitirRaw = null) {
  if (!vendaId) return { tipo: 'indisponivel', vendaId: null };
  if (emitirRaw) {
    const r = await mostrarCupomAposEmissao(emitirRaw, { vendaIdFallback: vendaId });
    if (r?.tipo === 'fiscal' || r?.tipo === 'nao_fiscal') return r;
  }
  try {
    const danfe = await fetchDanfeHtml(vendaId);
    if (danfe && danfe.length > 80 && /html|danfe|nfc|cupom/i.test(danfe)) {
      await mostrarCupomNoCelular(danfe, {
        title: 'Cupom fiscal',
        fileName: `danfe-venda-${vendaId}.html`
      });
      return { tipo: 'fiscal', vendaId };
    }
  } catch (e) { /* comprovante não fiscal */ }
  const venda = await carregarVenda(vendaId);
  const html = montarHtmlCupomNaoFiscal(vendaId, venda || {});
  await mostrarCupomNoCelular(html, {
    title: 'Cupom',
    fileName: `cupom-venda-${vendaId}.html`
  });
  return { tipo: 'nao_fiscal', vendaId };
}

export default {
  fetchDanfeHtml,
  montarHtmlCupomNaoFiscal,
  mostrarCupomNoCelular,
  mostrarCupomAposEmissao,
  mostrarCupomAposVenda
};
