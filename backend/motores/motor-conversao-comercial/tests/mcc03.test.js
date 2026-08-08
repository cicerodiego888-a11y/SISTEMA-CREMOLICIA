/**
 * MCC-03 — Integração operacional Entrada de Mercadorias × MCC
 * Executar: npm run test:mcc03
 */

const assert = require('assert');
const path = require('path');
const mcc = require(path.join(__dirname, '..'));
const EntradaMercadoriasOperacionalService = mcc.EntradaMercadoriasOperacionalService;

let passou = 0;
let falhou = 0;

function test(nome, fn) {
  const run = Promise.resolve().then(() => fn());
  return run.then(() => {
    passou += 1;
    console.log(`  OK  ${nome}`);
  }).catch((error) => {
    falhou += 1;
    console.error(`  FALHOU  ${nome}`);
    console.error(`         ${error.message}`);
  });
}

function produtoComum() {
  return {
    id: 10,
    nome: 'Água 500ml',
    unidade: 'UN',
    unidade_base: 'UN',
    utiliza_conversao_fisica: 0,
    controlar_validade: 0,
    unidades_comercializacao: []
  };
}

function produtoCaixa() {
  return {
    id: 20,
    nome: 'Caneta CX12',
    unidade: 'UN',
    unidade_base: 'UN',
    utiliza_conversao_fisica: 0,
    controlar_validade: 0,
    unidades_comercializacao: [
      {
        unidade_comercial: 'CX',
        descricao: 'Caixa 12 UN',
        tipo: 'AGRUPAMENTO',
        quantidade: 12,
        unidade_base: 'UN',
        permite_compra: 1,
        canais_comercializacao: ['compra']
      }
    ]
  };
}

function produtoSorvete() {
  return {
    id: 30,
    nome: 'Sorvete Flocos',
    unidade: 'L',
    unidade_base: 'L',
    utiliza_conversao_fisica: 1,
    unidade_conversao_fisica: 'KG',
    controlar_validade: 0,
    unidades_comercializacao: [
      {
        unidade_comercial: 'CX',
        descricao: 'Caixa 5L',
        tipo: 'AGRUPAMENTO',
        quantidade: 5,
        unidade_base: 'L',
        permite_compra: 1,
        canais_comercializacao: ['compra', 'venda_erp']
      }
    ]
  };
}

function criarDbFake(produtoMap) {
  const lotes = [];
  const conversoes = [];
  let loteSeq = 100;
  let convSeq = 1;

  const db = {
    get(sql, params, cb) {
      if (/FROM produtos/i.test(sql)) {
        const id = params[0];
        return cb(null, produtoMap[id] || null);
      }
      if (/FROM conversoes_fisicas_lotes/i.test(sql) && /MAX\(versao\)/i.test(sql)) {
        return cb(null, { max_versao: 0 });
      }
      return cb(null, null);
    },
    all(sql, params, cb) {
      if (/produto_unidades_comercializacao/i.test(sql)) {
        const id = params[0];
        const p = produtoMap[id];
        return cb(null, (p && p.unidades_comercializacao) || []);
      }
      return cb(null, []);
    },
    run(sql, params, cb) {
      if (/INSERT INTO conversoes_fisicas_lotes/i.test(sql)) {
        const id = convSeq++;
        conversoes.push({ id, params });
        if (typeof cb === 'function') {
          cb.call({ lastID: id, changes: 1 }, null);
        }
        return;
      }
      if (typeof cb === 'function') cb.call({ lastID: 0, changes: 0 }, null);
    },
    _lotes: lotes,
    _conversoes: conversoes,
    _nextLoteId() {
      loteSeq += 1;
      return loteSeq;
    }
  };

  return db;
}

function criarServico(db, produtoMap) {
  return new EntradaMercadoriasOperacionalService({
    orchestrator: new mcc.CompraConversaoOrchestrator({ mcc: mcc.motor }),
    mcc: mcc.motor,
    ucRepo: {
      listarAtivasPorProduto: async (_db, produtoId) => (
        (produtoMap[produtoId] && produtoMap[produtoId].unidades_comercializacao) || []
      )
    },
    criarLote: (dados, cb) => {
      const id = db._nextLoteId();
      const lote = { id, lote: dados.lote || `LT${String(id).padStart(6, '0')}`, ...dados };
      db._lotes.push(lote);
      cb(null, lote);
    },
    repository: {
      inserir: async (_db, entidade) => {
        const id = (db._conversoes.length || 0) + 1;
        const salva = mcc.ConversaoFisicaLote.fromRow({
          ...(entidade.toJSON ? entidade.toJSON() : entidade),
          id,
          versao: 1,
          ativa: 1
        });
        db._conversoes.push(salva);
        return salva;
      }
    }
  });
}

