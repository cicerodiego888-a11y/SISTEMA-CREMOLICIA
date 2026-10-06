/**
 * Testes — Máquina de estados da Central de Entradas (Sprint 2)
 * Executar: npm run test:central-entradas-estados
 */

const assert = require('assert');
const { DocumentoFiscalStatus } = require('../../backend/motores/central-entradas/core/DocumentoFiscalStatus');
const {
  podeTransicionar,
  validarTransicao
} = require('../../backend/motores/central-entradas/core/MaquinaEstadosDocumento');

let passou = 0;
let falhou = 0;

function test(nome, fn) {
  try {
    fn();
    passou += 1;
    console.log(`  OK  ${nome}`);
  } catch (error) {
    falhou += 1;
    console.error(`  FALHOU  ${nome}`);
    console.error(`         ${error.message}`);
  }
}

console.log('\n=== Testes Máquina de Estados — Central de Entradas ===\n');

test('SINCRONIZADA → EM_PROCESSAMENTO é permitida', () => {
  assert.strictEqual(
    podeTransicionar(DocumentoFiscalStatus.SINCRONIZADA, DocumentoFiscalStatus.EM_PROCESSAMENTO),
    true
  );
});

test('SINCRONIZADA → GRAVADA é bloqueada', () => {
  const resultado = validarTransicao(
    DocumentoFiscalStatus.SINCRONIZADA,
    DocumentoFiscalStatus.GRAVADA
  );
  assert.strictEqual(resultado.valido, false);
});

test('GRAVADA é terminal e não transiciona', () => {
  const resultado = validarTransicao(
    DocumentoFiscalStatus.GRAVADA,
    DocumentoFiscalStatus.SINCRONIZADA
  );
  assert.strictEqual(resultado.valido, false);
});

test('ERRO → SINCRONIZADA permite reprocessamento', () => {
  assert.strictEqual(
    podeTransicionar(DocumentoFiscalStatus.ERRO, DocumentoFiscalStatus.SINCRONIZADA),
    true
  );
});

test('mesmo status é idempotente', () => {
  const resultado = validarTransicao(
    DocumentoFiscalStatus.PRONTA_PARA_COMPRA,
    DocumentoFiscalStatus.PRONTA_PARA_COMPRA
  );
  assert.strictEqual(resultado.valido, true);
});

test('ERRO_RECUPERACAO → AGUARDANDO_XML permite retry', () => {
  assert.strictEqual(
    podeTransicionar(DocumentoFiscalStatus.ERRO_RECUPERACAO, DocumentoFiscalStatus.AGUARDANDO_XML),
    true
  );
});

test('AGUARDANDO_XML → XML_RECUPERANDO é permitida', () => {
  assert.strictEqual(
    podeTransicionar(DocumentoFiscalStatus.AGUARDANDO_XML, DocumentoFiscalStatus.XML_RECUPERANDO),
    true
  );
});

console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
process.exit(falhou > 0 ? 1 : 0);
