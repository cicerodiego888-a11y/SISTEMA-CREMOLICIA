/**
 * Módulo Cadastros Comercial V2 — RCM-04.1
 * Fundação: Canais de Venda + Tabelas de Preço
 *
 * NÃO altera regras de preço do PDV/Comercial.
 */

const { aplicarMigrationsComercialV2 } = require('./migrations');
const {
  canaisRouter,
  tabelasRouter,
  configuracaoRouter,
  diagnosticoRouter,
  casquinhaSaboresRouter,
  linhasRouter,
  kitsRouter,
  tiposComerciaisRouter
} = require('./routes/comercialCadastros.routes');

/**
 * @param {Object} db
 * @returns {Promise<void>}
 */
async function bootstrapComercialV2Schema(db) {
  await aplicarMigrationsComercialV2(db);
  try {
    const ComercialPrecoResolver = require('./preco/ComercialPrecoResolver');
    const nVarejo = await ComercialPrecoResolver.aquecerCacheCanal('VAREJO');
    const nAtacado = await ComercialPrecoResolver.aquecerCacheCanal('ATACADO');
    console.log(`[RCM-04.6] Cache preços aquecido (VAREJO=${nVarejo}, ATACADO=${nAtacado}).`);
  } catch (err) {
    console.warn('[RCM-04.6] Falha ao aquecer cache de preços:', err.message);
  }
}

module.exports = {
  bootstrapComercialV2Schema,
  canaisRouter,
  tabelasRouter,
  configuracaoRouter,
  diagnosticoRouter,
  casquinhaSaboresRouter,
  linhasRouter,
  kitsRouter,
  tiposComerciaisRouter,
  ComercialPrecoResolver: require('./preco/ComercialPrecoResolver'),
  CanalVendaResolver: require('./preco/CanalVendaResolver'),
  FormaComercializacao: require('./preco/FormaComercializacao'),
  CategoriaLinhaComercialService: require('./categoria-linha/CategoriaLinhaComercialService'),
  CasquinhaBuilderService: require('./casquinha/CasquinhaBuilderService'),
  KitService: require('./kits/KitService'),
  KitItemService: require('./kits/KitItemService'),
  KitVendaService: require('./kits/KitVendaService'),
  TiposComerciaisService: require('./tipos-comerciais/TiposComerciaisService')
};
