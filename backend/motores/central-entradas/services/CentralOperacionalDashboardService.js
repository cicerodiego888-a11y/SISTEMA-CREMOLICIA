/**
 * CentralOperacionalDashboardService — Indicadores operacionais da Central.
 *
 * @class CentralOperacionalDashboardService
 */

const { DocumentoFiscalStatus } = require('../core/DocumentoFiscalStatus');
const CentralAlertasService = require('./CentralAlertasService');

class CentralOperacionalDashboardService {
  /**
   * @param {Object} [deps]
   */
  constructor(deps = {}) {
    const documentosRepository = deps.documentosRepository
      ?? new (require('../repositories/CentralDocumentosRepository'))();
    const nsuRepository = deps.nsuRepository
      ?? new (require('../repositories/CentralNsuRepository'))();

    /** @private */
    this._documentosRepository = documentosRepository;
    /** @private */
    this._nsuRepository = nsuRepository;
    /** @private */
    this._alertasService = deps.alertasService
      ?? new CentralAlertasService({ documentosRepository, nsuRepository });
  }

  /**
   * @returns {Promise<Object>}
   */
  async obterIndicadores() {
    const [
      metricas,
      contadoresPorStatus,
      alertas,
      ultimoNsu
    ] = await Promise.all([
      this._documentosRepository.obterMetricasOperacionais(),
      this._documentosRepository.contarPorStatus({}),
      this._alertasService.listarAlertas(),
      this._nsuRepository.obterUltimaSincronizacao()
    ]);

    const pendenciasCriticas = (alertas.alertas || []).filter(
      (a) => a.gravidade === 'critica' || a.gravidade === 'alta'
    ).reduce((acc, a) => acc + (a.quantidade || 0), 0);

    return {
      valorTotalMes: metricas.valorTotalMes,
      tempoMedioProcessamentoMinutos: metricas.tempoMedioProcessamentoMinutos,
      taxaIdentificacaoAutomatica: metricas.taxaIdentificacaoAutomatica,
      taxaRevisaoManual: metricas.taxaRevisaoManual,
      comprasConcluidasHoje: metricas.comprasConcluidasHoje,
      pendenciasCriticas,
      filas: {
        novas: contadoresPorStatus[DocumentoFiscalStatus.SINCRONIZADA] || 0,
        aguardandoXml: (contadoresPorStatus[DocumentoFiscalStatus.AGUARDANDO_XML] || 0)
          + (contadoresPorStatus[DocumentoFiscalStatus.XML_RECUPERANDO] || 0),
        emProcessamento: contadoresPorStatus[DocumentoFiscalStatus.EM_PROCESSAMENTO] || 0,
        aguardandoRevisao: contadoresPorStatus[DocumentoFiscalStatus.AGUARDANDO_REVISAO] || 0,
        prontasParaCompra: contadoresPorStatus[DocumentoFiscalStatus.PRONTA_PARA_COMPRA] || 0,
        emCompra: contadoresPorStatus[DocumentoFiscalStatus.EM_COMPRA] || 0,
        gravadas: contadoresPorStatus[DocumentoFiscalStatus.GRAVADA] || 0,
        erros: contadoresPorStatus[DocumentoFiscalStatus.ERRO] || 0
      },
      ultimaSincronizacao: ultimoNsu?.dataSincronizacao || ultimoNsu?.updatedAt || null,
      ultimoNsu: ultimoNsu?.ultNsu || null,
      alertasResumo: {
        total: alertas.total,
        tipos: (alertas.alertas || []).length
      }
    };
  }
}

module.exports = CentralOperacionalDashboardService;
