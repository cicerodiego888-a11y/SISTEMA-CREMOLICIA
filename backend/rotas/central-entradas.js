/**
 * Rotas Central Inteligente de Entradas — API do inbox fiscal.
 *
 * Sprint 5: pipeline de processamento, revisão MIIP e bridge Compras.
 *
 * @module rotas/central-entradas
 */

const express = require('express');
const multer = require('multer');
const CentralEntradasService = require('../motores/central-entradas/CentralEntradasService');

const router = express.Router();
const centralEntradasService = new CentralEntradasService();

const uploadXml = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 50 },
  fileFilter: (req, file, cb) => {
    if (!/\.xml$/i.test(file.originalname || '')) {
      return cb(new Error('Apenas arquivos .xml são permitidos'));
    }
    cb(null, true);
  }
});

function montarFiltrosQuery(query) {
  return {
    status: query.status || null,
    busca: query.busca || null,
    cnpjFornecedor: query.cnpj_fornecedor || null,
    origem: query.origem || null,
    dataEmissaoInicio: query.data_emissao_inicio || null,
    dataEmissaoFim: query.data_emissao_fim || null,
    filtroRapido: query.filtro_rapido || query.filtroRapido || null,
    createdAtInicio: query.created_at_inicio || null,
    createdAtFim: query.created_at_fim || null,
    limite: query.limite != null ? Number(query.limite) : undefined,
    offset: query.offset != null ? Number(query.offset) : undefined,
    pagina: query.pagina != null ? Number(query.pagina) : undefined,
    ordenarPor: query.ordenar_por || query.ordenarPor || null,
    ordenarDirecao: query.ordenar_direcao || query.ordenarDirecao || null
  };
}

