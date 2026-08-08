/**
 * NovaConsignacao / Preparar Entrega — UX-20 Workspace
 */

jest.mock('../../api/MotorComercialApi', () => jest.fn().mockImplementation(() => ({})));
jest.mock('../../api/ProjectionApi', () => jest.fn().mockImplementation(() => ({})));

const NovaConsignacaoPage = require('../../pages/NovaConsignacao');

describe('Preparar Entrega — Workspace UX-20', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.head.querySelectorAll('#cds-shared-ui-workspace-styles').forEach((n) => n.remove());
  });

  test('monta Workspace sem sidebar/dashboard', () => {
    const el = NovaConsignacaoPage.create({}, { origem: 'central' });
    expect(el.classList.contains('cds-workspace')).toBe(true);
    expect(el.dataset.uxSprint).toBe('UX-20');
    expect(el.dataset.sharedUiReference).toBe('preparar-entrega');
    expect(el.querySelector('.cds-workspace__footer')).toBeTruthy();
    expect(el.querySelector('#preparar-entrega-resumo-financeiro')).toBeTruthy();
    expect(el.querySelector('#preparar-entrega-operacao-resumo')).toBeTruthy();
    expect(el.querySelector('#preparar-entrega-credit-strip')).toBeNull();
    expect(el.querySelector('.cds-dashboard-layout__sidebar')).toBeNull();
  });
});
