/**
 * RCM-04.4 — Motor Comercial V2 (Tabela de Preço via ComercialPrecoResolver)
 */

const assert = require('assert');
const path = require('path');

const ComercialPrecoResolver = require(path.join(__dirname, '../preco/ComercialPrecoResolver'));
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

async function run() {
  ComercialPrecoResolver.setLogsHabilitados(false);
  await whenReady();
  await bootstrapComercialV2Schema(db);

  const suffix = Date.now().toString(36).toUpperCase();
  const canais = await canaisService.listar({ ativos: '1' });
  const varejo = canais.find((c) => String(c.codigo).toUpperCase() === 'VAREJO');
  assert.ok(varejo, 'canal VAREJO');

  const tabela = await tabelasService.criar({
    codigo: `RC44_${suffix}`,
    nome: `Tabela RC44 ${suffix}`,
    ativo: true,
    valores: [{ canal_venda_id: varejo.id, preco: 2.5 }]
  });

  // Com tabela + VAREJO → preço da tabela
  const comTabela = await ComercialPrecoResolver.resolver({
    produto: {
      id: 1,
      nome: 'Sorvete Chocolate',
      preco_venda: 9.99,
      tabela_preco_id: tabela.id
    }
  });
  assert.strictEqual(comTabela.preco_venda, 2.5);
  assert.strictEqual(comTabela.origem, 'tabela_preco');
  assert.strictEqual(comTabela.canal, 'VAREJO');
  assert.strictEqual(comTabela.fallback, false);

  // Sem tabela → fallback legado
  const semTabela = await ComercialPrecoResolver.resolver({
    produto: { nome: 'Sorvete Chocolate', preco_venda: 2.5 }
  });
  assert.strictEqual(semTabela.preco_venda, 2.5);
  assert.strictEqual(semTabela.origem, 'produto.preco_venda');
  assert.strictEqual(semTabela.fallback, true);

  // Tabela sem valor no canal → fallback
  const tabelaVazia = await tabelasService.criar({
    codigo: `RC44V_${suffix}`,
    nome: `Tabela Vazia ${suffix}`,
    ativo: true,
    valores: []
  });
  const fallbackTabela = await ComercialPrecoResolver.resolver({
    produto: {
      nome: 'Produto Sem Valor',
      preco_venda: 7.7,
      tabela_preco_id: tabelaVazia.id
    }
  });
  assert.strictEqual(fallbackTabela.preco_venda, 7.7);
  assert.strictEqual(fallbackTabela.origem, 'produto.preco_venda');
  assert.strictEqual(fallbackTabela.fallback, true);

  // Sync usa cache após aquecimento
  await ComercialPrecoResolver.aquecerCacheCanal('VAREJO');
  const sync = ComercialPrecoResolver.resolverSync({
    produto: { preco_venda: 1, tabela_preco_id: tabela.id }
  });
  assert.strictEqual(sync.preco_venda, 2.5);
  assert.strictEqual(sync.origem, 'tabela_preco');

  // limpeza
  await tabelasService.excluir(tabela.id);
  await tabelasService.excluir(tabelaVazia.id);

  console.log('✔ RCM-04.4 Motor Comercial V2 (Tabela de Preço) — OK');
  process.exit(0);
}

run().catch((err) => {
  console.error('✖ RCM-04.4 falhou:', err);
  process.exit(1);
});
