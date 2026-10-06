/**
 * CentralEntradasOrchestrator — Coordenação única do pipeline da Central.
 *
 * Coordena: descoberta → XML → Parser → MIIP → estado → Compras.
 * Não contém regras de estoque, compra, financeiro ou fiscal.
 *
 * @class CentralEntradasOrchestrator
 */

const { DocumentoFiscalStatus } = require('./core/DocumentoFiscalStatus');
const { validarTransicao } = require('./core/MaquinaEstadosDocumento');
const { xmlPossuiNfeCompleta, classificarXml, CLASSE_XML } = require('./core/xmlDocumento');
const { emitirEvento } = require('./utils/centralEventosEmitter');
const { TIPOS_EVENTO, ORIGENS } = require('./config/centralEventosTipos');

class CentralEntradasOrchestrator {
  /**
   * @param {Object} deps
   */
  constructor(deps = {}) {
    this._documentosRepository = deps.documentosRepository;
    this._historicoService = deps.historicoService;
    this._processamentoService = deps.processamentoService;
    this._sincronizacaoService = deps.sincronizacaoService;
    this._comprasBridgeService = deps.comprasBridgeService;
  }

  /**
   * @private
   */
  async _transicionar(documento, statusNovo, detalhe, usuarioId) {
    const validacao = validarTransicao(documento.status, statusNovo);
    if (!validacao.valido) {
      const erro = new Error(validacao.erro);
      erro.statusCode = 400;
      throw erro;
    }

    await this._documentosRepository.atualizar(documento.id, {
      status: statusNovo,
      statusDetalhe: detalhe ?? null,
      usuarioId: usuarioId ?? null
    });

    if (documento.status !== statusNovo) {
      await this._historicoService.registrar({
        documentoId: documento.id,
        statusAnterior: documento.status,
        statusNovo,
        usuarioId: usuarioId ?? null,
        detalhe: detalhe ?? `Transição: ${documento.status} → ${statusNovo}`
      });
    }

    return this._documentosRepository.buscarPorId(documento.id);
  }

  /**
   * @param {number|string} documentoId
   * @param {Object} [opcoes]
   * @returns {Promise<Object>}
   */
  async processar(documentoId, opcoes = {}) {
    const documento = await this._documentosRepository.buscarPorId(documentoId);
    if (!documento) {
      const erro = new Error('Documento não encontrado');
      erro.statusCode = 404;
      throw erro;
    }

    const classeXml = classificarXml(documento.xml);
    await emitirEvento({
      tipo: TIPOS_EVENTO.CLASSIFICACAO,
      origem: opcoes.origem || ORIGENS.API,
      descricao: `Classificação XML: ${classeXml}`,
      resultado: classeXml,
      sucesso: true,
      documentoId: documento.id
    });

    if (classeXml !== CLASSE_XML.COMPLETO) {
      if (
        documento.status === DocumentoFiscalStatus.SINCRONIZADA
        || documento.status === DocumentoFiscalStatus.RECEBIDA
      ) {
        await this._transicionar(
          documento,
          DocumentoFiscalStatus.AGUARDANDO_XML,
          'Documento localizado sem XML completo',
          opcoes.usuarioId
        );
      }

      await emitirEvento({
        tipo: TIPOS_EVENTO.XML_AGUARDANDO,
        origem: opcoes.origem || ORIGENS.API,
        descricao: 'XML indisponível — documento em espera controlada',
        resultado: DocumentoFiscalStatus.AGUARDANDO_XML,
        sucesso: true,
        documentoId: documento.id
      });

      return {
        sucesso: false,
        aguardandoXml: true,
        documentoId: documento.id,
        mensagem: 'XML não disponível. Documento permanece na Central aguardando recuperação.',
        etapaAtual: 'xml'
      };
    }

    await emitirEvento({
      tipo: TIPOS_EVENTO.PARSER,
      origem: opcoes.origem || ORIGENS.API,
      descricao: 'Encaminhando XML ao parser oficial',
      resultado: 'parser',
      sucesso: true,
      documentoId: documento.id
    });

    return this._processamentoService.processar(documentoId, opcoes);
  }

