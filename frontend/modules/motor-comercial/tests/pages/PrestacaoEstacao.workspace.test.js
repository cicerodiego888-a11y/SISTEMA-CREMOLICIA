/**
 * PrestacaoContas Estação — UX-12 Workspace shell
 */

jest.mock('../../api/MotorComercialApi', () => jest.fn().mockImplementation(() => ({
  obterConsignacao: jest.fn(async () => null),
  obterPrestacao: jest.fn(async () => null)
})));

jest.mock('../../api/ProjectionApi', () => jest.fn().mockImplementation(() => ({
  listarMovimentacoes: jest.fn(async () => ({})),
  obterProjecaoContaCorrente: jest.fn(async () => ({}))
})));

const PrestacaoContasPage = require('../../pages/PrestacaoContas');

describe('PrestacaoContas — Estação Workspace UX-12', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.head.querySelectorAll('#cds-shared-ui-workspace-styles').forEach((n) => n.remove());
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('usa Workspace oficial (não WizardLayout)', () => {
    const el = PrestacaoContasPage.create('99', { origem: 'central' });
    expect(el.classList.contains('cds-workspace')).toBe(true);
    expect(el.className).not.toMatch(/wizard-layout/i);
    expect(el.dataset.sharedUiReference).toBe('prestacao-estacao');
    expect(el.dataset.estacaoTrabalho).toBe('prestacao');
    expect(el.dataset.uxSprint).toBe('STAB-07.5');
    expect(el.querySelector('.cds-workspace__header')).toBeTruthy();
    expect(el.querySelector('.cds-workspace__footer')).toBeTruthy();
    expect(el.querySelector('#fechar-consignacao-content')).toBeTruthy();
    expect(el.querySelector('.cds-wizard-layout__sidebar')).toBeNull();
    expect(el.querySelector('.cds-prestacao-estacao__body--fill')).toBeTruthy();
  });
});
