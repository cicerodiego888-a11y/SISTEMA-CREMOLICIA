/**
 * RCM-9.0.2 — Homologação final da contagem Atacado + UX
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const CanalVendaResolver = require('../preco/CanalVendaResolver');
const { contribuicaoContagemAtacado } = CanalVendaResolver;
const ComercialStatusCard = require('../../../../frontend/shared/js/ComercialStatusCard');

function test(nome, fn) {
  try {
    fn();
    console.log(`  OK  ${nome}`);
  } catch (e) {
    console.error(`  FAIL ${nome}`);
    throw e;
  }
}

async function testAsync(nome, fn) {
  try {
    await fn();
    console.log(`  OK  ${nome}`);
  } catch (e) {
    console.error(`  FAIL ${nome}`);
    throw e;
  }
}

function totalComercial(itens) {
  return CanalVendaResolver.filtrarElegiveisAtacado(
    CanalVendaResolver.normalizarItens(itens)
  ).reduce((a, i) => a + contribuicaoContagemAtacado(i), 0);
}

const CFG = {
  atacado_habilitado: true,
  quantidade_minima: 30,
  tipo_contagem: 'TOTAL_VENDA',
  permitir_produtos_diferentes: true,
  permitir_categorias_diferentes: true
};

async function run() {
  console.log('RCM-9.0.2 — Homologação Contagem Atacado\n');

  test('UX: label compacta Itens Comerciais (inteiros)', () => {
    const label = ComercialStatusCard.formatLabelProgresso(29.25, 30, true);
    assert.strictEqual(label, '29 / 30 Itens Comerciais');
    assert.ok(!label.includes(','));
    assert.ok(!label.includes('29,25'));
  });

  test('UX: label default "de … Itens para Atacado"', () => {
    const label = ComercialStatusCard.formatLabelProgresso(29, 30, false);
    assert.strictEqual(label, '29 de 30 Itens para Atacado');
  });

  test('UX: normalizeState arredonda quantidadeAtual', () => {
    const st = ComercialStatusCard.normalizeState({
      canal: 'VAREJO',
      quantidadeAtual: 29.25,
      quantidadeNecessaria: 30,
      atacado_habilitado: true
    });
    assert.strictEqual(st.quantidadeAtual, 29);
  });

  test('Cenário: 30 picolés → 30', () => {
    assert.strictEqual(totalComercial([
      { produto_id: 1, quantidade: 30, participa_atacado: 1, forma_comercializacao: 'UNIDADE' }
    ]), 30);
  });

  test('Cenário: 29 picolés + 1 pote 0,250 KG → 30', () => {
    assert.strictEqual(totalComercial([
      { produto_id: 1, quantidade: 29, participa_atacado: 1, forma_comercializacao: 'UNIDADE' },
      { produto_id: 2, quantidade: 0.25, participa_atacado: 1, forma_comercializacao: 'PESO' }
    ]), 30);
  });

  test('Cenário: 28 picolés + 2 potes → 30', () => {
    assert.strictEqual(totalComercial([
      { produto_id: 1, quantidade: 28, participa_atacado: 1, forma_comercializacao: 'UNIDADE' },
      { produto_id: 2, quantidade: 0.25, participa_atacado: 1, forma_comercializacao: 'PESO' },
      { produto_id: 3, quantidade: 0.3, participa_atacado: 1, forma_comercializacao: 'PESO' }
    ]), 30);
  });

  test('Cenário: 30 potes → 30', () => {
    const itens = [];
    for (let i = 0; i < 30; i += 1) {
      itens.push({
        produto_id: 100 + i,
        quantidade: 0.25,
        participa_atacado: 1,
        forma_comercializacao: 'PESO'
      });
    }
    assert.strictEqual(totalComercial(itens), 30);
  });

  test('Cenário: 29 picolés → 29 (não atinge)', () => {
    assert.strictEqual(totalComercial([
      { produto_id: 1, quantidade: 29, participa_atacado: 1, forma_comercializacao: 'UNIDADE' }
    ]), 29);
  });

  await testAsync('Resolver: 30 picolés → quantidade_avaliada 30', async () => {
    const r = await CanalVendaResolver.resolver({
      config: CFG,
      itens: [
        { produto_id: 91001, quantidade: 30, participa_atacado: 1, forma_comercializacao: 'UNIDADE' }
      ]
    });
    assert.strictEqual(Number(r.quantidade_avaliada), 30);
  });

  await testAsync('Resolver: 29+pote → 30', async () => {
    const r = await CanalVendaResolver.resolver({
      config: CFG,
      itens: [
        { produto_id: 91002, quantidade: 29, participa_atacado: 1, forma_comercializacao: 'UNIDADE' },
        { produto_id: 91003, quantidade: 0.25, participa_atacado: 1, forma_comercializacao: 'PESO' }
      ]
    });
    assert.strictEqual(Number(r.quantidade_avaliada), 30);
  });

  await testAsync('Resolver: 28+2 potes → 30', async () => {
    const r = await CanalVendaResolver.resolver({
      config: CFG,
      itens: [
        { produto_id: 91004, quantidade: 28, participa_atacado: 1, forma_comercializacao: 'UNIDADE' },
        { produto_id: 91005, quantidade: 0.2, participa_atacado: 1, forma_comercializacao: 'PESO' },
        { produto_id: 91006, quantidade: 0.4, participa_atacado: 1, forma_comercializacao: 'VOLUME' }
      ]
    });
    assert.strictEqual(Number(r.quantidade_avaliada), 30);
  });

  await testAsync('Resolver: 29 picolés → 29', async () => {
    const r = await CanalVendaResolver.resolver({
      config: CFG,
      itens: [
        { produto_id: 91007, quantidade: 29, participa_atacado: 1, forma_comercializacao: 'UNIDADE' }
      ]
    });
    assert.strictEqual(Number(r.quantidade_avaliada), 29);
  });

  test('PDV contém log RCM-9.0.2', () => {
    const pdv = fs.readFileSync(
      path.join(__dirname, '../../../../frontend/pdv/js/pdv.js'),
      'utf8'
    );
    assert.ok(pdv.includes('[RCM-9.0.2][ATACADO]'));
    assert.ok(pdv.includes('Origem: Contagem Comercial'));
    assert.ok(pdv.includes('logHomologacaoAtacadoRcm902'));
  });

  test('Card não exibe "unidades" físicas no progresso', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../../../frontend/shared/js/ComercialStatusCard.js'),
      'utf8'
    );
    assert.ok(src.includes('Itens Comerciais'));
    assert.ok(src.includes('Itens para Atacado'));
    assert.ok(!src.includes('unidades`'));
  });

  console.log('\nRCM-9.0.2 OK');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