  /**
   * @param {number|string} documentoId
   * @param {Object} [opcoes]
   * @returns {Promise<Object>}
   */
  async recuperarXml(documentoId, opcoes = {}) {
    const documento = await this._documentosRepository.buscarPorId(documentoId);
    if (!documento) {
      const erro = new Error('Documento não encontrado');
      erro.statusCode = 404;
      throw erro;
    }

    if (xmlPossuiNfeCompleta(documento.xml)) {
      if (documento.status === DocumentoFiscalStatus.AGUARDANDO_XML
        || documento.status === DocumentoFiscalStatus.XML_RECUPERANDO
        || documento.status === DocumentoFiscalStatus.ERRO_RECUPERACAO) {
        await this._transicionar(
          documento,
          DocumentoFiscalStatus.SINCRONIZADA,
          'XML completo já disponível',
          opcoes.usuarioId
        );
      }

      return {
        sucesso: true,
        recuperado: true,
        jaPossuiaXml: true,
        documentoId: documento.id
      };
    }

    const emRecuperacao = await this._transicionar(
      documento,
      DocumentoFiscalStatus.XML_RECUPERANDO,
      'Tentativa controlada de recuperação de XML',
      opcoes.usuarioId
    );

    try {
      const consulta = await this._sincronizacaoService.buscarPorChave(documento.chave);
      const atualizado = await this._documentosRepository.buscarPorId(documento.id);
      const completo = xmlPossuiNfeCompleta(atualizado?.xml);

      if (completo) {
        await emitirEvento({
          tipo: TIPOS_EVENTO.XML_RECEBIDO,
          origem: opcoes.origem || ORIGENS.SISTEMA,
          descricao: 'XML completo recebido após espera',
          resultado: DocumentoFiscalStatus.SINCRONIZADA,
          sucesso: true,
          documentoId: documento.id
        });

        if (atualizado.status !== DocumentoFiscalStatus.SINCRONIZADA
          && atualizado.status !== DocumentoFiscalStatus.DUPLICADA) {
          await this._transicionar(
            atualizado,
            DocumentoFiscalStatus.SINCRONIZADA,
            'XML recuperado — documento pronto para o pipeline',
            opcoes.usuarioId
          );
        }

        return {
          sucesso: true,
          recuperado: true,
          documentoId: documento.id,
          consulta
        };
      }

      await this._transicionar(
        emRecuperacao,
        DocumentoFiscalStatus.AGUARDANDO_XML,
        'XML ainda indisponível na SEFAZ',
        opcoes.usuarioId
      );

      await emitirEvento({
        tipo: TIPOS_EVENTO.XML_AGUARDANDO,
        origem: opcoes.origem || ORIGENS.SISTEMA,
        descricao: 'Nova espera de XML após tentativa de recuperação',
        resultado: DocumentoFiscalStatus.AGUARDANDO_XML,
        sucesso: true,
        documentoId: documento.id
      });

      return {
        sucesso: true,
        recuperado: false,
        aguardandoXml: true,
        documentoId: documento.id,
        consulta
      };
    } catch (error) {
      await this._transicionar(
        emRecuperacao,
        DocumentoFiscalStatus.ERRO_RECUPERACAO,
        error.message,
        opcoes.usuarioId
      );

      await emitirEvento({
        tipo: TIPOS_EVENTO.XML_ERRO_RECUPERACAO,
        origem: opcoes.origem || ORIGENS.SISTEMA,
        descricao: error.message,
        resultado: 'erro',
        sucesso: false,
        documentoId: documento.id
      });

      return {
        sucesso: false,
        recuperado: false,
        documentoId: documento.id,
        mensagem: error.message,
        erros: [error.message]
      };
    }
  }

  /**
   * Integração com Compras permanece no bridge existente.
   *
   * @param {number|string} documentoId
   * @param {Object} [opcoes]
   * @returns {Promise<Object>}
   */
  async prepararIntegracaoCompras(documentoId, opcoes = {}) {
    return this._comprasBridgeService.montarPayloadAbrirCompra(documentoId, opcoes);
  }
}

module.exports = CentralEntradasOrchestrator;
