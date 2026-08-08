/**
 * EntregaConsignacao Page Tests — Sprint H-2
 */

const EntregaConsignacaoPage = require('../../pages/EntregaConsignacao/index');
const { normalizeCurrency } = require('../test-helpers');

describe('EntregaConsignacaoPage', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  test('creates entrega consignacao page', () => {
    const page = EntregaConsignacaoPage.create('123');
    expect(page).toBeDefined();
    expect(page.className).toContain('cds-workspace');
    expect(page.dataset.sharedUiReference).toBe('entrega');
  });

  test('initializes with consignacaoId', () => {
    const page = new EntregaConsignacaoPage('123');
    expect(page.consignacaoId).toBe('123');
  });

  test('updates checklist based on consignation data', () => {
    const page = new EntregaConsignacaoPage('123');
    page.consignacao = {
      clienteId: 1,
      perfilStatus: 'ATIVO',
      documento: 'DOC-123',
      itens: [{ produto: 'Test', quantidade: 1, preco: 10 }],
      status: 'RASCUNHO',
      limite: 1000
    };
    page.resumoPrestacao = { saldoAtual: 0 };
    page._updateChecklist();
    expect(page.checklist.clienteValido).toBe(true);
    expect(page.checklist.perfilAtivo).toBe(true);
    expect(page.checklist.documentoValido).toBe(true);
    expect(page.checklist.itensCadastrados).toBe(true);
  });

  test('formats currency correctly', () => {
    const page = new EntregaConsignacaoPage('123');
    expect(normalizeCurrency(page._formatCurrency(1000.50))).toBe('R$ 1.000,50');
  });

  test('_verificarEntregaJaPersistida reconhece status ENTREGUE após erro HTTP', async () => {
    const page = new EntregaConsignacaoPage('123');
    page.api.obterConsignacao = jest.fn(async () => ({ id: 123, status: 'ENTREGUE', itens: [] }));

    await expect(page._verificarEntregaJaPersistida()).resolves.toBe(true);
    expect(page.consignacao.status).toBe('ENTREGUE');
  });

  test('_verificarEntregaJaPersistida retorna false quando ainda não entregue', async () => {
    const page = new EntregaConsignacaoPage('123');
    page.api.obterConsignacao = jest.fn(async () => ({ id: 123, status: 'RASCUNHO' }));

    await expect(page._verificarEntregaJaPersistida()).resolves.toBe(false);
  });

  test('_loadData: consignação recém-criada abre pela API sem toast de recovery', async () => {
    const notify = window.showNotification;
    notify.mockClear();

    const page = new EntregaConsignacaoPage(555);
    page.api.obterConsignacao = jest.fn(async () => ({
      id: 555,
      status: 'RASCUNHO',
      clienteId: 10,
      perfilComercialId: 3,
      documento: 'CONS-2026-000555',
      itens: [{ id: 1, produtoId: 7, quantidade: 2, precoUnitario: 5 }]
    }));
    page.api.obterPerfil = jest.fn(async () => ({
      perfilTipo: 'CONSIGNADO',
      ativo: true,
      bloqueado: false,
      limiteComercial: 1000
    }));
    page.api.listarItensConsignacao = jest.fn(async () => []);
    page.projectionApi.obterSituacaoCliente = jest.fn(async () => ({
      clienteNome: 'Cliente Teste',
      limiteDisponivel: 1000,
      saldoEmAberto: 0
    }));
    page.projectionApi.obterResumoPrestacao = jest.fn(async () => ({ itens: [], saldoAtual: 0 }));

    await page._loadData();

    expect(page.consignacao).toBeTruthy();
    expect(page.consignacao.id).toBe(555);
    expect(page.error).toBeNull();
    const opaqueRecovery = notify.mock.calls.find((call) =>
      String(call[0] || '').includes('Não foi possível recuperar esta operação agora')
    );
    expect(opaqueRecovery).toBeUndefined();
  });
});
