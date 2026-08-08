/**
 * LinhasComerciaisController (RCM-05.5)
 */

const service = require('./LinhasComerciaisService');

function responderErro(res, error, padrao, statusPadrao = 500) {
  const payload = { success: false, erro: error.message || padrao };
  if (error.code) payload.code = error.code;
  if (error.permite_desativar) payload.permite_desativar = true;
  return res.status(error.statusCode || statusPadrao).json(payload);
}

async function listar(req, res) {
  try {
    res.json(await service.listar(req.query || {}));
  } catch (error) {
    responderErro(res, error, 'Erro ao listar linhas comerciais');
  }
}

async function gradeNova(req, res) {
  try {
    res.json(await service.gradeNova());
  } catch (error) {
    responderErro(res, error, 'Erro ao montar grade');
  }
}

async function buscarPorId(req, res) {
  try {
    const linha = await service.buscarPorId(req.params.id);
    if (!linha) return res.status(404).json({ success: false, erro: 'Linha não encontrada' });
    res.json(linha);
  } catch (error) {
    responderErro(res, error, 'Erro ao buscar linha');
  }
}

async function criar(req, res) {
  try {
    res.status(201).json(await service.criar(req.body || {}));
  } catch (error) {
    responderErro(res, error, 'Erro ao criar linha', 400);
  }
}

async function atualizar(req, res) {
  try {
    res.json(await service.atualizar(req.params.id, req.body || {}));
  } catch (error) {
    responderErro(res, error, 'Erro ao atualizar linha', error.statusCode || 400);
  }
}

async function excluir(req, res) {
  try {
    await service.excluir(req.params.id);
    res.json({ message: 'Linha comercial excluída' });
  } catch (error) {
    responderErro(res, error, 'Erro ao excluir linha', error.statusCode || 500);
  }
}

async function desativar(req, res) {
  try {
    const linha = await service.desativar(req.params.id);
    res.json({ message: 'Linha desativada', ...linha });
  } catch (error) {
    responderErro(res, error, 'Erro ao desativar linha', error.statusCode || 400);
  }
}

async function relatorioMigracao(req, res) {
  try {
    res.json(await service.relatorioMigracao());
  } catch (error) {
    responderErro(res, error, 'Erro ao obter relatório de migração');
  }
}

module.exports = {
  listar,
  gradeNova,
  buscarPorId,
  criar,
  atualizar,
  excluir,
  desativar,
  relatorioMigracao
};
