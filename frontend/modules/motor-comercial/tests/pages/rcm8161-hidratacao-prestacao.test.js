/**
 * RCM-8.16.1 — Hidratação segura da Prestação após queda / reload.
 *
 * Executar:
 *   npm run test:motor-comercial-frontend -- --testPathPatterns=rcm8161-hidratacao-prestacao
 */

jest.mock('../../api/MotorComercialApi', () => jest.fn().mockImplementation(() => ({
  obterConsignacao: jest.fn(async () => null),
  obterRateioPerda: jest.fn(async () => null),
  obterResumoFinalPrestacao: jest.fn(async () => null),
  listarItensConsignacao: jest.fn(async () => []),
  definirRateioPerda: jest.fn(async () => ({})),
  registrarPagamento: jest.fn(async () => ({}))
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
const { LOAD_MODO } = PrestacaoContasPage;
const {
  STEP_RETORNOS,
  STEP_RESUMO
} = require('../../pages/PrestacaoContas/fecharConsignacaoMappers');
const { MENSAGENS_HARDENING } = require('../../pages/PrestacaoContas/prestacaoHardening');
const { temAlteracoesPendentes } = require('../../pages/PrestacaoContas/gradeConsistencia');
const {
  carregarConsignacaoCompleta,
  notify,
  ERRO_CONSIGNACAO_OFICIAL_NAO_LOCALIZADA
} = require('../../utils/operacional');
const operacionalReal = jest.requireActual('../../utils/operacional');

function itemOficial(overrides = {}) {
  return {
    id: 1,
    itemId: 1,
    produtoId: 10,
    produtoNome: 'Produto A',
    consignacaoId: 'A',
    quantidadeEntregue: 50,
    enviado: 50,
    quantidadeVendida: 10,
    vendido: 10,
    quantidadeDevolvida: 0,
    devolvido: 0,
    quantidadePerdida: 0,
    perdido: 0,
    quantidadeCortesia: 0,
    cortesia: 0,
    precoUnitario: 10,
    preco: 10,
    observacao: '',
    ...overrides
  };
}

function makeConsignacao(overrides = {}) {
  return {
    id: 'A',
    clienteId: 42,
    clienteNome: 'CLIENTE HIDRATACAO',
    status: 'EM_PRESTACAO',
    documento: { numero: 'CONS-A' },
    itens: [itemOficial()],
    prestacaoContasAtiva: { id: 'GRUPO-1', status: 'ABERTA' },
    ...overrides
  };
}

function botaoContinuar(page) {
  const buttons = [...(page.root?.querySelectorAll('button') || [])];
  return buttons.find((btn) => /Continuar para o fechamento/i.test(btn.textContent || ''));
}

function montarSemAutoload(consignacaoId = 'A', query = { clienteId: '42' }) {
  const page = new PrestacaoContasPage(consignacaoId, query);
  document.body.appendChild(page.render());
  if (page._loadTimeout) {
    clearTimeout(page._loadTimeout);
    page._loadTimeout = null;
  }
  return page;
}

async function abrirHidratada(overrides = {}, resumo = null) {
  carregarConsignacaoCompleta.mockResolvedValue(makeConsignacao(overrides));
  const page = montarSemAutoload(String(overrides.id || 'A'));
  if (resumo) {
    page.projectionApi.obterResumoPrestacao.mockResolvedValue(resumo);
  }
  await page._loadData(false, { modo: LOAD_MODO.INICIAL });
  return page;
}

describe('RCM-8.16.1 hidratação da Prestação', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    jest.clearAllMocks();
    carregarConsignacaoCompleta.mockResolvedValue(makeConsignacao());
  });

  test('1. Continuar antes de _loadData terminar não lança TypeError e não avança', async () => {
    carregarConsignacaoCompleta.mockImplementation(() => new Promise(() => {}));
    const page = montarSemAutoload();
    const pending = page._loadData(false, { modo: LOAD_MODO.INICIAL });

    expect(page.loading.consignacao).toBe(true);
    expect(page.consignacao).toBeNull();
    expect(page.resumoPrestacao).toBeNull();

    const btn = botaoContinuar(page);
    expect(btn).toBeTruthy();
    expect(btn.disabled).toBe(true);

    await expect(page._goNext()).resolves.toBeUndefined();
    expect(page.currentStep).toBe(STEP_RETORNOS);
    expect(notify).toHaveBeenCalledWith(
      MENSAGENS_HARDENING.PRESTACAO_AGUARDE_HIDRATACAO,
      'warning'
    );
    expect(page.resumoPrestacao).toBeNull();
    pending.catch(() => {});
    page.destroy();
  });

  test('2. Reload da Prestação aguarda hidratação e Continuar funciona', async () => {
    const page = await abrirHidratada();
    expect(page._hidratacaoOficialPendente()).toBe(false);
    expect(botaoContinuar(page).disabled).toBe(false);

    await page._goNext();
    expect(page.currentStep).toBe(STEP_RESUMO);
    expect(page.resumoPrestacao.itens.length).toBeGreaterThan(0);
    page.destroy();
  });

  test('3. Reabrir após queda reconstrói consignação pela API (nova instância)', async () => {
    const page1 = await abrirHidratada();
    expect(page1.consignacao.id).toBe('A');
    page1.destroy();
    document.body.innerHTML = '';

    const page2 = await abrirHidratada();
    expect(carregarConsignacaoCompleta).toHaveBeenCalled();
    expect(page2.consignacao).toEqual(expect.objectContaining({ id: 'A', clienteId: 42 }));
    expect(page2.resumoPrestacao.itens.length).toBeGreaterThan(0);
    await page2._goNext();
    expect(page2.currentStep).toBe(STEP_RESUMO);
    page2.destroy();
  });

  test('4. Itens persistidos aparecem no fechamento', async () => {
    const itens = [
      itemOficial({ id: 7, itemId: 7, produtoNome: 'Picolé', quantidadeVendida: 3, vendido: 3 })
    ];
    const page = await abrirHidratada({ itens });
    await page._goNext();
    expect(page.currentStep).toBe(STEP_RESUMO);
    expect(page.resumoPrestacao.itens.some((item) => item.produtoNome === 'Picolé')).toBe(true);
    page.destroy();
  });

  test('5. CONS-A + CONS-B permanecem no mesmo grupo de prestação após reload', async () => {
    const resumoCiclo = {
      grupoPrestacaoContasId: 'GRUPO-CICLO',
      quantidadeConsignacoes: 2,
      consignacoes: [{ id: 'A' }, { id: 'B' }],
      itens: [
        itemOficial({ consignacaoId: 'A', produtoNome: 'Item A' }),
        itemOficial({
          id: 2,
          itemId: 2,
          produtoId: 20,
          consignacaoId: 'B',
          produtoNome: 'Item B'
        })
      ]
    };
    const page1 = await abrirHidratada({
      prestacaoContasAtiva: { id: 'GRUPO-CICLO', status: 'ABERTA' }
    }, resumoCiclo);
    expect(page1.resumoPrestacao.grupoPrestacaoContasId).toBe('GRUPO-CICLO');
    expect(page1.resumoPrestacao.quantidadeConsignacoes).toBe(2);
    page1.destroy();
    document.body.innerHTML = '';

    const page2 = await abrirHidratada({
      prestacaoContasAtiva: { id: 'GRUPO-CICLO', status: 'ABERTA' }
    }, resumoCiclo);
    expect(page2.resumoPrestacao.grupoPrestacaoContasId).toBe('GRUPO-CICLO');
    expect(page2.resumoPrestacao.quantidadeConsignacoes).toBe(2);
    expect(page2.resumoPrestacao.consignacoesCiclo.map((c) => String(c.id))).toEqual(
      expect.arrayContaining(['A', 'B'])
    );
    expect(Array.isArray(page2.resumoPrestacao.itens)).toBe(true);
    expect(page2.resumoPrestacao.itens.length).toBeGreaterThan(0);
    page2.destroy();
  });

  test('6. GET consignação = null → erro operacional controlado, nunca TypeError', async () => {
    const api = {
      obterConsignacao: jest.fn(async () => null),
      listarItensConsignacao: jest.fn(async () => [{ id: 1 }]),
      obterPerfil: jest.fn()
    };
    const projectionApi = {
      obterSituacaoCliente: jest.fn(),
      obterResumoPrestacao: jest.fn()
    };

    await expect(
      operacionalReal.carregarConsignacaoCompleta(api, projectionApi, 99)
    ).rejects.toThrow(ERRO_CONSIGNACAO_OFICIAL_NAO_LOCALIZADA);
    expect(api.listarItensConsignacao).not.toHaveBeenCalled();
    expect(projectionApi.obterResumoPrestacao).not.toHaveBeenCalled();

    const page = montarSemAutoload();
    expect(() => page._buildResumoFromData(null, [], null, null)).toThrow(
      MENSAGENS_HARDENING.PRESTACAO_CONSIGNACAO_OFICIAL_AUSENTE
    );
    page.destroy();
  });

  test('7. resumoPrestacao = null → fluxo protegido', async () => {
    const page = await abrirHidratada();
    page.resumoPrestacao = null;
    page._updateFooter();
    expect(page._hidratacaoOficialPendente()).toBe(true);
    expect(botaoContinuar(page).disabled).toBe(true);
    await page._goNext();
    expect(page.currentStep).toBe(STEP_RETORNOS);
    expect(notify).toHaveBeenCalledWith(
      MENSAGENS_HARDENING.PRESTACAO_AGUARDE_HIDRATACAO,
      'warning'
    );
    page.destroy();
  });

  test('8. RCM-8.6 — dispose incrementa contextVersion e cancela hidratação', async () => {
    const page = await abrirHidratada();
    const versionBefore = page.operacaoContext.contextVersion;
    page.destroy();
    expect(page._disposed).toBe(true);
    expect(page.operacaoContext.contextVersion).toBeGreaterThan(versionBefore);
    expect(page._hidratacaoOficialPendente()).toBe(true);
    await page._goNext();
    expect(page.currentStep).toBe(STEP_RETORNOS);
  });

  test('9. RCM-8.15.1 — auto-refresh continua preservando dirty', async () => {
    const page = await abrirHidratada();
    page._aplicarAlteracaoState(0, 'vendido', 40);
    expect(temAlteracoesPendentes(page.resumoPrestacao.itens)).toBe(true);
    await page._loadData(true, { modo: LOAD_MODO.AUTO_REFRESH });
    expect(temAlteracoesPendentes(page.resumoPrestacao.itens)).toBe(true);
    expect(page.resumoPrestacao.itens[0].vendido).toBe(40);
    expect(page.persistenciaStatus).not.toBe('saved');
    page.destroy();
  });

  test('trabalho não persistido não é inventado após nova instância', async () => {
    const page1 = await abrirHidratada();
    page1._aplicarAlteracaoState(0, 'vendido', 40);
    page1.destroy();
    document.body.innerHTML = '';
    const page2 = await abrirHidratada();
    expect(Number(page2.resumoPrestacao.itens[0].vendido)).toBe(10);
    page2.destroy();
  });
});
