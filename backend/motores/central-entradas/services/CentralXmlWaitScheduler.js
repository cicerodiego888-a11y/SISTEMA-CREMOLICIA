/**
 * CentralXmlWaitScheduler — Espera controlada de XML de documentos DF-e.
 *
 * Não cria loop agressivo. Respeita o Gate SEFAZ e o mutex de sync.
 *
 * @class CentralXmlWaitScheduler
 */

const centralEntradasFlags = require('../config/centralEntradasFlags');
const CentralConfigService = require('./CentralConfigService');
const CentralDocumentosRepository = require('../repositories/CentralDocumentosRepository');
const CentralEntradasOrchestrator = require('../CentralEntradasOrchestrator');
const CentralProcessamentoService = require('./CentralProcessamentoService');
const CentralSincronizacaoService = require('./CentralSincronizacaoService');
const CentralHistoricoService = require('./CentralHistoricoService');
const CentralComprasBridgeService = require('./CentralComprasBridgeService');
const sefazGate = require('./CentralSefazOperationalGate');
const { DocumentoFiscalStatus } = require('../core/DocumentoFiscalStatus');
const { ORIGENS } = require('../config/centralEventosTipos');

class CentralXmlWaitScheduler {
  constructor(deps = {}) {
    this._config = deps.configService ?? new CentralConfigService();
    this._flags = deps.flags ?? centralEntradasFlags;
    this._documentosRepository = deps.documentosRepository ?? new CentralDocumentosRepository();
    this._gate = deps.sefazGate ?? sefazGate;
    this._orchestrator = deps.orchestrator ?? null;
    this._timeoutId = null;
    this._ativo = false;
    this._ultimoCiclo = null;
  }

  /** @private */
  _obterOrchestrator() {
    if (!this._orchestrator) {
      const historicoService = new CentralHistoricoService();
      this._orchestrator = new CentralEntradasOrchestrator({
        documentosRepository: this._documentosRepository,
        historicoService,
        processamentoService: new CentralProcessamentoService({
          documentosRepository: this._documentosRepository,
          historicoService
        }),
        sincronizacaoService: new CentralSincronizacaoService({
          documentosRepository: this._documentosRepository
        }),
        comprasBridgeService: new CentralComprasBridgeService({
          documentosRepository: this._documentosRepository
        })
      });
    }
    return this._orchestrator;
  }

  estaAtivo() {
    return this._ativo;
  }

  obterStatus() {
    return {
      servicoAtivo: this._ativo,
      ultimoCiclo: this._ultimoCiclo
    };
  }

  async iniciar() {
    this.parar();
    if (!this._flags.estaHabilitado()) {
      this._ativo = false;
      return;
    }
    this._ativo = true;
    this._agendarCiclo(30 * 1000);
  }

  parar() {
    if (this._timeoutId) {
      clearTimeout(this._timeoutId);
      this._timeoutId = null;
    }
    this._ativo = false;
  }

  async reiniciar() {
    this.parar();
    await this.iniciar();
  }

  /** @private */
  _agendarCiclo(delayMs) {
    if (this._timeoutId) clearTimeout(this._timeoutId);
    this._timeoutId = setTimeout(async () => {
      if (!this._ativo) return;
      await this.executarCiclo();
      if (!this._ativo) return;
      const cfg = await this._config.obterResumo();
      const minutos = Math.max(5, Number(cfg.xmlWaitIntervaloMinutos) || 15);
      this._agendarCiclo(minutos * 60 * 1000);
    }, delayMs);
  }

  /**
   * @returns {Promise<Object>}
   */
  async executarCiclo() {
    if (!this._gate.podeConsultar()) {
      this._ultimoCiclo = {
        em: new Date().toISOString(),
        ignorado: true,
        motivo: 'Gate SEFAZ indisponível'
      };
      return this._ultimoCiclo;
    }

    const cfg = await this._config.obterResumo();
    const limite = Math.max(1, Math.min(10, Number(cfg.xmlWaitMaxPorCiclo) || 5));
    const documentos = await this._documentosRepository.listar({
      statusIn: [
        DocumentoFiscalStatus.AGUARDANDO_XML,
        DocumentoFiscalStatus.ERRO_RECUPERACAO
      ],
      limite,
      ordenarPor: 'updated_at',
      ordenarDirecao: 'ASC'
    });

    const orchestrator = this._obterOrchestrator();
    const resultados = [];

    for (const documento of documentos) {
      if (!this._gate.podeConsultar()) break;
      // eslint-disable-next-line no-await-in-loop
      const resultado = await orchestrator.recuperarXml(documento.id, {
        origem: ORIGENS.BACKGROUND
      });
      resultados.push({ documentoId: documento.id, ...resultado });
    }

    this._ultimoCiclo = {
      em: new Date().toISOString(),
      ignorado: false,
      processados: resultados.length,
      recuperados: resultados.filter((r) => r.recuperado).length
    };

    return this._ultimoCiclo;
  }
}

module.exports = new CentralXmlWaitScheduler();
module.exports.CentralXmlWaitScheduler = CentralXmlWaitScheduler;
