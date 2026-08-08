/**
 * TiposComerciaisController — HTTP (RCM-7.1)
 */

const tiposComerciaisService = require('./TiposComerciaisService');

function responderErro(res, error, mensagemPadrao, statusPadrao = 500) {
  const status = error.statusCode || statusPadrao;
  return res.status(status).json({
    success: false,
    erro: error.message || mensagemPadrao
  });
}

async function listar(req, res) {
  try {
    const tipos = await tiposComerciaisService.listar(req.query || {});
    res.json(tipos);
  } catch (error) {
    responderErro(res, error, 'Erro ao listar tipos comerciais');
  }
}

async function buscarPorId(req, res) {
  try {
    const tipo = await tiposComerciaisService.buscarPorId(req.params.id);
    if (!tipo) {
      return res.status(404).json({ success: false, erro: 'Tipo comercial não encontrado' });
    }
    res.json(tipo);
  } catch (error) {
    responderErro(res, error, 'Erro ao buscar tipo comercial');
  }
}

async function criar(req, res) {
  try {
    const tipo = await tiposComerciaisService.criar(req.body || {});
    res.status(201).json(tipo);
  } catch (error) {
    responderErro(res, error, 'Erro ao criar tipo comercial', 400);
  }
}

async function atualizar(req, res) {
  try {
    const tipo = await tiposComerciaisService.atualizar(req.params.id, req.body || {});
    res.json(tipo);
  } catch (error) {
    responderErro(res, error, 'Erro ao atualizar tipo comercial', error.statusCode || 400);
  }
}

async function excluir(req, res) {
  try {
    await tiposComerciaisService.excluir(req.params.id);
    res.json({ message: 'Tipo comercial excluído com sucesso' });
  } catch (error) {
    responderErro(res, error, 'Erro ao excluir tipo comercial', error.statusCode || 500);
  }
}

async function resolverCanalCliente(req, res) {
  try {
    const resultado = await tiposComerciaisService.resolverCanalOperacao(req.body || {});
    res.json(resultado);
  } catch (error) {
    responderErro(res, error, 'Erro ao resolver canal pelo tipo comercial', 400);
  }
}

async function validarCanal(req, res) {
  try {
    const body = req.body || {};
    const canal = String(body.canal || body.canal_codigo || '').trim().toUpperCase();

    if (body.cliente_id) {
      const op = await tiposComerciaisService.resolverCanalOperacao({
        cliente_id: body.cliente_id
      });
      const ok = (op.canais_permitidos_codigos || []).includes(canal);
      return res.json({
        permitido: ok,
        canal,
        tipo_comercial_codigo: op.tipo_comercial_codigo,
        canais_permitidos_codigos: op.canais_permitidos_codigos,
        canal_padrao: op.canal_padrao
      });
    }

    const chave = body.tipo_comercial_id || body.tipo_comercial_codigo;
    const permitido = await tiposComerciaisService.canalPermitido(chave, canal);
    res.json({ permitido: !!permitido, canal });
  } catch (error) {
    responderErro(res, error, 'Erro ao validar canal permitido', 400);
  }
}

module.exports = {
  listar,
  buscarPorId,
  criar,
  atualizar,
  excluir,
  resolverCanalCliente,
  validarCanal
};
