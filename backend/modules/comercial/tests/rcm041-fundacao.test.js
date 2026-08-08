/**
 * RCM-04.1 — Testes de contrato da Fundação Comercial V2
 * (Canais de Venda + Tabelas de Preço — sem impacto em preço operacional)
 */

const assert = require('assert');
const path = require('path');

const canaisService = require(path.join(__dirname, '../canais/CanaisVendaService'));
const tabelasService = require(path.join(__dirname, '../tabelas-preco/TabelasPrecoService'));
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

  const canais = await canaisService.listar();
  const codigos = canais.map((c) => String(c.codigo).toUpperCase());
  assert.ok(codigos.includes('VAREJO'), 'seed VAREJO');
  assert.ok(codigos.includes('ATACADO'), 'seed ATACADO');
  assert.ok(codigos.includes('EVENTO'), 'seed EVENTO');

  const suffix = Date.now().toString(36).toUpperCase();
  const tabela = await tabelasService.criar({
    codigo: `TST_${suffix}`,
    nome: `Tabela Teste ${suffix}`,
    descricao: 'RCM-04.1',
    ativo: true
  });
  assert.ok(tabela.id, 'tabela criada');

  const canalVarejo = canais.find((c) => String(c.codigo).toUpperCase() === 'VAREJO');
  const canalAtacado = canais.find((c) => String(c.codigo).toUpperCase() === 'ATACADO');

  const valores = await tabelasService.salvarValores(tabela.id, [
    { canal_venda_id: canalVarejo.id, preco: 10.5 },
    { canal_venda_id: canalAtacado.id, preco: 8.0 }
  ]);
  // montarGradeValores retorna TODOS os canais ativos (ex.: +EVENTO) — filtrar com preço
  const comPreco = (valores || []).filter((v) => v.preco != null);
  assert.strictEqual(comPreco.length, 2, 'dois valores salvos');

  const listados = await tabelasService.listarValores(tabela.id);
  assert.strictEqual(
    (listados || []).filter((v) => v.preco != null).length,
    2,
    'dois valores listados com preço'
  );
  assert.ok(listados.length >= 2, 'grade inclui canais ativos');

  await tabelasService.excluir(tabela.id);
  const apos = await tabelasService.buscarPorId(tabela.id);
  assert.strictEqual(apos, null, 'tabela excluída');

  let bloqueou = false;
  try {
    await canaisService.excluir(canalVarejo.id);
  } catch (e) {
    bloqueou = true;
    assert.ok(/sistema/i.test(e.message), 'bloqueio de canal sistema');
  }
  assert.ok(bloqueou, 'não permite excluir canal seed');

  console.log('✔ RCM-04.1 Fundação Comercial V2 — OK');
  process.exit(0);
}

run().catch((err) => {
  console.error('✖ RCM-04.1 falhou:', err);
  process.exit(1);
});
