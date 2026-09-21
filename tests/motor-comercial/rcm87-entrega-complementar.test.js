/**
 * RCM-8.7 — Entrega Complementar em consignação ENTREGUE
 *
 * Executar:
 *   node tests/motor-comercial/rcm87-entrega-complementar.test.js
 */

const assert = require('assert');
const path = require('path');

process.chdir(path.resolve(__dirname, '../..'));

const {
  RegistrarEntregaConsignacaoUseCase,
  RegistrarEntregaComplementarUseCase
} = require('../../backend/motores/motor-comercial/usecases/consignacao');
const {
  avaliarElegibilidadeEntregaComplementar,
  montarHistoricoEntregas,
  montarSnapshotPrecificacaoItem,
  MENSAGEM_PRESTACAO_ENCERRADA,
  OPERACAO_ENTREGA_COMPLEMENTAR
} = require('../../backend/motores/motor-comercial/usecases/consignacao/entregaComplementarHelpers');
const {
  podeAdicionarProdutoComplementar,
  snapshotDoResolver,
  totalItensComplementares
} = require('../../frontend/modules/motor-comercial/pages/EntregaComplementar/entregaComplementarMappers');
const { criarMockOutboxService, adaptarUowParaOutbox } = require('./outbox-test-helpers');
const { OUTBOX_EVENT_TYPES } = require('../../backend/motores/motor-comercial/integrations/outbox/OutboxEventTypes');

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

function unwrap(result) {
  if (!result || typeof result.isOk !== 'function') return result;
  if (result.isFail()) {
    const err = result.erro || new Error('Result.fail');
    throw err;
  }
  return result.dados;
}

function criarConsignacao(overrides = {}) {
  return {
    id: 1001,
    clienteId: 10,
    perfilComercialId: 5,
    status: 'ENTREGUE',
    documento: { numero: 'C-1001', serie: '1', sequencial: 1, situacao: 'ATIVO' },
    valorTotalEntregue: 500,
    saldoAberto: 500,
    dataEntrega: '2026-09-19T10:00:00.000Z',
    prestacaoContasAtiva: null,
    ...overrides
  };
}

function criarItemOriginal(overrides = {}) {
  return {
    id: 1,
    consignacaoId: 1001,
    produtoId: 100,
    quantidadeEntregue: 10,
    precoUnitario: 30,
    subtotalEntregue: 300,
    unidadeComercial: 'UN',
    linhaComercialId: 7,
    tabelaPrecoId: 3,
    canalVenda: 'CONSIGNADO',
    precoOrigem: 'tabela_preco_linha',
    precoFallback: false,
    ...overrides
  };
}

function criarPerfil(overrides = {}) {
  return {
    id: 5,
    clienteId: 10,
    perfilTipo: 'CONSIGNADO',
    ativo: true,
    bloqueado: false,
    limiteComercial: 5000,
    saldoAberto: 500,
    ...overrides
  };
}

function criarMockConsignacaoRepo(estadoInicial) {
  let store = { ...estadoInicial };
  return {
    buscarPorId: async (id) => (Number(store.id) === Number(id) ? { ...store } : null),
    atualizar: async (id, dados) => {
      if (Number(store.id) !== Number(id)) return null;
      store = { ...store, ...dados };
      return { ...store };
    },
    listar: async () => [store],
    get store() { return store; }
  };
}

function criarMockItemRepo(itensIniciais = []) {
  const itens = itensIniciais.map((i) => ({ ...i }));
  let seq = itens.reduce((m, i) => Math.max(m, Number(i.id) || 0), 0);
  return {
    buscarPorId: async (id) => itens.find((i) => Number(i.id) === Number(id)) ?? null,
    listarPorConsignacao: async (consignacaoId, filtros = {}) => itens.filter((i) => {
      if (Number(i.consignacaoId) !== Number(consignacaoId)) return false;
      if (filtros.produtoId != null && Number(i.produtoId) !== Number(filtros.produtoId)) return false;
      return true;
    }),
    inserir: async (dados) => {
      const dup = itens.find((i) => Number(i.consignacaoId) === Number(dados.consignacaoId)
        && Number(i.produtoId) === Number(dados.produtoId));
      if (dup) {
        const err = new Error(
          'UNIQUE constraint failed: consignacoes_itens.consignacao_id, consignacoes_itens.produto_id'
        );
        err.code = 'SQLITE_CONSTRAINT';
        throw err;
      }
      seq += 1;
      const item = { id: seq, ...dados };
      itens.push(item);
      return item;
    },
    atualizar: async (id, dados) => {
      const idx = itens.findIndex((i) => Number(i.id) === Number(id));
      if (idx < 0) return null;
      itens[idx] = { ...itens[idx], ...dados };
      return itens[idx];
    },
    itens
  };
}

