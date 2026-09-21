/**
 * RCM-8.13.3 — Timestamp operacional + consistência visual financeira
 *
 * Executar:
 *   node tests/motor-comercial/rcm8133-timestamp-financeiro-visual.test.js
 */

const assert = require('assert');
const path = require('path');

process.chdir(path.resolve(__dirname, '../..'));

const {
  montarHistoricoEntregasAtualizado,
  resolverTimestampOperacional,
  normalizarTimestampLegado,
  OPERACAO_ALTERACAO_POS_ENTREGA,
  TIPOS_EVENTO_ENTREGA
} = require('../../backend/motores/motor-comercial/usecases/consignacao/atualizacaoEntregaHelpers');
const {
  OPERACAO_ENTREGA_COMPLEMENTAR
} = require('../../backend/motores/motor-comercial/usecases/consignacao/entregaComplementarHelpers');
const {
  mapFinanceiroConsignacao
} = require('../../frontend/modules/motor-comercial/pages/Consignacoes/cockpitFinanceiroMappers');
const {
  buildFinanceiroFromResumo,
  buildPagamentosHistorico
} = require('../../frontend/modules/motor-comercial/pages/PrestacaoContas/prestacaoFinanceiroSnapshot');
const CreditoComercialService = require('../../backend/motores/motor-comercial/services/CreditoComercialService');

let passou = 0;
let falhou = 0;

function test(nome, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passou += 1;
      console.log(`  OK  ${nome}`);
    })
    .catch((err) => {
      falhou += 1;
      console.error(`  FALHOU  ${nome}\n         ${err.message}`);
    });
}

function formatHoraBrt(iso) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(new Date(iso));
}

function movBase({
  correlationId,
  operacao,
  produtoId = 50,
  itemId = 1,
  quantidade = 10,
  dataMovimentacao,
  capturadoEm,
  createdAt
}) {
  return {
    id: `${correlationId}-${itemId}`,
    consignacaoId: 21,
    consignacaoItemId: itemId,
    tipoMovimentacao: 'ENTREGA',
    correlationId,
    quantidade,
    valor: quantidade * 2.5,
    usuarioId: 1,
    dataMovimentacao: dataMovimentacao || null,
    createdAt: createdAt || null,
    snapshot: {
      capturadoEm: capturadoEm || null,
      contexto: { operacao },
      documento: { numero: 'CONS-2026-000021' },
      item: {
        id: itemId,
        produtoId,
        produtoNome: `Produto ${produtoId}`,
        quantidade,
        quantidadeAnterior: 0,
        delta: quantidade,
        quantidadeAtual: quantidade,
        precoUnitario: 2.5
      }
    }
  };
}

