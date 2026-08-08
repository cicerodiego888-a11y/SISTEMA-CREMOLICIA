/**
 * MCC-02.1 — Rotas HTTP Conversão Física por Lote (versionada)
 *
 * GET  /api/lotes/:loteId/conversao-fisica/ativa
 * GET  /api/lotes/:loteId/conversao-fisica/historico
 * POST /api/lotes/:loteId/conversao-fisica/versoes
 * POST /api/lotes/:loteId/conversao-fisica          (versão inicial)
 *
 * Sem UI. Sem alterar Compras/Estoque/PDV/Fiscal.
 */

const express = require('express');
const db = require('../../../database');
const service = require('../services/ConversaoFisicaLoteService');

const router = express.Router({ mergeParams: true });

function handleError(res, err) {
  const status = err.status || 500;
  console.error('[MCC-02.1]', err.message);
  return res.status(status).json({
    error: err.message,
    codigo: err.codigo || null
  });
}

router.get('/ativa', async (req, res) => {
  try {
    const loteId = Number(req.params.loteId);
    const ativa = await service.consultarConversaoAtiva(db, loteId);
    res.json(ativa);
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/historico', async (req, res) => {
  try {
    const loteId = Number(req.params.loteId);
    const historico = await service.consultarHistorico(db, loteId);
    res.json(historico);
  } catch (err) {
    handleError(res, err);
  }
});

/** Criar nova versão (correção) */
router.post('/versoes', async (req, res) => {
  try {
    const loteId = Number(req.params.loteId);
    const body = req.body || {};
    if (body.usuarioId == null && body.usuario_id == null && req.user?.id != null) {
      body.usuarioId = req.user.id;
    }
    const resultado = await service.criarNovaVersao(db, loteId, body);
    res.status(201).json(resultado);
  } catch (err) {
    handleError(res, err);
  }
});

/** Versão inicial (v1) — infraestrutura; Compra usará futuramente via orchestrator */
router.post('/', async (req, res) => {
  try {
    const loteId = Number(req.params.loteId);
    const body = { ...(req.body || {}), loteId, lote_id: loteId };
    if (body.usuarioId == null && body.usuario_id == null && req.user?.id != null) {
      body.usuarioId = req.user.id;
    }
    const criada = await service.criarVersaoInicial(db, body);
    res.status(201).json(criada);
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
