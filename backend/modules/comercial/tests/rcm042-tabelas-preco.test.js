/**
 * RCM-04.2 — Cadastro completo de Tabelas de Preço
 */

const assert = require('assert');
const path = require('path');

const tabelasService = require(path.join(__dirname, '../tabelas-preco/TabelasPrecoService'));
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

function runSql(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

async function run() {
  await whenReady();
  await bootstrapComercialV2Schema(db);

  const suffix = Date.now().toString(36).toUpperCase();
  const canais = await canaisService.listar({ ativos: '1' });
  assert.ok(canais.length >= 3, 'canais ativos');

  const canalVarejo = canais.find((c) => String(c.codigo).toUpperCase() === 'VAREJO');
  const canalAtacado = canais.find((c) => String(c.codigo).toUpperCase() === 'ATACADO');

  // Criar tabela + valores em uma operação
  const tabela = await tabelasService.criar({
    codigo: `RC42_${suffix}`,
    nome: `Tabela RC42 ${suffix}`,
    descricao: 'teste',
    ativo: true,
    valores: [
      { canal_venda_id: canalVarejo.id, preco: 2.5 },
      { canal_venda_id: canalAtacado.id, preco: 2.0 }
    ]
  });
  assert.ok(tabela.id, 'tabela criada');
  assert.ok(Array.isArray(tabela.valores), 'retorna grade');
  assert.ok(tabela.valores.length >= 3, 'grade com todos canais ativos');

  const varejoLinha = tabela.valores.find((v) => v.canal_venda_id === canalVarejo.id);
  assert.strictEqual(Number(varejoLinha.preco), 2.5);

  // Nome duplicado
  let bloqueouNome = false;
  try {
    await tabelasService.criar({
      codigo: `RC42B_${suffix}`,
      nome: `Tabela RC42 ${suffix}`,
      valores: []
    });
  } catch (e) {
    bloqueouNome = /nome/i.test(e.message);
  }
  assert.ok(bloqueouNome, 'bloqueia nome duplicado');

  // Preço negativo
  let bloqueouNeg = false;
  try {
    await tabelasService.atualizar(tabela.id, {
      valores: [{ canal_venda_id: canalVarejo.id, preco: -1 }]
    });
  } catch (e) {
    bloqueouNeg = /negativo/i.test(e.message);
  }
  assert.ok(bloqueouNeg, 'bloqueia preço negativo');

  // Canais duplicados
  let bloqueouDup = false;
  try {
    await tabelasService.atualizar(tabela.id, {
      valores: [
        { canal_venda_id: canalVarejo.id, preco: 1 },
        { canal_venda_id: canalVarejo.id, preco: 2 }
      ]
    });
  } catch (e) {
    bloqueouDup = /duplicad/i.test(e.message);
  }
  assert.ok(bloqueouDup, 'bloqueia canais duplicados');

  // Novo canal aparece na grade mesmo sem preço
  const canalNovo = await canaisService.criar({
    codigo: `DELIV_${suffix}`,
    nome: `Delivery ${suffix}`,
    ativo: true
  });
  const completa = await tabelasService.buscarPorId(tabela.id);
  const linhaNova = completa.valores.find((v) => v.canal_venda_id === canalNovo.id);
  assert.ok(linhaNova, 'novo canal na grade');
  assert.strictEqual(linhaNova.preco, null, 'sem preço ainda');

  // Exclusão bloqueada se vinculada a produto
  await runSql(
    `UPDATE produtos SET tabela_preco_id = ? WHERE id = (
      SELECT id FROM produtos ORDER BY id DESC LIMIT 1
    )`,
    [tabela.id]
  );

  let bloqueouExcluir = false;
  try {
    await tabelasService.excluir(tabela.id);
  } catch (e) {
    bloqueouExcluir = /utilizada por um ou mais produtos/i.test(e.message);
    assert.strictEqual(e.permite_desativar, true);
  }
  assert.ok(bloqueouExcluir, 'bloqueia exclusão vinculada');

  const desativada = await tabelasService.desativar(tabela.id);
  assert.strictEqual(desativada.ativo, false, 'permite desativar');

  // limpeza do vínculo e canal de teste
  await runSql('UPDATE produtos SET tabela_preco_id = NULL WHERE tabela_preco_id = ?', [tabela.id]);
  await canaisService.excluir(canalNovo.id);
  await tabelasService.excluir(tabela.id);

  console.log('✔ RCM-04.2 Cadastro Completo Tabelas de Preço — OK');
  process.exit(0);
}

run().catch((err) => {
  console.error('✖ RCM-04.2 falhou:', err);
  process.exit(1);
});
