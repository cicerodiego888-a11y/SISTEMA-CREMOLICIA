/**
 * RCM-8.6 — Estabilidade de contexto da Prestação de Contas
 *
 * Cobertura: contexto imutável, resposta atrasada, timers/polling,
 * desmontagem e apresentação "Sem Venda".
 *
 * Executar:
 *   npm run test:motor-comercial-frontend -- --testPathPatterns=rcm86-prestacao-contexto
 */

jest.mock('../../api/MotorComercialApi', () => jest.fn().mockImplementation(() => ({
  obterConsignacao: jest.fn(async () => null),
  obterRateioPerda: jest.fn(async () => null),
  obterResumoFinalPrestacao: jest.fn(async () => null),
  definirRateioPerda: jest.fn(async () => ({})),
  registrarPagamento: jest.fn(async () => ({})),
  listarConsignacoes: jest.fn(async () => ({ items: [] }))
})));

jest.mock('../../api/ProjectionApi', () => jest.fn().mockImplementation(() => ({
  obterResumoPrestacao: jest.fn(async () => null),
  listarMovimentacoes: jest.fn(async () => []),
  obterProjecaoContaCorrente: jest.fn(async () => null)
})));

jest.mock('../../utils/operacional', () => {
  const actual = jest.requireActual('../../utils/operacional');
  return {
    ...actual,
    carregarConsignacaoCompleta: jest.fn(),
    buscarClientePorIdErp: jest.fn(async () => null),
    withLoading: jest.fn((_msg, fn) => fn()),
    notify: jest.fn(),
    navigate: jest.fn(async () => null),
    confirmDialog: jest.fn(async () => true),
    obterItensCacheConsignacao: jest.fn(() => [])
  };
});

const PrestacaoContasPage = require('../../pages/PrestacaoContas');
const FecharConsignacaoView = require('../../pages/PrestacaoContas/FecharConsignacaoView');
const {
  createOperacaoContext,
  captureContextToken,
  isContextCurrent,
  bumpOperacaoContext,
  patchOperacaoContext
} = require('../../pages/PrestacaoContas/prestacaoOperacaoContext');
const {
  buildFinanceiroFromResumo,
  labelSituacaoFinanceira,
  SITUACAO
} = require('../../pages/PrestacaoContas/prestacaoFinanceiroSnapshot');
const {
  labelSituacaoFinanceiraOficial
} = require('../../pages/PrestacaoContas/prestacaoOperacionalConsolidacao');
const { carregarConsignacaoCompleta } = require('../../utils/operacional');
const Router = require('../../router/Router');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mountHost() {
  const host = document.createElement('div');
  host.id = 'page-content';
  document.body.appendChild(host);
  return host;
}

function makeConsignacao({ id, clienteId, clienteNome, prestacaoId = null, status = 'EM_PRESTACAO' }) {
  return {
    id,
    clienteId,
    clienteNome,
    status,
    documento: { numero: `CONS-${id}` },
    itens: [],
    prestacaoContasAtiva: prestacaoId
      ? { id: prestacaoId, status: 'ABERTA' }
      : null
  };
}

