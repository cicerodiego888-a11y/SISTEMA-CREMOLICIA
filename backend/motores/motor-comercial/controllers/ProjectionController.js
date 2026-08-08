/**
 * ProjectionController — Camada HTTP dos Projection Services.
 *
 * Sprint 2.5: API REST — implementação completa dos endpoints de projeção.
 *
 * @module motores/motor-comercial/controllers/ProjectionController
 */

const { obterContainer } = require('../index');
const ProjectionMapper = require('../http/mappers/ProjectionMapper');
const ProjectionContext = require('../services/projections/ProjectionContext');
const StandardResponse = require('../../../shared/http/responses/StandardResponse');

class ProjectionController {
  /** @returns {import('../infrastructure/di/ComercialDependencyContainer')} */
  get _container() {
    return obterContainer();
  }

  /**
   * GET /projections/dashboard
   * Consulta o dashboard comercial.
   */
  async dashboard(req, res, next) {
    try {
      const { clienteId, consignacaoId } = req.query;

      const contexto = {
        clienteId,
        consignacaoId
      };

      const projectionService = this._container.dashboardProjectionService;
      const result = await projectionService.executar(contexto);

      const response = ProjectionMapper.mapDashboard(result);
      const enriched = StandardResponse.enrich(response, req);
      return res.status(StandardResponse.getStatusCode(response)).json(enriched);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /projections/conta-corrente
   * Consulta a conta corrente.
   */
  async contaCorrente(req, res, next) {
    try {
      const { clienteId, consignacaoId, dataInicio, dataFim } = req.query;

      const contexto = {
        clienteId,
        consignacaoId,
        dataInicio,
        dataFim
      };

      const projectionService = this._container.contaCorrenteProjectionService;
      const result = await projectionService.executar(contexto);

      const response = ProjectionMapper.mapContaCorrente(result);
      const enriched = StandardResponse.enrich(response, req);
      return res.status(StandardResponse.getStatusCode(response)).json(enriched);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /projections/timeline
   * Consulta a timeline de eventos.
   */
  async timeline(req, res, next) {
    try {
      const { clienteId, consignacaoId, perfilComercialId, dataInicio, dataFim, limite, offset } = req.query;

      const limiteParsed = limite != null ? Number.parseInt(limite, 10) : 30;
      const offsetParsed = offset != null ? Number.parseInt(offset, 10) : 0;

      const contexto = ProjectionContext.create({
        clienteId: clienteId ?? null,
        consignacaoId: consignacaoId ?? null,
        perfilComercialId: perfilComercialId ?? null,
        dataInicio: dataInicio || null,
        dataFim: dataFim || null,
        limite: Number.isFinite(limiteParsed) ? limiteParsed : 30,
        offset: Number.isFinite(offsetParsed) ? offsetParsed : 0
      });

      const projectionService = this._container.timelineProjectionService;
      const result = await projectionService.executar(contexto);

      const response = ProjectionMapper.mapTimeline(result);
      const enriched = StandardResponse.enrich(response, req);
      return res.status(StandardResponse.getStatusCode(response)).json(enriched);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /projections/resumo-prestacao
   * Consulta o resumo de prestação.
   */
  async resumoPrestacao(req, res, next) {
    try {
      const { consignacaoId } = req.query;

      if (!consignacaoId) {
        const response = StandardResponse.validationError('consignacaoId é obrigatório');
        const enriched = StandardResponse.enrich(response, req);
        return res.status(StandardResponse.getStatusCode(response)).json(enriched);
      }

      const contexto = { consignacaoId };

      const projectionService = this._container.resumoPrestacaoProjectionService;
      const result = await projectionService.executar(contexto);

      const response = ProjectionMapper.mapResumoPrestacao(result);
      const enriched = StandardResponse.enrich(response, req);
      return res.status(StandardResponse.getStatusCode(response)).json(enriched);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /projections/saldos
   * Consulta os saldos.
   */
  async saldos(req, res, next) {
    try {
      const { clienteId, consignacaoId } = req.query;

      const contexto = {
        clienteId,
        consignacaoId
      };

      const projectionService = this._container.saldoProjectionService;
      const result = await projectionService.executar(contexto);

      const response = ProjectionMapper.mapSaldos(result);
      const enriched = StandardResponse.enrich(response, req);
      return res.status(StandardResponse.getStatusCode(response)).json(enriched);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /projections/historico
   * Consulta o histórico.
   */
  async historico(req, res, next) {
    try {
      const { clienteId, perfilComercialId, tipoMovimentacao, dataInicio, dataFim, limite, offset } = req.query;

      const contexto = {
        clienteId,
        perfilComercialId,
        tipoMovimentacao,
        dataInicio,
        dataFim,
        limite: limite ? parseInt(limite) : undefined,
        offset: offset ? parseInt(offset) : undefined
      };

      const projectionService = this._container.historicoProjectionService;
      const result = await projectionService.executar(contexto);

      const response = ProjectionMapper.mapHistorico(result);
      const enriched = StandardResponse.enrich(response, req);
      return res.status(StandardResponse.getStatusCode(response)).json(enriched);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /projections/indicadores
   * Consulta os indicadores.
   */
  async indicadores(req, res, next) {
    try {
      const { clienteId, consignacaoId, dataInicio, dataFim } = req.query;

      const contexto = {
        clienteId,
        consignacaoId,
        dataInicio,
        dataFim
      };

      const projectionService = this._container.indicadoresProjectionService;
      const result = await projectionService.executar(contexto);

      const response = ProjectionMapper.mapIndicadores(result);
      const enriched = StandardResponse.enrich(response, req);
      return res.status(StandardResponse.getStatusCode(response)).json(enriched);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /projections/insights
   * Consulta os insights comerciais.
   */
  async insights(req, res, next) {
    try {
      const { clienteId, consignacaoId, dataInicio, dataFim } = req.query;

      const contexto = {
        clienteId,
        consignacaoId,
        dataInicio,
        dataFim
      };

      const projectionService = this._container.insightsProjectionService;
      const result = await projectionService.executar(contexto);

      const response = ProjectionMapper.mapInsights(result);
      const enriched = StandardResponse.enrich(response, req);
      return res.status(StandardResponse.getStatusCode(response)).json(enriched);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /projections/pendencias
   * Central de Pendências e Alertas Inteligentes.
   */
  async pendencias(req, res, next) {
    try {
      const { clienteId, consignacaoId, dataInicio, dataFim } = req.query;

      const contexto = {
        clienteId,
        consignacaoId,
        dataInicio,
        dataFim
      };

      const projectionService = this._container.pendenciasProjectionService;
      const result = await projectionService.executar(contexto);

      const response = ProjectionMapper.mapPendencias(result);
      const enriched = StandardResponse.enrich(response, req);
      return res.status(StandardResponse.getStatusCode(response)).json(enriched);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /projections/recomendacoes
   * Motor de Recomendações Comerciais.
   */
  async recomendacoes(req, res, next) {
    try {
      const { clienteId, consignacaoId, dataInicio, dataFim } = req.query;

      const contexto = { clienteId, consignacaoId, dataInicio, dataFim };

      const projectionService = this._container.recomendacoesProjectionService;
      const result = await projectionService.executar(contexto);

      const response = ProjectionMapper.mapRecomendacoes(result);
      const enriched = StandardResponse.enrich(response, req);
      return res.status(StandardResponse.getStatusCode(response)).json(enriched);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /projections/playbooks
   * Central de Playbooks Operacionais.
   */
  async playbooks(req, res, next) {
    try {
      const { clienteId, consignacaoId, dataInicio, dataFim } = req.query;
      const contexto = { clienteId, consignacaoId, dataInicio, dataFim };

      const projectionService = this._container.playbooksProjectionService;
      const result = await projectionService.executar(contexto);

      const response = ProjectionMapper.mapPlaybooks(result);
      const enriched = StandardResponse.enrich(response, req);
      return res.status(StandardResponse.getStatusCode(response)).json(enriched);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /projections/workflow
   * Central de Workflow Operacional.
   */
  async workflow(req, res, next) {
    try {
      const { clienteId, consignacaoId, dataInicio, dataFim } = req.query;
      const contexto = { clienteId, consignacaoId, dataInicio, dataFim };

      const projectionService = this._container.workflowProjectionService;
      const result = await projectionService.executar(contexto);

      const response = ProjectionMapper.mapWorkflow(result);
      const enriched = StandardResponse.enrich(response, req);
      return res.status(StandardResponse.getStatusCode(response)).json(enriched);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /projections/situacao-cliente
   * Consulta a situação do cliente.
   */
  async situacaoCliente(req, res, next) {
    try {
      const { clienteId } = req.query;

      if (!clienteId) {
        const response = StandardResponse.validationError('clienteId é obrigatório');
        const enriched = StandardResponse.enrich(response, req);
        return res.status(StandardResponse.getStatusCode(response)).json(enriched);
      }

      const contexto = { clienteId };

      const projectionService = this._container.situacaoClienteProjectionService;
      const result = await projectionService.executar(contexto);

      const response = ProjectionMapper.mapSituacaoCliente(result);
      const enriched = StandardResponse.enrich(response, req);
      return res.status(StandardResponse.getStatusCode(response)).json(enriched);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /projections/rateio-perdas/indicadores — RC4.2 estrutura para relatórios
   */
  async indicadoresRateioPerdas(req, res, next) {
    try {
      const repo = this._container.rateioPerdaRepository;
      if (!repo) {
        const response = StandardResponse.internalError('rateioPerdaRepository indisponível');
        return res.status(500).json(StandardResponse.enrich(response, req));
      }
      const dados = await repo.agregarIndicadores({
        dataInicio: req.query.dataInicio || req.query.data_inicio || null,
        dataFim: req.query.dataFim || req.query.data_fim || null
      });
      const response = StandardResponse.success(dados);
      return res.status(200).json(StandardResponse.enrich(response, req));
    } catch (error) {
      next(error);
    }
  }
}

module.exports = ProjectionController;
