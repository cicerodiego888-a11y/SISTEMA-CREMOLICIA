/**
 * RFC-02 — Homologação oficial do Recovery Framework
 *
 * Valida cenários reais sem alterar o produto.
 * Cada bloco documenta PASS / FAIL / PARCIAL como evidência.
 */

const {
  RecoveryManager,
  RecoveryRegistry,
  RecoveryStatus,
  RecoveryStorage,
  RecoveryEvents
} = require('../../../../shared/recovery');
const {
  ensureRegistered,
  MODULE_ID,
  Operations,
  savePrepararEntrega,
  saveEntrega,
  resumePrepararEntrega,
  resumeEntrega,
  completeOperacoesEntrega,
  listPendingMotorComercial,
  obterItensRecovery
} = require('../../recovery');
const { loadConsignacaoOperacao } = require('../../recovery/loaders');
const { carregarConsignacaoCompleta } = require('../../utils/operacional');
const {
  salvarLiberacaoSessao,
  carregarLiberacaoSessao
} = require('../../utils/autorizacaoGerencial');

function installMemoryStorage() {
  const memory = new Map();
  const api = {
    getItem: (k) => (memory.has(k) ? memory.get(k) : null),
    setItem: (k, v) => { memory.set(k, String(v)); },
    removeItem: (k) => { memory.delete(k); },
    clear: () => memory.clear()
  };
  global.localStorage = api;
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

/** Simula fechar ERP: sessionStorage some; localStorage permanece. */
function simularFecharErp() {
  if (typeof sessionStorage !== 'undefined' && sessionStorage.clear) {
    sessionStorage.clear();
  }
}

function apiOk(consignacao, overrides = {}) {
  return {
    obterConsignacao: jest.fn(async () => ({ ...consignacao })),
    obterPerfil: jest.fn(async () => ({
      perfilTipo: 'CONSIGNADO',
      ativo: true,
      bloqueado: false,
      limiteComercial: 5000
    })),
    ...overrides
  };
}

function projectionOk(overrides = {}) {
  return {
    obterResumoPrestacao: jest.fn(async () => ({ itens: [], saldoAtual: 0, limiteDisponivel: 5000 })),
    obterSituacaoCliente: jest.fn(async () => ({
      clienteNome: 'Cliente Homolog',
      limiteDisponivel: 5000,
      saldoEmAberto: 0
    })),
    ...overrides
  };
}

describe('RFC-02 Homologação Recovery Framework', () => {
  let memory;

  beforeEach(() => {
    memory = installMemoryStorage();
    RecoveryRegistry.reset();
    RecoveryEvents.clearAuditLog();
    RecoveryStorage.clearAll();
    ensureRegistered();
  });

  describe('C1 — Preparar Entrega (salvar → fechar ERP → reabrir)', () => {
    test('PASS: checkpoint + itens sobrevivem ao fechar ERP e retomam', async () => {
      const pageLike = {
        consignacaoId: 101,
        currentStep: 1,
        concluido: false,
        data: {
          clienteId: 9,
          perfilComercialId: 3,
          documentoExterno: '',
          observacoes: 'teste',
          data: '2026-07-12',
          dataPrevista: '',
          empresa: '1',
          filial: '1',
          itens: [
            { produtoId: 55, produto: 'Picolé', quantidade: 10, preco: 2.5, persistido: true }
          ]
        }
      };

      savePrepararEntrega(pageLike, RecoveryStatus.EM_ANDAMENTO);
      simularFecharErp();

      expect(sessionStorage.getItem('motor-comercial:itens:101')).toBeNull();
      expect(carregarLiberacaoSessao(101)).toBeNull();

      const pending = listPendingMotorComercial();
      expect(pending.some((p) => p.operation === Operations.PREPARAR_ENTREGA && String(p.entityId) === '101')).toBe(true);

      const helpers = {
        api: apiOk({ id: 101, status: 'RASCUNHO', clienteId: 9, perfilComercialId: 3, documento: 'CONS-1', itens: [] }),
        projectionApi: projectionOk()
      };
      const loaded = await resumePrepararEntrega(101, helpers);
      expect(loaded.exists).toBe(true);
      expect(loaded.state.entity.itens).toHaveLength(1);
      expect(loaded.state.entity.itens[0].produtoId).toBe(55);
      expect(loaded.state.checkpoint.step).toBe(1);
    });

    test('PASS RFC-03: autosave cria checkpoint sem persist backend', () => {
      const { autosavePrepararEntrega } = require('../../recovery');
      const page = {
        consignacaoId: null,
        currentStep: 1,
        data: { itens: [{ produtoId: 1, quantidade: 1, preco: 1 }] }
      };
      autosavePrepararEntrega(page);
      expect(listPendingMotorComercial().length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('C2 — Entrega (aguardando confirmação/impressão)', () => {
    test('PASS: itens, valores e documento reconstruídos após fechar ERP', async () => {
      const itens = [
        { produtoId: 1, produto: 'A', quantidade: 2, preco: 10, persistido: true },
        { produtoId: 2, produto: 'B', quantidade: 1, preco: 5, persistido: true }
      ];
      saveEntrega(202, {
        itens,
        clienteId: 9,
        statusConsignacao: 'RASCUNHO'
      }, RecoveryStatus.AGUARDANDO_CONFIRMACAO);

      simularFecharErp();

      const api = apiOk({
        id: 202,
        status: 'RASCUNHO',
        clienteId: 9,
        perfilComercialId: 3,
        documento: 'CONS-202',
        itens: []
      });
      const projectionApi = projectionOk();
      await resumeEntrega(202, { api, projectionApi });
      const view = await carregarConsignacaoCompleta(api, projectionApi, 202);

      expect(view.documento).toBeTruthy();
      expect(view.itens).toHaveLength(2);
      const total = view.itens.reduce((s, i) => s + Number(i.quantidade) * Number(i.preco || i.precoUnitario || 0), 0);
      expect(total).toBe(25);
    });

    test('PARCIAL: status AGUARDANDO_IMPRESSAO não é gravado pelo fluxo atual', () => {
      saveEntrega(203, { itens: [] }, RecoveryStatus.AGUARDANDO_CONFIRMACAO);
      const ctx = RecoveryManager.get({
        module: MODULE_ID,
        operation: Operations.ENTREGA,
        entityId: 203
      });
      expect(ctx.status).toBe(RecoveryStatus.AGUARDANDO_CONFIRMACAO);
      expect(ctx.status).not.toBe(RecoveryStatus.AGUARDANDO_IMPRESSAO);
    });
  });

  describe('C3 — Após impressão', () => {
    test('PASS: permanece pendente (AGUARDANDO_CONFIRMACAO) e listável', () => {
      saveEntrega(301, { itens: [{ produtoId: 1, quantidade: 1, preco: 1 }], impresso: true }, RecoveryStatus.AGUARDANDO_CONFIRMACAO);
      simularFecharErp();
      const pending = listPendingMotorComercial().filter((p) => p.operation === Operations.ENTREGA);
      expect(pending).toHaveLength(1);
      expect(pending[0].status).toBe(RecoveryStatus.AGUARDANDO_CONFIRMACAO);
    });
  });

  describe('C4 — Autorização gerencial', () => {
    test('PASS RFC-03: liberação no Recovery sobrevive ao fechar ERP', () => {
      const { saveAuthorization, loadAuthorization } = require('../../recovery');
      saveAuthorization('ENTREGA', 401, {
        autorizado: true,
        consignacaoId: 401,
        fingerprint: 'fp-1',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        supervisorToken: 'tok'
      });

      simularFecharErp();
      expect(carregarLiberacaoSessao(401)).toBeNull();
      expect(loadAuthorization('ENTREGA', 401)).toBeTruthy();
    });
  });

  describe('C5 — Fluxo negativo (consignação removida)', () => {
    test('mensagem operacional; checkpoint permanece', async () => {
      savePrepararEntrega({
        consignacaoId: 501,
        currentStep: 1,
        data: { itens: [{ produtoId: 1, quantidade: 1, preco: 1 }], clienteId: 1 }
      });

      const api = {
        obterConsignacao: jest.fn(async () => {
          throw new Error('Consignação não encontrada');
        })
      };

      const loaded = await resumePrepararEntrega(501, { api, projectionApi: projectionOk() });
      expect(loaded.exists).toBe(true);
      expect(loaded.error.operationalMessage).toMatch(/removida|não está mais disponível/i);
      expect(listPendingMotorComercial().some((p) => String(p.entityId) === '501')).toBe(true);

      const src = require('fs').readFileSync(
        require('path').join(__dirname, '../../pages/NovaConsignacao/index.js'),
        'utf8'
      );
      expect(src.includes('operationalMessage')).toBe(true);
    });
  });

  describe('C6 — Checkpoint corrompido', () => {
    test('PASS: checkpoint.itens inválido é ignorado; API reconstrói', async () => {
      RecoveryManager.open({
        module: MODULE_ID,
        operation: Operations.ENTREGA,
        entityId: 601
      }).save({ itens: 'CORRUPTO' }, RecoveryStatus.EM_ANDAMENTO);

      const result = await loadConsignacaoOperacao(
        RecoveryManager.get({ module: MODULE_ID, operation: Operations.ENTREGA, entityId: 601 }),
        {
          api: apiOk({
            id: 601,
            status: 'RASCUNHO',
            clienteId: 1,
            perfilComercialId: 1,
            itens: [{ produtoId: 77, quantidade: 3, precoUnitario: 1 }]
          }),
          projectionApi: projectionOk()
        }
      );

      expect(result.fromCheckpoint).toBe(false);
      expect(result.entity.itens[0].produtoId).toBe(77);
    });

    test('PASS: store JSON inválido não quebra (retorna vazio)', () => {
      localStorage.setItem(RecoveryStorage.STORAGE_KEY, '{broken');
      expect(() => RecoveryStorage.listAll()).not.toThrow();
      expect(RecoveryStorage.listAll()).toEqual([]);
    });
  });

  describe('C7 — API indisponível', () => {
    test('PASS: checkpoint NÃO é apagado; mensagem operacional', async () => {
      saveEntrega(701, { itens: [{ produtoId: 1, quantidade: 2, preco: 3 }] }, RecoveryStatus.AGUARDANDO_CONFIRMACAO);
      const before = RecoveryStorage.listAll().length;

      const api = {
        obterConsignacao: jest.fn(async () => {
          throw new Error('Network Error');
        })
      };

      const loaded = await resumeEntrega(701, { api, projectionApi: projectionOk() });
      expect(loaded.error.operationalMessage).toMatch(/conexão|recuperar/i);
      expect(RecoveryStorage.listAll()).toHaveLength(before);
      expect(listPendingMotorComercial().some((p) => String(p.entityId) === '701')).toBe(true);
    });
  });

  describe('C8 — Interrupções / complete', () => {
    test('PASS: após complete, deixa de ser pendente', () => {
      saveEntrega(801, { itens: [] }, RecoveryStatus.AGUARDANDO_CONFIRMACAO);
      completeOperacoesEntrega(801);
      expect(listPendingMotorComercial().filter((p) => String(p.entityId) === '801')).toHaveLength(0);
    });

    test('FAIL documentado: FECHAR_ATENDIMENTO registrado sem loader/integração de tela', () => {
      expect(RecoveryRegistry.hasOperation(MODULE_ID, Operations.FECHAR_ATENDIMENTO)).toBe(true);
      expect(RecoveryRegistry.getLoader(MODULE_ID, Operations.FECHAR_ATENDIMENTO)).toBeNull();
    });
  });

  describe('C9 — Auditoria arquitetural', () => {
    test('reconstrução não depende exclusivamente de sessionStorage', async () => {
      saveEntrega(901, { itens: [{ produtoId: 9, quantidade: 1, preco: 9 }] });
      simularFecharErp();
      global.sessionStorage = undefined;

      const view = await carregarConsignacaoCompleta(
        apiOk({ id: 901, status: 'RASCUNHO', clienteId: 1, perfilComercialId: 1, documento: 'D', itens: [] }),
        projectionOk(),
        901
      );
      expect(view.itens).toHaveLength(1);
    });

    test('API sem itens ainda exige checkpoint complementar (gap de contrato REST)', async () => {
      const api = apiOk({ id: 902, status: 'RASCUNHO', clienteId: 1, perfilComercialId: 1, itens: [] });
      const projectionApi = projectionOk({ obterResumoPrestacao: async () => ({ itens: [] }) });
      // sem checkpoint
      const view = await carregarConsignacaoCompleta(api, projectionApi, 902);
      expect(view.itens).toHaveLength(0);
    });
  });

  describe('C10 — Performance / duplicidade', () => {
    test('PARCIAL: resume + carregarConsignacaoCompleta podem duplicar obterConsignacao', async () => {
      saveEntrega(1001, { itens: [{ produtoId: 1, quantidade: 1, preco: 1 }] });
      const api = apiOk({
        id: 1001,
        status: 'RASCUNHO',
        clienteId: 1,
        perfilComercialId: 1,
        documento: 'X',
        itens: []
      });
      const projectionApi = projectionOk();
      const t0 = Date.now();
      await resumeEntrega(1001, { api, projectionApi });
      await carregarConsignacaoCompleta(api, projectionApi, 1001);
      const ms = Date.now() - t0;

      expect(api.obterConsignacao.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(ms).toBeLessThan(2000);
    });
  });
});
