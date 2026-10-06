/**
 * CentralMirxService — Motor de Idempotência e Reprocessamento XML (MIRX).
 *
 * Reprocessa Parser/MIIP no mesmo documento, sem duplicar entrada, estoque,
 * financeiro, documento ou compra.
 *
 * @class CentralMirxService
 */

const { DocumentoFiscalStatus } = require('../core/DocumentoFiscalStatus');
const { validarTransicao } = require('../core/MaquinaEstadosDocumento');
const { xmlPossuiNfeCompleta } = require('../core/xmlDocumento');
const CentralDocumentosRepository = require('../repositories/CentralDocumentosRepository');
const CentralHistoricoService = require('./CentralHistoricoService');
const CentralProcessamentoService = require('./CentralProcessamentoService');
const { emitirEvento } = require('../utils/centralEventosEmitter');
const { TIPOS_EVENTO, ORIGENS } = require('../config/centralEventosTipos');

const STATUS_INTEGRADOS = Object.freeze([
  DocumentoFiscalStatus.EM_COMPRA,
  DocumentoFiscalStatus.GRAVADA,
  DocumentoFiscalStatus.DUPLICADA
]);

class CentralMirxService {
  /**
   * @param {Object} [deps]
   */
  constructor(deps = {}) {
    this._documentosRepository = deps.documentosRepository ?? new CentralDocumentosRepository();
    this._historicoService = deps.historicoService ?? new CentralHistoricoService();
    this._processamentoService = deps.processamentoService ?? new CentralProcessamentoService({
      documentosRepository: this._documentosRepository,
      historicoService: this._historicoService
    });
  }

  /**
   * @param {number|string} documentoId
   * @param {Object} [opcoes]
   * @returns {Promise<Object>}
   */
  async reprocessar(documentoId, opcoes = {}) {
    const documento = await this._documentosRepository.buscarPorId(documentoId);
    if (!documento) {
      const erro = new Error('Documento não encontrado');
      erro.statusCode = 404;
      throw erro;
    }

    const chaveIdempotencia = `mirx:${documento.chave}`;

    if (STATUS_INTEGRADOS.includes(documento.status) || documento.compraId) {
      await emitirEvento({
        tipo: TIPOS_EVENTO.MIRX_BLOQUEADO,
        origem: opcoes.origem || ORIGENS.API,
        descricao: 'Reprocessamento bloqueado para não duplicar efeitos de Compras',
        resultado: documento.status,
        sucesso: true,
        documentoId: documento.id,
        detalhe: { chaveIdempotencia, compraId: documento.compraId }
      });

      return {
        sucesso: true,
        idempotente: true,
        reprocessado: false,
        documentoId: documento.id,
        chave: documento.chave,
        motivo: 'Documento já integrado. MIRX não duplica compra, estoque ou financeiro.'
      };
    }

    if (!xmlPossuiNfeCompleta(documento.xml)) {
      const erro = new Error('XML completo indisponível para reprocessamento');
      erro.statusCode = 400;
      throw erro;
    }

    if (documento.status !== DocumentoFiscalStatus.SINCRONIZADA) {
      const validacao = validarTransicao(documento.status, DocumentoFiscalStatus.SINCRONIZADA);
      if (!validacao.valido) {
        const erro = new Error(validacao.erro);
        erro.statusCode = 400;
        throw erro;
      }

      await this._documentosRepository.atualizar(documento.id, {
        status: DocumentoFiscalStatus.SINCRONIZADA,
        statusDetalhe: 'MIRX — retorno para reprocessamento idempotente'
      });

      await this._historicoService.registrar({
        documentoId: documento.id,
        statusAnterior: documento.status,
        statusNovo: DocumentoFiscalStatus.SINCRONIZADA,
        usuarioId: opcoes.usuarioId ?? null,
        detalhe: 'MIRX: preparação para reprocessamento sem duplicar efeitos'
      });
    }

    await emitirEvento({
      tipo: TIPOS_EVENTO.MIRX_REPROCESSAMENTO,
      origem: opcoes.origem || ORIGENS.API,
      descricao: `Reprocessamento MIRX iniciado para ${documento.chave}`,
      resultado: 'iniciado',
      sucesso: true,
      documentoId: documento.id,
      detalhe: { chaveIdempotencia }
    });

    const resultado = await this._processamentoService.processar(documento.id, {
      usuarioId: opcoes.usuarioId,
      forcarReprocessamento: true
    });

    return {
      ...resultado,
      idempotente: true,
      reprocessado: Boolean(resultado.sucesso),
      chaveIdempotencia
    };
  }
}

module.exports = CentralMirxService;
