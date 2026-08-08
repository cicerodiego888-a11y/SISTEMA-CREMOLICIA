/**
 * RC4.2 — espelho frontend do domínio de rateio
 */

const {
  calcularRateio,
  validarRateio,
  buildResumoFinanceiroRateio,
  TIPOS_RATEIO
} = require('../../pages/PrestacaoContas/rateioPerdaDomain');

describe('RC4.2 rateioPerdaDomain (frontend)', () => {
  test('Cliente 100%', () => {
    const r = calcularRateio(TIPOS_RATEIO.CLIENTE, 20);
    expect(r.valorCliente).toBe(20);
    expect(r.valorEmpresa).toBe(0);
  });

  test('Empresa 100%', () => {
    const r = calcularRateio(TIPOS_RATEIO.EMPRESA, 20);
    expect(r.valorCliente).toBe(0);
    expect(r.valorEmpresa).toBe(20);
  });

  test('Compartilhada com auto-cálculo', () => {
    const r = calcularRateio(TIPOS_RATEIO.COMPARTILHADA, 20, {
      valorCliente: 8,
      campoEditado: 'cliente'
    });
    expect(r.valorEmpresa).toBe(12);
    expect(r.percentualCliente).toBe(40);
  });

  test('validarRateio e resumo', () => {
    expect(validarRateio({
      tipoRateio: 'CLIENTE',
      valorTotalPerdas: 20,
      valorCliente: 20,
      valorEmpresa: 0,
      motivoPerda: 'QUEBRA'
    }).ok).toBe(true);

    const resumo = buildResumoFinanceiroRateio({
      valorVenda: 100,
      valorRecebido: 50,
      valorPerdas: 20,
      valorCliente: 20,
      valorEmpresa: 0
    });
    expect(resumo.valorLiquidoConsignado).toBe(70);
  });
});
