/**
 * ConsignacaoController — Camada HTTP do domínio Consignação.
 *
 * Sprint 2.5: API REST — implementação completa dos endpoints.
 *
 * @module motores/motor-comercial/controllers/ConsignacaoController
 */

const { obterContainer } = require('../index');
const {
  CriarConsignacaoRequest,
  EditarConsignacaoRequest,
  AdicionarItemRequest,
  AlterarQuantidadeItemRequest,
  RegistrarEntregaRequest,
  RegistrarEntregaComplementarRequest,
  RegistrarAlteracaoPosEntregaRequest,
  RegistrarEmissaoTermoEntregaRequest,
  AbrirPrestacaoRequest,
  RegistrarDevolucaoRequest,
  TransferenciaRequest,
  RegistrarVendaRequest,
  RegistrarPerdaRequest,
  RegistrarCortesiaRequest,
  RegistrarPagamentoRequest,
  ConsignacaoResponse,
  ItemConsignacaoResponse,
  CancelarConsignacaoRequest
} = require('../http/dto');
const ResultHttpMapper = require('../../../shared/http/mappers/ResultHttpMapper');
const StandardResponse = require('../../../shared/http/responses/StandardResponse');
const { consignacaoPertenceAoCliente } = require('../services/consultaConsignacaoReadOnly');
const {
  normalizarStatusIn,
  resolverPaginacaoHistorico,
  montarMetaPaginacao
} = require('../services/historicoConsignacaoPaginacao');
const { obterConsignacaoEmRascunho } = require('../usecases/consignacao/consignacaoUseCaseHelpers');
const {
  registrarLogOperacaoComercial,
  extrairConsignacaoId
} = require('../../../services/comercialOperacaoLog');

function responderValidacao(res, req, validation, mensagemPadrao = 'Dados inválidos') {
  const erros = validation?.errors || [];
  const primeiro = erros[0];
  const mensagem = typeof primeiro === 'string'
    ? primeiro
    : (primeiro?.message || mensagemPadrao);
  const detalhes = {
    fields: erros.map((item) => (
      typeof item === 'string'
        ? { field: null, message: item }
        : item
    ))
  };
  const response = StandardResponse.validationError(mensagem, detalhes);
  const enriched = StandardResponse.enrich(response, req);
  return res.status(StandardResponse.getStatusCode(response)).json(enriched);
}

class ConsignacaoController {
  /** @returns {import('../infrastructure/di/ComercialDependencyContainer')} */
  get _container() {
    return obterContainer();
  }

