/**
 * Testes — Use Cases Consignacao Fase 1 (Sprint 2.4.1)
 * Executar: npm run test:motor-comercial-consignacao-fase1
 */

const assert = require('assert');
const {
  CriarConsignacaoUseCase,
  EditarConsignacaoUseCase,
  CancelarConsignacaoRascunhoUseCase,
  AdicionarItemConsignacaoUseCase,
  RemoverItemConsignacaoUseCase,
  AlterarQuantidadeItemUseCase,
  ConsultarConsignacaoUseCase,
  ListarConsignacoesUseCase,
  ConsultarItensConsignacaoUseCase,
  ValidarConsignacaoUseCase
} = require('../../backend/motores/motor-comercial/usecases/consignacao');
const { EVENTOS_DOMINIO } = require('../../backend/motores/motor-comercial/events/comercialEventosTipos');

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

function criarConsignacao(overrides = {}) {
  return {
    id: 1,
    clienteId: 10,
    perfilComercialId: 5,
    status: 'RASCUNHO',
    documento: { numero: 'C001', serie: '1', sequencial: 1, situacao: 'RASCUNHO' },
    observacao: 'Teste',
    dataAbertura: '2026-06-01T10:00:00.000Z',
    dataEntrega: null,
    valorTotalEntregue: 0,
    saldoAberto: 0,
    ...overrides
  };
}

function criarItem(overrides = {}) {
  return {
    id: 1,
    consignacaoId: 1,
    produtoId: 100,
    quantidadeEntregue: 10,
    precoUnitario: 5,
    subtotalEntregue: 50,
    ...overrides
  };
}

function criarPerfilConsignado(overrides = {}) {
  return {
    id: 5,
    clienteId: 10,
    perfilTipo: 'CONSIGNADO',
    ativo: true,
    bloqueado: false,
    ...overrides
  };
}

function criarMockConsignacaoRepo(estadoInicial = null) {
  let store = estadoInicial ? { ...estadoInicial } : null;
  const todos = estadoInicial ? [{ ...estadoInicial }] : [];

  async function aplicarPatch(id, dados) {
    if (!store || store.id !== id) return null;
    const patch = { ...dados };
    if (patch.documento) {
      store.documento = { ...store.documento, ...patch.documento };
      delete patch.documento;
    }
    store = { ...store, ...patch };
    const idx = todos.findIndex((c) => c.id === id);
    if (idx >= 0) todos[idx] = { ...store };
    return { ...store };
  }

  return {
    buscarPorId: async (id) => (store && store.id === id ? { ...store } : null),
    listar: async (filtros = {}) => todos.filter((c) => {
      if (filtros.clienteId != null && c.clienteId !== filtros.clienteId) return false;
      if (filtros.status && c.status !== filtros.status) return false;
      if (filtros.documentoNumero && c.documento?.numero !== filtros.documentoNumero) return false;
      return true;
    }),
    inserir: async (dados) => {
      store = {
        id: todos.length + 1,
        status: 'RASCUNHO',
        valorTotalEntregue: 0,
        saldoAberto: 0,
        documento: { situacao: 'RASCUNHO' },
        ...dados
      };
      todos.push({ ...store });
      return { ...store };
    },
    atualizar: async (id, dados) => aplicarPatch(id, dados),
    atualizarSeStatus: async (id, statusEsperado, dados) => {
      if (!store || store.id !== id) return null;
      if (String(store.status) !== String(statusEsperado)) return null;
      return aplicarPatch(id, dados);
    },
    obterMaxSequencialDocumento: async () => 0,
    obterProximoSequencialDocumento: async () => 1,
    todos
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
    remover: async (id) => {
      const idx = itens.findIndex((i) => i.id === id);
      if (idx < 0) return false;
      itens.splice(idx, 1);
      return true;
    },
    itens
  };
}

