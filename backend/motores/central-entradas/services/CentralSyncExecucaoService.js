/**
 * CentralSyncExecucaoService — Execução de sincronização com mutex e telemetria.
 *
 * Sprint 8: reutiliza CentralSincronizacaoService sem alterar o pipeline DF-e.
 *
 * @class CentralSyncExecucaoService
 */

const CentralSincronizacaoService = require('./CentralSincronizacaoService');
const CentralConfigService = require('./CentralConfigService');
const CentralEventosService = require('./CentralEventosService');
const CentralNotificacoesService = require('./CentralNotificacoesService');
const { TIPOS_EVENTO, ORIGENS } = require('../config/centralEventosTipos');
const { sincronizarDistribuicaoDFe } = require('../../../services/fiscal/distribuicaoDFe');
const SincronizacaoResultadoDTO = require('../contracts/SincronizacaoResultadoDTO');

class CentralSyncExecucaoService {
  constructor(deps = {}) {
    /** @private */
    this._sincronizacao = deps.sincronizacaoService ?? new CentralSincronizacaoService();
    /** @private */
    this._config = deps.configService ?? new CentralConfigService();
    /** @private */
    this._eventos = deps.eventosService ?? new CentralEventosService();
    /** @private */
    this._notificacoes = deps.notificacoesService ?? new CentralNotificacoesService();
    /** @private */
    this._executando = false;
    /** @private */
    this._ultimaExecucao = null;
    /** @private */
    this._proximaExecucao = null;
    /** @private */
    this._ultimoResultado = null;
  }

  /**
   * @returns {boolean}
   */
  estaExecutando() {
    return this._executando;
  }

  /**
   * @param {Date|null} data
   */
  definirProximaExecucao(data) {
    this._proximaExecucao = data;
  }

  /**
   * @returns {Object}
   */
  obterEstado() {
    return {
      executando: this._executando,
      ultimaExecucao: this._ultimaExecucao,
      proximaExecucao: this._proximaExecucao,
      ultimoResultado: this._ultimoResultado
    };
  }

  /**
   * @param {Object} [opcoes]
   * @returns {Promise<Object>}
   */
  async executar(opcoes = {}) {
    const origem = opcoes.origem || ORIGENS.MANUAL;
    const ignorarHorario = Boolean(opcoes.ignorarHorario);
    const forcar = Boolean(opcoes.forcar);

    if (this._executando && !forcar) {
      return {
        sucesso: false,
        ignorado: true,
        mensagem: 'Sincronização já em andamento',
        erros: ['Sincronização já em andamento']
      };
    }

    if (!ignorarHorario && origem === ORIGENS.BACKGROUND) {
      const horario = await this._config.verificarHorarioPermitido();
      if (!horario.permitido) {
        return {
          sucesso: false,
          ignorado: true,
          mensagem: horario.motivo,
          erros: [horario.motivo]
        };
      }
    }

    this._executando = true;
    const inicio = Date.now();
    this._ultimaExecucao = new Date().toISOString();

    await this._eventos.registrar({
      tipo: TIPOS_EVENTO.SYNC_INICIADA,
      origem,
      descricao: 'Sincronização SEFAZ iniciada',
      resultado: 'em_andamento',
      sucesso: null
    });

    try {
      const cfg = await this._config.obterResumo();
      const maxIteracoes = Math.max(1, Math.min(200, cfg.syncMaxDocumentos || 50));

      let resultado;
      if (maxIteracoes < 50) {
        const bruto = await sincronizarDistribuicaoDFe({ maxIteracoes, origem });
        resultado = SincronizacaoResultadoDTO.create({
          sucesso: true,
          notasNovas: bruto.notasNovas,
          notasDuplicadas: bruto.notasDuplicadas,
          ignorados: bruto.ignorados,
          ultNsu: bruto.ultNsu,
          maxNsu: bruto.maxNsu,
          iteracoes: bruto.iteracoes,
          cStat: bruto.cStat,
          xMotivo: bruto.xMotivo,
          mensagem: bruto.mensagem,
          ultimaSincronizacao: bruto.ultimaSincronizacao,
          proximaConsultaApos: bruto.proximaConsultaApos,
          erros: []
        }).toJSON();
      } else {
        resultado = await this._sincronizacao.sincronizar({ origem });
      }

      const duracaoMs = Date.now() - inicio;
      this._ultimoResultado = resultado;

      await this._eventos.registrar({
        tipo: resultado.sucesso ? TIPOS_EVENTO.SYNC_CONCLUIDA : TIPOS_EVENTO.SYNC_ERRO,
        origem,
        descricao: resultado.mensagem || (resultado.sucesso ? 'Sincronização concluída' : 'Falha na sincronização'),
        resultado: resultado.sucesso ? 'sucesso' : 'erro',
        sucesso: resultado.sucesso,
        notasNovas: resultado.notasNovas || 0,
        notasDuplicadas: resultado.notasDuplicadas || 0,
        duracaoMs,
        detalhe: resultado
      });

      const cfgNotif = await this._config.obterResumo();
      await this._notificacoes.notificarSyncConcluida({
        notasNovas: resultado.notasNovas || 0,
        sucesso: resultado.sucesso,
        mensagem: resultado.mensagem,
        origem,
        notificarNovas: cfgNotif.notificarNovasNotas
      });

      return { ...resultado, duracaoMs, origem };
    } catch (error) {
      const duracaoMs = Date.now() - inicio;
      const falha = SincronizacaoResultadoDTO.fromError(error);

      this._ultimoResultado = falha;

      await this._eventos.registrar({
        tipo: TIPOS_EVENTO.SYNC_ERRO,
        origem,
        descricao: falha.mensagem,
        resultado: 'erro',
        sucesso: false,
        duracaoMs,
        detalhe: falha
      });

      await this._notificacoes.notificarSyncConcluida({
        sucesso: false,
        mensagem: falha.mensagem,
        origem
      });

      return { ...falha, duracaoMs, origem };
    } finally {
      this._executando = false;
    }
  }
}

module.exports = new CentralSyncExecucaoService();
module.exports.CentralSyncExecucaoService = CentralSyncExecucaoService;
