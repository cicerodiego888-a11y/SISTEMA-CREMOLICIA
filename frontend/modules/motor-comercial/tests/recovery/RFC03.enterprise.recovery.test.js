/**
 * RFC-03 — Recovery Framework Enterprise (estabilização)
 */

const {
  RecoveryManager,
  RecoveryRegistry,
  RecoveryStatus,
  RecoveryStorage,
  RecoveryEvents,
  RecoveryValidation,
  RecoveryMessages,
  RecoveryProvider
} = require('../../../../shared/recovery');
const {
  ensureRegistered,
  MODULE_ID,
  Operations,
  autosavePrepararEntrega,
  saveAuthorization,
  loadAuthorization,
  completeOperacoesEntrega,
  listPendingMotorComercial
} = require('../../recovery');

function installMemoryStorage() {
  const memory = new Map();
  global.localStorage = {
    getItem: (k) => (memory.has(k) ? memory.get(k) : null),
    setItem: (k, v) => { memory.set(k, String(v)); },
    removeItem: (k) => { memory.delete(k); },
    clear: () => memory.clear()
  };
  global.sessionStorage = {
    getItem: (k) => (memory.has(`ss:${k}`) ? memory.get(`ss:${k}`) : null),
    setItem: (k, v) => { memory.set(`ss:${k}`, String(v)); },
    removeItem: (k) => { memory.delete(`ss:${k}`); },
    clear: () => {
      [...memory.keys()].filter((k) => k.startsWith('ss:')).forEach((k) => memory.delete(k));
    }
  };
  return memory;
}

function simularFecharErp() {
  if (sessionStorage.clear) sessionStorage.clear();
}

