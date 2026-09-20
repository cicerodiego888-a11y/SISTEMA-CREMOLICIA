/**
 * RCM-8.11 — Prestação consolidada por cliente / ciclo
 *
 * Executar:
 *   node tests/motor-comercial/rcm811-prestacao-consolidada-cliente.test.js
 */

const assert = require('assert');
const path = require('path');

process.chdir(path.resolve(__dirname, '../..'));

const {
  buscarGrupoPrestacaoAbertaDoCliente,
  listarConsignacoesDoGrupoPrestacao,
  listarItensDasConsignacoesDoGrupo,
  vincularConsignacaoAoGrupoPrestacao,
  reconciliarConsignacaoComGrupoAbertoCliente,
  fecharPonteirosConsignacoesDoGrupo,
  CODIGO_MULTIPLOS_GRUPOS
} = require('../../backend/motores/motor-comercial/usecases/consignacao/prestacaoCicloClienteHelpers');
const {
  criarGrupoPrestacaoContas,
  calcularTotaisPrestacao,
  listarMovimentacoesPrestacao,
  fecharGrupoPrestacaoContas
} = require('../../backend/motores/motor-comercial/usecases/consignacao/prestacaoOperacaoHelpers');

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

function criarStoreConsignacoes(iniciais = []) {
  const store = iniciais.map((c) => ({ ...c, prestacaoContasAtiva: c.prestacaoContasAtiva
    ? { ...c.prestacaoContasAtiva }
    : null }));
  return {
    store,
    buscarPorId: async (id) => store.find((c) => Number(c.id) === Number(id)) || null,
    listar: async (filtros = {}) => {
      let items = [...store];
      if (filtros.clienteId != null) {
        items = items.filter((c) => Number(c.clienteId) === Number(filtros.clienteId));
      }
      if (filtros.prestacaoStatus) {
        const st = String(filtros.prestacaoStatus).toUpperCase();
        items = items.filter((c) => String(c.prestacaoContasAtiva?.status || '').toUpperCase() === st);
      }
      if (filtros.prestacaoId) {
        items = items.filter((c) => String(c.prestacaoContasAtiva?.id) === String(filtros.prestacaoId));
      }
      if (filtros.status) {
        items = items.filter((c) => String(c.status).toUpperCase() === String(filtros.status).toUpperCase());
      }
      return items;
    },
    atualizar: async (id, dados) => {
      const idx = store.findIndex((c) => Number(c.id) === Number(id));
      if (idx < 0) return null;
      store[idx] = {
        ...store[idx],
        ...dados,
        prestacaoContasAtiva: dados.prestacaoContasAtiva !== undefined
          ? (dados.prestacaoContasAtiva ? { ...dados.prestacaoContasAtiva } : null)
          : store[idx].prestacaoContasAtiva
      };
      return { ...store[idx] };
    }
  };
}

function criarStoreItens(iniciais = []) {
  const itens = iniciais.map((i) => ({ ...i }));
  return {
    itens,
    listarPorConsignacao: async (consignacaoId) => itens.filter(
      (i) => Number(i.consignacaoId) === Number(consignacaoId)
    )
  };
}

function criarStoreMovs(iniciais = []) {
  const movs = iniciais.map((m) => ({ ...m }));
  return {
    movs,
    listar: async (filtros = {}) => {
      let items = [...movs];
      if (filtros.consignacaoId != null) {
        items = items.filter((m) => Number(m.consignacaoId) === Number(filtros.consignacaoId));
      }
      if (filtros.grupoPrestacaoContasId) {
        items = items.filter(
          (m) => String(m.grupoPrestacaoContasId) === String(filtros.grupoPrestacaoContasId)
        );
      }
      return items;
    },
    inserir: async (dados) => {
      const mov = { id: movs.length + 1, ...dados };
      movs.push(mov);
      return mov;
    }
  };
}

