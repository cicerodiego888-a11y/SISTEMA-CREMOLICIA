/**
 * Motor de Unidades Comerciais (MUC)
 *
 * RCM-8.8/8.9: Unidade Base no produto; UC na tabela; conversões canônicas + produto_conversoes.
 */

const conversor = require('./converters/ConversorUnidades');
const validator = require('./validators/UnidadeComercialValidator');
const repository = require('./repositories/ProdutoUnidadeRepository');
const service = require('./services/ProdutoUnidadeService');
const conversaoService = require('./services/ProdutoConversaoService');
const conversaoRepository = require('./repositories/ProdutoConversaoRepository');
const { bootstrapMucSchema } = require('./migrations/001_produto_unidades');
const { bootstrapProdutoConversoesSchema } = require('./migrations/002_produto_conversoes');

async function bootstrapMucCompleto(db) {
  await bootstrapMucSchema(db);
  await bootstrapProdutoConversoesSchema(db);
}

const MotorUnidadesComerciais = {
  versao: '1.1.0-rcm89',
  conversor,
  validator,
  repository,
  service,
  conversaoService,
  conversaoRepository,
  bootstrapMucSchema: bootstrapMucCompleto,
  bootstrapProdutoConversoesSchema,

  paraBase: conversor.paraBase,
  deBase: conversor.deBase,
  resolverBaixaEstoque: conversor.resolverBaixaEstoque,
  resolverEntradaEstoque: conversor.resolverEntradaEstoque,
  resolverFatorConversao: conversor.resolverFatorConversao,
  normalizarCodigoUnidade: conversor.normalizarCodigoUnidade,
  resolverFatorNasConversoes: conversaoService.resolverFatorNasConversoes,

  listar: service.listar,
  criar: service.criar,
  atualizar: service.atualizar,
  excluir: service.excluir,
  marcarPrincipal: service.marcarPrincipal,
  garantirUnidadeBase: service.garantirUnidadeBase,
  resolverPorBarras: service.resolverPorBarras,
  obterUnidadeVenda: service.obterUnidadeVenda,
  montarPayloadVenda: service.montarPayloadVenda,

  listarConversoes: conversaoService.listar,
  listarConversoesAtivas: conversaoService.listarAtivas,
  criarConversao: conversaoService.criar,
  atualizarConversao: conversaoService.atualizar,
  excluirConversao: conversaoService.excluir,
  simularConversao: conversaoService.simular
};

module.exports = MotorUnidadesComerciais;