describe('RFC-03 Recovery Enterprise', () => {
  beforeEach(() => {
    installMemoryStorage();
    RecoveryRegistry.reset();
    RecoveryProvider.reset();
    RecoveryEvents.clearAuditLog();
    RecoveryStorage.clearAll();
    ensureRegistered();
  });

  test('P0-01 autosave antes do Save — draft sobrevive ao fechar ERP', async () => {
    const page = {
      consignacaoId: null,
      _recoveryDraftId: null,
      currentStep: 1,
      concluido: false,
      data: {
        clienteId: 10,
        perfilComercialId: 2,
        itens: [{ produtoId: 5, produto: 'X', quantidade: 3, preco: 1.5 }]
      }
    };

    autosavePrepararEntrega(page, RecoveryStatus.EM_ANDAMENTO);
    expect(page._recoveryDraftId).toBeTruthy();
    expect(RecoveryManager.isDraftEntityId(page._recoveryDraftId)).toBe(true);

    simularFecharErp();

    const pending = listPendingMotorComercial();
    expect(pending.length).toBeGreaterThanOrEqual(1);
    const draft = pending.find((p) => RecoveryManager.isDraftEntityId(p.entityId));
    expect(draft.checkpoint.itens).toHaveLength(1);

    const loaded = await RecoveryManager.resume({
      module: MODULE_ID,
      operation: Operations.PREPARAR_ENTREGA,
      entityId: draft.entityId
    }, { api: null });

    expect(loaded.exists).toBe(true);
    expect(loaded.state.entity.itens[0].produtoId).toBe(5);
    expect(RecoveryEvents.getAuditLog().some((e) => e.type === 'RECOVERY_AUTOSAVE')).toBe(true);
  });

  test('P0-02 autorização no RecoveryContext sobrevive ao fechar ERP', () => {
    const entityId = 44;
    saveAuthorization(Operations.ENTREGA, entityId, {
      autorizado: true,
      authorizedBy: 'admin',
      motivo: 'liberação teste',
      fingerprint: 'fp-a',
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      supervisorToken: 'tok'
    });

    simularFecharErp();
    expect(sessionStorage.getItem('cds-mc-liberacao-limite:44')).toBeNull();

    const auth = loadAuthorization(Operations.ENTREGA, entityId);
    expect(auth).toBeTruthy();
    expect(auth.autorizado || auth.authorized).toBe(true);
    expect(auth.fingerprint).toBe('fp-a');

    completeOperacoesEntrega(entityId);
    expect(loadAuthorization(Operations.ENTREGA, entityId)).toBeNull();
  });

  test('P0-03 mensagens operacionais — sem texto técnico e sem genérica opaca', () => {
    const removed = RecoveryMessages.toOperationalMessage(new Error('Consignação não encontrada'));
    expect(removed).toMatch(/removida|não está mais disponível/i);
    expect(removed).toMatch(/Central/i);

    const network = RecoveryMessages.toOperationalMessage(new Error('Network Error'));
    expect(network).toMatch(/conexão/i);

    const typeError = RecoveryMessages.toOperationalMessage(new Error('TypeError: x is null'));
    expect(typeError).not.toMatch(/Não foi possível recuperar esta operação agora/i);
    expect(typeError).toMatch(/Central de Consignações|retomar/i);
  });

  test('API offline: checkpoint preservado + mensagem operacional', async () => {
    RecoveryManager.autosave({
      module: MODULE_ID,
      operation: Operations.ENTREGA,
      entityId: 70
    }, { itens: [{ produtoId: 1, quantidade: 1, preco: 2 }] });

    const before = RecoveryStorage.listAll().length;
    const loaded = await RecoveryManager.resume({
      module: MODULE_ID,
      operation: Operations.ENTREGA,
      entityId: 70
    }, {
      api: {
        obterConsignacao: async () => { throw new Error('Network Error'); }
      }
    });

    expect(loaded.exists).toBe(true);
    expect(loaded.error.operationalMessage).toMatch(/conexão/i);
    expect(RecoveryStorage.listAll()).toHaveLength(before);
  });

  test('checkpoint corrompido: discard + validate audit', () => {
    const key = RecoveryStorage.buildKey(MODULE_ID, Operations.ENTREGA, 88);
    RecoveryStorage.write(key, {
      module: MODULE_ID,
      operation: Operations.ENTREGA,
      entityId: 88,
      status: RecoveryStatus.EM_ANDAMENTO,
      checkpoint: { itens: [{ produtoId: 1 }] },
      version: 2,
      checksum: 'INVALID'
    });

    const ctx = RecoveryManager.get({
      module: MODULE_ID,
      operation: Operations.ENTREGA,
      entityId: 88
    });
    expect(ctx).toBeNull();
    expect(RecoveryEvents.getAuditLog().some((e) => e.type === 'RECOVERY_DISCARDED')).toBe(true);
    expect(RecoveryEvents.getAuditLog().some((e) => e.type === 'RECOVERY_VALIDATE')).toBe(true);
  });

  test('validation seal: checksum e versão', () => {
    const handle = RecoveryManager.open({
      module: 'nfe',
      operation: 'NFE',
      entityId: 'doc-1'
    });
    handle.autosave({ passo: 1 });
    const ctx = RecoveryManager.get({ module: 'nfe', operation: 'NFE', entityId: 'doc-1' });
    expect(ctx.checksum).toBeTruthy();
    expect(ctx.version).toBe(RecoveryValidation.SCHEMA_VERSION);
    expect(ctx.integrity).toBe(true);
    expect(RecoveryManager.validate({ module: 'nfe', operation: 'NFE', entityId: 'doc-1' }).valid).toBe(true);
  });

  test('ordem oficial RecoveryProvider.resolveItens', () => {
    const { itens, source } = RecoveryProvider.resolveItens({
      api: { itens: [] },
      provider: { itens: [{ produtoId: 2 }] },
      checkpoint: { itens: [{ produtoId: 3 }] },
      cache: { itens: [{ produtoId: 4 }] }
    });
    expect(itens[0].produtoId).toBe(2);
    expect(source).toBe('provider');

    const onlyCache = RecoveryProvider.resolveItens({
      api: { itens: [] },
      provider: { itens: [] },
      checkpoint: { itens: [] },
      cache: { itens: [{ produtoId: 9 }] }
    });
    expect(onlyCache.source).toBe('cache');
  });

  test('eventos enterprise presentes na auditoria', () => {
    const draft = RecoveryManager.createDraftEntityId();
    RecoveryManager.autosave({
      module: MODULE_ID,
      operation: Operations.PREPARAR_ENTREGA,
      entityId: draft
    }, { itens: [] });

    RecoveryManager.setAuthorization({
      module: MODULE_ID,
      operation: Operations.PREPARAR_ENTREGA,
      entityId: draft
    }, { authorized: true, authorizedBy: 'x', expiresOnComplete: true });

    const types = RecoveryEvents.getAuditLog().map((e) => e.type);
    expect(types).toContain('RECOVERY_AUTOSAVE');
  });

  test('cancel e complete limpam autorização', () => {
    RecoveryManager.open({
      module: MODULE_ID,
      operation: Operations.PREPARAR_ENTREGA,
      entityId: 9
    }).setAuthorization({
      authorized: true,
      authorizedBy: 'a',
      expiresOnComplete: true
    });

    RecoveryManager.cancel({
      module: MODULE_ID,
      operation: Operations.PREPARAR_ENTREGA,
      entityId: 9
    });
    expect(loadAuthorization(Operations.PREPARAR_ENTREGA, 9)).toBeNull();
  });
});