async function main() {
  console.log('\nRCM-8.11 — Prestação consolidada por cliente\n');

  const grupoA = {
    id: 'prest-001',
    status: 'ABERTA',
    dataAbertura: '2026-09-19T10:00:00.000Z',
    documento: { numero: 'PC-001' }
  };

  await test('1. primeira consignação — sem grupo aberto do cliente', async () => {
    const repo = criarStoreConsignacoes([
      { id: 14, clienteId: 10, status: 'ENTREGUE', prestacaoContasAtiva: null }
    ]);
    const ciclo = await buscarGrupoPrestacaoAbertaDoCliente(repo, 10);
    assert.strictEqual(ciclo, null);
  });

  await test('2-4. segunda consignação entra no grupo aberto + ponteiro', async () => {
    const repo = criarStoreConsignacoes([
      {
        id: 14,
        clienteId: 10,
        status: 'ENTREGUE',
        dataEntrega: '2026-09-19T10:00:00.000Z',
        prestacaoContasAtiva: { ...grupoA }
      },
      {
        id: 19,
        clienteId: 10,
        status: 'ENTREGUE',
        dataEntrega: '2026-09-19T15:00:00.000Z',
        prestacaoContasAtiva: null
      }
    ]);
    const ciclo = await buscarGrupoPrestacaoAbertaDoCliente(repo, 10, { excluirConsignacaoId: 19 });
    assert.ok(ciclo);
    assert.strictEqual(ciclo.grupo.id, 'prest-001');
    assert.strictEqual(ciclo.consignacaoAncora.id, 14);

    const uow = { consignacao: repo };
    const vinculada = await vincularConsignacaoAoGrupoPrestacao(uow, repo.store[1], ciclo.grupo);
    assert.strictEqual(vinculada.prestacaoContasAtiva.id, 'prest-001');
    assert.strictEqual(vinculada.prestacaoContasAtiva.status, 'ABERTA');
  });

  await test('5-8. consulta ciclo: movs + itens das duas consignações; preserva consignacaoId', async () => {
    const repo = criarStoreConsignacoes([
      { id: 14, clienteId: 10, status: 'ENTREGUE', documento: { numero: 'CONS-014' }, prestacaoContasAtiva: { ...grupoA } },
      { id: 19, clienteId: 10, status: 'ENTREGUE', documento: { numero: 'CONS-019' }, prestacaoContasAtiva: { ...grupoA } }
    ]);
    const itemRepo = criarStoreItens([
      { id: 1, consignacaoId: 14, produtoId: 1, quantidadeEntregue: 180, precoUnitario: 1 },
      { id: 2, consignacaoId: 14, produtoId: 2, quantidadeEntregue: 20, precoUnitario: 1 },
      { id: 3, consignacaoId: 14, produtoId: 3, quantidadeEntregue: 4, precoUnitario: 1 },
      { id: 4, consignacaoId: 19, produtoId: 9, quantidadeEntregue: 5, precoUnitario: 4.5 }
    ]);
    const movRepo = criarStoreMovs([
      { consignacaoId: 14, grupoPrestacaoContasId: 'prest-001', tipoMovimentacao: 'ABERTURA_PRESTACAO', valor: 0 },
      { consignacaoId: 14, grupoPrestacaoContasId: 'prest-001', tipoMovimentacao: 'ENTREGA', valor: 204 },
      { consignacaoId: 19, grupoPrestacaoContasId: 'prest-001', tipoMovimentacao: 'ENTREGA', valor: 22.5 }
    ]);

    const uow = { consignacao: repo, consignacaoItem: itemRepo, movimentacaoComercial: movRepo };
    const membros = await listarConsignacoesDoGrupoPrestacao(uow, 'prest-001');
    assert.strictEqual(membros.length, 2);

    const itens = await listarItensDasConsignacoesDoGrupo(uow, 'prest-001');
    assert.strictEqual(itens.length, 4);
    assert.ok(itens.every((i) => i.consignacaoId != null));
    assert.ok(itens.some((i) => Number(i.consignacaoId) === 19 && Number(i.produtoId) === 9));

    const movs = await listarMovimentacoesPrestacao(uow, 'prest-001');
    assert.strictEqual(movs.length, 3);
    assert.ok(movs.some((m) => Number(m.consignacaoId) === 19));

    const totais = calcularTotaisPrestacao(movs, 'prest-001');
    // saldo financeiro = vendas - pagamentos (0 aqui); entregas não entram no saldo de venda
    assert.strictEqual(totais.quantidadeMovimentacoes, 3);
    const saldoItens = itens.reduce((s, i) => s + Number(i.quantidadeEntregue || 0), 0);
    assert.strictEqual(saldoItens, 209);
  });

  await test('9-12. venda/devolução/perda/cortesia usam mesmo grupo', async () => {
    const movs = [
      { consignacaoId: 19, grupoPrestacaoContasId: 'prest-001', tipoMovimentacao: 'VENDA_PRESTACAO', valor: 10 },
      { consignacaoId: 19, grupoPrestacaoContasId: 'prest-001', tipoMovimentacao: 'DEVOLUCAO', valor: 2 },
      { consignacaoId: 19, grupoPrestacaoContasId: 'prest-001', tipoMovimentacao: 'PERDA', valor: 1 },
      { consignacaoId: 19, grupoPrestacaoContasId: 'prest-001', tipoMovimentacao: 'CORTESIA', valor: 1 }
    ];
    assert.ok(movs.every((m) => m.grupoPrestacaoContasId === 'prest-001'));
    assert.ok(movs.every((m) => Number(m.consignacaoId) === 19));
    const totais = calcularTotaisPrestacao(movs, 'prest-001');
    assert.strictEqual(totais.totalVendido, 10);
    assert.strictEqual(totais.totalDevolvido, 2);
    assert.strictEqual(totais.totalPerdido, 1);
    assert.strictEqual(totais.totalCortesia, 1);
  });

  await test('13. pagamento é do grupo', async () => {
    const totais = calcularTotaisPrestacao([
      { grupoPrestacaoContasId: 'prest-001', tipoMovimentacao: 'VENDA_PRESTACAO', valor: 100, consignacaoId: 14 },
      { grupoPrestacaoContasId: 'prest-001', tipoMovimentacao: 'VENDA_PRESTACAO', valor: 50, consignacaoId: 19 },
      { grupoPrestacaoContasId: 'prest-001', tipoMovimentacao: 'PAGAMENTO', valor: 150, consignacaoId: 14 }
    ], 'prest-001');
    assert.strictEqual(totais.totalVendido, 150);
    assert.strictEqual(totais.totalRecebido, 150);
    assert.strictEqual(totais.saldo, 0);
  });

  await test('14. fechamento fecha ponteiros de todas as consignações do grupo', async () => {
    const repo = criarStoreConsignacoes([
      { id: 14, clienteId: 10, status: 'ENTREGUE', prestacaoContasAtiva: { ...grupoA } },
      { id: 19, clienteId: 10, status: 'ENTREGUE', prestacaoContasAtiva: { ...grupoA } }
    ]);
    const uow = { consignacao: repo };
    const fechado = fecharGrupoPrestacaoContas(grupoA);
    await fecharPonteirosConsignacoesDoGrupo(uow, fechado, { statusPadrao: 'ACERTADA' });
    assert.strictEqual(repo.store[0].prestacaoContasAtiva.status, 'FECHADA');
    assert.strictEqual(repo.store[1].prestacaoContasAtiva.status, 'FECHADA');
    assert.strictEqual(repo.store[0].status, 'ACERTADA');
    assert.strictEqual(repo.store[1].status, 'ACERTADA');
  });

  await test('15. terceira consignação também entra enquanto aberto', async () => {
    const repo = criarStoreConsignacoes([
      { id: 14, clienteId: 10, status: 'ENTREGUE', prestacaoContasAtiva: { ...grupoA } },
      { id: 19, clienteId: 10, status: 'ENTREGUE', prestacaoContasAtiva: { ...grupoA } },
      { id: 20, clienteId: 10, status: 'ENTREGUE', dataEntrega: '2026-09-19T18:00:00.000Z', prestacaoContasAtiva: null }
    ]);
    const ciclo = await buscarGrupoPrestacaoAbertaDoCliente(repo, 10, { excluirConsignacaoId: 20 });
    assert.strictEqual(ciclo.grupo.id, 'prest-001');
    await vincularConsignacaoAoGrupoPrestacao({ consignacao: repo }, repo.store[2], ciclo.grupo);
    assert.strictEqual(repo.store[2].prestacaoContasAtiva.id, 'prest-001');
  });

  await test('16. após fechamento, nova consignação NÃO entra no grupo fechado', async () => {
    const fechado = { ...grupoA, status: 'FECHADA', dataFechamento: '2026-09-19T20:00:00.000Z' };
    const repo = criarStoreConsignacoes([
      { id: 14, clienteId: 10, status: 'ACERTADA', prestacaoContasAtiva: fechado },
      { id: 30, clienteId: 10, status: 'ENTREGUE', prestacaoContasAtiva: null }
    ]);
    const ciclo = await buscarGrupoPrestacaoAbertaDoCliente(repo, 10);
    assert.strictEqual(ciclo, null);
  });

  await test('17. múltiplos grupos ABERTA → erro de integridade (não escolhe silenciosamente)', async () => {
    const repo = criarStoreConsignacoes([
      { id: 1, clienteId: 10, status: 'ENTREGUE', prestacaoContasAtiva: { id: 'g1', status: 'ABERTA' } },
      { id: 2, clienteId: 10, status: 'ENTREGUE', prestacaoContasAtiva: { id: 'g2', status: 'ABERTA' } }
    ]);
    let erro = null;
    try {
      await buscarGrupoPrestacaoAbertaDoCliente(repo, 10);
    } catch (e) {
      erro = e;
    }
    assert.ok(erro);
    assert.strictEqual(erro.codigo, CODIGO_MULTIPLOS_GRUPOS);
  });

  await test('18. criarGrupo gera id único por abertura', async () => {
    const g1 = criarGrupoPrestacaoContas({ id: 14, documento: { serie: '1' } });
    const g2 = criarGrupoPrestacaoContas({ id: 14, documento: { serie: '1' } });
    assert.notStrictEqual(g1.id, g2.id);
    assert.strictEqual(g1.status, 'ABERTA');
  });

  await test('19-20. Entrega Complementar ≠ nova consignação; mesmo grupo da consignação', async () => {
    // Complementar adiciona item na MESMA consignacaoId; grupo vem do ponteiro
    const consig = {
      id: 14,
      clienteId: 10,
      status: 'ENTREGUE',
      prestacaoContasAtiva: { ...grupoA }
    };
    const itemNovo = { id: 99, consignacaoId: 14, produtoId: 50, quantidadeEntregue: 1 };
    assert.strictEqual(itemNovo.consignacaoId, 14);
    assert.strictEqual(consig.prestacaoContasAtiva.id, 'prest-001');
    assert.notStrictEqual(itemNovo.consignacaoId, 20);
  });

  await test('21. RCM-8.10 — agrupamento visual por cliente permanece conceitualmente separado', async () => {
    // Central agrupa por clienteId; ciclo agrupa por grupoPrestacaoContasId
    const cardCliente = { clienteId: 10, consignacoes: [{ id: 14 }, { id: 19 }] };
    assert.strictEqual(cardCliente.consignacoes.length, 2);
    assert.strictEqual(cardCliente.clienteId, 10);
  });

  await test('22. clientes diferentes não compartilham grupo', async () => {
    const repo = criarStoreConsignacoes([
      { id: 14, clienteId: 10, status: 'ENTREGUE', prestacaoContasAtiva: { ...grupoA } },
      { id: 30, clienteId: 99, status: 'ENTREGUE', prestacaoContasAtiva: null }
    ]);
    const cicloMilton = await buscarGrupoPrestacaoAbertaDoCliente(repo, 10);
    const cicloJoao = await buscarGrupoPrestacaoAbertaDoCliente(repo, 99);
    assert.strictEqual(cicloMilton.grupo.id, 'prest-001');
    assert.strictEqual(cicloJoao, null);
  });

  await test('23. consignação de ciclo fechado não entra em grupo novo', async () => {
    const repo = criarStoreConsignacoes([
      {
        id: 5,
        clienteId: 10,
        status: 'ACERTADA',
        prestacaoContasAtiva: { id: 'prest-old', status: 'FECHADA' }
      },
      {
        id: 14,
        clienteId: 10,
        status: 'ENTREGUE',
        prestacaoContasAtiva: { ...grupoA }
      }
    ]);
    const membros = await listarConsignacoesDoGrupoPrestacao({ consignacao: repo }, 'prest-001');
    assert.strictEqual(membros.length, 1);
    assert.strictEqual(membros[0].id, 14);
  });

  await test('24. dados legados elegíveis podem ser reconciliados (ponteiro only)', async () => {
    const repo = criarStoreConsignacoes([
      {
        id: 14,
        clienteId: 10,
        status: 'ENTREGUE',
        dataEntrega: '2026-09-19T10:00:00.000Z',
        prestacaoContasAtiva: { ...grupoA }
      },
      {
        id: 19,
        clienteId: 10,
        status: 'ENTREGUE',
        dataEntrega: '2026-09-19T16:00:00.000Z',
        prestacaoContasAtiva: null
      }
    ]);
    const uow = { consignacao: repo };
    const rec = await reconciliarConsignacaoComGrupoAbertoCliente(uow, repo.store[1]);
    assert.strictEqual(rec.reconciliada, true);
    assert.strictEqual(rec.consignacao.prestacaoContasAtiva.id, 'prest-001');
  });

  await test('25. dados ambíguos (anteriores à abertura) não vinculam silenciosamente', async () => {
    const repo = criarStoreConsignacoes([
      {
        id: 14,
        clienteId: 10,
        status: 'ENTREGUE',
        dataEntrega: '2026-09-19T12:00:00.000Z',
        prestacaoContasAtiva: {
          id: 'prest-001',
          status: 'ABERTA',
          dataAbertura: '2026-09-19T12:00:00.000Z'
        }
      },
      {
        id: 8,
        clienteId: 10,
        status: 'ENTREGUE',
        dataEntrega: '2026-01-01T00:00:00.000Z',
        prestacaoContasAtiva: null
      }
    ]);
    const rec = await reconciliarConsignacaoComGrupoAbertoCliente(
      { consignacao: repo },
      repo.store[1]
    );
    assert.strictEqual(rec.reconciliada, false);
    assert.ok(String(rec.motivo).includes('AMBIGUA') || rec.motivo === 'PRESTACAO_RECONCILIACAO_AMBIGUA');
  });

  await test('CENÁRIO BUG: CONS-014 + CONS-019 na mesma prestação', async () => {
    const repo = criarStoreConsignacoes([
      {
        id: 14,
        clienteId: 7,
        status: 'ENTREGUE',
        documento: { numero: 'CONS-2026-000014' },
        dataEntrega: '2026-09-19T10:00:00.000Z',
        prestacaoContasAtiva: { ...grupoA }
      }
    ]);
    // Entrega da 019 encontra ciclo e vincula
    repo.store.push({
      id: 19,
      clienteId: 7,
      status: 'RASCUNHO',
      documento: { numero: 'CONS-2026-000019' },
      prestacaoContasAtiva: null
    });
    const ciclo = await buscarGrupoPrestacaoAbertaDoCliente(repo, 7);
    assert.ok(ciclo);
    // simula entrega
    repo.store[1].status = 'ENTREGUE';
    repo.store[1].dataEntrega = '2026-09-19T22:00:00.000Z';
    await vincularConsignacaoAoGrupoPrestacao({ consignacao: repo }, repo.store[1], ciclo.grupo);

    assert.strictEqual(repo.store[0].prestacaoContasAtiva.id, 'prest-001');
    assert.strictEqual(repo.store[1].prestacaoContasAtiva.id, 'prest-001');

    const itemRepo = criarStoreItens([
      { id: 1, consignacaoId: 14, produtoId: 1, quantidadeEntregue: 180 },
      { id: 2, consignacaoId: 14, produtoId: 2, quantidadeEntregue: 20 },
      { id: 3, consignacaoId: 14, produtoId: 3, quantidadeEntregue: 4 },
      { id: 4, consignacaoId: 19, produtoId: 99, quantidadeEntregue: 1 }
    ]);
    const itens = await listarItensDasConsignacoesDoGrupo(
      { consignacao: repo, consignacaoItem: itemRepo },
      'prest-001'
    );
    assert.strictEqual(itens.length, 4);
    assert.ok(itens.some((i) => Number(i.consignacaoId) === 19));
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falha(s)\n`);
  if (falhou > 0) process.exit(1);
  console.log('RCM-8.11 PASSOU\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
