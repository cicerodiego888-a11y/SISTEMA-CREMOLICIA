/**
 * CentralComprasBridgeService — Ponte entre Central de Entradas e Compras.
 *
 * Sprint 5: payload parse-xml, abertura de compra e vínculo pós-saveCompra().
 *
 * @class CentralComprasBridgeService
 */

const NFeParserService = require('../../../shared/nfe/NFeParserService');
const { enriquecerParseComMiip } = require('../../../shared/nfe/enriquecerParseComMiip');
const { DocumentoFiscalStatus } = require('../core/DocumentoFiscalStatus');
const { validarTransicao } = require('../core/MaquinaEstadosDocumento');
const { paraDocumentoDetalheDTO } = require('../utils/centralEntradasMapper');
const CentralDocumentosRepository = require('../repositories/CentralDocumentosRepository');
const CentralHistoricoService = require('./CentralHistoricoService');
const { resolverDb } = require('../repositories/dbHelpers');
const {
  validarProdutosIdentificadosCompra,
  CODIGO_VINCULO_INVALIDO,
  MENSAGEM_VINCULO_INVALIDO_REVISAO
} = require('../../../modules/compras/resolverProdutoItem');

class CentralComprasBridgeService {
  /**
   * @param {Object} [deps]
   * @param {import('../repositories/CentralDocumentosRepository')} [deps.documentosRepository]
   * @param {import('./CentralHistoricoService')} [deps.historicoService]
   */
  constructor(deps = {}) {
    /** @private */
    this._documentosRepository = deps.documentosRepository
      ?? new CentralDocumentosRepository();
    /** @private */
    this._historicoService = deps.historicoService
      ?? new CentralHistoricoService();
    /** @private */
    this._validarProdutos = deps.validarProdutos
      ?? ((itens) => validarProdutosIdentificadosCompra(resolverDb(deps.db ?? null), itens));
  }

  /**
   * @private
   */
  async _transicionar(id, statusAtual, statusNovo, opcoes = {}) {
    const validacao = validarTransicao(statusAtual, statusNovo);
    if (!validacao.valido) {
      const erro = new Error(validacao.erro);
      erro.statusCode = 400;
      throw erro;
    }

    await this._documentosRepository.atualizar(id, {
      status: statusNovo,
      statusDetalhe: opcoes.detalhe ?? null,
      usuarioId: opcoes.usuarioId ?? null
    });

    if (statusAtual !== statusNovo) {
      await this._historicoService.registrar({
        documentoId: id,
        statusAnterior: statusAtual,
        statusNovo,
        usuarioId: opcoes.usuarioId ?? null,
        detalhe: opcoes.detalhe ?? `Transição: ${statusAtual} → ${statusNovo}`
      });
    }
  }

  /**
   * @param {Object} documento
   * @returns {Promise<Object>}
   */
  async _obterOuGerarPayloadParse(documento) {
    if (documento.parseJson) {
      return { ...documento.parseJson };
    }

    if (!documento.xml) {
      const erro = new Error('XML não disponível');
      erro.statusCode = 400;
      throw erro;
    }

    const parsed = await NFeParserService.parse(documento.xml);
    const { miipImportacao } = await enriquecerParseComMiip(parsed);

    await this._documentosRepository.atualizar(documento.id, {
      parseJson: parsed,
      miipSessaoId: miipImportacao?.operacaoId ?? null,
      miipResumoJson: miipImportacao
        ? { operacaoId: miipImportacao.operacaoId, resumo: miipImportacao.resumo, resultados: miipImportacao.resultados }
        : null,
      processadoEm: new Date().toISOString()
    });

    return parsed;
  }

  /**
   * @param {number|string} documentoId
   * @returns {Promise<Object>}
   */
  async montarPayloadAbrirCompra(documentoId) {
    const documento = await this._documentosRepository.buscarPorId(documentoId);
    if (!documento) {
      const erro = new Error('Documento não encontrado');
      erro.statusCode = 404;
      throw erro;
    }

    const payload = await this._obterOuGerarPayloadParse(documento);

    return {
      sucesso: true,
      documentoId: documento.id,
      chave: documento.chave,
      status: documento.status,
      dadosCompra: payload
    };
  }

  /**
   * @param {number|string} documentoId
   * @param {Object} [opcoes]
   * @returns {Promise<Object>}
   */
  async registrarAberturaCompra(documentoId, opcoes = {}) {
    const documento = await this._documentosRepository.buscarPorId(documentoId);
    if (!documento) {
      const erro = new Error('Documento não encontrado');
      erro.statusCode = 404;
      throw erro;
    }

    const statusPermitidos = [
      DocumentoFiscalStatus.PRONTA_PARA_COMPRA,
      DocumentoFiscalStatus.REVISADA,
      DocumentoFiscalStatus.EM_COMPRA
    ];

    if (!statusPermitidos.includes(documento.status)) {
      const erro = new Error(`Documento não está pronto para Compras (status: ${documento.status})`);
      erro.statusCode = 400;
      throw erro;
    }

    const parse = await this._obterOuGerarPayloadParse(documento);
    const problemas = await this._validarProdutos(Array.isArray(parse.itens) ? parse.itens : []);
    if (problemas.length) {
      if (documento.status !== DocumentoFiscalStatus.AGUARDANDO_REVISAO) {
        await this._transicionar(
          documentoId,
          documento.status,
          DocumentoFiscalStatus.AGUARDANDO_REVISAO,
          {
            detalhe: MENSAGEM_VINCULO_INVALIDO_REVISAO,
            usuarioId: opcoes.usuarioId
          }
        );
      }

      const erro = new Error(MENSAGEM_VINCULO_INVALIDO_REVISAO);
      erro.statusCode = 409;
      erro.codigo = CODIGO_VINCULO_INVALIDO;
      erro.itens = problemas;
      throw erro;
    }

    if (documento.status !== DocumentoFiscalStatus.EM_COMPRA) {
      await this._transicionar(
        documentoId,
        documento.status,
        DocumentoFiscalStatus.EM_COMPRA,
        {
          detalhe: 'Compra aberta na tela de Compras',
          usuarioId: opcoes.usuarioId
        }
      );
    }

    const payload = await this.montarPayloadAbrirCompra(documentoId);
    const atualizado = await this._documentosRepository.buscarPorId(documentoId);

    return {
      ...payload,
      documento: paraDocumentoDetalheDTO(atualizado)
    };
  }

