/**
 * CanaisVendaController — Camada HTTP de canais de venda (RCM-04.1)
 */

const canaisVendaService = require('./CanaisVendaService');

function responderErro(res, error, mensagemPadrao, statusPadrao = 500) {
  const status = error.statusCode || statusPadrao;
  return res.status(status).json({
    success: false,
    erro: error.message || mensagemPadrao
  });
}

async function listar(req, res) {
  try {
    const canais = await canaisVendaService.listar(req.query || {});
    res.json(canais);
  } catch (error) {
    responderErro(res, error, 'Erro ao listar canais de venda');
  }
}

async function buscarPorId(req, res) {
  try {
    const canal = await canaisVendaService.buscarPorId(req.params.id);
    if (!canal) {
      return res.status(404).json({ success: false, erro: 'Canal de venda não encontrado' });
    }
    res.json(canal);
  } catch (error) {
    responderErro(res, error, 'Erro ao buscar canal de venda');
  }
}

async function criar(req, res) {
  try {
    const canal = await canaisVendaService.criar(req.body || {});
    res.status(201).json(canal);
  } catch (error) {
    responderErro(res, error, 'Erro ao criar canal de venda', 400);
  }
}

async function atualizar(req, res) {
  try {
    const canal = await canaisVendaService.atualizar(req.params.id, req.body || {});
    res.json(canal);
  } catch (error) {
    responderErro(res, error, 'Erro ao atualizar canal de venda', error.statusCode || 400);
  }
}

async function excluir(req, res) {
  try {
    await canaisVendaService.excluir(req.params.id);
    res.json({ message: 'Canal de venda excluído com sucesso' });
  } catch (error) {
    responderErro(res, error, 'Erro ao excluir canal de venda', error.statusCode || 500);
  }
}

module.exports = {
  listar,
  buscarPorId,
  criar,
  atualizar,
  excluir
};
