/**
 * Rotas de Orçamentos e Pedidos — NF-E-04.0.
 * Orçamento aprovado gera pedido (origem ORCAMENTO); pedido direto (origem DIRETO).
 * A venda do pedido só é gerada na confirmação da emissão (POST /:id/emitir-nfe).
 */

'use strict';

const express = require('express');
const { exigirRecurso } = require('../middleware/validarRecursoImplantacao');
const { verificarPermissaoEspecifica } = require('../middleware/auth');
const { contextoAuditoriaRequisicao } = require('../services/auditoria');
const service = require('../services/pedidos/orcamentoPedidoService');

const exigirEmitirNfe = verificarPermissaoEspecifica('NF-E-EMITIR');

function responderErro(res, err) {
  const status = err.statusCode || 500;
  if (status >= 500) console.error('[pedidos]', err.message);
  res.status(status).json({
    success: false,
    mensagem: err.message,
    error: err.message,
    codigo: err.code || null,
    pendencias: err.pendencias || undefined,
    prontidao: err.prontidao || undefined
  });
}

function rota(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      responderErro(res, err);
    }
  };
}

function usuarioId(req) {
  return contextoAuditoriaRequisicao(req).usuario_id || null;
}

const orcamentosRouter = express.Router();

orcamentosRouter.get('/', rota(async (req, res) => {
  res.json(await service.listarOrcamentos({ status: req.query.status }));
}));

orcamentosRouter.get('/:id', rota(async (req, res) => {
  res.json(await service.obterOrcamento(req.params.id));
}));

orcamentosRouter.post('/', rota(async (req, res) => {
  res.status(201).json(await service.criarOrcamento(req.body || {}, { usuarioId: usuarioId(req) }));
}));

orcamentosRouter.put('/:id', rota(async (req, res) => {
  res.json(await service.atualizarOrcamento(req.params.id, req.body || {}));
}));

orcamentosRouter.post('/:id/status', rota(async (req, res) => {
  res.json(await service.alterarStatusOrcamento(req.params.id, (req.body || {}).status));
}));

orcamentosRouter.post('/:id/aprovar', rota(async (req, res) => {
  res.json(await service.aprovarOrcamento(req.params.id, { usuarioId: usuarioId(req) }));
}));

const pedidosRouter = express.Router();

pedidosRouter.get('/', rota(async (req, res) => {
  res.json(await service.listarPedidos({ status: req.query.status }));
}));

pedidosRouter.get('/elegiveis-nfe', rota(async (req, res) => {
  res.json(await service.listarPedidosElegiveisNfe({ cliente_id: req.query.cliente_id }));
}));

pedidosRouter.get('/:id', rota(async (req, res) => {
  res.json(await service.obterPedido(req.params.id));
}));

pedidosRouter.post('/', rota(async (req, res) => {
  res.status(201).json(await service.criarPedidoDireto(req.body || {}, { usuarioId: usuarioId(req) }));
}));

pedidosRouter.post('/:id/cancelar', rota(async (req, res) => {
  res.json(await service.cancelarPedido(req.params.id));
}));

/** "Confirmar emissão": fatura o pedido e emite a NF-e na mesma requisição (NF-E-04.1). */
pedidosRouter.post('/:id/emitir-nfe', exigirRecurso('nfe'), exigirEmitirNfe, rota(async (req, res) => {
  const ctx = contextoAuditoriaRequisicao(req);
  const out = await service.confirmarEmissaoNfePedido(
    req.params.id,
    { dadosNfe: (req.body || {}).dados_nfe },
    { usuarioId: ctx.usuario_id || null, usuarioNome: ctx.usuario_nome || null }
  );
  res.status(out.status === 'emissao_em_andamento' ? 409 : 200).json(out);
}));

module.exports = { orcamentosRouter, pedidosRouter };
