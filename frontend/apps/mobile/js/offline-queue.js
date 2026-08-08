/**
 * CDS Mobile — fila offline local (localStorage).
 * Sem regras de negócio: apenas enfileira payloads das APIs oficiais.
 */
const STORAGE_KEY = 'cds-mobile-offline-queue-v1';

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch (_e) {
    return [];
  }
}

function writeAll(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list || []));
}

export function isOnline() {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
}

export function enqueueOffline(op) {
  const list = readAll();
  const item = {
    id: `op_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    status: 'PENDENTE_SINCRONIZACAO',
    ...op
  };
  list.push(item);
  writeAll(list);
  return item;
}

export function listOfflineQueue({ consignacaoId } = {}) {
  const list = readAll();
  if (consignacaoId == null) return list;
  return list.filter((x) => String(x.consignacaoId) === String(consignacaoId));
}

export function countPending(consignacaoId) {
  return listOfflineQueue({ consignacaoId }).length;
}

export function removeOffline(id) {
  writeAll(readAll().filter((x) => x.id !== id));
}

/**
 * Processa a fila com o executor informado (ex.: CDSApi).
 * @param {(op: object) => Promise<void>} executor
 */
export async function flushOfflineQueue(executor) {
  if (!isOnline()) return { synced: 0, failed: 0, remaining: countPending() };
  const list = readAll();
  let synced = 0;
  let failed = 0;
  const remaining = [];

  for (const op of list) {
    try {
      await executor(op);
      synced += 1;
    } catch (_err) {
      failed += 1;
      remaining.push(op);
    }
  }
  writeAll(remaining);
  return { synced, failed, remaining: remaining.length };
}

export async function flushComercialOfflineQueue() {
  return flushOfflineQueue(async (op) => {
    const method = String(op.method || 'POST').toLowerCase();
    const path = op.path;
    const body = op.body || {};
    if (!path || !window.CDSApi?.[method]) {
      throw new Error('Operação offline inválida');
    }
    await window.CDSApi[method](path, body);
  });
}

let _bound = false;
export function bindOfflineAutoSync({ onDone } = {}) {
  if (_bound || typeof window === 'undefined') return;
  _bound = true;
  const run = async () => {
    if (!isOnline()) return;
    const result = await flushComercialOfflineQueue();
    if (typeof onDone === 'function') onDone(result);
  };
  window.addEventListener('online', run);
  // tentativa inicial
  setTimeout(run, 800);
}

export default {
  isOnline,
  enqueueOffline,
  listOfflineQueue,
  countPending,
  removeOffline,
  flushOfflineQueue,
  flushComercialOfflineQueue,
  bindOfflineAutoSync
};
