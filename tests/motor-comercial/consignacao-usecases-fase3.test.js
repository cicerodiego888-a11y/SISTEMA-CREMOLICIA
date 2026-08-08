/**
 * Testes — Use Cases Consignacao Fase 3 (Sprint 2.4.3 — Prestação de Contas)
 * Executar: npm run test:motor-comercial-consignacao-fase3
 */

const assert = require('assert');
const {
  AbrirPrestacaoUseCase,
  RegistrarVendaPrestacaoUseCase,
  RegistrarPerdaUseCase,
  RegistrarCortesiaUseCase,
  RegistrarPagamentoPrestacaoUseCase,
  FecharPrestacaoUseCase,
  ReabrirPrestacaoUseCase,
  ConsultarPrestacaoUseCase,
  ConsultarResumoPrestacaoUseCase
} = require('../../backend/motores/motor-comercial/usecases/consignacao');
const { EVENTOS_DOMINIO } = require('../../backend/motores/motor-comercial/events/comercialEventosTipos');
const { criarMockOutboxService, adaptarUowParaOutbox } = require('./outbox-test-helpers');

let passou = 0;
let falhou = 0;

function test(nome, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => { passou += 1; console.log(`  OK  ${nome}`); })
    .catch((err) => { falhou += 1; console.error(`  FALHOU  ${nome}\n         ${err.message}`); });
}

function criarConsignacao(overrides = {}) {
  return {
    id: 1,
    clienteId: 10,
    perfilComercialId: 5,
    status: 'ENTREGUE',
    documento: { numero: 'C001', serie: '1', sequencial: 1, situacao: 'ATIVO' },
    prestacaoContasAtiva: null,
    valorTotalEntregue: 100,
    valorTotalAcertado: 0,
    valorTotalPago: 0,
    saldoAberto: 100,
    dataEntrega: '2026-06-01T10:00:00.000Z',
    ...overrides
  };
}

function criarItem(overrides = {}) {
  return {
    id: 1,
    consignacaoId: 1,
    produtoId: 100,
    quantidadeEntregue: 10,
    quantidadeDevolvida: 0,
    quantidadeVendida: 0,
    quantidadePerdida: 0,
    quantidadeCortesia: 0,
    precoUnitario: 10,
    subtotalEntregue: 100,
    subtotalAcertado: 0,
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
    limiteComercial: 10000,
    saldoAberto: 100,
    ...overrides
  };
}

function criarMockConsignacaoRepo(estadoInicial = null) {
  let store = estadoInicial ? { ...estadoInicial } : null;
  const todos = estadoInicial ? [{ ...estadoInicial }] : [];
  return {
    buscarPorId: async (id) => {
      const found = store?.id === id ? store : todos.find((c) => c.id === id);
      return found ? { ...found, prestacaoContasAtiva: found.prestacaoContasAtiva ? { ...found.prestacaoContasAtiva } : null } : null;
    },
    listar: async (filtros = {}) => todos.filter((c) => {
      if (filtros.clienteId != null && c.clienteId !== filtros.clienteId) return false;
      if (filtros.status && c.status !== filtros.status) return false;
      if (filtros.perfilComercialId != null && c.perfilComercialId !== filtros.perfilComercialId) return false;
      return true;
    }),
    inserir: async (dados) => {
      store = { id: todos.length + 1, ...dados };
      todos.push({ ...store });
      return { ...store };
    },
    atualizar: async (id, dados) => {
      const idx = todos.findIndex((c) => c.id === id);
      const base = idx >= 0 ? todos[idx] : store;
      if (!base) return null;
      const patch = { ...dados };
      if (patch.documento) {
        base.documento = { ...base.documento, ...patch.documento };
        delete patch.documento;
      }
      if (patch.prestacaoContasAtiva) {
        base.prestacaoContasAtiva = { ...patch.prestacaoContasAtiva };
        delete patch.prestacaoContasAtiva;
      }
      const atualizado = { ...base, ...patch };
      if (idx >= 0) todos[idx] = atualizado;
      if (store?.id === id) store = atualizado;
      return { ...atualizado, prestacaoContasAtiva: atualizado.prestacaoContasAtiva ? { ...atualizado.prestacaoContasAtiva } : null };
    },
    todos,
    get store() { return store; }
  };
}

