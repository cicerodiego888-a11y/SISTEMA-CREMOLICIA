/**
 * CentralNsuControleService — Controle de NSU, consultas e lacunas.
 *
 * Reutiliza CentralNsuRepository e NSUs já persistidos nos documentos.
 * Não cria tabela nova.
 *
 * @class CentralNsuControleService
 */

const CentralNsuRepository = require('../repositories/CentralNsuRepository');
const CentralDocumentosRepository = require('../repositories/CentralDocumentosRepository');
const { emitirEvento } = require('../utils/centralEventosEmitter');
const { TIPOS_EVENTO, ORIGENS } = require('../config/centralEventosTipos');
const { normalizarNsu, NSU_ZERADO } = require('../../../services/fiscal/dfeRetornoParser');

const LIMITE_VARREDURA_LACUNAS = 500;

/**
 * @param {Object} params
 * @returns {{ lacunas: string[], truncado: boolean, esperado: number, vistos: number }}
 */
function detectarLacunasNsu({ nsuAnterior, nsuAtual, nsusVistos = [] } = {}) {
  const inicio = BigInt(normalizarNsu(nsuAnterior)) + 1n;
  const fim = BigInt(normalizarNsu(nsuAtual));
  const vistos = new Set((nsusVistos || []).map((nsu) => normalizarNsu(nsu)));

  if (fim < inicio) {
    return { lacunas: [], truncado: false, esperado: 0, vistos: vistos.size };
  }

  const esperado = Number(fim - inicio + 1n);
  if (esperado > LIMITE_VARREDURA_LACUNAS) {
    return { lacunas: [], truncado: true, esperado, vistos: vistos.size };
  }

  const lacunas = [];
  for (let n = inicio; n <= fim; n += 1n) {
    const pad = n.toString().padStart(15, '0');
    if (!vistos.has(pad)) lacunas.push(pad);
  }

  return { lacunas, truncado: false, esperado, vistos: vistos.size };
}

class CentralNsuControleService {
  /**
   * @param {Object} [deps]
   */
  constructor(deps = {}) {
    this._nsuRepository = deps.nsuRepository ?? new CentralNsuRepository();
    this._documentosRepository = deps.documentosRepository ?? new CentralDocumentosRepository();
  }

  /**
   * @returns {Promise<Object>}
   */
  async obterEstado() {
    const controle = await this._nsuRepository.obterUltimaSincronizacao();
    const nsusDocumentos = await this._documentosRepository.listarNsusConhecidos();
    const nsuProcessado = nsusDocumentos.length
      ? nsusDocumentos.reduce((acc, nsu) => (nsu > acc ? nsu : acc), NSU_ZERADO)
      : NSU_ZERADO;

    return {
      ultNsu: controle?.ultNsu || NSU_ZERADO,
      maxNsu: controle?.maxNsu || NSU_ZERADO,
      nsuConsultado: controle?.ultNsu || NSU_ZERADO,
      nsuProcessado,
      documentosComNsu: nsusDocumentos.length,
      ultimaSincronizacao: controle?.dataSincronizacao || controle?.updatedAt || null,
      cnpj: controle?.cnpj || null,
      ambiente: controle?.ambiente ?? null
    };
  }

  /**
   * @param {Object} params
   * @returns {Promise<Object>}
   */
  async registrarConsultaEDetectarLacunas(params = {}) {
    const resultado = detectarLacunasNsu(params);

    if (resultado.lacunas.length) {
      await emitirEvento({
        tipo: TIPOS_EVENTO.NSU_LACUNA_DETECTADA,
        origem: params.origem || ORIGENS.SISTEMA,
        descricao: `${resultado.lacunas.length} lacuna(s) de NSU detectada(s)`,
        resultado: 'lacuna',
        sucesso: true,
        detalhe: {
          nsuAnterior: params.nsuAnterior,
          nsuAtual: params.nsuAtual,
          lacunas: resultado.lacunas.slice(0, 50),
          truncado: resultado.truncado
        }
      });
    }

    return resultado;
  }
}

module.exports = CentralNsuControleService;
module.exports.detectarLacunasNsu = detectarLacunasNsu;
