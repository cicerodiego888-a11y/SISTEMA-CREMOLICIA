/**
 * CentralDiagnosticoService — Diagnóstico operacional da Central existente.
 *
 * Não cria dashboard paralelo. Alimenta health/operacional/API.
 *
 * @class CentralDiagnosticoService
 */

const sefazGate = require('./CentralSefazOperationalGate');
const centralXmlWaitScheduler = require('./CentralXmlWaitScheduler');
const centralSyncBackground = require('./CentralSyncBackgroundService');
const { DocumentoFiscalStatus } = require('../core/DocumentoFiscalStatus');

class CentralDiagnosticoService {
  /**
   * @param {Object} deps
   */
  constructor(deps = {}) {
    this._documentosRepository = deps.documentosRepository;
    this._nsuControleService = deps.nsuControleService;
    this._eventosService = deps.eventosService;
  }

  /**
   * @returns {Promise<Object>}
   */
  async obter() {
    const [nsu, contadores, ultimoErro] = await Promise.all([
      this._nsuControleService.obterEstado(),
      this._documentosRepository.contarPorStatus({}),
      this._eventosService.obterUltimoErroSync()
    ]);

    return {
      centralFuncionando: true,
      sefaz: sefazGate.obterEstado(),
      sync: centralSyncBackground.obterStatus(),
      xmlWait: centralXmlWaitScheduler.obterStatus(),
      nsu,
      filas: {
        aguardandoXml: contadores[DocumentoFiscalStatus.AGUARDANDO_XML] || 0,
        xmlRecuperando: contadores[DocumentoFiscalStatus.XML_RECUPERANDO] || 0,
        erroRecuperacao: contadores[DocumentoFiscalStatus.ERRO_RECUPERACAO] || 0,
        novas: contadores[DocumentoFiscalStatus.SINCRONIZADA] || 0,
        erros: contadores[DocumentoFiscalStatus.ERRO] || 0,
        pendentesRevisao: contadores[DocumentoFiscalStatus.AGUARDANDO_REVISAO] || 0
      },
      ultimoErro: ultimoErro
        ? { mensagem: ultimoErro.descricao, em: ultimoErro.createdAt }
        : null
    };
  }
}

module.exports = CentralDiagnosticoService;
