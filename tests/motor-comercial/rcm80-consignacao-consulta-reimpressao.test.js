/**
 * RCM-8.0 — Consultar e reimprimir consignação entregue
 *
 * Executar:
 *   node tests/motor-comercial/rcm80-consignacao-consulta-reimpressao.test.js
 */

const assert = require('assert');
const {
  CriarConsignacaoUseCase,
  AdicionarItemConsignacaoUseCase,
  RegistrarEntregaConsignacaoUseCase,
  ConsultarConsignacaoUseCase,
  ConsultarItensConsignacaoUseCase
} = require('../../backend/motores/motor-comercial/usecases/consignacao');
const { ConsignacaoResponse, ItemConsignacaoResponse } = require('../../backend/motores/motor-comercial/http/dto/ConsignacaoDTO');
const {
  consignacaoPertenceAoCliente,
  mapStatusConsultaConsignacao
} = require('../../backend/motores/motor-comercial/services/consultaConsignacaoReadOnly');
const {
  buildDetalheConsulta,
  buildComprovanteConsignacaoHtml,
  reimpressaoSomenteLeitura
} = require('../../frontend/modules/motor-comercial/pages/PerfilComercial/historicoConsignacoesMappers');
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
    documento: { numero: '000125', serie: '1', sequencial: 125, situacao: 'RASCUNHO' },
    valorTotalEntregue: 0,
    valorTotalAcertado: 0,
    valorTotalPago: 0,
    saldoAberto: 0,
    dataAbertura: '2026-06-01T10:00:00.000Z',
    dataEntrega: null,
    prestacaoContasAtiva: null,
    updatedAt: '2026-06-01T10:00:00.000Z',
    ...overrides
  };
}

function criarItem(overrides = {}) {
  return {
    id: 1,
    consignacaoId: 1,
    produtoId: 100,
    produtoNome: 'Picolé Premium',
    quantidadeEntregue: 10,
    precoUnitario: 2.5,
    subtotalEntregue: 25,
    unidadeComercial: 'UN',
    unidade: 'UN',
    linhaComercialId: 7,
    tabelaPrecoId: 3,
    canalVenda: 'CONSIGNADO',
    precoOrigem: 'tabela_preco_linha',
    precoFallback: 0,
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
    saldoAberto: 0,
    ...overrides
  };
}

function criarMockConsignacaoRepo(estadoInicial = null) {
  let store = estadoInicial ? { ...estadoInicial } : null;
  const todos = estadoInicial ? [{ ...estadoInicial }] : [];
  return {
    buscarPorId: async (id) => (store?.id === Number(id) ? { ...store } : todos.find((c) => Number(c.id) === Number(id)) ?? null),
    listar: async (filtros = {}) => todos.filter((c) => {
      if (filtros.clienteId != null && Number(c.clienteId) !== Number(filtros.clienteId)) return false;
      return true;
    }),
    inserir: async (dados) => {
      store = { id: todos.length + 1, ...dados };
      todos.push({ ...store });
      return { ...store };
    },
    atualizar: async (id, dados) => {
      const idx = todos.findIndex((c) => Number(c.id) === Number(id));
      const base = idx >= 0 ? todos[idx] : store;
      if (!base) return null;
      if (dados.documento) {
        base.documento = { ...base.documento, ...dados.documento };
        delete dados.documento;
      }
      const atualizado = { ...base, ...dados };
      if (idx >= 0) todos[idx] = atualizado;
      if (store?.id === Number(id)) store = atualizado;
      return { ...atualizado };
    },
    obterProximoSequencialDocumento: async () => 125,
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
    buscarPorId: async (id) => (Number(store.id) === Number(id) ? { ...store } : null),
    atualizar: async (id, dados) => {
      if (Number(store.id) !== Number(id)) return null;
      store = { ...store, ...dados };
      return { ...store };
    },
    get store() { return store; }
  };
}

function criarMockMovRepo() {
  const movimentacoes = [];
  return {
    inserir: async (dados) => {
      const mov = { id: movimentacoes.length + 1, ...dados };
      movimentacoes.push(mov);
      return mov;
    },
    listar: async (filtros = {}) => movimentacoes.filter((m) => {
      if (filtros.consignacaoId != null && Number(m.consignacaoId) !== Number(filtros.consignacaoId)) return false;
      return true;
    }),
    movimentacoes
  };
}