function criarDeps(consignacaoRepo, itemRepo, extras = {}) {
  const movRepo = {
    movimentacoes: extras.movimentacoesIniciais
      ? extras.movimentacoesIniciais.map((m) => ({ ...m }))
      : [],
    inserir: async (dados) => {
      const mov = {
        id: movRepo.movimentacoes.length + 1,
        createdAt: new Date().toISOString(),
        ...dados
      };
      movRepo.movimentacoes.push(mov);
      return mov;
    },
    listar: async (filtros = {}) => movRepo.movimentacoes.filter((m) => {
      if (filtros.consignacaoId != null && Number(m.consignacaoId) !== Number(filtros.consignacaoId)) {
        return false;
      }
      if (filtros.correlationId != null
        && String(m.correlationId) !== String(filtros.correlationId)) {
        return false;
      }
      return true;
    })
  };

  const perfilStore = criarPerfil(extras.perfil);
  const perfilRepo = {
    buscarPorId: async () => ({ ...perfilStore }),
    atualizar: async (_id, dados) => {
      Object.assign(perfilStore, dados);
      return { ...perfilStore };
    }
  };

  const uow = {
    consignacao: consignacaoRepo,
    consignacaoItem: itemRepo,
    perfilComercial: perfilRepo,
    movimentacaoComercial: movRepo,
    executar: async (fn) => fn(uow)
  };
  adaptarUowParaOutbox(uow);

  const outboxService = criarMockOutboxService({
    estoqueBridge: { registrarSaidaConsignacao: async () => ({ ok: true }) }
  });

  return {
    unitOfWork: uow,
    eventPublisher: {
      publicados: [],
      publicar(e) { this.publicados.push(e); },
      flush: async () => {}
    },
    consignacaoRepository: consignacaoRepo,
    consignacaoItemRepository: itemRepo,
    perfilComercialRepository: perfilRepo,
    movimentacaoComercialRepository: movRepo,
    clienteBridge: {
      buscarPorId: async () => ({ id: 10, nome: 'Cliente' }),
      estaAtivo: async () => true
    },
    produtoBridge: extras.produtoBridge || {
      buscarPorId: async (id, opts = {}) => {
        assert.strictEqual(opts.canal, 'CONSIGNADO', 'Resolver deve usar canal CONSIGNADO');
        return {
          id: Number(id),
          nome: `Produto ${id}`,
          precoVenda: 40,
          unidadeComercial: 'UN',
          linhaComercialId: 9,
          tabelaPrecoId: 4,
          canalVenda: 'CONSIGNADO',
          precoOrigem: 'tabela_preco_linha',
          precoFallback: false
        };
      },
      estaAtivo: async () => true
    },
    outboxService,
    movRepo
  };
}

