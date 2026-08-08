/**
 * MIDP V1.0 — Performance (1.000 vendas simuladas)
 * Certificação apenas — não altera algoritmos.
 */

'use strict';

const assert = require('assert');
const {
  fo,
  itemInteiro,
  itemFracionavel,
  executarCenario,
  assertInvariantes,
  arredondar2
} = require('./midpCertHelpers');

const N = 1000;

function cenarioAleatorio(i) {
  const tipo = i % 5;
  if (tipo === 0) {
    return {
      nome: `PERF_PIX_${i}`,
      itens: [itemInteiro({ qtd: 10, preco: 15 })],
      pagamentos: [{ forma_pagamento: 'pix', valor: 150 }],
      fiscalOperacional: fo({ max: 150, min: 0, nf: 0 })
    };
  }
  if (tipo === 1) {
    return {
      nome: `PERF_COMPLEMENTO_${i}`,
      itens: [itemInteiro({ qtd: 10, preco: 15 })],
      pagamentos: [
        { forma_pagamento: 'pix', valor: 80 },
        { forma_pagamento: 'dinheiro', valor: 70 }
      ],
      fiscalOperacional: fo({ max: 150, min: 0, nf: 0 })
    };
  }
  if (tipo === 2) {
    return {
      nome: `PERF_KG_${i}`,
      itens: [itemFracionavel({ qtd: 5, preco: 30 })],
      pagamentos: [
        { forma_pagamento: 'pix', valor: 80 },
        { forma_pagamento: 'dinheiro', valor: 70 }
      ],
      fiscalOperacional: fo({ max: 150, min: 0, nf: 0 })
    };
  }
  if (tipo === 3) {
    return {
      nome: `PERF_MISTA_${i}`,
      itens: [
        itemFracionavel({ qtd: 2, preco: 25 }),
        itemInteiro({ qtd: 4, preco: 12.5 })
      ],
      pagamentos: [
        { forma_pagamento: 'cartao_debito', valor: 60 },
        { forma_pagamento: 'dinheiro', valor: 40 }
      ],
      fiscalOperacional: fo({ max: 100, min: 0, nf: 0 })
    };
  }
  return {
    nome: `PERF_MEIOS_${i}`,
    itens: [itemInteiro({ qtd: 8, preco: 12.5 })],
    pagamentos: [
      { forma_pagamento: 'pix', valor: 25 },
      { forma_pagamento: 'voucher', valor: 25 },
      { forma_pagamento: 'cartao_credito', valor: 25 },
      { forma_pagamento: 'dinheiro', valor: 25 }
    ],
    fiscalOperacional: fo({ max: 100, min: 20, nf: 0 })
  };
}

console.log('====================================================');
console.log(`MIDP V1.0 — PERFORMANCE (${N} vendas)`);
console.log('====================================================\n');

const memAntes = process.memoryUsage();
const tempos = [];
let falhas = 0;

// Silencia logs de produção durante o stress (certificação não altera algoritmos)
const _log = console.log;
console.log = (...args) => {
  const head = args[0] == null ? '' : String(args[0]);
  if (
    head.startsWith('[MIDP')
    || head.startsWith('[AUDITORIA')
    || head.startsWith('[MIDP-DECISAO]')
  ) {
    return;
  }
  _log.apply(console, args);
};

const t0 = process.hrtime.bigint();

for (let i = 0; i < N; i += 1) {
  const inicio = process.hrtime.bigint();
  try {
    const r = executarCenario({ ...cenarioAleatorio(i), quiet: true });
    assertInvariantes(r, assert);
  } catch (err) {
    falhas += 1;
    if (falhas <= 3) {
      console.error(`Falha #${falhas} em i=${i}:`, err.message || err);
    }
  }
  const fim = process.hrtime.bigint();
  tempos.push(Number(fim - inicio) / 1e6);
}

console.log = _log;

const t1 = process.hrtime.bigint();
const totalMs = Number(t1 - t0) / 1e6;
const memDepois = process.memoryUsage();

tempos.sort((a, b) => a - b);
const soma = tempos.reduce((a, b) => a + b, 0);
const media = soma / tempos.length;
const maximo = tempos[tempos.length - 1];
const p95 = tempos[Math.floor(tempos.length * 0.95)];
const p99 = tempos[Math.floor(tempos.length * 0.99)];

const heapDeltaMb = (memDepois.heapUsed - memAntes.heapUsed) / (1024 * 1024);
const rssDeltaMb = (memDepois.rss - memAntes.rss) / (1024 * 1024);

const relatorio = {
  vendas: N,
  falhas,
  totalMs: arredondar2(totalMs),
  tempoMedioMs: arredondar2(media),
  tempoMaximoMs: arredondar2(maximo),
  p95Ms: arredondar2(p95),
  p99Ms: arredondar2(p99),
  heapUsedAntesMb: arredondar2(memAntes.heapUsed / (1024 * 1024)),
  heapUsedDepoisMb: arredondar2(memDepois.heapUsed / (1024 * 1024)),
  heapDeltaMb: arredondar2(heapDeltaMb),
  rssDeltaMb: arredondar2(rssDeltaMb)
};

console.log('[MIDP-CERT-PERF]', JSON.stringify(relatorio));
console.log(`\nVendas: ${N}`);
console.log(`Falhas: ${falhas}`);
console.log(`Tempo total: ${relatorio.totalMs} ms`);
console.log(`Tempo médio: ${relatorio.tempoMedioMs} ms`);
console.log(`Tempo máximo: ${relatorio.tempoMaximoMs} ms`);
console.log(`P95: ${relatorio.p95Ms} ms | P99: ${relatorio.p99Ms} ms`);
console.log(`Heap Δ: ${relatorio.heapDeltaMb} MB | RSS Δ: ${relatorio.rssDeltaMb} MB`);

if (falhas > 0) {
  process.exitCode = 1;
  console.log('\nPERFORMANCE: REPROVADA (invariantes quebraram)');
} else {
  console.log('\nPERFORMANCE: APROVADA');
}

module.exports = { relatorio };
