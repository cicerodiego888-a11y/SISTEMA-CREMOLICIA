/**
 * MFE-04/05/05.1/06 — Adapters
 */

const { CashOrchestrator } = require('../orchestrators/CashOrchestrator');
const { ReceivableOrchestrator } = require('../orchestrators/ReceivableOrchestrator');
const { PdvArBridge } = require('../bridges/PdvArBridge');
const { ComercialArBridge } = require('../bridges/ComercialArBridge');
const { PurchasePayableBridge } = require('../bridges/PurchasePayableBridge');
const { obterMotor } = require('../bootstrap/MotorFinanceiroBootstrap');
const { FeatureFlag } = require('../domain/enums');

async function publicarEventoCaixaMfe(db, operacao) {
  try {
    const motor = obterMotor();
    if (!motor.featureFlags.isEnabled(FeatureFlag.FEATURE_MFE_CAIXA)) {
      return { skipped: true };
    }
    const orch = new CashOrchestrator(motor);
    return await orch.publicarOperacaoCaixa(db, operacao);
  } catch (err) {
    console.error('[MFE-04] Falha ao publicar evento de caixa (legado preservado):', err.message);
    return { ok: false, error: err.message };
  }
}

async function publicarEventoArMfe(db, operacao) {
  try {
    const motor = obterMotor();
    if (!motor.featureFlags.isEnabled(FeatureFlag.FEATURE_MFE_AR)) {
      return { skipped: true };
    }
    const orch = new ReceivableOrchestrator(motor);
    return await orch.publicarOperacaoAr(db, operacao);
  } catch (err) {
    console.error('[MFE-05] Falha ao publicar evento AR (legado preservado):', err.message);
    return { ok: false, error: err.message };
  }
}

async function publicarEventoPdvArMfe(db, operacao) {
  try {
    const motor = obterMotor();
    if (!motor.featureFlags.isEnabled(FeatureFlag.FEATURE_MFE_PDV_AR)) {
      return { skipped: true };
    }
    const bridge = new PdvArBridge(motor);
    return await bridge.publicar(db, operacao);
  } catch (err) {
    console.error('[MFE-05.1] Falha bridge PDV-AR (legado preservado):', err.message);
    return { ok: false, error: err.message };
  }
}

async function publicarEventoComercialArMfe(db, operacao) {
  try {
    const motor = obterMotor();
    if (!motor.featureFlags.isEnabled(FeatureFlag.FEATURE_MFE_COMERCIAL_AR)) {
      return { skipped: true };
    }
    const bridge = new ComercialArBridge(motor);
    return await bridge.publicar(db, operacao);
  } catch (err) {
    console.error('[MFE-05.1] Falha bridge Comercial-AR (legado preservado):', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * MFE-06 — Bridge Compras → AP (FEATURE_MFE_AP).
 */
async function publicarEventoCompraApMfe(db, operacao) {
  try {
    const motor = obterMotor();
    if (!motor.featureFlags.isEnabled(FeatureFlag.FEATURE_MFE_AP)) {
      return { skipped: true };
    }
    const bridge = new PurchasePayableBridge(motor);
    return await bridge.publicar(db, operacao);
  } catch (err) {
    console.error('[MFE-06] Falha bridge Compra-AP (legado preservado):', err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = {
  publicarEventoCaixaMfe,
  publicarEventoArMfe,
  publicarEventoPdvArMfe,
  publicarEventoComercialArMfe,
  publicarEventoCompraApMfe,
  CashOrchestrator,
  ReceivableOrchestrator,
  PdvArBridge,
  ComercialArBridge,
  PurchasePayableBridge
};
