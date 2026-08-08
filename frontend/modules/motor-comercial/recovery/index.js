/**
 * Motor Comercial — Recovery helpers (RFC-03 Enterprise)
 *
 * @module frontend/modules/motor-comercial/recovery
 */

const {
  RecoveryManager,
  RecoveryStatus
} = require('../../../shared/recovery');
const {
  RecoveryMessages,
  operationalMessage: resolveCatalogMessage
} = require('../messages');
const { MODULE_ID, Operations } = require('./operations');
const { registerMotorComercialRecovery, ensureRegistered } = require('./register');

function params(operation, entityId) {
  return {
    module: MODULE_ID,
    operation,
    entityId
  };
}

function resolveEntityId(pageLike) {
  if (pageLike.consignacaoId != null) return pageLike.consignacaoId;
  if (!pageLike._recoveryDraftId) {
    pageLike._recoveryDraftId = RecoveryManager.createDraftEntityId();
  }
  return pageLike._recoveryDraftId;
}

function obterItensRecovery(entityId) {
  if (entityId == null) return [];
  ensureRegistered();
  for (const operation of [Operations.PREPARAR_ENTREGA, Operations.ENTREGA]) {
    const ctx = RecoveryManager.get(params(operation, entityId));
    if (ctx?.checkpoint?.itens?.length) {
      return ctx.checkpoint.itens.slice();
    }
  }
  // drafts pendentes
  const pending = RecoveryManager.listPending({ module: MODULE_ID });
  for (const row of pending) {
    if (row.operation === Operations.PREPARAR_ENTREGA && row.checkpoint?.itens?.length) {
      if (String(row.entityId) === String(entityId)) return row.checkpoint.itens.slice();
    }
  }
  return [];
}

function buildPrepararCheckpoint(pageLike) {
  const data = pageLike.data || {};
  return {
    step: pageLike.currentStep,
    concluido: Boolean(pageLike.concluido),
    clienteId: data.clienteId,
    perfilComercialId: data.perfilComercialId,
    documentoExterno: data.documentoExterno || '',
    observacoes: data.observacoes || '',
    data: data.data,
    dataPrevista: data.dataPrevista || '',
    empresa: data.empresa,
    filial: data.filial,
    documentoNumero: data.documentoNumero || null,
    itens: Array.isArray(data.itens) ? data.itens.map((item) => ({ ...item })) : [],
    clienteNome: data.cliente?.nome || pageLike.clienteProfile?.nome || null
  };
}

function savePrepararEntrega(pageLike, status = RecoveryStatus.EM_ANDAMENTO) {
  ensureRegistered();
  const entityId = resolveEntityId(pageLike);
  return RecoveryManager.open(params(Operations.PREPARAR_ENTREGA, entityId))
    .save(buildPrepararCheckpoint(pageLike), status);
}

/**
 * Autosave transparente — não depende do botão Salvar.
 */
function autosavePrepararEntrega(pageLike, status = RecoveryStatus.EM_ANDAMENTO) {
  ensureRegistered();
  const entityId = resolveEntityId(pageLike);
  return RecoveryManager.autosave(
    params(Operations.PREPARAR_ENTREGA, entityId),
    buildPrepararCheckpoint(pageLike),
    status
  );
}

function rebindPrepararEntrega(pageLike, consignacaoId) {
  ensureRegistered();
  if (!pageLike._recoveryDraftId || consignacaoId == null) return null;
  const handle = RecoveryManager.rebind(
    params(Operations.PREPARAR_ENTREGA, pageLike._recoveryDraftId),
    consignacaoId
  );
  pageLike._recoveryDraftId = null;
  pageLike.consignacaoId = consignacaoId;
  return handle;
}

function saveEntrega(entityId, checkpoint = {}, status = RecoveryStatus.AGUARDANDO_CONFIRMACAO) {
  ensureRegistered();
  if (entityId == null) return null;

  // Nunca sobrescrever itens válidos do checkpoint com lista vazia (load parcial / API sem itens)
  const existing = RecoveryManager.get(params(Operations.ENTREGA, entityId))
    || RecoveryManager.get(params(Operations.PREPARAR_ENTREGA, entityId));
  const incomingItens = checkpoint.itens;
  const hasIncoming = Array.isArray(incomingItens) && incomingItens.length > 0;
  const previousItens = existing?.checkpoint?.itens;
  const mergedCheckpoint = {
    ...(existing?.checkpoint || {}),
    ...checkpoint,
    itens: hasIncoming
      ? incomingItens
      : (Array.isArray(previousItens) && previousItens.length ? previousItens : (incomingItens || []))
  };

  return RecoveryManager.open(params(Operations.ENTREGA, entityId))
    .save(mergedCheckpoint, status);
}

function saveAuthorization(operation, entityId, liberacao) {
  ensureRegistered();
  if (entityId == null || !liberacao) return null;
  return RecoveryManager.setAuthorization(params(operation, entityId), {
    authorized: true,
    autorizado: true,
    authorizedBy: liberacao.authorizedBy || liberacao.supervisorUsername || liberacao.username,
    authorizedAt: liberacao.authorizedAt || new Date().toISOString(),
    reason: liberacao.motivo || liberacao.reason,
    expiresOnComplete: true,
    expiresAt: liberacao.expiresAt,
    fingerprint: liberacao.fingerprint,
    supervisorToken: liberacao.supervisorToken,
    consignacaoId: liberacao.consignacaoId != null ? liberacao.consignacaoId : entityId
  });
}

function loadAuthorization(operation, entityId) {
  ensureRegistered();
  if (entityId == null) return null;
  return RecoveryManager.getAuthorization(params(operation, entityId));
}

async function resumePrepararEntrega(entityId, helpers) {
  ensureRegistered();
  return RecoveryManager.resume(params(Operations.PREPARAR_ENTREGA, entityId), helpers);
}

async function resumeEntrega(entityId, helpers) {
  ensureRegistered();
  let loaded = await RecoveryManager.resume(params(Operations.ENTREGA, entityId), helpers);
  if (loaded.exists) return loaded;
  loaded = await RecoveryManager.resume(params(Operations.PREPARAR_ENTREGA, entityId), helpers);
  return loaded;
}

function completeOperacoesEntrega(entityId) {
  ensureRegistered();
  RecoveryManager.complete(params(Operations.PREPARAR_ENTREGA, entityId));
  RecoveryManager.complete(params(Operations.ENTREGA, entityId));
}

function cancelPrepararEntrega(entityId) {
  ensureRegistered();
  if (entityId == null) return null;
  return RecoveryManager.cancel(params(Operations.PREPARAR_ENTREGA, entityId));
}

function listPendingMotorComercial() {
  ensureRegistered();
  return RecoveryManager.listPending({ module: MODULE_ID });
}

function operationalMessage(error, options) {
  return resolveCatalogMessage(error, options);
}

module.exports = {
  MODULE_ID,
  Operations,
  RecoveryManager,
  RecoveryStatus,
  RecoveryMessages,
  registerMotorComercialRecovery,
  ensureRegistered,
  resolveEntityId,
  obterItensRecovery,
  buildPrepararCheckpoint,
  savePrepararEntrega,
  autosavePrepararEntrega,
  rebindPrepararEntrega,
  saveEntrega,
  saveAuthorization,
  loadAuthorization,
  resumePrepararEntrega,
  resumeEntrega,
  completeOperacoesEntrega,
  cancelPrepararEntrega,
  listPendingMotorComercial,
  operationalMessage
};