function criarMockPublisher() {
  const publicados = [];
  return {
    publicar: (e) => publicados.push(e),
    flush: async () => {},
    publicados
  };
}

function criarUow(consignacaoRepo, itemRepo, perfilRepo, movRepo) {
  const uow = {
    consignacao: consignacaoRepo,
    consignacaoItem: itemRepo,
    perfilComercial: perfilRepo,
    movimentacaoComercial: movRepo,
    executar: async (fn) => fn(uow)
  };
  return uow;
}

async function montarOperacaoEntregue(produtoExtra = {}) {
  const consignacaoRepo = criarMockConsignacaoRepo();
  const itemRepo = criarMockItemRepo();
  const perfilRepo = criarMockPerfilRepo();
  const movRepo = criarMockMovRepo();
  const uow = criarUow(consignacaoRepo, itemRepo, perfilRepo, movRepo);
  const publisher = criarMockPublisher();
  const produtoBridge = {
    buscarPorId: async (id) => ({
      id,
      nome: produtoExtra.nome || 'Picolé Premium',
      unidade: produtoExtra.unidade || 'UN',
      unidadeComercial: produtoExtra.unidadeComercial || 'UN',
      preco: produtoExtra.preco != null ? produtoExtra.preco : 2.5,
      linhaComercialId: 7,
      tabelaPrecoId: 3,
      canalVenda: 'CONSIGNADO',
      precoOrigem: 'tabela_preco_linha',
      precoFallback: false,
      ...produtoExtra
    }),
    estaAtivo: async () => true
  };

  const criar = await new CriarConsignacaoUseCase({
    unitOfWork: uow,
    eventPublisher: publisher,
    clienteBridge: { buscarPorId: async (id) => ({ id, nome: 'Cliente' }), estaAtivo: async () => true },
    perfilComercialRepository: perfilRepo
  }).executar({
    clienteId: 10,
    perfilComercialId: 5,
    observacao: 'RCM-8.0'
  });
  assert.strictEqual(criar.isOk(), true, criar.erro?.message || 'criar falhou');
  const consignacaoId = criar.dados.consignacao.id;

  const add = await new AdicionarItemConsignacaoUseCase({
    unitOfWork: uow,
    eventPublisher: publisher,
    produtoBridge,
    consignacaoRepository: consignacaoRepo,
    consignacaoItemRepository: itemRepo
  }).executar({
    consignacaoId,
    produtoId: 100,
    quantidade: 10,
    precoUnitario: produtoExtra.preco != null ? produtoExtra.preco : 2.5,
    tabelaPrecoId: 3,
    linhaComercialId: 7,
    canalVenda: 'CONSIGNADO',
    unidadeComercial: produtoExtra.unidadeComercial || 'UN',
    precoOrigem: 'tabela_preco_linha'
  });
  assert.strictEqual(add.isOk(), true, add.erro?.message || 'adicionar item falhou');

  const estoqueBridge = {
    registrarSaidaConsignacao: async () => ({ ok: true }),
    chamadas: 0
  };
  const outboxService = criarMockOutboxService({ estoqueBridge });
  adaptarUowParaOutbox(uow, outboxService);

  const ledgerAntes = movRepo.movimentacoes.length;
  const entrega = await new RegistrarEntregaConsignacaoUseCase({
    unitOfWork: uow,
    eventPublisher: publisher,
    consignacaoRepository: consignacaoRepo,
    consignacaoItemRepository: itemRepo,
    perfilComercialRepository: perfilRepo,
    movimentacaoComercialRepository: movRepo,
    clienteBridge: { buscarPorId: async () => ({ id: 10 }), estaAtivo: async () => true },
    estoqueBridge,
    outboxService
  }).executar({ consignacaoId });
  assert.strictEqual(entrega.isOk(), true, entrega.erro?.message || 'entrega falhou');

  return {
    consignacaoId,
    consignacaoRepo,
    itemRepo,
    movRepo,
    publisher,
    outboxService,
    estoqueBridge,
    ledgerAntes
  };
}

