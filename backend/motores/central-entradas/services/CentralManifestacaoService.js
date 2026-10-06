/**
 * CentralManifestacaoService — Preparação de manifestação DF-e.
 *
 * Não envia evento fiscal automaticamente. Preserva o pipeline da NF-e.
 *
 * @class CentralManifestacaoService
 */

const CentralDocumentosRepository = require('../repositories/CentralDocumentosRepository');
const CentralConfigService = require('./CentralConfigService');
const { obterTipoManifestacao } = require('../config/centralManifestacaoTipos');
const { emitirEvento } = require('../utils/centralEventosEmitter');
const { TIPOS_EVENTO, ORIGENS } = require('../config/centralEventosTipos');

class CentralManifestacaoService {
  /**
   * @param {Object} [deps]
   */
  constructor(deps = {}) {
    this._documentosRepository = deps.documentosRepository ?? new CentralDocumentosRepository();
    this._configService = deps.configService ?? new CentralConfigService();
  }

  /**
   * @param {number|string} documentoId
   * @param {string} tipo
   * @param {Object} [opcoes]
   * @returns {Promise<Object>}
   */
  async preparar(documentoId, tipo, opcoes = {}) {
    const documento = await this._documentosRepository.buscarPorId(documentoId);
    if (!documento) {
      const erro = new Error('Documento não encontrado');
      erro.statusCode = 404;
      throw erro;
    }

    const tipoManifestacao = obterTipoManifestacao(tipo);
    if (!tipoManifestacao) {
      const erro = new Error(`Tipo de manifestação inválido: ${tipo}`);
      erro.statusCode = 400;
      throw erro;
    }

    await emitirEvento({
      tipo: TIPOS_EVENTO.MANIFESTACAO_PREPARADA,
      origem: opcoes.origem || ORIGENS.API,
      descricao: `Manifestação preparada: ${tipoManifestacao.nome}`,
      resultado: tipoManifestacao.codigo,
      sucesso: true,
      documentoId: documento.id,
      detalhe: {
        chave: documento.chave,
        codigo: tipoManifestacao.codigo,
        nome: tipoManifestacao.nome
      }
    });

    return {
      preparado: true,
      enviado: false,
      documentoId: documento.id,
      chave: documento.chave,
      tipo: tipoManifestacao,
      mensagem: 'Manifestação registrada como operação fiscal própria. Envio automático desabilitado.'
    };
  }

  /**
   * @param {number|string} documentoId
   * @param {string} tipo
   * @param {Object} [opcoes]
   * @returns {Promise<Object>}
   */
  async enviar(documentoId, tipo, opcoes = {}) {
    const preparado = await this.preparar(documentoId, tipo, opcoes);
    const cfg = await this._configService.obterResumo();

    if (!cfg.manifestacaoAutomaticaHabilitada) {
      await emitirEvento({
        tipo: TIPOS_EVENTO.MANIFESTACAO_BLOQUEADA,
        origem: opcoes.origem || ORIGENS.API,
        descricao: 'Envio de manifestação bloqueado — configuração automática desabilitada',
        resultado: 'bloqueado',
        sucesso: true,
        documentoId: preparado.documentoId
      });

      return {
        ...preparado,
        enviado: false,
        motivo: 'Envio automático de manifestação não está habilitado'
      };
    }

    return {
      ...preparado,
      enviado: false,
      motivo: 'Canal de envio de manifestação ainda não está habilitado nesta sprint'
    };
  }
}

module.exports = CentralManifestacaoService;
