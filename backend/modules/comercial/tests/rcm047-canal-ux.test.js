/**
 * RCM-04.7 — UX Canal de Venda (progresso na resposta do resolver)
 * Regras de negócio inalteradas; apenas metadados.
 */

const assert = require('assert');
const path = require('path');

const CanalVendaResolver = require(path.join(__dirname, '../preco/CanalVendaResolver'));
const configuracaoService = require(path.join(__dirname, '../configuracao/ConfiguracaoComercialService'));
const canaisService = require(path.join(__dirname, '../canais/CanaisVendaService'));
const { bootstrapComercialV2Schema } = require(path.join(__dirname, '../index'));
const db = require(path.join(__dirname, '../../../database'));

function whenReady() {
  return new Promise((resolve, reject) => {
    if (typeof db.whenReady === 'function') {
      db.whenReady((err) => (err ? reject(err) : resolve()));
      return;
    }
    setTimeout(resolve, 500);
  });
}

async function run() {
  await whenReady();
  await bootstrapComercialV2Schema(db);

  const canais = await canaisService.listar({ ativos: '1' });
  const atacado = canais.find((c) => String(c.codigo).toUpperCase() === 'ATACADO');
  assert.ok(atacado, 'canal ATACADO');

  await configuracaoService.salvar({
    atacado_habilitado: true,
    quantidade_minima: 30,
    tipo_contagem: 'TOTAL_VENDA',
    permitir_produtos_diferentes: true,
    permitir_categorias_diferentes: true,
    canal_atacado_id: atacado.id
  });

  const parcial = await CanalVendaResolver.resolver({
    itens: [{ produto_id: 1, quantidade: 18 }]
  });
  assert.strictEqual(parcial.canal, 'VAREJO');
  assert.strictEqual(parcial.quantidadeAtual, 18);
  assert.strictEqual(parcial.quantidadeNecessaria, 30);
  assert.strictEqual(parcial.progresso, 60);
  assert.strictEqual(parcial.mostrar_progresso, true);
  assert.ok(parcial.nome);

  const completo = await CanalVendaResolver.resolver({
    itens: [{ produto_id: 1, quantidade: 30 }]
  });
  assert.strictEqual(completo.canal, 'ATACADO');
  assert.strictEqual(completo.quantidadeAtual, 30);
  assert.strictEqual(completo.quantidadeNecessaria, 30);
  assert.strictEqual(completo.progresso, 100);
  assert.strictEqual(completo.mostrar_progresso, false);
  assert.strictEqual(completo.atacado, true);

  const reverso = await CanalVendaResolver.resolver({
    itens: [{ produto_id: 1, quantidade: 28 }]
  });
  assert.strictEqual(reverso.canal, 'VAREJO');
  assert.strictEqual(reverso.progresso, 93); // 28/30 ≈ 93.33 → 93
  assert.strictEqual(reverso.mostrar_progresso, true);

  await configuracaoService.salvar({
    atacado_habilitado: false,
    quantidade_minima: 30,
    tipo_contagem: 'TOTAL_VENDA',
    permitir_produtos_diferentes: true,
    permitir_categorias_diferentes: true,
    canal_atacado_id: atacado.id
  });

  const off = await CanalVendaResolver.resolver({
    itens: [{ produto_id: 1, quantidade: 100 }]
  });
  assert.strictEqual(off.canal, 'VAREJO');
  assert.strictEqual(off.mostrar_progresso, false);
  assert.strictEqual(off.motivo, 'atacado_desabilitado');

  // anexarProgressoUx unitário
  const meta = CanalVendaResolver.anexarProgressoUx(
    { canal: 'VAREJO', atacado: false, quantidade_avaliada: 15 },
    { atacado_habilitado: true, quantidade_minima: 30 }
  );
  assert.strictEqual(meta.quantidadeAtual, 15);
  assert.strictEqual(meta.quantidadeNecessaria, 30);
  assert.strictEqual(meta.progresso, 50);

  console.log('RCM-04.7 OK');
}

run().catch((err) => {
  console.error('RCM-04.7 FALHOU:', err);
  process.exit(1);
});
