/**
 * RCM-8.9 — Rotas /api/produtos/:id/conversoes
 */

const express = require('express');
const db = require('../../../database');
const Muc = require('../index');

const router = express.Router({ mergeParams: true });

function handleError(res, err) {
  const status = err.status || 500;
  console.error('[MUC-Conversoes]', err.message);
  return res.status(status).json({
    error: err.message,
    codigo: err.codigo || undefined
  });
}

router.get('/', async (req, res) => {
  try {
    const produtoId = Number(req.params.id || req.params.produtoId);
    const lista = await Muc.listarConversoes(db, produtoId);
    res.json(lista);
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/simular', async (req, res) => {
  try {
    const produtoId = Number(req.params.id || req.params.produtoId);
    const resultado = await Muc.simularConversao(db, produtoId, req.body || {});
    res.json(resultado);
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/', async (req, res) => {
  try {
    const produtoId = Number(req.params.id || req.params.produtoId);
    const row = await Muc.criarConversao(db, produtoId, req.body || {});
    res.status(201).json(row);
  } catch (err) {
    handleError(res, err);
  }
});

router.put('/:conversaoId', async (req, res) => {
  try {
    const produtoId = Number(req.params.id || req.params.produtoId);
    const conversaoId = Number(req.params.conversaoId);
    const row = await Muc.atualizarConversao(db, produtoId, conversaoId, req.body || {});
    res.json(row);
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/:conversaoId', async (req, res) => {
  try {
    const produtoId = Number(req.params.id || req.params.produtoId);
    const conversaoId = Number(req.params.conversaoId);
    const result = await Muc.excluirConversao(db, produtoId, conversaoId);
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
