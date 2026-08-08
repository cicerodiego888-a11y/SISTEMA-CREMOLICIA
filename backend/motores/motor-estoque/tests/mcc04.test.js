/**
 * MCC-04 — Motor de Estoque (somente quantidade base)
 * Executar: npm run test:mcc04
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const MotorEstoque = require(path.join(__dirname, '..'));

let passou = 0;
let falhou = 0;

function test(nome, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passou += 1;
      console.log(`  OK  ${nome}`);
    })
    .catch((error) => {
      falhou += 1;
      console.error(`  FALHOU  ${nome}`);
      console.error(`         ${error.message}`);
    });
}

function criarDbFake(produtoInicial) {
  const produtos = {
    [produtoInicial.id]: {
      id: produtoInicial.id,
      unidade: produtoInicial.unidade || 'UN',
      saldo_fiscal: Number(produtoInicial.saldo_fiscal || 0),
      saldo_nao_fiscal: Number(produtoInicial.saldo_nao_fiscal || 0),
      estoque_atual: Number(produtoInicial.estoque_atual
        ?? ((produtoInicial.saldo_fiscal || 0) + (produtoInicial.saldo_nao_fiscal || 0))),
      controlar_validade: produtoInicial.controlar_validade || 0
    }
  };
  const movimentacoes = [];
  const reservas = [];
  let movSeq = 1;
  let resSeq = 1;

  const db = {
    get(sql, params, cb) {
      if (/FROM produtos/i.test(sql)) {
        const id = params[0];
        return cb(null, produtos[id] ? { ...produtos[id] } : null);
      }
      if (/FROM estoque_reservas/i.test(sql)) {
        const id = params[0];
        const r = reservas.find((x) => x.id === id);
        return cb(null, r || null);
      }
      return cb(null, null);
    },
    all(sql, params, cb) {
      if (/estoque_movimentacoes/i.test(sql)) {
        const id = params[0];
        return cb(null, movimentacoes.filter((m) => m.produto_id === id));
      }
      return cb(null, []);
    },
    run(sql, params, cb) {
      if (/UPDATE produtos/i.test(sql) && /saldo_fiscal = COALESCE/i.test(sql)) {
        const [dF, dNF, , , id] = params;
        const p = produtos[id];
        if (!p) return cb && cb.call({ changes: 0 }, null);
        p.saldo_fiscal = Number((p.saldo_fiscal + dF).toFixed(3));
        p.saldo_nao_fiscal = Number((p.saldo_nao_fiscal + dNF).toFixed(3));
        p.estoque_atual = Number((p.saldo_fiscal + p.saldo_nao_fiscal).toFixed(3));
        return cb && cb.call({ changes: 1 }, null);
      }
      if (/UPDATE produtos/i.test(sql) && /saldo_fiscal = \?/i.test(sql)) {
        const [sf, snf, total, id] = params;
        const p = produtos[id];
        if (!p) return cb && cb.call({ changes: 0 }, null);
        p.saldo_fiscal = sf;
        p.saldo_nao_fiscal = snf;
        p.estoque_atual = total;
        return cb && cb.call({ changes: 1 }, null);
      }
      if (/INSERT INTO estoque_movimentacoes/i.test(sql)) {
        const id = movSeq++;
        movimentacoes.push({
          id,
          produto_id: params[0],
          quantidade_base: params[1],
          quantidade_fiscal: params[2],
          quantidade_nao_fiscal: params[3],
          operacao: params[4],
          origem: params[5],
          lote_id: params[6],
          motor: params[13]
        });
        return cb && cb.call({ lastID: id, changes: 1 }, null);
      }
      if (/INSERT INTO estoque_reservas/i.test(sql)) {
        const id = resSeq++;
        reservas.push({
          id,
          produto_id: params[0],
          quantidade_base: params[1],
          origem: params[2],
          status: 'ATIVA',
          lote_id: params[5]
        });
        return cb && cb.call({ lastID: id, changes: 1 }, null);
      }
      if (/UPDATE estoque_reservas/i.test(sql)) {
        const id = params[0];
        const r = reservas.find((x) => x.id === id);
        if (r) r.status = 'LIBERADA';
        return cb && cb.call({ changes: 1 }, null);
      }
      return cb && cb.call({ lastID: 0, changes: 0 }, null);
    },
    _produtos: produtos,
    _movimentacoes: movimentacoes,
    _reservas: reservas
  };

  return db;
}

async function main() {
  console.log('=== TESTES — MCC-04 Motor de Estoque ===\n');

  await test('Entrada simples — quantidade base', async () => {
    const db = criarDbFake({ id: 1, unidade: 'UN', saldo_fiscal: 0, saldo_nao_fiscal: 0 });
    const r = await MotorEstoque.entrar(db, {
      produtoId: 1,
      quantidadeBase: 10,
      origem: 'COMPRA',
      referenciaTipo: 'compra',
      referenciaId: 99
    });
    assert.strictEqual(r.quantidadeBase, 10);
    assert.strictEqual(r.saldo.estoqueAtual, 10);
    assert.strictEqual(r.unidadeBase, 'UN');
    assert.strictEqual(r.motor, 'MotorEstoque');
    assert.ok(r.movimentacao);
    assert.strictEqual(r.movimentacao.quantidade_base, 10);
    assert.ok(!('quantidade_comercial' in r.movimentacao));
  });

  await test('Entrada por caixa (já convertida) — 36 UN base', async () => {
    const db = criarDbFake({ id: 2, unidade: 'UN' });
    // MCC já converteu 3 CX × 12 → 36
    const r = await MotorEstoque.entrar(db, {
      produtoId: 2,
      quantidadeBase: 36,
      origem: 'COMPRA'
    });
    assert.strictEqual(r.quantidadeBase, 36);
    assert.strictEqual(db._produtos[2].estoque_atual, 36);
  });

  await test('Entrada por pacote (já convertida)', async () => {
    const db = criarDbFake({ id: 3, unidade: 'UN' });
    const r = await MotorEstoque.entrar(db, {
      produtoId: 3,
      quantidadeBase: 24,
      origem: 'COMPRA'
    });
    assert.strictEqual(r.quantidadeBase, 24);
  });

  await test('Entrada por metro (já convertida)', async () => {
    const db = criarDbFake({ id: 4, unidade: 'MT' });
    const r = await MotorEstoque.entrar(db, {
      produtoId: 4,
      quantidadeBase: 500,
      origem: 'COMPRA'
    });
    assert.strictEqual(r.unidadeBase, 'MT');
    assert.strictEqual(r.quantidadeBase, 500);
  });

  await test('Entrada por peso / sorvete (já convertida) + loteId', async () => {
    const db = criarDbFake({ id: 5, unidade: 'L' });
    const r = await MotorEstoque.entrar(db, {
      produtoId: 5,
      quantidadeBase: 100,
      quantidadeFiscal: 100,
      quantidadeNaoFiscal: 0,
      origem: 'COMPRA',
      loteId: 101
    });
    assert.strictEqual(r.quantidadeBase, 100);
    assert.strictEqual(r.loteId, 101);
    assert.strictEqual(r.movimentacao.lote_id, 101);
  });

  await test('Dois lotes — saldos acumulam sem recalcular fator', async () => {
    const db = criarDbFake({ id: 6, unidade: 'L' });
    await MotorEstoque.entrar(db, {
      produtoId: 6, quantidadeBase: 50, loteId: 201, origem: 'COMPRA'
    });
    await MotorEstoque.entrar(db, {
      produtoId: 6, quantidadeBase: 50, loteId: 202, origem: 'COMPRA'
    });
    assert.strictEqual(db._produtos[6].estoque_atual, 100);
    assert.strictEqual(db._movimentacoes.length, 2);
    assert.strictEqual(db._movimentacoes[0].lote_id, 201);
    assert.strictEqual(db._movimentacoes[1].lote_id, 202);
  });

  await test('Rejeita quantidade comercial / fator', async () => {
    const db = criarDbFake({ id: 7, unidade: 'UN' });
    let erro = null;
    try {
      await MotorEstoque.entrar(db, {
        produtoId: 7,
        quantidadeBase: 10,
        unidade_comercial: 'CX',
        fator: 12
      });
    } catch (e) {
      erro = e;
    }
    assert.ok(erro);
    assert.strictEqual(erro.name, 'QuantidadeComercialRejeitadaError');
  });

  await test('Saída — quantidade base', async () => {
    const db = criarDbFake({ id: 8, unidade: 'UN', saldo_fiscal: 20, saldo_nao_fiscal: 0 });
    const r = await MotorEstoque.sair(db, {
      produtoId: 8,
      quantidadeBase: 5,
      origem: 'VENDA'
    });
    assert.strictEqual(r.quantidadeBase, 5);
    assert.strictEqual(db._produtos[8].estoque_atual, 15);
  });

  await test('Inventário — define saldos contados em base', async () => {
    const db = criarDbFake({ id: 9, unidade: 'UN', saldo_fiscal: 10, saldo_nao_fiscal: 2 });
    const r = await MotorEstoque.inventariar(db, {
      produtoId: 9,
      saldoFiscalContado: 8,
      saldoNaoFiscalContado: 1,
      motivo: 'CONTAGEM'
    });
    assert.strictEqual(r.operacao, 'INVENTARIO');
    assert.strictEqual(db._produtos[9].estoque_atual, 9);
    assert.ok(r.movimentacao);
  });

  await test('Reserva — quantidade base sem conversão', async () => {
    const db = criarDbFake({ id: 10, unidade: 'UN', saldo_fiscal: 15, saldo_nao_fiscal: 0 });
    const r = await MotorEstoque.reservar(db, {
      produtoId: 10,
      quantidadeBase: 3,
      origem: 'RESERVA'
    });
    assert.strictEqual(r.reservado, true);
    assert.strictEqual(r.quantidadeBase, 3);
    assert.strictEqual(db._produtos[10].estoque_atual, 15);
    assert.strictEqual(db._reservas.length, 1);
  });

  await test('Compatibilidade legado — entrada com quantidade alias = base', async () => {
    const db = criarDbFake({ id: 11, unidade: 'UN' });
    const r = await MotorEstoque.entrar(db, {
      produtoId: 11,
      quantidade: 7,
      origem: 'COMPRA'
    });
    assert.strictEqual(r.quantidadeBase, 7);
  });

  await test('Gate: motor-estoque não importa conversão', () => {
    const root = path.join(__dirname, '..');
    const files = [
      'index.js',
      'services/MotorEstoqueService.js',
      'repositories/ProdutoSaldoRepository.js',
      'repositories/EstoqueMovimentacaoRepository.js'
    ];
    for (const rel of files) {
      const src = fs.readFileSync(path.join(root, rel), 'utf8');
      assert.ok(!src.includes('motorConversaoUnidades'), `${rel}: motorConversaoUnidades`);
      assert.ok(!src.includes('ConversorUnidades'), `${rel}: ConversorUnidades`);
      assert.ok(!src.includes('motor-conversao-comercial'), `${rel}: MCC package`);
      assert.ok(!src.includes('motores/muc'), `${rel}: MUC`);
      assert.ok(!src.includes('resolverQuantidadesEstoque'), `${rel}: legado estoque`);
      assert.ok(!src.includes('resolverBaixaEstoque'), `${rel}: MUC baixa`);
      assert.ok(!src.includes('resolverEntradaEstoque'), `${rel}: MUC entrada`);
      assert.ok(!/\.paraBase\s*\(/.test(src), `${rel}: paraBase()`);
      assert.ok(!/\.deBase\s*\(/.test(src), `${rel}: deBase()`);
    }
  });

  await test('Gate: compras.js usa MotorEstoque.entrar', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'rotas', 'compras.js'),
      'utf8'
    );
    assert.ok(/MotorEstoque\.entrar/.test(src));
    assert.ok(!/saldo_fiscal = COALESCE\(saldo_fiscal, 0\) \+ \?/.test(src));
  });

  console.log(`\n=== Resultado MCC-04: ${passou} OK · ${falhou} falha(s) ===`);
  if (falhou > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