async function main() {
  console.log('\nRCM-8.0 — Consulta e reimpressão de consignação\n');

  await test('1-3 criar, adicionar produtos e registrar entrega', async () => {
    const ctx = await montarOperacaoEntregue();
    const cons = await ctx.consignacaoRepo.buscarPorId(ctx.consignacaoId);
    assert.strictEqual(cons.status, 'ENTREGUE');
    assert.ok(ctx.itemRepo.itens.length >= 1);
    assert.ok(ctx.movRepo.movimentacoes.some((m) => m.tipoMovimentacao === 'ENTREGA'));
  });

  await test('4-10 consultar confirma produtos, qtd, preço, UC, tabela e canal', async () => {
    const ctx = await montarOperacaoEntregue();
    const consulta = await new ConsultarConsignacaoUseCase({
      consignacaoRepository: ctx.consignacaoRepo
    }).executar({ consignacaoId: ctx.consignacaoId, clienteId: 10 });
    assert.strictEqual(consulta.isOk(), true);

    const itensUc = await new ConsultarItensConsignacaoUseCase({
      consignacaoRepository: ctx.consignacaoRepo,
      consignacaoItemRepository: ctx.itemRepo
    }).executar({ consignacaoId: ctx.consignacaoId, clienteId: 10 });
    assert.strictEqual(itensUc.isOk(), true);

    const item = itensUc.dados.itens[0];
    const itemJson = ItemConsignacaoResponse.toJSON({
      ...item,
      produtoNome: item.produtoNome || 'Picolé Premium'
    });
    const header = ConsignacaoResponse.toJSON(consulta.dados, { itens: [itemJson] });

    assert.strictEqual(Number(itemJson.quantidadeEntregue), 10);
    assert.strictEqual(Number(itemJson.precoUnitario), 2.5);
    assert.strictEqual(itemJson.unidadeComercial, 'UN');
    assert.strictEqual(Number(itemJson.tabelaPrecoId), 3);
    assert.strictEqual(String(itemJson.canalVenda).toUpperCase(), 'CONSIGNADO');
    assert.strictEqual(header.canalOperacao, 'CONSIGNADO');
    assert.strictEqual(header.statusLabel, 'Entregue');
    assert.strictEqual(Number(header.tabelaPrecoId), 3);
  });

  await test('unidade comercial congelada LITRO', async () => {
    const ctx = await montarOperacaoEntregue({
      nome: 'Sorvete',
      unidade: 'KG',
      unidadeComercial: 'LITRO',
      preco: 28
    });
    const item = (await ctx.itemRepo.listarPorConsignacao(ctx.consignacaoId))[0];
    const json = ItemConsignacaoResponse.toJSON({
      ...item,
      produtoNome: 'Sorvete'
    });
    assert.strictEqual(json.unidadeComercial, 'LITRO');
    assert.strictEqual(Number(json.precoUnitario), 28);
  });

  await test('11-14 reimpressão não cria operação nem altera estoque/preço/ledger/status', async () => {
    const ctx = await montarOperacaoEntregue();
    const consignacoesAntes = ctx.consignacaoRepo.todos.length;
    const ledgerAntes = ctx.movRepo.movimentacoes.length;
    const itemAntes = { ...(await ctx.itemRepo.listarPorConsignacao(ctx.consignacaoId))[0] };
    const statusAntes = (await ctx.consignacaoRepo.buscarPorId(ctx.consignacaoId)).status;

    const consignacao = await ctx.consignacaoRepo.buscarPorId(ctx.consignacaoId);
    const itens = (await ctx.itemRepo.listarPorConsignacao(ctx.consignacaoId)).map((i) =>
      ItemConsignacaoResponse.toJSON({ ...i, produtoNome: 'Picolé Premium' })
    );
    const detalhe = buildDetalheConsulta({ ...consignacao, itens }, { clienteNome: 'Cicero Diego' });
    const html = buildComprovanteConsignacaoHtml(detalhe);
    const efeitos = reimpressaoSomenteLeitura();

    assert.ok(html.includes('COMPROVANTE DE CONSIGNAÇÃO'));
    assert.ok(html.includes('CONSIGNADO'));
    assert.ok(html.includes('Cicero Diego'));
    assert.strictEqual(efeitos.criaNovaOperacao, false);
    assert.strictEqual(efeitos.alteraEstoque, false);
    assert.strictEqual(efeitos.alteraPreco, false);
    assert.strictEqual(efeitos.alteraLedger, false);
    assert.strictEqual(efeitos.alteraStatus, false);

    assert.strictEqual(ctx.consignacaoRepo.todos.length, consignacoesAntes);
    assert.strictEqual(ctx.movRepo.movimentacoes.length, ledgerAntes);
    const itemDepois = (await ctx.itemRepo.listarPorConsignacao(ctx.consignacaoId))[0];
    assert.strictEqual(Number(itemDepois.precoUnitario), Number(itemAntes.precoUnitario));
    assert.strictEqual((await ctx.consignacaoRepo.buscarPorId(ctx.consignacaoId)).status, statusAntes);
  });

  await test('15 consignação antiga continua consultável', async () => {
    const antiga = criarConsignacao({
      id: 88,
      status: 'ENTREGUE',
      dataEntrega: '2025-01-15T14:30:00.000Z',
      valorTotalEntregue: 185,
      updatedAt: '2025-01-15T14:30:00.000Z'
    });
    const repo = criarMockConsignacaoRepo(antiga);
    const result = await new ConsultarConsignacaoUseCase({
      consignacaoRepository: repo
    }).executar({ consignacaoId: 88, clienteId: 10 });
    assert.strictEqual(result.isOk(), true);
    assert.strictEqual(result.dados.status, 'ENTREGUE');
    assert.strictEqual(result.dados.dataEntrega, '2025-01-15T14:30:00.000Z');
  });

  await test('16 consignação de outro cliente não é acessível no contexto errado', async () => {
    const repo = criarMockConsignacaoRepo(criarConsignacao({ clienteId: 10 }));
    const result = await new ConsultarConsignacaoUseCase({
      consignacaoRepository: repo
    }).executar({ consignacaoId: 1, clienteId: 99 });
    assert.strictEqual(result.isFail(), true);

    const itens = await new ConsultarItensConsignacaoUseCase({
      consignacaoRepository: repo,
      consignacaoItemRepository: criarMockItemRepo([criarItem()])
    }).executar({ consignacaoId: 1, clienteId: 99 });
    assert.strictEqual(itens.isFail(), true);

    assert.strictEqual(consignacaoPertenceAoCliente({ clienteId: 10 }, 99), false);
    assert.strictEqual(consignacaoPertenceAoCliente({ clienteId: 10 }, 10), true);
  });

  await test('status consulta mapeia enumeração existente', async () => {
    assert.strictEqual(mapStatusConsultaConsignacao({ status: 'RASCUNHO' }).label, 'Em preparação');
    assert.strictEqual(mapStatusConsultaConsignacao({ status: 'ENTREGUE' }).label, 'Entregue');
    assert.strictEqual(mapStatusConsultaConsignacao({
      status: 'ACERTADA',
      saldoAberto: 40,
      valorTotalPago: 10
    }).label, 'Parcial');
    assert.strictEqual(mapStatusConsultaConsignacao({
      status: 'ENTREGUE',
      prestacaoContasAtiva: { status: 'FECHADA' }
    }).label, 'Encerrada');
    assert.strictEqual(mapStatusConsultaConsignacao({ status: 'CANCELADA' }).label, 'Cancelada');
  });

  await test('preço de segurança vem do snapshot, não do Resolver', async () => {
    const item = ItemConsignacaoResponse.toJSON(criarItem({
      precoFallback: 1,
      precoUnitario: 1.99,
      produtoNome: 'Produto X'
    }));
    const detalhe = buildDetalheConsulta({
      id: 9,
      documento: { numero: '000009' },
      status: 'ENTREGUE',
      clienteNome: 'Cicero Diego',
      itens: [item]
    });
    assert.strictEqual(detalhe.produtos[0].precoFallback, true);
    assert.strictEqual(detalhe.produtos[0].precoUnitario, 1.99);
  });

  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  if (falhou > 0) process.exit(1);
}

main();