describe('RCM-8.6 — contexto da Prestação de Contas', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    jest.clearAllMocks();
  });

  test('1. contexto cliente correto', () => {
    const page = new PrestacaoContasPage('101', { clienteId: '10', origem: 'central' });
    expect(page.operacaoContext.clienteId).toBe('10');
    expect(page.operacaoContext.consignacaoId).toBe('101');
  });

  test('2. contexto consignação correto', () => {
    const ctx = createOperacaoContext({
      clienteId: 7,
      consignacaoId: 55,
      prestacaoId: null
    });
    expect(ctx.consignacaoId).toBe('55');
    expect(ctx.contextVersion).toBe(1);
  });

  test('3. contexto prestação correto', () => {
    const ctx = createOperacaoContext({
      clienteId: 1,
      consignacaoId: 2,
      prestacaoId: 'P-9'
    });
    const patched = patchOperacaoContext(ctx, { prestacaoId: 'P-88' });
    expect(patched.prestacaoId).toBe('P-88');
    expect(patched.contextVersion).toBe(ctx.contextVersion);
  });

  test('4. troca Milton → Max mantém contexto da tela aberta', async () => {
    const milton = makeConsignacao({
      id: 'M1',
      clienteId: 100,
      clienteNome: 'MILTON',
      prestacaoId: 'PM'
    });
    const max = makeConsignacao({
      id: 'X1',
      clienteId: 200,
      clienteNome: 'MAX',
      prestacaoId: 'PX'
    });

    carregarConsignacaoCompleta
      .mockImplementationOnce(async () => {
        await delay(50);
        return milton;
      })
      .mockImplementationOnce(async () => {
        await delay(10);
        return max;
      });

    const host = mountHost();
    const pageMilton = new PrestacaoContasPage('M1', { clienteId: '100' });
    const elMilton = pageMilton.render();
    host.appendChild(elMilton);
    const loadMilton = pageMilton._loadData(true);

    pageMilton.destroy();
    host.innerHTML = '';

    const pageMax = new PrestacaoContasPage('X1', { clienteId: '200' });
    const elMax = pageMax.render();
    host.appendChild(elMax);
    await pageMax._loadData(true);
    await loadMilton;

    expect(pageMax.consignacao?.clienteNome).toBe('MAX');
    expect(pageMax.operacaoContext.consignacaoId).toBe('X1');
    expect(pageMilton._disposed).toBe(true);
    expect(elMax.querySelector('#prestacao-cliente')?.textContent || '').not.toMatch(/MILTON/i);

    pageMax.destroy();
  });

  test('5. troca Max → Milton', async () => {
    carregarConsignacaoCompleta
      .mockResolvedValueOnce(makeConsignacao({
        id: 'X1', clienteId: 200, clienteNome: 'MAX', prestacaoId: 'PX'
      }))
      .mockResolvedValueOnce(makeConsignacao({
        id: 'M1', clienteId: 100, clienteNome: 'MILTON', prestacaoId: 'PM'
      }));

    const host = mountHost();
    const pageMax = new PrestacaoContasPage('X1', { clienteId: '200' });
    host.appendChild(pageMax.render());
    await pageMax._loadData(true);
    pageMax.destroy();
    host.innerHTML = '';

    const pageMilton = new PrestacaoContasPage('M1', { clienteId: '100' });
    host.appendChild(pageMilton.render());
    await pageMilton._loadData(true);
    expect(pageMilton.operacaoContext.clienteId).toBe('100');
    expect(pageMilton.consignacao?.clienteNome).toBe('MILTON');
    expect(pageMilton.consignacaoId).toBe('M1');
    pageMilton.destroy();
  });

  test('6. troca rápida entre 3 clientes', async () => {
    const clients = [
      { id: 'A', clienteId: 1, nome: 'MILTON' },
      { id: 'B', clienteId: 2, nome: 'CICERO' },
      { id: 'C', clienteId: 3, nome: 'MAX' }
    ];
    carregarConsignacaoCompleta.mockImplementation(async (_api, _proj, consignacaoId) => {
      const c = clients.find((x) => x.id === String(consignacaoId));
      await delay(20);
      return makeConsignacao({
        id: consignacaoId,
        clienteId: c.clienteId,
        clienteNome: c.nome,
        prestacaoId: `P-${consignacaoId}`
      });
    });

    const host = mountHost();
    let current = null;
    for (const c of clients) {
      if (current) current.destroy();
      host.innerHTML = '';
      current = new PrestacaoContasPage(c.id, { clienteId: String(c.clienteId) });
      host.appendChild(current.render());
      // só a última precisa concluir; as anteriores são destruídas no meio
    }
    await current._loadData(true);
    expect(current.operacaoContext.consignacaoId).toBe('C');
    expect(current.consignacao?.clienteNome).toBe('MAX');
    current.destroy();
  });

  test('7. resposta atrasada ignorada (cenário crítico Milton→Max)', async () => {
    let resolveMilton;
    const miltonPromise = new Promise((resolve) => { resolveMilton = resolve; });

    carregarConsignacaoCompleta
      .mockImplementationOnce(async () => miltonPromise)
      .mockImplementationOnce(async () => makeConsignacao({
        id: 'X1',
        clienteId: 200,
        clienteNome: 'MAX',
        prestacaoId: 'PX'
      }));

    const host = mountHost();
    const pageMilton = new PrestacaoContasPage('M1', { clienteId: '100' });
    host.appendChild(pageMilton.render());
    const pendingMilton = pageMilton._loadData(true);

    pageMilton.destroy();
    host.innerHTML = '';

    const pageMax = new PrestacaoContasPage('X1', { clienteId: '200' });
    host.appendChild(pageMax.render());
    await pageMax._loadData(true);

    resolveMilton(makeConsignacao({
      id: 'M1',
      clienteId: 100,
      clienteNome: 'MILTON',
      prestacaoId: 'PM'
    }));
    await pendingMilton;

    expect(pageMax.consignacao?.clienteNome).toBe('MAX');
    expect(pageMax.operacaoContext.consignacaoId).toBe('X1');
    pageMax.destroy();
  });

  test('8. timer antigo não atualiza tela', () => {
    jest.useFakeTimers();
    const page = new PrestacaoContasPage('1', { clienteId: '1' });
    const el = page.render();
    document.body.appendChild(el);
    page._startAutoRefresh();
    const spy = jest.spyOn(page, '_loadData').mockResolvedValue(undefined);
    page.destroy();
    jest.advanceTimersByTime(90000);
    expect(spy).not.toHaveBeenCalled();
    expect(page.refreshTimer).toBeNull();
    jest.useRealTimers();
  });

  test('9. polling antigo não atualiza tela após navegação', () => {
    jest.useFakeTimers();
    const host = mountHost();
    const pageA = new PrestacaoContasPage('A', { clienteId: '1' });
    host.appendChild(pageA.render());
    pageA._startAutoRefresh();
    const spyA = jest.spyOn(pageA, '_loadData').mockResolvedValue(undefined);

    const router = new Router({
      mountTarget: '#page-content',
      components: {}
    });
    expect(pageA.root.dataset.pageDestroyable).toBe('true');
    router._mount(document.createElement('div'));
    jest.advanceTimersByTime(90000);
    expect(spyA).not.toHaveBeenCalled();
    expect(pageA._disposed).toBe(true);
    jest.useRealTimers();
  });

  test('10. desmontagem limpa recursos', () => {
    jest.useFakeTimers();
    const page = new PrestacaoContasPage('9', { clienteId: '9' });
    const el = page.render();
    document.body.appendChild(el);
    page._startAutoRefresh();
    const versionBefore = page.operacaoContext.contextVersion;
    page.destroy();
    expect(page._disposed).toBe(true);
    expect(page.refreshTimer).toBeNull();
    expect(page._loadTimeout).toBeNull();
    expect(page.operacaoContext.contextVersion).toBeGreaterThan(versionBefore);
    expect(el.__cdsPageInstance == null).toBe(true);
    jest.useRealTimers();
  });

  test('11. erro de requisição antiga não aparece na tela nova', async () => {
    let rejectOld;
    const failing = new Promise((_, reject) => { rejectOld = reject; });

    carregarConsignacaoCompleta
      .mockImplementationOnce(async () => failing)
      .mockResolvedValueOnce(makeConsignacao({
        id: 'NEW',
        clienteId: 200,
        clienteNome: 'MAX',
        prestacaoId: 'PNEW'
      }));

    const host = mountHost();
    const pageOld = new PrestacaoContasPage('OLD', { clienteId: '100' });
    host.appendChild(pageOld.render());
    const pendingOld = pageOld._loadData(true);
    pageOld.destroy();
    host.innerHTML = '';

    const pageNew = new PrestacaoContasPage('NEW', { clienteId: '200' });
    host.appendChild(pageNew.render());
    await pageNew._loadData();
    rejectOld(new Error('falha MILTON'));
    await pendingOld.catch(() => {});

    expect(pageNew.error).toBeNull();
    expect(pageNew.consignacao?.clienteNome).toBe('MAX');
    expect(host.textContent).not.toMatch(/falha MILTON/);
    pageNew.destroy();
  });

  test('12. "Sem venda" não aparece como "Quitada"', () => {
    const fin = buildFinanceiroFromResumo({ valorVendido: 0, valorRecebido: 0 });
    expect(fin.situacaoFinanceira).toBe(SITUACAO.SEM_VENDA);
    expect(labelSituacaoFinanceira(fin.situacaoFinanceira)).toBe('Sem Venda');
    expect(labelSituacaoFinanceiraOficial(fin.situacaoFinanceira)).toBe('Sem Venda');
    expect(labelSituacaoFinanceira(fin.situacaoFinanceira)).not.toBe('Quitada');

    const html = FecharConsignacaoView._htmlCardFinanceiro(fin, 'Sem Venda');
    expect(html).toMatch(/Sem Venda/);
    expect(html).not.toMatch(/Valor da Venda/);
    expect(html).not.toMatch(/R\$\s*0,00/);
    expect(html).not.toMatch(/Quitada/);
  });

  test('token de contexto rejeita versão antiga', () => {
    const atual = createOperacaoContext({
      clienteId: '200',
      consignacaoId: 'X1',
      prestacaoId: 'PX',
      contextVersion: 2
    });
    const antigo = captureContextToken(createOperacaoContext({
      clienteId: '100',
      consignacaoId: 'M1',
      contextVersion: 1
    }));
    expect(isContextCurrent(antigo, atual)).toBe(false);
    expect(isContextCurrent(captureContextToken(atual), atual)).toBe(true);
    expect(isContextCurrent(captureContextToken(atual), atual, { disposed: true })).toBe(false);
  });

  test('Continuar Atendimento — sync prestacaoId não invalida token (sem spinner eterno)', async () => {
    carregarConsignacaoCompleta.mockResolvedValueOnce(makeConsignacao({
      id: '15',
      clienteId: 42,
      clienteNome: 'CICERO MAXIMINO DE SOUSA',
      prestacaoId: 'P-15',
      status: 'ENTREGUE'
    }));

    const host = mountHost();
    // Abre como a Central: tem clienteId, prestacaoId ainda desconhecido
    const page = new PrestacaoContasPage('15', { clienteId: '42', origem: 'central' });
    expect(page.operacaoContext.prestacaoId).toBeNull();
    host.appendChild(page.render());

    await page._loadData(false);

    expect(page.loading.consignacao).toBe(false);
    expect(page.loading.prestacao).toBe(false);
    expect(page.consignacao?.clienteNome).toMatch(/CICERO/i);
    expect(page.operacaoContext.prestacaoId).toBe('P-15');
    expect(page.operacaoContext.clienteId).toBe('42');
    const shell = host.querySelector('#fechar-consignacao-content');
    expect(shell?.textContent || '').not.toMatch(/Carregando atendimento/i);
    expect(host.querySelector('#prestacao-cliente')?.textContent || '').toMatch(/CICERO/i);

    page.destroy();
  });

  test('enrichment null→prestacaoId mantém token válido', () => {
    const antes = createOperacaoContext({
      clienteId: '42',
      consignacaoId: '15',
      prestacaoId: null,
      contextVersion: 1
    });
    const token = captureContextToken(antes);
    const depois = patchOperacaoContext(antes, { prestacaoId: 'P-15' });
    expect(isContextCurrent(token, depois)).toBe(true);
  });

  test('Router chama destroy ao trocar de página', () => {
    const host = mountHost();
    const page = new PrestacaoContasPage('77', { clienteId: '7' });
    host.appendChild(page.render());
    page._startAutoRefresh();
    const destroySpy = jest.spyOn(page, 'destroy');

    const router = new Router({ mountTarget: '#page-content', components: {} });
    const next = document.createElement('div');
    next.textContent = 'next';
    router._mount(next);

    expect(destroySpy).toHaveBeenCalled();
    expect(page._disposed).toBe(true);
    expect(page.refreshTimer).toBeNull();
  });
});