function criarMockUow(consignacaoRepo, itemRepo, opcoes = {}) {
  const movimentacoes = [];
  const uow = {
    consignacao: consignacaoRepo,
    consignacaoItem: itemRepo,
    movimentacaoComercial: {
      inserir: async (dados) => {
        movimentacoes.push(dados);
        throw new Error('MovimentacaoComercial não deve ser criada na fase 1');
      }
    },
    executar: async (fn) => {
      if (opcoes.falharTransacao) {
        throw new Error('rollback simulado');
      }
      return fn(uow);
    },
    movimentacoes
  };
  return uow;
}

function criarMockPublisher() {
  const publicados = [];
  return {
    publicar: (e) => publicados.push(e),
    flush: async () => {},
    publicados
  };
}

function criarDepsWrite(consignacaoRepo, itemRepo, extras = {}) {
  return {
    unitOfWork: criarMockUow(consignacaoRepo, itemRepo, extras),
    eventPublisher: criarMockPublisher(),
    clienteBridge: extras.clienteBridge ?? {
      buscarPorId: async (id) => ({ id, nome: 'Cliente' }),
      estaAtivo: async () => true
    },
    produtoBridge: extras.produtoBridge ?? {
      buscarPorId: async (id) => ({ id, preco: 10 }),
      estaAtivo: async () => true
    },
    perfilComercialRepository: extras.perfilComercialRepository ?? {
      buscarPorId: async () => criarPerfilConsignado()
    }
  };
}

function criarDepsRead(consignacaoRepo, itemRepo, extras = {}) {
  return {
    consignacaoRepository: consignacaoRepo,
    consignacaoItemRepository: itemRepo,
    clienteBridge: extras.clienteBridge,
    perfilComercialRepository: extras.perfilComercialRepository ?? {
      buscarPorId: async () => criarPerfilConsignado()
    }
  };
}

