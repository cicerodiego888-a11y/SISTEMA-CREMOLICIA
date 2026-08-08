/**
 * DiagnosticoComercialController (RCM-04.6 / RCM-05.6)
 */

const diagnosticoComercialService = require('./DiagnosticoComercialService');

async function listar(req, res) {
  try {
    const resultado = await diagnosticoComercialService.listar({
      busca: req.query.busca || req.query.q,
      canal: req.query.canal,
      limit: req.query.limit
    });
    res.json(resultado);
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      erro: error.message || 'Erro no diagnóstico comercial'
    });
  }
}

async function diagnosticarProduto(req, res) {
  try {
    const resultado = await diagnosticoComercialService.diagnosticarProduto(req.params.produtoId, {
      canal: req.query.canal || req.body?.canal,
      itens: req.body?.itens
    });
    res.json(resultado);
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      erro: error.message || 'Erro ao diagnosticar produto'
    });
  }
}

async function consistencia(req, res) {
  try {
    res.json(await diagnosticoComercialService.consistenciaCategoriaLinha());
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      erro: error.message || 'Erro ao validar consistência'
    });
  }
}

async function corrigir(req, res) {
  try {
    res.json(await diagnosticoComercialService.corrigirCategoriaLinha());
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      erro: error.message || 'Erro ao corrigir inconsistências'
    });
  }
}

module.exports = {
  listar,
  diagnosticarProduto,
  consistencia,
  corrigir
};
