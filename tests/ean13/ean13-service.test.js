/**
 * Testes — EAN13Service (cadastro de produtos)
 * Executar: npm run test:ean13
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ean13 = require('../../backend/services/ean13/EAN13Service');

let passou = 0;
let falhou = 0;

function test(nome, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passou += 1;
      console.log(`  OK  ${nome}`);
    })
    .catch((error) => {
      falhou += 1;
      console.error(`  FALHOU  ${nome}`);
      console.error(`         ${error.message}`);
    });
}

async function main() {
  console.log('\n=== Testes EAN13Service ===\n');

  await test('TESTE 1 — gerar código com 13 dígitos e prefixo 789', () => {
    const codigo = ean13.generate();
    assert.strictEqual(codigo.length, 13);
    assert.match(codigo, /^\d{13}$/);
    assert.ok(codigo.startsWith('789'));
  });

  await test('TESTE 2 — código gerado é válido', () => {
    const codigo = ean13.generate();
    assert.strictEqual(ean13.validate(codigo), true);
  });

  await test('TESTE 3 — alterar último dígito invalida', () => {
    const base = '7891234567895';
    assert.strictEqual(ean13.validate(base), true);
    const errado = base.slice(0, 12) + String((Number(base[12]) + 1) % 10);
    assert.strictEqual(ean13.validate(errado), false);
  });

  await test('TESTE 4 — código com letras é inválido', () => {
    assert.strictEqual(ean13.validate('78912345678A5'), false);
    assert.strictEqual(ean13.validate('ABCDEFGHIJKLM'), false);
  });

  await test('TESTE 5 — menos de 13 dígitos é inválido', () => {
    assert.strictEqual(ean13.validate('789123456789'), false);
  });

  await test('TESTE 6 — mais de 13 dígitos é inválido', () => {
    assert.strictEqual(ean13.validate('78912345678951'), false);
  });

  await test('dígito verificador do exemplo 789123456789 = 5', () => {
    assert.strictEqual(ean13.calculateCheckDigit('789123456789'), 5);
    assert.strictEqual(ean13.validate('7891234567895'), true);
  });

  await test('TESTE 7 — vários códigos sem duplicidade', async () => {
    const vistos = new Set();
    for (let i = 0; i < 40; i += 1) {
      const codigo = await ean13.generateUnique(null, {
        exists: async (code) => vistos.has(code)
      });
      assert.strictEqual(ean13.validate(codigo), true);
      assert.strictEqual(vistos.has(codigo), false);
      vistos.add(codigo);
    }
    assert.strictEqual(vistos.size, 40);
  });

  await test('TESTE 8 — produto com código não é substituído sem confirmação (UI)', () => {
    const prodJs = fs.readFileSync(path.join(__dirname, '../../frontend/erp/js/produtos.js'), 'utf8');
    assert.ok(prodJs.includes('Este produto já possui um código de barras.'));
    assert.ok(prodJs.includes('Deseja gerar um novo código?'));
    assert.ok(prodJs.includes('confirmarSubstituicaoEan13'));
    assert.ok(prodJs.includes('Gerar EAN-13'));
    assert.ok(prodJs.includes('Imprimir etiqueta'));
    const eanUi = fs.readFileSync(path.join(__dirname, '../../frontend/shared/js/ean13.js'), 'utf8');
    assert.ok(eanUi.includes('MSG_CONFIRMA_SUBSTITUIR'));
  });

  await test('TESTE 9 — código manual duplicado é rejeitado', async () => {
    const codigo = '7891234567895';
    await assert.rejects(
      () => ean13.validarParaPersistencia(codigo, {
        produtoId: 2,
        exists: async () => true
      }),
      (err) => err.message === ean13.MSG_DUPLICADO && err.statusCode === 409
    );
  });

  await test('TESTE 10 — código manual válido é aceito', async () => {
    const codigo = '7891234567895';
    const gravar = await ean13.validarParaPersistencia(` ${codigo} `, {
      produtoId: null,
      exists: async () => false
    });
    assert.strictEqual(gravar, codigo);
  });

  await test('campo vazio continua permitido', async () => {
    const gravar = await ean13.validarParaPersistencia('   ', { exists: async () => true });
    assert.strictEqual(gravar, '');
  });

  await test('código legado inalterado não é rejeitado', async () => {
    const gravar = await ean13.validarParaPersistencia('0001', {
      codigoAtual: '0001',
      produtoId: 9,
      exists: async () => false
    });
    assert.strictEqual(gravar, '0001');
  });

  await test('rotas de produto geram e validam EAN-13 no campo existente', () => {
    const rotas = fs.readFileSync(path.join(__dirname, '../../backend/rotas/produtos.js'), 'utf8');
    assert.ok(rotas.includes("ean13Service"));
    assert.ok(rotas.includes('/codigo-barras/gerar'));
    assert.ok(rotas.includes('validarParaPersistencia'));
    assert.ok(rotas.includes('codigoBarrasGravar'));
  });

  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  process.exit(falhou ? 1 : 0);
}

main();
