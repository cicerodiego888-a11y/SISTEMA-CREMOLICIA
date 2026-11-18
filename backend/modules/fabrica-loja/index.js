const constants = require('./constants');
const bootstrapUnidadesNegocio = require('./migrations/001_unidades_negocio');
const bootstrapFichasTecnicas = require('./migrations/002_fichas_tecnicas');
const bootstrapNecessidadesProducao = require('./migrations/003_necessidades_producao');
const bootstrapGruposInsumos = require('./migrations/004_grupos_insumos');
const bootstrapOrdensProducao = require('./migrations/005_ordens_producao');
const bootstrapOrdemProducaoExecucoes = require('./migrations/006_ordem_producao_execucoes');
const bootstrapTransferenciasEstoque = require('./migrations/007_transferencias_estoque');
const bootstrapNecessidadePedidos = require('./migrations/008_necessidade_producao_pedidos');
const bootstrapInicioProducao = require('./migrations/009_ordem_producao_inicio');
const bootstrapLinhasProdutos = require('./migrations/010_linhas_produtos');
const bootstrapConversoesEstoqueLinha = require('./migrations/011_conversoes_estoque_linha');
const bootstrapFichasTecnicasPadrao = require('./migrations/012_fichas_tecnicas_padrao');
const bootstrapFichaPadraoSemProduto = require('./migrations/015_fichas_padrao_no_produto');
const bootstrapFichasIndependentes = require('./migrations/016_fichas_independentes');
const bootstrapExclusaoFichasPadrao = require('./migrations/017_exclusao_fichas_padrao');
const bootstrapFichasPorSabor = require('./migrations/018_fichas_por_sabor');
const service = require('./UnidadeNegocioService');
const fichas = require('./FichaTecnicaService');
const fichasPadrao = require('./FichaPadraoService');
const estoqueInsumo = require('./InsumoEstoqueService');
const necessidades = require('./NecessidadeProducaoService');
const gruposInsumos = require('./GrupoInsumoService');
const linhasProdutos = require('./LinhaProdutosService');
const conversaoLinha = require('./ConversaoEstoqueLinhaService');
const produtoLinhaConvertido = require('./produtoLinhaConvertido');
const ordens = require('./OrdemProducaoService');
const producao = require('./ProducaoExecucaoService');
const transferencias = require('./TransferenciaEstoqueService');
const painel = require('./PainelFabricaService');

async function bootstrapFabricaLojaSchema(db) {
  await bootstrapUnidadesNegocio(db);
  await bootstrapFichasTecnicas(db);
  await bootstrapNecessidadesProducao(db);
  await bootstrapGruposInsumos(db);
  await bootstrapOrdensProducao(db);
  await bootstrapOrdemProducaoExecucoes(db);
  await bootstrapTransferenciasEstoque(db);
  await bootstrapNecessidadePedidos(db);
  await bootstrapInicioProducao(db);
  await bootstrapLinhasProdutos(db);
  if (await tabelaExiste(db, 'linhas_produtos')) await bootstrapConversoesEstoqueLinha(db);
  await bootstrapFichasTecnicasPadrao(db);
  await bootstrapFichaPadraoSemProduto(db);
  await bootstrapFichasIndependentes(db);
  await bootstrapExclusaoFichasPadrao(db);
  await bootstrapFichasPorSabor(db);
}

function tabelaExiste(db, nome) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?`, [nome], (err, row) => (err ? reject(err) : resolve(!!row)));
  });
}

module.exports = {
  versao: constants.VERSAO,
  codigo: 'FABRICA-LOJA-02',
  constants,
  bootstrapFabricaLojaSchema,
  ...service,
  ...fichas,
  ...fichasPadrao,
  ...estoqueInsumo,
  ...necessidades,
  ...gruposInsumos,
  ...linhasProdutos,
  ...conversaoLinha,
  ...produtoLinhaConvertido,
  ...ordens,
  ...producao,
  ...transferencias,
  ...painel
};