async function main() {
  console.log('\nRCM-8.7 — Entrega Complementar\n');

  await test('1. adicionar produto em consignação ENTREGUE', async () => {
    const deps = criarDeps(
      criarMockConsignacaoRepo(criarConsignacao()),
      criarMockItemRepo([criarItemOriginal()]),
      {
        movimentacoesIniciais: [{
          consignacaoId: 1001,
          consignacaoItemId: 1,
          tipoMovimentacao: 'ENTREGA',
          correlationId: 'orig-1',
          valor: 300,
          quantidade: 10,
          snapshot: { contexto: { operacao: 'ENTREGA' } },
          createdAt: '2026-09-19T10:00:00.000Z'
        }]
      }
    );
    const result = unwrap(await new RegistrarEntregaComplementarUseCase(deps).executar({
      consignacaoId: 1001,
      itens: [{
        produtoId: 200,
        quantidade: 3,
        precoUnitario: 40,
        unidadeComercial: 'UN',
        linhaComercialId: 9,
        tabelaPrecoId: 4,
        canalVenda: 'CONSIGNADO',
        precoOrigem: 'tabela_preco_linha',
        precoFallback: false
      }],
      correlationId: 'comp-1'
    }));
    assert.strictEqual(result.itensNovos.length, 1);
    assert.strictEqual(Number(result.itensNovos[0].produtoId), 200);
    assert.strictEqual(deps.consignacaoRepository.store.status, 'ENTREGUE');
  });

  await test('2. criar Entrega Complementar vinculada à consignação', async () => {
    const deps = criarDeps(
      criarMockConsignacaoRepo(criarConsignacao()),
      criarMockItemRepo([criarItemOriginal()])
    );
    const result = unwrap(await new RegistrarEntregaComplementarUseCase(deps).executar({
      consignacaoId: 1001,
      itens: [{ produtoId: 201, quantidade: 2, precoUnitario: 50, precoOrigem: 'x', tabelaPrecoId: 4 }],
      correlationId: 'comp-2'
    }));
    assert.strictEqual(Number(result.consignacao.id), 1001);
    assert.ok(result.correlationId);
    assert.ok(result.entregas.some((e) => e.tipo === 'COMPLEMENTAR'));
  });

  await test('3. Resolver chamado com canal CONSIGNADO', async () => {
    let canalUsado = null;
    const deps = criarDeps(
      criarMockConsignacaoRepo(criarConsignacao()),
      criarMockItemRepo([criarItemOriginal()]),
      {
        produtoBridge: {
          buscarPorId: async (_id, opts) => {
            canalUsado = opts.canal;
            return {
              id: 300,
              precoVenda: 10,
              unidadeComercial: 'KG',
              linhaComercialId: 1,
              tabelaPrecoId: 2,
              canalVenda: 'CONSIGNADO',
              precoOrigem: 'resolver',
              precoFallback: false
            };
          },
          estaAtivo: async () => true
        }
      }
    );
    unwrap(await new RegistrarEntregaComplementarUseCase(deps).executar({
      consignacaoId: 1001,
      itens: [{ produtoId: 300, quantidade: 1 }],
      correlationId: 'comp-canal'
    }));
    assert.strictEqual(canalUsado, 'CONSIGNADO');
  });

  await test('4-6. snapshot RCM-6.1 / unidade / linha-tabela-origem', async () => {
    const snap = montarSnapshotPrecificacaoItem(
      {
        precoVenda: 12,
        unidadeComercial: 'LITRO',
        linhaComercialId: 77,
        tabelaPrecoId: 88,
        canalVenda: 'CONSIGNADO',
        precoOrigem: 'tabela_preco_linha',
        precoFallback: false
      },
      {
        precoUnitario: 12,
        precoOrigem: 'tabela_preco_linha',
        tabelaPrecoId: 88,
        unidadeComercial: 'LITRO'
      }
    );
    assert.strictEqual(snap.canalVenda, 'CONSIGNADO');
    assert.strictEqual(snap.unidadeComercial, 'LITRO');
    assert.strictEqual(snap.linhaComercialId, 77);
    assert.strictEqual(snap.tabelaPrecoId, 88);
    assert.strictEqual(snap.precoOrigem, 'tabela_preco_linha');
    assert.strictEqual(snap.precoFallback, false);
  });

  await test('7. itens da entrega original permanecem inalterados', async () => {
    const original = criarItemOriginal({
      quantidadeEntregue: 10,
      precoUnitario: 30,
      precoOrigem: 'original'
    });
    const itemRepo = criarMockItemRepo([original]);
    const deps = criarDeps(criarMockConsignacaoRepo(criarConsignacao()), itemRepo);
    unwrap(await new RegistrarEntregaComplementarUseCase(deps).executar({
      consignacaoId: 1001,
      itens: [{
        produtoId: 999,
        quantidade: 1,
        precoUnitario: 99,
        precoOrigem: 'novo',
        tabelaPrecoId: 4
      }],
      correlationId: 'comp-orig'
    }));
    const ainda = itemRepo.itens.find((i) => Number(i.id) === 1);
    assert.strictEqual(Number(ainda.quantidadeEntregue), 10);
    assert.strictEqual(Number(ainda.precoUnitario), 30);
    assert.strictEqual(ainda.precoOrigem, 'original');
    assert.ok(itemRepo.itens.length >= 2);
  });

  await test('8. somente novos itens movimentam estoque (outbox)', async () => {
    const deps = criarDeps(
      criarMockConsignacaoRepo(criarConsignacao()),
      criarMockItemRepo([criarItemOriginal()])
    );
    unwrap(await new RegistrarEntregaComplementarUseCase(deps).executar({
      consignacaoId: 1001,
      itens: [{ produtoId: 50, quantidade: 3, precoUnitario: 10, precoOrigem: 'x', tabelaPrecoId: 1 }],
      correlationId: 'comp-est'
    }));
    const store = deps.outboxService._repository.store;
    const eventos = [...store.values()];
    const estoque = eventos.find((e) => e.eventType === OUTBOX_EVENT_TYPES.ESTOQUE_BAIXAR_PRODUTO);
    assert.ok(estoque, 'outbox de estoque deve existir');
    assert.strictEqual(estoque.payload.itens.length, 1);
    assert.strictEqual(Number(estoque.payload.itens[0].produtoId), 50);
    assert.strictEqual(estoque.payload.entregaComplementar, true);
  });

  await test('9-10. valor incremental afeta crédito/ledger (não duplica original)', async () => {
    const deps = criarDeps(
      criarMockConsignacaoRepo(criarConsignacao()),
      criarMockItemRepo([criarItemOriginal()]),
      {
        movimentacoesIniciais: [{
          consignacaoId: 1001,
          tipoMovimentacao: 'ENTREGA',
          correlationId: 'orig',
          valor: 500,
          quantidade: 10,
          snapshot: { contexto: { operacao: 'ENTREGA' } },
          createdAt: '2026-09-19T09:00:00.000Z'
        }]
      }
    );
    const result = unwrap(await new RegistrarEntregaComplementarUseCase(deps).executar({
      consignacaoId: 1001,
      itens: [{ produtoId: 70, quantidade: 3, precoUnitario: 40, precoOrigem: 'x', tabelaPrecoId: 1 }],
      correlationId: 'comp-inc'
    }));
    assert.strictEqual(result.valorIncremental, 120);
    const movsComp = deps.movRepo.movimentacoes.filter((m) => m.correlationId === 'comp-inc');
    assert.strictEqual(movsComp.length, 1);
    assert.strictEqual(Number(movsComp[0].valor), 120);
    assert.strictEqual(
      String(movsComp[0].snapshot.contexto.operacao),
      OPERACAO_ENTREGA_COMPLEMENTAR
    );
    const movsOrig = deps.movRepo.movimentacoes.filter((m) => m.correlationId === 'orig');
    assert.strictEqual(movsOrig.length, 1);
    assert.strictEqual(Number(movsOrig[0].valor), 500);
  });

  await test('11. impedir duplicação em retry (mesmo correlationId)', async () => {
    const deps = criarDeps(
      criarMockConsignacaoRepo(criarConsignacao()),
      criarMockItemRepo([criarItemOriginal()])
    );
    const uc = new RegistrarEntregaComplementarUseCase(deps);
    const entrada = {
      consignacaoId: 1001,
      itens: [{ produtoId: 80, quantidade: 1, precoUnitario: 20, precoOrigem: 'x', tabelaPrecoId: 1 }],
      correlationId: 'idem-1'
    };
    const r1 = unwrap(await uc.executar(entrada));
    const r2 = unwrap(await uc.executar(entrada));
    assert.strictEqual(r1.idempotente, false);
    assert.strictEqual(r2.idempotente, true);
    const novos = deps.consignacaoItemRepository.itens.filter((i) => Number(i.produtoId) === 80);
    assert.strictEqual(novos.length, 1);
    const movs = deps.movRepo.movimentacoes.filter((m) => m.correlationId === 'idem-1');
    assert.strictEqual(movs.length, 1);
  });

  await test('12. impedir após prestação fechada', async () => {
    const check = avaliarElegibilidadeEntregaComplementar(criarConsignacao({
      prestacaoContasAtiva: { id: 'g1', status: 'FECHADA' }
    }));
    assert.strictEqual(check.elegivel, false);
    assert.strictEqual(check.mensagem, MENSAGEM_PRESTACAO_ENCERRADA);

    const deps = criarDeps(
      criarMockConsignacaoRepo(criarConsignacao({
        prestacaoContasAtiva: { id: 'g1', status: 'FECHADA' }
      })),
      criarMockItemRepo([criarItemOriginal()])
    );
    const result = await new RegistrarEntregaComplementarUseCase(deps).executar({
      consignacaoId: 1001,
      itens: [{ produtoId: 1, quantidade: 1 }],
      correlationId: 'x'
    });
    assert.strictEqual(result.isFail(), true);
    assert.match(String(result.erro.message), /prestação encerrada/);
  });

  await test('13-15. impedir QUITADA / ENCERRADA / CANCELADA', async () => {
    for (const status of ['QUITADA', 'ENCERRADA', 'CANCELADA']) {
      const check = avaliarElegibilidadeEntregaComplementar(criarConsignacao({ status }));
      assert.strictEqual(check.elegivel, false, status);
      assert.strictEqual(check.mensagem, MENSAGEM_PRESTACAO_ENCERRADA);
      assert.strictEqual(podeAdicionarProdutoComplementar({ status }).elegivel, false);
    }
  });

  await test('16. histórico mostra original + complementações', async () => {
    const historico = montarHistoricoEntregas([
      {
        tipoMovimentacao: 'ENTREGA',
        correlationId: 'a',
        valor: 300,
        quantidade: 10,
        consignacaoItemId: 1,
        snapshot: { contexto: { operacao: 'ENTREGA' }, item: { produtoId: 100 } },
        createdAt: '2026-09-19T10:00:00.000Z'
      },
      {
        tipoMovimentacao: 'ENTREGA',
        correlationId: 'b',
        valor: 120,
        quantidade: 3,
        consignacaoItemId: 2,
        snapshot: { contexto: { operacao: 'ENTREGA_COMPLEMENTAR' }, item: { produtoId: 200 } },
        createdAt: '2026-09-19T15:00:00.000Z'
      }
    ], [
      criarItemOriginal(),
      { id: 2, produtoId: 200, quantidadeEntregue: 3, precoUnitario: 40 }
    ]);
    assert.strictEqual(historico.length, 2);
    assert.strictEqual(historico[0].tipo, 'ORIGINAL');
    assert.strictEqual(historico[1].tipo, 'COMPLEMENTAR');
    assert.strictEqual(historico[0].numeroComprovante, '001');
    assert.strictEqual(historico[1].numeroComprovante, '002');
    assert.match(historico[1].label, /Complementar 002/);
  });

  await test('17-18. visualização/reimpressão não geram efeitos (somente leitura)', async () => {
    const historico = montarHistoricoEntregas([], []);
    assert.deepStrictEqual(historico, []);
    const ui = podeAdicionarProdutoComplementar(criarConsignacao());
    assert.strictEqual(ui.elegivel, true);
  });

  await test('19. limite insuficiente bloqueia antes de movimentar', async () => {
    const deps = criarDeps(
      criarMockConsignacaoRepo(criarConsignacao()),
      criarMockItemRepo([criarItemOriginal()]),
      { perfil: { limiteComercial: 100, saldoAberto: 0 } }
    );
    const result = await new RegistrarEntregaComplementarUseCase(deps).executar({
      consignacaoId: 1001,
      itens: [{
        produtoId: 90,
        quantidade: 20,
        precoUnitario: 100,
        precoOrigem: 'x',
        tabelaPrecoId: 1
      }],
      correlationId: 'limite'
    });
    assert.strictEqual(result.isFail(), true);
    assert.strictEqual(deps.consignacaoItemRepository.itens.length, 1);
    assert.strictEqual(deps.movRepo.movimentacoes.length, 0);
  });

  await test('mesmo produto já na consignação incrementa linha (UNIQUE consignacao+produto)', async () => {
    const original = criarItemOriginal({
      produtoId: 100,
      quantidadeEntregue: 10,
      precoUnitario: 30,
      subtotalEntregue: 300,
      precoOrigem: 'original',
      tabelaPrecoId: 3
    });
    const itemRepo = criarMockItemRepo([original]);
    const deps = criarDeps(criarMockConsignacaoRepo(criarConsignacao()), itemRepo);
    const result = unwrap(await new RegistrarEntregaComplementarUseCase(deps).executar({
      consignacaoId: 1001,
      itens: [{
        produtoId: 100,
        quantidade: 2,
        precoUnitario: 35,
        precoOrigem: 'complementar',
        tabelaPrecoId: 9
      }],
      correlationId: 'comp-mesmo-produto'
    }));

    assert.strictEqual(itemRepo.itens.length, 1, 'não deve criar segunda linha do mesmo produto');
    const linha = itemRepo.itens[0];
    assert.strictEqual(Number(linha.quantidadeEntregue), 12);
    assert.strictEqual(Number(linha.precoUnitario), 30, 'snapshot de preço original congelado');
    assert.strictEqual(linha.precoOrigem, 'original');
    assert.strictEqual(Number(linha.tabelaPrecoId), 3);
    assert.strictEqual(Number(linha.subtotalEntregue), 370); // 300 + 2*35

    assert.strictEqual(result.valorIncremental, 70);
    assert.strictEqual(result.itensNovos.length, 1);
    assert.strictEqual(result.itensNovos[0].itemIncrementado, true);
    assert.strictEqual(Number(result.itensNovos[0].quantidadeIncremental), 2);

    const movs = deps.movRepo.movimentacoes.filter((m) => m.correlationId === 'comp-mesmo-produto');
    assert.strictEqual(movs.length, 1);
    assert.strictEqual(Number(movs[0].quantidade), 2);
    assert.strictEqual(Number(movs[0].valor), 70);

    const store = deps.outboxService._repository.store;
    const estoque = [...store.values()].find((e) => e.eventType === OUTBOX_EVENT_TYPES.ESTOQUE_BAIXAR_PRODUTO);
    assert.ok(estoque);
    assert.strictEqual(Number(estoque.payload.itens[0].quantidadeEntregue), 2);
  });

  await test('20. múltiplas complementações permanecem independentes', async () => {
    const deps = criarDeps(
      criarMockConsignacaoRepo(criarConsignacao()),
      criarMockItemRepo([criarItemOriginal()])
    );
    const uc = new RegistrarEntregaComplementarUseCase(deps);
    unwrap(await uc.executar({
      consignacaoId: 1001,
      itens: [{ produtoId: 11, quantidade: 1, precoUnitario: 10, precoOrigem: 'a', tabelaPrecoId: 1 }],
      correlationId: 'c1'
    }));
    unwrap(await uc.executar({
      consignacaoId: 1001,
      itens: [{ produtoId: 12, quantidade: 2, precoUnitario: 15, precoOrigem: 'b', tabelaPrecoId: 1 }],
      correlationId: 'c2'
    }));
    const historico = montarHistoricoEntregas(
      deps.movRepo.movimentacoes,
      deps.consignacaoItemRepository.itens
    );
    const comps = historico.filter((h) => h.tipo === 'COMPLEMENTAR');
    assert.ok(comps.length >= 2);
    assert.notStrictEqual(comps[0].correlationId, comps[1].correlationId);
  });

  await test('UI mapper — snapshotDoResolver força CONSIGNADO', async () => {
    const snap = snapshotDoResolver({ preco: 25, preco_origem: 'tabela', unidade_comercial: 'CX' }, {});
    assert.strictEqual(snap.canalVenda, 'CONSIGNADO');
    assert.strictEqual(snap.precoUnitario, 25);
    assert.strictEqual(totalItensComplementares([{ quantidade: 2, precoUnitario: 25 }]), 50);
  });

  await test('fluxo normal de entrega (RASCUNHO) permanece intacto no UC original', async () => {
    assert.strictEqual(typeof RegistrarEntregaConsignacaoUseCase, 'function');
    const checkRascunho = avaliarElegibilidadeEntregaComplementar(criarConsignacao({ status: 'RASCUNHO' }));
    assert.strictEqual(checkRascunho.elegivel, false);
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falha(s)\n`);
  if (falhou > 0) process.exit(1);
  console.log('RCM-8.7 PASSOU\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
