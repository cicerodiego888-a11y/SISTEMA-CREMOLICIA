/**
 * Comprovante de Prestação de Contas — exibe PDF oficial do Motor de Comprovantes.
 * RC2.1 — geração independente de NFC-e; sem cálculo no client.
 *
 * @module frontend/modules/motor-comercial/services/ComprovanteFechamentoService
 */

const Modal = require('../components/navigation/Modal');
const Button = require('../components/base/Button');
const MotorComercialApi = require('../api/MotorComercialApi');
const { notify } = require('../utils/operacional');

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getApi() {
  return new MotorComercialApi();
}

async function carregarComprovantePrestacao(consignacaoId) {
  const id = consignacaoId?.id ?? consignacaoId;
  if (!id) {
    throw new Error('Consignação inválida para gerar comprovante.');
  }
  return getApi().obterComprovantePrestacao(id);
}

function exibirComprovanteModal(html, { imprimir = false, titulo = 'Comprovante de Prestação de Contas' } = {}) {
  if (typeof document === 'undefined') {
    notify('Visualização indisponível.', 'warning');
    return false;
  }

  const iframe = document.createElement('iframe');
  iframe.title = titulo;
  iframe.setAttribute('srcdoc', html);
  iframe.style.cssText = 'width:100%;height:75vh;border:0;';

  let backdrop;
  const fechar = () => {
    if (backdrop) {
      backdrop.classList.remove('cds-modal-backdrop--open', 'is-open');
      setTimeout(() => backdrop.remove(), 250);
    }
  };

  const imprimirIframe = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch {
      notify('Não foi possível imprimir.', 'error');
    }
  };

  const footer = document.createElement('div');
  footer.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';
  footer.appendChild(Button.create({ text: 'Imprimir', variant: 'primary', onClick: imprimirIframe }));
  footer.appendChild(Button.create({ text: 'Fechar', variant: 'secondary', onClick: fechar }));

  backdrop = Modal.create({
    title: titulo,
    content: iframe,
    footer,
    open: false,
    onClose: fechar
  });

  document.body.appendChild(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('cds-modal-backdrop--open', 'is-open'));

  if (imprimir) {
    iframe.addEventListener('load', () => setTimeout(imprimirIframe, 350), { once: true });
  }

  return true;
}

function downloadPdfPayload(pdf) {
  if (!pdf?.base64) {
    notify('PDF indisponível no snapshot.', 'warning');
    return { ok: false };
  }
  const bin = atob(pdf.base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: pdf.contentType || 'application/pdf' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = pdf.fileName || 'comprovante-prestacao.pdf';
  a.click();
  URL.revokeObjectURL(a.href);
  return { ok: true };
}

async function abrirComprovantePrestacao(consignacaoId, { imprimir = false } = {}) {
  const comprovante = await carregarComprovantePrestacao(consignacaoId);
  const html = comprovante?.pdf?.html || '';
  if (!html) {
    notify('Comprovante gerado sem HTML de impressão.', 'warning');
    return { ok: false, comprovante };
  }
  exibirComprovanteModal(html, {
    imprimir,
    titulo: `Comprovante ${comprovante.numeroComprovante || 'Prestação'}`
  });
  try {
    await getApi().registrarAcaoComprovante(consignacaoId?.id ?? consignacaoId, {
      acao: imprimir ? 'impressao' : 'visualizacao',
      comprovanteId: comprovante.id,
      numeroComprovante: comprovante.numeroComprovante
    });
  } catch (_e) { /* não bloqueia UX */ }
  return { ok: true, comprovante };
}

/** Compat: gera e abre impressão do Motor (independente de NFC-e). */
async function imprimirComprovante(consignacao) {
  return abrirComprovantePrestacao(consignacao?.id ?? consignacao, { imprimir: true });
}

async function visualizarComprovante(consignacao) {
  return abrirComprovantePrestacao(consignacao?.id ?? consignacao, { imprimir: false });
}

async function exportarComprovantePdf(consignacao) {
  const comprovante = await carregarComprovantePrestacao(consignacao?.id ?? consignacao);
  const result = downloadPdfPayload(comprovante?.pdf);
  if (!result.ok) notify('Erro ao exportar PDF.', 'error');
  else {
    try {
      await getApi().registrarAcaoComprovante(consignacao?.id ?? consignacao, {
        acao: 'pdf',
        comprovanteId: comprovante.id,
        numeroComprovante: comprovante.numeroComprovante
      });
    } catch (_e) { /* noop */ }
  }
  return result;
}

/** Mantido para testes legados — layout oficial agora vem do Motor. */
function montarDadosComprovante({ consignacao = {} } = {}) {
  return {
    titulo: 'Comprovante de Prestação de Contas',
    numeroConsignacao: consignacao.documento || consignacao.id || '—',
    cliente: consignacao.clienteNome || consignacao.cliente || '—'
  };
}

function buildComprovanteHtml(dados) {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapeHtml(dados.titulo || '')}</title></head>
<body><h1>${escapeHtml(dados.titulo || 'Comprovante de Prestação de Contas')}</h1>
<p>Cliente: ${escapeHtml(dados.cliente || '—')}</p>
<p>Emitido pelo CDS Sistemas</p></body></html>`;
}

module.exports = {
  montarDadosComprovante,
  buildComprovanteHtml,
  carregarComprovantePrestacao,
  abrirComprovantePrestacao,
  imprimirComprovante,
  visualizarComprovante,
  exportarComprovantePdf
};
