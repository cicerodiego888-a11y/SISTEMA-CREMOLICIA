/**
 * RCM-8.13 — Exibição do comprovante completo atualizado (somente frontend).
 *
 * @module frontend/modules/motor-comercial/services/comprovanteAtualizadoEntrega
 */

function renderComprovanteTexto(comprovante = {}) {
  const lines = [];
  lines.push(`CONSIGNAÇÃO Nº ${comprovante.numeroConsignacao || '—'}`);
  lines.push('');
  lines.push(comprovante.titulo || `COMPROVANTE DE ENTREGA Nº ${comprovante.numeroComprovante || '001'}`);
  lines.push('');

  for (const item of comprovante.listaCompleta || []) {
    const nome = String(item.produtoNome || '').padEnd(28, '.');
    lines.push(`${nome} ${item.quantidade}`);
  }

  if (comprovante.atualizacao) {
    lines.push('');
    lines.push(comprovante.atualizacao.titulo);
    lines.push('');
    lines.push(comprovante.atualizacao.tipo);
    lines.push('');

    for (const item of comprovante.atualizacao.itens || []) {
      lines.push(item.produtoNome || `Produto #${item.produtoId}`);
      if (item.afetado) {
        lines.push(`Quantidade anterior: ${item.quantidadeAnterior}`);
        if (item.complemento != null) lines.push(`Complemento: ${item.complemento}`);
        if (item.alteracao != null) lines.push(`Alteração: ${item.alteracao}`);
        lines.push(`Quantidade atual: ${item.quantidadeAtual}`);
      } else {
        lines.push(`Quantidade atual: ${item.quantidadeAtual}`);
      }
      lines.push('');
    }

    if (comprovante.atualizacao.motivo) {
      lines.push('Motivo:');
      lines.push(String(comprovante.atualizacao.motivo));
      lines.push('');
    }
  }

  lines.push(comprovante.totalAtualLabel
    || `TOTAL ATUAL DA CONSIGNAÇÃO: ${comprovante.quantidadeTotalAtual ?? 0}`);

  return lines.join('\n');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function montarHtmlDocumentoComprovante(texto, titulo) {
  const safe = escapeHtml(texto);
  const safeTitle = escapeHtml(titulo || 'Comprovante de Entrega');
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>${safeTitle}</title>
  <style>
    body { margin: 0; padding: 24px; font-family: ui-monospace, Consolas, monospace; font-size: 13px; line-height: 1.45; color: #0f172a; }
    pre { margin: 0; white-space: pre-wrap; word-break: break-word; }
    @media print { body { padding: 12px; } }
  </style>
</head>
<body><pre>${safe}</pre></body>
</html>`;
}

function montarHtmlComprovante(comprovante = {}, consignacao = {}) {
  const numeroCons = consignacao?.documento?.numero
    || comprovante.numeroConsignacao
    || `CONS-${consignacao?.id || ''}`;

  const dados = {
    ...comprovante,
    numeroConsignacao: numeroCons
  };

  const texto = typeof comprovante.texto === 'string' && comprovante.texto
    ? comprovante.texto
    : renderComprovanteTexto(dados);

  const pre = document.createElement('pre');
  pre.className = 'cds-comprovante-atualizado__texto';
  pre.style.cssText = [
    'white-space:pre-wrap',
    'word-break:break-word',
    'font-family:ui-monospace,Consolas,monospace',
    'font-size:13px',
    'line-height:1.45',
    'margin:0',
    'padding:16px',
    'background:#f8fafc',
    'border:1px solid #e2e8f0',
    'border-radius:8px',
    'max-height:60vh',
    'overflow:auto'
  ].join(';');
  pre.textContent = texto;
  return pre;
}

function injetarHtmlNoIframe(iframe, html) {
  let objectUrl = null;
  const tentarWrite = () => {
    try {
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!doc) return false;
      doc.open();
      doc.write(html);
      doc.close();
      return true;
    } catch (_error) {
      return false;
    }
  };

  if (!tentarWrite()) {
    objectUrl = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    iframe.src = objectUrl;
  }

  return () => {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
  };
}

function openModalLocal(backdrop) {
  requestAnimationFrame(() => {
    backdrop.classList.add('cds-modal-backdrop--open', 'is-open');
  });
  document.body.appendChild(backdrop);
}

function closeModalLocal(backdrop) {
  backdrop.classList.remove('cds-modal-backdrop--open', 'is-open');
  setTimeout(() => backdrop.remove(), 250);
}

/**
 * Modal próprio com <pre> (preserva quebras de linha) + impressão via iframe.
 * Evita choiceDialog (<p> colapsa \n) e window.open (Electron abre em branco).
 *
 * @param {{ consignacao?: Object, comprovante: Object }} options
 * @returns {Promise<string|null>} 'ok' | 'print' | null
 */
async function exibirDialogoComprovanteAtualizado(options = {}) {
  const { consignacao, comprovante } = options;
  if (!comprovante) return null;

  const titulo = comprovante.titulo
    || `COMPROVANTE DE ENTREGA Nº ${comprovante.numeroComprovante || '001'}`;

  const texto = renderComprovanteTexto({
    ...comprovante,
    numeroConsignacao: consignacao?.documento?.numero || comprovante.numeroConsignacao
  });

  if (typeof document === 'undefined') {
    // eslint-disable-next-line no-alert
    if (typeof window !== 'undefined' && window.alert) window.alert(texto.slice(0, 1800));
    return 'ok';
  }

  try {
    const Modal = require('../components/navigation/Modal');
    const Button = require('../components/base/Button');

    return await new Promise((resolve) => {
      const content = document.createElement('div');
      content.style.cssText = 'display:flex;flex-direction:column;gap:12px;min-width:min(520px,92vw);';

      const pre = montarHtmlComprovante(comprovante, consignacao);
      content.appendChild(pre);

      const iframe = document.createElement('iframe');
      iframe.title = titulo;
      iframe.setAttribute('aria-hidden', 'true');
      iframe.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none;';
      content.appendChild(iframe);

      let cleanupIframe = () => {};
      let backdrop = null;
      let resolved = false;

      const finish = (value) => {
        if (resolved) return;
        resolved = true;
        cleanupIframe();
        if (backdrop) closeModalLocal(backdrop);
        resolve(value);
      };

      const imprimir = () => {
        try {
          cleanupIframe = injetarHtmlNoIframe(
            iframe,
            montarHtmlDocumentoComprovante(texto, titulo)
          );
          const win = iframe.contentWindow;
          if (!win) {
            const blob = new Blob(
              [montarHtmlDocumentoComprovante(texto, titulo)],
              { type: 'text/html;charset=utf-8' }
            );
            const url = URL.createObjectURL(blob);
            const w = window.open(url, '_blank');
            if (w) {
              setTimeout(() => {
                try { w.focus(); w.print(); } catch (_e) { /* ignore */ }
                setTimeout(() => URL.revokeObjectURL(url), 60_000);
              }, 300);
            }
            return;
          }
          setTimeout(() => {
            try {
              win.focus();
              win.print();
            } catch (_e) { /* ignore */ }
          }, 150);
        } catch (_error) {
          // eslint-disable-next-line no-alert
          window.alert(texto.slice(0, 1800));
        }
      };

      const footer = document.createElement('div');
      footer.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;';
      footer.appendChild(Button.create({
        text: 'Imprimir',
        variant: 'primary',
        onClick: () => {
          imprimir();
        }
      }));
      footer.appendChild(Button.create({
        text: 'Fechar',
        variant: 'secondary',
        onClick: () => finish('ok')
      }));

      backdrop = Modal.create({
        title: titulo,
        content,
        footer,
        open: false,
        onClose: () => finish(null)
      });

      const modal = backdrop.querySelector('.cds-modal');
      if (modal) {
        modal.style.maxWidth = '640px';
        modal.style.width = '92vw';
      }

      openModalLocal(backdrop);
    });
  } catch (_e) {
    // eslint-disable-next-line no-alert
    if (typeof window !== 'undefined' && window.alert) {
      window.alert(texto.slice(0, 1800));
    }
    return 'ok';
  }
}

/**
 * Após registro bem-sucedido de complementação/alteração:
 * reutiliza comprovante da resposta ou busca reimpressão somente leitura.
 * NÃO re-registra entrega.
 *
 * @param {Object} options
 * @returns {Promise<Object|null>}
 */
async function emitirComprovanteAposOperacaoEntrega(options = {}) {
  const {
    api = null,
    consignacaoId = null,
    consignacao = null,
    resultado = null,
    exibir = true
  } = options;

  let comprovante = resultado?.comprovante || null;
  const correlationId = resultado?.correlationId || null;
  const id = consignacaoId
    ?? resultado?.consignacao?.id
    ?? consignacao?.id
    ?? null;

  if (!comprovante && correlationId && id != null && api?.obterComprovanteEntregaHistorico) {
    try {
      const payload = await api.obterComprovanteEntregaHistorico(id, correlationId);
      comprovante = payload?.comprovante || payload || null;
    } catch (_e) {
      comprovante = null;
    }
  }

  if (!comprovante && Array.isArray(resultado?.entregas) && correlationId) {
    const ev = resultado.entregas.find((e) => String(e.correlationId) === String(correlationId));
    comprovante = ev?.comprovante || null;
  }

  if (!comprovante) return null;

  if (exibir) {
    await exibirDialogoComprovanteAtualizado({
      consignacao: resultado?.consignacao || consignacao,
      comprovante
    });
  }

  return comprovante;
}

module.exports = {
  montarHtmlComprovante,
  montarHtmlDocumentoComprovante,
  exibirDialogoComprovanteAtualizado,
  emitirComprovanteAposOperacaoEntrega,
  renderComprovanteTexto
};
