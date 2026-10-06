/**
 * CentralDashboardService — Agregação de KPIs do dashboard.
 *
 * Sprint 4: inclui metadados de sincronização DF-e.
 *
 * @class CentralDashboardService
 */

const CentralDashboardDTO = require('../contracts/CentralDashboardDTO');
const { DocumentoFiscalStatus, TODOS } = require('../core/DocumentoFiscalStatus');
const CentralNsuRepository = require('../repositories/CentralNsuRepository');

class CentralDashboardService {
  /**
   * @param {Object} [deps]
   * @param {import('../repositories/CentralDocumentosRepository')} [deps.documentosRepository]
   * @param {import('../repositories/CentralNsuRepository')} [deps.nsuRepository]
   */
  constructor(deps = {}) {
    /** @private */
    this._documentosRepository = deps.documentosRepository
      ?? new (require('../repositories/CentralDocumentosRepository'))();
    /** @private */
    this._nsuRepository = deps.nsuRepository ?? new CentralNsuRepository();
  }

  /**
   * @returns {Promise<Object>}
   */
  async obterResumo() {
    const contadoresPorStatus = await this._documentosRepository.contarPorStatus({});
    const ultimoNsu = await this._nsuRepository.obterUltimaSincronizacao();
    const estatisticas = await this._documentosRepository.obterEstatisticas();

    const contadores = {};
    TODOS.forEach((status) => {
      contadores[status] = contadoresPorStatus[status] || 0;
    });

    const total = Object.values(contadores).reduce((acc, n) => acc + Number(n || 0), 0);

    return CentralDashboardDTO.create({
      contadores: {
        novas: contadores[DocumentoFiscalStatus.SINCRONIZADA] || 0,
        aguardandoXml: (contadores[DocumentoFiscalStatus.AGUARDANDO_XML] || 0)
          + (contadores[DocumentoFiscalStatus.XML_RECUPERANDO] || 0)
          + (contadores[DocumentoFiscalStatus.ERRO_RECUPERACAO] || 0),
        emProcessamento: contadores[DocumentoFiscalStatus.EM_PROCESSAMENTO] || 0,
        aguardandoRevisao: contadores[DocumentoFiscalStatus.AGUARDANDO_REVISAO] || 0,
        prontasParaCompra: contadores[DocumentoFiscalStatus.PRONTA_PARA_COMPRA] || 0,
        gravadas: contadores[DocumentoFiscalStatus.GRAVADA] || 0,
        erros: contadores[DocumentoFiscalStatus.ERRO] || 0,
        porStatus: contadores,
        total
      },
      indicadores: {
        totalDocumentos: estatisticas.totalDocumentos,
        valorTotalDia: estatisticas.valorTotalDia,
        documentosHoje: estatisticas.documentosHoje
      },
      ultimaSincronizacao: ultimoNsu?.dataSincronizacao || ultimoNsu?.updatedAt || null,
      sincronizacao: ultimoNsu
        ? {
          ultNsu: ultimoNsu.ultNsu,
          maxNsu: ultimoNsu.maxNsu,
          dataSincronizacao: ultimoNsu.dataSincronizacao,
          cnpj: ultimoNsu.cnpj,
          ambiente: ultimoNsu.ambiente
        }
        : null
    }).toJSON();
  }
}

module.exports = CentralDashboardService;
