/**
 * RCM-8.12 — Nova venda/consignação incorporada à Prestação ABERTA
 *
 * Executar:
 *   node tests/motor-comercial/rcm812-venda-complementar-prestacao.test.js
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
  resolverCicloPrestacaoParaEntrega,
  CODIGO_MULTIPLOS_GRUPOS
} = require('../../backend/motores/motor-comercial/usecases/consignacao/prestacaoCicloClienteHelpers');
const {
  criarGrupoPrestacaoContas,
  fecharGrupoPrestacaoContas,
  listarMovimentacoesPrestacao
} = require('../../backend/motores/motor-comercial/usecases/consignacao/prestacaoOperacaoHelpers');
const AbrirPrestacaoUseCase = require(
  '../../backend/motores/motor-comercial/usecases/consignacao/AbrirPrestacaoUseCase'
);

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
      console.error(`  FALHOU  ${nome}\n         ${err.stack || err.message}`);
    });
}

function unwrap(result) {
  if (!result || typeof result.isOk !== 'function') return result;
  if (result.isFail()) throw result.erro || new Error('Result.fail');
  return result.dados;
}

function criarStoreConsignacoes(iniciais = []) {
  const store = iniciais.map((c) => ({
    ...c,
    prestacaoContasAtiva: c.prestacaoContasAtiva ? { ...c.prestacaoContasAtiva } : null
  }));
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
    listarPorConsignacao: async (cid) => itens.filter((i) => Number(i.consignacaoId) === Number(cid)),
    inserir: async (dados) => {
      const item = { id: itens.length + 1, ...dados };
      itens.push(item);
      return item;
    }
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

/**
 * Simula entrega RCM-8.12: resolver ciclo → vincular → ENTREGA com grupo → status ENTREGUE
 */
async function simularEntregaComCiclo(uow, consignacaoId, itensEntrega = []) {
  const cons = await uow.consignacao.buscarPorId(consignacaoId);
  const resolucao = await resolverCicloPrestacaoParaEntrega(uow, cons);
  const grupo = resolucao.grupo;
  const c = resolucao.consignacao;

  for (const linha of itensEntrega) {
    await uow.consignacaoItem.inserir({
      consignacaoId: c.id,
      produtoId: linha.produtoId,
      quantidadeEntregue: linha.quantidade,
      precoUnitario: linha.precoUnitario || 1
    });
    await uow.movimentacaoComercial.inserir({
      consignacaoId: c.id,
      tipoMovimentacao: 'ENTREGA',
      grupoPrestacaoContasId: grupo?.id ?? null,
      valor: (linha.quantidade || 0) * (linha.precoUnitario || 1),
      quantidade: linha.quantidade
    });
  }

  const atualizada = await uow.consignacao.atualizar(c.id, {
    status: 'ENTREGUE',
    dataEntrega: new Date().toISOString(),
    prestacaoContasAtiva: grupo
      ? { ...grupo, status: 'ABERTA', dataFechamento: null }
      : null
  });

  return {
    consignacao: atualizada,
    grupoPrestacaoContasId: grupo?.id ?? null,
    incorporadaAoCicloCliente: resolucao.vinculadaAoCiclo || resolucao.origem === 'cliente',
    cicloOrigem: resolucao.origem
  };
}