async function main() {
  console.log('=== TESTES — MCC-03 Entrada Operacional × MCC ===\n');

  await test('Produto comum → estoque = quantidade informada (sem física)', async () => {
    const produtoMap = { 10: produtoComum() };
    const db = criarDbFake(produtoMap);
    const svc = criarServico(db, produtoMap);
    const r = await svc.processarItemOperacional(db, {
      compraId: 1,
      fornecedor: 'Fornecedor A',
      produtoId: 10,
      item: { quantidade: 7, unidade: 'UN', preco_unitario: 2.5, subtotal: 17.5 }
    });
    assert.strictEqual(r.quantidadeConvertida, 7);
    assert.strictEqual(r.qtdsEstoque.quantidade, 7);
    assert.strictEqual(r.conversaoFisicaLote, null);
    assert.strictEqual(r.estoqueBasePendente, false);
    assert.ok(r.auditoria.timestamp);
  });

  await test('Produto por caixa (UC) → 3 CX × 12 = 36 UN base', async () => {
    const produtoMap = { 20: produtoCaixa() };
    const db = criarDbFake(produtoMap);
    const svc = criarServico(db, produtoMap);
    const r = await svc.processarItemOperacional(db, {
      compraId: 2,
      produtoId: 20,
      item: {
        quantidade: 3,
        unidade_comercial: 'CX',
        valor_total_embalagem: 36,
        mcc_entrada: 1
      }
    });
    assert.strictEqual(r.quantidadeConvertida, 36);
    assert.strictEqual(r.unidadeBase, 'UN');
    assert.strictEqual(r.conversaoFisicaLote, null);
    assert.ok(Math.abs(r.precos.precoCompra - 1) < 0.0001);
  });

  await test('Sorvete — peso por embalagem: 20 CX · 3,375 Kg → 100 L + fator 0,675', async () => {
    const produtoMap = { 30: produtoSorvete() };
    const db = criarDbFake(produtoMap);
    const svc = criarServico(db, produtoMap);
    const r = await svc.processarItemOperacional(db, {
      compraId: 3,
      fornecedorId: 9,
      fornecedorNome: 'Laticínios X',
      produtoId: 30,
      item: {
        quantidade: 20,
        unidade_comercial: 'CX',
        modo_entrada_conversao: mcc.ModoEntradaConversao.PESO_POR_EMBALAGEM,
        peso_embalagem: 3.375,
        valor_total_embalagem: 200,
        mcc_entrada: 1
      }
    });
    assert.strictEqual(r.quantidadeConvertida, 100);
    assert.ok(r.conversaoFisicaLote);
    assert.ok(Math.abs(r.conversaoFisicaLote.fator - 0.675) < 1e-9);
    assert.ok(r.lote && r.lote.persistido);
    assert.strictEqual(r.estoqueBasePendente, false);
    assert.strictEqual(r.auditoria.fornecedorId, 9);
    assert.strictEqual(r.auditoria.quantidadeConvertida, 100);
    assert.ok(r.auditoria.fatorCalculado);
  });

  await test('Sorvete — peso total: 100 L · 67,5 Kg → fator 0,675', async () => {
    const produtoMap = { 30: produtoSorvete() };
    const db = criarDbFake(produtoMap);
    const svc = criarServico(db, produtoMap);
    const r = await svc.processarItemOperacional(db, {
      compraId: 4,
      produtoId: 30,
      item: {
        quantidade: 100,
        unidade_comercial: 'L',
        modo_entrada_conversao: mcc.ModoEntradaConversao.PESO_TOTAL,
        volume_total: 100,
        peso_total: 67.5,
        valor_total_embalagem: 150,
        mcc_entrada: 1
      }
    });
    assert.strictEqual(r.quantidadeConvertida, 100);
    assert.ok(Math.abs(r.conversaoFisicaLote.fator - 0.675) < 1e-9);
  });

  await test('Dois lotes / dois fatores — fatores independentes', async () => {
    const produtoMap = { 30: produtoSorvete() };
    const db = criarDbFake(produtoMap);
    const svc = criarServico(db, produtoMap);

    const r1 = await svc.processarItemOperacional(db, {
      compraId: 5,
      produtoId: 30,
      item: {
        quantidade: 10,
        unidade_comercial: 'CX',
        peso_embalagem: 3.375,
        modo_entrada_conversao: 'PESO_POR_EMBALAGEM',
        valor_total_embalagem: 100
      }
    });
    const r2 = await svc.processarItemOperacional(db, {
      compraId: 5,
      produtoId: 30,
      item: {
        quantidade: 10,
        unidade_comercial: 'CX',
        peso_embalagem: 3.5,
        modo_entrada_conversao: 'PESO_POR_EMBALAGEM',
        valor_total_embalagem: 100
      }
    });

    assert.strictEqual(r1.quantidadeConvertida, 50);
    assert.strictEqual(r2.quantidadeConvertida, 50);
    assert.ok(Math.abs(r1.conversaoFisicaLote.fator - 0.675) < 1e-9);
    assert.ok(Math.abs(r2.conversaoFisicaLote.fator - 0.7) < 1e-9);
    assert.notStrictEqual(r1.lote.id, r2.lote.id);
    assert.strictEqual(db._lotes.length, 2);
    assert.strictEqual(db._conversoes.length, 2);
  });

  await test('Compra sem peso em produto com física → erro obrigatório', async () => {
    const produtoMap = { 30: produtoSorvete() };
    const db = criarDbFake(produtoMap);
    const svc = criarServico(db, produtoMap);
    let erro = null;
    try {
      await svc.processarItemOperacional(db, {
        compraId: 6,
        produtoId: 30,
        item: { quantidade: 5, unidade_comercial: 'CX', valor_total_embalagem: 50 }
      });
    } catch (e) {
      erro = e;
    }
    assert.ok(erro);
    assert.ok(
      erro.name === 'ConversaoFisicaObrigatoriaError'
      || /Convers[aã]o F[ií]sica/i.test(erro.message)
      || /peso/i.test(erro.message)
    );
  });

  await test('Orchestrator permanece a única ponte — Entrada não chama Converter direto', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', 'integracao', 'compra', 'EntradaMercadoriasOperacionalService.js'),
      'utf8'
    );
    assert.ok(!/\.Converter\s*\(/.test(src));
    assert.ok(!/CalcularConversaoFisica\s*\(/.test(src));
    assert.ok(/orchestrator\.processarItem/.test(src));
  });

  await test('compras.js não usa resolverQuantidadesEstoqueCompraItem (legado)', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', '..', '..', 'rotas', 'compras.js'),
      'utf8'
    );
    assert.ok(!/resolverQuantidadesEstoqueCompraItem/.test(src));
    assert.ok(!/obterTotalConvertidoItemCompra/.test(src));
    assert.ok(/EntradaMercadoriasOperacionalService/.test(src));
    assert.ok(/entradaMcc\.processarItemOperacional/.test(src));
  });

  await test('Compatibilidade legado fracionado → UC sintética EMB via MCC', async () => {
    const produtoMap = {
      40: {
        id: 40,
        nome: 'Fita métrica',
        unidade: 'MT',
        utiliza_conversao_fisica: 0,
        produto_fracionado: 1,
        unidades_comercializacao: []
      }
    };
    const db = criarDbFake(produtoMap);
    const svc = criarServico(db, produtoMap);
    const r = await svc.processarItemOperacional(db, {
      compraId: 7,
      produtoId: 40,
      item: {
        produto_fracionado: 1,
        quantidade_embalagens: 10,
        quantidade_por_embalagem: 50,
        valor_total_embalagem: 100,
        quantidade: 500,
        peso_total_compra: 500
      }
    });
    assert.strictEqual(r.quantidadeConvertida, 500);
    assert.strictEqual(r.unidadeBase, 'MT');
  });

  console.log(`\n=== Resultado MCC-03: ${passou} OK · ${falhou} falha(s) ===`);
  if (falhou > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
