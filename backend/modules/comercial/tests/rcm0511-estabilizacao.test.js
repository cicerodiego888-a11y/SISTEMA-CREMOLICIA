/**
 * RCM-05.11 — Regressões de estabilização (Kits + grade comercial)
 */

const assert = require('assert');
const path = require('path');

const KitService = require(path.join(__dirname, '../kits/KitService'));
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

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

async function run() {
  await whenReady();
  await bootstrapComercialV2Schema(db);

  // 1) Grade de tabela sempre lista canais ativos (não trava / não exige N fixo)
  const canais = await canaisService.listar({ ativos: '1' });
  assert.ok(canais.length >= 2, 'canais ativos');
  const grade = await tabelasService.gradeNova();
  assert.strictEqual(grade.valores.length, canais.length, 'grade = canais ativos');

  // 2) Kit não pode sequestrar produto comum pelo código
  const codigo = `AUD${Date.now()}`;
  const prod = await dbRun(
    `INSERT INTO produtos (nome, codigo, preco_venda, estoque_atual, ativo, unidade)
     VALUES (?, ?, 12, 50, 1, 'UN')`,
    [`Produto Comum ${codigo}`, codigo]
  );
  const itemA = await dbRun(
    `INSERT INTO produtos (nome, codigo, preco_venda, estoque_atual, ativo, unidade)
     VALUES (?, ?, 5, 50, 1, 'UN')`,
    [`Comp A ${codigo}`, `CA${codigo}`]
  );

  let bloqueou = false;
  try {
    await KitService.criar({
      codigo,
      descricao: 'Kit conflito',
      tipo_formacao: 'FIXO',
      preco: 20,
      itens: [{ produto_id: itemA.lastID, quantidade: 1 }]
    });
  } catch (e) {
    bloqueou = /código|conflito|comum/i.test(e.message || '');
  }
  assert.ok(bloqueou, 'bloqueia código de produto comum');

  // 3) Kit válido exige itens
  let semItens = false;
  try {
    await KitService.criar({
      codigo: `KITVAZIO${Date.now()}`,
      descricao: 'Vazio',
      tipo_formacao: 'FIXO',
      preco: 1,
      itens: []
    });
  } catch (_) {
    semItens = true;
  }
  assert.ok(semItens, 'kit sem itens bloqueado');

  void prod;
  console.log('RCM-05.11 OK — estabilização');
}

run().catch((err) => {
  console.error('RCM-05.11 FALHOU:', err);
  process.exit(1);
});
