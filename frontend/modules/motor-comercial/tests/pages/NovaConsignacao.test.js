/**
 * NovaConsignacao Page Tests — Sprint UX-04
 */

const NovaConsignacaoPage = require('../../pages/NovaConsignacao/index');
const { normalizeCurrency } = require('../test-helpers');

describe('NovaConsignacaoPage', () => {
  test('creates preparar entrega page with stepper', () => {
    const page = NovaConsignacaoPage.create();
    expect(page).toBeDefined();
    expect(page.className).toContain('cds-page');
    expect(page.querySelector('.cds-stepper')).not.toBeNull();
    expect(page.textContent).toContain('Preparar Entrega');
    expect(page.textContent).not.toContain('Nova Consignação');
  });

  test('initializes four operational moments', () => {
    const wizard = new NovaConsignacaoPage();
    expect(wizard.steps).toHaveLength(4);
    expect(wizard.steps.map((s) => s.label)).toEqual(['Cliente', 'Produtos', 'Conferência', 'Conclusão']);
    expect(wizard.currentStep).toBe(0);
  });

  test('contexto cliente360 pula para produtos', () => {
    const wizard = new NovaConsignacaoPage({}, { clienteId: '12', origem: 'cliente360' });
    expect(wizard.skipClienteStep).toBe(true);
    expect(wizard.clienteLocked).toBe(true);
    expect(wizard.currentStep).toBe(1);
    expect(wizard.steps[0].state).toBe('completed');
    expect(wizard.steps[1].state).toBe('current');
  });

  test('contexto central pula para produtos', () => {
    const wizard = new NovaConsignacaoPage({}, { clienteId: '8', origem: 'central' });
    expect(wizard.skipClienteStep).toBe(true);
    expect(wizard.currentStep).toBe(1);
  });

  test('fluxo menu inicia em cliente', () => {
    const wizard = new NovaConsignacaoPage({}, {});
    expect(wizard.skipClienteStep).toBe(false);
    expect(wizard.currentStep).toBe(0);
  });

  test('contexto cliente360 oculta voltar na etapa produtos', () => {
    const wizard = new NovaConsignacaoPage({}, { clienteId: '12', origem: 'cliente360' });
    const footer = wizard._createFooter();
    const texts = Array.from(footer.querySelectorAll('button')).map((b) => b.textContent);
    expect(texts).not.toContain('Voltar');
    expect(texts).toContain('Continuar');
  });

  test('conferência exibe botão Concluir', () => {
    const wizard = new NovaConsignacaoPage();
    wizard.currentStep = 2;
    const footer = wizard._createFooter();
    const texts = Array.from(footer.querySelectorAll('button')).map((b) => b.textContent);
    expect(texts).toContain('Concluir');
    expect(texts).not.toContain('Continuar');
  });

  test('validates produtos step requires items', () => {
    const wizard = new NovaConsignacaoPage();
    wizard.currentStep = 1;
    wizard.data.itens = [];
    const errors = wizard._validateCurrentStep();
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toBe('Adicione pelo menos um produto');
  });

  test('formats currency correctly', () => {
    const wizard = new NovaConsignacaoPage();
    expect(normalizeCurrency(wizard._formatCurrency(1000.50))).toBe('R$ 1.000,50');
  });

  test('Concluir: POST cria consignação e redireciona para Entrega (sem mensagem de recovery)', async () => {
    const navigate = window.MotorComercial.navigate;
    const notify = window.showNotification;
    navigate.mockClear();
    notify.mockClear();

    const wizard = new NovaConsignacaoPage();
    wizard.currentStep = 2;
    wizard.data.clienteId = 10;
    wizard.data.perfilComercialId = 3;
    wizard.data.itens = [
      { produtoId: 7, produto: 'Picolé', quantidade: 2, preco: 5, persistido: false }
    ];
    wizard.clienteProfile = {
      nome: 'Cliente Teste',
      limiteDisponivel: 1000,
      situacao: 'ATIVO'
    };

    wizard.api.criarConsignacao = jest.fn(async () => ({
      id: 555,
      status: 'RASCUNHO',
      documento: { numero: 'CONS-2026-000555' }
    }));
    wizard.api.adicionarItem = jest.fn(async () => ({ id: 1, produtoId: 7 }));
    wizard.api.obterConsignacao = jest.fn(async () => ({
      id: 555,
      status: 'RASCUNHO',
      itens: [{ id: 91, produtoId: 7, quantidade: 2, precoUnitario: 5 }]
    }));

    await wizard._createConsignacao();

    expect(wizard.api.criarConsignacao).toHaveBeenCalledTimes(1);
    expect(wizard.api.adicionarItem).toHaveBeenCalledWith(555, expect.objectContaining({
      produtoId: 7,
      quantidade: 2
    }));
    expect(wizard.consignacaoId).toBe(555);
    expect(navigate).toHaveBeenCalledWith('/consignacoes/555/entrega', expect.any(Object));

    const opaqueRecovery = notify.mock.calls.find((call) =>
      String(call[0] || '').includes('Não foi possível recuperar esta operação agora')
    );
    expect(opaqueRecovery).toBeUndefined();
    const successToast = notify.mock.calls.find((call) =>
      String(call[0] || '').includes('Consignação criada com sucesso')
    );
    expect(successToast).toBeTruthy();
  });

  test('_extractCreatedConsignacao aceita entidade já unwrapped e envelope com consignacao', () => {
    const wizard = new NovaConsignacaoPage();
    expect(wizard._extractCreatedConsignacao({ id: 9, status: 'RASCUNHO' }).id).toBe(9);
    expect(wizard._extractCreatedConsignacao({ consignacao: { id: 11 } }).id).toBe(11);
    expect(wizard._extractCreatedConsignacao(null)).toBeNull();
  });
});
