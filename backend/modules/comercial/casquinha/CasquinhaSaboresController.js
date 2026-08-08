/**
 * CasquinhaSaboresController (RCM-05.4 / RCM-05.8)
 */

const casquinhaSaboresService = require('./CasquinhaSaboresService');
const CasquinhaBuilderService = require('./CasquinhaBuilderService');

function responderErro(res, error, padrao, statusPadrao = 500) {
  const payload = {
    success: false,
    erro: error.message || padrao
  };
  if (error.code) payload.code = error.code;
  return res.status(error.statusCode || statusPadrao).json(payload);
}

async function listar(req, res) {
  try {
    const sabores = await casquinhaSaboresService.listar({
      ativos: req.query.ativos
    });
    res.json(sabores);
  } catch (error) {
    responderErro(res, error, 'Erro ao listar sabores');
  }
}

async function buscarPorId(req, res) {
  try {
    const sabor = await casquinhaSaboresService.buscarPorId(req.params.id);
    if (!sabor) return res.status(404).json({ success: false, erro: 'Sabor não encontrado' });
    res.json(sabor);
  } catch (error) {
    responderErro(res, error, 'Erro ao buscar sabor');
  }
}

async function criar(req, res) {
  try {
    const sabor = await casquinhaSaboresService.criar(req.body || {});
    res.status(201).json(sabor);
  } catch (error) {
    responderErro(res, error, 'Erro ao criar sabor', 400);
  }
}

async function atualizar(req, res) {
  try {
    res.json(await casquinhaSaboresService.atualizar(req.params.id, req.body || {}));
  } catch (error) {
    responderErro(res, error, 'Erro ao atualizar sabor', error.statusCode || 400);
  }
}

async function desativar(req, res) {
  try {
    res.json(await casquinhaSaboresService.desativar(req.params.id));
  } catch (error) {
    responderErro(res, error, 'Erro ao desativar sabor', error.statusCode || 400);
  }
}

async function validarMontagem(req, res) {
  try {
    const resultado = CasquinhaBuilderService.validarMontagem(req.body || {});
    res.json(resultado);
  } catch (error) {
    responderErro(res, error, 'Montagem inválida', 400);
  }
}

async function opcoesBolas(req, res) {
  try {
    res.json({
      opcoes: CasquinhaBuilderService.opcoesBolas(req.query || {}),
      limites: CasquinhaBuilderService.resolverLimites(req.query || {})
    });
  } catch (error) {
    responderErro(res, error, 'Erro ao montar opções');
  }
}

module.exports = {
  listar,
  buscarPorId,
  criar,
  atualizar,
  desativar,
  validarMontagem,
  opcoesBolas
};