  /**
   * GET /consignacoes
   * Sem page/limite: listagem completa (compatível com telas existentes).
   * Com page/limite/offset: histórico paginado (RCM-8.5).
   */
  async listar(req, res, next) {
    try {
      const { clienteId, cliente_id: clienteIdSnake, perfilComercialId, status, busca, q } = req.query;
      const paginacao = resolverPaginacaoHistorico(req.query);
      const filtros = {
        clienteId: clienteId || clienteIdSnake,
        perfilComercialId,
        status,
        statusIn: normalizarStatusIn(req.query.statusIn || req.query.status_in),
        busca: busca || q || null
      };
      if (paginacao.paginado) {
        filtros.limite = paginacao.limite;
        filtros.offset = paginacao.offset;
      }

      const consignacaoRepository = this._container.consignacaoRepository;
      const consignacoes = await consignacaoRepository.listar(filtros);
      const total = paginacao.paginado && typeof consignacaoRepository.contar === 'function'
        ? await consignacaoRepository.contar({
          clienteId: filtros.clienteId,
          perfilComercialId: filtros.perfilComercialId,
          status: filtros.status,
          statusIn: filtros.statusIn,
          busca: filtros.busca
        })
        : consignacoes.length;

      const meta = paginacao.paginado
        ? montarMetaPaginacao({
          total,
          page: paginacao.page,
          pageSize: paginacao.pageSize
        })
        : { total };

      const response = StandardResponse.success(
        consignacoes.map(c => ConsignacaoResponse.toJSON(c)),
        meta
      );

      const enriched = StandardResponse.enrich(response, req);
      return res.status(StandardResponse.getStatusCode(response)).json(enriched);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /consignacoes/:id
   * Consulta uma consignação por ID (inclui itens — necessário para recovery/UI).
   */
  async consultarPorId(req, res, next) {
    try {
      const { id } = req.params;

      const consignacaoRepository = this._container.consignacaoRepository;
      const consignacao = await consignacaoRepository.buscarPorId(id);

      if (!consignacao || !consignacaoPertenceAoCliente(consignacao, req.query.clienteId || req.query.cliente_id)) {
        const response = StandardResponse.notFound('Consignação não encontrada');
        const enriched = StandardResponse.enrich(response, req);
        return res.status(StandardResponse.getStatusCode(response)).json(enriched);
      }

      const itemRepository = this._container.consignacaoItemRepository;
      let itens = [];
      try {
        itens = await itemRepository.listarPorConsignacao(id);
      } catch (_e) {
        itens = [];
      }

      const itensJson = (itens || []).map((item) => ItemConsignacaoResponse.toJSON(item)).filter(Boolean);
      const payload = {
        ...ConsignacaoResponse.toJSON(consignacao, { itens: itensJson }),
        itens: itensJson
      };

      const response = StandardResponse.success(payload);
      const enriched = StandardResponse.enrich(response, req);
      return res.status(StandardResponse.getStatusCode(response)).json(enriched);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /consignacoes/:id/itens
   * Lista itens oficiais da consignação (UC-009).
   */
  async consultarItens(req, res, next) {
    try {
      const { id } = req.params;
      const useCase = this._container.consultarItensConsignacaoUseCase;
      const result = await useCase.executar({
        consignacaoId: id,
        clienteId: req.query.clienteId || req.query.cliente_id,
        produtoId: req.query.produtoId,
        limite: req.query.limite ? Number(req.query.limite) : undefined,
        offset: req.query.offset ? Number(req.query.offset) : undefined,
        correlationId: req.correlationId
      });

      if (result && typeof result.isFail === 'function' && result.isFail()) {
        const response = ResultHttpMapper.map(result);
        const enriched = StandardResponse.enrich(response, req);
        return res.status(StandardResponse.getStatusCode(response)).json(enriched);
      }

      const data = result?.dados || result?.value || result?.data || {};
      const itensBrutos = data.itens || [];
      const itens = itensBrutos.map((item) => ItemConsignacaoResponse.toJSON(item)).filter(Boolean);
      const response = StandardResponse.success({
        consignacaoId: data.consignacaoId || id,
        itens,
        total: data.total ?? itens.length
      });
      const enriched = StandardResponse.enrich(response, req);
      return res.status(StandardResponse.getStatusCode(response)).json(enriched);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /consignacoes/proximo-documento
   * Pré-visualiza o próximo número oficial CONS-AAAA-000001.
   */
  async proximoDocumento(req, res, next) {
    try {
      const { preverProximoDocumentoConsignacao } = require('../services/DocumentoConsignacaoSequenciador');
      const ano = req.query.ano ? Number(req.query.ano) : new Date().getFullYear();
      const documento = await preverProximoDocumentoConsignacao(
        this._container.consignacaoRepository,
        ano
      );
      const response = StandardResponse.success({ documento });
      const enriched = StandardResponse.enrich(response, req);
      return res.status(StandardResponse.getStatusCode(response)).json(enriched);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /consignacoes
   * Cria uma nova consignação.
   */
  async criar(req, res, next) {
    try {
      const validation = CriarConsignacaoRequest.validate(req.body);
      if (validation) {
        const response = StandardResponse.validationError('Dados inválidos', validation.errors);
        const enriched = StandardResponse.enrich(response, req);
        return res.status(StandardResponse.getStatusCode(response)).json(enriched);
      }

      const inputData = CriarConsignacaoRequest.fromJSON(req.body);
      inputData.correlationId = req.correlationId;

      const useCase = this._container.criarConsignacaoUseCase;
      const result = await useCase.executar(inputData);

      const response = ResultHttpMapper.mapCreated(result);
      if (!ResultHttpMapper._isFailure(result)) {
        const id = extrairConsignacaoId(ResultHttpMapper._extractData(result));
        await registrarLogOperacaoComercial(req, {
          acao: 'criar_consignacao',
          consignacaoId: id,
          detalhes: { status: 'RASCUNHO' }
        });
      }
      const enriched = StandardResponse.enrich(response, req);
      return res.status(StandardResponse.getStatusCode(response)).json(enriched);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /consignacoes/:id
   * Edita uma consignação.
   */
  async editar(req, res, next) {
    try {
      const { id } = req.params;
      const inputData = EditarConsignacaoRequest.fromJSON(req.body);
      inputData.consignacaoId = id;
      inputData.correlationId = req.correlationId;

      const useCase = this._container.editarConsignacaoUseCase;
      const result = await useCase.executar(inputData);

      const response = ResultHttpMapper.map(result);
      if (!ResultHttpMapper._isFailure(result)) {
        await registrarLogOperacaoComercial(req, {
          acao: 'atualizar_consignacao',
          consignacaoId: id
        });
      }
      const enriched = StandardResponse.enrich(response, req);
      return res.status(StandardResponse.getStatusCode(response)).json(enriched);
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /consignacoes/:id
   * Cancela uma consignação em rascunho (compatível; preferir POST /cancelar).
   */
  async cancelar(req, res, next) {
    try {
      const { id } = req.params;
      const body = req.body || {};
      const validation = CancelarConsignacaoRequest.validate(body);
      if (validation) {
        return responderValidacao(res, req, validation);
      }

      const inputData = CancelarConsignacaoRequest.fromJSON(body);
      inputData.consignacaoId = id;
      inputData.usuarioId = inputData.usuarioId || body.usuarioId || req.user?.id || null;
      inputData.correlationId = req.correlationId;

      const useCase = this._container.cancelarConsignacaoRascunhoUseCase;
      const result = await useCase.executar(inputData);

      const response = ResultHttpMapper.map(result);
      if (!ResultHttpMapper._isFailure(result)) {
        await registrarLogOperacaoComercial(req, {
          acao: 'cancelar_consignacao',
          consignacaoId: id
        });
      }
      const enriched = StandardResponse.enrich(response, req);
      return res.status(StandardResponse.getStatusCode(response)).json(enriched);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /consignacoes/:id/cancelar
   * RCM-8.8 — Cancelamento voluntário da preparação.
   */
  async cancelarPreparacao(req, res, next) {
    return this.cancelar(req, res, next);
  }

  /**
   * POST /consignacoes/:id/itens
   * Adiciona um item à consignação.
   */
  async adicionarItem(req, res, next) {
    try {
      const { id } = req.params;
      const validation = AdicionarItemRequest.validate(req.body);
      if (validation) {
        return responderValidacao(res, req, validation);
      }

      const inputData = AdicionarItemRequest.fromJSON(req.body);
      inputData.consignacaoId = id;
      inputData.correlationId = req.correlationId;

      const useCase = this._container.adicionarItemConsignacaoUseCase;
      const result = await useCase.executar(inputData);

      const response = ResultHttpMapper.map(result);
      const enriched = StandardResponse.enrich(response, req);
      return res.status(StandardResponse.getStatusCode(response)).json(enriched);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /consignacoes/:id/itens/:item/observacao
   * Persiste observação da grade (STAB-06.6.1) — sem alterar quantidades/ledger.
   */
  async atualizarObservacaoItem(req, res, next) {
    try {
      const { id, item } = req.params;
      const observacao = req.body?.observacao != null
        ? String(req.body.observacao)
        : '';

      const consignacaoRepository = this._container.consignacaoRepository;
      const consignacao = await consignacaoRepository.buscarPorId(id);
      obterConsignacaoEmRascunho(consignacao);

      const itemRepository = this._container.consignacaoItemRepository;
      const atual = await itemRepository.buscarPorId(item);
      if (!atual || String(atual.consignacaoId) !== String(id)) {
        const response = StandardResponse.notFound('Item não encontrado nesta consignação');
        const enriched = StandardResponse.enrich(response, req);
        return res.status(StandardResponse.getStatusCode(response)).json(enriched);
      }

      const atualizado = await itemRepository.atualizar(atual.id, { observacao });
      const response = StandardResponse.success(ItemConsignacaoResponse.toJSON(atualizado));
      const enriched = StandardResponse.enrich(response, req);
      return res.status(StandardResponse.getStatusCode(response)).json(enriched);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /consignacoes/:id/itens/:item
   * Altera a quantidade de um item.
   */
  async alterarQuantidadeItem(req, res, next) {
    try {
      const { id, item } = req.params;
      const validation = AlterarQuantidadeItemRequest.validate(req.body);
      if (validation) {
        return responderValidacao(res, req, validation);
      }

      const inputData = AlterarQuantidadeItemRequest.fromJSON(req.body);
      inputData.consignacaoId = id;
      inputData.itemId = item;
      inputData.correlationId = req.correlationId;

      const useCase = this._container.alterarQuantidadeItemUseCase;
      const result = await useCase.executar(inputData);

      const response = ResultHttpMapper.map(result);
      const enriched = StandardResponse.enrich(response, req);
      return res.status(StandardResponse.getStatusCode(response)).json(enriched);
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /consignacoes/:id/itens/:item
   * Remove um item da consignação.
   */
  async removerItem(req, res, next) {
    try {
      const { id, item } = req.params;
      const { usuarioId } = req.body;

      const inputData = {
        consignacaoId: id,
        itemId: item,
        usuarioId,
        correlationId: req.correlationId
      };

      const useCase = this._container.removerItemConsignacaoUseCase;
      const result = await useCase.executar(inputData);

      const response = ResultHttpMapper.map(result);
      const enriched = StandardResponse.enrich(response, req);
      return res.status(StandardResponse.getStatusCode(response)).json(enriched);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /consignacoes/:id/entrega
   * Registra a entrega de uma consignação.
   */
  async registrarEntrega(req, res, next) {
    try {
      const { id } = req.params;
      const inputData = RegistrarEntregaRequest.fromJSON(req.body);
      inputData.consignacaoId = id;
      inputData.correlationId = req.correlationId;

      const useCase = this._container.registrarEntregaConsignacaoUseCase;
      const result = await useCase.executar(inputData);

      const response = ResultHttpMapper.map(result);
      if (!ResultHttpMapper._isFailure(result)) {
        await registrarLogOperacaoComercial(req, {
          acao: 'entrega_consignacao',
          consignacaoId: id
        });
      }
      const enriched = StandardResponse.enrich(response, req);
      return res.status(StandardResponse.getStatusCode(response)).json(enriched);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /consignacoes/:id/entrega-complementar
   * RCM-8.7 — Entrega Complementar (somente itens novos).
   */
  async registrarEntregaComplementar(req, res, next) {
    try {
      const { id } = req.params;
      const inputData = RegistrarEntregaComplementarRequest.fromJSON(req.body);
      const validation = RegistrarEntregaComplementarRequest.validate(inputData);
      if (validation) {
        return responderValidacao(res, req, validation);
      }

      inputData.consignacaoId = id;
      inputData.correlationId = inputData.correlationId || req.correlationId;
      inputData.requestId = req.requestId || null;

      const useCase = this._container.registrarEntregaComplementarUseCase;
      const result = await useCase.executar(inputData);

      const response = ResultHttpMapper.map(result);
      if (!ResultHttpMapper._isFailure(result)) {
        await registrarLogOperacaoComercial(req, {
          acao: 'entrega_complementar_consignacao',
          consignacaoId: id
        });
      }
      const enriched = StandardResponse.enrich(response, req);
      return res.status(StandardResponse.getStatusCode(response)).json(enriched);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /consignacoes/:id/alteracao-pos-entrega
   * RCM-8.13 — Alteração Pós-Entrega (delta; novo comprovante completo).
   */
  async registrarAlteracaoPosEntrega(req, res, next) {
    try {
      const { id } = req.params;
      const inputData = RegistrarAlteracaoPosEntregaRequest.fromJSON(req.body);
      const validation = RegistrarAlteracaoPosEntregaRequest.validate(inputData);
      if (validation) {
        return responderValidacao(res, req, validation);
      }

      inputData.consignacaoId = id;
      inputData.correlationId = inputData.correlationId || req.correlationId;
      inputData.requestId = req.requestId || null;
      inputData.usuarioId = inputData.usuarioId || req.user?.id || null;

      const useCase = this._container.registrarAlteracaoPosEntregaUseCase;
      const result = await useCase.executar(inputData);

      const response = ResultHttpMapper.map(result);
      if (!ResultHttpMapper._isFailure(result)) {
        await registrarLogOperacaoComercial(req, {
          acao: 'alteracao_pos_entrega_consignacao',
          consignacaoId: id
        });
      }
      const enriched = StandardResponse.enrich(response, req);
      return res.status(StandardResponse.getStatusCode(response)).json(enriched);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /consignacoes/:id/entregas
   * Histórico: Original + Complementares + Alterações Pós-Entrega.
   */
  async consultarEntregas(req, res, next) {
    try {
      const { id } = req.params;
      const consignacao = await this._container.consignacaoRepository.buscarPorId(id);
      if (!consignacao) {
        const response = StandardResponse.notFound('Consignação não encontrada');
        return res.status(StandardResponse.getStatusCode(response)).json(
          StandardResponse.enrich(response, req)
        );
      }

      const itens = await this._container.consignacaoItemRepository.listarPorConsignacao(id);
      const movimentacoes = await this._container.movimentacaoComercialRepository.listar({
        consignacaoId: id
      });
      const {
        montarHistoricoEntregas,
        avaliarElegibilidadeEntregaComplementar
      } = require('../usecases/consignacao/entregaComplementarHelpers');
      const {
        avaliarElegibilidadeAlteracaoPosEntrega
      } = require('../usecases/consignacao/atualizacaoEntregaHelpers');

      const entregas = montarHistoricoEntregas(movimentacoes, itens);
      const elegibilidade = avaliarElegibilidadeEntregaComplementar(consignacao);
      const elegAlt = avaliarElegibilidadeAlteracaoPosEntrega(consignacao);
      const valorTotal = entregas.reduce((s, e) => s + Number(e.valorTotal || 0), 0);

      const payload = {
        consignacaoId: Number(id),
        status: consignacao.status,
        elegivelComplementar: elegibilidade.elegivel,
        bloqueioComplementar: elegibilidade.elegivel
          ? null
          : { codigo: elegibilidade.codigo, mensagem: elegibilidade.mensagem },
        elegivelAlteracaoPosEntrega: elegAlt.elegivel,
        bloqueioAlteracaoPosEntrega: elegAlt.elegivel
          ? null
          : { codigo: elegAlt.codigo, mensagem: elegAlt.mensagem },
        entregas,
        valorTotal
      };

      return res.status(200).json(StandardResponse.enrich(
        StandardResponse.success(payload),
        req
      ));
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /consignacoes/:id/entregas/:correlationId/comprovante
   * Reimpressão histórica (somente leitura — sem efeitos).
   */
  async obterComprovanteEntrega(req, res, next) {
    try {
      const { id, correlationId } = req.params;
      const consignacao = await this._container.consignacaoRepository.buscarPorId(id);
      if (!consignacao) {
        const response = StandardResponse.notFound('Consignação não encontrada');
        return res.status(StandardResponse.getStatusCode(response)).json(
          StandardResponse.enrich(response, req)
        );
      }

      const itens = await this._container.consignacaoItemRepository.listarPorConsignacao(id);
      const movimentacoes = await this._container.movimentacaoComercialRepository.listar({
        consignacaoId: id
      });
      const { montarHistoricoEntregas } = require('../usecases/consignacao/entregaComplementarHelpers');
      const {
        obterComprovanteDoHistorico,
        renderComprovanteTexto
      } = require('../usecases/consignacao/atualizacaoEntregaHelpers');

      const entregas = montarHistoricoEntregas(movimentacoes, itens);
      const comprovante = obterComprovanteDoHistorico(entregas, correlationId);
      if (!comprovante) {
        const response = StandardResponse.notFound('Comprovante de entrega não encontrado');
        return res.status(StandardResponse.getStatusCode(response)).json(
          StandardResponse.enrich(response, req)
        );
      }

      const payload = {
        consignacaoId: Number(id),
        correlationId,
        comprovante,
        texto: renderComprovanteTexto({
          ...comprovante,
          numeroConsignacao: consignacao.documento?.numero
            || comprovante.numeroConsignacao
            || `CONS-${id}`
        }),
        reimpressao: true,
        efeitos: {
          estoque: false,
          ledger: false,
          prestacao: false,
          novoEvento: false
        }
      };

      return res.status(200).json(StandardResponse.enrich(
        StandardResponse.success(payload),
        req
      ));
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /consignacoes/:id/termo-entrega
   * Registra emissão/reimpressão do Termo de Entrega.
   */
  async registrarEmissaoTermoEntrega(req, res, next) {
    try {
      const { id } = req.params;
      const inputData = RegistrarEmissaoTermoEntregaRequest.fromJSON(req.body);
      inputData.consignacaoId = id;
      inputData.correlationId = req.correlationId;

      const useCase = this._container.registrarEmissaoTermoEntregaUseCase;
      const result = await useCase.executar(inputData);

      const response = ResultHttpMapper.map(result);
      const enriched = StandardResponse.enrich(response, req);
      return res.status(StandardResponse.getStatusCode(response)).json(enriched);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /consignacoes/:id/devolucao
   * Registra a devolução de uma consignação.
   */
  async registrarDevolucao(req, res, next) {
    try {
      const { id } = req.params;
      const inputData = RegistrarDevolucaoRequest.fromJSON(req.body);
      const validation = RegistrarDevolucaoRequest.validate(inputData);
      if (validation) {
        return responderValidacao(res, req, validation);
      }

      inputData.consignacaoId = id;
      inputData.correlationId = req.correlationId;

      const useCase = this._container.registrarDevolucaoAntesPrestacaoUseCase;
      const result = await useCase.executar(inputData);

      const response = ResultHttpMapper.map(result);
      const enriched = StandardResponse.enrich(response, req);
      return res.status(StandardResponse.getStatusCode(response)).json(enriched);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /consignacoes/:id/transferencia
   * Transfere itens entre consignações.
   */
  async transferir(req, res, next) {
    try {
      const { id } = req.params;
      const validation = TransferenciaRequest.validate(req.body);
      if (validation) {
        return responderValidacao(res, req, validation);
      }

      const inputData = TransferenciaRequest.fromJSON(req.body);
      inputData.consignacaoOrigemId = id;
      inputData.correlationId = req.correlationId;

      const useCase = this._container.transferirItensEntreConsignacoesUseCase;
      const result = await useCase.executar(inputData);

      const response = ResultHttpMapper.map(result);
      const enriched = StandardResponse.enrich(response, req);
      return res.status(StandardResponse.getStatusCode(response)).json(enriched);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /consignacoes/:id/prestacao/abrir
   * Abre uma prestação de conta.
   */
  async abrirPrestacao(req, res, next) {
    try {
      const { id } = req.params;
      const payload = { ...req.body, consignacaoId: id };
      const validation = AbrirPrestacaoRequest.validate(payload);
      if (validation) {
        return responderValidacao(res, req, validation, "Campo 'consignacaoId' é obrigatório.");
      }

      const inputData = AbrirPrestacaoRequest.fromJSON(req.body, id);
      inputData.correlationId = req.correlationId;

      const useCase = this._container.abrirPrestacaoUseCase;
      const result = await useCase.executar(inputData);

      const response = ResultHttpMapper.map(result);
      if (!ResultHttpMapper._isFailure(result)) {
        await registrarLogOperacaoComercial(req, {
          acao: 'prestacao_abrir',
          consignacaoId: id
        });
      }
      const enriched = StandardResponse.enrich(response, req);
      return res.status(StandardResponse.getStatusCode(response)).json(enriched);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /consignacoes/:id/prestacao/venda
   * Registra uma venda na prestação.
   */
  async registrarVenda(req, res, next) {
    try {
      const { id } = req.params;
      const validation = RegistrarVendaRequest.validate(req.body);
      if (validation) {
        return responderValidacao(res, req, validation);
      }

      const inputData = RegistrarVendaRequest.fromJSON(req.body);
      inputData.consignacaoId = id;
      inputData.correlationId = req.correlationId;

      const useCase = this._container.registrarVendaPrestacaoUseCase;
      const result = await useCase.executar(inputData);

      const response = ResultHttpMapper.map(result);
      const enriched = StandardResponse.enrich(response, req);
      return res.status(StandardResponse.getStatusCode(response)).json(enriched);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /consignacoes/:id/prestacao/perda
   * Registra uma perda na prestação.
   */
  async registrarPerda(req, res, next) {
    try {
      const { id } = req.params;
      const validation = RegistrarPerdaRequest.validate(req.body);
      if (validation) {
        return responderValidacao(res, req, validation);
      }

      const inputData = RegistrarPerdaRequest.fromJSON(req.body);
      inputData.consignacaoId = id;
      inputData.correlationId = req.correlationId;

      const useCase = this._container.registrarPerdaUseCase;
      const result = await useCase.executar(inputData);

      const response = ResultHttpMapper.map(result);
      const enriched = StandardResponse.enrich(response, req);
      return res.status(StandardResponse.getStatusCode(response)).json(enriched);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /consignacoes/:id/prestacao/rateio-perda — RC4.2
   */
  async consultarRateioPerda(req, res, next) {
    try {
      const useCase = this._container.consultarRateioPerdaUseCase;
      const result = await useCase.executar({ consignacaoId: req.params.id });
      const response = StandardResponse.success(result);
      return res.status(200).json(StandardResponse.enrich(response, req));
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /consignacoes/:id/prestacao/rateio-perda — RC4.2
   */
  async definirRateioPerda(req, res, next) {
    try {
      const body = req.body || {};
      const useCase = this._container.definirRateioPerdaUseCase;
      const result = await useCase.executar({
        consignacaoId: req.params.id,
        tipoRateio: body.tipoRateio || body.tipo_rateio,
        valorCliente: body.valorCliente ?? body.valor_cliente,
        valorEmpresa: body.valorEmpresa ?? body.valor_empresa,
        campoEditado: body.campoEditado || body.campo_editado || null,
        motivoPerda: body.motivoPerda || body.motivo_perda,
        observacaoPerda: body.observacaoPerda || body.observacao_perda,
        usuarioId: body.usuarioId || body.usuario_id || req.usuario?.id,
        correlationId: req.correlationId
      });
      const response = ResultHttpMapper.map(result);
      return res.status(StandardResponse.getStatusCode(response)).json(StandardResponse.enrich(response, req));
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /consignacoes/:id/prestacao/cortesia
   * Registra uma cortesia na prestação.
   */
  async registrarCortesia(req, res, next) {
    try {
      const { id } = req.params;
      const validation = RegistrarCortesiaRequest.validate(req.body);
      if (validation) {
        return responderValidacao(res, req, validation);
      }

      const inputData = RegistrarCortesiaRequest.fromJSON(req.body);
      inputData.consignacaoId = id;
      inputData.correlationId = req.correlationId;

      const useCase = this._container.registrarCortesiaUseCase;
      const result = await useCase.executar(inputData);

      const response = ResultHttpMapper.map(result);
      const enriched = StandardResponse.enrich(response, req);
      return res.status(StandardResponse.getStatusCode(response)).json(enriched);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /consignacoes/:id/prestacao/pagamento
   * Registra um pagamento na prestação.
   */
  async registrarPagamento(req, res, next) {
    try {
      const { id } = req.params;

      console.log('\n==========================');
      console.log('REGISTRAR PAGAMENTO');
      console.log('==========================');
      console.log('Consignação:', id);
      console.log('Payload recebido:', JSON.stringify(req.body, null, 2));
      console.log('==========================\n');

      const validation = RegistrarPagamentoRequest.validate(req.body);
      if (validation) {
        console.log('[REGISTRAR PAGAMENTO] Rejeição DTO/validação:', JSON.stringify(validation));
        const response = {
          success: false,
          code: 'VALIDATION_ERROR',
          message: "Campo 'valor' é obrigatório ou inválido.",
          detail: 'Falha em RegistrarPagamentoRequest.validate',
          rule: 'DTO_VALOR_OBRIGATORIO',
          payload: {
            body: req.body,
            validation,
            arquivo: 'ConsignacaoDTO.js',
            linha: 'RegistrarPagamentoRequest.validate'
          },
          error: {
            code: 'VALIDATION_ERROR',
            message: "Campo 'valor' é obrigatório ou inválido.",
            details: validation
          }
        };
        const enriched = StandardResponse.enrich(response, req);
        return res.status(400).json(enriched);
      }

      const inputData = RegistrarPagamentoRequest.fromJSON(req.body);
      inputData.consignacaoId = Number(id);
      inputData.correlationId = req.correlationId;

      console.log('[REGISTRAR PAGAMENTO] DTO:', JSON.stringify(inputData, null, 2));

      const useCase = this._container.registrarPagamentoPrestacaoUseCase;
      const result = await useCase.executar(inputData);

      const response = ResultHttpMapper.map(result);
      const enriched = StandardResponse.enrich(response, req);
      return res.status(StandardResponse.getStatusCode(response)).json(enriched);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /consignacoes/:id/prestacao/fechar
   * Fecha uma prestação de conta.
   */
  async fecharPrestacao(req, res, next) {
    try {
      const { id } = req.params;
      const { usuarioId } = req.body;

      const inputData = {
        consignacaoId: id,
        usuarioId,
        correlationId: req.correlationId
      };

      const useCase = this._container.fecharPrestacaoUseCase;
      const result = await useCase.executar(inputData);

      const response = ResultHttpMapper.map(result);
      if (!ResultHttpMapper._isFailure(result)) {
        await registrarLogOperacaoComercial(req, {
          acao: 'prestacao_fechar',
          consignacaoId: id
        });
      }
      const enriched = StandardResponse.enrich(response, req);
      return res.status(StandardResponse.getStatusCode(response)).json(enriched);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /consignacoes/:id/prestacao/resumo-final
   * STAB-06 — Resumo oficial (Integridade Comercial) sem persistir.
   */
  async resumoFinalPrestacao(req, res, next) {
    try {
      const { id } = req.params;
      const useCase = this._container.finalizarPrestacaoComVendaOficialUseCase;
      const result = await useCase.executar({
        consignacaoId: id,
        apenasResumo: true,
        emitirFiscal: req.query.emitirFiscal !== 'false',
        correlationId: req.correlationId
      });
      const response = ResultHttpMapper.map(result);
      const enriched = StandardResponse.enrich(response, req);
      return res.status(StandardResponse.getStatusCode(response)).json(enriched);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /consignacoes/:id/prestacao/finalizar-venda-oficial
   * STAB-06 — Gera venda oficial (criarVenda) + encerra prestação.
   */
  async finalizarVendaOficial(req, res, next) {
    try {
      const { id } = req.params;
      const body = req.body || {};
      const useCase = this._container.finalizarPrestacaoComVendaOficialUseCase;
      const result = await useCase.executar({
        consignacaoId: id,
        usuarioId: body.usuarioId,
        emitirFiscal: body.emitirFiscal === true,
        fechar: body.fechar !== false,
        correlationId: req.correlationId,
        motivo: body.motivo
      });
      const response = ResultHttpMapper.map(result);
      const enriched = StandardResponse.enrich(response, req);
      return res.status(StandardResponse.getStatusCode(response)).json(enriched);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /consignacoes/:id/prestacao/emitir-nfce
   * STAB-06.3 — Venda oficial (se necessário) + emitirPorVendaId. Não encerra.
   */
  async emitirNfcePrestacao(req, res, next) {
    try {
      const { id } = req.params;
      const body = req.body || {};
      const useCase = this._container.emitirNfcePrestacaoUseCase;
      const result = await useCase.executar({
        consignacaoId: id,
        usuarioId: body.usuarioId,
        correlationId: req.correlationId
      });
      const response = ResultHttpMapper.map(result);
      const enriched = StandardResponse.enrich(response, req);
      return res.status(StandardResponse.getStatusCode(response)).json(enriched);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /vendas/:vendaId/pos-nfce-autorizada
   * STAB-06.3+ — após NFC-e no Módulo Fiscal: sincroniza faturamento e encerra Prestação.
   */
  async posNfceAutorizada(req, res, next) {
    try {
      const vendaId = req.params.vendaId;
      const body = req.body || {};
      const useCase = this._container.posNfcePrestacaoUseCase;
      const result = await useCase.executar({
        vendaId,
        usuarioId: body.usuarioId ?? req.user?.id,
        fechar: body.fechar !== false,
        correlationId: req.correlationId,
        motivo: body.motivo
      });
      const response = ResultHttpMapper.map(result);
      const enriched = StandardResponse.enrich(response, req);
      return res.status(StandardResponse.getStatusCode(response)).json(enriched);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /consignacoes/:id/prestacao/reabrir
   * Reabre uma prestação de conta.
   */
  async reabrirPrestacao(req, res, next) {
    try {
      const { id } = req.params;
      const { usuarioId, motivo, liberacaoGerencial, documento } = req.body;

      const inputData = {
        consignacaoId: id,
        usuarioId,
        motivo,
        liberacaoGerencial,
        documento,
        correlationId: req.correlationId
      };

      const useCase = this._container.reabrirPrestacaoUseCase;
      const result = await useCase.executar(inputData);

      const response = ResultHttpMapper.map(result);
      const enriched = StandardResponse.enrich(response, req);
      return res.status(StandardResponse.getStatusCode(response)).json(enriched);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /consignacoes/:id/comprovante
   * Motor de Comprovantes — ENTREGA (padrão) ou PRESTACAO (?tipo=PRESTACAO).
   * Independente de NFC-e; somente leitura/geração de documento.
   */
  async obterComprovante(req, res, next) {
    try {
      const { id } = req.params;
      const consignacaoRepository = this._container.consignacaoRepository;
      const consignacao = await consignacaoRepository.buscarPorId(id);
      if (!consignacao || !consignacaoPertenceAoCliente(consignacao, req.query.clienteId || req.query.cliente_id)) {
        const response = StandardResponse.notFound('Consignação não encontrada');
        const enriched = StandardResponse.enrich(response, req);
        return res.status(StandardResponse.getStatusCode(response)).json(enriched);
      }

      const tipo = String(req.query?.tipo || 'ENTREGA').toUpperCase();
      const {
        gerarComprovanteEntrega,
        gerarComprovantePrestacao,
        registrarAcaoComprovante,
        TIPOS_COMPROVANTE
      } = require('../../comprovantes');

      const opcoes = {
        vendedorNome: req.user?.username || req.user?.nome || null,
        observacaoEntrega: req.query?.observacao || null,
        observacao: req.query?.observacao || null
      };

      const comprovante = tipo === TIPOS_COMPROVANTE.PRESTACAO
        ? await gerarComprovantePrestacao(id, opcoes)
        : await gerarComprovanteEntrega(id, opcoes);

      await registrarAcaoComprovante(req, {
        acao: 'visualizacao',
        consignacaoId: id,
        comprovanteId: comprovante.id,
        numeroComprovante: comprovante.numeroComprovante
      });

      const response = StandardResponse.success(comprovante);
      const enriched = StandardResponse.enrich(response, req);
      return res.status(StandardResponse.getStatusCode(response)).json(enriched);
    } catch (error) {
      if (error.statusCode === 404) {
        const response = StandardResponse.notFound(error.message || 'Não encontrado');
        const enriched = StandardResponse.enrich(response, req);
        return res.status(404).json(enriched);
      }
      if (error.statusCode === 400) {
        const response = StandardResponse.validationError(error.message || 'Dados inválidos');
        const enriched = StandardResponse.enrich(response, req);
        return res.status(400).json(enriched);
      }
      next(error);
    }
  }

  /**
   * POST /consignacoes/:id/comprovante/acoes
   * Auditoria de compartilhamento (copiar, whatsapp, pdf, impressão…).
   */
  async registrarAcaoComprovante(req, res, next) {
    try {
      const { id } = req.params;
      const { acao, comprovanteId, numeroComprovante } = req.body || {};
      const { registrarAcaoComprovante } = require('../../comprovantes');

      await registrarAcaoComprovante(req, {
        acao,
        consignacaoId: id,
        comprovanteId: comprovanteId || null,
        numeroComprovante: numeroComprovante || null,
        detalhes: { body: req.body || {} }
      });

      const response = StandardResponse.success({ ok: true, acao });
      const enriched = StandardResponse.enrich(response, req);
      return res.status(StandardResponse.getStatusCode(response)).json(enriched);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = ConsignacaoController;
