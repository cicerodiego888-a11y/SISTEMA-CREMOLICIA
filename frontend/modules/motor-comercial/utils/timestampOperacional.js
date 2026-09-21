/**
 * RCM-8.13.3 — Resolução de timestamp operacional (exibição).
 *
 * Prioriza instante operacional com timezone explícito sobre created_at naive.
 *
 * @module frontend/modules/motor-comercial/utils/timestampOperacional
 */

/**
 * @param {string|null|undefined} raw
 * @returns {string|null}
 */
function normalizarTimestampLegado(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/[zZ]$/.test(s) || /[+-]\d{2}:?\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s)) {
    const withT = s.includes('T') ? s : s.replace(' ', 'T');
    return /[zZ]$|[+-]\d{2}:?\d{2}$/.test(withT) ? withT : `${withT}Z`;
  }
  return s;
}

/**
 * @param {Object|null|undefined} mov
 * @returns {string|null}
 */
function resolverTimestampOperacional(mov) {
  if (!mov) return null;
  const operacional = mov.dataMovimentacao
    || mov.snapshot?.capturadoEm
    || mov.data
    || null;
  if (operacional != null && String(operacional).trim() !== '') {
    return String(operacional).trim();
  }
  return normalizarTimestampLegado(mov.createdAt || mov.dataHora);
}

module.exports = {
  normalizarTimestampLegado,
  resolverTimestampOperacional
};
