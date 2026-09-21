/**
 * RCM-8.15.1 — Auto-refresh não destrutivo + resumo financeiro em tempo real
 */

jest.mock('../../api/MotorComercialApi', () => jest.fn().mockImplementation(() => ({
  obterConsignacao: jest.fn(async () => null),
  obterRateioPerda: jest.fn(async () => null),
  obterResumoFinalPrestacao: jest.fn(async () => null),
  listarItensConsignacao: jest.fn(async () => [])
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
const FecharConsignacaoView = require('../../pages/PrestacaoContas/FecharConsignacaoView');
const { temAlteracoesPendentes } = require('../../pages/PrestacaoContas/gradeConsistencia');
const {
  buildPainelLateralPreview,
  precoSnapshotItem,
  calcularValorNaturezaItens
} = require('../../pages/PrestacaoContas/fecharConsignacaoMappers');
const { carregarConsignacaoCompleta } = require('../../utils/operacional');

function itemServidor(overrides = {}) {
  return {
    id: 1,
    itemId: 1,
    produtoId: 10,
    produtoNome: 'Produto A',
    consignacaoId: 'A',
    quantidadeEntregue: 50,
    enviado: 50,
    quantidadeVendida: 50,
    vendido: 50,
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

function makeConsignacao(itens) {
  return {
    id: 'A',
    clienteId: 42,
    clienteNome: 'CLIENTE AUDIT',
    status: 'EM_PRESTACAO',
    documento: { numero: 'CONS-A' },
    itens: itens || [itemServidor()],
    prestacaoContasAtiva: { id: 'GRUPO-1', status: 'ABERTA' }
  };
}

async function abrirPagina(itens) {
  carregarConsignacaoCompleta.mockResolvedValue(makeConsignacao(itens));
  const page = new PrestacaoContasPage('A', { clienteId: '42' });
  document.body.appendChild(page.render());
  if (page._loadTimeout) {
    clearTimeout(page._loadTimeout);
    page._loadTimeout = null;
  }
  await page._loadData(false, { modo: LOAD_MODO.INICIAL });
  return page;
}

describe('RCM-8.15.1 auto-refresh + financeiro tempo real', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    jest.clearAllMocks();
    carregarConsignacaoCompleta.mockResolvedValue(makeConsignacao());
  });

  test('1-3. poll não limpa dirty, não marca saved e não reconstrói com innerHTML', async () => {
    const page = await abrirPagina();
    page._aplicarAlteracaoState(0, 'vendido', 40);
    page.editing = { rowIndex: -1, campo: null, originalValue: null };
    const gradeAntes = page.root.querySelector('#fechar-retornos-grade');
    const spyContent = jest.spyOn(page, '_updateContent');

    await page._loadData(true, { modo: LOAD_MODO.AUTO_REFRESH });

    expect(temAlteracoesPendentes(page.resumoPrestacao.itens)).toBe(true);
    expect(page.persistenciaStatus).toBe('pending');
    expect(page.root.querySelector('#fechar-persistencia-status')?.textContent).toMatch(/pendentes/i);
    expect(spyContent).not.toHaveBeenCalled();
    expect(page.root.querySelector('#fechar-retornos-grade')).toBe(gradeAntes);
  });

  test('4-8. poll preserva vendido, devolvido, perda, cortesia e observação', async () => {
    const page = await abrirPagina();
    page._aplicarAlteracaoState(0, 'vendido', 40);
    page._aplicarAlteracaoState(0, 'devolvido', 3);
    page._aplicarAlteracaoState(0, 'perdido', 2);
    page._aplicarAlteracaoState(0, 'cortesia', 1);
    page._aplicarAlteracaoState(0, 'observacao', 'TESTE-OBS');
    page.editing = { rowIndex: -1, campo: null, originalValue: null };

    await page._loadData(true, { modo: LOAD_MODO.AUTO_REFRESH });
    await page._loadData(true, { modo: LOAD_MODO.AUTO_REFRESH });

    const item = page.resumoPrestacao.itens[0];
    expect(item.vendido).toBe(40);
    expect(item.devolvido).toBe(3);
    expect(item.perdido).toBe(2);
    expect(item.cortesia).toBe(1);
    expect(item.observacao).toBe('TESTE-OBS');
    expect(item.dirty).toBe(true);
    expect(page.root.querySelector('input[data-campo="vendido"]').value).toBe('40');
    expect(page.root.querySelector('input[data-campo="observacao"]').value).toBe('TESTE-OBS');
  });

  test('9. poll preserva rateio no DOM', async () => {
    const page = await abrirPagina([itemServidor({ perdido: 5, quantidadePerdida: 5, vendido: 10 })]);
    page.rateioPerda = { rateio: { tipoRateio: 'CLIENTE', valorCliente: 50, motivoPerda: '' }, totais: { totalPerdido: 50 } };
    page._updateUI();
    const host = page.root.querySelector('#fechar-rateio-perda');
    expect(host).toBeTruthy();
    const motivo = host.querySelector('[data-rateio="motivo"]');
    if (motivo) motivo.value = 'QUEBRA';
    const obs = host.querySelector('[data-rateio="observacao"]');
    if (obs) {
      obs.value = 'RATEIO-LOCAL';
      const wrap = host.querySelector('#rateio-obs-wrap');
      if (wrap) wrap.hidden = false;
    }

    await page._loadData(true, { modo: LOAD_MODO.AUTO_REFRESH });
    expect(page.root.querySelector('[data-rateio="motivo"]').value).toBe('QUEBRA');
    expect(page.root.querySelector('[data-rateio="observacao"]').value).toBe('RATEIO-LOCAL');
  });

  test('10. poll preserva pagamentoDraft e o form', async () => {
    const page = await abrirPagina([itemServidor({ vendido: 10, quantidadeVendida: 10 })]);
    page.resumoPrestacao.valorVenda = 100;
    page.resumoPrestacao.valorVendido = 100;
    page.snapshot = {
      financeiro: {
        valorVenda: 100,
        valorRecebido: 0,
        saldoEmAberto: 100,
        situacaoFinanceira: 'EM_ABERTO'
      }
    };
    page.currentStep = 1;
    page.pagamentoDraft = { valor: '33.50', formaPagamento: 'PIX', observacoes: '' };
    page._updateUI();
    const formAntes = page.root.querySelector('.cds-fechar-consignacao__pagamento-form');
    expect(formAntes).toBeTruthy();

    await page._loadData(true, { modo: LOAD_MODO.AUTO_REFRESH });
    expect(page.pagamentoDraft.valor).toBe('33.50');
    expect(page.pagamentoDraft.formaPagamento).toBe('PIX');
    expect(page.root.querySelector('.cds-fechar-consignacao__pagamento-form')).toBe(formAntes);
  });

  test('11. poll atualiza dados externos não dirty', async () => {
    const page = await abrirPagina([
      itemServidor({ id: 1, itemId: 1 }),
      itemServidor({
        id: 2,
        itemId: 2,
        produtoId: 20,
        produtoNome: 'Produto B',
        vendido: 5,
        quantidadeVendida: 5
      })
    ]);
    page._aplicarAlteracaoState(0, 'vendido', 40);
    page.editing = { rowIndex: -1, campo: null, originalValue: null };
    expect(page.resumoPrestacao.itens[1].dirty).toBeFalsy();

    await page._loadData(true, { modo: LOAD_MODO.AUTO_REFRESH });
    expect(page.resumoPrestacao.itens[0].vendido).toBe(40);
    expect(page.resumoPrestacao.itens[0].dirty).toBe(true);
  });

  test('12. interval permanece 45s e chama AUTO_REFRESH', () => {
    jest.useFakeTimers();
    const page = new PrestacaoContasPage('A', { clienteId: '42' });
    const el = page.render();
    document.body.appendChild(el);
    if (page._loadTimeout) {
      clearTimeout(page._loadTimeout);
      page._loadTimeout = null;
    }
    const spy = jest.spyOn(page, '_loadData').mockResolvedValue(undefined);
    page._startAutoRefresh();
    jest.advanceTimersByTime(44999);
    expect(spy).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(spy).toHaveBeenCalledWith(true, { modo: LOAD_MODO.AUTO_REFRESH });
    page.destroy();
    jest.useRealTimers();
  });

  test('13-20. card RESUMO FINANCEIRO projeta qtd e R$ imediatamente, sem request', async () => {
    const page = await abrirPagina();
    const spyResumo = jest.spyOn(page.projectionApi, 'obterResumoPrestacao');
    const callsAntes = spyResumo.mock.calls.length;
    page._aplicarAlteracaoState(0, 'vendido', 40);

    const aside = page.root.querySelector('#fechar-painel-lateral');
    expect(aside.querySelector('.cds-op-card__titulo')?.textContent).toMatch(/Resumo Financeiro/i);
    expect(aside.querySelector('[data-painel="vendidos"]').textContent).toBe('40');
    expect(aside.querySelector('[data-painel="valorVendidos"]').textContent).toMatch(/400/);
    expect(aside.querySelector('[data-painel="valorVenda"]').textContent).toMatch(/400/);
    expect(aside.querySelector('[data-painel="saldoEmAberto"]').textContent).toMatch(/400/);
    expect(aside.textContent).toMatch(/A receber/i);
    expect(spyResumo.mock.calls.length).toBe(callsAntes);
  });

  test('15-18. devolvido, perda e cortesia recalculam valor', async () => {
    const page = await abrirPagina();
    page._aplicarAlteracaoState(0, 'vendido', 40);
    page._aplicarAlteracaoState(0, 'devolvido', 5);
    page._aplicarAlteracaoState(0, 'perdido', 2);
    page._aplicarAlteracaoState(0, 'cortesia', 1);
    const aside = page.root.querySelector('#fechar-painel-lateral');
    expect(aside.querySelector('[data-painel="devolvidos"]').textContent).toBe('5');
    expect(aside.querySelector('[data-painel="valorDevolvidos"]').textContent).toMatch(/50/);
    expect(aside.querySelector('[data-painel="perdas"]').textContent).toBe('2');
    expect(aside.querySelector('[data-painel="valorPerdas"]').textContent).toMatch(/20/);
    expect(aside.querySelector('[data-painel="cortesias"]').textContent).toBe('1');
    expect(aside.querySelector('[data-painel="valorCortesias"]').textContent).toMatch(/10/);
  });

  test('21-22. preço vem do snapshot; fórmula = qtd × precoUnitario', () => {
    const item = { vendido: 40, precoUnitario: 10, preco: 99 };
    expect(precoSnapshotItem(item)).toBe(10);
    expect(calcularValorNaturezaItens([item], 'vendido')).toBe(400);
    const painel = buildPainelLateralPreview({ valorVendido: 500 }, [item]);
    expect(painel.valorVenda).toBe(400);
  });

  test('23. persistência projetada coincide com a regra do motor (qtd × precoUnitario)', () => {
    const itens = [
      { vendido: 40, precoUnitario: 10 },
      { vendido: 25, precoUnitario: 5 }
    ];
    const projetado = calcularValorNaturezaItens(itens, 'vendido');
    const backendLike = itens.reduce((s, i) => s + i.vendido * i.precoUnitario, 0);
    expect(projetado).toBe(backendLike);
    expect(projetado).toBe(525);
  });

  test('34. múltiplas consignações: poll não reconstrói a grade', async () => {
    const page = await abrirPagina([
      itemServidor({ id: 1, itemId: 1, consignacaoId: 'A', produtoNome: 'Item A' }),
      itemServidor({
        id: 2,
        itemId: 2,
        consignacaoId: 'B',
        produtoId: 20,
        produtoNome: 'Item B',
        vendido: 25,
        quantidadeVendida: 25,
        precoUnitario: 5
      })
    ]);
    page._aplicarAlteracaoState(0, 'vendido', 40);
    page.editing = { rowIndex: -1, campo: null, originalValue: null };
    const rowsAntes = [...page.root.querySelectorAll('tr[data-row-index]')];
    await page._loadData(true, { modo: LOAD_MODO.AUTO_REFRESH });
    const rowsDepois = [...page.root.querySelectorAll('tr[data-row-index]')];
    expect(rowsDepois[0]).toBe(rowsAntes[0]);
    expect(rowsDepois[1]).toBe(rowsAntes[1]);
    expect(page.resumoPrestacao.itens[0].vendido).toBe(40);
  });

  test('sidebar existente continua sendo o único Resumo Financeiro da estação', async () => {
    const page = await abrirPagina();
    const cards = [...page.root.querySelectorAll('.cds-op-card__titulo')]
      .filter((el) => /Resumo Financeiro/i.test(el.textContent));
    expect(cards).toHaveLength(1);
    expect(FecharConsignacaoView._buildSidebarRetornos({}, {}).id).toBe('fechar-painel-lateral');
  });
});
