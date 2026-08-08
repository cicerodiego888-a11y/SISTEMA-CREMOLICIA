/**
 * RCM-04.3 — Integração Produto × Tabela de Preço + ComercialPrecoResolver
 */

const assert = require('assert');
const path = require('path');

const ComercialPrecoResolver = require(path.join(__dirname, '../preco/ComercialPrecoResolver'));
const Forma = require(path.join(__dirname, '../preco/FormaComercializacao'));
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

  const resolvido = await ComercialPrecoResolver.resolver({
    produto: { preco_venda: 9.9, tabela_preco_id: 7 }
  });
  assert.strictEqual(resolvido.preco_venda, 9.9);
  assert.strictEqual(resolvido.origem, 'produto.preco_venda');
  assert.strictEqual(resolvido.tabela_preco_id, 7);

  assert.strictEqual(
    ComercialPrecoResolver.obterPrecoVenda({ preco_venda: 3.5 }),
    3.5
  );

  assert.strictEqual(
    Forma.inferirFormaComercializacao({ produto_fracionado: 1, unidade: 'kg' }),
    'PESO'
  );
  assert.strictEqual(
    Forma.inferirFormaComercializacao({ produto_fracionado: 1, unidade: 'l' }),
    'VOLUME'
  );
  assert.strictEqual(
    Forma.inferirFormaComercializacao({ produto_fracionado: 0 }),
    'UNIDADE'
  );

  const casquinha = Forma.normalizarPayloadForma({
    forma_comercializacao: 'CASQUINHA',
    quantidade_bolas: 2,
    peso_medio_bola: 80
  });
  assert.strictEqual(casquinha.forma_comercializacao, 'CASQUINHA');
  assert.strictEqual(casquinha.quantidade_bolas, 2);

  let bloqueou = false;
  try {
    Forma.normalizarPayloadForma({ forma_comercializacao: 'PESO' });
  } catch (e) {
    bloqueou = /Unidade de Venda/i.test(e.message);
  }
  assert.ok(bloqueou, 'PESO exige unidade_venda');

  // coluna forma_comercializacao existe
  const col = await new Promise((resolve, reject) => {
    db.all('PRAGMA table_info(produtos)', (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
  assert.ok(col.some((c) => c.name === 'forma_comercializacao'), 'coluna forma_comercializacao');
  assert.ok(col.some((c) => c.name === 'quantidade_bolas'), 'coluna quantidade_bolas');

  console.log('✔ RCM-04.3 Integração Produto × Tabela de Preço — OK');
  process.exit(0);
}

run().catch((err) => {
  console.error('✖ RCM-04.3 falhou:', err);
  process.exit(1);
});