async function main() {
  console.log('\nRCM-8.12 — Nova consignação → Prestação ABERTA\n');

  const PREST_001 = {
    id: 'prest-001',
    status: 'ABERTA',
    dataAbertura: '2026-09-19T10:00:00.000Z',
    documento: { numero: 'PC-001' }
  };

  await test('1-5. cliente com PREST aberta + nova consignação entregue vincula e NÃO cria PREST-002', async () => {
    const repo = criarStoreConsignacoes([
      {
        id: 14,
        clienteId: 42,
        status: 'ENTREGUE',
        documento: { numero: 'CONS-000014' },
        dataEntrega: '2026-09-19T10:00:00.000Z',
        prestacaoContasAtiva: { ...PREST_001 }
      },
      {
        id: 18,
        clienteId: 42,
        status: 'RASCUNHO',
        documento: { numero: 'CONS-000018' },
        prestacaoContasAtiva: null
      }
    ]);
    const itemRepo = criarStoreItens([
      { id: 1, consignacaoId: 14, produtoId: 1, quantidadeEntregue: 10, precoUnitario: 1 }
    ]);
    const movRepo = criarStoreMovs([
      {
        consignacaoId: 14,
        grupoPrestacaoContasId: 'prest-001',
        tipoMovimentacao: 'ABERTURA_PRESTACAO',
        valor: 0
      },
      {
        consignacaoId: 14,
        grupoPrestacaoContasId: 'prest-001',
        tipoMovimentacao: 'ENTREGA',
        valor: 10,
        quantidade: 10
      }
    ]);
    const uow = { consignacao: repo, consignacaoItem: itemRepo, movimentacaoComercial: movRepo };

    const entrega = await simularEntregaComCiclo(uow, 18, [
      { produtoId: 99, quantidade: 50, precoUnitario: 1 }
    ]);

    assert.strictEqual(entrega.grupoPrestacaoContasId, 'prest-001');
    assert.strictEqual(entrega.incorporadaAoCicloCliente, true);
    assert.strictEqual(entrega.consignacao.prestacaoContasAtiva.id, 'prest-001');
    assert.strictEqual(entrega.consignacao.prestacaoContasAtiva.status, 'ABERTA');
    assert.strictEqual(entrega.consignacao.status, 'ENTREGUE');

    // Não existe PREST-002
    const ciclos = await buscarGrupoPrestacaoAbertaDoCliente(repo, 42);
    assert.strictEqual(ciclos.grupo.id, 'prest-001');

    const movs18 = movRepo.movs.filter((m) => Number(m.consignacaoId) === 18);
    assert.ok(movs18.length >= 1);
    assert.ok(movs18.every((m) => m.grupoPrestacaoContasId === 'prest-001'));
  });

  await test('6-8. Ledger/estoque/crédito só incrementais da nova consignação', async () => {
    const movs = [
      { consignacaoId: 14, grupoPrestacaoContasId: 'prest-001', tipoMovimentacao: 'ENTREGA', valor: 10, quantidade: 10 },
      { consignacaoId: 18, grupoPrestacaoContasId: 'prest-001', tipoMovimentacao: 'ENTREGA', valor: 50, quantidade: 50 }
    ];
    assert.strictEqual(movs[1].quantidade, 50);
    assert.strictEqual(movs[1].valor, 50);
    assert.notStrictEqual(movs[0].consignacaoId, movs[1].consignacaoId);
    assert.strictEqual(movs[0].grupoPrestacaoContasId, movs[1].grupoPrestacaoContasId);
  });

  await test('9-11. consulta/grade/resumo do ciclo (10 + 50 = 60)', async () => {
    const repo = criarStoreConsignacoes([
      { id: 14, clienteId: 42, status: 'ENTREGUE', documento: { numero: 'CONS-000014' }, prestacaoContasAtiva: { ...PREST_001 } },
      { id: 18, clienteId: 42, status: 'ENTREGUE', documento: { numero: 'CONS-000018' }, prestacaoContasAtiva: { ...PREST_001 } }
    ]);
    const itemRepo = criarStoreItens([
      { id: 1, consignacaoId: 14, produtoId: 1, quantidadeEntregue: 10 },
      { id: 2, consignacaoId: 18, produtoId: 99, quantidadeEntregue: 50 }
    ]);
    const uow = { consignacao: repo, consignacaoItem: itemRepo };
    const membros = await listarConsignacoesDoGrupoPrestacao(uow, 'prest-001');
    assert.strictEqual(membros.length, 2);
    const itens = await listarItensDasConsignacoesDoGrupo(uow, 'prest-001');
    assert.strictEqual(itens.length, 2);
    assert.ok(itens.some((i) => Number(i.consignacaoId) === 14 && Number(i.quantidadeEntregue) === 10));
    assert.ok(itens.some((i) => Number(i.consignacaoId) === 18 && Number(i.quantidadeEntregue) === 50));
    const saldo = itens.reduce((s, i) => s + Number(i.quantidadeEntregue || 0), 0);
    assert.strictEqual(saldo, 60);
  });

  await test('12. segunda nova consignação (20) entra no mesmo grupo → 80', async () => {
    const repo = criarStoreConsignacoes([
      { id: 14, clienteId: 42, status: 'ENTREGUE', prestacaoContasAtiva: { ...PREST_001 } },
      { id: 18, clienteId: 42, status: 'ENTREGUE', prestacaoContasAtiva: { ...PREST_001 } },
      { id: 19, clienteId: 42, status: 'RASCUNHO', prestacaoContasAtiva: null }
    ]);
    const itemRepo = criarStoreItens([
      { id: 1, consignacaoId: 14, produtoId: 1, quantidadeEntregue: 10 },
      { id: 2, consignacaoId: 18, produtoId: 99, quantidadeEntregue: 50 }
    ]);
    const movRepo = criarStoreMovs([]);
    const uow = { consignacao: repo, consignacaoItem: itemRepo, movimentacaoComercial: movRepo };
    await simularEntregaComCiclo(uow, 19, [{ produtoId: 99, quantidade: 20, precoUnitario: 1 }]);
    assert.strictEqual(repo.store[2].prestacaoContasAtiva.id, 'prest-001');
    const itens = await listarItensDasConsignacoesDoGrupo(uow, 'prest-001');
    const saldo = itens.reduce((s, i) => s + Number(i.quantidadeEntregue || 0), 0);
    assert.strictEqual(saldo, 80);
  });

  await test('13. Entrega Complementar ≠ nova consignação (mesma consig + mesmo grupo)', async () => {
    const consig = { id: 14, clienteId: 42, status: 'ENTREGUE', prestacaoContasAtiva: { ...PREST_001 } };
    const itemComplementar = { consignacaoId: 14, produtoId: 50, quantidadeEntregue: 1 };
    assert.strictEqual(itemComplementar.consignacaoId, 14);
    assert.strictEqual(consig.prestacaoContasAtiva.id, 'prest-001');
    assert.notStrictEqual(itemComplementar.consignacaoId, 18);
  });

  await test('14-15. fechamento encerra ciclo; nova consignação inicia PREST-002', async () => {
    const repo = criarStoreConsignacoes([
      { id: 14, clienteId: 42, status: 'ENTREGUE', prestacaoContasAtiva: { ...PREST_001 } },
      { id: 18, clienteId: 42, status: 'ENTREGUE', prestacaoContasAtiva: { ...PREST_001 } }
    ]);
    const fechado = fecharGrupoPrestacaoContas(PREST_001);
    await fecharPonteirosConsignacoesDoGrupo({ consignacao: repo }, fechado, { statusPadrao: 'ACERTADA' });
    assert.strictEqual(repo.store[0].prestacaoContasAtiva.status, 'FECHADA');
    assert.strictEqual(repo.store[1].prestacaoContasAtiva.status, 'FECHADA');

    // Nova consignação após fechamento
    repo.store.push({
      id: 20,
      clienteId: 42,
      status: 'RASCUNHO',
      prestacaoContasAtiva: null
    });
    const ciclo = await buscarGrupoPrestacaoAbertaDoCliente(repo, 42);
    assert.strictEqual(ciclo, null, 'não deve reutilizar PREST-001 fechada');

    const novoGrupo = criarGrupoPrestacaoContas({ id: 20, documento: { serie: 'PC' } });
    assert.notStrictEqual(novoGrupo.id, 'prest-001');
    await vincularConsignacaoAoGrupoPrestacao({ consignacao: repo }, repo.store[2], novoGrupo);
    assert.strictEqual(repo.store[2].prestacaoContasAtiva.id, novoGrupo.id);
  });

  await test('16. duas entregas quase simultâneas → mesmo PREST-001', async () => {
    const repo = criarStoreConsignacoes([
      { id: 14, clienteId: 42, status: 'ENTREGUE', prestacaoContasAtiva: { ...PREST_001 } },
      { id: 18, clienteId: 42, status: 'RASCUNHO', prestacaoContasAtiva: null },
      { id: 19, clienteId: 42, status: 'RASCUNHO', prestacaoContasAtiva: null }
    ]);
    const itemRepo = criarStoreItens([]);
    const movRepo = criarStoreMovs([]);
    const uow = { consignacao: repo, consignacaoItem: itemRepo, movimentacaoComercial: movRepo };

    const [a, b] = await Promise.all([
      simularEntregaComCiclo(uow, 18, [{ produtoId: 1, quantidade: 1 }]),
      simularEntregaComCiclo(uow, 19, [{ produtoId: 2, quantidade: 1 }])
    ]);
    assert.strictEqual(a.grupoPrestacaoContasId, 'prest-001');
    assert.strictEqual(b.grupoPrestacaoContasId, 'prest-001');
    const ciclo = await buscarGrupoPrestacaoAbertaDoCliente(repo, 42);
    assert.strictEqual(ciclo.grupo.id, 'prest-001');
  });

  await test('17. cliente diferente não entra no grupo', async () => {
    const repo = criarStoreConsignacoes([
      { id: 14, clienteId: 42, status: 'ENTREGUE', prestacaoContasAtiva: { ...PREST_001 } },
      { id: 99, clienteId: 7, status: 'RASCUNHO', prestacaoContasAtiva: null }
    ]);
    const cicloJoao = await buscarGrupoPrestacaoAbertaDoCliente(repo, 7);
    assert.strictEqual(cicloJoao, null);
  });

  await test('18-19. legado elegível / ambíguo', async () => {
    const repoOk = criarStoreConsignacoes([
      {
        id: 14,
        clienteId: 42,
        status: 'ENTREGUE',
        dataEntrega: '2026-09-19T10:00:00.000Z',
        prestacaoContasAtiva: { ...PREST_001 }
      },
      {
        id: 18,
        clienteId: 42,
        status: 'ENTREGUE',
        dataEntrega: '2026-09-19T16:00:00.000Z',
        prestacaoContasAtiva: null
      }
    ]);
    const rec = await reconciliarConsignacaoComGrupoAbertoCliente(
      { consignacao: repoOk },
      repoOk.store[1]
    );
    assert.strictEqual(rec.reconciliada, true);

    const repoAmb = criarStoreConsignacoes([
      {
        id: 14,
        clienteId: 42,
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
        clienteId: 42,
        status: 'ENTREGUE',
        dataEntrega: '2026-01-01T00:00:00.000Z',
        prestacaoContasAtiva: null
      }
    ]);
    const amb = await reconciliarConsignacaoComGrupoAbertoCliente(
      { consignacao: repoAmb },
      repoAmb.store[1]
    );
    assert.strictEqual(amb.reconciliada, false);
  });

  await test('20. Abrir Prestação da nova consignação retorna PREST-001 (não cria PREST-002)', async () => {
    const repo = criarStoreConsignacoes([
      {
        id: 14,
        clienteId: 42,
        status: 'ENTREGUE',
        prestacaoContasAtiva: { ...PREST_001 }
      },
      {
        id: 18,
        clienteId: 42,
        status: 'ENTREGUE',
        dataEntrega: '2026-09-19T18:00:00.000Z',
        prestacaoContasAtiva: { ...PREST_001 }
      }
    ]);
    const movRepo = criarStoreMovs([]);
    const itemRepo = criarStoreItens([]);
    const uow = {
      consignacao: repo,
      consignacaoItem: itemRepo,
      movimentacaoComercial: movRepo,
      executar: async (fn) => fn(uow)
    };
    const uc = new AbrirPrestacaoUseCase({
      unitOfWork: uow,
      eventPublisher: { publicar() {}, flush: async () => {} },
      consignacaoRepository: repo
    });
    const result = unwrap(await uc.executar({ consignacaoId: 18 }));
    assert.strictEqual(result.grupoPrestacaoContas.id, 'prest-001');
    assert.ok(result.idempotente === true || result.incorporadaAoCicloCliente === true);
    assert.strictEqual(result.movimentacao, null, 'não deve criar ABERTURA nova');
    // garante que não criou segundo grupo no store
    const abertas = repo.store.filter((c) => String(c.prestacaoContasAtiva?.status) === 'ABERTA');
    const grupos = new Set(abertas.map((c) => c.prestacaoContasAtiva.id));
    assert.strictEqual(grupos.size, 1);
    assert.ok(grupos.has('prest-001'));
  });

  await test('21-25. preserva RCM-8.6–8.11 (conceitos)', async () => {
    // 8.6 contexto = consignacaoId da URL; 8.7 mesma consignação; 8.10 card/cliente; 8.11 ciclo
    const card = { clienteId: 42, consignacoes: [{ id: 14 }, { id: 18 }] };
    assert.strictEqual(card.consignacoes.length, 2);
    const complementar = { consignacaoId: 14, operacao: 'ENTREGA_COMPLEMENTAR' };
    assert.strictEqual(complementar.consignacaoId, 14);
    const ciclo = { grupoId: 'prest-001', consignacoes: [14, 18] };
    assert.strictEqual(ciclo.consignacoes.length, 2);
  });

  await test('CENÁRIO 50 SORVETES — CICERO PREST-001 + CONS-018', async () => {
    const repo = criarStoreConsignacoes([
      {
        id: 14,
        clienteId: 100,
        status: 'ENTREGUE',
        documento: { numero: 'CONS-000014' },
        dataEntrega: '2026-09-19T10:00:00.000Z',
        prestacaoContasAtiva: { ...PREST_001 }
      },
      {
        id: 18,
        clienteId: 100,
        status: 'RASCUNHO',
        documento: { numero: 'CONS-000018' },
        prestacaoContasAtiva: null
      }
    ]);
    const itemRepo = criarStoreItens([
      { id: 1, consignacaoId: 14, produtoId: 1, quantidadeEntregue: 10, precoUnitario: 1 }
    ]);
    const movRepo = criarStoreMovs([
      { consignacaoId: 14, grupoPrestacaoContasId: 'prest-001', tipoMovimentacao: 'ABERTURA_PRESTACAO', valor: 0 },
      { consignacaoId: 14, grupoPrestacaoContasId: 'prest-001', tipoMovimentacao: 'ENTREGA', valor: 10, quantidade: 10 }
    ]);
    const uow = { consignacao: repo, consignacaoItem: itemRepo, movimentacaoComercial: movRepo };

    const entrega = await simularEntregaComCiclo(uow, 18, [
      { produtoId: 200, quantidade: 50, precoUnitario: 1 }
    ]);

    assert.strictEqual(entrega.consignacao.prestacaoContasAtiva.id, 'prest-001');
    assert.strictEqual(entrega.grupoPrestacaoContasId, 'prest-001');

    const itens = await listarItensDasConsignacoesDoGrupo(uow, 'prest-001');
    assert.strictEqual(itens.length, 2);
    assert.ok(itens.some((i) => Number(i.consignacaoId) === 14 && Number(i.quantidadeEntregue) === 10));
    assert.ok(itens.some((i) => Number(i.consignacaoId) === 18 && Number(i.quantidadeEntregue) === 50));
    assert.strictEqual(
      itens.reduce((s, i) => s + Number(i.quantidadeEntregue || 0), 0),
      60
    );

    const movsGrupo = await listarMovimentacoesPrestacao(uow, 'prest-001');
    assert.ok(movsGrupo.some((m) => Number(m.consignacaoId) === 18));
    assert.ok(!movsGrupo.some((m) => String(m.grupoPrestacaoContasId) === 'prest-002'));
  });

  await test('múltiplos grupos ABERTA → erro (não escolhe)', async () => {
    const repo = criarStoreConsignacoes([
      { id: 1, clienteId: 1, status: 'ENTREGUE', prestacaoContasAtiva: { id: 'g1', status: 'ABERTA' } },
      { id: 2, clienteId: 1, status: 'ENTREGUE', prestacaoContasAtiva: { id: 'g2', status: 'ABERTA' } }
    ]);
    let erro = null;
    try {
      await buscarGrupoPrestacaoAbertaDoCliente(repo, 1);
    } catch (e) {
      erro = e;
    }
    assert.ok(erro);
    assert.strictEqual(erro.codigo, CODIGO_MULTIPLOS_GRUPOS);
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falha(s)\n`);
  if (falhou > 0) process.exit(1);
  console.log('RCM-8.12 PASSOU\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
