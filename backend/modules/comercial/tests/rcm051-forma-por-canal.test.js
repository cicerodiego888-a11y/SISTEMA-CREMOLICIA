/**
 * RCM-05.1 — Comercialização por Canal (Kg × Litro)
 */

const assert = require('assert');
const path = require('path');

const ComercialPrecoResolver = require(path.join(__dirname, '../preco/ComercialPrecoResolver'));
const Forma = require(path.join(__dirname, '../preco/FormaComercializacao'));
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

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

async function run() {
  ComercialPrecoResolver.setLogsHabilitados(false);
  await whenReady();
  await bootstrapComercialV2Schema(db);

  const cols = await dbAll(`PRAGMA table_info(tabela_preco_valores)`);
  assert.ok(cols.some((c) => c.name === 'forma_comercializacao'), 'coluna forma_comercializacao');
  assert.ok(cols.some((c) => c.name === 'unidade_comercial'), 'coluna unidade_comercial');

  const suffix = Date.now().toString(36).toUpperCase();
  const canais = await canaisService.listar({ ativos: '1' });
  const varejo = canais.find((c) => String(c.codigo).toUpperCase() === 'VAREJO');
  const atacado = canais.find((c) => String(c.codigo).toUpperCase() === 'ATACADO');
  assert.ok(varejo, 'canal VAREJO');
  assert.ok(atacado, 'canal ATACADO');

  const produto = {
    id: 9051,
    nome: 'Sorvete Tradicional',
    preco_venda: 99.99,
    forma_comercializacao: 'UNIDADE',
    unidade: 'UN',
    unidade_venda: null
  };

  const tabela = await tabelasService.criar({
    codigo: `RC51_${suffix}`,
    nome: `Tabela RC51 ${suffix}`,
    ativo: true,
    valores: [
      {
        canal_venda_id: varejo.id,
        preco: 59.9,
        forma_comercializacao: 'PESO',
        unidade_comercial: 'KG'
      },
      {
        canal_venda_id: atacado.id,
        preco: 30,
        forma_comercializacao: 'VOLUME',
        unidade_comercial: 'LITRO'
      }
    ]
  });

  produto.tabela_preco_id = tabela.id;

  // VAREJO → Peso / Kg
  const rVarejo = await ComercialPrecoResolver.resolver({ produto, canal: 'VAREJO' });
  assert.strictEqual(rVarejo.preco_venda, 59.9);
  assert.strictEqual(rVarejo.canal, 'VAREJO');
  assert.strictEqual(rVarejo.formaComercializacao, 'PESO');
  assert.strictEqual(rVarejo.unidadeComercial, 'KG');
  assert.strictEqual(rVarejo.forma_herdada, false);
  assert.strictEqual(rVarejo.fallback, false);

  // ATACADO → Volume / Litro
  const rAtacado = await ComercialPrecoResolver.resolver({ produto, canal: 'ATACADO' });
  assert.strictEqual(rAtacado.preco_venda, 30);
  assert.strictEqual(rAtacado.canal, 'ATACADO');
  assert.strictEqual(rAtacado.formaComercializacao, 'VOLUME');
  assert.strictEqual(rAtacado.unidadeComercial, 'LITRO');
  assert.strictEqual(rAtacado.forma_herdada, false);

  // Troca automática VAREJO → ATACADO (mesmo produto/tabela)
  assert.notStrictEqual(rVarejo.preco_venda, rAtacado.preco_venda);
  assert.notStrictEqual(rVarejo.formaComercializacao, rAtacado.formaComercializacao);
  assert.notStrictEqual(rVarejo.unidadeComercial, rAtacado.unidadeComercial);

  // Fallback: valor sem forma → herda do produto
  const tabelaFallback = await tabelasService.criar({
    codigo: `RC51F_${suffix}`,
    nome: `Tabela Fallback ${suffix}`,
    ativo: true,
    valores: [
      {
        canal_venda_id: varejo.id,
        preco: 12.5,
        forma_comercializacao: null,
        unidade_comercial: null
      }
    ]
  });

  const produtoPeso = {
    ...produto,
    tabela_preco_id: tabelaFallback.id,
    forma_comercializacao: 'PESO',
    unidade_venda: 'KG',
    unidade: 'KG',
    produto_fracionado: 1
  };

  const rFallback = await ComercialPrecoResolver.resolver({
    produto: produtoPeso,
    canal: 'VAREJO'
  });
  assert.strictEqual(rFallback.preco_venda, 12.5);
  assert.strictEqual(rFallback.formaComercializacao, 'PESO');
  assert.strictEqual(rFallback.unidadeComercial, 'KG');
  assert.strictEqual(rFallback.forma_herdada, true);

  // Helper unitário
  const efetiva = Forma.resolverFormaEfetiva(
    { forma_comercializacao: 'VOLUME', unidade_comercial: 'LITRO' },
    { forma_comercializacao: 'PESO', unidade_venda: 'KG' }
  );
  assert.strictEqual(efetiva.formaComercializacao, 'VOLUME');
  assert.strictEqual(efetiva.herdado, false);

  const herdada = Forma.resolverFormaEfetiva(null, {
    forma_comercializacao: 'PESO',
    unidade_venda: 'KG'
  });
  assert.strictEqual(herdada.formaComercializacao, 'PESO');
  assert.strictEqual(herdada.herdado, true);

  // Grade persiste forma/unidade
  const grade = await tabelasService.listarValores(tabela.id);
  const linhaVarejo = grade.find((g) => Number(g.canal_venda_id) === Number(varejo.id));
  assert.strictEqual(linhaVarejo.forma_comercializacao, 'PESO');
  assert.strictEqual(linhaVarejo.unidade_comercial, 'KG');

  await tabelasService.excluir(tabela.id);
  await tabelasService.excluir(tabelaFallback.id);

  console.log('✔ RCM-05.1 Comercialização por Canal (Kg × Litro) — OK');
  process.exit(0);
}

run().catch((err) => {
  console.error('✖ RCM-05.1 falhou:', err);
  process.exit(1);
});