router.get('/health', async (req, res) => {
  try {
    const health = await centralEntradasService.obterHealth();
    return res.json(health);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/metadados', (req, res) => {
  try {
    return res.json(centralEntradasService.obterMetadados());
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/dashboard', async (req, res) => {
  try {
    const dashboard = await centralEntradasService.obterDashboard();
    return res.json(dashboard);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/alertas', async (req, res) => {
  try {
    const alertas = await centralEntradasService.listarAlertas();
    return res.json(alertas);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/pendencias', async (req, res) => {
  try {
    const pendencias = await centralEntradasService.obterPendencias({
      limite: req.query.limite != null ? Number(req.query.limite) : undefined
    });
    return res.json(pendencias);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/operacional', async (req, res) => {
  try {
    const operacional = await centralEntradasService.obterOperacional();
    return res.json(operacional);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/atencao', async (req, res) => {
  try {
    const atencao = await centralEntradasService.obterItensAtencao();
    return res.json(atencao);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/config', async (req, res) => {
  try {
    const config = await centralEntradasService.obterConfiguracoes();
    return res.json(config);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.patch('/config', async (req, res) => {
  try {
    const config = await centralEntradasService.atualizarConfiguracoes(req.body || {});
    return res.json(config);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/servico/status', async (req, res) => {
  try {
    const status = centralEntradasService.obterStatusServico();
    return res.json(status);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/diagnostico', async (req, res) => {
  try {
    const diagnostico = await centralEntradasService.obterDiagnostico();
    return res.json(diagnostico);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/nsu', async (req, res) => {
  try {
    const nsu = await centralEntradasService.obterControleNsu();
    return res.json(nsu);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/eventos', async (req, res) => {
  try {
    const resultado = await centralEntradasService.listarEventos({
      tipo: req.query.tipo || null,
      origem: req.query.origem || null,
      busca: req.query.busca || null,
      dataInicio: req.query.data_inicio || null,
      dataFim: req.query.data_fim || null,
      sucesso: req.query.sucesso,
      limite: req.query.limite != null ? Number(req.query.limite) : undefined,
      offset: req.query.offset != null ? Number(req.query.offset) : undefined
    });
    return res.json(resultado);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/notificacoes', async (req, res) => {
  try {
    const resultado = await centralEntradasService.listarNotificacoes({
      apenasNaoLidas: req.query.apenas_nao_lidas === 'true' || req.query.apenas_nao_lidas === '1',
      limite: req.query.limite != null ? Number(req.query.limite) : undefined
    });
    return res.json(resultado);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.patch('/notificacoes/marcar-todas-lidas', async (req, res) => {
  try {
    const total = await centralEntradasService.marcarTodasNotificacoesLidas();
    return res.json({ total });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.patch('/notificacoes/:id/lida', async (req, res) => {
  try {
    const ok = await centralEntradasService.marcarNotificacaoLida(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Notificação não encontrada' });
    return res.json({ sucesso: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/ao-abrir', async (req, res) => {
  try {
    const abertura = await centralEntradasService.abrirCentral();
    return res.json(abertura);
  } catch (error) {
    return res.status(500).json({
      sucesso: false,
      operacional: false,
      erro: {
        codigo: 'ERRO_INTERNO',
        mensagem: error.message,
        operacional: false
      }
    });
  }
});

router.post('/sincronizar-ao-abrir', async (req, res) => {
  try {
    const resultado = await centralEntradasService.sincronizarAoAbrir();
    return res.json(resultado);
  } catch (error) {
    const { classificarErroSefaz } = require('../services/fiscal/sefazErroOperacional');
    const classificado = classificarErroSefaz(error);
    return res.status(classificado.operacional ? 200 : 500).json({
      sucesso: false,
      operacional: classificado.operacional,
      erros: [classificado.mensagem],
      mensagem: classificado.mensagem,
      erro: classificado
    });
  }
});

router.get('/fornecedor/:cnpj/estatisticas', async (req, res) => {
  try {
    const estatisticas = await centralEntradasService.obterEstatisticasFornecedor(
      req.params.cnpj,
      { periodoDias: req.query.periodo_dias != null ? Number(req.query.periodo_dias) : undefined }
    );

    if (!estatisticas) {
      return res.status(400).json({ error: 'CNPJ inválido' });
    }

    return res.json(estatisticas);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const resultado = await centralEntradasService.listarDocumentos(montarFiltrosQuery(req.query));
    return res.json(resultado);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post('/sincronizar', async (req, res) => {
  try {
    const resultado = await centralEntradasService.sincronizar();
    if (resultado.sucesso || resultado.operacional || resultado.erro) {
      return res.json(resultado);
    }
    return res.status(500).json({
      ...resultado,
      sucesso: false,
      erro: resultado.erro || {
        codigo: 'ERRO_INTERNO',
        mensagem: resultado.mensagem || 'Falha interna na sincronização',
        operacional: false
      }
    });
  } catch (error) {
    const { classificarErroSefaz } = require('../services/fiscal/sefazErroOperacional');
    const classificado = classificarErroSefaz(error);
    return res.status(classificado.operacional ? 200 : 500).json({
      sucesso: false,
      operacional: classificado.operacional,
      erros: [classificado.mensagem],
      mensagem: classificado.mensagem,
      erro: classificado
    });
  }
});

router.get('/buscar-chave', async (req, res) => {
  try {
    const chave = String(req.query.chave || '').replace(/\D/g, '');
    if (chave.length !== 44) {
      return res.status(400).json({ error: 'Informe uma chave de acesso com 44 dígitos' });
    }

    const resultado = await centralEntradasService.buscarPorChave(chave);
    return res.json(resultado);
  } catch (error) {
    const code = error.statusCode || 500;
    return res.status(code).json({ error: error.message });
  }
});

router.post('/upload', (req, res, next) => {
  uploadXml.array('xml', 50)(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message, sucesso: false });
    }
    return next();
  });
}, async (req, res) => {
  try {
    const arquivos = Array.isArray(req.files) ? req.files : [];
    const usuarioId = req.body?.usuario_id ?? req.body?.usuarioId ?? null;

    const resultado = await centralEntradasService.uploadDocumentos(arquivos, {
      usuarioId: usuarioId != null ? Number(usuarioId) || usuarioId : null
    });

    const statusCode = resultado.totalEnviados === 0 ? 400 : 200;
    return res.status(statusCode).json(resultado);
  } catch (error) {
    return res.status(500).json({ error: error.message, sucesso: false });
  }
});

router.post('/:id/processar', async (req, res) => {
  try {
    const { usuario_id: usuarioId, forcar_reprocessamento: forcarReprocessamento } = req.body || {};
    const resultado = await centralEntradasService.processarDocumento(req.params.id, {
      usuarioId,
      forcarReprocessamento: Boolean(forcarReprocessamento)
    });

    const statusCode = resultado.sucesso ? 200 : 400;
    return res.status(statusCode).json(resultado);
  } catch (error) {
    const code = error.statusCode || 500;
    return res.status(code).json({ error: error.message, sucesso: false });
  }
});

router.post('/:id/recuperar-xml', async (req, res) => {
  try {
    const resultado = await centralEntradasService.recuperarXmlDocumento(req.params.id, {
      usuarioId: req.body?.usuario_id,
      origem: 'api'
    });
    return res.json(resultado);
  } catch (error) {
    const code = error.statusCode || 500;
    return res.status(code).json({ error: error.message });
  }
});

router.post('/:id/reprocessar', async (req, res) => {
  try {
    const resultado = await centralEntradasService.reprocessarDocumento(req.params.id, {
      usuarioId: req.body?.usuario_id,
      origem: 'api'
    });
    return res.json(resultado);
  } catch (error) {
    const code = error.statusCode || 500;
    return res.status(code).json({ error: error.message, sucesso: false });
  }
});

router.post('/:id/manifestacao', async (req, res) => {
  try {
    const tipo = req.body?.tipo || req.body?.codigo;
    const resultado = await centralEntradasService.prepararManifestacao(req.params.id, tipo, {
      origem: 'api'
    });
    return res.json(resultado);
  } catch (error) {
    const code = error.statusCode || 500;
    return res.status(code).json({ error: error.message });
  }
});

router.post('/:id/revisar/concluir', async (req, res) => {
  try {
    const { itens, usuario_id: usuarioId } = req.body || {};
    const resultado = await centralEntradasService.concluirRevisao(req.params.id, {
      itens,
      usuarioId
    });
    return res.json(resultado);
  } catch (error) {
    const code = error.statusCode || 500;
    return res.status(code).json({ error: error.message });
  }
});

router.get('/:id/payload-compra', async (req, res) => {
  try {
    const payload = await centralEntradasService.obterPayloadCompra(req.params.id);
    return res.json(payload);
  } catch (error) {
    const code = error.statusCode || 500;
    return res.status(code).json({ error: error.message });
  }
});

router.post('/:id/abrir-compra', async (req, res) => {
  try {
    const { usuario_id: usuarioId } = req.body || {};
    const resultado = await centralEntradasService.abrirCompra(req.params.id, { usuarioId });
    return res.json(resultado);
  } catch (error) {
    const code = error.statusCode || 500;
    return res.status(code).json({ error: error.message });
  }
});

router.get('/:id/historico', async (req, res) => {
  try {
    const documento = await centralEntradasService.obterDocumento(req.params.id);
    if (!documento) {
      return res.status(404).json({ error: 'Documento não encontrado' });
    }

    const historico = await centralEntradasService.obterHistorico(req.params.id);
    return res.json({ historico });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/:id/xml', async (req, res) => {
  try {
    const xmlDoc = await centralEntradasService.obterXmlDocumento(req.params.id);
    if (!xmlDoc) {
      return res.status(404).json({ error: 'XML não encontrado para este documento' });
    }
    return res.json(xmlDoc);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/:id/parse', async (req, res) => {
  try {
    const resultado = await centralEntradasService.obterParseDocumento(req.params.id);
    if (!resultado) {
      return res.status(404).json({ error: 'Documento não encontrado' });
    }
    return res.json(resultado);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/:id/score', async (req, res) => {
  try {
    const score = await centralEntradasService.obterScoreDocumento(req.params.id);
    if (!score) {
      return res.status(404).json({ error: 'Documento não encontrado' });
    }
    return res.json(score);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const detalhe = await centralEntradasService.obterDocumentoDetalhe(req.params.id);
    if (!detalhe) {
      return res.status(404).json({ error: 'Documento não encontrado' });
    }
    return res.json(detalhe);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.patch('/:id/status', async (req, res) => {
  try {
    const { status, detalhe, usuario_id: usuarioId } = req.body || {};

    if (!status) {
      return res.status(400).json({ error: 'Campo status é obrigatório' });
    }

    const documento = await centralEntradasService.alterarStatus(req.params.id, status, {
      detalhe,
      usuarioId
    });

    return res.json({ documento });
  } catch (error) {
    const code = error.statusCode || 500;
    return res.status(code).json({ error: error.message });
  }
});

module.exports = router;
