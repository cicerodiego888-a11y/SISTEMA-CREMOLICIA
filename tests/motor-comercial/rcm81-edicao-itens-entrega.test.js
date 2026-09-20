/**
 * RCM-8.1 — Edição e revisão dos itens na tela de Entrega
 *
 * Executar:
 *   node tests/motor-comercial/rcm81-edicao-itens-entrega.test.js
 */

const assert = require('assert');
const {
  AdicionarItemConsignacaoUseCase,
  AlterarQuantidadeItemUseCase,
  RemoverItemConsignacaoUseCase,
  RegistrarEntregaConsignacaoUseCase
} = require('../../backend/motores/motor-comercial/usecases/consignacao');
const {
  podeEditarItensEntrega,
  edicaoBloqueadaPorStatus,
  aplicarQuantidadeLocal,
  snapshotPreservado,
  validarQuantidadeEdicao,
  totalEntrega,
  impactoLimite,
  montarConfirmacaoEntrega,
  itemUnidadeSnapshot,
  extrairSnapshot,
  MENSAGEM_EDICAO_BLOQUEADA
} = require('../../frontend/modules/motor-comercial/pages/EntregaConsignacao/entregaItensEdicao');
const { criarMockOutboxService, adaptarUowParaOutbox } = require('./outbox-test-helpers');

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

function criarConsignacao(overrides = {}) {
  return {
    id: 1,
    clienteId: 10,
    perfilComercialId: 5,
    status: 'RASCUNHO',
    documento: { numero: 'C001', serie: '1', sequencial: 1, situacao: 'RASCUNHO' },
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
    quantidadeEntregue: 5,
    precoUnitario: 28,
    subtotalEntregue: 140,
    unidadeComercial: 'LITRO',
    linhaComercialId: 7,
    tabelaPrecoId: 3,
    canalVenda: 'CONSIGNADO',
    precoOrigem: 'tabela_preco_linha',
    precoFallback: 0,
    ...overrides
  };
}

function criarPerfil() {
  return {
    id: 5,
    clienteId: 10,
    perfilTipo: 'CONSIGNADO',
    ativo: true,
    bloqueado: false,
    limiteComercial: 500,
    saldoAberto: 0
  };
}

function criarMockConsignacaoRepo(estadoInicial) {
  let store = { ...estadoInicial };
  return {
    buscarPorId: async (id) => (Number(store.id) === Number(id) ? { ...store } : null),
    atualizar: async (id, dados) => {
      if (Number(store.id) !== Number(id)) return null;
      if (dados.documento) {
        store.documento = { ...store.documento, ...dados.documento };
        delete dados.documento;
      }
      store = { ...store, ...dados };
      return { ...store };
    },
    obterProximoSequencialDocumento: async () => 1,
    listar: async () => [store],
    get store() { return store; }
  };
}

