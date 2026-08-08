/**
 * RC4.2 — RateioPerda (domínio)
 * Executar: node backend/motores/motor-comercial/tests/rc42-rateio-perdas.test.js
 */

const assert = require('assert');
const {
  calcularRateio,
  validarRateio,
  buildResumoFinanceiroRateio,
  TIPOS_RATEIO
} = require('../domain/RateioPerda');

let passou = 0;
let falhou = 0;

function test(nome, fn) {
  try {
    fn();
    passou += 1;
    console.log(`  OK  ${nome}`);
  } catch (err) {
    falhou += 1;
    console.error(`  FALHOU  ${nome}\n         ${err.message}`);
  }
}

console.log('\nRC4.2 — Rateio Inteligente de Perdas\n');

test('Cliente assume 100%', () => {
  const r = calcularRateio(TIPOS_RATEIO.CLIENTE, 20);
  assert.strictEqual(r.valorCliente, 20);
  assert.strictEqual(r.valorEmpresa, 0);
  assert.strictEqual(r.percentualCliente, 100);
  assert.strictEqual(r.percentualEmpresa, 0);
  assert.strictEqual(validarRateio({ ...r, motivoPerda: 'QUEBRA' }).ok, true);
});

test('Empresa assume 100%', () => {
  const r = calcularRateio(TIPOS_RATEIO.EMPRESA, 20);
  assert.strictEqual(r.valorCliente, 0);
  assert.strictEqual(r.valorEmpresa, 20);
  assert.strictEqual(r.percentualCliente, 0);
  assert.strictEqual(r.percentualEmpresa, 100);
});

test('Compartilhado — digitação pelo campo Cliente', () => {
  const r = calcularRateio(TIPOS_RATEIO.COMPARTILHADA, 20, {
    valorCliente: 8,
    campoEditado: 'cliente'
  });
  assert.strictEqual(r.valorCliente, 8);
  assert.strictEqual(r.valorEmpresa, 12);
  assert.strictEqual(r.percentualCliente, 40);
  assert.strictEqual(r.percentualEmpresa, 60);
});

test('Compartilhado — digitação pelo campo Empresa', () => {
  const r = calcularRateio(TIPOS_RATEIO.COMPARTILHADA, 20, {
    valorEmpresa: 5,
    campoEditado: 'empresa'
  });
  assert.strictEqual(r.valorCliente, 15);
  assert.strictEqual(r.valorEmpresa, 5);
  assert.strictEqual(r.percentualCliente, 75);
  assert.strictEqual(r.percentualEmpresa, 25);
});

test('Validação dos totais — soma diferente rejeita', () => {
  const v = validarRateio({
    tipoRateio: TIPOS_RATEIO.COMPARTILHADA,
    valorTotalPerdas: 20,
    valorCliente: 10,
    valorEmpresa: 5,
    motivoPerda: 'FURTO'
  });
  assert.strictEqual(v.ok, false);
});

test('Validação — soma igual aceita', () => {
  const v = validarRateio({
    tipoRateio: TIPOS_RATEIO.COMPARTILHADA,
    valorTotalPerdas: 20,
    valorCliente: 8,
    valorEmpresa: 12,
    motivoPerda: 'DERRETIMENTO'
  });
  assert.strictEqual(v.ok, true);
});

test('Percentuais automáticos', () => {
  const r = calcularRateio(TIPOS_RATEIO.COMPARTILHADA, 50, {
    valorCliente: 12.5,
    campoEditado: 'cliente'
  });
  assert.strictEqual(r.percentualCliente, 25);
  assert.strictEqual(r.percentualEmpresa, 75);
});

test('Motivo da perda obrigatório', () => {
  const v = validarRateio({
    tipoRateio: TIPOS_RATEIO.CLIENTE,
    valorTotalPerdas: 20,
    valorCliente: 20,
    valorEmpresa: 0
  });
  assert.strictEqual(v.ok, false);
});

test('Motivo OUTRO exige observação', () => {
  assert.strictEqual(validarRateio({
    tipoRateio: TIPOS_RATEIO.CLIENTE,
    valorTotalPerdas: 20,
    valorCliente: 20,
    valorEmpresa: 0,
    motivoPerda: 'OUTRO',
    observacaoPerda: ''
  }).ok, false);
  assert.strictEqual(validarRateio({
    tipoRateio: TIPOS_RATEIO.CLIENTE,
    valorTotalPerdas: 20,
    valorCliente: 20,
    valorEmpresa: 0,
    motivoPerda: 'OUTRO',
    observacaoPerda: 'Produto danificado'
  }).ok, true);
});

test('Resumo financeiro', () => {
  const r = buildResumoFinanceiroRateio({
    valorVenda: 100,
    valorRecebido: 40,
    valorPerdas: 20,
    valorCliente: 8,
    valorEmpresa: 12
  });
  assert.strictEqual(r.perdas, 20);
  assert.strictEqual(r.clienteAssume, 8);
  assert.strictEqual(r.empresaAssume, 12);
  assert.strictEqual(r.valorLiquidoConsignado, 68);
});

console.log(`\nResultado: ${passou} ok, ${falhou} falha(s)\n`);
process.exit(falhou > 0 ? 1 : 0);