function criarMockItemRepo(itensIniciais = []) {
  const itens = itensIniciais.map((i) => ({ ...i }));
  let seq = itens.length;
  return {
    buscarPorId: async (id) => itens.find((i) => i.id === id) ?? null,
    listarPorConsignacao: async (consignacaoId, filtros = {}) => itens.filter((i) => {
      if (i.consignacaoId !== consignacaoId) return false;
      if (filtros.produtoId != null && i.produtoId !== filtros.produtoId) return false;
      return true;
    }),
    inserir: async (dados) => {
      seq += 1;
      const item = { id: seq, ...dados };
      itens.push(item);
      return item;
    },
    atualizar: async (id, dados) => {
      const idx = itens.findIndex((i) => i.id === id);
      if (idx < 0) return null;
      itens[idx] = { ...itens[idx], ...dados };
      return itens[idx];
    },
    itens
  };
}

function criarMockPerfilRepo(perfil = criarPerfil()) {
  let store = { ...perfil };
  return {
    buscarPorId: async (id) => (store.id === id ? { ...store } : null),
    atualizar: async (id, dados) => {
      if (store.id !== id) return null;
      store = { ...store, ...dados };
      return { ...store };
    },
    get store() { return store; }
  };
}

function criarMockMovRepo(sementeEntrega = true) {
  const movimentacoes = [];
  if (sementeEntrega) {
    movimentacoes.push({
      id: 1,
      consignacaoId: 1,
      tipoMovimentacao: 'ENTREGA',
      valor: 100,
      dataMovimentacao: '2026-06-01T09:00:00.000Z'
    });
  }
  return {
    inserir: async (dados) => {
      const mov = { id: movimentacoes.length + 1, ...dados };
      movimentacoes.push(mov);
      return mov;
    },
    listar: async (filtros = {}) => movimentacoes.filter((m) => {
      if (filtros.consignacaoId != null && m.consignacaoId !== filtros.consignacaoId) return false;
      if (filtros.grupoPrestacaoContasId && m.grupoPrestacaoContasId !== filtros.grupoPrestacaoContasId) return false;
      if (filtros.tipoMovimentacao && m.tipoMovimentacao !== filtros.tipoMovimentacao) return false;
      return true;
    }),
    movimentacoes
  };
}

function criarMockUow(consignacaoRepo, itemRepo, perfilRepo, movRepo, opcoes = {}) {
  const uow = {
    consignacao: consignacaoRepo,
    consignacaoItem: itemRepo,
    perfilComercial: perfilRepo,
    movimentacaoComercial: movRepo,
    executar: async (fn) => {
      if (opcoes.falhar) throw new Error('rollback');
      return fn(uow);
    }
  };
  return uow;
}

function criarDepsPrestacao(consignacaoRepo, itemRepo, perfilRepo, movRepo, extras = {}) {
  const publisher = { publicados: [], publicar: (e) => publisher.publicados.push(e), flush: async () => {} };
  const financeiroBridge = extras.financeiroBridge ?? {
    registrarReceitaConsignacao: async () => ({ ok: true }),
    registrarRecebimento: async () => ({ ok: true }),
    registrarPerda: async () => ({ ok: true })
  };
  const outboxService = criarMockOutboxService({ financeiroBridge });
  const uow = criarMockUow(consignacaoRepo, itemRepo, perfilRepo, movRepo, extras);
  adaptarUowParaOutbox(uow, outboxService);

  return {
    unitOfWork: uow,
    eventPublisher: publisher,
    consignacaoRepository: consignacaoRepo,
    consignacaoItemRepository: itemRepo,
    perfilComercialRepository: perfilRepo,
    movimentacaoComercialRepository: movRepo,
    financeiroBridge,
    outboxService,
    publisher
  };
}