function criarMockItemRepo(itensIniciais = []) {
  const itens = itensIniciais.map((i) => ({ ...i }));
  let seq = itens.length;
  return {
    buscarPorId: async (id) => itens.find((i) => Number(i.id) === Number(id)) ?? null,
    listarPorConsignacao: async (consignacaoId, filtros = {}) => itens.filter((i) => {
      if (Number(i.consignacaoId) !== Number(consignacaoId)) return false;
      if (filtros.produtoId != null && Number(i.produtoId) !== Number(filtros.produtoId)) return false;
      return true;
    }),
    inserir: async (dados) => {
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
    remover: async (id) => {
      const idx = itens.findIndex((i) => Number(i.id) === Number(id));
      if (idx < 0) return false;
      itens.splice(idx, 1);
      return true;
    },
    itens
  };
}

function criarDeps(consignacaoRepo, itemRepo, extras = {}) {
  const movRepo = {
    movimentacoes: [],
    inserir: async (dados) => {
      const mov = { id: movRepo.movimentacoes.length + 1, ...dados };
      movRepo.movimentacoes.push(mov);
      return mov;
    },
    listar: async () => movRepo.movimentacoes
  };
  const perfilRepo = {
    buscarPorId: async () => criarPerfil(),
    atualizar: async (_id, dados) => ({ ...criarPerfil(), ...dados })
  };
  const uow = {
    consignacao: consignacaoRepo,
    consignacaoItem: itemRepo,
    perfilComercial: perfilRepo,
    movimentacaoComercial: movRepo,
    executar: async (fn) => fn(uow)
  };
  const outboxService = criarMockOutboxService({
    estoqueBridge: { registrarSaidaConsignacao: async () => ({ ok: true }) }
  });
  adaptarUowParaOutbox(uow, outboxService);
  const publisher = { publicados: [], publicar: (e) => publisher.publicados.push(e), flush: async () => {} };
  return {
    unitOfWork: uow,
    eventPublisher: publisher,
    consignacaoRepository: consignacaoRepo,
    consignacaoItemRepository: itemRepo,
    perfilComercialRepository: perfilRepo,
    movimentacaoComercialRepository: movRepo,
    clienteBridge: { buscarPorId: async () => ({ id: 10 }), estaAtivo: async () => true },
    produtoBridge: extras.produtoBridge || {
      buscarPorId: async (id) => ({
        id,
        nome: 'Picolé',
        unidade: 'UN',
        unidadeComercial: 'UN',
        preco: 15,
        tabelaPrecoId: 3,
        linhaComercialId: 7,
        canalVenda: 'CONSIGNADO',
        precoOrigem: 'tabela_preco_linha'
      }),
      estaAtivo: async () => true
    },
    outboxService,
    movRepo
  };
}

async function main() {
  console.log('\nRCM-8.1 — Edição de itens na Entrega\n');

  await test('1-3 editar quantidade atualiza total e preserva preço', async () => {
    const item = criarItem();
    const atualizado = aplicarQuantidadeLocal(item, 7);
    assert.strictEqual(atualizado.precoUnitario, 28);
    assert.strictEqual(atualizado.subtotalEntregue, 196);
    assert.strictEqual(snapshotPreservado(item, atualizado), true);

    const repoC = criarMockConsignacaoRepo(criarConsignacao());
    const repoI = criarMockItemRepo([item]);
    const result = await new AlterarQuantidadeItemUseCase(criarDeps(repoC, repoI)).executar({
      consignacaoId: 1,
      itemId: 1,
      novaQuantidade: 7
    });
    assert.strictEqual(result.isOk(), true);
    assert.strictEqual(Number(repoI.itens[0].precoUnitario), 28);
    assert.strictEqual(Number(repoI.itens[0].subtotalEntregue), 196);
    assert.strictEqual(repoI.itens[0].unidadeComercial, 'LITRO');
  });

  await test('4-7 preservar unidade, linha, tabela e canal CONSIGNADO', async () => {
    const item = criarItem();
    const repoC = criarMockConsignacaoRepo(criarConsignacao());
    const repoI = criarMockItemRepo([item]);
    await new AlterarQuantidadeItemUseCase(criarDeps(repoC, repoI)).executar({
      consignacaoId: 1,
      itemId: 1,
      novaQuantidade: 7
    });
    const depois = repoI.itens[0];
    assert.strictEqual(depois.unidadeComercial, 'LITRO');
    assert.strictEqual(depois.linhaComercialId, 7);
    assert.strictEqual(depois.tabelaPrecoId, 3);
    assert.strictEqual(depois.canalVenda, 'CONSIGNADO');
    assert.strictEqual(itemUnidadeSnapshot(depois), 'LITRO');
  });

  await test('8 remover item em RASCUNHO', async () => {
    const repoC = criarMockConsignacaoRepo(criarConsignacao());
    const repoI = criarMockItemRepo([criarItem(), criarItem({ id: 2, produtoId: 200 })]);
    const result = await new RemoverItemConsignacaoUseCase(criarDeps(repoC, repoI)).executar({
      consignacaoId: 1,
      itemId: 2
    });
    assert.strictEqual(result.isOk(), true);
    assert.strictEqual(repoI.itens.length, 1);
    assert.strictEqual(repoI.itens[0].id, 1);
  });

  await test('9 adicionar item com snapshot CONSIGNADO', async () => {
    const repoC = criarMockConsignacaoRepo(criarConsignacao());
    const repoI = criarMockItemRepo([]);
    const result = await new AdicionarItemConsignacaoUseCase(criarDeps(repoC, repoI)).executar({
      consignacaoId: 1,
      produtoId: 55,
      quantidade: 2,
      precoUnitario: 15,
      tabelaPrecoId: 3,
      linhaComercialId: 7,
      canalVenda: 'CONSIGNADO',
      unidadeComercial: 'UN',
      precoOrigem: 'tabela_preco_linha'
    });
    assert.strictEqual(result.isOk(), true);
    assert.strictEqual(repoI.itens[0].canalVenda, 'CONSIGNADO');
    assert.strictEqual(Number(repoI.itens[0].precoUnitario), 15);
  });

  await test('10 quantidade inválida', async () => {
    assert.strictEqual(validarQuantidadeEdicao(0, 'UN').ok, false);
    assert.strictEqual(validarQuantidadeEdicao(1.5, 'UN').ok, false);
    assert.strictEqual(validarQuantidadeEdicao(1.5, 'LITRO').ok, true);

    const repoC = criarMockConsignacaoRepo(criarConsignacao());
    const repoI = criarMockItemRepo([criarItem({ unidadeComercial: 'UN' })]);
    const result = await new AlterarQuantidadeItemUseCase(criarDeps(repoC, repoI)).executar({
      consignacaoId: 1,
      itemId: 1,
      novaQuantidade: 1.5
    });
    assert.strictEqual(result.isFail(), true);
  });

  await test('11 edição permitida em RASCUNHO', () => {
    assert.strictEqual(podeEditarItensEntrega('RASCUNHO'), true);
  });

  await test('12-13 bloqueio após ENTREGUE e CANCELADA', async () => {
    assert.strictEqual(edicaoBloqueadaPorStatus('ENTREGUE'), true);
    assert.strictEqual(edicaoBloqueadaPorStatus('CANCELADA'), true);
    assert.strictEqual(edicaoBloqueadaPorStatus('ACERTADA'), true);
    assert.strictEqual(podeEditarItensEntrega('ENTREGUE'), false);

    const repoC = criarMockConsignacaoRepo(criarConsignacao({ status: 'ENTREGUE' }));
    const repoI = criarMockItemRepo([criarItem()]);
    const result = await new AlterarQuantidadeItemUseCase(criarDeps(repoC, repoI)).executar({
      consignacaoId: 1,
      itemId: 1,
      novaQuantidade: 8
    });
    assert.strictEqual(result.isFail(), true);
    assert.strictEqual(Number(repoI.itens[0].quantidadeEntregue), 5);

    const cancelada = criarMockConsignacaoRepo(criarConsignacao({ status: 'CANCELADA' }));
    const resultCancel = await new RemoverItemConsignacaoUseCase(criarDeps(cancelada, criarMockItemRepo([criarItem()]))).executar({
      consignacaoId: 1,
      itemId: 1
    });
    assert.strictEqual(resultCancel.isFail(), true);
  });

  await test('14 limite atualizado pelo valor da entrega, sem reprecificar', () => {
    const itens = [aplicarQuantidadeLocal(criarItem({ precoUnitario: 28, quantidadeEntregue: 3 }), 3)];
    assert.strictEqual(totalEntrega(itens), 84);
    const depois = [aplicarQuantidadeLocal(itens[0], 5)];
    const impacto = impactoLimite({ limite: 500, valorEntrega: totalEntrega(depois) });
    assert.strictEqual(impacto.valorEntrega, 140);
    assert.strictEqual(impacto.saldoAposEntrega, 360);
    assert.strictEqual(depois[0].precoUnitario, 28);
  });

  await test('15 confirmação antes da entrega', () => {
    const conf = montarConfirmacaoEntrega({
      clienteNome: 'Cicero Diego',
      quantidadeItens: 2,
      valorTotal: 196,
      formatCurrency: (v) => `R$ ${v}`
    });
    assert.ok(conf.title.includes('Confirmar entrega'));
    assert.ok(conf.message.includes('Cicero Diego'));
    assert.ok(conf.message.includes('não poderão mais ser editados'));
    assert.strictEqual(conf.cancelLabel, 'Voltar e revisar');
    assert.strictEqual(conf.confirmLabel, 'Confirmar entrega');
  });

  await test('RCM-8.3 snapshot e bloqueio pós-entrega', () => {
    const item = criarItem({ precoFallback: 1, quantidadeEntregue: 10 });
    const depois = aplicarQuantidadeLocal(item, 12);
    const snap = extrairSnapshot(depois);
    assert.strictEqual(depois.precoUnitario, 28);
    assert.strictEqual(depois.subtotalEntregue, 336);
    assert.strictEqual(snap.unidadeComercial, 'LITRO');
    assert.strictEqual(snap.linhaComercialId, 7);
    assert.strictEqual(snap.tabelaPrecoId, 3);
    assert.strictEqual(snap.canalVenda, 'CONSIGNADO');
    assert.strictEqual(snap.precoOrigem, 'tabela_preco_linha');
    assert.strictEqual(snap.precoFallback, true);
    assert.strictEqual(snapshotPreservado(item, depois), true);
    assert.strictEqual(MENSAGEM_EDICAO_BLOQUEADA, 'Esta consignação não pode mais ser editada.');
    assert.strictEqual(podeEditarItensEntrega('ENTREGUE'), false);
  });

  await test('16 entrega continua funcionando após edição', async () => {
    const repoC = criarMockConsignacaoRepo(criarConsignacao());
    const repoI = criarMockItemRepo([criarItem({ quantidadeEntregue: 7, subtotalEntregue: 196 })]);
    const deps = criarDeps(repoC, repoI);
    const qtd = await new AlterarQuantidadeItemUseCase(deps).executar({
      consignacaoId: 1,
      itemId: 1,
      novaQuantidade: 7
    });
    assert.strictEqual(qtd.isOk(), true);

    const entrega = await new RegistrarEntregaConsignacaoUseCase(deps).executar({ consignacaoId: 1 });
    assert.strictEqual(entrega.isOk(), true);
    assert.strictEqual(repoC.store.status, 'ENTREGUE');
    const bloqueio = await new AlterarQuantidadeItemUseCase(deps).executar({
      consignacaoId: 1,
      itemId: 1,
      novaQuantidade: 9
    });
    assert.strictEqual(bloqueio.isFail(), true);
  });

  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  if (falhou > 0) process.exit(1);
}

main();
