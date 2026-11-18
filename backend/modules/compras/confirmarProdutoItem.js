/**
 * Decide o produto_id definitivo de um item de compra antes da entrada no estoque.
 *
 * Aceita somente:
 * - produto_id informado (escolhido/confirmado pelo usuário) e existente;
 * - vínculo automático do MIIP (AUTO_VINCULAR: GTIN exato ou associação
 *   fornecedor + código já confirmada).
 * Sugestões do MIIP e coincidências de código/nome nunca viram vínculo.
 */

const { mapearDecisaoPipelineParaImportacao } = require('../../motores/miip/utils/MiipResultadoImportacaoMapper');
const { resolverProdutoItemCompra } = require('./resolverProdutoItem');

function produtoIdConfiavelMiip(miipResp) {
  if (!miipResp || miipResp.desabilitado || !miipResp.resultado) return null;
  const decisao = mapearDecisaoPipelineParaImportacao(miipResp, miipResp.resultado);
  if (!decisao.associadoAutomaticamente) return null;
  const produtoId = Number(decisao.produtoEncontrado?.id);
  return Number.isFinite(produtoId) && produtoId > 0 ? produtoId : null;
}

async function confirmarProdutoItemCompra(db, item = {}, opcoes = {}) {
  const miip = opcoes.miip || null;
  if (Number(item.produto_id) > 0 || !miip || !miip.estaHabilitado()) {
    return resolverProdutoItemCompra(db, item);
  }

  let produtoId = null;
  try {
    produtoId = produtoIdConfiavelMiip(await miip.identificar(item, opcoes.contexto));
  } catch (err) {
    if (typeof miip.registrarIntegracao === 'function') {
      miip.registrarIntegracao({
        evento: 'miip_erro_item_pendente',
        item,
        erro: err?.message || String(err),
        motivo: 'erro MIIP — item permanece pendente de vínculo'
      });
    }
  }

  if (produtoId) return resolverProdutoItemCompra(db, { ...item, produto_id: produtoId });
  return resolverProdutoItemCompra(db, item);
}

module.exports = {
  produtoIdConfiavelMiip,
  confirmarProdutoItemCompra
};