async function abrirPrestacao(deps, consignacaoId = 1) {
  return new AbrirPrestacaoUseCase(deps).executar({
    consignacaoId,
    correlationId: 'corr-abertura-test'
  });
}

async function run() {
  console.log('\n=== Testes Use Cases Consignacao Fase 3 — Sprint 2.4.3 ===\n');

  await test('UC-019 AbrirPrestacao — fluxo feliz', async () => {
    const consignacaoRepo = criarMockConsignacaoRepo(criarConsignacao());
    const itemRepo = criarMockItemRepo([criarItem()]);
    const movRepo = criarMockMovRepo();
    const deps = criarDepsPrestacao(consignacaoRepo, itemRepo, criarMockPerfilRepo(), movRepo);

    const result = await abrirPrestacao(deps);
    assert.strictEqual(result.isOk(), true);
    assert.strictEqual(result.dados.grupoPrestacaoContas.status, 'ABERTA');
    const abertura = movRepo.movimentacoes.find((m) => m.tipoMovimentacao === 'ABERTURA_PRESTACAO');
    assert.ok(abertura);
    assert.ok(abertura.snapshot?.grupoPrestacaoContas);
    assert.ok(abertura.snapshot?.documento);
    assert.strictEqual(deps.publisher.publicados[0].tipo, EVENTOS_DOMINIO.PRESTACAO_ABERTA);
  });

  await test('UC-019 AbrirPrestacao — prestação já aberta (idempotente)', async () => {
    const consignacaoRepo = criarMockConsignacaoRepo(criarConsignacao({
      prestacaoContasAtiva: { id: 'p1', status: 'ABERTA' }
    }));
    const deps = criarDepsPrestacao(
      consignacaoRepo,
      criarMockItemRepo([criarItem()]),
      criarMockPerfilRepo(),
      criarMockMovRepo()
    );
    const result = await abrirPrestacao(deps);
    assert.strictEqual(result.isOk(), true);
    assert.strictEqual(result.dados.idempotente, true);
    assert.strictEqual(result.dados.grupoPrestacaoContas.status, 'ABERTA');
  });

  await test('UC-020 RegistrarVenda — fluxo feliz (ledger + evento; sem receita espelhada)', async () => {
    // STAB-06 / PLATFORM-02.1: efeitos financeiros oficiais ficam no núcleo criarVenda.
    // Esta UC não enfileira FINANCEIRO_LANCAR_RECEITA (evita venda paralela).
    const consignacaoRepo = criarMockConsignacaoRepo(criarConsignacao());
    const itemRepo = criarMockItemRepo([criarItem()]);
    const perfilRepo = criarMockPerfilRepo();
    const movRepo = criarMockMovRepo();
    let receitaChamada = false;
    const deps = criarDepsPrestacao(consignacaoRepo, itemRepo, perfilRepo, movRepo, {
      financeiroBridge: {
        registrarReceitaConsignacao: async () => { receitaChamada = true; return { ok: true }; }
      }
    });

    await abrirPrestacao(deps);
    const result = await new RegistrarVendaPrestacaoUseCase(deps).executar({
      consignacaoId: 1,
      produtoId: 100,
      quantidade: 3
    });

    assert.strictEqual(result.isOk(), true);
    assert.strictEqual(receitaChamada, false);
    assert.strictEqual(itemRepo.itens[0].quantidadeVendida, 3);
    assert.strictEqual(movRepo.movimentacoes.some((m) => m.tipoMovimentacao === 'VENDA_PRESTACAO'), true);
    assert.strictEqual(deps.publisher.publicados.some((e) => e.tipo === EVENTOS_DOMINIO.VENDA_PRESTACAO_REGISTRADA), true);
    assert.strictEqual(perfilRepo.store.saldoAberto, 100);
  });

  await test('UC-020 RegistrarVenda — quantidade superior ao saldo', async () => {
    const consignacaoRepo = criarMockConsignacaoRepo(criarConsignacao());
    const itemRepo = criarMockItemRepo([criarItem()]);
    const deps = criarDepsPrestacao(consignacaoRepo, itemRepo, criarMockPerfilRepo(), criarMockMovRepo());
    await abrirPrestacao(deps);

    const result = await new RegistrarVendaPrestacaoUseCase(deps).executar({
      consignacaoId: 1,
      produtoId: 100,
      quantidade: 20
    });
    assert.strictEqual(result.isFail(), true);
  });

  await test('UC-021 RegistrarPerda — fluxo feliz', async () => {
    const deps = criarDepsPrestacao(
      criarMockConsignacaoRepo(criarConsignacao()),
      criarMockItemRepo([criarItem()]),
      criarMockPerfilRepo(),
      criarMockMovRepo()
    );
    await abrirPrestacao(deps);

    const result = await new RegistrarPerdaUseCase(deps).executar({
      consignacaoId: 1,
      produtoId: 100,
      quantidade: 2
    });
    assert.strictEqual(result.isOk(), true);
    assert.strictEqual(deps.publisher.publicados.some((e) => e.tipo === EVENTOS_DOMINIO.PERDA_REGISTRADA), true);
  });

  await test('UC-022 RegistrarCortesia — fluxo feliz', async () => {
    const deps = criarDepsPrestacao(
      criarMockConsignacaoRepo(criarConsignacao()),
      criarMockItemRepo([criarItem()]),
      criarMockPerfilRepo(),
      criarMockMovRepo()
    );
    await abrirPrestacao(deps);

    const result = await new RegistrarCortesiaUseCase(deps).executar({
      consignacaoId: 1,
      produtoId: 100,
      quantidade: 1
    });
    assert.strictEqual(result.isOk(), true);
    assert.strictEqual(deps.publisher.publicados.some((e) => e.tipo === EVENTOS_DOMINIO.CORTESIA_REGISTRADA), true);
  });

  await test('UC-023 RegistrarPagamento — fluxo feliz', async () => {
    const consignacaoRepo = criarMockConsignacaoRepo(criarConsignacao());
    const deps = criarDepsPrestacao(
      consignacaoRepo,
      criarMockItemRepo([criarItem()]),
      criarMockPerfilRepo(),
      criarMockMovRepo()
    );
    await abrirPrestacao(deps);
    await new RegistrarVendaPrestacaoUseCase(deps).executar({
      consignacaoId: 1,
      produtoId: 100,
      quantidade: 5
    });

    const result = await new RegistrarPagamentoPrestacaoUseCase(deps).executar({
      consignacaoId: 1,
      valor: 50
    });
    assert.strictEqual(result.isOk(), true);
    assert.strictEqual(result.dados.totais.saldo, 0);
    assert.strictEqual(deps.publisher.publicados.some((e) => e.tipo === EVENTOS_DOMINIO.PAGAMENTO_PRESTACAO_REGISTRADO), true);
  });

  await test('UC-023 RegistrarPagamento — maior que o devido gera saldo credor', async () => {
    const deps = criarDepsPrestacao(
      criarMockConsignacaoRepo(criarConsignacao()),
      criarMockItemRepo([criarItem()]),
      criarMockPerfilRepo(),
      criarMockMovRepo()
    );
    await abrirPrestacao(deps);
    await new RegistrarVendaPrestacaoUseCase(deps).executar({
      consignacaoId: 1,
      produtoId: 100,
      quantidade: 2
    });

    const result = await new RegistrarPagamentoPrestacaoUseCase(deps).executar({
      consignacaoId: 1,
      valor: 100
    });
    assert.strictEqual(result.isOk(), true);
    assert.strictEqual(result.dados.totais.saldo, -80);
    assert.ok(deps.publisher.publicados.some((e) => e.tipo === EVENTOS_DOMINIO.CREDITO_COMERCIAL_RECALCULADO));
  });

  await test('UC-023 RegistrarPagamento — parcial permitido', async () => {
    const deps = criarDepsPrestacao(
      criarMockConsignacaoRepo(criarConsignacao()),
      criarMockItemRepo([criarItem()]),
      criarMockPerfilRepo(),
      criarMockMovRepo()
    );
    await abrirPrestacao(deps);
    await new RegistrarVendaPrestacaoUseCase(deps).executar({
      consignacaoId: 1,
      produtoId: 100,
      quantidade: 5
    });

    const result = await new RegistrarPagamentoPrestacaoUseCase(deps).executar({
      consignacaoId: 1,
      valor: 20
    });
    assert.strictEqual(result.isOk(), true);
    assert.strictEqual(result.dados.totais.saldo, 30);
  });

  await test('UC-023 RegistrarPagamento — recupera ponteiro de grupo com vendas (append-only)', async () => {
    const consignacaoRepo = criarMockConsignacaoRepo(criarConsignacao({
      prestacaoContasAtiva: {
        id: 'grupo-novo-vazio',
        status: 'ABERTA',
        documento: { numero: 'PC-NOVO' }
      }
    }));
    const movRepo = criarMockMovRepo();
    movRepo.movimentacoes.push(
      {
        id: 10,
        consignacaoId: 1,
        tipoMovimentacao: 'ABERTURA_PRESTACAO',
        grupoPrestacaoContasId: 'grupo-antigo-com-venda',
        dataMovimentacao: '2026-06-01T10:00:00.000Z'
      },
      {
        id: 11,
        consignacaoId: 1,
        tipoMovimentacao: 'VENDA_PRESTACAO',
        grupoPrestacaoContasId: 'grupo-antigo-com-venda',
        valor: 45,
        dataMovimentacao: '2026-06-01T10:05:00.000Z'
      },
      {
        id: 12,
        consignacaoId: 1,
        tipoMovimentacao: 'ABERTURA_PRESTACAO',
        grupoPrestacaoContasId: 'grupo-novo-vazio',
        dataMovimentacao: '2026-06-01T11:00:00.000Z'
      }
    );

    const deps = criarDepsPrestacao(
      consignacaoRepo,
      criarMockItemRepo([criarItem({ quantidadeVendida: 45 })]),
      criarMockPerfilRepo(),
      movRepo
    );

    const result = await new RegistrarPagamentoPrestacaoUseCase(deps).executar({
      consignacaoId: 1,
      valor: 40
    });
    assert.strictEqual(result.isOk(), true, result.error?.message);
    assert.strictEqual(result.dados.totais.totalVendido, 45);
    assert.strictEqual(result.dados.totais.saldo, 5);
    assert.ok(
      ['GRUPO_RECUPERADO_PONTEIRO', 'CONSIGNACAO_CONTA_CORRENTE', 'GRUPO_PRESTACAO']
        .includes(result.dados.escopo)
    );
    // Ledger intacto: venda permanece no grupo original
    const venda = movRepo.movimentacoes.find((m) => m.id === 11);
    assert.strictEqual(venda.grupoPrestacaoContasId, 'grupo-antigo-com-venda');
    // Ponteiro da consignação aponta para o grupo com vendas
    assert.strictEqual(consignacaoRepo.store.prestacaoContasAtiva.id, 'grupo-antigo-com-venda');
    // Pagamento é INSERT no grupo recuperado
    const pagamento = movRepo.movimentacoes.find((m) => m.tipoMovimentacao === 'PAGAMENTO');
    assert.ok(pagamento);
    assert.strictEqual(pagamento.grupoPrestacaoContasId, 'grupo-antigo-com-venda');
  });

  await test('UC-024 FecharPrestacao — snapshot e status ACERTADA', async () => {
    const consignacaoRepo = criarMockConsignacaoRepo(criarConsignacao());
    const movRepo = criarMockMovRepo();
    const deps = criarDepsPrestacao(
      consignacaoRepo,
      criarMockItemRepo([criarItem()]),
      criarMockPerfilRepo(),
      movRepo
    );
    await abrirPrestacao(deps);
    await new RegistrarVendaPrestacaoUseCase(deps).executar({
      consignacaoId: 1,
      produtoId: 100,
      quantidade: 4
    });

    const result = await new FecharPrestacaoUseCase(deps).executar({ consignacaoId: 1 });
    assert.strictEqual(result.isOk(), true);
    assert.strictEqual(result.dados.consignacao.status, 'ACERTADA');
    assert.strictEqual(result.dados.grupoPrestacaoContas.status, 'FECHADA');
    assert.strictEqual(result.dados.totais.totalVendido, 40);
    const fechamento = movRepo.movimentacoes.find((m) => m.tipoMovimentacao === 'FECHAMENTO_PRESTACAO');
    assert.ok(fechamento?.snapshot?.totais);
    assert.ok(fechamento?.snapshot?.itens);
    assert.strictEqual(deps.publisher.publicados.some((e) => e.tipo === EVENTOS_DOMINIO.PRESTACAO_FECHADA), true);
  });

  await test('UC-024 FecharPrestacao — quitada encerra', async () => {
    const deps = criarDepsPrestacao(
      criarMockConsignacaoRepo(criarConsignacao()),
      criarMockItemRepo([criarItem()]),
      criarMockPerfilRepo(),
      criarMockMovRepo()
    );
    await abrirPrestacao(deps);
    await new RegistrarVendaPrestacaoUseCase(deps).executar({ consignacaoId: 1, produtoId: 100, quantidade: 2 });
    await new RegistrarPagamentoPrestacaoUseCase(deps).executar({ consignacaoId: 1, valor: 20 });

    const result = await new FecharPrestacaoUseCase(deps).executar({ consignacaoId: 1 });
    assert.strictEqual(result.isOk(), true);
    assert.strictEqual(result.dados.consignacao.status, 'ENCERRADA');
    assert.strictEqual(result.dados.totais.saldo, 0);
  });

  await test('UC-025 ReabrirPrestacao — com liberação gerencial', async () => {
    const consignacaoRepo = criarMockConsignacaoRepo(criarConsignacao());
    const movRepo = criarMockMovRepo();
    const deps = criarDepsPrestacao(
      consignacaoRepo,
      criarMockItemRepo([criarItem()]),
      criarMockPerfilRepo(),
      movRepo
    );
    await abrirPrestacao(deps);
    await new RegistrarVendaPrestacaoUseCase(deps).executar({ consignacaoId: 1, produtoId: 100, quantidade: 2 });
    await new FecharPrestacaoUseCase(deps).executar({ consignacaoId: 1 });

    const result = await new ReabrirPrestacaoUseCase(deps).executar({
      consignacaoId: 1,
      liberacaoGerencial: { autorizado: true, autorizadoPor: 99, motivo: 'Ajuste' }
    });
    assert.strictEqual(result.isOk(), true);
    assert.strictEqual(result.dados.consignacao.status, 'ENTREGUE');
    assert.strictEqual(result.dados.grupoPrestacaoContas.status, 'ABERTA');
    assert.ok(movRepo.movimentacoes.some((m) => m.tipoMovimentacao === 'REABERTURA_PRESTACAO'));
    assert.strictEqual(deps.publisher.publicados.some((e) => e.tipo === EVENTOS_DOMINIO.PRESTACAO_REABERTA), true);
  });

  await test('UC-025 ReabrirPrestacao — sem autorização', async () => {
    const deps = criarDepsPrestacao(
      criarMockConsignacaoRepo(criarConsignacao({
        status: 'ACERTADA',
        prestacaoContasAtiva: { id: 'p1', status: 'FECHADA', documento: { numero: 'PC1' } }
      })),
      criarMockItemRepo([criarItem()]),
      criarMockPerfilRepo(),
      criarMockMovRepo()
    );

    const result = await new ReabrirPrestacaoUseCase(deps).executar({ consignacaoId: 1 });
    assert.strictEqual(result.isFail(), true);
    assert.strictEqual(result.erro.codigo, 'REABERTURA_NAO_AUTORIZADA');
  });

  await test('UC-026 ConsultarPrestacao — retorna ledger e totais', async () => {
    const consignacaoRepo = criarMockConsignacaoRepo(criarConsignacao());
    const movRepo = criarMockMovRepo();
    const deps = criarDepsPrestacao(
      consignacaoRepo,
      criarMockItemRepo([criarItem()]),
      criarMockPerfilRepo(),
      movRepo
    );
    await abrirPrestacao(deps);
    await new RegistrarVendaPrestacaoUseCase(deps).executar({ consignacaoId: 1, produtoId: 100, quantidade: 3 });

    const result = await new ConsultarPrestacaoUseCase(deps).executar({ consignacaoId: 1 });
    assert.strictEqual(result.isOk(), true);
    assert.strictEqual(result.dados.totais.totalVendido, 30);
    assert.ok(result.dados.documento);
    assert.ok(result.dados.movimentacoes.length >= 2);
  });

  await test('UC-027 ConsultarResumo — derivado exclusivamente do ledger', async () => {
    const consignacaoRepo = criarMockConsignacaoRepo(criarConsignacao());
    const movRepo = criarMockMovRepo();
    const deps = criarDepsPrestacao(
      consignacaoRepo,
      criarMockItemRepo([criarItem()]),
      criarMockPerfilRepo(),
      movRepo
    );
    await abrirPrestacao(deps);
    await new RegistrarVendaPrestacaoUseCase(deps).executar({ consignacaoId: 1, produtoId: 100, quantidade: 2 });
    await new RegistrarPerdaUseCase(deps).executar({ consignacaoId: 1, produtoId: 100, quantidade: 1 });
    await new RegistrarPagamentoPrestacaoUseCase(deps).executar({ consignacaoId: 1, valor: 10 });

    const result = await new ConsultarResumoPrestacaoUseCase(deps).executar({ consignacaoId: 1 });
    assert.strictEqual(result.isOk(), true);
    assert.strictEqual(result.dados.derivadoDoLedger, true);
    assert.strictEqual(result.dados.resumo.totalVendido, 20);
    assert.strictEqual(result.dados.resumo.totalPerdido, 10);
    assert.strictEqual(result.dados.resumo.totalRecebido, 10);
    assert.strictEqual(result.dados.resumo.saldo, 10);
  });

  await test('Rollback abertura — sem eventos', async () => {
    const deps = criarDepsPrestacao(
      criarMockConsignacaoRepo(criarConsignacao()),
      criarMockItemRepo([criarItem()]),
      criarMockPerfilRepo(),
      criarMockMovRepo(),
      { falhar: true }
    );
    const result = await abrirPrestacao(deps);
    assert.strictEqual(result.isFail(), true);
    assert.strictEqual(deps.publisher.publicados.length, 0);
  });

  await test('UC-020 RegistrarVenda — prestação não aberta', async () => {
    const deps = criarDepsPrestacao(
      criarMockConsignacaoRepo(criarConsignacao()),
      criarMockItemRepo([criarItem()]),
      criarMockPerfilRepo(),
      criarMockMovRepo()
    );
    const result = await new RegistrarVendaPrestacaoUseCase(deps).executar({
      consignacaoId: 1,
      produtoId: 100,
      quantidade: 1
    });
    assert.strictEqual(result.isFail(), true);
    assert.strictEqual(result.erro.codigo, 'PRESTACAO_NAO_ABERTA');
  });

  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  if (falhou > 0) process.exit(1);
}

run();