async function run() {
  console.log('\n=== Testes Use Cases Consignacao Fase 1 — Sprint 2.4.1 ===\n');

  await test('UC-001 CriarConsignacao — fluxo feliz sem movimentação', async () => {
    const consignacaoRepo = criarMockConsignacaoRepo();
    const itemRepo = criarMockItemRepo();
    const deps = criarDepsWrite(consignacaoRepo, itemRepo);
    const result = await new CriarConsignacaoUseCase(deps).executar({
      clienteId: 10,
      perfilComercialId: 5,
      observacao: 'Nova consignação'
    });

    assert.strictEqual(result.isOk(), true);
    assert.strictEqual(result.dados.consignacao.status, 'RASCUNHO');
    assert.strictEqual(deps.unitOfWork.movimentacoes.length, 0);
    assert.strictEqual(deps.eventPublisher.publicados[0].tipo, EVENTOS_DOMINIO.CONSIGNACAO_CRIADA);
  });

  await test('UC-001 CriarConsignacao — perfil não consignado', async () => {
    const deps = criarDepsWrite(criarMockConsignacaoRepo(), criarMockItemRepo(), {
      perfilComercialRepository: {
        buscarPorId: async () => criarPerfilConsignado({ perfilTipo: 'ATACADISTA' })
      }
    });
    const result = await new CriarConsignacaoUseCase(deps).executar({
      clienteId: 10,
      perfilComercialId: 5
    });
    assert.strictEqual(result.isFail(), true);
    assert.strictEqual(result.erro.codigo, 'CLIENTE_NAO_HABILITADO_PARA_CONSIGNACAO');
  });

  await test('UC-002 EditarConsignacao — somente rascunho', async () => {
    const consignacaoRepo = criarMockConsignacaoRepo(criarConsignacao());
    const deps = criarDepsWrite(consignacaoRepo, criarMockItemRepo());
    const result = await new EditarConsignacaoUseCase(deps).executar({
      consignacaoId: 1,
      observacao: 'Atualizada'
    });
    assert.strictEqual(result.isOk(), true);
    assert.strictEqual(result.dados.consignacao.observacao, 'Atualizada');
    assert.strictEqual(deps.eventPublisher.publicados[0].tipo, EVENTOS_DOMINIO.CONSIGNACAO_ATUALIZADA);
  });

  await test('UC-002 EditarConsignacao — bloqueia fora de rascunho', async () => {
    const consignacaoRepo = criarMockConsignacaoRepo(criarConsignacao({ status: 'ENTREGUE' }));
    const deps = criarDepsWrite(consignacaoRepo, criarMockItemRepo());
    const result = await new EditarConsignacaoUseCase(deps).executar({ consignacaoId: 1, observacao: 'X' });
    assert.strictEqual(result.isFail(), true);
    assert.strictEqual(result.erro.codigo, 'CONSIGNACAO_NAO_ESTA_EM_RASCUNHO');
  });

  await test('UC-003 CancelarConsignacaoRascunho — fluxo feliz', async () => {
    const consignacaoRepo = criarMockConsignacaoRepo(criarConsignacao());
    const deps = criarDepsWrite(consignacaoRepo, criarMockItemRepo());
    const result = await new CancelarConsignacaoRascunhoUseCase(deps).executar({ consignacaoId: 1 });
    assert.strictEqual(result.isOk(), true);
    assert.strictEqual(result.dados.consignacao.status, 'CANCELADA');
    assert.strictEqual(deps.eventPublisher.publicados[0].tipo, EVENTOS_DOMINIO.CONSIGNACAO_CANCELADA);
  });

  await test('UC-004 AdicionarItem — fluxo feliz', async () => {
    const consignacaoRepo = criarMockConsignacaoRepo(criarConsignacao());
    const itemRepo = criarMockItemRepo();
    const deps = criarDepsWrite(consignacaoRepo, itemRepo);
    const result = await new AdicionarItemConsignacaoUseCase(deps).executar({
      consignacaoId: 1,
      produtoId: 100,
      quantidade: 5,
      precoUnitario: 10
    });
    assert.strictEqual(result.isOk(), true);
    assert.strictEqual(itemRepo.itens.length, 1);
    assert.strictEqual(deps.eventPublisher.publicados[0].tipo, EVENTOS_DOMINIO.ITEM_CONSIGNACAO_ADICIONADO);
  });

  await test('UC-004 AdicionarItem — produto duplicado', async () => {
    const consignacaoRepo = criarMockConsignacaoRepo(criarConsignacao());
    const itemRepo = criarMockItemRepo([criarItem()]);
    const deps = criarDepsWrite(consignacaoRepo, itemRepo);
    const result = await new AdicionarItemConsignacaoUseCase(deps).executar({
      consignacaoId: 1,
      produtoId: 100,
      quantidade: 2
    });
    assert.strictEqual(result.isFail(), true);
    assert.strictEqual(result.erro.codigo, 'PRODUTO_DUPLICADO_NA_CONSIGNACAO');
  });

  await test('UC-005 RemoverItem — fluxo feliz', async () => {
    const consignacaoRepo = criarMockConsignacaoRepo(criarConsignacao());
    const itemRepo = criarMockItemRepo([criarItem()]);
    const deps = criarDepsWrite(consignacaoRepo, itemRepo);
    const result = await new RemoverItemConsignacaoUseCase(deps).executar({
      consignacaoId: 1,
      itemId: 1
    });
    assert.strictEqual(result.isOk(), true);
    assert.strictEqual(itemRepo.itens.length, 0);
  });

  await test('UC-006 AlterarQuantidadeItem — fluxo feliz', async () => {
    const consignacaoRepo = criarMockConsignacaoRepo(criarConsignacao());
    const itemRepo = criarMockItemRepo([criarItem()]);
    const deps = criarDepsWrite(consignacaoRepo, itemRepo);
    const result = await new AlterarQuantidadeItemUseCase(deps).executar({
      consignacaoId: 1,
      itemId: 1,
      novaQuantidade: 20
    });
    assert.strictEqual(result.isOk(), true);
    assert.strictEqual(result.dados.quantidadeNova, 20);
    assert.strictEqual(deps.eventPublisher.publicados[0].tipo, EVENTOS_DOMINIO.QUANTIDADE_ITEM_ALTERADA);
  });

  await test('UC-006 AlterarQuantidadeItem — quantidade inválida', async () => {
    const deps = criarDepsWrite(
      criarMockConsignacaoRepo(criarConsignacao()),
      criarMockItemRepo([criarItem()])
    );
    const result = await new AlterarQuantidadeItemUseCase(deps).executar({
      consignacaoId: 1,
      itemId: 1,
      novaQuantidade: 0
    });
    assert.strictEqual(result.isFail(), true);
    assert.strictEqual(result.erro.codigo, 'QUANTIDADE_INVALIDA');
  });

  await test('UC-007 ConsultarConsignacao — leitura', async () => {
    const deps = criarDepsRead(
      criarMockConsignacaoRepo(criarConsignacao()),
      criarMockItemRepo()
    );
    const result = await new ConsultarConsignacaoUseCase(deps).executar({ consignacaoId: 1 });
    assert.strictEqual(result.isOk(), true);
    assert.strictEqual(result.dados.id, 1);
  });

  await test('UC-008 ListarConsignacoes — filtros', async () => {
    const repo = criarMockConsignacaoRepo(criarConsignacao());
    repo.todos.push(criarConsignacao({ id: 2, clienteId: 20, status: 'CANCELADA' }));
    const deps = criarDepsRead(repo, criarMockItemRepo());
    const result = await new ListarConsignacoesUseCase(deps).executar({ clienteId: 10, status: 'RASCUNHO' });
    assert.strictEqual(result.isOk(), true);
    assert.strictEqual(result.dados.consignacoes.length, 1);
  });

  await test('UC-009 ConsultarItensConsignacao — leitura', async () => {
    const deps = criarDepsRead(
      criarMockConsignacaoRepo(criarConsignacao()),
      criarMockItemRepo([criarItem(), criarItem({ id: 2, produtoId: 101 })])
    );
    const result = await new ConsultarItensConsignacaoUseCase(deps).executar({ consignacaoId: 1 });
    assert.strictEqual(result.isOk(), true);
    assert.strictEqual(result.dados.total, 2);
  });

  await test('UC-010 ValidarConsignacao — válida com itens', async () => {
    const deps = criarDepsRead(
      criarMockConsignacaoRepo(criarConsignacao()),
      criarMockItemRepo([criarItem()])
    );
    const result = await new ValidarConsignacaoUseCase(deps).executar({ consignacaoId: 1 });
    assert.strictEqual(result.isOk(), true);
    assert.strictEqual(result.dados.valido, true);
  });

  await test('UC-010 ValidarConsignacao — inválida sem itens', async () => {
    const deps = criarDepsRead(
      criarMockConsignacaoRepo(criarConsignacao()),
      criarMockItemRepo()
    );
    const result = await new ValidarConsignacaoUseCase(deps).executar({ consignacaoId: 1 });
    assert.strictEqual(result.isOk(), true);
    assert.strictEqual(result.dados.valido, false);
    assert.ok(result.dados.erros.some((e) => e.codigo === 'CONSIGNACAO_SEM_ITENS'));
  });

  await test('Rollback — não publica eventos', async () => {
    const consignacaoRepo = criarMockConsignacaoRepo();
    const itemRepo = criarMockItemRepo();
    const deps = criarDepsWrite(consignacaoRepo, itemRepo, { falharTransacao: true });
    const result = await new CriarConsignacaoUseCase(deps).executar({
      clienteId: 10,
      perfilComercialId: 5
    });
    assert.strictEqual(result.isFail(), true);
    assert.strictEqual(deps.eventPublisher.publicados.length, 0);
  });

  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  if (falhou > 0) process.exit(1);
}

run();
