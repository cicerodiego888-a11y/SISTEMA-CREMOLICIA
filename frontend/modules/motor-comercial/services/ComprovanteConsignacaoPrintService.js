/**
 * Reimpressão do comprovante de consignação a partir do snapshot da operação.
 * Sem POST, sem ledger, sem estoque, sem Resolver.
 */

const {
  buildComprovanteConsignacaoHtml,
  reimpressaoSomenteLeitura
} = require('../pages/PerfilComercial/historicoConsignacoesMappers');

function imprimirComprovanteConsignacao(detalhe) {
  const html = buildComprovanteConsignacaoHtml(detalhe);
  if (typeof window === 'undefined' || typeof window.open !== 'function') {
    return { html, efeitos: reimpressaoSomenteLeitura() };
  }
  const win = window.open('', '_blank', 'noopener,noreferrer,width=720,height=840');
  if (!win) {
    return { html, efeitos: reimpressaoSomenteLeitura(), bloqueado: true };
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  try {
    win.print();
  } catch (_e) {
    /* impressão pode ser cancelada pelo usuário */
  }
  return { html, efeitos: reimpressaoSomenteLeitura() };
}

module.exports = {
  imprimirComprovanteConsignacao,
  buildComprovanteConsignacaoHtml,
  reimpressaoSomenteLeitura
};
