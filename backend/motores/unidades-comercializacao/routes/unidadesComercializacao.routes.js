/**
 * UC-01 — Rotas de cadastro das Unidades de Comercialização
 * Montadas em /api/produtos/:id/unidades-comercializacao
 *
 * NÃO implementa compra, estoque, PDV, NFC-e, NF-e ou conversão automática.
 */

const express = require('express');
const db = require('../../../database');
const Uc = require('../index');

const router = express.Router({ mergeParams: true });

function handleError(res, err) {
  const status = err.status || 500;
  console.error('[UC-01]', err.message);
  return res.status(status).json({ error: err.message });
}

router.get('/', async (req, res) => {
  try {
    const produtoId = Number(req.params.id || req.params.produtoId);
    const payload = await Uc.listar(db, produtoId);
    res.json(payload);
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/', async (req, res) => {
  try {
    const produtoId = Number(req.params.id || req.params.produtoId);
    const unidade = await Uc.criar(db, produtoId, req.body || {});
    res.status(201).json(unidade);
  } catch (err) {
    handleError(res, err);
  }
});

router.put('/:unidadeId', async (req, res) => {
  try {
    const produtoId = Number(req.params.id || req.params.produtoId);
    const unidadeId = Number(req.params.unidadeId);
    const unidade = await Uc.atualizar(db, produtoId, unidadeId, req.body || {});
    res.json(unidade);
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/:unidadeId', async (req, res) => {
  try {
    const produtoId = Number(req.params.id || req.params.produtoId);
    const unidadeId = Number(req.params.unidadeId);
    const result = await Uc.excluir(db, produtoId, unidadeId);
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
