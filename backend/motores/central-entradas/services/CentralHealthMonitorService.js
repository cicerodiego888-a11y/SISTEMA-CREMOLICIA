/**
 * CentralHealthMonitorService — Indicadores operacionais da Central única.
 *
 * Integra health existente: SEFAZ, NSU, sync, filas e erros.
 *
 * @class CentralHealthMonitorService
 */

const { DocumentoFiscalStatus } = require('../core/DocumentoFiscalStatus');
const sefazGate = require('./CentralSefazOperationalGate');
const centralSyncBackground = require('./CentralSyncBackgroundService');
const centralXmlWaitScheduler = require('./CentralXmlWaitScheduler');

class CentralHealthMonitorService {
  /**
   * @param {Object} deps
   */
  constructor(deps = {}) {
    this._documentosRepository = deps.documentosRepository;
    this._nsuRepository = deps.nsuRepository;
    this._eventosService = deps.eventosService;
    this._nsuControleService = deps.nsuControleService;
    this._flags = deps.flags;
  }

  /**
   * @param {Object} [base]
   * @returns {Promise<Object>}
   */
  async obter(base = {}) {
    const [
      ultimoErro,
      ultimaSync,
      tempoMedioMs,
      contadores,
      nsuEstado
    ] = await Promise.all([
      this._eventosService.obterUltimoErroSync(),
      this._eventosService.obterUltimaSyncConcluida(),
      this._eventosService.obterTempoMedioSyncMs(),
      this._documentosRepository.contarPorStatus({}),
      this._nsuControleService.obterEstado()
    ]);

    const statusServico = centralSyncBackground.obterStatus();
    const sefaz = sefazGate.obterEstado();
    const xmlWait = centralXmlWaitScheduler.obterStatus();

    const aguardandoXml = (contadores[DocumentoFiscalStatus.AGUARDANDO_XML] || 0)
      + (contadores[DocumentoFiscalStatus.XML_RECUPERANDO] || 0);
    const erros = (contadores[DocumentoFiscalStatus.ERRO] || 0)
      + (contadores[DocumentoFiscalStatus.ERRO_RECUPERACAO] || 0);
    const pendentes = (contadores[DocumentoFiscalStatus.SINCRONIZADA] || 0)
      + (contadores[DocumentoFiscalStatus.AGUARDANDO_REVISAO] || 0)
      + (contadores[DocumentoFiscalStatus.EM_COMPRA] || 0)
      + aguardandoXml;

    return {
      modulo: 'central-entradas',
      versao: base.versao,
      habilitado: this._flags.estaHabilitado(),
      status: sefaz.disponivel ? 'ok' : 'degradado',
      sprint: base.sprint,
      centralFuncionando: this._flags.estaHabilitado(),
      sefazDisponivel: sefaz.disponivel,
      sefaz: sefaz,
      servicoAtivo: statusServico.servicoAtivo,
      syncAutomaticaHabilitada: statusServico.syncAutomaticaHabilitada,
      executandoSync: statusServico.executando,
      ultimaSincronizacao: nsuEstado.ultimaSincronizacao,
      ultimoNsu: nsuEstado.ultNsu,
      nsu: nsuEstado,
      ultimoErro: ultimoErro
        ? { mensagem: ultimoErro.descricao, em: ultimoErro.createdAt }
        : sefaz.ultimoErro
          ? { mensagem: sefaz.ultimoErro, em: sefaz.telemetria.ultimaFalhaEm }
          : null,
      tempoMedioSyncMs: tempoMedioMs,
      proximaExecucao: statusServico.proximaExecucao,
      ultimaExecucaoAutomatica: statusServico.ultimaExecucao,
      ultimaSyncEvento: ultimaSync
        ? {
          notasNovas: ultimaSync.notasNovas,
          duracaoMs: ultimaSync.duracaoMs,
          em: ultimaSync.createdAt
        }
        : null,
      filas: {
        aguardandoXml,
        erros,
        pendentes,
        processados: (contadores[DocumentoFiscalStatus.GRAVADA] || 0)
          + (contadores[DocumentoFiscalStatus.PRONTA_PARA_COMPRA] || 0)
      },
      xmlWait
    };
  }
}

module.exports = CentralHealthMonitorService;
