/**
 * MCC-HOM-01 — Stress, concorrência, escalabilidade e versionamento
 * Executar: npm run test:mcc-hom
 */

const assert = require('assert');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const sqlite3 = require('sqlite3').verbose();
const mcc = require(path.join(__dirname, '..'));

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
      console.error(`         ${error.stack || error.message}`);
    });
}

function produtoBase(id = 1) {
  return {
    id,
    unidade_base: 'L',
    utiliza_conversao_fisica: 0,
    unidades_comercializacao: [
      {
        unidade_comercial: 'CX',
        tipo: 'AGRUPAMENTO',
        quantidade: 5,
        unidade_base: 'L',
        permite_compra: 1
      }
    ]
  };
}

function produtoFisico(id = 1) {
  return {
    id,
    unidade_base: 'L',
    utiliza_conversao_fisica: 1,
    unidade_conversao_fisica: 'KG',
    unidades_comercializacao: [
      {
        unidade_comercial: 'CX',
        tipo: 'AGRUPAMENTO',
        quantidade: 5,
        unidade_base: 'L',
        permite_compra: 1
      }
    ]
  };
}

function memMb() {
  return process.memoryUsage().heapUsed / (1024 * 1024);
}

async function run() {
  console.log('=== MCC-HOM-01 — Homologação Enterprise ===\n');

  // --- Auditoria 4: tipos oficiais ---
  await test('Tipos: AGRUPAMENTO / FRACIONAMENTO / COMPOSTA / FÍSICA / PADRAO', () => {
    const agr = mcc.Converter({
      produto: produtoBase(),
      quantidade: 4,
      unidadeOrigem: 'CX',
      contexto: 'COMPRA'
    });
    assert.strictEqual(agr.quantidadeConvertida, 20);
    assert.strictEqual(agr.tipoConversao, mcc.TipoConversao.AGRUPAMENTO);

    const fra = mcc.Converter({
      produto: {
        id: 2,
        unidade_base: 'M',
        unidades_comercializacao: [
          { unidade_comercial: 'BB', tipo: 'FRACIONAMENTO', quantidade: 50, unidade_base: 'M' }
        ]
      },
      quantidade: 2,
      unidadeOrigem: 'BB',
      contexto: 'VENDA'
    });
    assert.strictEqual(fra.quantidadeConvertida, 100);
    assert.strictEqual(fra.tipoConversao, mcc.TipoConversao.FRACIONAMENTO);

    const lote = mcc.ConversaoFisicaLote.criar({
      produtoId: 1,
      loteId: 1,
      unidadeBase: 'L',
      unidadeDestino: 'KG',
      quantidadeBase: 5,
      quantidadeDestino: 3.375,
      origem: 'MANUAL'
    });
    const fis = mcc.Converter({
      produto: produtoFisico(),
      quantidade: 10,
      unidadeOrigem: 'L',
      contexto: 'VENDA',
      conversaoFisicaLote: lote
    });
    assert.ok(Math.abs(fis.quantidadeConvertida - 6.75) < 1e-9);

    const comp = mcc.Converter({
      produto: produtoFisico(),
      quantidade: 2,
      unidadeOrigem: 'CX',
      contexto: 'COMERCIAL',
      conversaoFisicaLote: lote,
      cadeia: [
        { de: 'CX', para: 'L', tipo: 'AGRUPAMENTO', quantidade: 5 },
        { de: 'L', para: 'KG', tipo: 'CONVERSAO_FISICA' }
      ]
    });
    assert.strictEqual(comp.tipoConversao, mcc.TipoConversao.CONVERSAO_COMPOSTA);
    assert.ok(Math.abs(comp.quantidadeConvertida - 6.75) < 1e-9);

    const pad = mcc.Converter({
      produto: produtoBase(),
      quantidade: 7,
      unidadeOrigem: 'L',
      contexto: 'OUTROS'
    });
    assert.strictEqual(pad.tipoConversao, mcc.TipoConversao.PADRAO);
    assert.ok(pad.auditoria);
    assert.strictEqual(pad.auditoria.persistido, false);
  });

  // --- Auditoria 5: Stress 100k ---
  let stressReport = null;
  await test('Stress: 100.000 conversões (mesmo lote + cache)', () => {
    const N = 100000;
    const servico = new mcc.ConversaoComercialService();
    const produto = produtoBase();
    const mem0 = memMb();
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < N; i++) {
      servico.Converter({
        produto,
        quantidade: 3,
        unidadeOrigem: 'CX',
        contexto: 'VENDA',
        operacaoId: 'stress-same',
        loteId: 1
      });
    }
    const t1 = process.hrtime.bigint();
    const ms = Number(t1 - t0) / 1e6;
    const mem1 = memMb();
    const hits = servico.cache.tamanho('stress-same');
    assert.strictEqual(hits, 1, 'cache deve colapsar para 1 chave');
    stressReport = {
      n: N,
      msTotal: ms,
      msMedio: ms / N,
      convPerSec: (N / ms) * 1000,
      heapDeltaMb: mem1 - mem0,
      cacheEntries: hits
    };
    assert.ok(stressReport.msMedio < 1, `tempo médio alto: ${stressReport.msMedio}ms`);
    console.log(
      `         → ${N} conv em ${ms.toFixed(1)}ms | médio ${stressReport.msMedio.toFixed(4)}ms | ` +
      `${stressReport.convPerSec.toFixed(0)}/s | Δheap ${stressReport.heapDeltaMb.toFixed(2)}MB`
    );
  });

  await test('Stress: 100.000 conversões (lotes diferentes, sem cache compartilhado)', () => {
    const N = 100000;
    const servico = new mcc.ConversaoComercialService();
    const produto = produtoFisico();
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < N; i++) {
      const lote = mcc.ConversaoFisicaLote.criar({
        produtoId: 1,
        loteId: (i % 500) + 1,
        unidadeBase: 'L',
        unidadeDestino: 'KG',
        quantidadeBase: 5,
        quantidadeDestino: 3.3 + ((i % 50) * 0.001),
        origem: 'CALCULADA',
        versao: 1,
        ativa: true
      });
      const r = servico.Converter({
        produto,
        quantidade: 2,
        unidadeOrigem: 'CX',
        contexto: 'COMPRA',
        conversaoFisicaLote: lote,
        aplicarFisica: false,
        somenteUnidadeBase: true,
        loteId: lote.loteId,
        operacaoId: `op-${i % 100}`
      });
      assert.strictEqual(r.quantidadeConvertida, 10);
    }
    const t1 = process.hrtime.bigint();
    const ms = Number(t1 - t0) / 1e6;
    console.log(`         → ${N} conv multi-lote em ${ms.toFixed(1)}ms | médio ${(ms / N).toFixed(4)}ms`);
    assert.ok(ms / N < 2, 'performance multi-lote degradada');
  });

  await test('Stress: sem cache vs com cache', () => {
    const N = 20000;
    const produto = produtoBase();
    const s1 = new mcc.ConversaoComercialService();
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < N; i++) {
      s1.Converter({ produto, quantidade: 5, unidadeOrigem: 'CX', contexto: 'PDV' });
    }
    const msSem = Number(process.hrtime.bigint() - t0) / 1e6;

    const s2 = new mcc.ConversaoComercialService();
    const t1 = process.hrtime.bigint();
    for (let i = 0; i < N; i++) {
      s2.Converter({
        produto,
        quantidade: 5,
        unidadeOrigem: 'CX',
        contexto: 'PDV',
        operacaoId: 'cache-bench',
        loteId: null
      });
    }
    const msCom = Number(process.hrtime.bigint() - t1) / 1e6;
    console.log(`         → sem cache ${msSem.toFixed(1)}ms | com cache ${msCom.toFixed(1)}ms`);
    assert.ok(msCom <= msSem * 1.2 || msCom < msSem, 'cache não deve piorar drasticamente');
    assert.strictEqual(s2.cache.tamanho('cache-bench'), 1);
  });

  // --- Auditoria 6: concorrência (worker_threads) ---
  await test('Thread-safety: workers paralelos no Converter (resultados idênticos)', async () => {
    const workerCode = `
      const { parentPort, workerData } = require('worker_threads');
      const path = require('path');
      const mcc = require(path.join(workerData.mccPath));
      const produto = {
        id: 1,
        unidade_base: 'L',
        unidades_comercializacao: [
          { unidade_comercial: 'CX', tipo: 'AGRUPAMENTO', quantidade: 5, unidade_base: 'L' }
        ]
      };
      const results = [];
      for (let i = 0; i < workerData.n; i++) {
        const r = mcc.Converter({
          produto,
          quantidade: 8,
          unidadeOrigem: 'CX',
          contexto: 'VENDA',
          operacaoId: 'w-' + workerData.id,
          loteId: 1
        });
        results.push(r.quantidadeConvertida);
      }
      parentPort.postMessage({
        id: workerData.id,
        first: results[0],
        last: results[results.length - 1],
        allEqual: results.every((x) => x === 40)
      });
    `;
    const mccPath = path.join(__dirname, '..');
    const workers = [];
    for (let w = 0; w < 4; w++) {
      workers.push(
        new Promise((resolve, reject) => {
          const worker = new Worker(workerCode, {
            eval: true,
            workerData: { id: w, n: 5000, mccPath }
          });
          worker.on('message', resolve);
          worker.on('error', reject);
        })
      );
    }
    const msgs = await Promise.all(workers);
    assert.strictEqual(msgs.length, 4);
    msgs.forEach((m) => {
      assert.strictEqual(m.first, 40);
      assert.strictEqual(m.last, 40);
      assert.strictEqual(m.allEqual, true);
    });
  });

  await test('Concorrência: cache por operação isolado entre instâncias', async () => {
    const a = new mcc.ConversaoComercialService();
    const b = new mcc.ConversaoComercialService();
    const produto = produtoBase();
    const jobs = [];
    for (let i = 0; i < 200; i++) {
      jobs.push(Promise.resolve().then(() => {
        a.Converter({
          produto, quantidade: 2, unidadeOrigem: 'CX', contexto: 'PDV',
          operacaoId: 'op-a', loteId: 1
        });
        b.Converter({
          produto, quantidade: 2, unidadeOrigem: 'CX', contexto: 'PDV',
          operacaoId: 'op-b', loteId: 2
        });
      }));
    }
    await Promise.all(jobs);
    assert.strictEqual(a.cache.tamanho('op-a'), 1);
    assert.strictEqual(b.cache.tamanho('op-b'), 1);
    assert.strictEqual(a.cache.tamanho('op-b'), 0);
  });

  // --- Auditoria 7: versionamento íntegro ---
  await test('Versionamento: nunca UPDATE/DELETE; sempre nova versão', async () => {
    const db = await new Promise((resolve, reject) => {
      const database = new sqlite3.Database(':memory:', (err) => (err ? reject(err) : resolve(database)));
    });
    await new Promise((res, rej) => {
      db.serialize(() => {
        db.run(`CREATE TABLE produtos (id INTEGER PRIMARY KEY)`);
        db.run(`CREATE TABLE produtos_lotes (id INTEGER PRIMARY KEY, produto_id INTEGER, lote TEXT)`, (e) => (e ? rej(e) : res()));
      });
    });
    await mcc.bootstrapMccSchema(db);
    db.run(`INSERT INTO produtos (id) VALUES (1)`);
    db.run(`INSERT INTO produtos_lotes (id, produto_id, lote) VALUES (50, 1, 'HOM')`);

    const v1 = await mcc.criarVersaoInicial(db, {
      produtoId: 1, loteId: 50,
      unidadeBase: 'L', unidadeDestino: 'KG',
      quantidadeBase: 5, quantidadeDestino: 3.375, origem: 'MANUAL'
    });
    const v2 = await mcc.criarNovaVersao(db, 50, {
      quantidadeBase: 5, quantidadeDestino: 3.362,
      motivo: mcc.MotivoVersaoConversao.CONFERENCIA_BALANCA,
      usuarioId: 7
    });
    assert.strictEqual(v2.versao_nova.versao, 2);
    assert.strictEqual(v2.versao_anterior.ativa, 0);

    let updErr = null;
    try {
      await mcc.ConversaoFisicaLoteRepository.atualizar(db, v1.id, { quantidade_destino: 9 });
    } catch (e) { updErr = e; }
    assert.ok(updErr instanceof mcc.ConversaoFisicaImutavelError);

    let delErr = null;
    try {
      await mcc.ConversaoFisicaLoteRepository.excluir(db, v2.versao_nova.id);
    } catch (e) { delErr = e; }
    assert.ok(delErr instanceof mcc.ConversaoFisicaImutavelError);

    const h = await mcc.consultarHistorico(db, 50);
    assert.strictEqual(h.total_versoes, 2);
    const ativa = await mcc.consultarConversaoAtiva(db, 50);
    assert.strictEqual(ativa.versao, 2);

    await new Promise((res, rej) => db.close((e) => (e ? rej(e) : res())));
  });

  // --- Auditoria 8: escalabilidade ---
  await test('Escalabilidade: 100 produtos × lotes × conversões', () => {
    const PRODUTOS = 100;
    const LOTES_POR = 100; // 10k lotes
    const CONV_POR_LOTE = 5; // 50k conversões
    const servico = new mcc.ConversaoComercialService();
    const mem0 = memMb();
    const t0 = process.hrtime.bigint();
    let total = 0;
    for (let p = 1; p <= PRODUTOS; p++) {
      const produto = produtoFisico(p);
      for (let l = 1; l <= LOTES_POR; l++) {
        const lote = mcc.ConversaoFisicaLote.criar({
          produtoId: p,
          loteId: p * 1000 + l,
          unidadeBase: 'L',
          unidadeDestino: 'KG',
          quantidadeBase: 5,
          quantidadeDestino: 3.2 + (l % 20) * 0.01,
          origem: 'CALCULADA'
        });
        for (let c = 0; c < CONV_POR_LOTE; c++) {
          const r = servico.Converter({
            produto,
            quantidade: 1 + (c % 3),
            unidadeOrigem: 'CX',
            contexto: 'VENDA',
            conversaoFisicaLote: lote,
            aplicarFisica: false,
            somenteUnidadeBase: true,
            loteId: lote.loteId,
            operacaoId: `esc-p${p}`
          });
          assert.ok(r.quantidadeConvertida > 0);
          total += 1;
        }
      }
    }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const mem1 = memMb();
    assert.strictEqual(total, PRODUTOS * LOTES_POR * CONV_POR_LOTE);
    console.log(
      `         → ${total} conv | ${PRODUTOS} produtos | ${PRODUTOS * LOTES_POR} lotes | ` +
      `${ms.toFixed(0)}ms | Δheap ${(mem1 - mem0).toFixed(1)}MB`
    );
    assert.ok(ms < 120000, 'escalabilidade acima do limite (120s)');
  });

  // --- Dependências / responsabilidades (smoke) ---
  await test('MCC não exporta/aciona estoque, NF, compra, financeiro', () => {
    const exports = Object.keys(mcc);
    const proibidos = ['salvarCompra', 'moverEstoque', 'emitirNf', 'gerarFinanceiro', 'atualizarCredito'];
    proibidos.forEach((p) => assert.ok(!exports.includes(p)));
    assert.ok(typeof mcc.Converter === 'function');
    assert.ok(typeof mcc.CalcularConversaoFisica === 'function');
  });

  if (stressReport) {
    global.__MCC_HOM_STRESS__ = stressReport;
  }

  console.log(`\n=== Resultado HOM: ${passou} OK, ${falhou} FALHOU ===`);
  process.exit(falhou > 0 ? 1 : 0);
}

if (isMainThread) {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
