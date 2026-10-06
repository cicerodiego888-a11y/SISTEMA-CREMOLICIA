/**
 * Utilitários de filtros rápidos da Central de Entradas (Sprint 7).
 *
 * @module motores/central-entradas/utils/filtrosRapidosCentral
 */

const { DocumentoFiscalStatus } = require('../core/DocumentoFiscalStatus');

const PRESETS = Object.freeze({
  hoje: { label: 'Hoje', sql: "date(created_at) = date('now', 'localtime')" },
  ontem: { label: 'Ontem', sql: "date(created_at) = date('now', 'localtime', '-1 day')" },
  ultimos_7_dias: { label: 'Últimos 7 dias', sql: "created_at >= datetime('now', 'localtime', '-7 days')" },
  ultimos_30_dias: { label: 'Últimos 30 dias', sql: "created_at >= datetime('now', 'localtime', '-30 days')" },
  este_mes: {
    label: 'Este mês',
    sql: "strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', 'localtime')"
  },
  pendentes: {
    label: 'Pendentes',
    statusIn: [
      DocumentoFiscalStatus.SINCRONIZADA,
      DocumentoFiscalStatus.AGUARDANDO_XML,
      DocumentoFiscalStatus.XML_RECUPERANDO,
      DocumentoFiscalStatus.ERRO_RECUPERACAO,
      DocumentoFiscalStatus.EM_PROCESSAMENTO,
      DocumentoFiscalStatus.AGUARDANDO_REVISAO,
      DocumentoFiscalStatus.EM_COMPRA
    ]
  },
  prontas: {
    label: 'Prontas',
    statusIn: [
      DocumentoFiscalStatus.PRONTA_PARA_COMPRA,
      DocumentoFiscalStatus.REVISADA
    ]
  },
  aguardando_xml: {
    label: 'Aguardando XML',
    statusIn: [
      DocumentoFiscalStatus.AGUARDANDO_XML,
      DocumentoFiscalStatus.XML_RECUPERANDO,
      DocumentoFiscalStatus.ERRO_RECUPERACAO
    ]
  }
});

/**
 * @param {string} preset
 * @returns {Object|null}
 */
function obterPreset(preset) {
  return PRESETS[preset] || null;
}

/**
 * @returns {Object[]}
 */
function listarPresets() {
  return Object.entries(PRESETS).map(([codigo, meta]) => ({
    codigo,
    label: meta.label
  }));
}

module.exports = {
  PRESETS,
  obterPreset,
  listarPresets
};