  /**
   * @param {number|string} documentoId
   * @param {Object} dados
   * @param {Object[]} [dados.itens]
   * @param {number} [dados.usuarioId]
   * @returns {Promise<Object>}
   */
  async concluirRevisao(documentoId, dados = {}) {
    const documento = await this._documentosRepository.buscarPorId(documentoId);
    if (!documento) {
      const erro = new Error('Documento não encontrado');
      erro.statusCode = 404;
      throw erro;
    }

    if (documento.status !== DocumentoFiscalStatus.AGUARDANDO_REVISAO) {
      const erro = new Error(`Revisão só pode ser concluída em AGUARDANDO_REVISAO (atual: ${documento.status})`);
      erro.statusCode = 400;
      throw erro;
    }

    const parseAtual = documento.parseJson || {};
    const itensAtualizados = Array.isArray(dados.itens) ? dados.itens : parseAtual.itens;

    const problemas = await this._validarProdutos(Array.isArray(itensAtualizados) ? itensAtualizados : []);
    if (problemas.length) {
      const erro = new Error(MENSAGEM_VINCULO_INVALIDO_REVISAO);
      erro.statusCode = 409;
      erro.codigo = CODIGO_VINCULO_INVALIDO;
      erro.itens = problemas;
      throw erro;
    }

    const parseAtualizado = {
      ...parseAtual,
      itens: itensAtualizados
    };

    await this._documentosRepository.atualizar(documentoId, {
      parseJson: parseAtualizado,
      processadoEm: new Date().toISOString()
    });

    await this._transicionar(
      documentoId,
      DocumentoFiscalStatus.AGUARDANDO_REVISAO,
      DocumentoFiscalStatus.REVISADA,
      {
        detalhe: 'Central de Revisão MIIP concluída',
        usuarioId: dados.usuarioId
      }
    );

    await this._transicionar(
      documentoId,
      DocumentoFiscalStatus.REVISADA,
      DocumentoFiscalStatus.PRONTA_PARA_COMPRA,
      {
        detalhe: 'Documento liberado para Compras',
        usuarioId: dados.usuarioId
      }
    );

    const atualizado = await this._documentosRepository.buscarPorId(documentoId);

    return {
      sucesso: true,
      documento: paraDocumentoDetalheDTO(atualizado),
      parse: parseAtualizado,
      proximaAcao: 'abrir_compra'
    };
  }

  /**
   * @param {number|string} documentoId
   * @param {number|string} compraId
   * @param {Object} [opcoes]
   * @returns {Promise<Object>}
   */
  async vincularCompra(documentoId, compraId, opcoes = {}) {
    const documento = await this._documentosRepository.buscarPorId(documentoId);
    if (!documento) {
      const erro = new Error('Documento não encontrado');
      erro.statusCode = 404;
      throw erro;
    }

    const statusAtual = documento.status;
    const statusDestino = DocumentoFiscalStatus.GRAVADA;

    if (statusAtual !== DocumentoFiscalStatus.EM_COMPRA && statusAtual !== DocumentoFiscalStatus.PRONTA_PARA_COMPRA) {
      const validacao = validarTransicao(statusAtual, statusDestino);
      if (!validacao.valido) {
        const erro = new Error(validacao.erro);
        erro.statusCode = 400;
        throw erro;
      }
    }

    if (statusAtual === DocumentoFiscalStatus.PRONTA_PARA_COMPRA) {
      await this._transicionar(documentoId, statusAtual, DocumentoFiscalStatus.EM_COMPRA, {
        detalhe: 'Vínculo com compra gravada',
        usuarioId: opcoes.usuarioId
      });
    }

    await this._documentosRepository.atualizar(documentoId, {
      compraId: Number(compraId),
      processadoEm: new Date().toISOString()
    });

    await this._transicionar(
      documentoId,
      DocumentoFiscalStatus.EM_COMPRA,
      DocumentoFiscalStatus.GRAVADA,
      {
        detalhe: `Compra #${compraId} gravada via saveCompra()`,
        usuarioId: opcoes.usuarioId
      }
    );

    const atualizado = await this._documentosRepository.buscarPorId(documentoId);

    const { emitirCompraGravada } = require('../utils/centralEventosEmitter');
    emitirCompraGravada(atualizado, compraId).catch(() => {});

    return {
      sucesso: true,
      documento: paraDocumentoDetalheDTO(atualizado),
      compraId: Number(compraId)
    };
  }
}

module.exports = CentralComprasBridgeService;
