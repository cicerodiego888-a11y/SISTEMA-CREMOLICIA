/**
 * MFE-01 — Feature flags (default OFF)
 */

const { FeatureFlag } = require('../domain/enums');

const DEFAULTS = Object.freeze({
  [FeatureFlag.FINANCEIRO_V2]: false,
  [FeatureFlag.FIN_LEDGER]: false,
  [FeatureFlag.FIN_EVENTS]: false,
  [FeatureFlag.FIN_PIX]: false,
  [FeatureFlag.FIN_TEF]: false,
  [FeatureFlag.FIN_CONCILIACAO]: false,
  [FeatureFlag.FEATURE_MFE_CAIXA]: false,
  [FeatureFlag.FEATURE_MFE_AR]: false,
  [FeatureFlag.FEATURE_MFE_PDV_AR]: false,
  [FeatureFlag.FEATURE_MFE_COMERCIAL_AR]: false,
  [FeatureFlag.FEATURE_MFE_AP]: false,
  [FeatureFlag.FEATURE_MFE_SETTLEMENT]: false
});

class FeatureFlagsService {
  constructor(overrides = {}) {
    this._flags = { ...DEFAULTS, ...overrides };
  }

  isEnabled(flag) {
    return Boolean(this._flags[flag]);
  }

  /** Somente para testes / bootstrap controlado — não liga em produção por default. */
  setFlag(flag, value) {
    if (!(flag in DEFAULTS)) {
      throw new Error(`Flag desconhecida: ${flag}`);
    }
    this._flags[flag] = Boolean(value);
  }

  snapshot() {
    return { ...this._flags };
  }

  assertEnabled(flag) {
    const { FeatureFlagDisabledError } = require('../domain/errors');
    if (!this.isEnabled(flag)) {
      throw new FeatureFlagDisabledError(flag);
    }
  }
}

module.exports = FeatureFlagsService;
