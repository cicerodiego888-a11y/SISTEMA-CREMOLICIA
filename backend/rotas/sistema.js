/**
 * Rotas de sistema — diagnóstico de instância (RCM-04.B).
 */

const express = require('express');
const { montarDiagnostico } = require('../services/sistemaDiagnostico');

const router = express.Router();

/**
 * GET /api/sistema/diagnostico
 */
router.get('/diagnostico', async (req, res) => {
  try {
    const diagnostico = await montarDiagnostico(req);
    res.json({
      success: true,
      data: diagnostico,
      ...diagnostico
    });
  } catch (err) {
    console.error('[sistema/diagnostico]', err);
    res.status(500).json({
      success: false,
      error: err.message || 'Falha ao montar diagnóstico'
    });
  }
});

module.exports = router;