async function run() {
  console.log('\nRCM-8.13.3 — timestamp + financeiro visual\n');

  await test('normalizarTimestampLegado anexa Z a created_at naive', () => {
    assert.strictEqual(
      normalizarTimestampLegado('2026-09-20 13:51:06'),
      '2026-09-20T13:51:06Z'
    );
    assert.strictEqual(
      normalizarTimestampLegado('2026-09-20T13:51:06.090Z'),
      '2026-09-20T13:51:06.090Z'
    );
  });

  await test('resolverTimestampOperacional prioriza dataMovimentacao sobre createdAt naive', () => {
    const iso = '2026-09-20T13:51:06.090Z';
    const raw = resolverTimestampOperacional({
      dataMovimentacao: iso,
      createdAt: '2026-09-20 13:51:06',
      snapshot: { capturadoEm: iso }
    });
    assert.strictEqual(raw, iso);
    assert.strictEqual(formatHoraBrt(raw), '10:51:06');
  });

  await test('TESTE 1 — Entrega original usa horário operacional (não +3h)', () => {
    const iso = '2026-09-20T13:51:06.090Z';
    const movs = [
      movBase({
        correlationId: 'corr-001',
        operacao: 'ENTREGA',
        dataMovimentacao: iso,
        capturadoEm: iso,
        createdAt: '2026-09-20 13:51:06',
        quantidade: 60
      })
    ];
    const hist = montarHistoricoEntregasAtualizado(movs, []);
    assert.strictEqual(hist.length, 1);
    assert.strictEqual(hist[0].tipo, TIPOS_EVENTO_ENTREGA.ORIGINAL);
    assert.strictEqual(hist[0].dataHora, iso);
    assert.strictEqual(hist[0].comprovante.dataHora, iso);
    assert.strictEqual(formatHoraBrt(hist[0].dataHora), '10:51:06');
  });

  await test('TESTE 2 — Entrega complementar usa horário operacional', () => {
    const t0 = '2026-09-20T13:00:00.000Z';
    const t1 = '2026-09-20T14:10:00.000Z';
    const movs = [
      movBase({
        correlationId: 'corr-001',
        operacao: 'ENTREGA',
        dataMovimentacao: t0,
        capturadoEm: t0,
        createdAt: '2026-09-20 13:00:00',
        quantidade: 60
      }),
      movBase({
        correlationId: 'corr-002',
        operacao: OPERACAO_ENTREGA_COMPLEMENTAR,
        dataMovimentacao: t1,
        capturadoEm: t1,
        createdAt: '2026-09-20 14:10:00',
        quantidade: 20,
        itemId: 2,
        produtoId: 60
      })
    ];
    const hist = montarHistoricoEntregasAtualizado(movs, []);
    assert.strictEqual(hist[1].tipo, TIPOS_EVENTO_ENTREGA.COMPLEMENTAR);
    assert.strictEqual(hist[1].dataHora, t1);
    assert.strictEqual(formatHoraBrt(hist[1].dataHora), '11:10:00');
  });

  await test('TESTE 3 — Segunda complementar mantém timestamp operacional', () => {
    const t2 = '2026-09-20T15:30:45.000Z';
    const movs = [
      movBase({
        correlationId: 'corr-001',
        operacao: 'ENTREGA',
        dataMovimentacao: '2026-09-20T13:00:00.000Z',
        capturadoEm: '2026-09-20T13:00:00.000Z',
        createdAt: '2026-09-20 13:00:00'
      }),
      movBase({
        correlationId: 'corr-002',
        operacao: OPERACAO_ENTREGA_COMPLEMENTAR,
        dataMovimentacao: '2026-09-20T14:00:00.000Z',
        capturadoEm: '2026-09-20T14:00:00.000Z',
        createdAt: '2026-09-20 14:00:00',
        itemId: 2
      }),
      movBase({
        correlationId: 'corr-003',
        operacao: OPERACAO_ENTREGA_COMPLEMENTAR,
        dataMovimentacao: t2,
        capturadoEm: t2,
        createdAt: '2026-09-20 15:30:45',
        itemId: 3,
        produtoId: 70
      })
    ];
    const hist = montarHistoricoEntregasAtualizado(movs, []);
    assert.strictEqual(hist[2].numeroComprovante, '003');
    assert.strictEqual(hist[2].dataHora, t2);
    assert.strictEqual(formatHoraBrt(hist[2].dataHora), '12:30:45');
  });

  await test('TESTE 4 — Alteração pós-entrega usa timestamp operacional', () => {
    const tAlt = '2026-09-20T16:05:01.500Z';
    const movs = [
      movBase({
        correlationId: 'corr-001',
        operacao: 'ENTREGA',
        dataMovimentacao: '2026-09-20T13:00:00.000Z',
        capturadoEm: '2026-09-20T13:00:00.000Z',
        createdAt: '2026-09-20 13:00:00'
      }),
      {
        ...movBase({
          correlationId: 'corr-alt',
          operacao: OPERACAO_ALTERACAO_POS_ENTREGA,
          dataMovimentacao: tAlt,
          capturadoEm: tAlt,
          createdAt: '2026-09-20 16:05:01',
          quantidade: -5
        }),
        tipoMovimentacao: OPERACAO_ALTERACAO_POS_ENTREGA,
        motivo: 'ERRO_DIGITACAO',
        snapshot: {
          capturadoEm: tAlt,
          contexto: { operacao: OPERACAO_ALTERACAO_POS_ENTREGA, motivo: 'ERRO_DIGITACAO' },
          documento: { numero: 'CONS-2026-000021' },
          item: {
            id: 1,
            produtoId: 50,
            produtoNome: 'Produto 50',
            quantidade: -5,
            quantidadeAnterior: 10,
            delta: -5,
            quantidadeAtual: 5,
            precoUnitario: 2.5
          }
        }
      }
    ];
    const hist = montarHistoricoEntregasAtualizado(movs, []);
    const alt = hist.find((h) => h.tipo === TIPOS_EVENTO_ENTREGA.ALTERACAO_POS_ENTREGA);
    assert.ok(alt);
    assert.strictEqual(alt.dataHora, tAlt);
    assert.strictEqual(formatHoraBrt(alt.dataHora), '13:05:01');
  });

  await test('TESTE 5 — Comprovante usa o mesmo timestamp do evento', () => {
    const iso = '2026-09-20T13:51:06.090Z';
    const hist = montarHistoricoEntregasAtualizado([
      movBase({
        correlationId: 'corr-001',
        operacao: 'ENTREGA',
        dataMovimentacao: iso,
        capturadoEm: iso,
        createdAt: '2026-09-20 13:51:06'
      })
    ], []);
    assert.strictEqual(hist[0].comprovante.dataHora, hist[0].dataHora);
    assert.strictEqual(hist[0].comprovante.dataHora, iso);
  });

  await test('TESTE 6 — Financeiro separa AR, estoque e saldo global', () => {
    const fin = mapFinanceiroConsignacao({
      contaCorrente: {
        saldoAtual: 262.5,
        saldoEmAberto: 0,
        estoqueConsignado: 262.5
      },
      perfil: { saldoAberto: 646.5 },
      situacao: { saldoEmAberto: 0, saldoDevedor: 646.5 }
    });
    assert.strictEqual(fin.aReceberDestaOperacao, 0);
    assert.strictEqual(fin.estoqueConsignadoDestaOperacao, 262.5);
    assert.strictEqual(fin.saldoDevedorGlobalCliente, 646.5);
  });

  await test('TESTE 6b — Financeiro NÃO usa contaCorrente.saldo inexistente', () => {
    const fin = mapFinanceiroConsignacao({
      contaCorrente: {
        // sem .saldo
        saldoAtual: 262.5,
        saldoEmAberto: 0,
        estoqueConsignado: 262.5
      },
      perfil: { saldoAberto: 646.5 },
      situacao: { saldoEmAberto: 0 }
    });
    assert.notStrictEqual(fin.estoqueConsignadoDestaOperacao, 0);
    assert.strictEqual(fin.aReceberDestaOperacao, 0);
  });

  await test('TESTE 7 — Fechamento continua Vendido − Recebido = Saldo', () => {
    const fin = buildFinanceiroFromResumo({
      valorVendido: 100,
      valorRecebido: 40
    });
    assert.strictEqual(fin.valorVenda, 100);
    assert.strictEqual(fin.valorRecebido, 40);
    assert.strictEqual(fin.saldoEmAberto, 60);

    const zerado = buildFinanceiroFromResumo({
      valorVendido: 0,
      valorRecebido: 0
    });
    assert.strictEqual(zerado.saldoEmAberto, 0);
  });

  await test('TESTE 8 — Perfil/crédito global não muda (saldoDevedor)', () => {
    const metricas = CreditoComercialService.calcular({
      limiteComercial: 5000,
      movimentacoes: [
        { tipoMovimentacao: 'ENTREGA', valor: 177 },
        { tipoMovimentacao: 'DEVOLUCAO', valor: 99 },
        { tipoMovimentacao: 'ENTREGA', valor: 306 },
        { tipoMovimentacao: 'ENTREGA', valor: 15 },
        { tipoMovimentacao: 'DEVOLUCAO', valor: 15 },
        { tipoMovimentacao: 'ENTREGA', valor: 262.5 }
      ]
    });
    assert.strictEqual(metricas.saldoDevedor, 646.5);
    assert.strictEqual(metricas.estoqueConsignado, 646.5);
    assert.strictEqual(metricas.saldoEmAbertoContaCorrente, 0);
  });

  await test('Pagamentos da prestação priorizam dataMovimentacao sobre createdAt naive', () => {
    const hist = buildPagamentosHistorico([
      {
        tipoMovimentacao: 'PAGAMENTO',
        valor: 50,
        dataMovimentacao: '2026-09-20T13:51:06.090Z',
        createdAt: '2026-09-20 13:51:06'
      }
    ]);
    assert.strictEqual(hist[0].data, '2026-09-20T13:51:06.090Z');
    assert.strictEqual(formatHoraBrt(hist[0].data), '10:51:06');
  });

  console.log(`\nResultado: ${passou} OK, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

run();
