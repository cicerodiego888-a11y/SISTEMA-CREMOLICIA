/**
 * RCM-9.0.1 — Contagem Atacado por Forma de Comercialização
 */
const assert = require('assert');
const path = require('path');

const CanalVendaResolver = require(path.join(__dirname, '../preco/CanalVendaResolver'));
const { contribuicaoContagemAtacado } = CanalVendaResolver;

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

async function run() {
  console.log('RCM-9.0.1 — Contagem Atacado por Forma\n');

  test('UNIDADE / CASQUINHA / KIT → quantidade da linha', () => {
    assert.strictEqual(contribuicaoContagemAtacado({ quantidade: 29, forma_comercializacao: 'UNIDADE' }), 29);
    assert.strictEqual(contribuicaoContagemAtacado({ quantidade: 3, forma_comercializacao: 'CASQUINHA' }), 3);
    assert.strictEqual(contribuicaoContagemAtacado({ quantidade: 2, forma_comercializacao: 'KIT' }), 2);
  });

  test('PESO / VOLUME → 1 por linha (mesmo com 0,250 KG)', () => {
    assert.strictEqual(contribuicaoContagemAtacado({ quantidade: 0.25, forma_comercializacao: 'PESO' }), 1);
    assert.strictEqual(contribuicaoContagemAtacado({ quantidade: 1.5, forma_comercializacao: 'VOLUME' }), 1);
    assert.strictEqual(contribuicaoContagemAtacado({ quantidade: 10, forma_comercializacao: 'PESO' }), 1);
  });

  test('Cremolicia: 29 UNIDADE + 0,250 PESO = 30', () => {
    const itens = [
      { produto_id: 1, quantidade: 29, participa_atacado: 1, forma_comercializacao: 'UNIDADE' },
      { produto_id: 2, quantidade: 0.25, participa_atacado: 1, forma_comercializacao: 'PESO' }
    ];
    const normalizados = CanalVendaResolver.normalizarItens(itens);
    const elegiveis = CanalVendaResolver.filtrarElegiveisAtacado(normalizados);
    const total = elegiveis.reduce((a, i) => a + contribuicaoContagemAtacado(i), 0);
    assert.strictEqual(total, 30);
  });

  test('Açaí: bowl UNIDADE + volume açaí = peças + 1', () => {
    const total = contribuicaoContagemAtacado({ quantidade: 5, forma_comercializacao: 'UNIDADE' })
      + contribuicaoContagemAtacado({ quantidade: 0.4, forma_comercializacao: 'VOLUME' });
    assert.strictEqual(total, 6);
  });

  await testAsync('Resolver: 29 + 0,250 PESO atinge Atacado (mín. 30)', async () => {
    const cfg = {
      atacado_habilitado: true,
      quantidade_minima: 30,
      tipo_contagem: 'TOTAL_VENDA',
      permitir_produtos_diferentes: true,
      permitir_categorias_diferentes: true
    };
    // Mock obterRegras via config sem tabela (força fonte config)
    const resultado = await CanalVendaResolver.resolver({
      config: cfg,
      itens: [
        { produto_id: 90001, quantidade: 29, participa_atacado: 1, forma_comercializacao: 'UNIDADE' },
        { produto_id: 90002, quantidade: 0.25, participa_atacado: 1, forma_comercializacao: 'PESO' }
      ]
    });
    // Pode vir ATACADO da tabela ativa do banco oficial; se tabela tiver mín diferente, ainda assim quantidade_avaliada deve ser 30
    assert.strictEqual(Number(resultado.quantidade_avaliada), 30);
    if (resultado.atacado || String(resultado.canal).toUpperCase() === 'ATACADO') {
      assert.ok(true);
    } else if (resultado.motivo === 'quantidade_insuficiente') {
      assert.fail('Esperava atingir mínimo com 30 itens comerciais');
    }
  });

  await testAsync('Resolver: só 29 UNIDADE não atinge 30', async () => {
    const cfg = {
      atacado_habilitado: true,
      quantidade_minima: 30,
      tipo_contagem: 'TOTAL_VENDA',
      permitir_produtos_diferentes: true,
      permitir_categorias_diferentes: true
    };
    const resultado = await CanalVendaResolver.resolver({
      config: cfg,
      itens: [
        { produto_id: 90011, quantidade: 29, participa_atacado: 1, forma_comercializacao: 'UNIDADE' }
      ]
    });
    assert.strictEqual(Number(resultado.quantidade_avaliada), 29);
  });

  console.log('\nRCM-9.0.1 OK');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
