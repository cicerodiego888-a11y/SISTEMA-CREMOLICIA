/**
 * ConfiguracaoComercialController (RCM-04.5)
 */

const configuracaoComercialService = require('./ConfiguracaoComercialService');

function responderErro(res, error, padrao, statusPadrao = 500) {
  return res.status(error.statusCode || statusPadrao).json({
    success: false,
    erro: error.message || padrao
  });
}

async function obter(req, res) {
  try {
    const config = await configuracaoComercialService.obter();
    res.json(config);
  } catch (error) {
    responderErro(res, error, 'Erro ao obter configuração comercial');
  }
}

async function salvar(req, res) {
  try {
    const config = await configuracaoComercialService.salvar(req.body || {});
    res.json(config);
  } catch (error) {
    responderErro(res, error, 'Erro ao salvar configuração comercial', 400);
  }
}

async function resolverCanal(req, res) {
  try {
    const resultado = await configuracaoComercialService.resolverCanal(req.body || {});
    res.json(resultado);
  } catch (error) {
    responderErro(res, error, 'Erro ao resolver canal de venda', 400);
  }
}

async function resolverPrecosVenda(req, res) {
  try {
    const resultado = await configuracaoComercialService.resolverPrecosVenda(req.body || {});
    res.json(resultado);
  } catch (error) {
    responderErro(res, error, 'Erro ao resolver preços da venda', 400);
  }
}

async function compararTabelas(req, res) {
  try {
    const resultado = await configuracaoComercialService.compararTabelas(req.body || {});
    res.json(resultado);
  } catch (error) {
    responderErro(res, error, 'Erro ao comparar tabelas', 400);
  }
}

module.exports = {
  obter,
  salvar,
  resolverCanal,
  resolverPrecosVenda,
  compararTabelas
};
